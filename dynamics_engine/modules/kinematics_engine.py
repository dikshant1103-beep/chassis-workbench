"""
kinematics_engine.py — Suspension Kinematics Module
Port of: chassis-workbench/src/engine/kinematics.ts

Rear axle locus, wheelbase change, and chain length change
as functions of suspension travel.

References:
    Foale (2006) Ch. 11
    Cossalter (2006) Ch. 5

Coordinate system: X from front axle (rearward +), Y from ground (up +). All mm.
"""

import math
from dataclasses import dataclass, field
from typing import List


@dataclass
class KinematicsPoint:
    travel_mm: float          # wheel travel from full droop (mm)
    axle_x: float             # rear axle X from front axle (mm)
    axle_y: float             # rear axle Y from ground (mm)
    wheelbase_mm: float       # = axle_x (mm)
    delta_wheelbase_mm: float # change from static (mm)
    chain_cd_mm: float        # chain centre-to-centre distance (mm)
    delta_chain_mm: float     # change in chain length (Foale approx, mm)
    swingarm_angle_deg: float # swingarm angle from horizontal (deg)


@dataclass
class KinematicsInputs:
    swingarm_length: float       # mm
    swingarm_pivot_x: float      # mm from front axle
    swingarm_pivot_height: float # mm from ground
    swingarm_angle_rad: float    # rad (static, from atan2)
    motion_ratio_rear: float     # dimensionless
    shock_travel: float          # mm
    sprocket_center_x: float     # mm offset from pivot (negative = forward)
    sprocket_center_y: float     # mm offset from pivot
    num_positions: int = 11      # sweep points


@dataclass
class KinematicsResults:
    rear_wheel_travel: float
    static_index: int
    positions: List[KinematicsPoint]
    max_wheelbase_change: float  # mm
    max_chain_length_change: float  # mm


def _centre_distance(axle_x: float, axle_y: float, cs_x: float, cs_y: float) -> float:
    return math.sqrt((axle_x - cs_x) ** 2 + (axle_y - cs_y) ** 2)


def compute_kinematics(inp: KinematicsInputs) -> KinematicsResults:
    L_sa   = inp.swingarm_length
    X_sp   = inp.swingarm_pivot_x
    H_sp   = inp.swingarm_pivot_height
    theta0 = inp.swingarm_angle_rad
    N      = inp.num_positions

    rear_wheel_travel = inp.shock_travel * inp.motion_ratio_rear

    # Countershaft — frame-fixed
    cs_x = X_sp + inp.sprocket_center_x
    cs_y = H_sp + inp.sprocket_center_y

    # Static axle position
    static_axle_x = X_sp + L_sa * math.cos(theta0)
    static_axle_y = H_sp + L_sa * math.sin(theta0)
    static_wb     = static_axle_x
    static_cd     = _centre_distance(static_axle_x, static_axle_y, cs_x, cs_y)

    # Static sag index (~30% of travel)
    static_sag_travel = inp.shock_travel * 0.3
    static_index = round((static_sag_travel / rear_wheel_travel) * (N - 1)) if rear_wheel_travel > 0 else 0
    static_index = max(0, min(static_index, N - 1))

    positions: List[KinematicsPoint] = []
    for i in range(N):
        s = (i / (N - 1)) * rear_wheel_travel  # wheel travel from full droop
        delta_angle = s / L_sa                  # small-angle approx (rad)
        theta = theta0 + delta_angle

        axle_x = X_sp + L_sa * math.cos(theta)
        axle_y = H_sp + L_sa * math.sin(theta)
        wb     = axle_x
        delta_wb = wb - static_wb

        cd = _centre_distance(axle_x, axle_y, cs_x, cs_y)
        delta_chain = 2.0 * (cd - static_cd)  # Foale approx

        positions.append(KinematicsPoint(
            travel_mm=s,
            axle_x=axle_x,
            axle_y=axle_y,
            wheelbase_mm=wb,
            delta_wheelbase_mm=delta_wb,
            chain_cd_mm=cd,
            delta_chain_mm=delta_chain,
            swingarm_angle_deg=math.degrees(theta),
        ))

    max_wb    = max(abs(p.delta_wheelbase_mm) for p in positions)
    max_chain = max(abs(p.delta_chain_mm)     for p in positions)

    return KinematicsResults(
        rear_wheel_travel=rear_wheel_travel,
        static_index=static_index,
        positions=positions,
        max_wheelbase_change=max_wb,
        max_chain_length_change=max_chain,
    )


if __name__ == "__main__":
    inp = KinematicsInputs(
        swingarm_length=580,
        swingarm_pivot_x=830,
        swingarm_pivot_height=385,
        swingarm_angle_rad=math.atan2(-60, 560),  # sport preset
        motion_ratio_rear=0.65,
        shock_travel=58,
        sprocket_center_x=-270,
        sprocket_center_y=-105,
        num_positions=11,
    )
    r = compute_kinematics(inp)
    print(f"Rear wheel travel:       {r.rear_wheel_travel:.2f} mm")
    print(f"Static index:            {r.static_index}")
    print(f"Max wheelbase change:    {r.max_wheelbase_change:.3f} mm")
    print(f"Max chain length change: {r.max_chain_length_change:.3f} mm")
    print(f"Positions ({len(r.positions)}):")
    for p in r.positions:
        print(f"  s={p.travel_mm:5.1f}mm  WB={p.wheelbase_mm:.1f}mm  ΔWB={p.delta_wheelbase_mm:+.2f}mm"
              f"  ΔChain={p.delta_chain_mm:+.2f}mm  θ={p.swingarm_angle_deg:.2f}°")
    print("kinematics_engine OK")
