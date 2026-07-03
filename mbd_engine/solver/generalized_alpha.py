"""
generalized_alpha.py — Generalized-α implicit DAE integrator.

Reference: Chung J. & Hulbert G.M. (1993).
           "A Time Integration Algorithm for Structural Dynamics With
            Improved Numerical Dissipation: The Generalized-α Method."
           Journal of Applied Mechanics, 60(2), pp. 371-375.

For MBD DAE systems:
    M · a  +  J^T · λ  =  f(q, v)
    Φ(q)                =  0

Parameters (computed from spectral radius ρ∞ at ω→∞):
    α_m = (2ρ∞ − 1) / (ρ∞ + 1)
    α_f = ρ∞       / (ρ∞ + 1)
    γ   = 0.5 − α_m + α_f
    β   = 0.25 · (1 − α_m + α_f)²

ρ∞ = 1.0 → no numerical dissipation (equivalent to Newmark trapezoidal rule)
ρ∞ = 0.0 → maximum dissipation (L-stable, overdamped high-freq)
ρ∞ = 0.8 → recommended for MBD (light dissipation, 2nd-order accurate)

Predictor-corrector algorithm per step (n → n+1):
    Predictor (explicit, no solve needed):
        ã = a_n
        ṽ = v_n + h·(1−γ)·a_n
        q̃ = q_n + h·v_n + h²·(0.5−β)·a_n   ← xyz only; quat separate

    Corrector (iterate Newton until ‖Δa‖ < tol):
        a_{n+1} = ã + Δa
        v_{n+1} = ṽ + h·γ·Δa
        q_{n+1} = q̃ + h²·β·Δa               ← xyz only

    After converging:
        Update quaternion via trapezoidal rule on ω_body

Works with both Assembler2D (3n DOF) and Assembler3D (6n DOF, 7n positions).
The integrator detects the assembler type automatically.
"""

from __future__ import annotations
from typing import Dict, List
import numpy as np

from .newton import newton_solve
from ..core.rotation import normalize, kinematic_map


def _gen_alpha_params(rho_inf: float) -> tuple[float, float, float, float]:
    """Compute Generalized-α parameters from spectral radius ρ∞ ∈ [0, 1]."""
    if not 0.0 <= rho_inf <= 1.0:
        raise ValueError(f"rho_inf must be in [0, 1], got {rho_inf}")
    alpha_m = (2.0 * rho_inf - 1.0) / (rho_inf + 1.0)
    alpha_f = rho_inf / (rho_inf + 1.0)
    gamma   = 0.5 - alpha_m + alpha_f
    beta    = 0.25 * (1.0 - alpha_m + alpha_f) ** 2
    return alpha_m, alpha_f, gamma, beta


