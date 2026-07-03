"""
RK4 time integrator with Baumgarte constraint stabilization.

The integration loop:

    For each timestep h:
        1. Get current state  (Q, QD)
        2. Solve KKT system   → Q̈ (accelerations)
        3. RK4 advance        → (Q_new, QD_new)
        4. Update body states
        5. Record results

The 6-component state per body is [x, y, θ, vx, vy, ω].
RK4 treats this as a first-order ODE:
    d/dt [Q]    = [QD          ]
    d/dt [QD]   = [Qdd(Q, QD)  ]   ← calls the KKT solver each stage
"""

from __future__ import annotations
from typing import Dict, List
import numpy as np

from .assembler import Assembler2D


class RK4Integrator:
    """Fixed-step explicit RK4 integrator for 2-D MBD systems.

    Parameters
    ----------
    assembler : Assembler2D instance (owns bodies + constraints)
    dt        : timestep, s
    g         : gravitational acceleration (passed to assembler)
    """

    def __init__(self, assembler: Assembler2D, dt: float = 1e-3):
        self.asm = assembler
        self.dt  = dt

    # ── Derivative function for RK4 ─────────────────────────────────────────

    def _derivatives(self, Q: np.ndarray, QD: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Given state (Q, QD), return (Q̇, Q̈) = (QD, Qdd).

        Sets body states from (Q, QD), then calls the KKT assembler.
        """
        self.asm.set_state(Q, QD)
        Qdd, _ = self.asm.solve_accelerations(Q, QD)
        return QD.copy(), Qdd

    # ── Single RK4 step ─────────────────────────────────────────────────────

    def step(self, Q: np.ndarray, QD: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Advance (Q, QD) by one timestep dt using classical RK4.

        RK4 stages:
            k1 = f(Q,            QD          )
            k2 = f(Q + h/2·k1x, QD + h/2·k1v)
            k3 = f(Q + h/2·k2x, QD + h/2·k2v)
            k4 = f(Q + h·k3x,   QD + h·k3v  )
            Q_new  = Q  + h/6·(k1x + 2·k2x + 2·k3x + k4x)
            QD_new = QD + h/6·(k1v + 2·k2v + 2·k3v + k4v)
        """
        h = self.dt

        # Stage 1
        k1_x, k1_v = self._derivatives(Q, QD)
        # Stage 2
        k2_x, k2_v = self._derivatives(Q + 0.5*h*k1_x, QD + 0.5*h*k1_v)
        # Stage 3
        k3_x, k3_v = self._derivatives(Q + 0.5*h*k2_x, QD + 0.5*h*k2_v)
        # Stage 4
        k4_x, k4_v = self._derivatives(Q + h*k3_x,     QD + h*k3_v)

        Q_new  = Q  + (h / 6.0) * (k1_x + 2*k2_x + 2*k3_x + k4_x)
        QD_new = QD + (h / 6.0) * (k1_v + 2*k2_v + 2*k3_v + k4_v)

        # Restore final state into bodies
        self.asm.set_state(Q_new, QD_new)
        return Q_new, QD_new

    # ── Full simulation run ──────────────────────────────────────────────────

    def simulate(
        self,
        t_end: float,
        dt: float | None = None,
        store_every: int = 1,
    ) -> Dict:
        """Run simulation from t=0 to t=t_end.

        Parameters
        ----------
        t_end       : simulation end time, s
        dt          : override timestep (default: self.dt)
        store_every : save results every N steps (reduce memory for long runs)

        Returns
        -------
        dict with keys:
            't'                  : (n_frames,) time array
            'Q'                  : (n_frames, n_dof) position history
            'QD'                 : (n_frames, n_dof) velocity history
            'energy'             : (n_frames,) total mechanical energy
            'constraint_violation': (n_frames,) ‖Φ‖∞
            'lambda'             : not stored (use for debugging only)
        """
        if dt is not None:
            self.dt = dt

        Q  = self.asm.get_Q()
        QD = self.asm.get_QD()

        n_steps = int(np.ceil(t_end / self.dt))

        t_list, Q_list, QD_list, E_list, viol_list = [], [], [], [], []

        t = 0.0
        for step_i in range(n_steps + 1):
            if step_i % store_every == 0:
                t_list.append(t)
                Q_list.append(Q.copy())
                QD_list.append(QD.copy())
                E_list.append(self.asm.total_energy())
                viol_list.append(self.asm.constraint_violation())

            if step_i == n_steps:
                break

            Q, QD = self.step(Q, QD)
            t += self.dt

        E_arr  = np.array(E_list)
        E0     = E_arr[0] if abs(E_arr[0]) > 1e-15 else 1.0
        return {
            't':                    np.array(t_list),
            'Q':                    np.array(Q_list),
            'QD':                   np.array(QD_list),
            'energy':               E_arr,
            'energy_rel_error':     (E_arr - E_arr[0]) / E0,
            'constraint_violation': np.array(viol_list),
        }
