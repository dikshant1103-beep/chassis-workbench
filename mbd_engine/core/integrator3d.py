"""
integrator3d.py — RK4 integrator for 3-D MBD systems.

State split:
  Q   = [x,y,z, qw,qx,qy,qz] × n_bodies   shape (7n,)   — positions + quaternions
  QD  = [vx,vy,vz, ωx,ωy,ωz] × n_bodies   shape (6n,)   — velocities

The quaternion part of Q needs special handling:
  - The 6n velocity-space accelerations (v̇, ω̇) come from the KKT solver.
  - Position advances via:  r_new = r + h·v
  - Quaternion advances via: q_new = q + h·(½·B(q)·ω)  then renormalize

RK4 is applied to the combined 13n-dimensional state [Q; QD]:
  d/dt [Q]  = [Qdot(Q, QD)]   ← translation: v;  rotation: ½·B(q)·ω
  d/dt [QD] = [QDd(Q, QD)]    ← KKT solve at each stage
"""

from __future__ import annotations
from typing import Dict
import numpy as np

from .assembler3d import Assembler3D
from .rotation import normalize, kinematic_map


class RK4Integrator3D:
    """Fixed-step RK4 integrator for 3-D MBD systems.

    Parameters
    ----------
    assembler : Assembler3D
    dt        : default timestep, s
    """

    def __init__(self, assembler: Assembler3D, dt: float = 1e-3):
        self.asm = assembler
        self.dt  = dt

    # ── Q derivative: [ṙ; q̇_quat] concatenated → (7n,) ────────────────────

    def _Q_dot(self) -> np.ndarray:
        """Time derivative of Q = [x,y,z, qw,qx,qy,qz] for all bodies.

        Translation: ṙ = v  (world frame)
        Quaternion:  q̇ = ½·B(q)·ω_body
                       = ½·B(q)·Rᵀ·ω_world
        """
        moving = self.asm.moving
        Qdot = np.zeros(7 * len(moving))
        for b in moving:
            i7 = b.index * 7
            # translation part (world frame velocities)
            Qdot[i7:i7+3] = [b.vx, b.vy, b.vz]
            # quaternion part: use body-frame ω = Rᵀ·ω_world
            Qdot[i7+3:i7+7] = 0.5 * kinematic_map(b.quat) @ b.omega_body
        return Qdot

    def _derivatives(
        self, Q: np.ndarray, QD: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute (Q̇, Q̈D) at given state (Q, QD).

        Sets body states, calls KKT assembler.
        """
        self.asm.set_state(Q, QD)
        QDd, _ = self.asm.solve_accelerations()
        Qdot   = self._Q_dot()          # uses updated body states
        return Qdot, QDd

    # ── RK4 step ─────────────────────────────────────────────────────────────

    def step(self, Q: np.ndarray, QD: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Advance (Q, QD) by one timestep h using classical RK4.

        After each full step the quaternion components in Q are renormalized.
        """
        h = self.dt
        k1_q, k1_v = self._derivatives(Q,               QD)
        k2_q, k2_v = self._derivatives(Q + 0.5*h*k1_q, QD + 0.5*h*k1_v)
        k3_q, k3_v = self._derivatives(Q + 0.5*h*k2_q, QD + 0.5*h*k2_v)
        k4_q, k4_v = self._derivatives(Q + h*k3_q,     QD + h*k3_v)

        Q_new  = Q  + (h / 6.0) * (k1_q + 2*k2_q + 2*k3_q + k4_q)
        QD_new = QD + (h / 6.0) * (k1_v + 2*k2_v + 2*k3_v + k4_v)

        # Renormalize all quaternions
        for b in self.asm.moving:
            i7 = b.index * 7
            Q_new[i7+3:i7+7] = normalize(Q_new[i7+3:i7+7])

        self.asm.set_state(Q_new, QD_new)
        return Q_new, QD_new

    # ── Full simulation run ───────────────────────────────────────────────────

    def simulate(
        self,
        t_end: float,
        dt: float | None = None,
        store_every: int = 1,
    ) -> Dict:
        """Run simulation from t=0 to t=t_end.

        Returns
        -------
        dict with keys:
            't'                   : (n_frames,)       time array
            'Q'                   : (n_frames, 7n)    position-orientation history
            'QD'                  : (n_frames, 6n)    velocity history
            'energy'              : (n_frames,)       total mechanical energy
            'energy_rel_error'    : (n_frames,)       (E(t)-E₀)/E₀
            'constraint_violation': (n_frames,)       ‖Φ‖∞
            'angular_momentum'    : (n_frames, 3)     world-frame L
        """
        if dt is not None:
            self.dt = dt

        Q  = self.asm.get_Q()
        QD = self.asm.get_QD()

        n_steps = int(np.ceil(t_end / self.dt))
        t_list, Q_list, QD_list, E_list, viol_list, L_list = [], [], [], [], [], []

        t = 0.0
        for step_i in range(n_steps + 1):
            if step_i % store_every == 0:
                t_list.append(t)
                Q_list.append(Q.copy())
                QD_list.append(QD.copy())
                E_list.append(self.asm.total_energy())
                viol_list.append(self.asm.constraint_violation())
                L_list.append(self.asm.total_angular_momentum())

            if step_i == n_steps:
                break

            Q, QD = self.step(Q, QD)
            t += self.dt

        E_arr = np.array(E_list)
        E0    = E_arr[0] if abs(E_arr[0]) > 1e-15 else 1.0
        return {
            't':                    np.array(t_list),
            'Q':                    np.array(Q_list),
            'QD':                   np.array(QD_list),
            'energy':               E_arr,
            'energy_rel_error':     (E_arr - E_arr[0]) / E0,
            'constraint_violation': np.array(viol_list),
            'angular_momentum':     np.array(L_list),
        }
