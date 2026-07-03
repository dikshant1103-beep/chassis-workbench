"""
prismatic3d.py — 3D Prismatic (sliding) joint constraint.

Allows translation along one axis only. No relative rotation.

Constraint equations (5):
  Φ₁₋₂: 2 orientation equations — body j rotates with body i
         aᵢᵀ·bⱼ = 0,  aᵢᵀ·cⱼ = 0     (same axis locking)
  Φ₃₋₅: position constrained in 2 directions perpendicular to slide axis
         bᵢᵀ·d = 0,  cᵢᵀ·d = 0
         where d = r_j + R_j·s_j − r_i − R_i·s_i  (relative displacement)
  Plus: one full rotation lock:
         eᵢᵀ·fⱼ = 0  (prevents spin about slide axis)

Full prismatic = 5 constraints → 1 translational DOF.
Implemented as: 3 relative position constraints perpendicular to axis
              + 2 orientation constraints.
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody3D

N_CONSTRAINTS = 5


def _skew(v: np.ndarray) -> np.ndarray:
    return np.array([
        [ 0.0,  -v[2],  v[1]],
        [ v[2],  0.0,  -v[0]],
        [-v[1],  v[0],  0.0 ],
    ])


def _perp_vectors(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if abs(a[0]) <= abs(a[1]) and abs(a[0]) <= abs(a[2]):
        ref = np.array([1.0, 0.0, 0.0])
    elif abs(a[1]) <= abs(a[2]):
        ref = np.array([0.0, 1.0, 0.0])
    else:
        ref = np.array([0.0, 0.0, 1.0])
    b = np.cross(a, ref); b /= np.linalg.norm(b)
    c = np.cross(a, b);   c /= np.linalg.norm(c)
    return b, c


class PrismaticJoint3D:
    """3D prismatic (linear guide) joint — 5 constraints, 1 translational DOF.

    Parameters
    ----------
    body_i, body_j : RigidBody3D
    s_i_local      : (3,) reference point in body i frame
    s_j_local      : (3,) reference point in body j frame
    axis_i_local   : (3,) slide direction in body i frame (unit vector)
    """

    N_CONSTRAINTS = 5

    def __init__(
        self,
        body_i: RigidBody3D,
        body_j: RigidBody3D,
        s_i_local: np.ndarray,
        s_j_local: np.ndarray,
        axis_i_local: np.ndarray,
    ):
        self.bi = body_i
        self.bj = body_j
        self.s_i = np.asarray(s_i_local, dtype=float)
        self.s_j = np.asarray(s_j_local, dtype=float)

        axis = np.asarray(axis_i_local, dtype=float)
        self.a_i_local = axis / np.linalg.norm(axis)

        # Perpendicular vectors in body i frame (constant)
        b_w, c_w = _perp_vectors(body_i.R @ self.a_i_local)
        self.b_i_local = body_i.R.T @ b_w
        self.c_i_local = body_i.R.T @ c_w

        # Orientation lock: b_j_local is fixed in body j frame at construction
        self.b_j_local = body_j.R.T @ b_w

        self.row_start: int = -1

    def phi(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        r_i = np.array([bi.x, bi.y, bi.z])
        r_j = np.array([bj.x, bj.y, bj.z])

        a_w = Ri @ self.a_i_local
        b_w = Ri @ self.b_i_local
        c_w = Ri @ self.c_i_local
        d   = (r_j + Rj @ self.s_j) - (r_i + Ri @ self.s_i)

        b_j_w = Rj @ self.b_j_local

        phi = np.zeros(5)
        phi[0] = b_w @ d           # displacement ⊥ b
        phi[1] = c_w @ d           # displacement ⊥ c
        phi[2] = a_w @ b_j_w       # orientation: a_i ⊥ b_j
        phi[3] = b_w @ b_j_w - 1   # orientation: b_i || b_j  → b_iᵀ·b_j = 1
        # Note: phi[3] locks spin about slide axis
        phi[4] = c_w @ b_j_w       # orientation: c_i ⊥ b_j
        return phi

    def phi_q(self, n_dof: int) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        r_i = np.array([bi.x, bi.y, bi.z])
        r_j = np.array([bj.x, bj.y, bj.z])
        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j

        a_w   = Ri @ self.a_i_local
        b_w   = Ri @ self.b_i_local
        c_w   = Ri @ self.c_i_local
        b_j_w = Rj @ self.b_j_local
        d     = (r_j + s_j_w) - (r_i + s_i_w)

        J = np.zeros((5, n_dof))

        if not bi.is_ground:
            di = bi.dof_start
            # rows 0,1: bᵀd, cᵀd
            J[0, di:di+3]   = b_w                                    # ∂(bᵀd)/∂v_i = −b
            J[0, di+3:di+6] = np.cross(s_i_w, b_w) + np.cross(d, b_w)
            J[1, di:di+3]   = c_w
            J[1, di+3:di+6] = np.cross(s_i_w, c_w) + np.cross(d, c_w)
            # rows 2,3,4: orientation
            J[2, di+3:di+6] = np.cross(b_j_w, a_w)
            J[3, di+3:di+6] = np.cross(b_j_w, b_w)
            J[4, di+3:di+6] = np.cross(b_j_w, c_w)

        if not bj.is_ground:
            dj = bj.dof_start
            J[0, dj:dj+3]   = -b_w
            J[0, dj+3:dj+6] = -np.cross(s_j_w, b_w)
            J[1, dj:dj+3]   = -c_w
            J[1, dj+3:dj+6] = -np.cross(s_j_w, c_w)
            J[2, dj+3:dj+6] = np.cross(a_w, b_j_w)
            J[3, dj+3:dj+6] = np.cross(b_w, b_j_w)
            J[4, dj+3:dj+6] = np.cross(c_w, b_j_w)

        return J

    def gamma(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R
        oi = Ri @ bi.omega_body
        oj = Rj @ bj.omega_body
        vi = np.array([bi.vx, bi.vy, bi.vz])
        vj = np.array([bj.vx, bj.vy, bj.vz])

        a_w   = Ri @ self.a_i_local
        b_w   = Ri @ self.b_i_local
        c_w   = Ri @ self.c_i_local
        b_j_w = Rj @ self.b_j_local
        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        d     = (np.array([bj.x, bj.y, bj.z]) + s_j_w) - (np.array([bi.x, bi.y, bi.z]) + s_i_w)
        d_dot = (vj + np.cross(oj, s_j_w)) - (vi + np.cross(oi, s_i_w))
        b_dot = np.cross(oi, b_w)
        c_dot = np.cross(oi, c_w)
        a_dot = np.cross(oi, a_w)
        bj_dot = np.cross(oj, b_j_w)

        gamma = np.zeros(5)
        gamma[0] = -2.0 * (b_dot @ d_dot) - b_w @ (np.cross(oi, np.cross(oi, s_i_w)) - np.cross(oj, np.cross(oj, s_j_w)))
        gamma[1] = -2.0 * (c_dot @ d_dot) - c_w @ (np.cross(oi, np.cross(oi, s_i_w)) - np.cross(oj, np.cross(oj, s_j_w)))
        gamma[2] = -2.0 * (a_dot @ bj_dot)
        gamma[3] = -2.0 * (b_dot @ bj_dot)
        gamma[4] = -2.0 * (c_dot @ bj_dot)
        return gamma
