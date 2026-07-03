"""
revolute3d.py — 3D Revolute (hinge) joint constraint.

A revolute joint between body i and body j:
  - Connects point P_i (body i frame) to point P_j (body j frame) — 3 position eqs
  - Constrains relative rotation to a single axis: 2 orientation equations
  Total: 5 constraints, 1 DOF remaining (rotation about joint axis)

Constraint equations (Nikravesh 1988, Haug 1989):
  Φ₁₋₃ = r_i + R_i·s_i − r_j − R_j·s_j = 0    (position: 3 eqs)
  Φ₄   = aᵢᵀ·bⱼ = 0                             (axis ⊥ b_j: 1 eq)
  Φ₅   = aᵢᵀ·cⱼ = 0                             (axis ⊥ c_j: 1 eq)

where:
  a_i = R_i · a_i_local   — joint axis in world frame (from body i)
  b_j, c_j                — two vectors perpendicular to the joint axis (from body j)
                            constructed once from a reference perpendicular vector

The 5 Jacobian rows and γ (acceleration RHS) are assembled analytically.

Parameters
----------
body_i, body_j : RigidBody3D instances
s_i_local      : (3,) attachment point in body i frame
s_j_local      : (3,) attachment point in body j frame
axis_i_local   : (3,) joint rotation axis in body i frame (unit vector)
"""

from __future__ import annotations
import numpy as np
from ..body import RigidBody3D

# Number of constraints this joint imposes
N_CONSTRAINTS = 5


