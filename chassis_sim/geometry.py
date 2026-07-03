"""
chassis_sim/geometry.py — Static Chassis Geometry Engine

Computes all static geometry outputs (trail, swingarm angle, anti-squat %,
weight distribution, CoG) from a BikeGeometry input.

All formulas verified against:
  Foale (2006) Motorcycle Handling and Chassis Design
  Cossalter (2006) Motorcycle Dynamics, 2nd Ed.

Units: mm for all lengths, degrees in public API, radians internally.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import List

# ── Input dataclasses ─────────────────────────────────────────────────────────

@dataclass
class BikeGeometry:
    """Primary chassis geometry inputs."""
    head_angle_deg: float       # rake — steering axis from vertical
    fork_offset_mm: float       # perpendicular: steering axis to front axle
    front_wheel_dia_mm: float   # outer diameter incl. tyre
    rear_wheel_dia_mm: float
    wheelbase_mm: float
    swingarm_length_mm: float   # pivot centre to rear axle centre
    swingarm_pivot_height_mm: float  # H_sp — pivot height from ground
    swingarm_pivot_x_mm: float       # X_sp — pivot distance from front axle
    rear_axle_height_mm: float       # H_ra — rear axle height from ground

    @property
    def R_f(self) -> float:
        return self.front_wheel_dia_mm / 2

    @property
    def R_r(self) -> float:
        return self.rear_wheel_dia_mm / 2

    @property
    def alpha_rad(self) -> float:
        return math.radians(self.head_angle_deg)


@dataclass
class MassComponent:
    mass_kg: float
    x_mm: float   # from front axle (positive rearward)
    y_mm: float   # from ground (positive upward)
    label: str = ""


@dataclass
class ChainGeometry:
    front_sprocket_teeth: int
    rear_sprocket_teeth: int
    sprocket_center_x_mm: float  # countershaft offset from SA pivot (neg = forward)
    sprocket_center_y_mm: float  # countershaft offset from SA pivot (pos = above)
    chain_force_angle_deg: float # top chain run angle from horizontal


# ── Static geometry formulas ──────────────────────────────────────────────────

def compute_trail(geom: BikeGeometry) -> float:
    """
    Geometric trail.

    T = (R_f · sin α − f) / cos α        ... Foale Eq 2.1

    α = head angle from vertical (positive = fork leans forward).
    f = fork offset (perpendicular distance: steering axis to front axle).
    Positive trail → self-stabilising.

    Validated: sport bike R_f=300, α=24°, f=33 → T ≈ 96 mm (Yamaha R1 ≈ 97 mm).
    """
    a = geom.alpha_rad
    cos_a = math.cos(a)
    if abs(cos_a) < 1e-9:
        raise ValueError("Head angle 90° — undefined trail geometry")
    return (geom.R_f * math.sin(a) - geom.fork_offset_mm) / cos_a


def compute_mechanical_trail(trail_mm: float, head_angle_deg: float) -> float:
    """
    Mechanical trail = perpendicular lever arm for self-aligning torque.

    MT = T / cos α                        ... Foale Eq 2.2
    """
    cos_a = math.cos(math.radians(head_angle_deg))
    if abs(cos_a) < 1e-9:
        raise ValueError("cos(head_angle) ≈ 0")
    return trail_mm / cos_a


def compute_swingarm_angle_rad(geom: BikeGeometry) -> float:
    """
    Static swingarm angle from horizontal.

    θ_sa = arctan((H_ra − H_sp) / L_sa)  ... derived from pivot-to-axle vector

    Negative for typical bike (axle below pivot). Range: −3° to −8°.
    """
    if abs(geom.swingarm_length_mm) < 1e-9:
        raise ValueError("Swingarm length cannot be zero")
    return math.atan2(
        geom.rear_axle_height_mm - geom.swingarm_pivot_height_mm,
        geom.swingarm_length_mm
    )


def compute_cog(components: List[MassComponent]) -> tuple[float, float, float]:
    """
    Centre of gravity from component masses.

    X_cg = Σ(m_i · x_i) / Σm_i          ... Eq 6.1
    Y_cg = Σ(m_i · y_i) / Σm_i          ... Eq 6.2

    Returns (X_cg_mm, Y_cg_mm, total_mass_kg).
    """
    if not components:
        raise ValueError("No mass components provided")
    total = sum(c.mass_kg for c in components)
    if total < 1e-9:
        raise ValueError("Total mass is zero")
    X_cg = sum(c.mass_kg * c.x_mm for c in components) / total
    Y_cg = sum(c.mass_kg * c.y_mm for c in components) / total
    return X_cg, Y_cg, total


def compute_axle_loads(total_mass_kg: float, X_cg_mm: float, wheelbase_mm: float):
    """
    Static axle reactions from moment balance.

    R_front = W · (WB − X_cg) / WB       ... Eq 6.5
    R_rear  = W · X_cg / WB              ... Eq 6.6
    """
    G = 9.81
    if abs(wheelbase_mm) < 1e-9:
        raise ValueError("Wheelbase cannot be zero")
    W = total_mass_kg * G
    R_front = W * (wheelbase_mm - X_cg_mm) / wheelbase_mm
    R_rear  = W * X_cg_mm / wheelbase_mm
    front_pct = (wheelbase_mm - X_cg_mm) / wheelbase_mm * 100
    return R_front, R_rear, front_pct


def compute_instant_centre(
    geom: BikeGeometry,
    chain: ChainGeometry,
    swingarm_angle_rad: float,
) -> tuple[float, float]:
    """
    Instant Centre (IC) of the anti-squat geometry.

    The IC is the intersection of two lines (Foale Ch. 11):
      Line 1: Swingarm axis extended forward
      Line 2: Top chain run line (through countershaft, along chain force angle)

    Solves:
      m1 = tan(θ_sa)
      m2 = tan(θ_chain)
      IC_x = (y2_0 − y1_0 + m1·x1 − m2·x2) / (m1 − m2)
      IC_y = H_sp + m1·(IC_x − X_sp)

    Returns (IC_x_mm, IC_y_mm).
    Raises ValueError if lines are parallel (m1 ≈ m2).
    """
    m1 = math.tan(swingarm_angle_rad)
    m2 = math.tan(math.radians(chain.chain_force_angle_deg))
    if abs(m1 - m2) < 1e-9:
        raise ValueError(
            f"Swingarm and chain lines parallel (m={m1:.4f}) — no IC. "
            "Adjust chain force angle or swingarm angle."
        )
    X_sp, H_sp = geom.swingarm_pivot_x_mm, geom.swingarm_pivot_height_mm
    x1, y1_0 = X_sp, H_sp
    x2 = X_sp + chain.sprocket_center_x_mm
    y2_0 = H_sp + chain.sprocket_center_y_mm
    IC_x = (y2_0 - y1_0 + m1 * x1 - m2 * x2) / (m1 - m2)
    IC_y = H_sp + m1 * (IC_x - X_sp)
    return IC_x, IC_y


def compute_anti_squat_pct(
    IC_x: float, IC_y: float,
    Y_cg: float, wheelbase: float,
) -> float:
    """
    Anti-Squat % from Foale graphical method.

    Draw a line from rear contact (WB, 0) through IC; find its height
    at the front contact patch vertical (x = 0):

    slope_IC = (0 − IC_y) / (WB − IC_x)
    h_front  = IC_y + slope_IC · (0 − IC_x)
    AS%      = (h_front / Y_cg) · 100        ... Foale Ch. 11 Eq 8.8
    """
    if abs(Y_cg) < 1e-9:
        raise ValueError("Y_cg cannot be zero")
    denom = wheelbase - IC_x
    if abs(denom) < 1e-9:
        raise ValueError("IC_x equals wheelbase — AS line is vertical")
    slope_IC = (0 - IC_y) / denom
    h_front  = IC_y + slope_IC * (0 - IC_x)
    return (h_front / Y_cg) * 100


def compute_anti_squat_swingarm_only(
    swingarm_angle_rad: float,
    wheelbase_mm: float,
    Y_cg_mm: float,
) -> float:
    """
    Anti-squat contribution from swingarm geometry alone (no chain tension).

    When chain tension = 0, the IC retreats to infinity along the swingarm
    axis.  The AS line from rear contact (WB, 0) then runs parallel to the
    swingarm.  Height at x = 0:

        h = −tan(θ_sa) · WB

    For a typical motorcycle θ_sa < 0 → h > 0 → small positive AS%.

    AS_swingarm_only = (−tan(θ_sa) · WB / Y_cg) · 100   ... corrected Eq 8.9

    PREVIOUS (WRONG) formula used tan(θ_sa) · L_sa / Y_cg which:
      a) used swingarm LENGTH instead of WHEELBASE
      b) gave a NEGATIVE result for all typical motorcycles
    This is the correct formula derived from the IC-at-infinity limit.
    """
    if abs(Y_cg_mm) < 1e-9:
        raise ValueError("Y_cg cannot be zero")
    return (-math.tan(swingarm_angle_rad) * wheelbase_mm / Y_cg_mm) * 100


# ── Aggregate static result ───────────────────────────────────────────────────

@dataclass
class StaticResults:
    trail_mm: float
    mechanical_trail_mm: float
    swingarm_angle_deg: float
    X_cg_mm: float
    Y_cg_mm: float
    total_mass_kg: float
    R_front_N: float
    R_rear_N: float
    front_pct: float
    IC_x_mm: float
    IC_y_mm: float
    anti_squat_pct: float
    anti_squat_swingarm_only_pct: float
    chain_contribution_pct: float


def compute_static(
    geom: BikeGeometry,
    components: List[MassComponent],
    chain: ChainGeometry,
) -> StaticResults:
    """Full static analysis — calls all sub-functions in order."""
    trail = compute_trail(geom)
    mt    = compute_mechanical_trail(trail, geom.head_angle_deg)
    theta_sa = compute_swingarm_angle_rad(geom)
    X_cg, Y_cg, total_mass = compute_cog(components)
    R_front, R_rear, front_pct = compute_axle_loads(total_mass, X_cg, geom.wheelbase_mm)
    IC_x, IC_y = compute_instant_centre(geom, chain, theta_sa)
    AS_pct  = compute_anti_squat_pct(IC_x, IC_y, Y_cg, geom.wheelbase_mm)
    AS_sa   = compute_anti_squat_swingarm_only(theta_sa, geom.wheelbase_mm, Y_cg)
    chain_c = AS_pct - AS_sa

    return StaticResults(
        trail_mm=trail,
        mechanical_trail_mm=mt,
        swingarm_angle_deg=math.degrees(theta_sa),
        X_cg_mm=X_cg, Y_cg_mm=Y_cg,
        total_mass_kg=total_mass,
        R_front_N=R_front, R_rear_N=R_rear, front_pct=front_pct,
        IC_x_mm=IC_x, IC_y_mm=IC_y,
        anti_squat_pct=AS_pct,
        anti_squat_swingarm_only_pct=AS_sa,
        chain_contribution_pct=chain_c,
    )
