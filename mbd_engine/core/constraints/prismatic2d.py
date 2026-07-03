"""
2-D Prismatic Joint (sliding joint).

Constrains two bodies to translate relative to each other along a fixed
axis, while keeping their orientations equal (no relative rotation).

Constraint equations (2 scalar equations):
    Φ₁ = (r_j − r_i − R_i·s_i) · n̂  = 0   (no motion perpendicular to axis)
    Φ₂ = θ_j − θ_i − θ_offset       = 0   (no relative rotation)

where n̂ is the unit normal to the sliding axis (both expressed in world frame).
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody2D


def _rot(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def _drot(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[-s, -c], [c, -s]])


class PrismaticJoint2D:
    """Sliding joint between two 2-D bodies.

    Parameters
    ----------
    body_i      : first body (defines the slide axis)
    body_j      : second body (slides relative to body_i)
    s_i         : reference point on body_i (local frame)
    axis_angle  : angle of the sliding axis in body_i local frame (rad)
    theta_offset: initial angle difference θ_j − θ_i (usually 0)
    name        : label
    """

    N_CONSTRAINTS = 2

    def __init__(
        self,
        body_i: RigidBody2D,
        body_j: RigidBody2D,
        s_i: np.ndarray = np.zeros(2),
        axis_angle: float = 0.0,
        theta_offset: float = 0.0,
        name: str = "prismatic",
    ):
        self.body_i = body_i
        self.body_j = body_j
        self.s_i = np.asarray(s_i, dtype=float)
        self.axis_angle = axis_angle       # slide axis direction in body_i frame
        self.theta_offset = theta_offset
        self.name = name
        self.row_start: int = -1

    def _normal_world(self) -> np.ndarray:
        """Unit normal to slide axis in world frame."""
        alpha = self.body_i.theta + self.axis_angle
        return np.array([-np.sin(alpha), np.cos(alpha)])

    def phi(self) -> np.ndarray:
        bi, bj = self.body_i, self.body_j
        r_i = np.array([bi.x, bi.y])
        r_j = np.array([bj.x, bj.y])
        ref_i = bi.global_point(self.s_i)
        n = self._normal_world()
        phi1 = n @ (r_j - ref_i)
        phi2 = bj.theta - bi.theta - self.theta_offset
        return np.array([phi1, phi2])

    def phi_q(self, n_dof: int) -> np.ndarray:
        bi, bj = self.body_i, self.body_j
        J = np.zeros((2, n_dof))
        n = self._normal_world()
        alpha = bi.theta + self.axis_angle
        # ∂n/∂θ_i = [cos(alpha), sin(alpha)]  (rotate n by 90°)
        dn_dtheta_i = np.array([np.cos(alpha), np.sin(alpha)])
        ds_i = _drot(bi.theta) @ self.s_i
        r_j = np.array([bj.x, bj.y])
        ref_i = bi.global_point(self.s_i)
        diff = r_j - ref_i

        di, dj = bi.dof_start, bj.dof_start
        # row 0: ∂phi1/∂q
        J[0, di:di+2] = -n                              # ∂/∂r_i
        J[0, di+2]    = dn_dtheta_i @ diff - n @ ds_i  # ∂/∂θ_i
        J[0, dj:dj+2] = n                               # ∂/∂r_j
        # row 1: ∂phi2/∂q
        J[1, di+2] = -1.0   # ∂/∂θ_i
        J[1, dj+2] =  1.0   # ∂/∂θ_j
        return J

    def gamma(self) -> np.ndarray:
        bi, bj = self.body_i, self.body_j
        n = self._normal_world()
        alpha = bi.theta + self.axis_angle
        dn_dtheta_i = np.array([np.cos(alpha), np.sin(alpha)])
        ds_i = _drot(bi.theta) @ self.s_i
        r_j = np.array([bj.x, bj.y])
        ref_i = bi.global_point(self.s_i)
        diff = r_j - ref_i

        # γ₁: time-derivative of the row-0 Jacobian block · Q̇
        v_i = np.array([bi.vx, bi.vy])
        v_j = np.array([bj.vx, bj.vy])
        # d/dt(n) = dn_dtheta_i · omega_i
        n_dot = dn_dtheta_i * bi.omega
        # d/dt(ref_i) = v_i + omega_i * [-ds_i_y, ds_i_x] — already in v terms
        # gamma1 = -d/dt(n)·(r_j-ref_i) - n·(v_j - v_i - omega_i·perp(R_i·s_i))
        R_s_i = _rot(bi.theta) @ self.s_i
        perp_Rs_i = np.array([-R_s_i[1], R_s_i[0]])
        ref_i_dot = v_i + bi.omega * perp_Rs_i
        gamma1 = -(n_dot @ diff + n @ (v_j - ref_i_dot) +
                   (dn_dtheta_i @ diff - n @ ds_i) * 0)  # second-order terms
        # Simpler closed-form (exact for rigid bodies):
        gamma1 = -(n_dot @ diff
                   + n @ (v_j - v_i - bi.omega * perp_Rs_i)
                   + dn_dtheta_i * bi.omega @ (diff) * 0)
        # γ₂ = 0 (linear in θ)
        return np.array([gamma1, 0.0])

    def phi_dot(self, n_dof: int, QD: np.ndarray) -> np.ndarray:
        return self.phi_q(n_dof) @ QD

    def __repr__(self) -> str:
        return f"PrismaticJoint2D('{self.name}': {self.body_i.name} ↔ {self.body_j.name})"
