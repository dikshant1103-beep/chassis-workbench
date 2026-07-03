"""
assembler3d.py — Equation assembler for the 3-D MBD solver.

State layout per body (13 components):
  positions  q  = [x, y, z, qw, qx, qy, qz]   (7,)
  velocities qd = [vx, vy, vz, ωx, ωy, ωz]    (6,)

Global state vectors:
  Q   shape (7n,)  — position-orientation for all n bodies
  QD  shape (6n,)  — velocity for all n bodies (6 DOF, not 7)

Saddle-point system (velocity-space):
  [ M    J^T ] [ q̈d ]   [ f     ]
  [ J    0   ] [ λ  ] = [ γ_bm  ]

where γ_bm = γ − 2α·Φ̇ − β²·Φ  (Baumgarte)

After solving for the 6n-vector q̈d = [v̇, ω̇]_all_bodies,
the quaternion derivatives are recovered via: q̇_quat = ½·B(q)·ω_body
"""

from __future__ import annotations
from typing import List
import numpy as np

from .body import RigidBody3D
from .rotation import kinematic_map, normalize


class Assembler3D:
    """Builds and solves the 3-D KKT system.

    Parameters
    ----------
    bodies      : list of RigidBody3D
    constraints : list of joint objects (revolute3d, spherical3d, etc.)
    g           : gravitational acceleration, m/s²
    alpha_baum  : Baumgarte position gain
    beta_baum   : Baumgarte velocity gain
    """

    G = 9.81

    def __init__(
        self,
        bodies: List[RigidBody3D],
        constraints: list,
        g: float = 9.81,
        alpha_baum: float = 20.0,
        beta_baum:  float = 20.0,
    ):
        self.g = g
        self.alpha = alpha_baum
        self.beta  = beta_baum
        self.bodies      = bodies
        self.moving      = [b for b in bodies if not b.is_ground]
        self.constraints = constraints

        self.n_dof = 6 * len(self.moving)   # velocity-space DOFs
        self.n_con = sum(c.N_CONSTRAINTS for c in constraints)

        # Assign dof_start (into 6n velocity vector)
        for idx, b in enumerate(self.moving):
            b.dof_start = 6 * idx
            b.index     = idx

        # Assign row_start to constraints
        row = 0
        for c in constraints:
            c.row_start = row
            row += c.N_CONSTRAINTS

    # ── Mass matrix ──────────────────────────────────────────────────────────

    def assemble_M(self) -> np.ndarray:
        """Block-diagonal mass matrix (world frame), shape (n_dof, n_dof).

        Translational block: m·I₃  (world frame, always isotropic)
        Rotational block: R·I_body·Rᵀ  (world-frame inertia tensor, updated each step)
        """
        M = np.zeros((self.n_dof, self.n_dof))
        for b in self.moving:
            d = b.dof_start
            M[d:d+3, d:d+3] = b.mass * np.eye(3)
            R = b.R
            M[d+3:d+6, d+3:d+6] = R @ b.I_body @ R.T
        return M

    # ── Force vector ─────────────────────────────────────────────────────────

    def assemble_f(self) -> np.ndarray:
        """Generalized force vector (6n,) in world frame.

        Includes:
          - Gravity (translational −y)
          - Gyroscopic/Euler term: −ω_world × (R·I·Rᵀ·ω_world)
        """
        f = np.zeros(self.n_dof)
        for b in self.moving:
            d = b.dof_start
            f[d + 1] -= b.mass * self.g          # gravity in −y
            R  = b.R
            ow = b.omega_world
            Iw = R @ b.I_body @ R.T              # world-frame inertia
            f[d+3:d+6] -= np.cross(ow, Iw @ ow) # −ω_w × (I_w·ω_w)
        return f

    # ── Constraint Jacobian ──────────────────────────────────────────────────

    def assemble_J(self) -> np.ndarray:
        """Dense constraint Jacobian, shape (n_con, n_dof)."""
        J = np.zeros((self.n_con, self.n_dof))
        for c in self.constraints:
            r = c.row_start
            J[r:r + c.N_CONSTRAINTS, :] = c.phi_q(self.n_dof)
        return J

    # ── Constraint residuals ─────────────────────────────────────────────────

    def assemble_phi(self) -> np.ndarray:
        phi = np.zeros(self.n_con)
        for c in self.constraints:
            r = c.row_start
            phi[r:r + c.N_CONSTRAINTS] = c.phi()
        return phi

    def assemble_phi_dot(self) -> np.ndarray:
        """Velocity-level residuals J·QD."""
        return self.assemble_J() @ self.get_QD()

    def assemble_gamma(self) -> np.ndarray:
        gamma = np.zeros(self.n_con)
        for c in self.constraints:
            r = c.row_start
            gamma[r:r + c.N_CONSTRAINTS] = c.gamma()
        return gamma

    # ── KKT solve ────────────────────────────────────────────────────────────

    def solve_accelerations(self) -> tuple[np.ndarray, np.ndarray]:
        """Solve KKT system → (QDd, lam).

        QDd : (6n,) = [v̇_all; ω̇_all]  velocity-space accelerations
        lam : (n_con,) Lagrange multipliers
        """
        M     = self.assemble_M()
        J     = self.assemble_J()
        f     = self.assemble_f()
        phi   = self.assemble_phi()
        phi_d = self.assemble_phi_dot()
        gamma = self.assemble_gamma()

        rhs_con = gamma - 2.0 * self.alpha * phi_d - self.beta**2 * phi

        n, m = self.n_dof, self.n_con

        if m == 0:
            QDd = np.linalg.solve(M, f)
            return QDd, np.zeros(0)

        KKT = np.zeros((n + m, n + m))
        KKT[:n, :n] = M
        KKT[:n, n:] = J.T
        KKT[n:, :n] = J

        rhs = np.concatenate([f, rhs_con])

        try:
            sol = np.linalg.solve(KKT, rhs)
        except np.linalg.LinAlgError:
            sol, *_ = np.linalg.lstsq(KKT, rhs, rcond=None)

        return sol[:n], sol[n:]

    # ── State vector helpers ─────────────────────────────────────────────────

    def get_Q(self) -> np.ndarray:
        """Pack [x,y,z,qw,qx,qy,qz] for all moving bodies → (7n,)."""
        Q = np.zeros(7 * len(self.moving))
        for b in self.moving:
            i7 = b.index * 7
            Q[i7:i7+7] = b.get_q()
        return Q

    def get_QD(self) -> np.ndarray:
        """Pack [vx,vy,vz,ωx,ωy,ωz] for all moving bodies → (6n,)."""
        QD = np.zeros(self.n_dof)
        for b in self.moving:
            QD[b.dof_start:b.dof_start+6] = b.get_qd()
        return QD

    def set_state(self, Q: np.ndarray, QD: np.ndarray) -> None:
        """Unpack Q (7n) and QD (6n) back into body objects."""
        for b in self.moving:
            i7 = b.index * 7
            b.set_q(Q[i7:i7+7])
            b.set_qd(QD[b.dof_start:b.dof_start+6])

    def _quat_derivatives(self) -> np.ndarray:
        """Quaternion time derivatives for all moving bodies → (4n,).

        q̇ = ½ · B(q) · ω_body
        """
        qdot = np.zeros(4 * len(self.moving))
        for b in self.moving:
            i4 = b.index * 4
            qdot[i4:i4+4] = 0.5 * kinematic_map(b.quat) @ b.omega_body
        return qdot

    # ── Energy / diagnostics ─────────────────────────────────────────────────

    def total_energy(self) -> float:
        return sum(b.kinetic_energy() + b.potential_energy(self.g)
                   for b in self.moving)

    def constraint_violation(self) -> float:
        phi = self.assemble_phi()
        return float(np.max(np.abs(phi))) if len(phi) > 0 else 0.0

    def total_angular_momentum(self) -> np.ndarray:
        """Total world-frame angular momentum about origin."""
        L = np.zeros(3)
        for b in self.moving:
            r = np.array([b.x, b.y, b.z])
            v = np.array([b.vx, b.vy, b.vz])
            L += b.angular_momentum_world() + b.mass * np.cross(r, v)
        return L
