"""
universal3d.py — 3D Universal (Cardan / Hooke) joint constraint.

Connects body i to body j at a common point. Allows rotation about two
perpendicular axes (one fixed in each body). Prevents rotation about the
third axis (the cross-axis).

Constraint equations (4):
  Φ₁₋₃: position coincidence — r_i + R_i·s_i = r_j + R_j·s_j  (3 eqs)
  Φ₄:   orientation — a_iᵀ · b_j = 0  (1 eq)
         a_i = axis fixed in body i (e.g. x-axis)
         b_j = axis fixed in body j (e.g. y-axis)
         This prevents relative rotation about the cross-axis.

4 constraints → 2 rotational DOFs remaining (Cardan joint behaviour).
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody3D

N_CONSTRAINTS = 4


def _skew(v: np.ndarray) -> np.ndarray:
    return np.array([
        [ 0.0,  -v[2],  v[1]],
        [ v[2],  0.0,  -v[0]],
        [-v[1],  v[0],  0.0 ],
    ])


class UniversalJoint3D:
    """3D universal (Cardan) joint — 4 constraints, 2 rotational DOFs.

    Parameters
    ----------
    body_i, body_j : RigidBody3D
    s_i_local      : (3,) attachment point in body i frame
    s_j_local      : (3,) attachment point in body j frame
    axis_i_local   : (3,) joint axis fixed in body i (e.g. [1,0,0])
    axis_j_local   : (3,) joint axis fixed in body j, perpendicular to axis_i
                     (e.g. [0,1,0])
    """

    N_CONSTRAINTS = 4

    def __init__(
        self,
        body_i: RigidBody3D,
        body_j: RigidBody3D,
        s_i_local: np.ndarray,
        s_j_local: np.ndarray,
        axis_i_local: np.ndarray,
        axis_j_local: np.ndarray,
    ):
        self.bi = body_i
        self.bj = body_j
        self.s_i = np.asarray(s_i_local, dtype=float)
        self.s_j = np.asarray(s_j_local, dtype=float)

        ai = np.asarray(axis_i_local, dtype=float)
        aj = np.asarray(axis_j_local, dtype=float)
        self.a_i_local = ai / np.linalg.norm(ai)
        self.b_j_local = aj / np.linalg.norm(aj)

        self.row_start: int = -1

    def phi(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        r_i = np.array([bi.x, bi.y, bi.z])
        r_j = np.array([bj.x, bj.y, bj.z])
        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_j_w = Rj @ self.b_j_local

        phi = np.zeros(4)
        phi[0:3] = (r_i + s_i_w) - (r_j + s_j_w)
        phi[3]   = a_w @ b_j_w
        return phi

    def phi_q(self, n_dof: int) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_j_w = Rj @ self.b_j_local

        J = np.zeros((4, n_dof))

        if not bi.is_ground:
            di = bi.dof_start
            J[0:3, di:di+3]   =  np.eye(3)
            J[0:3, di+3:di+6] = -_skew(s_i_w)
            J[3,   di+3:di+6] =  np.cross(b_j_w, a_w)

        if not bj.is_ground:
            dj = bj.dof_start
            J[0:3, dj:dj+3]   = -np.eye(3)
            J[0:3, dj+3:dj+6] =  _skew(s_j_w)
            J[3,   dj+3:dj+6] =  np.cross(a_w, b_j_w)

        return J

    def gamma(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R
        oi = Ri @ bi.omega_body
        oj = Rj @ bj.omega_body
        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_j_w = Rj @ self.b_j_local

        a_dot  = np.cross(oi, a_w)
        bj_dot = np.cross(oj, b_j_w)

        gamma = np.zeros(4)
        gamma[0:3] = (np.cross(oi, np.cross(oi, s_i_w))
                    - np.cross(oj, np.cross(oj, s_j_w)))
        gamma[3] = -2.0 * (a_dot @ bj_dot)
        return gamma
