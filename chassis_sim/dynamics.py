"""
chassis_sim/dynamics.py — Dynamics Sweep Engine (Phase 3)

Computes weight transfer, axle loads, anti-dive %, fork compression,
and rear extension across a range of braking and acceleration events.

All formulas from:
  Foale (2006) Motorcycle Handling and Chassis Design
  Cossalter (2006) Motorcycle Dynamics, 2nd Ed.

Units: mm, N, kg, g (acceleration as multiple of 9.81 m/s²)
"""

from __future__ import annotations
import math
from dataclasses import dataclass
from typing import List

from .geometry import BikeGeometry, ChainGeometry, MassComponent, compute_cog

G = 9.81  # m/s²


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class BrakePoint:
    """Single braking deceleration sample."""
    decel_g: float           # deceleration as multiple of g (0..~1.4)
    decel_ms2: float         # deceleration in m/s²
    weight_transfer_N: float # ΔW — transferred to front (Foale Eq 6.12)
    R_front_N: float         # dynamic front axle load
    R_rear_N: float          # dynamic rear axle load
    front_pct: float         # front load as % of total
    rear_pct: float          # rear load as % of total
    anti_dive_pct: float     # anti-dive % (Foale Eq 8.11)
    fork_compression_mm: float    # fork compression from weight transfer
    rear_extension_mm: float      # rear shock extension from unloading


@dataclass
class AccelPoint:
    """Single acceleration sample."""
    accel_g: float            # acceleration as multiple of g
    accel_ms2: float
    weight_transfer_N: float  # ΔW — transferred to rear
    R_front_N: float
    R_rear_N: float
    front_pct: float
    rear_pct: float
    wheelie_margin_pct: float  # 100 * (R_front / W) — how far from wheelie


@dataclass
class DynamicsSweepResults:
    """Full dynamics sweep across braking and acceleration range."""
    braking: List[BrakePoint]
    accel: List[AccelPoint]

    # Static values (at 0g) cached for reference
    total_weight_N: float
    X_cg_mm: float
    Y_cg_mm: float
    total_mass_kg: float

    def as_arrays_braking(self) -> dict:
        import numpy as np
        return {
            'decel_g':             np.array([p.decel_g for p in self.braking]),
            'weight_transfer_N':   np.array([p.weight_transfer_N for p in self.braking]),
            'R_front_N':           np.array([p.R_front_N for p in self.braking]),
            'R_rear_N':            np.array([p.R_rear_N for p in self.braking]),
            'front_pct':           np.array([p.front_pct for p in self.braking]),
            'anti_dive_pct':       np.array([p.anti_dive_pct for p in self.braking]),
            'fork_compression_mm': np.array([p.fork_compression_mm for p in self.braking]),
            'rear_extension_mm':   np.array([p.rear_extension_mm for p in self.braking]),
        }

    def as_arrays_accel(self) -> dict:
        import numpy as np
        return {
            'accel_g':            np.array([p.accel_g for p in self.accel]),
            'weight_transfer_N':  np.array([p.weight_transfer_N for p in self.accel]),
            'R_front_N':          np.array([p.R_front_N for p in self.accel]),
            'R_rear_N':           np.array([p.R_rear_N for p in self.accel]),
            'front_pct':          np.array([p.front_pct for p in self.accel]),
            'wheelie_margin_pct': np.array([p.wheelie_margin_pct for p in self.accel]),
        }


# ── Core dynamics formulas ────────────────────────────────────────────────────

def _weight_transfer(
    mass_kg: float,
    accel_g: float,
    Y_cg_mm: float,
    wheelbase_mm: float,
) -> float:
    """
    Longitudinal weight transfer.

    ΔW = m · a · Y_cg / WB                ... Foale Eq 6.12

    Sign convention:
      + braking  → transfers to front
      + accel    → transfers to rear
    Returned as a positive magnitude; caller applies sign.
    """
    return mass_kg * (accel_g * G) * (Y_cg_mm / 1000) / (wheelbase_mm / 1000)


def _anti_dive_pct(
    head_angle_deg: float,
    brake_force_N: float,
    total_weight_N: float,
) -> float:
    """
    Anti-dive percentage.

    AD% = tan(α) · (F_brake_front / W) · 100   ... Foale Eq 8.11

    α  = head angle from vertical (rake)
    F_brake_front = total braking force on front wheel
    W  = total weight
    """
    if abs(total_weight_N) < 1e-9:
        return 0.0
    tan_alpha = math.tan(math.radians(head_angle_deg))
    return tan_alpha * (brake_force_N / total_weight_N) * 100.0


# ── Main sweep function ───────────────────────────────────────────────────────