class GeneralizedAlphaIntegrator:
    """Generalized-α implicit integrator for 2-D and 3-D MBD DAE systems.

    Parameters
    ----------
    assembler   : Assembler2D or Assembler3D instance
    dt          : default timestep, s
    rho_inf     : spectral radius at ω→∞ (0.8 recommended)
    newton_tol  : Newton convergence tolerance (default 1e-10)
    max_newton  : max Newton iterations per step (default 10)
    adaptive    : enable adaptive step size based on Newton iterations
    """

    def __init__(
        self,
        assembler,
        dt:          float = 5e-3,
        rho_inf:     float = 0.8,
        newton_tol:  float = 1e-10,
        max_newton:  int   = 10,
        adaptive:    bool  = True,
    ):
        self.asm        = assembler
        self.dt         = dt
        self.rho_inf    = rho_inf
        self.newton_tol = newton_tol
        self.max_newton = max_newton
        self.adaptive   = adaptive

        self.alpha_m, self.alpha_f, self.gamma, self.beta = _gen_alpha_params(rho_inf)

        # Detect assembler type
        self._is_3d = hasattr(assembler, 'moving') and hasattr(
            list(assembler.moving)[0] if assembler.moving else type('', (), {'quat': None})(),
            'quat'
        )

    # ── Quaternion-aware position update ─────────────────────────────────────

    def _get_xyz(self, Q: np.ndarray) -> np.ndarray:
        """Extract xyz positions from Q (works for both 2D and 3D)."""
        if not self._is_3d:
            return Q.copy()     # 2D: Q is already [x, y, theta] × n

        # 3D: Q layout is [x,y,z, qw,qx,qy,qz] × n_bodies
        n = len(self.asm.moving)
        xyz = np.zeros(3 * n)
        for b in self.asm.moving:
            i3 = b.index * 3
            i7 = b.index * 7
            xyz[i3:i3+3] = Q[i7:i7+3]
        return xyz

    def _set_xyz(self, Q: np.ndarray, xyz: np.ndarray) -> np.ndarray:
        """Overwrite xyz part of Q (3D only); returns updated Q."""
        if not self._is_3d:
            return xyz.copy()
        Q = Q.copy()
        for b in self.asm.moving:
            i3 = b.index * 3
            i7 = b.index * 7
            Q[i7:i7+3] = xyz[i3:i3+3]
        return Q

    def _update_quat(self, Q: np.ndarray, QD_old: np.ndarray, QD_new: np.ndarray, h: float) -> np.ndarray:
        """Update quaternion components of Q using trapezoidal rule on ω_body.

        q_{n+1} = normalize( q_n + h · ½·B(q_n) · ω_body_mid )
        ω_body_mid = 0.5·(ω_body_n + ω_body_{n+1})

        Here ω_world is in QD[d+3:d+6] for each body.
        ω_body = R(q)^T · ω_world.
        """
        if not self._is_3d:
            return Q  # 2D theta already handled in xyz block

        Q = Q.copy()
        for b in self.asm.moving:
            i7 = b.index * 7
            d  = b.dof_start
            # Quaternion at step n (from Q)
            q_n = normalize(Q[i7+3:i7+7])
            from ..core.rotation import to_R
            R_n  = to_R(q_n)

            # ω_world at n and n+1 (from QD vectors, 6-DOF: [v, ω_world])
            ow_n  = QD_old[d+3:d+6]
            ow_n1 = QD_new[d+3:d+6]

            # Convert to body frame using R at step n (approximation)
            ob_n  = R_n.T @ ow_n
            ob_n1 = R_n.T @ ow_n1
            ob_mid = 0.5 * (ob_n + ob_n1)

            # Integrate quaternion
            q_new = q_n + h * 0.5 * kinematic_map(q_n) @ ob_mid
            Q[i7+3:i7+7] = normalize(q_new)

        return Q

    def _n_xyz(self) -> int:
        """Number of xyz DOFs (3n for 2D, 3×n_bodies for 3D translation)."""
        if not self._is_3d:
            return self.asm.n_dof   # 2D: DOFs include orientation (theta)
        return 3 * len(self.asm.moving)

    def _get_QD_trans(self, QD: np.ndarray) -> np.ndarray:
        """Get translational velocities as 3n vector (3D only)."""
        if not self._is_3d:
            return QD.copy()
        n = len(self.asm.moving)
        v = np.zeros(3 * n)
        for b in self.asm.moving:
            v[b.index*3:b.index*3+3] = QD[b.dof_start:b.dof_start+3]
        return v

    # ── Single step ───────────────────────────────────────────────────────────

    def step(
        self,
        Q:   np.ndarray,   # current positions (7n 3D / 3n 2D)
        QD:  np.ndarray,   # current velocities (6n 3D / 3n 2D)
        QDD: np.ndarray,   # current accelerations (6n 3D / 3n 2D)
        h:   float | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
        """Advance one step using Generalized-α predictor-corrector.

        Returns
        -------
        Q_new, QD_new, QDD_new, stats
        stats : dict with keys 'newton_iters', 'residual_norm', 'converged'
        """
        if h is None:
            h = self.dt

        alpha_m = self.alpha_m
        alpha_f = self.alpha_f
        gamma   = self.gamma
        beta    = self.beta

        n_dof = self.asm.n_dof

        # ── Predictor ────────────────────────────────────────────────────────
        # ã = a_n (predicted acceleration = previous acceleration)
        # ṽ = v_n + h·(1−γ)·a_n
        # q̃_xyz = q_n_xyz + h·v_n_xyz + h²·(0.5−β)·a_n_trans

        a_pred = QDD.copy()
        v_pred = QD + h * (1.0 - gamma) * QDD

        # Extract xyz positions
        q_xyz_n  = self._get_xyz(Q)   # (3n for 3D or n_dof for 2D)
        a_trans  = self._get_trans_acc(QDD)
        q_xyz_pred = q_xyz_n + h * self._get_trans_vel(QD) + h**2 * (0.5 - beta) * a_trans

        # ── Newton corrector loop ─────────────────────────────────────────────
        # Unknowns: a_{n+1} = a_pred + Δa
        # Update: v_{n+1} = v_pred + h·γ·Δa
        #         q_{n+1}_xyz = q_xyz_pred + h²·β·Δa_trans

        a_new = a_pred.copy()
        lam   = np.zeros(self.asm.n_con)

        newton_iters = 0
        final_res    = float('inf')
        converged    = False

        for it in range(self.max_newton):
            # Build trial state
            v_trial   = v_pred + h * gamma * a_new
            a_trans_n = self._get_trans_acc(a_new)
            q_xyz_trial = q_xyz_pred + h**2 * beta * a_trans_n

            # Build full Q_trial and QD_trial
            Q_trial  = self._set_xyz(Q, q_xyz_trial)
            QD_trial = v_trial

            # For 3D: update quaternion using predicted ω (from v_pred initially)
            if self._is_3d:
                Q_trial = self._update_quat(Q_trial, QD, QD_trial, h)

            # Set assembler state
            self.asm.set_state(Q_trial, QD_trial)

            # Assemble all matrices
            M     = self.asm.assemble_M()
            J     = self.asm.assemble_J()
            f     = self.asm.assemble_f()
            phi   = self.asm.assemble_phi()
            if self._is_3d:
                phi_d = self.asm.assemble_phi_dot()
            else:
                phi_d = self.asm.assemble_phi_dot(QD_trial)
            gamma_con = self.asm.assemble_gamma()

            # Effective a for residual: (1-α_m)·a_new + α_m·a_n
            a_eff = (1.0 - alpha_m) * a_new + alpha_m * QDD

            # Newton solve for Δa
            result = newton_solve(
                M=M, J=J, f=f,
                phi=phi, phi_dot=phi_d, gamma=gamma_con,
                a_eff=a_eff, lam=lam,
                alpha_m=alpha_m,
                c_pos=h**2 * beta,
                alpha_b=self.asm.alpha,
                beta_b=self.asm.beta,
                tol=self.newton_tol,
            )

            # Update solution
            a_new = a_new + result.delta_a
            lam   = result.lam

            newton_iters += 1
            final_res     = result.residual_norm

            if final_res < self.newton_tol:
                converged = True
                break

        # ── Final state ───────────────────────────────────────────────────────
        QDD_new = a_new
        QD_new  = v_pred + h * gamma * QDD_new
        a_trans_f = self._get_trans_acc(QDD_new)
        q_xyz_new = q_xyz_pred + h**2 * beta * a_trans_f

        Q_new = self._set_xyz(Q, q_xyz_new)
        if self._is_3d:
            Q_new = self._update_quat(Q_new, QD, QD_new, h)

        # Renormalize quaternions
        if self._is_3d:
            for b in self.asm.moving:
                i7 = b.index * 7
                Q_new[i7+3:i7+7] = normalize(Q_new[i7+3:i7+7])

        self.asm.set_state(Q_new, QD_new)

        stats = {
            'newton_iters': newton_iters,
            'residual_norm': final_res,
            'converged': converged,
        }

        # Adaptive timestep: reduce if Newton didn't converge, grow if fast
        if self.adaptive:
            if not converged or newton_iters >= self.max_newton:
                self.dt = max(self.dt * 0.5, 1e-6)
            elif newton_iters <= 3 and converged:
                self.dt = min(self.dt * 1.2, h * 2.0)

        return Q_new, QD_new, QDD_new, stats

    # ── Helper: extract translational DOF slices ──────────────────────────────

    def _get_trans_vel(self, QD: np.ndarray) -> np.ndarray:
        """Translational velocity components matching xyz layout."""
        if not self._is_3d:
            return QD.copy()
        n = len(self.asm.moving)
        v = np.zeros(3 * n)
        for b in self.asm.moving:
            v[b.index*3:b.index*3+3] = QD[b.dof_start:b.dof_start+3]
        return v

    def _get_trans_acc(self, QDD: np.ndarray) -> np.ndarray:
        """Translational acceleration components matching xyz layout."""
        if not self._is_3d:
            return QDD.copy()
        n = len(self.asm.moving)
        a = np.zeros(3 * n)
        for b in self.asm.moving:
            a[b.index*3:b.index*3+3] = QDD[b.dof_start:b.dof_start+3]
        return a

    def _set_trans_in_QDD(self, QDD: np.ndarray, a_xyz: np.ndarray) -> np.ndarray:
        """Set translational part of QDD from xyz acceleration vector."""
        if not self._is_3d:
            return a_xyz.copy()
        QDD = QDD.copy()
        for b in self.asm.moving:
            QDD[b.dof_start:b.dof_start+3] = a_xyz[b.index*3:b.index*3+3]
        return QDD

    # ── Full simulation ───────────────────────────────────────────────────────

    def simulate(
        self,
        t_end:       float,
        dt:          float | None = None,
        store_every: int   = 1,
    ) -> Dict:
        """Run simulation from t=0 to t=t_end.

        Returns
        -------
        dict with keys:
            't', 'Q', 'QD', 'QDD', 'energy', 'energy_rel_error',
            'constraint_violation', 'newton_iters'
        """
        if dt is not None:
            self.dt = dt

        Q   = self.asm.get_Q()
        QD  = self.asm.get_QD()

        # Compute initial acceleration from static solve
        self.asm.set_state(Q, QD)
        if self._is_3d:
            QDD, _ = self.asm.solve_accelerations()
        else:
            QDD, _ = self.asm.solve_accelerations(Q, QD)

        n_steps = int(np.ceil(t_end / self.dt))

        t_list, Q_list, QD_list, QDD_list = [], [], [], []
        E_list, viol_list, iter_list = [], [], []

        t = 0.0
        for step_i in range(n_steps + 1):
            if step_i % store_every == 0:
                t_list.append(t)
                Q_list.append(Q.copy())
                QD_list.append(QD.copy())
                QDD_list.append(QDD.copy())
                E_list.append(self.asm.total_energy())
                viol_list.append(self.asm.constraint_violation())

            if step_i == n_steps:
                break

            Q, QD, QDD, stats = self.step(Q, QD, QDD, h=self.dt)
            iter_list.append(stats['newton_iters'])
            t += self.dt

        E_arr = np.array(E_list)
        E0    = E_arr[0] if abs(E_arr[0]) > 1e-15 else 1.0
        return {
            't':                    np.array(t_list),
            'Q':                    np.array(Q_list),
            'QD':                   np.array(QD_list),
            'QDD':                  np.array(QDD_list),
            'energy':               E_arr,
            'energy_rel_error':     (E_arr - E_arr[0]) / E0,
            'constraint_violation': np.array(viol_list),
            'newton_iters':         np.array(iter_list) if iter_list else np.array([]),
        }
