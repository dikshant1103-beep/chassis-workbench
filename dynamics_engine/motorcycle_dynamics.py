"""
motorcycle_dynamics.py — Fully Connected Motorcycle Dynamics Model
===================================================================
A DAG-based reactive parameter system for motorcycle chassis simulation.

Architecture:
  • Every physical quantity is a Parameter node with typed dependencies.
  • Changing any input parameter propagates through the DAG in topological order.
  • Coupled subsystems (mass positions ↔ wheelbase) are solved via fixed-point iteration.
  • Pure physics functions are module-level; they have no side effects.

References:
  Foale, T. (2006). Motorcycle Handling and Chassis Design, 2nd ed.
  Cossalter, V. (2002). Motorcycle Dynamics.
  SAE J1168 — Motorcycle Terminology.

Coordinate conventions (matches chassis-workbench TypeScript engine):
  X  : mm from front axle, rearward positive
  Y  : mm from ground, upward positive
  g  : 9.81 m/s²

Usage:
  model = MotorcycleDynamicsModel()
  model.set_input('swingarm_length', 600)
  report = model.report()
"""

from __future__ import annotations

import math
import warnings
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# ════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════════════════════════

G = 9.81          # m/s²  — SAE J1168
FUEL_DENSITY = 0.745  # kg/L — pump petrol


# ════════════════════════════════════════════════════════════════════════════
# PARAMETER NODE
# ════════════════════════════════════════════════════════════════════════════

class Parameter:
    """
    A single node in the motorcycle dynamics DAG.

    Fields
    ------
    name        : Unique string identifier.
    value       : Current numeric value.
    unit        : Display unit string (e.g. 'mm', 'kg', '%').
    description : Human-readable description.
    is_input    : True = user-settable leaf; False = computed derived node.
    formula     : Name of the governing equation (for documentation).
    compute_fn  : Callable that receives this model and returns a new value.
    deps        : Names of parameters this node depends on.
    _dirty      : Internal flag; set when any upstream value changes.
    """

    def __init__(
        self,
        name: str,
        value: float,
        unit: str = '',
        description: str = '',
        is_input: bool = True,
        formula: str = '',
        compute_fn: Optional[Callable] = None,
        deps: Optional[List[str]] = None,
    ):
        self.name = name
        self.value = value
        self.unit = unit
        self.description = description
        self.is_input = is_input
        self.formula = formula
        self.compute_fn = compute_fn
        self.deps: List[str] = deps or []
        self._dirty: bool = not is_input  # derived nodes start dirty

    def __repr__(self) -> str:
        return f"Parameter({self.name!r}, {self.value:.4g} {self.unit})"


# ════════════════════════════════════════════════════════════════════════════
# PURE PHYSICS FUNCTIONS
# ════════════════════════════════════════════════════════════════════════════

# ── G1: Geometry ─────────────────────────────────────────────────────────

def _wheelbase_from_swingarm(
    swingarm_pivot_x: float,    # mm from front axle
    swingarm_length: float,     # mm
    swingarm_pivot_height: float,  # mm
    rear_axle_height: float,    # mm
) -> float:
    """
    Wheelbase from swingarm geometry.

    WB = X_sp + sqrt(L_sa² - ΔY²)       [Foale Ch. 5]

    where ΔY = H_ra - H_sp (vertical drop/rise from pivot to axle).
    Returns NaN if the swingarm is too short to reach the axle height.
    """
    delta_y = rear_axle_height - swingarm_pivot_height
    radicand = swingarm_length ** 2 - delta_y ** 2
    if radicand < 0:
        warnings.warn(
            f"Swingarm length {swingarm_length:.1f}mm too short for "
            f"axle-pivot height difference {abs(delta_y):.1f}mm.",
            stacklevel=3,
        )
        return float('nan')
    return swingarm_pivot_x + math.sqrt(radicand)


def _swingarm_angle(
    rear_axle_height: float,
    swingarm_pivot_height: float,
    swingarm_length: float,
) -> float:
    """
    Swingarm angle from horizontal (degrees).

    θ_sa = arcsin((H_ra − H_sp) / L_sa)    [geometry.ts Eq 5.4 corrected]

    arcsin is correct because L_sa is the hypotenuse of the pivot-to-axle
    triangle. arctan(ΔY / L_sa) would be wrong (treats hypotenuse as adjacent).

    Sign convention (matches geometry.ts):
      Negative = rear axle lower than pivot (typical sport/supermoto: −1° to −5°)
      Positive = rear axle higher than pivot (rare, some off-road builds)
    """
    if abs(swingarm_length) < 1e-9:
        return 0.0
    delta_y = rear_axle_height - swingarm_pivot_height
    if abs(delta_y) > swingarm_length:
        return math.copysign(90.0, delta_y)
    return math.degrees(math.asin(delta_y / swingarm_length))


def _trail(
    front_wheel_radius: float,   # mm
    head_angle_deg: float,        # degrees from vertical (rake)
    fork_offset: float,           # mm
) -> float:
    """
    Geometric trail.

    Trail = (R_f × sin(α) − fork_offset) / cos(α)   [geometry.ts Eq 5.1]

    α = head angle from VERTICAL (standard motorcycle rake convention, 22–32°).
    Foale's derivation diagram uses α-from-horizontal, so the published formula
    appears as (R_f·cos/sin), but when α is from vertical the correct form uses
    sin/cos.  See geometry.ts NOTE ON EQ 5.1 for the derivation.

    Positive trail = self-centering.  Typical range: 80–120 mm.
    """
    alpha = math.radians(head_angle_deg)
    cos_a = math.cos(alpha)
    if abs(cos_a) < 1e-9:
        raise ValueError("Trail undefined: steering axis is horizontal.")
    return (front_wheel_radius * math.sin(alpha) - fork_offset) / cos_a


def _mechanical_trail(trail: float, head_angle_deg: float) -> float:
    """
    Mechanical trail — perpendicular distance from contact patch to steering axis.

    mt = trail / cos(α)     [geometry.ts Eq 5.2]

    Always larger than geometric trail. It is the effective self-aligning torque arm.
    """
    cos_a = math.cos(math.radians(head_angle_deg))
    if abs(cos_a) < 1e-9:
        return float('inf')
    return trail / cos_a


# ── G2: CoG ──────────────────────────────────────────────────────────────

def _weighted_centroid(
    masses: List[float],   # kg
    xs: List[float],       # mm from front axle
    ys: List[float],       # mm from ground
) -> Tuple[float, float]:
    """
    X_cg = Σ(m_i × x_i) / Σ m_i          [Foale Eq 6.1]
    Y_cg = Σ(m_i × y_i) / Σ m_i          [Foale Eq 6.2]
    """
    total = sum(masses)
    if total < 1e-9:
        raise ValueError("Total mass is zero — cannot compute centroid.")
    x_cg = sum(m * x for m, x in zip(masses, xs)) / total
    y_cg = sum(m * y for m, y in zip(masses, ys)) / total
    return x_cg, y_cg


def _static_axle_loads(
    total_mass: float,   # kg
    x_cg: float,         # mm from front axle
    wheelbase: float,    # mm
) -> Tuple[float, float, float, float]:
    """
    Static axle reactions on a level surface.

    R_front = W × (WB − X_cg) / WB      [Foale Eq 6.5]
    R_rear  = W × X_cg / WB             [Foale Eq 6.6]
    Front%  = (WB − X_cg) / WB × 100   [Foale Eq 6.7]

    Returns: (R_front_N, R_rear_N, front_pct, rear_pct)
    """
    if abs(wheelbase) < 1e-9:
        raise ValueError("Wheelbase cannot be zero.")
    W = total_mass * G
    r_front = W * (wheelbase - x_cg) / wheelbase
    r_rear = W * x_cg / wheelbase
    front_pct = (wheelbase - x_cg) / wheelbase * 100.0
    return r_front, r_rear, front_pct, 100.0 - front_pct


# ── G3: Anti-Squat Instantaneous Centre ──────────────────────────────────

def _chain_force_angle(
    rear_sprocket_radius: float,    # mm  (r_rear)
    drive_sprocket_radius: float,   # mm  (r_drive)
    csp_x: float,                   # mm  countershaft X from front axle
    csp_height: float,              # mm  countershaft height from ground
    rear_axle_x: float,             # mm  = wheelbase
    rear_axle_height: float,        # mm
) -> float:
    """
    Chain force angle of the TOP (tension) run — Foale external-tangent method.

    θ_geom = atan2(H_cs − H_ra, X_cs − WB)   [direction from RA toward CS]
    α      = arcsin((r_rear − r_drive) / D)   [external tangent offset]
    θ_force (DS→RA direction) = θ_geom + α − 180°    [antiSquat.ts sign convention]

    Returns degrees. Typically small negative for sport bikes (top run nearly flat,
    slightly downward going rearward).

    Reference: antiSquat.ts computeChainForceAngle()
    """
    dx = csp_x - rear_axle_x    # negative (CS is forward of RA)
    dy = csp_height - rear_axle_height

    D = math.sqrt(dx * dx + dy * dy)
    if D < 1e-6:
        return 0.0

    theta_geom = math.atan2(dy, dx)  # direction from RA toward CS (~170° for typical bike)

    sin_alpha = (rear_sprocket_radius - drive_sprocket_radius) / D
    sin_alpha = max(-1.0, min(1.0, sin_alpha))
    alpha = math.asin(sin_alpha)

    theta_force_rad = theta_geom + alpha
    result_deg = math.degrees(theta_force_rad) - 180.0   # convert to DS→RA direction

    # Normalize to (−180°, +180°] so tan() works correctly and display is readable
    while result_deg > 180.0:
        result_deg -= 360.0
    while result_deg <= -180.0:
        result_deg += 360.0
    return result_deg


