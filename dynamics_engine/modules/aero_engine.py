"""
aero_engine.py — Aerodynamics Module
Port of: chassis-workbench/src/engine/aero.ts

F_D = ½ρCxAV², F_L = ½ρCzAV², top speed = cbrt(2Pη/ρCxA)
References: Cossalter Ch. 4/8, Foale Ch. 13
"""

import math
from dataclasses import dataclass, field
from typing import List

RHO_SEA_LEVEL = 1.225  # kg/m³


@dataclass
class AeroSpeedPoint:
    speed_kmh: float
    drag_N: float
    lift_N: float
    power_W: float
    delta_W_front_N: float


@dataclass
class AeroInputs:
    Cx: float                   # drag coefficient
    Cz: float                   # lift coefficient (+= lift, -= downforce)
    frontal_area: float         # m²
    engine_power_kW: float      # kW
    drivetrain_eta: float       # 0–1
    max_speed_kmh: float        # km/h
    reference_speed_kmh: float  # km/h
    pressure_centre_x: float    # mm from front axle
    X_cg: float                 # mm from front axle
    wheelbase: float            # mm
    air_density: float = RHO_SEA_LEVEL
    top_gear_ratio_overall: float = 0.0   # total engine-to-wheel ratio in top gear; 0 = not set
    max_rpm: float = 0.0                  # engine RPM at peak power; 0 = not set
    rear_wheel_radius_mm: float = 320.0   # mm — rear wheel dynamic radius


@dataclass
class AeroResults:
    drag_at_ref: float            # N at reference speed
    lift_at_ref: float            # N
    power_at_ref_W: float         # W
    pitch_moment_Nm: float        # N·m
    delta_W_front_at_ref_N: float # N load transfer at reference speed
    top_speed_ms: float           # m/s — min(power-limited, gear-limited)
    top_speed_kmh: float          # km/h
    top_speed_gear_ms: float      # m/s — RPM ceiling (gear-limited only); =power-limited if no gear data
    top_speed_gear_kmh: float     # km/h
    drag_100kmh_N: float          # N at 100 km/h standard ref
    dynamic_pressure_ref: float   # Pa at reference speed
    speed_sweep: List[AeroSpeedPoint] = field(default_factory=list)


def _drag_at_speed(V_ms, Cx, Cz, A, rho=RHO_SEA_LEVEL):
    q = 0.5 * rho * V_ms * V_ms
    return q * Cx * A, q * Cz * A, q * Cx * A * V_ms  # drag, lift, power


def _pitch_moment(F_lift, x_cp_mm, X_cg_mm, WB_mm):
    arm = (x_cp_mm - X_cg_mm) / 1000.0   # mm → m
    M   = F_lift * arm                     # N·m
    dW  = M / (WB_mm / 1000.0)            # N
    return M, dW


def compute_aero(inp: AeroInputs) -> AeroResults:
    rho = inp.air_density

    # Speed sweep
    sweep: List[AeroSpeedPoint] = []
    v_kmh = 0.0
    v_max  = max(inp.max_speed_kmh, 50.0)
    while v_kmh <= v_max + 1e-6:
        V = v_kmh / 3.6
        drag, lift, power = _drag_at_speed(V, inp.Cx, inp.Cz, inp.frontal_area, rho)
        _, dW = _pitch_moment(lift, inp.pressure_centre_x, inp.X_cg, inp.wheelbase)
        sweep.append(AeroSpeedPoint(
            speed_kmh=round(v_kmh, 1),
            drag_N=round(drag, 2),
            lift_N=round(lift, 2),
            power_W=round(power, 1),
            delta_W_front_N=round(dW, 2),
        ))
        v_kmh += 10.0

    # At reference speed
    V_ref = inp.reference_speed_kmh / 3.6
    drag_ref, lift_ref, power_ref = _drag_at_speed(V_ref, inp.Cx, inp.Cz, inp.frontal_area, rho)
    M_ref, dW_ref = _pitch_moment(lift_ref, inp.pressure_centre_x, inp.X_cg, inp.wheelbase)

    # Power-limited top speed: V = cbrt(2Pη / (ρCxA))
    P_W = inp.engine_power_kW * 1000.0
    V_top_power = (2.0 * P_W * inp.drivetrain_eta / (rho * inp.Cx * inp.frontal_area)) ** (1.0/3.0)

    # Gear-limited ceiling: V = 2π × R_wheel × (maxRPM / 60) / topGearRatioOverall
    if inp.top_gear_ratio_overall > 0.0 and inp.max_rpm > 0.0:
        R_m = inp.rear_wheel_radius_mm / 1000.0
        V_top_gear = 2.0 * math.pi * R_m * (inp.max_rpm / 60.0) / inp.top_gear_ratio_overall
    else:
        V_top_gear = V_top_power  # fallback: no ceiling

    V_top = min(V_top_power, V_top_gear)

    # Drag at 100 km/h standard reference
    drag_100, _, _ = _drag_at_speed(100.0/3.6, inp.Cx, inp.Cz, inp.frontal_area, rho)

    return AeroResults(
        drag_at_ref=round(drag_ref, 1),
        lift_at_ref=round(lift_ref, 1),
        power_at_ref_W=round(power_ref, 0),
        pitch_moment_Nm=round(M_ref, 1),
        delta_W_front_at_ref_N=round(dW_ref, 1),
        top_speed_ms=round(V_top, 2),
        top_speed_kmh=round(V_top * 3.6, 1),
        top_speed_gear_ms=round(V_top_gear, 2),
        top_speed_gear_kmh=round(V_top_gear * 3.6, 1),
        drag_100kmh_N=round(drag_100, 1),
        dynamic_pressure_ref=round(0.5 * rho * V_ref * V_ref, 2),
        speed_sweep=sweep,
    )


if __name__ == "__main__":
    r = compute_aero(AeroInputs(
        Cx=0.35, Cz=-0.1, frontal_area=0.35,
        engine_power_kW=150, drivetrain_eta=0.88,
        max_speed_kmh=280, reference_speed_kmh=200,
        pressure_centre_x=600, X_cg=628, wheelbase=1390,
    ))
    print(f"Drag at 200 km/h:     {r.drag_at_ref:.1f} N")
    print(f"Lift at 200 km/h:     {r.lift_at_ref:.1f} N  (neg=downforce)")
    print(f"Power at 200 km/h:    {r.power_at_ref_W:.0f} W  ({r.power_at_ref_W/1000:.1f} kW)")
    print(f"Pitch moment:         {r.pitch_moment_Nm:.1f} N·m")
    print(f"Front load transfer:  {r.delta_W_front_at_ref_N:.1f} N  at ref speed")
    print(f"Top speed:            {r.top_speed_kmh:.1f} km/h  ({r.top_speed_ms:.2f} m/s)")
    print(f"Drag at 100 km/h:     {r.drag_100kmh_N:.1f} N")
    print(f"Dynamic pressure:     {r.dynamic_pressure_ref:.2f} Pa  at ref")
    print(f"Speed sweep points:   {len(r.speed_sweep)}")
    print("aero_engine OK")
