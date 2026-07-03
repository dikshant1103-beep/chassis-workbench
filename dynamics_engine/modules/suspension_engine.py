"""
suspension_engine.py — Suspension Dynamics Module
Port of: chassis-workbench/src/engine/suspension.ts

Equations 7.1–7.15: wheel rate, natural frequency, sag, damping, unsprung freq.
Units: N/mm, kg, Hz, N·s/m, N·s/mm
"""

import math
from dataclasses import dataclass
from typing import Optional

G = 9.81          # m/s²
C_MAX_CLICKS = 30
K_TYRE_DEFAULT = 120.0  # N/mm — typical road tyre vertical stiffness
ZETA_TARGET = 0.65      # target damping ratio (road-sport compromise, Cossalter Ch.5)


@dataclass
class SuspensionInputs:
    spring_rate_front: float       # N/mm
    spring_rate_rear: float        # N/mm
    motion_ratio_front: float      # dimensionless
    motion_ratio_rear: float       # dimensionless
    unsprung_front: float          # kg
    unsprung_rear: float           # kg
    sag_front: float               # mm
    sag_rear: float                # mm
    preload_front: float           # mm
    preload_rear: float            # mm
    fork_travel: float             # mm
    shock_travel: float            # mm
    comp_damping_clicks: float     # 0–30
    damping_coeff_front: float = 0.0  # N·s/mm (actual, from dyno)
    damping_coeff_rear: float  = 0.0  # N·s/mm
    total_mass: float  = 177.0        # kg
    x_cg: float        = 628.0        # mm from front axle
    y_cg: float        = 627.0        # mm from ground
    wheelbase: float   = 1390.0       # mm


@dataclass
class SuspensionResults:
    wheel_rate_front: float          # N/mm
    wheel_rate_rear: float           # N/mm
    sprung_mass: float               # kg
    sprung_mass_front: float         # kg
    sprung_mass_rear: float          # kg
    nat_freq_front: float            # Hz
    nat_freq_rear: float             # Hz
    sag_force_front: float           # N
    sag_force_rear: float            # N
    sag_percent_front: float         # %
    sag_percent_rear: float          # %
    critical_damping_front: float    # N·s/m
    critical_damping_rear: float     # N·s/m
    damping_ratio_clicks: float      # 0–1 (normalised click position)
    damping_ratio_front: float       # actual ζ front
    damping_ratio_rear: float        # actual ζ rear
    optimal_damping_front: float     # N·s/mm (target ζ=0.65)
    optimal_damping_rear: float      # N·s/mm
    unsprung_freq_front: float       # Hz (wheel-hop)
    unsprung_freq_rear: float        # Hz
    load_transfer_08g: float         # N


def compute_wheel_rate(spring_rate: float, motion_ratio: float) -> float:
    """WR = k × MR²  (Eq 7.1/7.2)"""
    return spring_rate * motion_ratio * motion_ratio


def compute_sprung_masses(total_mass, unsprung_f, unsprung_r, x_cg, wheelbase):
    sprung = total_mass - unsprung_f - unsprung_r          # Eq 7.5
    front  = sprung * (wheelbase - x_cg) / wheelbase       # Eq 7.6
    rear   = sprung * x_cg / wheelbase                     # Eq 7.7
    return sprung, front, rear


def compute_nat_freq(wheel_rate: float, sprung_mass: float) -> float:
    """f_n = (1/2π)√(WR×1000/m)  (Eq 7.3/7.4)"""
    if sprung_mass < 1e-9:
        raise ValueError("sprung_mass must be > 0")
    return (1.0 / (2.0 * math.pi)) * math.sqrt((wheel_rate * 1000.0) / sprung_mass)


def compute_critical_damping(wheel_rate: float, sprung_mass: float) -> float:
    """C_crit = 2√(WR×1000×m)  → N·s/m  (Eq 7.12/7.13)"""
    return 2.0 * math.sqrt(wheel_rate * 1000.0 * sprung_mass)