def _anti_squat_IC(
    swingarm_pivot_x: float,
    swingarm_pivot_height: float,
    swingarm_angle_deg: float,
    chain_force_angle_deg: float,
    csp_delta_x: float,   # countershaft sprocket X offset from pivot (mm, negative = forward)
    csp_delta_y: float,   # countershaft sprocket Y offset from pivot (mm, negative = below)
    r_drive: float = 0.0, # drive sprocket pitch radius (mm) — used for tangent contact point
) -> Tuple[float, float]:
    """
    Instantaneous Centre (IC) — Foale slope-form intersection.

    Matches computeAntiSquatUnified() in antiSquat.ts exactly:
      Line 1 (swingarm axis): y-intercept b1 = H_sp − m1·X_sp
      Line 2 (chain force):   passes through the upper tangent contact point
                              on the drive sprocket (NOT the sprocket center),
                              so b2 = H_tan − m2·X_tan
      IC_x = (b2 − b1) / (m1 − m2)
      IC_y = m1·IC_x + b1

    Using the tangent contact point (as in the TS engine) is correct because
    the chain force LINE OF ACTION leaves the drive sprocket at the tangent
    point, not at the center.  Using the center shifts the IC ~170 mm and
    inflates AS% by ~100 pp for a typical sport-bike geometry.

    r_drive = 0 falls back to the (less accurate) countershaft-center method
    for callers that don't have the radius available.
    """
    m1 = math.tan(math.radians(swingarm_angle_deg))
    m2 = math.tan(math.radians(chain_force_angle_deg))

    if abs(m1 - m2) < 1e-9:
        # Lines parallel — IC at infinity → ~100% AS or indeterminate
        return (swingarm_pivot_x - 10000.0, swingarm_pivot_height)

    # Absolute countershaft center position
    csp_x = swingarm_pivot_x + csp_delta_x
    csp_h = swingarm_pivot_height + csp_delta_y

    # Upper tangent contact point on drive sprocket (matches TS antiSquat.ts)
    # perp direction = 90° CCW from chain-force direction (into chain interior)
    theta_force = math.radians(chain_force_angle_deg + 180.0)
    perp_x = -math.sin(theta_force)
    perp_y =  math.cos(theta_force)
    x_tan = csp_x - r_drive * perp_x
    h_tan = csp_h - r_drive * perp_y

    # y-intercept form (same as TS: b = H − m·X, IC_x = (b2−b1)/(m1−m2))
    b1 = swingarm_pivot_height - m1 * swingarm_pivot_x
    b2 = h_tan - m2 * x_tan

    ic_x = (b2 - b1) / (m1 - m2)
    ic_y = m1 * ic_x + b1

    return ic_x, ic_y


def _anti_squat_percent(
    ic_x: float,
    ic_y: float,
    y_cg: float,
    wheelbase: float,
) -> float:
    """
    Anti-squat percentage (Foale graphical method).

    Draw a line from the rear contact patch (WB, 0) through the IC.
    Extend to the FRONT contact patch vertical (x = 0).
    AS% = height at x=0 / Y_cg × 100.

    slope_IC = (0 − IC_y) / (WB − IC_x)         [antiSquat.ts Eq 8.6]
    h_front  = IC_y + slope_IC × (0 − IC_x)     [antiSquat.ts Eq 8.7]
    AS%      = h_front / Y_cg × 100             [antiSquat.ts Eq 8.8]

    100%: chain/suspension forces exactly cancel weight transfer (neutral).
    >100%: rear rises under power (over-anti-squat / "jacking").
    <100%: rear squats (under-anti-squat).
    """
    if abs(y_cg) < 1e-9:
        return 0.0

    denom = wheelbase - ic_x
    if abs(denom) < 1e-9:
        return 0.0  # IC at rear axle → line is vertical, AS% undefined

    slope_ic = (0.0 - ic_y) / denom                  # Eq 8.6
    h_at_front = ic_y + slope_ic * (0.0 - ic_x)      # Eq 8.7
    return (h_at_front / y_cg) * 100.0               # Eq 8.8


# ── G4: Load Transfer ─────────────────────────────────────────────────────

def _longitudinal_load_transfer(
    total_mass: float,   # kg
    accel_g: float,      # g units (1.0 = 1g)
    y_cg: float,         # mm
    wheelbase: float,    # mm
) -> float:
    """
    Longitudinal load transfer (Foale Eq 10.1).

    ΔW = M × a_g × g × h_cg / WB_m   [N]

    Positive = weight shifts to rear under acceleration.
    """
    h_m = y_cg / 1000.0
    wb_m = wheelbase / 1000.0
    return total_mass * accel_g * G * h_m / wb_m


def _wheelie_threshold(
    r_front_static: float,   # N
    total_mass: float,       # kg
    wheelbase: float,        # mm
    y_cg: float,             # mm
) -> float:
    """
    Acceleration at which front wheel lifts (Foale Eq 10.6).

    a_wheelie = R_front_static / (M × g) × WB / h_cg   [g units]
    """
    h_m = y_cg / 1000.0
    wb_m = wheelbase / 1000.0
    if h_m < 1e-9:
        return float('inf')
    return (r_front_static / (total_mass * G)) * (wb_m / h_m)


def _stoppie_threshold(
    r_rear_static: float,    # N
    total_mass: float,       # kg
    wheelbase: float,        # mm
    y_cg: float,             # mm
) -> float:
    """
    Deceleration at which rear wheel lifts (Foale Eq 10.7).

    a_stoppie = R_rear_static / (M × g) × WB / h_cg   [g units]
    """
    h_m = y_cg / 1000.0
    wb_m = wheelbase / 1000.0
    if h_m < 1e-9:
        return float('inf')
    return (r_rear_static / (total_mass * G)) * (wb_m / h_m)


# ── G5: Suspension Travel ─────────────────────────────────────────────────

def _rear_squat_mm(
    anti_squat_pct: float,     # %
    load_transfer_N: float,    # N under acceleration
    rear_wheel_rate: float,    # N/mm
) -> float:
    """
    Rear suspension squat during acceleration.

    squat = (1 − AS%/100) × ΔW / k_wheel_rear   [mm]

    AS% = 100 → zero squat.  AS% = 0 → full squat = ΔW / k.
    """
    if rear_wheel_rate < 1e-9:
        return 0.0
    return (1.0 - anti_squat_pct / 100.0) * load_transfer_N / rear_wheel_rate


def _fork_dive_mm(
    anti_dive_pct: float,      # %
    load_transfer_N: float,    # N under braking
    front_wheel_rate: float,   # N/mm
) -> float:
    """
    Fork dive during braking.

    dive = (1 − AD%/100) × ΔW / k_wheel_front   [mm]
    """
    if front_wheel_rate < 1e-9:
        return 0.0
    return (1.0 - anti_dive_pct / 100.0) * load_transfer_N / front_wheel_rate


# ── G6: Cornering ─────────────────────────────────────────────────────────

def _lean_angle_deg(lateral_accel_g: float) -> float:
    """
    Steady-state lean angle from lateral acceleration.

    φ = arctan(a_lat)   [degrees from vertical]

    At 1g lateral: φ ≈ 45°.  At 0.8g: φ ≈ 38.7°.
    """
    return math.degrees(math.atan(lateral_accel_g))


def _lateral_load_transfer(
    total_mass: float,         # kg
    lateral_accel_g: float,    # g
    y_cg: float,               # mm
    lean_angle_deg: float,     # degrees
    track_width: float,        # mm (tyre contact patch separation)
) -> float:
    """
    Lateral load transfer in a corner (Cossalter §5.3).

    h_eff = h_cg × cos(φ)
    ΔW_lat = M × a_lat × g × h_eff / track   [N]
    """
    h_m = y_cg / 1000.0
    track_m = track_width / 1000.0
    cos_phi = math.cos(math.radians(lean_angle_deg))
    h_eff = h_m * cos_phi
    return total_mass * lateral_accel_g * G * h_eff / track_m


def _turning_radius(
    speed_kmh: float,          # km/h
    lateral_accel_g: float,    # g
) -> float:
    """
    Turning radius at constant speed and lateral acceleration.

    R = v² / (a_lat × g)   [m]

    v in m/s.
    """
    v = speed_kmh / 3.6
    a = lateral_accel_g * G
    if a < 1e-9:
        return float('inf')
    return v * v / a


# ── G7: Inertia ───────────────────────────────────────────────────────────

