"""
chassis_sim/sweep.py — Suspension Travel Sweep Engine

Computes MR(u), WR(u), AS%(u), trail(u) over the full rear suspension
travel range by simulating swingarm kinematics at each 1 mm step.

Two rear suspension topologies:

  'direct'  — rear shock connects swingarm directly to frame (monoshock).
              Most modern sport bikes.

  'fourbar' — Pro-Link / Uni-Trak: rocker arm + pushrod interposed
              between swingarm and shock.  Loop closure solved by NR.

Reference:
  Foale (2006) Ch. 6, 11 — Motion ratio, wheel rate, anti-squat sweep
  Cossalter (2006) Ch. 5 — Rear suspension kinematics
"""

from __future__ import annotations
import math
import numpy as np
from dataclasses import dataclass, field
from typing import List, Literal, Optional

from .geometry import (
    BikeGeometry, ChainGeometry,
    compute_trail,
    compute_swingarm_angle_rad,
    compute_instant_centre,
    compute_anti_squat_pct,
    compute_anti_squat_swingarm_only,
)

DEG2RAD = math.pi / 180

# ── Shock mount configuration ─────────────────────────────────────────────────

@dataclass
class ShockMount:
    """
    Rear shock mount geometry.

    For 'direct' linkage:
      shock_arm_length, shock_arm_angle define the swingarm attachment.
      shock_top_x, shock_top_y define the frame attachment.

    For 'fourbar' linkage:
      The above define the pushrod attachment on the swingarm (S).
      Rocker pivot R, rocker length, pushrod length complete the 4-bar.
      Shock connects from rocker tip Q to shock_top.
    """
    linkage_type: Literal['direct', 'fourbar'] = 'direct'

    # Swingarm attachment
    shock_arm_length_mm: float = 120.0   # distance from pivot to attachment
    shock_arm_angle_deg: float = 85.0    # angle of arm relative to swingarm axis

    # Shock top mount (frame-fixed)
    shock_top_x_mm: float = 750.0
    shock_top_y_mm: float = 450.0

    # 4-bar linkage (only for linkage_type='fourbar')
    rocker_pivot_x_mm: float = 0.0
    rocker_pivot_y_mm: float = 0.0
    rocker_length_mm: float = 80.0
    pushrod_length_mm: float = 200.0
    rocker_angle_static_deg: float = 45.0


# ── Internal geometry helpers ─────────────────────────────────────────────────

def _swingarm_angle_at_travel(
    u_mm: float,
    H_ra_static: float,
    H_sp: float,
    L_sa: float,
) -> float:
    """
    Swingarm angle at wheel travel u (positive = compression/bump).

    H_ra(u) = H_ra_static + u  (axle rises with wheel travel)
    θ_sa(u) = arcsin((H_ra(u) − H_sp) / L_sa)

    The rear axle traces a circular arc of radius L_sa about the pivot.
    """
    H_ra_u = H_ra_static + u_mm
    sin_theta = (H_ra_u - H_sp) / L_sa
    sin_theta = max(-1.0, min(1.0, sin_theta))  # clamp for geometry limits
    return math.asin(sin_theta)


def _shock_attach_world(
    X_sp: float, H_sp: float,
    theta_sa_rad: float,
    arm_len: float, arm_angle_rad: float,
) -> tuple[float, float]:
    """World-frame position of shock attachment on swingarm."""
    angle = theta_sa_rad + arm_angle_rad
    return X_sp + arm_len * math.cos(angle), H_sp + arm_len * math.sin(angle)


def _dist(ax, ay, bx, by) -> float:
    return math.sqrt((bx - ax)**2 + (by - ay)**2)


# ── Direct monoshock ──────────────────────────────────────────────────────────

def _shock_length_direct(
    u_mm: float,
    geom: BikeGeometry,
    mount: ShockMount,
) -> float:
    theta = _swingarm_angle_at_travel(
        u_mm, geom.rear_axle_height_mm, geom.swingarm_pivot_height_mm, geom.swingarm_length_mm,
    )
    ax, ay = _shock_attach_world(
        geom.swingarm_pivot_x_mm, geom.swingarm_pivot_height_mm,
        theta, mount.shock_arm_length_mm, mount.shock_arm_angle_deg * DEG2RAD,
    )
    return _dist(ax, ay, mount.shock_top_x_mm, mount.shock_top_y_mm)


# ── 4-bar linkage (Pro-Link / Uni-Trak) ──────────────────────────────────────

