"""
spherical3d.py — 3D Spherical (ball-and-socket) joint constraint.

Connects point P_i (body i frame) to point P_j (body j frame).
No rotational constraints — free rotation in all directions.

Constraint equations (3):
  Φ = r_i + R_i·s_i − r_j − R_j·s_j = 0

3 constraints → 3 rotational DOFs remaining.
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody3D

N_CONSTRAINTS = 3


def _skew(v: np.ndarray) -> np.ndarray:
    return np.array([
        [ 0.0,  -v[2],  v[1]],
        [ v[2],  0.0,  -v[0]],
        [-v[1],  v[0],  0.0 ],
    ])


class SphericalJoint3D:
    """3D ball-and-socket joint — 3 constraints, 3 rotational DOFs.

    Parameters
    ----------
    body_i, body_j : RigidBody3D
    s_i_local      : (3,) attachment point in body i frame
    s_j_local      : (3,) attachment point in body j frame
    """

    N_CONSTRAINTS = 3

    def __init__(
        self,
        body_i: RigidBody3D,
        body_j: RigidBody3D,
        s_i_local: np.ndarray,
        s_j_local: np.ndarray,
    ):
        self.bi = body_i
        self.bj = body_j
        self.s_i = np.asarray(s_i_local, dtype=float)
        self.s_j = np.asarray(s_j_local, dtype=float)
        self.row_start: int = -1

    def phi(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        r_i = np.array([bi.x, bi.y, bi.z])
        r_j = np.array([bj.x, bj.y, bj.z])
        return (r_i + bi.R @ self.s_i) - (r_j + bj.R @ self.s_j)

    def phi_q(self, n_dof: int) -> np.ndarray:
        bi, bj = self.bi, self.bj
        s_i_w = bi.R @ self.s_i
        s_j_w = bj.R @ self.s_j

        J = np.zeros((3, n_dof))

        if not bi.is_ground:
            di = bi.dof_start
            J[0:3, di:di+3]   =  np.eye(3)
            J[0:3, di+3:di+6] = -_skew(s_i_w)

        if not bj.is_ground:
            dj = bj.dof_start
            J[0:3, dj:dj+3]   = -np.eye(3)
            J[0:3, dj+3:dj+6] =  _skew(s_j_w)

        return J

    def gamma(self) -> np.ndarray:
        bi, bj = self.bi, self.bj
        oi = bi.R @ bi.omega_body
        oj = bj.R @ bj.omega_body
        s_i_w = bi.R @ self.s_i
        s_j_w = bj.R @ self.s_j
        return (np.cross(oi, np.cross(oi, s_i_w))
              - np.cross(oj, np.cross(oj, s_j_w)))