def _yaw_inertia_approx(
    total_mass: float,   # kg
    wheelbase: float,    # mm
    x_cg: float,         # mm
) -> float:
    """
    Approximate yaw moment of inertia (two-point-mass model).

    I_yaw ≈ m_f × l_f² + m_r × l_r²

    where l_f = X_cg (front lever arm), l_r = WB - X_cg (rear lever arm).
    Distributed evenly for a rough estimate.
    """
    l_f = x_cg / 1000.0           # m
    l_r = (wheelbase - x_cg) / 1000.0   # m
    m_each = total_mass / 2.0
    return m_each * (l_f ** 2 + l_r ** 2)   # kg·m²


def _pitch_inertia_approx(
    total_mass: float,   # kg
    y_cg: float,         # mm
    wheelbase: float,    # mm
) -> float:
    """
    Approximate pitch moment of inertia.

    I_pitch ≈ M × (Y_cg² + (WB/2)²) / 12   [ellipsoid approximation]
    """
    a = wheelbase / 2000.0   # semi-axis along X (m)
    b = y_cg / 1000.0        # semi-axis along Y (m)
    return total_mass * (a ** 2 + b ** 2) / 5.0   # kg·m²  (solid ellipsoid = 1/5)


# ── G8: Handling Indices ──────────────────────────────────────────────────

def _stability_index(trail: float, wheelbase: float) -> float:
    """
    Empirical stability index.

    SI = trail × WB / 1000   (dimensionless, higher = more stable)
    """
    return trail * wheelbase / 1_000_000.0


def _agility_index(I_yaw: float, total_mass: float, wheelbase: float) -> float:
    """
    Normalised yaw inertia (lower = more agile).

    AI = I_yaw / (M × WB²)
    """
    wb_m = wheelbase / 1000.0
    denom = total_mass * wb_m ** 2
    if denom < 1e-9:
        return float('nan')
    return I_yaw / denom


def _wobble_sensitivity(trail: float, wheelbase: float) -> float:
    """
    High-speed wobble sensitivity proxy (Cossalter §8.4).

    WS = 1 / (trail × WB)   [lower = more prone to wobble]
    """
    if abs(trail * wheelbase) < 1e-9:
        return float('nan')
    return 1_000_000.0 / (trail * wheelbase)


def _pitch_sensitivity(x_cg: float, wheelbase: float) -> float:
    """
    Sensitivity of front weight distribution to wheelbase change.

    d(front%) / d(WB) = X_cg / WB² × 100   [%/mm]
    """
    if abs(wheelbase) < 1e-9:
        return 0.0
    return x_cg / (wheelbase ** 2) * 100.0


# ════════════════════════════════════════════════════════════════════════════
# MASS COMPONENT DATA CLASS
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class MassComponent:
    """A single mass point on the motorcycle."""
    name: str
    mass: float       # kg
    x: float          # mm from front axle
    y: float          # mm from ground

    def scale_x(self, ratio: float) -> 'MassComponent':
        return MassComponent(self.name, self.mass, self.x * ratio, self.y)

    def shift_y(self, delta: float) -> 'MassComponent':
        return MassComponent(self.name, self.mass, self.x, max(self.y + delta, 0.0))


# ════════════════════════════════════════════════════════════════════════════
# MOTORCYCLE DYNAMICS MODEL
# ════════════════════════════════════════════════════════════════════════════

