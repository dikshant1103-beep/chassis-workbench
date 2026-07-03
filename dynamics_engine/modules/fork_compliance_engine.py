"""
fork_compliance_engine.py — Fork and Steering Compliance Module
Port of: chassis-workbench/src/engine/forkCompliance.ts

Fork deflection under braking, effective trail change, SAT and steer flex.
Units: mm, N, N/mm, N·m/deg, degrees
"""

import math
from dataclasses import dataclass

G = 9.81
FRONT_BRAKE_SHARE = 0.70
REF_STEER_ANGLE_DEG = 5.0


@dataclass
class ForkComplianceInputs:
    fork_bending_stiffness: float    # N/mm — lateral stiffness at axle
    fork_torsional_stiffness: float  # N·m/deg — torsional stiffness about fork axis
    total_mass: float                # kg
    a_decel_g: float                 # g
    trail_static: float              # mm
    head_angle_deg: float            # degrees from vertical
    R_front: float                   # N — static front axle load


@dataclass
class ForkComplianceResults:
    braking_force_front: float   # N horizontal at axle
    fork_deflection: float       # mm
    trail_effective: float       # mm (trail under braking)
    delta_trail: float           # mm (negative = trail reduced)
    steering_torque_Nm: float    # N·m SAT at 5° steer
    steer_flex_angle_deg: float  # degrees
    is_perceptible: bool         # > 0.5°
    is_dangerous: bool           # > 1.5°


def compute_fork_compliance(inp: ForkComplianceInputs) -> ForkComplianceResults:
    # Horizontal braking force at front axle
    F_brake = inp.total_mass * inp.a_decel_g * G * FRONT_BRAKE_SHARE

    # Fork bending deflection (linear spring model)
    if inp.fork_bending_stiffness < 1e-9:
        raise ValueError("fork_bending_stiffness must be > 0")
    delta_fork = F_brake / inp.fork_bending_stiffness

    # Effective trail change: Δtrail = −δ × cos(α)
    alpha = math.radians(inp.head_angle_deg)
    delta_trail = -delta_fork * math.cos(alpha)
    trail_effective = inp.trail_static + delta_trail

    # Self-aligning torque at 5° steer
    steer_rad = math.radians(REF_STEER_ANGLE_DEG)
    M_SAT = inp.R_front * (inp.trail_static / 1000.0) * math.sin(steer_rad)

    # Steer flex angle from torsional compliance
    if inp.fork_torsional_stiffness < 1e-9:
        raise ValueError("fork_torsional_stiffness must be > 0")
    flex_angle = M_SAT / inp.fork_torsional_stiffness

    return ForkComplianceResults(
        braking_force_front=F_brake,
        fork_deflection=delta_fork,
        trail_effective=trail_effective,
        delta_trail=delta_trail,
        steering_torque_Nm=M_SAT,
        steer_flex_angle_deg=flex_angle,
        is_perceptible=flex_angle > 0.5,
        is_dangerous=flex_angle > 1.5,
    )


if __name__ == "__main__":
    r = compute_fork_compliance(ForkComplianceInputs(
        fork_bending_stiffness=45,
        fork_torsional_stiffness=450,
        total_mass=177, a_decel_g=0.8,
        trail_static=97.4, head_angle_deg=24, R_front=952,
    ))
    print(f"Braking force front:  {r.braking_force_front:.1f} N")
    print(f"Fork deflection:      {r.fork_deflection:.3f} mm")
    print(f"Trail effective:      {r.trail_effective:.2f} mm  (static={97.4})")
    print(f"Delta trail:          {r.delta_trail:.3f} mm")
    print(f"Steering torque:      {r.steering_torque_Nm:.4f} N·m  (at 5°)")
    print(f"Steer flex angle:     {r.steer_flex_angle_deg:.4f}°  "
          f"{'PERCEPTIBLE' if r.is_perceptible else 'OK'}"
          f"{' DANGEROUS' if r.is_dangerous else ''}")
    print("fork_compliance_engine OK")