def compute_dynamics_sweep(
    geom: BikeGeometry,
    components: List[MassComponent],
    chain: ChainGeometry,
    front_spring_rate_Nmm: float = 20.0,
    rear_spring_rate_Nmm: float = 88.0,
    motion_ratio_static: float = 0.70,
    brake_bias_front: float = 0.70,
    decel_max_g: float = 1.20,
    accel_max_g: float = 1.00,
    d_g: float = 0.05,
) -> DynamicsSweepResults:
    """
    Compute dynamics sweep: weight transfer vs deceleration/acceleration.

    Parameters
    ----------
    geom                  : BikeGeometry
    components            : list of MassComponent for CoG computation
    chain                 : ChainGeometry (for future anti-squat extension)
    front_spring_rate_Nmm : front fork spring rate (N/mm) — default 20 N/mm
    rear_spring_rate_Nmm  : rear shock spring rate (N/mm) — default 88 N/mm
    motion_ratio_static   : rear suspension motion ratio at static — default 0.70
    brake_bias_front      : fraction of braking force on front wheel — default 0.70
    decel_max_g           : maximum deceleration to sweep (g) — default 1.20g
    accel_max_g           : maximum acceleration to sweep (g) — default 1.00g
    d_g                   : step size in g — default 0.05g

    Returns
    -------
    DynamicsSweepResults
    """
    X_cg, Y_cg, total_mass = compute_cog(components)
    W = total_mass * G           # total weight (N)
    R_front_static = W * (geom.wheelbase_mm - X_cg) / geom.wheelbase_mm
    R_rear_static  = W * X_cg / geom.wheelbase_mm

    # Effective spring rates at the wheel
    # Fork acts directly → front wheel rate ≈ spring rate
    k_front_Nmm = front_spring_rate_Nmm
    # Rear wheel rate = k_rear · MR²
    k_rear_wheel_Nmm = rear_spring_rate_Nmm * motion_ratio_static ** 2

    # ── Braking sweep ─────────────────────────────────────────────────────────
    braking_points: List[BrakePoint] = []
    n_brake = int(decel_max_g / d_g) + 1

    for i in range(n_brake):
        a_g = i * d_g
        dW = _weight_transfer(total_mass, a_g, Y_cg, geom.wheelbase_mm)

        R_f = R_front_static + dW
        R_r = R_rear_static  - dW

        # Clamp: rear wheel can't go negative (wheelie under braking is unusual,
        # but allow it to go to 0)
        R_r = max(0.0, R_r)
        R_f = min(W, R_f)

        front_pct = (R_f / W) * 100 if W > 0 else 0.0
        rear_pct  = (R_r / W) * 100 if W > 0 else 0.0

        # Anti-dive: braking force on front (Foale Eq 8.11)
        F_brake_total = total_mass * a_g * G
        F_brake_front = brake_bias_front * F_brake_total
        AD_pct = _anti_dive_pct(geom.head_angle_deg, F_brake_front, W)

        # Fork compression: ΔR_front / k_front
        delta_R_front = R_f - R_front_static
        fork_comp_mm  = delta_R_front / k_front_Nmm if k_front_Nmm > 0 else 0.0

        # Rear shock extension: ΔR_rear / k_rear_wheel
        delta_R_rear   = R_rear_static - R_r  # positive = unloading
        rear_ext_mm    = delta_R_rear / k_rear_wheel_Nmm if k_rear_wheel_Nmm > 0 else 0.0

        braking_points.append(BrakePoint(
            decel_g=a_g,
            decel_ms2=a_g * G,
            weight_transfer_N=dW,
            R_front_N=R_f,
            R_rear_N=R_r,
            front_pct=front_pct,
            rear_pct=rear_pct,
            anti_dive_pct=AD_pct,
            fork_compression_mm=fork_comp_mm,
            rear_extension_mm=rear_ext_mm,
        ))

    # ── Acceleration sweep ────────────────────────────────────────────────────
    accel_points: List[AccelPoint] = []
    n_accel = int(accel_max_g / d_g) + 1

    for i in range(n_accel):
        a_g = i * d_g
        dW = _weight_transfer(total_mass, a_g, Y_cg, geom.wheelbase_mm)

        R_f = R_front_static - dW
        R_r = R_rear_static  + dW

        R_f = max(0.0, R_f)
        R_r = min(W, R_r)

        front_pct = (R_f / W) * 100 if W > 0 else 0.0
        rear_pct  = (R_r / W) * 100 if W > 0 else 0.0

        # Wheelie margin: front load as % of static — 0% = wheelie
        wheelie_margin_pct = (R_f / R_front_static) * 100 if R_front_static > 0 else 0.0

        accel_points.append(AccelPoint(
            accel_g=a_g,
            accel_ms2=a_g * G,
            weight_transfer_N=dW,
            R_front_N=R_f,
            R_rear_N=R_r,
            front_pct=front_pct,
            rear_pct=rear_pct,
            wheelie_margin_pct=wheelie_margin_pct,
        ))

    return DynamicsSweepResults(
        braking=braking_points,
        accel=accel_points,
        total_weight_N=W,
        X_cg_mm=X_cg,
        Y_cg_mm=Y_cg,
        total_mass_kg=total_mass,
    )
