"""
ergonomics_engine.py — Rider Ergonomics Triangle Module
Port of: chassis-workbench/src/engine/ergonomics.ts

Equations 9.1–9.6: triangle sides + knee/hip angles via law of cosines.
Units: mm for positions, degrees for angles.
"""

import math
from dataclasses import dataclass


@dataclass
class ErgoInputs:
    handlebar_x: float  # mm from front axle (rearward positive)
    handlebar_y: float  # mm from ground
    seat_x: float
    seat_y: float
    footpeg_x: float
    footpeg_y: float


@dataclass
class ErgoResults:
    d_SH: float            # seat → handlebar distance (mm)
    d_SP: float            # seat → footpeg distance (mm)
    d_HP: float            # handlebar → footpeg distance (mm)
    knee_angle_deg: float  # angle at footpeg vertex (law of cosines)
    hip_angle_deg: float   # angle at seat vertex
    forward_lean_deg: float  # torso lean from vertical (+forward, -reclined)


def compute_ergonomics(inp: ErgoInputs) -> ErgoResults:
    H_x, H_y = inp.handlebar_x, inp.handlebar_y
    S_x, S_y = inp.seat_x, inp.seat_y
    P_x, P_y = inp.footpeg_x, inp.footpeg_y

    # Eq 9.1–9.3: triangle side lengths
    d_SH = math.sqrt((S_x - H_x) ** 2 + (S_y - H_y) ** 2)
    d_SP = math.sqrt((S_x - P_x) ** 2 + (S_y - P_y) ** 2)
    d_HP = math.sqrt((H_x - P_x) ** 2 + (H_y - P_y) ** 2)

    # Eq 9.4: knee angle at footpeg (vertex P)
    cos_knee = (d_SP**2 + d_HP**2 - d_SH**2) / (2 * d_SP * d_HP) if d_SP > 1e-9 and d_HP > 1e-9 else 0.0
    knee_angle_deg = math.degrees(math.acos(max(-1.0, min(1.0, cos_knee))))

    # Eq 9.5: hip angle at seat (vertex S)
    cos_hip = (d_SH**2 + d_SP**2 - d_HP**2) / (2 * d_SH * d_SP) if d_SH > 1e-9 and d_SP > 1e-9 else 0.0
    hip_angle_deg = math.degrees(math.acos(max(-1.0, min(1.0, cos_hip))))

    # Eq 9.6: forward lean from vertical
    dY = S_y - H_y
    if abs(dY) < 1e-9:
        forward_lean_deg = 90.0 if H_x > S_x else -90.0
    else:
        forward_lean_deg = math.degrees(math.atan((H_x - S_x) / dY))

    return ErgoResults(
        d_SH=d_SH, d_SP=d_SP, d_HP=d_HP,
        knee_angle_deg=knee_angle_deg,
        hip_angle_deg=hip_angle_deg,
        forward_lean_deg=forward_lean_deg,
    )


if __name__ == "__main__":
    # Sport preset
    r = compute_ergonomics(ErgoInputs(
        handlebar_x=320, handlebar_y=960,
        seat_x=760, seat_y=820,
        footpeg_x=820, footpeg_y=330,
    ))
    print(f"d_SH:           {r.d_SH:.2f} mm")
    print(f"d_SP:           {r.d_SP:.2f} mm")
    print(f"d_HP:           {r.d_HP:.2f} mm")
    print(f"Knee angle:     {r.knee_angle_deg:.2f}°  (target 90-130°)")
    print(f"Hip angle:      {r.hip_angle_deg:.2f}°  (target 40-90°)")
    print(f"Forward lean:   {r.forward_lean_deg:.2f}°  (+forward, -reclined)")
    print("ergonomics_engine OK")
