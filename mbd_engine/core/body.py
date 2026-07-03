"""
Rigid body definitions for the 2D MBD solver.

State vector layout per body (3 DOF):
    q  = [x, y, theta]       positions (m, m, rad)
    qd = [vx, vy, omega]     velocities (m/s, m/s, rad/s)

Global state vectors are the concatenation of all bodies' states:
    Q  = [q_0 | q_1 | ... | q_{n-1}]   shape (3n,)
    QD = [qd_0 | qd_1 | ... ]           shape (3n,)
"""

from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np


@dataclass
class RigidBody2D:
    """A single 2-D rigid body.

    Parameters
    ----------
    name    : human-readable label
    mass    : kg
    inertia : moment of inertia about CoM, kg·m²
    x, y    : initial CoM position, m
    theta   : initial orientation, rad (CCW positive)
    vx, vy  : initial linear velocity, m/s
    omega   : initial angular velocity, rad/s (CCW positive)
    is_ground : if True the body is fixed; excluded from DOF vector
    """
    name:     str
    mass:     float
    inertia:  float          # I_zz, kg·m²
    x:        float = 0.0
    y:        float = 0.0
    theta:    float = 0.0
    vx:       float = 0.0
    vy:       float = 0.0
    omega:    float = 0.0
    is_ground: bool = False

    # Assigned by MultibodySystem2D after all bodies are added
    index: int = field(default=-1, repr=False)  # body index in body list
    dof_start: int = field(default=-1, repr=False)  # first DOF index in global Q

    # ── State accessors ─────────────────────────────────────────────────────

    def get_q(self) -> np.ndarray:
        """Position slice: [x, y, theta]."""
        return np.array([self.x, self.y, self.theta], dtype=float)

    def get_qd(self) -> np.ndarray:
        """Velocity slice: [vx, vy, omega]."""
        return np.array([self.vx, self.vy, self.omega], dtype=float)

    def set_q(self, q: np.ndarray) -> None:
        self.x, self.y, self.theta = float(q[0]), float(q[1]), float(q[2])

    def set_qd(self, qd: np.ndarray) -> None:
        self.vx, self.vy, self.omega = float(qd[0]), float(qd[1]), float(qd[2])

    # ── Physics helpers ─────────────────────────────────────────────────────

    def mass_matrix(self) -> np.ndarray:
        """3×3 body mass matrix: diag(m, m, I)."""
        return np.diag([self.mass, self.mass, self.inertia])

    def kinetic_energy(self) -> float:
        """T = ½·m·v² + ½·I·ω²"""
        return (0.5 * self.mass * (self.vx**2 + self.vy**2)
                + 0.5 * self.inertia * self.omega**2)

    def potential_energy(self, g: float = 9.81) -> float:
        """V = m·g·y  (gravity in −y direction)."""
        return self.mass * g * self.y

    # ── Attachment point helpers ────────────────────────────────────────────

    def global_point(self, local: np.ndarray) -> np.ndarray:
        """Transform a point from body-fixed frame to world frame.

        Parameters
        ----------
        local : [lx, ly] coordinates in body frame (from CoM)
        """
        c, s = np.cos(self.theta), np.sin(self.theta)
        R = np.array([[c, -s], [s, c]])
        return np.array([self.x, self.y]) + R @ local

    def global_point_velocity(self, local: np.ndarray) -> np.ndarray:
        """World-frame velocity of a body-fixed point.

        v_P = v_CoM + omega × r_P    (2D: omega × r = omega·[-ry, rx])
        """
        c, s = np.cos(self.theta), np.sin(self.theta)
        R = np.array([[c, -s], [s, c]])
        r = R @ local          # vector from CoM to point, world frame
        return np.array([self.vx, self.vy]) + self.omega * np.array([-r[1], r[0]])

    def __repr__(self) -> str:
        return (f"RigidBody2D('{self.name}', m={self.mass}kg, "
                f"I={self.inertia:.4f}kg·m², "
                f"pos=({self.x:.3f},{self.y:.3f}), θ={np.degrees(self.theta):.1f}°)")


# ══════════════════════════════════════════════════════════════════════════════
# 3D Rigid Body
# ══════════════════════════════════════════════════════════════════════════════

from .rotation import normalize, to_R  # noqa: E402