def compute_suspension(inp: SuspensionInputs) -> SuspensionResults:
    WR_f = compute_wheel_rate(inp.spring_rate_front, inp.motion_ratio_front)
    WR_r = compute_wheel_rate(inp.spring_rate_rear,  inp.motion_ratio_rear)

    sprung, sprung_f, sprung_r = compute_sprung_masses(
        inp.total_mass, inp.unsprung_front, inp.unsprung_rear, inp.x_cg, inp.wheelbase
    )

    fn_f = compute_nat_freq(WR_f, sprung_f)
    fn_r = compute_nat_freq(WR_r, sprung_r)

    sag_force_f = inp.spring_rate_front * (inp.sag_front + inp.preload_front)   # Eq 7.8
    sag_force_r = inp.spring_rate_rear  * (inp.sag_rear  + inp.preload_rear)    # Eq 7.9

    sag_pct_f = inp.sag_front / inp.fork_travel  * 100.0  # Eq 7.10
    sag_pct_r = inp.sag_rear  / inp.shock_travel * 100.0  # Eq 7.11

    c_crit_f_Nsm  = compute_critical_damping(WR_f, sprung_f)
    c_crit_r_Nsm  = compute_critical_damping(WR_r, sprung_r)
    c_crit_f_Nsmm = c_crit_f_Nsm / 1000.0
    c_crit_r_Nsmm = c_crit_r_Nsm / 1000.0

    damp_ratio_clicks = inp.comp_damping_clicks / C_MAX_CLICKS    # Eq 7.14
    damp_ratio_f = inp.damping_coeff_front / c_crit_f_Nsmm if c_crit_f_Nsmm > 0 else 0.0
    damp_ratio_r = inp.damping_coeff_rear  / c_crit_r_Nsmm if c_crit_r_Nsmm > 0 else 0.0

    opt_damp_f = ZETA_TARGET * c_crit_f_Nsmm
    opt_damp_r = ZETA_TARGET * c_crit_r_Nsmm

    uf_f = (1.0/(2.0*math.pi)) * math.sqrt((WR_f + K_TYRE_DEFAULT) * 1000.0 / inp.unsprung_front)
    uf_r = (1.0/(2.0*math.pi)) * math.sqrt((WR_r + K_TYRE_DEFAULT) * 1000.0 / inp.unsprung_rear)

    lt_08g = inp.total_mass * 0.8 * G * inp.y_cg / inp.wheelbase   # Eq 7.15

    return SuspensionResults(
        wheel_rate_front=WR_f, wheel_rate_rear=WR_r,
        sprung_mass=sprung, sprung_mass_front=sprung_f, sprung_mass_rear=sprung_r,
        nat_freq_front=fn_f, nat_freq_rear=fn_r,
        sag_force_front=sag_force_f, sag_force_rear=sag_force_r,
        sag_percent_front=sag_pct_f, sag_percent_rear=sag_pct_r,
        critical_damping_front=c_crit_f_Nsm, critical_damping_rear=c_crit_r_Nsm,
        damping_ratio_clicks=damp_ratio_clicks,
        damping_ratio_front=damp_ratio_f, damping_ratio_rear=damp_ratio_r,
        optimal_damping_front=opt_damp_f, optimal_damping_rear=opt_damp_r,
        unsprung_freq_front=uf_f, unsprung_freq_rear=uf_r,
        load_transfer_08g=lt_08g,
    )


if __name__ == "__main__":
    r = compute_suspension(SuspensionInputs(
        spring_rate_front=9.5, spring_rate_rear=88,
        motion_ratio_front=0.97, motion_ratio_rear=0.65,
        unsprung_front=14, unsprung_rear=20,
        sag_front=30, sag_rear=26, preload_front=5, preload_rear=8,
        fork_travel=120, shock_travel=58,
        comp_damping_clicks=12, damping_coeff_front=12, damping_coeff_rear=18,
        total_mass=177, x_cg=628, y_cg=627, wheelbase=1390,
    ))
    print(f"Wheel rate front:      {r.wheel_rate_front:.4f} N/mm")
    print(f"Wheel rate rear:       {r.wheel_rate_rear:.4f} N/mm")
    print(f"Sprung mass:           {r.sprung_mass:.1f} kg")
    print(f"Nat freq front:        {r.nat_freq_front:.4f} Hz  (target 0.8–2.0)")
    print(f"Nat freq rear:         {r.nat_freq_rear:.4f} Hz  (target 1.5–4.0)")
    print(f"Sag % front:           {r.sag_percent_front:.1f}%  (target 25–35%)")
    print(f"Sag % rear:            {r.sag_percent_rear:.1f}%")
    print(f"Critical damp front:   {r.critical_damping_front:.2f} N·s/m")
    print(f"Critical damp rear:    {r.critical_damping_rear:.2f} N·s/m")
    print(f"Optimal damp front:    {r.optimal_damping_front:.4f} N·s/mm  (ζ=0.65)")
    print(f"Optimal damp rear:     {r.optimal_damping_rear:.4f} N·s/mm")
    print(f"Unsprung freq front:   {r.unsprung_freq_front:.3f} Hz")
    print(f"Unsprung freq rear:    {r.unsprung_freq_rear:.3f} Hz")
    print(f"Load transfer 0.8g:    {r.load_transfer_08g:.1f} N")
    print("suspension_engine OK")