def _solve_rocker_angle(
    S: tuple[float, float],
    R: tuple[float, float],
    L_rock: float,
    L_push: float,
    theta_r0: float,
) -> float:
    """
    Newton-Raphson solver for rocker angle θ_r.

    Loop closure: |Q − S|² = L_push²
    where Q = R + L_rock·[cos θ_r, sin θ_r]

    f(θ_r)  = (R_x + L_rock·cos θ_r − S_x)² + (R_y + L_rock·sin θ_r − S_y)² − L_push²
    f'(θ_r) = 2·[−L_rock·sin θ_r·(Q_x − S_x) + L_rock·cos θ_r·(Q_y − S_y)]
    """
    theta = theta_r0
    for _ in range(50):
        Qx = R[0] + L_rock * math.cos(theta)
        Qy = R[1] + L_rock * math.sin(theta)
        dx = Qx - S[0];  dy = Qy - S[1]
        f  = dx**2 + dy**2 - L_push**2
        df = 2 * (-L_rock * math.sin(theta) * dx + L_rock * math.cos(theta) * dy)
        if abs(df) < 1e-12:
            break
        dtheta = -f / df
        theta += dtheta
        if abs(dtheta) < 1e-9:
            break
    return theta


def _shock_length_fourbar(
    u_mm: float,
    geom: BikeGeometry,
    mount: ShockMount,
    theta_r0: float,
) -> tuple[float, float]:
    """Returns (shock_length, updated_rocker_angle)."""
    theta_sa = _swingarm_angle_at_travel(
        u_mm, geom.rear_axle_height_mm, geom.swingarm_pivot_height_mm, geom.swingarm_length_mm,
    )
    Sx, Sy = _shock_attach_world(
        geom.swingarm_pivot_x_mm, geom.swingarm_pivot_height_mm,
        theta_sa, mount.shock_arm_length_mm, mount.shock_arm_angle_deg * DEG2RAD,
    )
    R = (mount.rocker_pivot_x_mm, mount.rocker_pivot_y_mm)
    theta_r = _solve_rocker_angle(
        (Sx, Sy), R, mount.rocker_length_mm, mount.pushrod_length_mm, theta_r0,
    )
    Qx = R[0] + mount.rocker_length_mm * math.cos(theta_r)
    Qy = R[1] + mount.rocker_length_mm * math.sin(theta_r)
    shock_len = _dist(Qx, Qy, mount.shock_top_x_mm, mount.shock_top_y_mm)
    return shock_len, theta_r


# ── Trail under fork dive ─────────────────────────────────────────────────────

def _trail_at_fork_dive(
    u_f_mm: float,
    geom: BikeGeometry,
) -> float:
    """
    Trail as fork compresses by u_f mm.

    T(u_f) = T_static − u_f · sin α · tan α     ... Foale Ch. 2 derived

    As fork dives, steering axis tilts slightly forward → trail decreases.
    Braking dive reduces trail → lighter steering feedback while stopping.
    """
    T_static = compute_trail(geom)
    a = geom.alpha_rad
    return T_static - u_f_mm * math.sin(a) * math.tan(a)


# ── Sweep result dataclass ────────────────────────────────────────────────────

@dataclass
class SweepPoint:
    travel_mm: float
    swingarm_angle_deg: float
    shock_length_mm: float
    shock_compression_mm: float
    motion_ratio: float
    wheel_rate_Nmm: float
    anti_squat_pct: float
    anti_squat_swingarm_only_pct: float
    chain_contribution_pct: float
    trail_mm: float


@dataclass
class SweepResults:
    points: List[SweepPoint]
    static_point: SweepPoint  # u = 0

    def as_arrays(self) -> dict:
        """Return all channels as numpy arrays for plotting."""
        return {
            'travel_mm':           np.array([p.travel_mm for p in self.points]),
            'swingarm_angle_deg':  np.array([p.swingarm_angle_deg for p in self.points]),
            'motion_ratio':        np.array([p.motion_ratio for p in self.points]),
            'wheel_rate_Nmm':      np.array([p.wheel_rate_Nmm for p in self.points]),
            'anti_squat_pct':      np.array([p.anti_squat_pct for p in self.points]),
            'trail_mm':            np.array([p.trail_mm for p in self.points]),
        }

    def is_rising_rate(self, tol: float = 0.005) -> bool:
        """Returns True if MR monotonically decreases (rising wheel rate)."""
        mrs = [p.motion_ratio for p in self.points]
        diffs = [mrs[i+1] - mrs[i] for i in range(len(mrs)-1)]
        return all(d <= tol for d in diffs)

    def mr_range(self) -> tuple[float, float]:
        mrs = [p.motion_ratio for p in self.points]
        return min(mrs), max(mrs)

    def wr_range(self) -> tuple[float, float]:
        wrs = [p.wheel_rate_Nmm for p in self.points]
        return min(wrs), max(wrs)