class MotorcycleDynamicsModel:
    """
    Fully connected motorcycle dynamics model.

    Inputs (set via set_input):
      Geometry:    swingarm_length, swingarm_pivot_x, swingarm_pivot_height,
                   rear_wheel_diameter, front_wheel_diameter,
                   head_angle_deg, fork_offset
      Chain:       drive_sprocket_teeth, rear_sprocket_teeth,
                   drive_sprocket_radius, rear_sprocket_radius
      Suspension:  front_spring_rate, rear_spring_rate,
                   front_motion_ratio, rear_motion_ratio,
                   anti_dive_pct
      Scenario:    accel_g, brake_g, lateral_accel_g, speed_kmh, track_width_mm

    Derived (auto-computed on every set_input call):
      Geometry:    wheelbase, rear_axle_height, front_axle_height,
                   swingarm_angle, trail, mechanical_trail
      CoG:         x_cg, y_cg, total_mass
      Axle loads:  r_front, r_rear, front_pct, rear_pct
      Anti-squat:  chain_force_angle, IC_x, IC_y, anti_squat_pct
      Dynamics:    load_transfer_accel, load_transfer_brake,
                   rear_squat_mm, fork_dive_mm
      Cornering:   lean_angle_deg, lateral_load_transfer, turning_radius
      Stability:   wheelie_threshold_g, stoppie_threshold_g
      Inertia:     I_yaw, I_pitch
      Handling:    stability_index, agility_index, wobble_sensitivity,
                   pitch_sensitivity

    Propagation
    -----------
    1. Build adjacency list and topological sort order (done once at init).
    2. On set_input, mark the changed leaf dirty and propagate forward in topo order.
    3. Coupled subsystem (mass positions ↔ wheelbase) uses fixed-point iteration
       inside _solve_coupled_geometry().
    """

    # ── Construction ─────────────────────────────────────────────────────

    def __init__(self, preset: str = 'sport'):
        self._params: Dict[str, Parameter] = {}
        self._mass_components: List[MassComponent] = []
        self._topo_order: List[str] = []

        self._define_parameters()
        self._build_topo_order()
        self._load_preset(preset)
        self.recompute()

    # ── Parameter Definitions ─────────────────────────────────────────────

    def _define_parameters(self) -> None:
        """Register all parameters with their dependency edges."""

        def p(name: str, value: float, unit: str = '', desc: str = '',
              is_input: bool = True, formula: str = '', deps: Optional[List[str]] = None):
            self._params[name] = Parameter(
                name, value, unit, desc, is_input, formula, deps=deps)

        def d(name: str, value: float, unit: str = '', desc: str = '',
              formula: str = '', deps: Optional[List[str]] = None,
              compute_fn: Optional[Callable] = None):
            """Register a derived parameter."""
            param = Parameter(
                name, value, unit, desc, is_input=False, formula=formula, deps=deps or [])
            param.compute_fn = compute_fn
            self._params[name] = param

        # ── INPUT PARAMETERS ─────────────────────────────────────────

        # Geometry
        p('swingarm_length',       580.0, 'mm',   'Length of swingarm arm')
        p('swingarm_pivot_x',      680.0, 'mm',   'Swingarm pivot X from front axle')
        p('swingarm_pivot_height', 340.0, 'mm',   'Swingarm pivot height from ground')
        p('rear_wheel_diameter',   640.0, 'mm',   'Rear wheel outer diameter')
        p('front_wheel_diameter',  640.0, 'mm',   'Front wheel outer diameter')
        p('head_angle_deg',         24.0, '°',    'Head tube angle from vertical (rake)')
        p('fork_offset',            30.0, 'mm',   'Fork offset (perpendicular to steering axis)')

        # Chain / drivetrain
        p('drive_sprocket_teeth',   15,   'T',    'Front sprocket teeth count')
        p('rear_sprocket_teeth',    42,   'T',    'Rear sprocket teeth count')
        p('drive_sprocket_radius',  30.0, 'mm',   'Drive (countershaft) sprocket pitch radius')
        p('rear_sprocket_radius',   85.0, 'mm',   'Rear sprocket pitch radius')
        # Countershaft sprocket position (drives AS% IC construction)
        p('countershaft_x',        680.0, 'mm',   'Countershaft X from front axle (≈ swingarm pivot X)')
        p('countershaft_height',   260.0, 'mm',   'Countershaft height from ground')

        # Suspension
        p('front_spring_rate',       8.0, 'N/mm', 'Front fork spring rate')
        p('rear_spring_rate',       10.0, 'N/mm', 'Rear shock spring rate')
        p('front_motion_ratio',      1.0, '',     'Front motion ratio (wheel/spring)')
        p('rear_motion_ratio',       0.6, '',     'Rear motion ratio (wheel/spring)')
        p('anti_dive_pct',          30.0, '%',    'Anti-dive percentage (0–100%)')

        # Scenario / operating conditions
        p('accel_g',                 1.0, 'g',    'Acceleration scenario (g units)')
        p('brake_g',                 1.0, 'g',    'Braking scenario (g units)')
        p('lateral_accel_g',         0.8, 'g',    'Lateral acceleration in corner')
        p('speed_kmh',             100.0, 'km/h', 'Vehicle speed for turning radius')
        p('track_width_mm',        1400.0,'mm',   'Tyre contact patch lateral separation')

        # ── DERIVED PARAMETERS ────────────────────────────────────────
        #  (values are initialised to 0; compute_fn fills them in)

        # G1: Geometry derived
        d('rear_axle_height',      320.0, 'mm',   'Rear axle centre height',
          formula='H_ra = D_rear / 2',
          deps=['rear_wheel_diameter'])

        d('front_axle_height',     320.0, 'mm',   'Front axle centre height',
          formula='H_fa = D_front / 2',
          deps=['front_wheel_diameter'])

        d('wheelbase',            1400.0, 'mm',   'Front-to-rear axle distance',
          formula='WB = X_sp + sqrt(L_sa² - ΔY²)',
          deps=['swingarm_pivot_x', 'swingarm_length',
                'swingarm_pivot_height', 'rear_axle_height'])

        d('swingarm_angle',          3.0, '°',    'Swingarm angle from horizontal',
          formula='θ = arcsin((H_ra - H_sp) / L_sa)',
          deps=['rear_axle_height', 'swingarm_pivot_height'])

        d('trail',                  95.0, 'mm',   'Mechanical trail',
          formula='T = (R_f·cos(ε) - fo) / sin(ε)',
          deps=['front_axle_height', 'head_angle_deg', 'fork_offset'])

        d('mechanical_trail',       40.0, 'mm',   'Mechanical trail ⊥ to steering axis — effective SAT arm',
          formula='mt = trail / cos(α)',
          deps=['trail', 'head_angle_deg'])

        # G2: CoG derived
        d('x_cg',                  700.0, 'mm',   'CoG X from front axle',
          formula='X_cg = Σ(m_i × x_i) / Σm_i',
          deps=['__mass_components__'])

        d('y_cg',                  620.0, 'mm',   'CoG Y from ground',
          formula='Y_cg = Σ(m_i × y_i) / Σm_i',
          deps=['__mass_components__'])

        d('total_mass',            200.0, 'kg',   'Total system mass',
          formula='M = Σm_i',
          deps=['__mass_components__'])

        # G3: Axle loads
        d('r_front',               981.0, 'N',    'Front axle static reaction',
          formula='R_f = W × (WB - X_cg) / WB',
          deps=['total_mass', 'x_cg', 'wheelbase'])

        d('r_rear',                981.0, 'N',    'Rear axle static reaction',
          formula='R_r = W × X_cg / WB',
          deps=['total_mass', 'x_cg', 'wheelbase'])

        d('front_pct',              50.0, '%',    'Front weight distribution',
          formula='F% = (WB - X_cg) / WB × 100',
          deps=['x_cg', 'wheelbase'])

        d('rear_pct',               50.0, '%',    'Rear weight distribution',
          formula='R% = X_cg / WB × 100',
          deps=['x_cg', 'wheelbase'])

        # G4: Anti-squat chain geometry
        d('chain_force_angle',      -3.0, '°',    'Chain tension run angle (DS→RA, typically negative)',
          formula='θ_c = atan2(H_cs-H_ra, X_cs-WB) + arcsin((r_r-r_d)/D) − 180°',
          deps=['rear_sprocket_radius', 'drive_sprocket_radius',
                'countershaft_x', 'countershaft_height',
                'wheelbase', 'rear_axle_height'])

        d('IC_x',                  400.0, 'mm',   'Anti-squat IC x from front axle',
          formula='IC_x = (y2−y1 + m1×x1 − m2×x2)/(m1−m2)',
          deps=['swingarm_pivot_x', 'swingarm_pivot_height',
                'swingarm_angle', 'chain_force_angle',
                'countershaft_x', 'countershaft_height'])

        d('IC_y',                  300.0, 'mm',   'Anti-squat IC height from ground',
          formula='IC_y = H_sp + m1×(IC_x − X_sp)',
          deps=['IC_x', 'swingarm_pivot_x', 'swingarm_pivot_height', 'swingarm_angle'])

        d('anti_squat_pct',         90.0, '%',    'Anti-squat percentage (Foale Eq 8.8)',
          formula='AS% = h_at_front_vertical / Y_cg × 100',
          deps=['IC_x', 'IC_y', 'y_cg', 'wheelbase'])

        # G5: Wheel rates
        d('front_wheel_rate',        8.0, 'N/mm', 'Effective wheel rate — front',
          formula='k_w = k_s × MR²',
          deps=['front_spring_rate', 'front_motion_ratio'])

        d('rear_wheel_rate',         3.6, 'N/mm', 'Effective wheel rate — rear',
          formula='k_w = k_s × MR²',
          deps=['rear_spring_rate', 'rear_motion_ratio'])

        # G6: Longitudinal dynamics
        d('load_transfer_accel',   500.0, 'N',    'Longitudinal load transfer — accel',
          formula='ΔW = M × a_g × g × h_cg / WB',
          deps=['total_mass', 'accel_g', 'y_cg', 'wheelbase'])

        d('load_transfer_brake',   500.0, 'N',    'Longitudinal load transfer — brake',
          formula='ΔW = M × a_g × g × h_cg / WB',
          deps=['total_mass', 'brake_g', 'y_cg', 'wheelbase'])

        d('rear_squat_mm',           8.0, 'mm',   'Rear suspension squat under accel',
          formula='squat = (1 − AS%/100) × ΔW / k_rear',
          deps=['anti_squat_pct', 'load_transfer_accel', 'rear_wheel_rate'])

        d('fork_dive_mm',            6.0, 'mm',   'Fork dive under braking',
          formula='dive = (1 − AD%/100) × ΔW / k_front',
          deps=['anti_dive_pct', 'load_transfer_brake', 'front_wheel_rate'])

        # G7: Stability thresholds
        d('wheelie_threshold_g',    1.1, 'g',    'Acceleration to wheelie limit',
          formula='a_w = R_front / (Mg) × WB / h_cg',
          deps=['r_front', 'total_mass', 'wheelbase', 'y_cg'])

        d('stoppie_threshold_g',    1.2, 'g',    'Deceleration to stoppie limit',
          formula='a_s = R_rear / (Mg) × WB / h_cg',
          deps=['r_rear', 'total_mass', 'wheelbase', 'y_cg'])

        # G8: Cornering
        d('lean_angle_deg',         38.7, '°',   'Steady-state lean angle',
          formula='φ = arctan(a_lat)',
          deps=['lateral_accel_g'])

        d('lateral_load_transfer',  300.0, 'N',  'Lateral load transfer in corner',
          formula='ΔW_lat = M × a_lat × g × h_eff / track',
          deps=['total_mass', 'lateral_accel_g', 'y_cg',
                'lean_angle_deg', 'track_width_mm'])

        d('turning_radius',          35.0, 'm',  'Corner turning radius',
          formula='R = v² / (a_lat × g)',
          deps=['speed_kmh', 'lateral_accel_g'])

        # G9: Inertia
        d('I_yaw',                   40.0, 'kg·m²', 'Yaw moment of inertia (approx)',
          formula='I_yaw ≈ m_f × l_f² + m_r × l_r²',
          deps=['total_mass', 'wheelbase', 'x_cg'])

        d('I_pitch',                 25.0, 'kg·m²', 'Pitch moment of inertia (approx)',
          formula='I_pitch ≈ M × (a² + b²) / 5',
          deps=['total_mass', 'y_cg', 'wheelbase'])

        # G10: Handling indices
        d('stability_index',          0.13, '',   'Stability index (trail × WB)',
          formula='SI = trail × WB / 10⁶',
          deps=['trail', 'wheelbase'])

        d('agility_index',            0.07, '',   'Normalised yaw inertia (lower = agile)',
          formula='AI = I_yaw / (M × WB²)',
          deps=['I_yaw', 'total_mass', 'wheelbase'])

        d('wobble_sensitivity',       7.5, '',    'High-speed wobble sensitivity',
          formula='WS = 10⁶ / (trail × WB)',
          deps=['trail', 'wheelbase'])

        d('pitch_sensitivity',        0.05, '%/mm','Δfront% per mm wheelbase change',
          formula='dF%/dWB = X_cg / WB² × 100',
          deps=['x_cg', 'wheelbase'])

    # ── Topological Sort ──────────────────────────────────────────────────

    def _build_topo_order(self) -> None:
        """
        Build a topological ordering of derived parameters using Kahn's algorithm.
        Input parameters are not included in the ordering (they have no compute_fn).
        """
        # Build adjacency (node → set of nodes that depend on it)
        dependents: Dict[str, Set[str]] = defaultdict(set)
        in_degree: Dict[str, int] = {}

        derived_names = [n for n, p in self._params.items() if not p.is_input]

        derived_set = set(derived_names)

        for name in derived_names:
            param = self._params[name]
            # Only count deps that are themselves derived (not inputs or sentinel)
            real_deps = [
                d for d in param.deps
                if d != '__mass_components__' and d in derived_set
            ]
            in_degree[name] = len(real_deps)
            for dep in real_deps:
                dependents[dep].add(name)

        queue: deque[str] = deque(
            [n for n in derived_names if in_degree[n] == 0]
        )
        order: List[str] = []

        while queue:
            node = queue.popleft()
            order.append(node)
            for nxt in sorted(dependents[node]):  # sorted for determinism
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)

        if len(order) != len(derived_names):
            # Detect cycle and report
            remaining = set(derived_names) - set(order)
            raise RuntimeError(
                f"Cycle detected in parameter DAG. Nodes involved: {remaining}")

        self._topo_order = order

    # ── Presets ───────────────────────────────────────────────────────────

    def _load_preset(self, preset: str) -> None:
        """Load named preset inputs and default mass components."""

        presets: Dict[str, Dict[str, float]] = {
            # Sport / Supersport — mirrors chassis-workbench families.ts sport preset
            # Pivot (830, 385), CS offset (−270, −105) → CS abs (560, 280)
            # H_ra=325 < H_sp=385 → sa_angle = arcsin((325−385)/580) ≈ −5.9°
            'sport': {
                'swingarm_length': 580, 'swingarm_pivot_x': 830,
                'swingarm_pivot_height': 385, 'rear_wheel_diameter': 640,
                'front_wheel_diameter': 600, 'head_angle_deg': 24,
                'fork_offset': 33, 'drive_sprocket_teeth': 16,
                'rear_sprocket_teeth': 42,
                'drive_sprocket_radius': 40.5, 'rear_sprocket_radius': 106.0,
                'front_spring_rate': 9.5, 'rear_spring_rate': 88,
                'front_motion_ratio': 0.97, 'rear_motion_ratio': 0.65,
                'anti_dive_pct': 25,
                'countershaft_x': 560, 'countershaft_height': 280,
            },
            # Naked / Roadster — MT-09 / Z900 class
            # Pivot (860, 390), CS offset (−280, −110) → CS abs (580, 280)
            'naked': {
                'swingarm_length': 560, 'swingarm_pivot_x': 860,
                'swingarm_pivot_height': 390, 'rear_wheel_diameter': 640,
                'front_wheel_diameter': 600, 'head_angle_deg': 25,
                'fork_offset': 35, 'drive_sprocket_teeth': 17,
                'rear_sprocket_teeth': 42,
                'drive_sprocket_radius': 43.0, 'rear_sprocket_radius': 106.0,
                'front_spring_rate': 9.0, 'rear_spring_rate': 75,
                'front_motion_ratio': 0.97, 'rear_motion_ratio': 0.62,
                'anti_dive_pct': 20,
                'countershaft_x': 580, 'countershaft_height': 280,
            },
            # Cruiser — Harley Sportster / Indian Scout class
            # Pivot (970, 380), CS offset (−350, −90) → CS abs (620, 290)
            'cruiser': {
                'swingarm_length': 655, 'swingarm_pivot_x': 970,
                'swingarm_pivot_height': 380, 'rear_wheel_diameter': 660,
                'front_wheel_diameter': 760, 'head_angle_deg': 30,
                'fork_offset': 50, 'drive_sprocket_teeth': 16,
                'rear_sprocket_teeth': 38,
                'drive_sprocket_radius': 40.5, 'rear_sprocket_radius': 96.0,
                'front_spring_rate': 7.0, 'rear_spring_rate': 60,
                'front_motion_ratio': 1.0, 'rear_motion_ratio': 0.60,
                'anti_dive_pct': 10,
                'countershaft_x': 620, 'countershaft_height': 290,
            },
        }

        preset_data = presets.get(preset, presets['sport'])
        for k, v in preset_data.items():
            if k in self._params:
                self._params[k].value = float(v)

        # Default mass components — mirrors chassis-workbench families.ts sport preset
        # masses, x-coords (from front axle, mm), y-coords (from ground, mm)
        self._mass_components = [
            MassComponent('Engine',          55.0,  560.0, 340.0),
            MassComponent('Frame',           12.0,  700.0, 480.0),
            MassComponent('Battery',          4.0,  380.0, 220.0),
            MassComponent('Exhaust',          8.0,  460.0, 240.0),
            MassComponent('Swingarm+Wheel',   6.0,  750.0, 280.0),
            MassComponent('Front Wheel',      7.0,  300.0, 300.0),
            MassComponent('Fuel (full)',      10.0,  690.0, 340.0),
            MassComponent('Rider',           75.0,  710.0,1020.0),
        ]

    # ── Input Setter ──────────────────────────────────────────────────────

    def set_input(self, name: str, value: float) -> None:
        """
        Change an input parameter and propagate all downstream effects.

        Internally:
          1. Update the input value.
          2. If geometry changed, run the coupled geometry solver first.
          3. Recompute all derived parameters in topological order.
        """
        if name not in self._params:
            raise KeyError(f"Unknown parameter: {name!r}")
        if not self._params[name].is_input:
            raise ValueError(f"Parameter {name!r} is derived — cannot set directly.")

        old_value = self._params[name].value
        self._params[name].value = float(value)

        if abs(old_value - float(value)) < 1e-12:
            return  # no change

        geometry_inputs = {
            'swingarm_length', 'swingarm_pivot_x', 'swingarm_pivot_height',
            'rear_wheel_diameter', 'front_wheel_diameter',
        }
        if name in geometry_inputs:
            self._solve_coupled_geometry(changed_input=name, old_value=old_value)

        self.recompute()

    def set_mass_components(self, components: List[MassComponent]) -> None:
        """Replace the mass component list and recompute."""
        self._mass_components = list(components)
        self.recompute()

    def add_mass_component(self, component: MassComponent) -> None:
        self._mass_components.append(component)
        self.recompute()

    # ── Coupled Geometry Solver ───────────────────────────────────────────

    def _solve_coupled_geometry(self, changed_input: str, old_value: float) -> None:
        """
        Fixed-point iteration for the coupled system:
          mass_positions ↔ wheelbase ↔ x_cg ↔ mass_positions (scale)

        Algorithm (Picard iteration, typically converges in 1–2 steps):
          1. Compute new wheelbase from swingarm geometry.
          2. Scale mass X positions by new_WB / old_WB.
          3. If swingarm_pivot_height changed, shift mass Y positions.
          4. Iterate until WB and x_cg converge (|Δ| < ε).
        """
        MAX_ITER = 20
        TOL = 1e-4  # mm

        # ── Step A: axle heights from wheel diameters ─────────────────
        if changed_input == 'rear_wheel_diameter':
            self._params['rear_axle_height'].value = self._params['rear_wheel_diameter'].value / 2.0
        if changed_input == 'front_wheel_diameter':
            self._params['front_axle_height'].value = self._params['front_wheel_diameter'].value / 2.0

        rear_axle_h = self._params['rear_wheel_diameter'].value / 2.0
        self._params['rear_axle_height'].value = rear_axle_h

        # ── Step B: new wheelbase from swingarm ───────────────────────
        X_sp  = self._params['swingarm_pivot_x'].value
        L_sa  = self._params['swingarm_length'].value
        H_sp  = self._params['swingarm_pivot_height'].value
        H_ra  = rear_axle_h

        new_WB = _wheelbase_from_swingarm(X_sp, L_sa, H_sp, H_ra)
        if math.isnan(new_WB):
            # Geometry infeasible — revert the change
            self._params[changed_input].value = old_value
            warnings.warn(f"Geometry infeasible after {changed_input}={self._params[changed_input].value:.1f}; change reverted.")
            return

        old_WB = self._params.get('wheelbase', Parameter('wheelbase', new_WB)).value
        self._params['wheelbase'].value = new_WB

        # ── Step C: Constraint 3 — frame-relative mass coupling ───────
        # C3a: Wheelbase scaling → X positions
        if abs(new_WB - old_WB) > 0.01 and old_WB > 0:
            ratio = new_WB / old_WB
            self._mass_components = [mc.scale_x(ratio) for mc in self._mass_components]

        # C3b: Pivot height shift → Y positions
        if changed_input == 'swingarm_pivot_height':
            dH = self._params['swingarm_pivot_height'].value - old_value
            self._mass_components = [mc.shift_y(dH) for mc in self._mass_components]

        # ── Step D: Iterate until convergence ─────────────────────────
        for _ in range(MAX_ITER):
            # Compute x_cg from current mass positions
            masses = [mc.mass for mc in self._mass_components]
            xs     = [mc.x for mc in self._mass_components]
            ys     = [mc.y for mc in self._mass_components]
            try:
                x_cg_new, _ = _weighted_centroid(masses, xs, ys)
            except ValueError:
                break

            old_x_cg = self._params['x_cg'].value
            self._params['x_cg'].value = x_cg_new

            if abs(x_cg_new - old_x_cg) < TOL:
                break  # converged

    # ── Main Recompute ────────────────────────────────────────────────────

    def recompute(self) -> None:
        """
        Evaluate all derived parameters in topological order.
        Each node's compute_fn reads self._params[name].value directly.
        """
        for name in self._topo_order:
            self._recompute_one(name)

    def _recompute_one(self, name: str) -> None:
        """Recompute a single derived parameter using its governing equation."""
        p = self._params[name]
        v = self._get(name)  # dispatches to physics functions
        p.value = v

    def _get(self, name: str) -> float:
        """
        Dispatch table — maps parameter name to its governing equation.
        All physics is centralized here; no physics in the Parameter class.
        """
        _ = self._params  # shorthand

        def g(n: str) -> float:  # get current value
            return _[n].value

        # G1: Geometry
        if name == 'rear_axle_height':
            return g('rear_wheel_diameter') / 2.0

        if name == 'front_axle_height':
            return g('front_wheel_diameter') / 2.0

        if name == 'wheelbase':
            return _wheelbase_from_swingarm(
                g('swingarm_pivot_x'), g('swingarm_length'),
                g('swingarm_pivot_height'), g('rear_axle_height'),
            )

        if name == 'swingarm_angle':
            return _swingarm_angle(
                g('rear_axle_height'), g('swingarm_pivot_height'),
                g('swingarm_length'),
            )

        if name == 'trail':
            return _trail(
                g('front_axle_height'), g('head_angle_deg'), g('fork_offset'),
            )

        if name == 'mechanical_trail':
            return _mechanical_trail(g('trail'), g('head_angle_deg'))

        # G2: CoG (from mass components)
        if name in ('x_cg', 'y_cg', 'total_mass'):
            masses = [mc.mass for mc in self._mass_components]
            xs     = [mc.x for mc in self._mass_components]
            ys     = [mc.y for mc in self._mass_components]
            try:
                x_cg, y_cg = _weighted_centroid(masses, xs, ys)
            except ValueError:
                return 0.0
            total = sum(masses)
            if name == 'x_cg':
                return x_cg
            if name == 'y_cg':
                return y_cg
            return total

        # G3: Axle loads
        if name in ('r_front', 'r_rear', 'front_pct', 'rear_pct'):
            rf, rr, fp, rp = _static_axle_loads(
                g('total_mass'), g('x_cg'), g('wheelbase'),
            )
            return {'r_front': rf, 'r_rear': rr, 'front_pct': fp, 'rear_pct': rp}[name]

        # G4: Anti-squat chain geometry
        if name == 'chain_force_angle':
            return _chain_force_angle(
                g('rear_sprocket_radius'), g('drive_sprocket_radius'),
                g('countershaft_x'), g('countershaft_height'),
                g('wheelbase'), g('rear_axle_height'),
            )

        if name == 'IC_x':
            # CSP position relative to swingarm pivot
            csp_dx = g('countershaft_x') - g('swingarm_pivot_x')
            csp_dy = g('countershaft_height') - g('swingarm_pivot_height')
            ic_x, _ = _anti_squat_IC(
                g('swingarm_pivot_x'), g('swingarm_pivot_height'),
                g('swingarm_angle'), g('chain_force_angle'),
                csp_dx, csp_dy,
                r_drive=g('drive_sprocket_radius'),
            )
            return ic_x

        if name == 'IC_y':
            # Re-derive both IC coords from scratch to stay consistent with IC_x
            csp_dx = g('countershaft_x') - g('swingarm_pivot_x')
            csp_dy = g('countershaft_height') - g('swingarm_pivot_height')
            _, ic_y = _anti_squat_IC(
                g('swingarm_pivot_x'), g('swingarm_pivot_height'),
                g('swingarm_angle'), g('chain_force_angle'),
                csp_dx, csp_dy,
                r_drive=g('drive_sprocket_radius'),
            )
            return ic_y

        if name == 'anti_squat_pct':
            return _anti_squat_percent(
                g('IC_x'), g('IC_y'), g('y_cg'), g('wheelbase'),
            )

        # G5: Wheel rates
        if name == 'front_wheel_rate':
            mr = g('front_motion_ratio')
            return g('front_spring_rate') * mr * mr

        if name == 'rear_wheel_rate':
            mr = g('rear_motion_ratio')
            return g('rear_spring_rate') * mr * mr

        # G6: Longitudinal dynamics
        if name == 'load_transfer_accel':
            return _longitudinal_load_transfer(
                g('total_mass'), g('accel_g'), g('y_cg'), g('wheelbase'),
            )

        if name == 'load_transfer_brake':
            return _longitudinal_load_transfer(
                g('total_mass'), g('brake_g'), g('y_cg'), g('wheelbase'),
            )

        if name == 'rear_squat_mm':
            return _rear_squat_mm(
                g('anti_squat_pct'), g('load_transfer_accel'), g('rear_wheel_rate'),
            )

        if name == 'fork_dive_mm':
            return _fork_dive_mm(
                g('anti_dive_pct'), g('load_transfer_brake'), g('front_wheel_rate'),
            )

        # G7: Stability thresholds
        if name == 'wheelie_threshold_g':
            return _wheelie_threshold(
                g('r_front'), g('total_mass'), g('wheelbase'), g('y_cg'),
            )

        if name == 'stoppie_threshold_g':
            return _stoppie_threshold(
                g('r_rear'), g('total_mass'), g('wheelbase'), g('y_cg'),
            )

        # G8: Cornering
        if name == 'lean_angle_deg':
            return _lean_angle_deg(g('lateral_accel_g'))

        if name == 'lateral_load_transfer':
            return _lateral_load_transfer(
                g('total_mass'), g('lateral_accel_g'), g('y_cg'),
                g('lean_angle_deg'), g('track_width_mm'),
            )

        if name == 'turning_radius':
            return _turning_radius(g('speed_kmh'), g('lateral_accel_g'))

        # G9: Inertia
        if name == 'I_yaw':
            return _yaw_inertia_approx(g('total_mass'), g('wheelbase'), g('x_cg'))

        if name == 'I_pitch':
            return _pitch_inertia_approx(g('total_mass'), g('y_cg'), g('wheelbase'))

        # G10: Handling indices
        if name == 'stability_index':
            return _stability_index(g('trail'), g('wheelbase'))

        if name == 'agility_index':
            return _agility_index(g('I_yaw'), g('total_mass'), g('wheelbase'))

        if name == 'wobble_sensitivity':
            return _wobble_sensitivity(g('trail'), g('wheelbase'))

        if name == 'pitch_sensitivity':
            return _pitch_sensitivity(g('x_cg'), g('wheelbase'))

        # Fallback — parameter may have a custom compute_fn
        param = self._params[name]
        if param.compute_fn is not None:
            return param.compute_fn(self)

        warnings.warn(f"No compute rule for derived parameter {name!r}")
        return param.value

    # ── Query API ─────────────────────────────────────────────────────────

    def get(self, name: str) -> float:
        """Return the current value of any parameter."""
        return self._params[name].value

    def get_param(self, name: str) -> Parameter:
        return self._params[name]

    def mass_components(self) -> List[MassComponent]:
        return list(self._mass_components)

    # ── Sweep ─────────────────────────────────────────────────────────────

    def sweep(
        self,
        input_name: str,
        from_value: float,
        to_value: float,
        steps: int = 20,
        output_names: Optional[List[str]] = None,
    ) -> List[Dict[str, float]]:
        """
        Sweep one input parameter across a range and collect outputs.

        Returns a list of dicts, one per step:
            { input_name: value, out1: value, out2: value, ... }
        """
        import copy

        if output_names is None:
            output_names = list(self._topo_order)  # all derived params

        # Save model state
        saved_inputs = {n: p.value for n, p in self._params.items() if p.is_input}
        saved_mass = list(self._mass_components)

        results: List[Dict[str, float]] = []
        for i in range(steps):
            t = i / max(steps - 1, 1)
            v = from_value + t * (to_value - from_value)
            self.set_input(input_name, v)
            row: Dict[str, float] = {input_name: v}
            for out in output_names:
                row[out] = self.get(out)
            results.append(row)

        # Restore state
        for n, v in saved_inputs.items():
            self._params[n].value = v
        self._mass_components = saved_mass
        self.recompute()

        return results

    # ── Report ────────────────────────────────────────────────────────────

    def report(self) -> Dict[str, Any]:
        """
        Return a structured report of the current model state.

        Groups outputs by category for integration with the TypeScript
        visualization data pipeline (matches chassis-workbench ComputeAllResult shape).
        """
        g = self.get

        return {
            'geometry': {
                'wheelbase':         g('wheelbase'),
                'swingarm_angle':    g('swingarm_angle'),
                'trail':             g('trail'),
                'mechanical_trail':  g('mechanical_trail'),
                'front_axle_height': g('front_axle_height'),
                'rear_axle_height':  g('rear_axle_height'),
            },
            'cog': {
                'x_cg':        g('x_cg'),
                'y_cg':        g('y_cg'),
                'total_mass':  g('total_mass'),
                'r_front':     g('r_front'),
                'r_rear':      g('r_rear'),
                'front_pct':   g('front_pct'),
                'rear_pct':    g('rear_pct'),
            },
            'anti_squat': {
                'chain_force_angle':  g('chain_force_angle'),
                'IC_x':               g('IC_x'),
                'IC_y':               g('IC_y'),
                'anti_squat_pct':     g('anti_squat_pct'),
            },
            'dynamics': {
                'load_transfer_accel': g('load_transfer_accel'),
                'load_transfer_brake': g('load_transfer_brake'),
                'rear_squat_mm':       g('rear_squat_mm'),
                'fork_dive_mm':        g('fork_dive_mm'),
                'wheelie_threshold_g': g('wheelie_threshold_g'),
                'stoppie_threshold_g': g('stoppie_threshold_g'),
            },
            'cornering': {
                'lean_angle_deg':       g('lean_angle_deg'),
                'lateral_load_transfer':g('lateral_load_transfer'),
                'turning_radius':       g('turning_radius'),
            },
            'inertia': {
                'I_yaw':   g('I_yaw'),
                'I_pitch': g('I_pitch'),
            },
            'handling': {
                'stability_index':   g('stability_index'),
                'agility_index':     g('agility_index'),
                'wobble_sensitivity':g('wobble_sensitivity'),
                'pitch_sensitivity': g('pitch_sensitivity'),
            },
            'mass_components': [
                {'name': mc.name, 'mass': mc.mass, 'x': mc.x, 'y': mc.y}
                for mc in self._mass_components
            ],
        }

    def plot_sweep(
        self,
        input_name: str,
        from_value: float,
        to_value: float,
        output_names: List[str],
        steps: int = 40,
        save_path: Optional[str] = None,
    ) -> None:
        """
        Plot one or more outputs vs a swept input using matplotlib.

        Args:
            input_name    : The input parameter to sweep.
            from_value    : Start of sweep range.
            to_value      : End of sweep range.
            output_names  : List of derived parameters to plot (each on its own sub-axis).
            steps         : Number of sweep points.
            save_path     : If given, save PNG to this path instead of showing.
        """
        try:
            import matplotlib.pyplot as plt
        except ImportError:
            print("matplotlib not found.  Install it: pip install matplotlib")
            return

        data = self.sweep(input_name, from_value, to_value, steps, output_names)
        xs = [row[input_name] for row in data]
        n = len(output_names)

        fig, axes = plt.subplots(n, 1, figsize=(10, 3 * n), sharex=True)
        if n == 1:
            axes = [axes]

        fig.suptitle(
            f"Motorcycle Dynamics: {input_name} sweep\n"
            f"{from_value:.0f} → {to_value:.0f} {self._params[input_name].unit}",
            fontsize=13, fontweight='bold',
        )

        for ax, out_name in zip(axes, output_names):
            ys = [row[out_name] for row in data]
            p = self._params[out_name]
            ax.plot(xs, ys, linewidth=2, color='#58a6ff')
            ax.fill_between(xs, ys, alpha=0.12, color='#58a6ff')
            ax.set_ylabel(f"{out_name}\n({p.unit})" if p.unit else out_name, fontsize=9)
            ax.grid(True, alpha=0.3)
            ax.set_facecolor('#0d1117')
            ax.tick_params(colors='#c9d1d9')
            for spine in ax.spines.values():
                spine.set_edgecolor('#30363d')
            # Annotate formula on hover-invisible text
            ax.text(0.01, 0.97, p.formula, transform=ax.transAxes,
                    fontsize=7, va='top', color='#8b949e', family='monospace')

        axes[-1].set_xlabel(
            f"{input_name} ({self._params[input_name].unit})", fontsize=10)

        plt.style.use('dark_background')
        fig.patch.set_facecolor('#0d1117')
        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight',
                        facecolor='#0d1117')
            print(f"  Saved to: {save_path}")
        else:
            plt.show()

    def plot_dag(self, save_path: Optional[str] = None) -> None:
        """
        Visualise the parameter dependency graph using matplotlib.

        Nodes are coloured by category:
          Blue   = inputs
          Orange = geometry derived
          Green  = CoG / loads
          Red    = dynamics
          Purple = handling indices

        Args:
            save_path : If given, save PNG here; otherwise show interactively.
        """
        try:
            import matplotlib.pyplot as plt
            import matplotlib.patches as mpatches
        except ImportError:
            print("matplotlib not found.  Install it: pip install matplotlib")
            return

        # Category colour mapping
        cat_color = {
            'geometry':  '#58a6ff',
            'cog':       '#3fb950',
            'loads':     '#3fb950',
            'antisquat': '#ffa657',
            'dynamics':  '#ff7b72',
            'handling':  '#d2a8ff',
            'inertia':   '#d2a8ff',
            'input':     '#8b949e',
        }

        def _cat(name: str) -> str:
            g = ['wheelbase','swingarm_angle','trail','mechanical_trail',
                 'front_axle_height','rear_axle_height']
            c = ['x_cg','y_cg','total_mass']
            l = ['r_front','r_rear','front_pct','rear_pct']
            a = ['chain_force_angle','IC_x','IC_y','anti_squat_pct']
            d = ['load_transfer_accel','load_transfer_brake','rear_squat_mm',
                 'fork_dive_mm','wheelie_threshold_g','stoppie_threshold_g',
                 'lean_angle_deg','lateral_load_transfer','turning_radius']
            i = ['I_yaw','I_pitch']
            h = ['stability_index','agility_index','wobble_sensitivity','pitch_sensitivity']
            if name in g: return 'geometry'
            if name in c: return 'cog'
            if name in l: return 'loads'
            if name in a: return 'antisquat'
            if name in d: return 'dynamics'
            if name in i: return 'inertia'
            if name in h: return 'handling'
            return 'input'

        # Assign topo-rank positions for a simple layered layout
        all_names = (
            [n for n, p in self._params.items() if p.is_input]
            + list(self._topo_order)
        )

        # Build forward edge list (dep → dependent)
        edges: List[Tuple[str, str]] = []
        for name in self._topo_order:
            p = self._params[name]
            for dep in p.deps:
                if dep != '__mass_components__' and dep in self._params:
                    edges.append((dep, name))

        # Position: topo rank on Y, spread horizontally
        rank: Dict[str, int] = {}
        for i, name in enumerate(all_names):
            rank[name] = i

        # Simple grid layout: inputs on left, derived on right
        n_in = sum(1 for _, p in self._params.items() if p.is_input)
        n_der = len(self._topo_order)
        pos: Dict[str, Tuple[float, float]] = {}

        inputs = [n for n, p in self._params.items() if p.is_input]
        for i, name in enumerate(inputs):
            pos[name] = (0.0, i * 1.2)

        for i, name in enumerate(self._topo_order):
            pos[name] = (3.0, i * 1.0)

        fig, ax = plt.subplots(figsize=(14, max(n_in, n_der) * 0.6 + 2))
        ax.set_facecolor('#0d1117')
        fig.patch.set_facecolor('#0d1117')

        # Draw edges
        for src, dst in edges:
            if src in pos and dst in pos:
                x0, y0 = pos[src]
                x1, y1 = pos[dst]
                ax.annotate(
                    '', xy=(x1, y1), xytext=(x0, y0),
                    arrowprops=dict(arrowstyle='->', color='#30363d',
                                   lw=0.5, connectionstyle='arc3,rad=0.1'),
                )

        # Draw nodes
        for name, (x, y) in pos.items():
            color = cat_color[_cat(name)]
            ax.scatter(x, y, s=120, c=color, zorder=5, edgecolors='white', linewidths=0.3)
            ax.text(x + 0.08, y, name, fontsize=6, va='center', color='#c9d1d9', family='monospace')

        # Legend
        legend_patches = [
            mpatches.Patch(color=cat_color[k], label=k) for k in cat_color
        ]
        ax.legend(handles=legend_patches, loc='lower right', fontsize=7,
                  facecolor='#161b22', edgecolor='#30363d', labelcolor='#c9d1d9')

        ax.set_title('Motorcycle Dynamics — Parameter Dependency Graph',
                     color='#c9d1d9', fontsize=12, pad=10)
        ax.axis('off')
        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight',
                        facecolor='#0d1117')
            print(f"  DAG saved to: {save_path}")
        else:
            plt.show()

    def print_report(self) -> None:
        """Print a formatted ASCII report of the current model state."""
        r = self.report()
        w = 54

        def section(title: str) -> None:
            print(f"\n{'─' * w}")
            print(f"  {title}")
            print(f"{'─' * w}")

        def row(label: str, value: float, unit: str = '', note: str = '') -> None:
            val_str = f"{value:.3g} {unit}".strip()
            note_str = f"  ← {note}" if note else ''
            print(f"  {label:<34} {val_str:>10}{note_str}")

        print(f"\n{'═' * w}")
        print(f"  Motorcycle Dynamics Model — State Report")
        print(f"{'═' * w}")

        section("G1: Geometry")
        row("Wheelbase",           r['geometry']['wheelbase'],        "mm")
        row("Swingarm angle",      r['geometry']['swingarm_angle'],   "°",
            "typical +2° to +8°")
        row("Trail",               r['geometry']['trail'],            "mm",
            "80–120 mm typical")
        row("Mechanical trail",    r['geometry']['mechanical_trail'], "mm")
        row("Front axle height",   r['geometry']['front_axle_height'],"mm")
        row("Rear axle height",    r['geometry']['rear_axle_height'], "mm")

        section("G2: Centre of Gravity")
        row("X_cg (from front axle)",  r['cog']['x_cg'],       "mm")
        row("Y_cg (height)",           r['cog']['y_cg'],       "mm",
            "550–700 mm typical")
        row("Total mass",              r['cog']['total_mass'], "kg")

        section("G3: Static Axle Loads")
        row("Front reaction",  r['cog']['r_front'],   "N")
        row("Rear reaction",   r['cog']['r_rear'],    "N")
        row("Front %",         r['cog']['front_pct'], "%", "42–58% healthy")
        row("Rear %",          r['cog']['rear_pct'],  "%")

        section("G4: Anti-Squat")
        row("Chain force angle", r['anti_squat']['chain_force_angle'], "°")
        row("IC_x",              r['anti_squat']['IC_x'],              "mm")
        row("IC_y",              r['anti_squat']['IC_y'],              "mm")
        row("Anti-squat %",      r['anti_squat']['anti_squat_pct'],    "%",
            "80–120% ideal")

        section("G5: Longitudinal Dynamics (1g scenario)")
        row("Load transfer (accel)", r['dynamics']['load_transfer_accel'], "N")
        row("Load transfer (brake)", r['dynamics']['load_transfer_brake'], "N")
        row("Rear squat",            r['dynamics']['rear_squat_mm'],      "mm")
        row("Fork dive",             r['dynamics']['fork_dive_mm'],       "mm")
        row("Wheelie threshold",     r['dynamics']['wheelie_threshold_g'],"g")
        row("Stoppie threshold",     r['dynamics']['stoppie_threshold_g'],"g")

        section("G6: Cornering (0.8g lateral)")
        row("Lean angle",            r['cornering']['lean_angle_deg'],        "°")
        row("Lateral load transfer", r['cornering']['lateral_load_transfer'],  "N")
        row("Turning radius",        r['cornering']['turning_radius'],         "m")

        section("G7: Inertia")
        row("Yaw inertia (I_yaw)",   r['inertia']['I_yaw'],   "kg·m²")
        row("Pitch inertia (I_pitch)",r['inertia']['I_pitch'], "kg·m²")

        section("G8: Handling Indices")
        row("Stability index",     r['handling']['stability_index'],    "",
            "higher = more stable")
        row("Agility index",       r['handling']['agility_index'],      "",
            "lower = more agile")
        row("Wobble sensitivity",  r['handling']['wobble_sensitivity'], "",
            "lower = more stable")
        row("Pitch sensitivity",   r['handling']['pitch_sensitivity'],  "%/mm")

        print(f"\n{'═' * w}\n")

    # ── Visualization Data ────────────────────────────────────────────────

    def viz_data(self) -> Dict[str, Any]:
        """
        Return structured data for 2D visualization rendering.

        Coordinates match chassis-workbench ChassisViz2D conventions:
          - origin = swingarm pivot
          - +X forward (toward front axle)
          - +Y upward
        """
        g = self.get
        X_sp = g('swingarm_pivot_x')
        H_sp = g('swingarm_pivot_height')
        WB   = g('wheelbase')

        def phys_to_old(x_from_front: float, y_from_ground: float) -> Tuple[float, float]:
            """Convert physics (front-axle-relative) to old-coord (pivot-relative)."""
            return (X_sp - x_from_front, y_from_ground - H_sp)

        return {
            'swingarm_pivot':   (0.0, 0.0),
            'rear_axle':        phys_to_old(WB, g('rear_axle_height')),
            'front_axle':       phys_to_old(0.0, g('front_axle_height')),
            'cog':              phys_to_old(g('x_cg'), g('y_cg')),
            'IC':               phys_to_old(g('IC_x'), g('IC_y')),
            'ground_y':         -H_sp,
            'scale_suggestion': 500.0 / WB,  # 500px / WB_mm → px/mm
        }

    # ── DAG Introspection ─────────────────────────────────────────────────

    def dependency_graph(self) -> Dict[str, List[str]]:
        """Return the dependency graph as {name: [direct_deps, ...]}."""
        return {
            name: [d for d in p.deps if d != '__mass_components__']
            for name, p in self._params.items()
            if not p.is_input
        }

    def propagation_chain(self, input_name: str) -> List[str]:
        """
        Return the ordered list of derived parameters affected by changing `input_name`.

        Uses forward BFS from the input node through the dependency graph.
        """
        dependents: Dict[str, List[str]] = defaultdict(list)
        for name, p in self._params.items():
            if not p.is_input:
                for dep in p.deps:
                    if dep != '__mass_components__':
                        dependents[dep].append(name)

        visited: Set[str] = set()
        queue: deque[str] = deque([input_name])
        chain: List[str] = []

        while queue:
            node = queue.popleft()
            for nxt in dependents[node]:
                if nxt not in visited:
                    visited.add(nxt)
                    chain.append(nxt)
                    queue.append(nxt)

        # Sort by topo order
        topo_rank = {name: i for i, name in enumerate(self._topo_order)}
        chain.sort(key=lambda n: topo_rank.get(n, 999))
        return chain