def _perp_vectors(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return two unit vectors perpendicular to unit vector a."""
    # Choose the axis least aligned to a to avoid degeneracy
    if abs(a[0]) <= abs(a[1]) and abs(a[0]) <= abs(a[2]):
        ref = np.array([1.0, 0.0, 0.0])
    elif abs(a[1]) <= abs(a[2]):
        ref = np.array([0.0, 1.0, 0.0])
    else:
        ref = np.array([0.0, 0.0, 1.0])
    b = np.cross(a, ref)
    b /= np.linalg.norm(b)
    c = np.cross(a, b)
    c /= np.linalg.norm(c)
    return b, c


def _skew(v: np.ndarray) -> np.ndarray:
    """3×3 skew-symmetric matrix of vector v: [v]× such that [v]×·u = v×u."""
    return np.array([
        [ 0.0,  -v[2],  v[1]],
        [ v[2],  0.0,  -v[0]],
        [-v[1],  v[0],  0.0 ],
    ])


class RevoluteJoint3D:
    """3D revolute (hinge) joint — 5 constraints, 1 rotational DOF.

    Usage
    -----
    joint = RevoluteJoint3D(body_i, body_j, s_i_local, s_j_local, axis_i_local)
    # assembler sets joint.row_start and joint.n_dof
    phi       = joint.phi()
    J         = joint.phi_q(n_dof)
    gamma_vec = joint.gamma()
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
        self.a_i_local = axis / np.linalg.norm(axis)   # unit axis in body i

        # Fixed perpendicular vectors in body j frame
        # Built once from the joint axis in body j frame at construction time
        # (assumes bodies are at initial configuration)
        a_world = body_i.R @ self.a_i_local
        b_w, c_w = _perp_vectors(a_world)
        self.b_j_local = body_j.R.T @ b_w   # body j frame
        self.c_j_local = body_j.R.T @ c_w

        # Assigned by assembler
        self.row_start: int = -1

    # ── Constraint residuals Φ ────────────────────────────────────────────────

    def phi(self) -> np.ndarray:
        """5 constraint equations evaluated at current body states."""
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        r_i = np.array([bi.x, bi.y, bi.z])
        r_j = np.array([bj.x, bj.y, bj.z])

        # World-frame vectors
        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_w   = Rj @ self.b_j_local
        c_w   = Rj @ self.c_j_local

        phi = np.zeros(5)
        phi[0:3] = (r_i + s_i_w) - (r_j + s_j_w)   # position: 3 eqs
        phi[3]   = a_w @ b_w                          # axis ⊥ b
        phi[4]   = a_w @ c_w                          # axis ⊥ c
        return phi

    # ── Jacobian ∂Φ/∂q ───────────────────────────────────────────────────────

    def phi_q(self, n_dof: int) -> np.ndarray:
        """5 × n_dof constraint Jacobian.

        DOF layout per body: [vx, vy, vz, ωx, ωy, ωz]  (6 per body)
        body.dof_start gives the starting column.
        """
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R

        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_w   = Rj @ self.b_j_local
        c_w   = Rj @ self.c_j_local

        J = np.zeros((5, n_dof))

        if bi.is_ground and bj.is_ground:
            return J

        # Position block rows 0–2
        # ∂Φ_pos/∂v_i =  I₃,   ∂Φ_pos/∂ω_i = −[s_i_w]×
        # ∂Φ_pos/∂v_j = −I₃,   ∂Φ_pos/∂ω_j =  [s_j_w]×

        if not bi.is_ground:
            di = bi.dof_start
            J[0:3, di:di+3]   =  np.eye(3)
            J[0:3, di+3:di+6] = -_skew(s_i_w)

        if not bj.is_ground:
            dj = bj.dof_start
            J[0:3, dj:dj+3]   = -np.eye(3)
            J[0:3, dj+3:dj+6] =  _skew(s_j_w)

        # Orientation rows 3–4: Φ₃ = aᵢᵀ·bⱼ,  Φ₄ = aᵢᵀ·cⱼ
        # ∂(aᵢᵀ·bⱼ)/∂ω_i = (bⱼ × aᵢ)ᵀ  = −(aᵢ × bⱼ)ᵀ
        # ∂(aᵢᵀ·bⱼ)/∂ω_j = (aᵢ × bⱼ)ᵀ   (via bⱼ = Rⱼ·b_local → ∂bⱼ/∂ω_j = [ω_j]×·bⱼ)
        # Using: ∂(uᵀv)/∂ω when v = R·v_local → ∂v/∂ω = [ω]×·v → partial = u × v

        if not bi.is_ground:
            di = bi.dof_start
            J[3, di+3:di+6] = np.cross(b_w, a_w)   # ∂(aᵢᵀbⱼ)/∂ω_i
            J[4, di+3:di+6] = np.cross(c_w, a_w)   # ∂(aᵢᵀcⱼ)/∂ω_i

        if not bj.is_ground:
            dj = bj.dof_start
            J[3, dj+3:dj+6] = np.cross(a_w, b_w)   # ∂(aᵢᵀbⱼ)/∂ω_j
            J[4, dj+3:dj+6] = np.cross(a_w, c_w)   # ∂(aᵢᵀcⱼ)/∂ω_j

        return J

    # ── Acceleration RHS γ ────────────────────────────────────────────────────

    def gamma(self) -> np.ndarray:
        """Acceleration-level RHS γ = −(J̇·q̇) for Baumgarte integration.

        For position constraints Φ = f(q):
            Φ̈ = J·q̈ + J̇·q̇ = 0  →  J·q̈ = −J̇·q̇ = γ

        Each term: γ_pos = ω_i × (ω_i × s_i_w) − ω_j × (ω_j × s_j_w)   [centripetal]
                   γ_ori = ... (cross-product acceleration terms)
        """
        bi, bj = self.bi, self.bj
        Ri, Rj = bi.R, bj.R
        oi = Ri @ bi.omega_body   # world-frame angular velocity of body i
        oj = Rj @ bj.omega_body

        s_i_w = Ri @ self.s_i
        s_j_w = Rj @ self.s_j
        a_w   = Ri @ self.a_i_local
        b_w   = Rj @ self.b_j_local
        c_w   = Rj @ self.c_j_local

        gamma = np.zeros(5)

        # Position γ: centripetal acceleration terms
        gamma[0:3] = (np.cross(oi, np.cross(oi, s_i_w))
                    - np.cross(oj, np.cross(oj, s_j_w)))

        # Orientation γ (Nikravesh Eq. 6.47):
        # γ_ab = −ȧᵢᵀ·ḃⱼ·2 − aᵢᵀ·(ȯⱼ×bⱼ) − (ȯᵢ×aᵢ)ᵀ·bⱼ
        # Simplified leading terms (quadratic velocity terms):
        a_dot = np.cross(oi, a_w)
        b_dot = np.cross(oj, b_w)
        c_dot = np.cross(oj, c_w)

        gamma[3] = -2.0 * (a_dot @ b_dot)
        gamma[4] = -2.0 * (a_dot @ c_dot)

        return gamma
