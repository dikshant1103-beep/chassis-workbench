"""
2-D Revolute Joint (pin joint).

Constrains the attachment point on body_i to coincide with the attachment
point on body_j (or to a fixed point in the world if body_j is ground).

Constraint equations (2 scalar equations):
    Φ = r_i + R_i·s_i  −  r_j − R_j·s_j  =  0

where
    r_i = [x_i, y_i]               CoM of body i in world frame
    R_i = rot(θ_i)                  2×2 rotation matrix
    s_i = [sx_i, sy_i]             attachment point in body-i local frame

Differentiating Φ:
    Φ̇  = J · Q̇   = 0     (velocity constraint)
    Φ̈  = J · Q̈ + γ = 0   (acceleration constraint)

where γ = d/dt(J) · Q̇  accounts for the time-derivative of the Jacobian.

The constraint Jacobian J has shape (2, 3·n_bodies).
For the two bodies involved (i and j), the non-zero blocks are:

    ∂Φ/∂q_i = [I₂  | -ω_perp(R_i·s_i)]     (2×3 block at column 3·i)
    ∂Φ/∂q_j = [-I₂ |  ω_perp(R_j·s_j)]     (2×3 block at column 3·j)

where ω_perp([px,py]) = [-py, px]  (the 2-D cross-product column).
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody2D


def _rot(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def _drot(theta: float) -> np.ndarray:
    """d/dθ of rotation matrix."""
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[-s, -c], [c, -s]])


class RevoluteJoint2D:
    """Pin joint between two 2-D bodies (or body and ground).

    Parameters
    ----------
    body_i : moving body
    body_j : second body (set to None or a ground body for world-fixed pin)
    s_i    : attachment point in body_i local frame  [sx, sy]
    s_j    : attachment point in body_j local frame  [sx, sy]
              (ignored if body_j is ground — use world_point instead)
    world_point : fixed world-frame point  (only used when body_j is None/ground)
    name   : optional label
    """

    N_CONSTRAINTS = 2

    def __init__(
        self,
        body_i: RigidBody2D,
        body_j: RigidBody2D | None,
        s_i: np.ndarray,
        s_j: np.ndarray | None = None,
        world_point: np.ndarray | None = None,
        name: str = "revolute",
    ):
        self.body_i = body_i
        self.body_j = body_j          # None means grounded
        self.s_i = np.asarray(s_i, dtype=float)
        self.s_j = np.asarray(s_j, dtype=float) if s_j is not None else np.zeros(2)
        self.world_point = (np.asarray(world_point, dtype=float)
                            if world_point is not None else None)
        self.name = name
        # row index in the global constraint matrix — set by assembler
        self.row_start: int = -1

    # ── Constraint residual Φ ───────────────────────────────────────────────

    def phi(self) -> np.ndarray:
        """Position-level constraint residual, shape (2,).

        Φ = P_i − P_j = 0
        """
        bi = self.body_i
        P_i = bi.global_point(self.s_i)

        if self.body_j is None or self.body_j.is_ground:
            # grounded: P_j is a fixed world point
            if self.world_point is not None:
                P_j = self.world_point
            else:
                P_j = self.body_j.global_point(self.s_j) if self.body_j else P_i
        else:
            P_j = self.body_j.global_point(self.s_j)

        return P_i - P_j

    # ── Constraint Jacobian ∂Φ/∂Q ──────────────────────────────────────────

    def phi_q(self, n_dof: int) -> np.ndarray:
        """Full Jacobian row block, shape (2, n_dof).

        Non-zero columns:
            body_i columns (dof_start_i : dof_start_i+3):
                [I₂  |  -drot(θ_i)·s_i]   → (2×3)
            body_j columns (dof_start_j : dof_start_j+3)  [if not ground]:
                [-I₂ |   drot(θ_j)·s_j]   → (2×3)
        """
        J = np.zeros((2, n_dof))
        bi = self.body_i

        # --- body_i block ---
        ds_i = _drot(bi.theta) @ self.s_i   # ∂(R_i·s_i)/∂θ_i
        di = bi.dof_start
        J[:, di:di+2] = np.eye(2)
        J[:, di+2]    = ds_i

        # --- body_j block ---
        if self.body_j is not None and not self.body_j.is_ground:
            bj = self.body_j
            ds_j = _drot(bj.theta) @ self.s_j
            dj = bj.dof_start
            J[:, dj:dj+2] = -np.eye(2)
            J[:, dj+2]    = -ds_j

        return J

    # ── Acceleration RHS γ = −d/dt(J)·Q̇ ───────────────────────────────────

    def gamma(self) -> np.ndarray:
        """RHS of the acceleration-level constraint: J·q̈ = γ.

        Derivation:
            φ = r_i + R_i·s_i − (r_j + R_j·s_j) = 0
            φ̈ = J·q̈ + d/dt(J)·q̇ = 0
            γ = −d/dt(J)·q̇

            d/dt(_drot(θ)·s) = ω · (d/dθ _drot) · s = ω · (−R) · s = −ω·R·s
            d/dt(J_rot_i)·ω_i = −ω_i · R_i · s_i · ω_i = −ω_i² · R_i · s_i
            γ = −d/dt(J)·q̇ = +ω_i²·R_i·s_i − ω_j²·R_j·s_j
        """
        bi = self.body_i
        R_i = _rot(bi.theta)
        g = (bi.omega ** 2) * (R_i @ self.s_i)    # ← positive sign (was negative — bug)

        if self.body_j is not None and not self.body_j.is_ground:
            bj = self.body_j
            R_j = _rot(bj.theta)
            g -= (bj.omega ** 2) * (R_j @ self.s_j)   # ← subtract body_j term

        return g

    # ── Velocity residual Φ̇ (for monitoring drift) ─────────────────────────

    def phi_dot(self, n_dof: int, QD: np.ndarray) -> np.ndarray:
        """Velocity-level constraint residual J·Q̇, shape (2,)."""
        return self.phi_q(n_dof) @ QD

    def __repr__(self) -> str:
        bj_name = self.body_j.name if self.body_j else "ground"
        return f"RevoluteJoint2D('{self.name}': {self.body_i.name} ↔ {bj_name})"