# ════════════════════════════════════════════════════════════════════════════
# DEMONSTRATION
# ════════════════════════════════════════════════════════════════════════════

def _demo_swingarm_propagation() -> None:
    """
    Demonstrate the full propagation chain when swingarm length changes.
    Shows: swingarm_length → WB → mass positions → X_cg → axle loads →
           anti-squat IC → AS% → squat travel → wheelie threshold.
    """
    print("\n" + "═" * 60)
    print("  DEMO: Swingarm Length Propagation Chain")
    print("═" * 60)

    model = MotorcycleDynamicsModel(preset='sport')

    before = {
        'swingarm_length': model.get('swingarm_length'),
        'wheelbase':       model.get('wheelbase'),
        'x_cg':            model.get('x_cg'),
        'y_cg':            model.get('y_cg'),
        'front_pct':       model.get('front_pct'),
        'anti_squat_pct':  model.get('anti_squat_pct'),
        'rear_squat_mm':   model.get('rear_squat_mm'),
        'wheelie_threshold_g': model.get('wheelie_threshold_g'),
        'trail':           model.get('trail'),
        'stability_index': model.get('stability_index'),
    }

    print(f"\n  Baseline: swingarm_length = {before['swingarm_length']:.0f} mm")
    print(f"  ─── Changing to 650 mm (+{650-before['swingarm_length']:.0f} mm) ───")

    model.set_input('swingarm_length', 650.0)

    after = {k: model.get(k) for k in before}

    print(f"\n  {'Parameter':<30} {'Before':>10} {'After':>10} {'Delta':>10}")
    print(f"  {'─' * 64}")

    for k, b in before.items():
        a = after[k]
        d = a - b
        unit = model.get_param(k).unit
        sign = '+' if d >= 0 else ''
        print(f"  {k:<30} {b:>10.3g} {a:>10.3g} {sign}{d:>8.3g} {unit}")

    print(f"\n  Propagation chain for 'swingarm_length':")
    chain = model.propagation_chain('swingarm_length')
    for i, name in enumerate(chain):
        print(f"    {i+1:2d}. {name}")

    print()


