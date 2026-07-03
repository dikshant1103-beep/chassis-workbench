"""
Equation assembler for the 2-D MBD solver.

Each timestep produces the components needed to solve the saddle-point system:

    [ M    J^T ] [ q̈ ]   [ f                        ]
    [ J    0   ] [ λ  ] = [ γ  − 2α·Φ̇ − β²·Φ (Baumgarte) ]

where
    M   : (n_dof × n_dof)  sparse mass matrix (block diagonal)
    J   : (n_con × n_dof)  constraint Jacobian
    f   : (n_dof,)          generalized force vector
    γ   : (n_con,)          acceleration RHS from constraints
    Φ   : (n_con,)          position-level constraint residuals
    Φ̇   : (n_con,)          velocity-level constraint residuals
    λ   : (n_con,)          Lagrange multipliers (constraint forces)
"""

from __future__ import annotations
from typing import List
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from .body import RigidBody2D

# accepted constraint types (add more here as new joints are implemented)
_ConstraintLike = object  # duck-typed: needs .phi(), .phi_q(), .gamma(), .row_start


class Assembler2D:
    """Builds and solves the KKT system for a 2-D multibody system.

    Parameters
    ----------
    bodies      : list of RigidBody2D (ground bodies excluded from DOF vector)
    constraints : list of joint/constraint objects
    g           : gravitational acceleration, m/s² (positive = downward in −y)
    alpha_baum  : Baumgarte position stabilization gain
    beta_baum   : Baumgarte velocity stabilization gain
    """

    G = 9.81  # m/s²

    def __init__(
        self,
        bodies: List[RigidBody2D],
        constraints: List[_ConstraintLike],
        g: float = 9.81,
        alpha_baum: float = 20.0,
        beta_baum:  float = 20.0,
    ):
        self.g = g
        self.alpha = alpha_baum
        self.beta  = beta_baum

        # Only non-ground bodies contribute DOFs
        self.bodies      = bodies
        self.moving      = [b for b in bodies if not b.is_ground]
        self.constraints = constraints

        self.n_dof = 3 * len(self.moving)
        self.n_con = sum(c.N_CONSTRAINTS for c in constraints)

        # Assign dof_start to each moving body
        for idx, b in enumerate(self.moving):
            b.dof_start = 3 * idx

        # Assign row_start to each constraint
        row = 0
        for c in constraints:
            c.row_start = row
            row += c.N_CONSTRAINTS

    # ── Mass matrix ─────────────────────────────────────────────────────────

    def assemble_M(self) -> sp.csr_matrix:
        """Block-diagonal mass matrix, shape (n_dof, n_dof)."""
        rows, cols, vals = [], [], []
        for b in self.moving:
            d = b.dof_start
            m_vals = [b.mass, b.mass, b.inertia]
            for k, v in enumerate(m_vals):
                rows.append(d + k)
                cols.append(d + k)
                vals.append(v)
        return sp.csr_matrix(
            (vals, (rows, cols)), shape=(self.n_dof, self.n_dof), dtype=float
        )

    # ── Force vector ─────────────────────────────────────────────────────────

    def assemble_f(self) -> np.ndarray:
        """Generalized force vector, shape (n_dof,).

        Currently includes gravity only.  External forces / torques are added
        by passing them as extra contributions (see add_force hooks later).
        """
        f = np.zeros(self.n_dof)
        for b in self.moving:
            d = b.dof_start
            f[d + 1] -= b.mass * self.g   # gravity in −y direction
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
        """Position-level residuals Φ, shape (n_con,)."""
        phi = np.zeros(self.n_con)
        for c in self.constraints:
            r = c.row_start
            phi[r:r + c.N_CONSTRAINTS] = c.phi()
        return phi

    def assemble_phi_dot(self, QD: np.ndarray) -> np.ndarray:
        """Velocity-level residuals J·Q̇, shape (n_con,)."""
        J = self.assemble_J()
        return J @ QD

    def assemble_gamma(self) -> np.ndarray:
        """Acceleration-level RHS γ, shape (n_con,)."""
        gamma = np.zeros(self.n_con)
        for c in self.constraints:
            r = c.row_start
            gamma[r:r + c.N_CONSTRAINTS] = c.gamma()
        return gamma

    # ── KKT solve ───────────────────────────────────────────────────────────

    def solve_accelerations(
        self,
        Q: np.ndarray,
        QD: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Solve the saddle-point system for Q̈ and λ.

        Returns
        -------
        Qdd : (n_dof,)  generalized accelerations
        lam : (n_con,)  Lagrange multipliers
        """
        M     = self.assemble_M().toarray()   # small system: dense solve is fine
        J     = self.assemble_J()
        f     = self.assemble_f()
        phi   = self.assemble_phi()
        phi_d = self.assemble_phi_dot(QD)
        gamma = self.assemble_gamma()

        # Baumgarte-stabilised RHS for constraint equations
        rhs_con = gamma - 2.0 * self.alpha * phi_d - self.beta**2 * phi

        n = self.n_dof
        m = self.n_con

        if m == 0:
            # Unconstrained system
            Qdd = np.linalg.solve(M, f)
            return Qdd, np.zeros(0)

        # Assemble full KKT matrix
        # [ M    J^T ] [ Qdd ]   [ f       ]
        # [ J    0   ] [ lam ] = [ rhs_con ]
        KKT = np.zeros((n + m, n + m))
        KKT[:n, :n]  = M
        KKT[:n, n:]  = J.T
        KKT[n:, :n]  = J

        rhs = np.concatenate([f, rhs_con])

        try:
            sol = np.linalg.solve(KKT, rhs)
        except np.linalg.LinAlgError:
            # Fallback: least-squares (handles rank deficiency gracefully)
            sol, *_ = np.linalg.lstsq(KKT, rhs, rcond=None)

        Qdd = sol[:n]
        lam  = sol[n:]
        return Qdd, lam

    # ── State vector helpers ─────────────────────────────────────────────────

    def get_Q(self) -> np.ndarray:
        """Pack all body positions into global state vector, shape (n_dof,)."""
        Q = np.zeros(self.n_dof)
        for b in self.moving:
            Q[b.dof_start:b.dof_start + 3] = b.get_q()
        return Q

    def get_QD(self) -> np.ndarray:
        """Pack all body velocities into global velocity vector, shape (n_dof,)."""
        QD = np.zeros(self.n_dof)
        for b in self.moving:
            QD[b.dof_start:b.dof_start + 3] = b.get_qd()
        return QD

    def set_state(self, Q: np.ndarray, QD: np.ndarray) -> None:
        """Unpack global state vectors back into body objects."""
        for b in self.moving:
            b.set_q(Q[b.dof_start:b.dof_start + 3])
            b.set_qd(QD[b.dof_start:b.dof_start + 3])

    # ── Energy ──────────────────────────────────────────────────────────────

    def total_energy(self) -> float:
        """Total mechanical energy T + V of all moving bodies."""
        return sum(b.kinetic_energy() + b.potential_energy(self.g)
                   for b in self.moving)

    def constraint_violation(self) -> float:
        """‖Φ‖∞ — max absolute position constraint violation."""
        phi = self.assemble_phi()
        return float(np.max(np.abs(phi))) if len(phi) > 0 else 0.0