@dataclass
class RigidBody3D:
    """A single 3-D rigid body using quaternion orientation.

    State vector layout per body:
        q  = [x, y, z, qw, qx, qy, qz]    positions + orientation  (7,)
        qd = [vx, vy, vz, ωx, ωy, ωz]     linear vel + body-frame ω  (6,)

    The assembler uses a 6×6 velocity-space mass matrix per body.
    Quaternion kinematics are integrated separately via rotation.py.

    Inertia tensor I_body is expressed in the principal body frame.
    Pass a (3,) array for principal moments → auto-converted to diag 3×3.

    Parameters
    ----------
    name        : human-readable label
    mass        : kg
    I_body      : 3×3 or (3,) principal inertia tensor in body frame, kg·m²
    x, y, z     : initial CoM position, m
    qw,qx,qy,qz : initial orientation quaternion (default = identity)
    vx,vy,vz    : initial linear velocity, m/s
    wx,wy,wz    : initial body-frame angular velocity, rad/s
    is_ground   : if True the body is fixed; excluded from DOF vector
    """
    name:   str
    mass:   float
    I_body: np.ndarray          # 3×3 or (3,) principal moments, kg·m²

    x:  float = 0.0
    y:  float = 0.0
    z:  float = 0.0
    qw: float = 1.0
    qx: float = 0.0
    qy: float = 0.0
    qz: float = 0.0

    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    # wx, wy, wz are WORLD-FRAME angular velocity components.
    # (At t=0 with identity orientation, world frame = body frame.)
    wx: float = 0.0
    wy: float = 0.0
    wz: float = 0.0

    is_ground: bool = False

    # Assigned by MultibodySystem3D
    index:     int = field(default=-1, repr=False)
    dof_start: int = field(default=-1, repr=False)  # index into 13n global state

    def __post_init__(self) -> None:
        I = np.asarray(self.I_body, dtype=float)
        if I.ndim == 1:
            if I.shape != (3,):
                raise ValueError("I_body as 1-D array must have 3 elements.")
            self.I_body = np.diag(I)
        elif I.shape != (3, 3):
            raise ValueError("I_body must be 3×3 or (3,) principal moments.")
        else:
            self.I_body = I.copy()
        # Renormalise initial quaternion
        q = normalize(np.array([self.qw, self.qx, self.qy, self.qz], dtype=float))
        self.qw, self.qx, self.qy, self.qz = q

    # ── State accessors ──────────────────────────────────────────────────────

    def get_q(self) -> np.ndarray:
        """Position-orientation: [x, y, z, qw, qx, qy, qz]  (7,)."""
        return np.array([self.x, self.y, self.z,
                         self.qw, self.qx, self.qy, self.qz], dtype=float)

    def get_qd(self) -> np.ndarray:
        """Velocity: [vx, vy, vz, ωx_world, ωy_world, ωz_world]  (6,)."""
        return np.array([self.vx, self.vy, self.vz,
                         self.wx, self.wy, self.wz], dtype=float)

    def set_q(self, q: np.ndarray) -> None:
        """Unpack [x,y,z, qw,qx,qy,qz] and renormalise quaternion."""
        self.x, self.y, self.z = float(q[0]), float(q[1]), float(q[2])
        qn = normalize(q[3:7])
        self.qw, self.qx, self.qy, self.qz = qn

    def set_qd(self, qd: np.ndarray) -> None:
        """Unpack [vx,vy,vz, ωx_world,ωy_world,ωz_world]."""
        self.vx, self.vy, self.vz = float(qd[0]), float(qd[1]), float(qd[2])
        self.wx, self.wy, self.wz = float(qd[3]), float(qd[4]), float(qd[5])

    # ── Quaternion helpers ───────────────────────────────────────────────────

    @property
    def quat(self) -> np.ndarray:
        return np.array([self.qw, self.qx, self.qy, self.qz], dtype=float)

    @property
    def omega_world(self) -> np.ndarray:
        """World-frame angular velocity [ωx_w, ωy_w, ωz_w]."""
        return np.array([self.wx, self.wy, self.wz], dtype=float)

    @property
    def omega_body(self) -> np.ndarray:
        """Body-frame angular velocity: ω_body = Rᵀ · ω_world."""
        return self.R.T @ self.omega_world

    @property
    def R(self) -> np.ndarray:
        """3×3 rotation matrix: body → world."""
        return to_R(self.quat)

    # ── Mass matrix (velocity space, 6×6) ───────────────────────────────────

    def mass_matrix(self) -> np.ndarray:
        """6×6 velocity-space mass matrix: diag(m·I₃, I_body)."""
        M = np.zeros((6, 6))
        M[0, 0] = M[1, 1] = M[2, 2] = self.mass
        M[3:6, 3:6] = self.I_body
        return M

    # ── Gyroscopic term ──────────────────────────────────────────────────────

    def gyroscopic_torque(self) -> np.ndarray:
        """ω × (I·ω) — appears in Newton-Euler rotational equations.

        I·ω̇ = τ_ext − ω × I·ω
        """
        omega = self.omega_body
        return np.cross(omega, self.I_body @ omega)

    # ── Energy ───────────────────────────────────────────────────────────────

    def kinetic_energy(self) -> float:
        """T = ½·m·v² + ½·ωᵀ·I·ω"""
        v = np.array([self.vx, self.vy, self.vz])
        omega = self.omega_body
        return 0.5 * self.mass * float(v @ v) + 0.5 * float(omega @ self.I_body @ omega)

    def potential_energy(self, g: float = 9.81) -> float:
        """V = m·g·y"""
        return self.mass * g * self.y

    def angular_momentum_world(self) -> np.ndarray:
        """L = R · I_body · ω_body  (world frame)."""
        return self.R @ self.I_body @ self.omega_body

    # ── Attachment point helpers ─────────────────────────────────────────────

    def global_point(self, local: np.ndarray) -> np.ndarray:
        """Transform body-fixed point to world frame."""
        return np.array([self.x, self.y, self.z]) + self.R @ local

    def global_point_velocity(self, local: np.ndarray) -> np.ndarray:
        """World-frame velocity of body-fixed point P.

        v_P = v_CoM + ω_world × r_P_world
        """
        v_com = np.array([self.vx, self.vy, self.vz])
        omega_world = self.R @ self.omega_body
        r_world = self.R @ local
        return v_com + np.cross(omega_world, r_world)

    def __repr__(self) -> str:
        return (f"RigidBody3D('{self.name}', m={self.mass}kg, "
                f"pos=({self.x:.3f},{self.y:.3f},{self.z:.3f}), "
                f"q=[{self.qw:.3f},{self.qx:.3f},{self.qy:.3f},{self.qz:.3f}])")