def _demo_sweep() -> None:
    """Demonstrate parameter sweep: swingarm_length from 500mm to 700mm."""
    print("\n" + "═" * 60)
    print("  DEMO: Swingarm Length Sweep — Effect on Key Outputs")
    print("═" * 60)

    model = MotorcycleDynamicsModel(preset='sport')

    results = model.sweep(
        'swingarm_length', 500.0, 700.0, steps=9,
        output_names=['wheelbase', 'x_cg', 'front_pct', 'anti_squat_pct',
                      'trail', 'wheelie_threshold_g', 'stability_index'],
    )

    header = f"{'SA_len':>8} {'WB':>8} {'X_cg':>8} {'F%':>7} {'AS%':>7} {'Trail':>7} {'Whly':>6} {'SI':>7}"
    print(f"\n  {header}")
    print(f"  {'─' * 65}")
    for row in results:
        print(
            f"  {row['swingarm_length']:>8.0f}"
            f" {row['wheelbase']:>8.1f}"
            f" {row['x_cg']:>8.1f}"
            f" {row['front_pct']:>7.1f}"
            f" {row['anti_squat_pct']:>7.1f}"
            f" {row['trail']:>7.1f}"
            f" {row['wheelie_threshold_g']:>6.2f}"
            f" {row['stability_index']:>7.4f}"
        )
    print()