# ── Main sweep function ───────────────────────────────────────────────────────

def compute_sweep(
    geom: BikeGeometry,
    spring_rate_Nmm: float,
    chain: ChainGeometry,
    mount: ShockMount,
    Y_cg_mm: float,
    wheel_travel_mm: float,
    du_mm: float = 1.0,
) -> SweepResults:
    """
    Compute suspension travel sweep.

    Parameters
    ----------
    geom             : BikeGeometry — static geometry
    spring_rate_Nmm  : rear coil spring rate (N/mm)
    chain            : ChainGeometry — for anti-squat computation
    mount            : ShockMount — shock attachment geometry
    Y_cg_mm          : CoG height (mm) — from compute_cog()
    wheel_travel_mm  : total wheel bump travel range (mm)
    du_mm            : step size (default 1 mm)

    Returns
    -------
    SweepResults with one SweepPoint per travel step.
    """
    steps = int(wheel_travel_mm / du_mm) + 1
    points: List[SweepPoint] = []

    # Warm-start rocker angle
    theta_r0 = mount.rocker_angle_static_deg * DEG2RAD if mount.linkage_type == 'fourbar' else 0.0

    # Reference shock length at u=0 (static position)
    if mount.linkage_type == 'direct':
        shock_len_0 = _shock_length_direct(0.0, geom, mount)
    else:
        shock_len_0, theta_r0 = _shock_length_fourbar(0.0, geom, mount, theta_r0)

    def shock_len_fn(u: float) -> float:
        nonlocal theta_r0
        if mount.linkage_type == 'direct':
            return _shock_length_direct(u, geom, mount)
        sl, tr = _shock_length_fourbar(u, geom, mount, theta_r0)
        return sl  # Note: theta_r0 NOT updated inside this closure (only in main loop)

    for i in range(steps):
        u = i * du_mm

        # Swingarm angle at this travel
        theta_sa = _swingarm_angle_at_travel(
            u, geom.rear_axle_height_mm,
            geom.swingarm_pivot_height_mm, geom.swingarm_length_mm,
        )

        # Shock length
        if mount.linkage_type == 'direct':
            shock_len = _shock_length_direct(u, geom, mount)
        else:
            shock_len, theta_r0 = _shock_length_fourbar(u, geom, mount, theta_r0)

        shock_compression = shock_len_0 - shock_len

        # Motion ratio — central difference (forward/backward at endpoints)
        if i == 0:
            L1 = shock_len
            L2 = shock_len_fn(u + du_mm)
            dL_du = (L2 - L1) / du_mm
        elif i == steps - 1:
            L1 = shock_len_fn(u - du_mm)
            L2 = shock_len
            dL_du = (L2 - L1) / du_mm
        else:
            L_lo = shock_len_fn(u - du_mm)
            L_hi = shock_len_fn(u + du_mm)
            dL_du = (L_hi - L_lo) / (2 * du_mm)

        # MR = |d(wheel_travel)/d(shock_compression)| = 1/|dL/du|
        MR = abs(1.0 / dL_du) if abs(dL_du) > 1e-10 else float('nan')
        WR = spring_rate_Nmm * MR**2 if not math.isnan(MR) else float('nan')

        # Anti-squat at this travel position (swingarm angle changes!)
        try:
            IC_x, IC_y = compute_instant_centre(geom, chain, theta_sa)
            AS_pct  = compute_anti_squat_pct(IC_x, IC_y, Y_cg_mm, geom.wheelbase_mm)
            AS_sa   = compute_anti_squat_swingarm_only(theta_sa, geom.wheelbase_mm, Y_cg_mm)
            chain_c = AS_pct - AS_sa
        except ValueError:
            AS_pct = float('nan')
            AS_sa  = float('nan')
            chain_c = float('nan')

        # Trail at equivalent fork dive
        trail = _trail_at_fork_dive(u, geom)

        points.append(SweepPoint(
            travel_mm=u,
            swingarm_angle_deg=math.degrees(theta_sa),
            shock_length_mm=shock_len,
            shock_compression_mm=shock_compression,
            motion_ratio=MR,
            wheel_rate_Nmm=WR,
            anti_squat_pct=AS_pct,
            anti_squat_swingarm_only_pct=AS_sa,
            chain_contribution_pct=chain_c,
            trail_mm=trail,
        ))

    return SweepResults(points=points, static_point=points[0])
