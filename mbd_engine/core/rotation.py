"""
rotation.py — Quaternion utilities for 3D rigid body dynamics.

Convention: q = [w, x, y, z]  (scalar first)
- w = cos(θ/2), [x,y,z] = sin(θ/2)·n̂
- Always renormalize after integration to prevent drift.
- Angular velocity ω is expressed in the BODY frame throughout.

Key functions
-------------
normalize(q)           → unit quaternion
quat_multiply(p, q)    → Hamilton product p⊗q
to_R(q)                → 3×3 rotation matrix  (world = R @ body)
from_R(R)              → quaternion from rotation matrix (Shepperd)
kinematic_map(q)       → 4×3 matrix B(q) s.t. q̇ = ½·B(q)·ω_body
quat_derivative(q, w)  → q̇ given body-frame angular velocity ω
integrate_quat(q, w, h)→ q at t+h via first-order Euler + renorm
angular_velocity_body(q, q_dot) → ω_body = 2·B(q)^T·q̇
"""

from __future__ import annotations
import numpy as np


# ─── Basic operations ─────────────────────────────────────────────────────────

def normalize(q: np.ndarray) -> np.ndarray:
    """Return unit quaternion.  Raises if |q| ≈ 0."""
    n = np.linalg.norm(q)
    if n < 1e-14:
        raise ValueError(f"normalize: quaternion has near-zero norm ({n})")
    return q / n


def quat_multiply(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Hamilton product p ⊗ q.

    For composition: first apply q, then p  →  p⊗q.
    """
    pw, px, py, pz = p
    qw, qx, qy, qz = q
    return np.array([
        pw*qw - px*qx - py*qy - pz*qz,
        pw*qx + px*qw + py*qz - pz*qy,
        pw*qy - px*qz + py*qw + pz*qx,
        pw*qz + px*qy - py*qx + pz*qw,
    ], dtype=float)


def quat_conjugate(q: np.ndarray) -> np.ndarray:
    """q* = [w, -x, -y, -z]."""
    return np.array([q[0], -q[1], -q[2], -q[3]], dtype=float)


def rotate_vector(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rotate 3-vector v by quaternion q: v' = q ⊗ [0,v] ⊗ q*."""
    qv = np.array([0.0, v[0], v[1], v[2]])
    return quat_multiply(quat_multiply(q, qv), quat_conjugate(q))[1:]


# ─── Rotation matrix ──────────────────────────────────────────────────────────

def to_R(q: np.ndarray) -> np.ndarray:
    """3×3 rotation matrix from unit quaternion q = [w, x, y, z].

    R maps body-frame vectors to world-frame:  v_world = R @ v_body.

    R = (2w²-1)I + 2w[v]× + 2v⊗v^T   (Rodrigues form)
    """
    w, x, y, z = q
    return np.array([
        [1 - 2*(y*y + z*z),     2*(x*y - w*z),     2*(x*z + w*y)],
        [    2*(x*y + w*z), 1 - 2*(x*x + z*z),     2*(y*z - w*x)],
        [    2*(x*z - w*y),     2*(y*z + w*x), 1 - 2*(x*x + y*y)],
    ], dtype=float)


def from_R(R: np.ndarray) -> np.ndarray:
    """Quaternion from 3×3 rotation matrix — Shepperd's method.

    Numerically stable for all rotation angles.
    Returns q = [w, x, y, z] with w ≥ 0.
    """
    trace = R[0, 0] + R[1, 1] + R[2, 2]

    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (R[2, 1] - R[1, 2]) * s
        y = (R[0, 2] - R[2, 0]) * s
        z = (R[1, 0] - R[0, 1]) * s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2])
        w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s
        y = (R[0, 1] + R[1, 0]) / s
        z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2])
        w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s
        y = 0.25 * s
        z = (R[1, 2] + R[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1])
        w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s
        y = (R[1, 2] + R[2, 1]) / s
        z = 0.25 * s

    q = np.array([w, x, y, z], dtype=float)
    return normalize(q)


# ─── Kinematic map ────────────────────────────────────────────────────────────

def kinematic_map(q: np.ndarray) -> np.ndarray:
    """4×3 kinematic map B(q) such that  q̇ = ½ · B(q) · ω_body.

    Derivation:
        q̇ = ½ · q ⊗ [0, ω_body]
           = ½ · G(q) · ω_body     where G is the 4×3 map

    With q = [w, x, y, z]:
        B = ½ · [[-x, -y, -z],
                 [ w, -z,  y],
                 [ z,  w, -x],
                 [-y,  x,  w]]

    Note: B^T · B = I  (for unit q), so ω_body = 2·B^T · q̇.
    """
    w, x, y, z = q
    return np.array([
        [-x, -y, -z],
        [ w, -z,  y],
        [ z,  w, -x],
        [-y,  x,  w],
    ], dtype=float)


def quat_derivative(q: np.ndarray, omega_body: np.ndarray) -> np.ndarray:
    """q̇ = ½ · B(q) · ω_body.

    Parameters
    ----------
    q           : unit quaternion [w, x, y, z]
    omega_body  : angular velocity in body frame [ωx, ωy, ωz], rad/s

    Returns
    -------
    q_dot : (4,) quaternion time derivative
    """
    return 0.5 * kinematic_map(q) @ omega_body


def integrate_quat(q: np.ndarray, omega_body: np.ndarray, h: float) -> np.ndarray:
    """First-order Euler step on quaternion + renormalize.

    For RK4 integration use quat_derivative() directly in the RK4 stages
    and renormalize only at the end of the full step.

    Parameters
    ----------
    q           : current unit quaternion [w, x, y, z]
    omega_body  : body-frame angular velocity [ωx, ωy, ωz], rad/s
    h           : timestep, s

    Returns
    -------
    q_new : (4,) renormalized quaternion at t+h
    """
    q_new = q + h * quat_derivative(q, omega_body)
    return normalize(q_new)


def angular_velocity_body(q: np.ndarray, q_dot: np.ndarray) -> np.ndarray:
    """Recover body-frame angular velocity from q and q̇.

    ω_body = 2 · B(q)^T · q̇
    """
    return 2.0 * kinematic_map(q).T @ q_dot


# ─── Angle-axis convenience ───────────────────────────────────────────────────

def from_axis_angle(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    """Quaternion from rotation axis (unit vector) and angle."""
    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)
    return normalize(np.array([
        np.cos(angle_rad / 2),
        *(np.sin(angle_rad / 2) * axis),
    ]))


def identity() -> np.ndarray:
    """Identity quaternion [1, 0, 0, 0]."""
    return np.array([1.0, 0.0, 0.0, 0.0])