def _demo_preset_comparison() -> None:
    """Compare three preset bikes side-by-side."""
    print("\n" + "═" * 60)
    print("  DEMO: Preset Comparison — Sport vs Naked vs Cruiser")
    print("═" * 60)

    metrics = [
        ('wheelbase', 'mm'), ('trail', 'mm'), ('swingarm_angle', '°'),
        ('front_pct', '%'), ('anti_squat_pct', '%'),
        ('wheelie_threshold_g', 'g'), ('stability_index', ''),
        ('rear_squat_mm', 'mm'), ('fork_dive_mm', 'mm'),
    ]

    models = {
        preset: MotorcycleDynamicsModel(preset=preset)
        for preset in ('sport', 'naked', 'cruiser')
    }

    print(f"\n  {'Metric':<26} {'sport':>10} {'naked':>10} {'cruiser':>10}")
    print(f"  {'─' * 60}")

    for metric, unit in metrics:
        values = {name: m.get(metric) for name, m in models.items()}
        line = f"  {metric:<26}"
        for name in ('sport', 'naked', 'cruiser'):
            line += f" {values[name]:>10.3g}"
        print(line + f"  {unit}")

    print()


# ════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import sys

    model = MotorcycleDynamicsModel(preset='sport')
    model.print_report()

    _demo_swingarm_propagation()
    _demo_sweep()
    _demo_preset_comparison()

    # Generate sweep plots (saved as PNG alongside this file)
    import os
    out_dir = os.path.dirname(os.path.abspath(__file__))

    print("  Generating sweep plots...")
    model2 = MotorcycleDynamicsModel(preset='sport')
    model2.plot_sweep(
        'swingarm_length', 480, 700,
        output_names=[
            'wheelbase', 'x_cg', 'front_pct', 'anti_squat_pct',
            'wheelie_threshold_g', 'trail', 'stability_index',
        ],
        steps=40,
        save_path=os.path.join(out_dir, 'sweep_swingarm_length.png'),
    )

    model2.plot_dag(
        save_path=os.path.join(out_dir, 'parameter_dag.png'),
    )

    print("  All demonstrations complete.\n")
    sys.exit(0)
