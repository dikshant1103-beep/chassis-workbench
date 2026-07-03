"""
chassis_sim/tests/test_fourbar.py — 4-bar Linkage NR Solver Validation

Tests the 'fourbar' path in compute_sweep() end-to-end and validates
the Newton-Raphson loop-closure solver directly.

Geometry notes
--------------
A feasible 4-bar requires:

    |L_rock − L_push| ≤ ‖R − S‖ ≤ L_rock + L_push

The legacy `rising_rate_mount` fixture in test_sweep.py used L_push=210 which
exceeds the maximum reach (80 + 93.6 = 173.6 mm) → NR never converges.
All fixtures here are analytically verified to be feasible at u=0 and u=60 mm.

Reference geometry (sport bike, u=0):
  Swingarm angle θ_sa ≈ −5.94°
  S (shock arm 100 mm, 90° to swingarm) ≈ (840.3, 484.5)
  R = (800, 400) → ‖R − S‖ ≈ 93.6 mm
  Max reach = 93.6 + 80 = 173.6 mm → L_push must be ≤ 173.6 mm

For shock compression (positive during bump): the shock top T must be
positioned such that ‖Q − T‖ decreases as the wheel rises.  With
T = (700, 380), the rocker tip Q swings from ≈(720.9, 411.5) at u=0 to
≈(720, 398.5) at u=60 mm, giving ~10 mm shock compression.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import math
import pytest
import numpy as np

from chassis_sim.geometry import BikeGeometry, MassComponent, ChainGeometry, compute_cog
from chassis_sim.sweep import (
    ShockMount, compute_sweep,
    _solve_rocker_angle, _shock_attach_world, _swingarm_angle_at_travel, _dist,
)

DEG2RAD = math.pi / 180

# ── Shared fixtures ───────────────────────────────────────────────────────────

@pytest.fixture
def sport_bike():
    return BikeGeometry(
        head_angle_deg=24.0, fork_offset_mm=33.0,
        front_wheel_dia_mm=600.0, rear_wheel_dia_mm=640.0,
        wheelbase_mm=1390.0, swingarm_length_mm=580.0,
        swingarm_pivot_height_mm=385.0, swingarm_pivot_x_mm=830.0,
        rear_axle_height_mm=325.0,
    )


@pytest.fixture
def sport_chain():
    return ChainGeometry(16, 42, -130.0, 60.0, 4.0)


@pytest.fixture
def sport_mass():
    return [
        MassComponent(55, 560, 340, 'Engine'),
        MassComponent(12, 700, 480, 'Frame'),
        MassComponent(75, 710, 820, 'Rider'),
    ]


@pytest.fixture
def fourbar_mount():
    """
    Analytically verified feasible 4-bar mount.

    R = (800, 400), L_rock = 80, L_push = 140.
    At u=0: ‖R−S‖ ≈ 93.6 mm → max reach = 173.6 mm > 140 ✓
    At u=60: ‖R−S‖ ≈ 90.1 mm → max reach = 170.1 mm > 140 ✓

    Initial rocker angle θ_r ≈ 171.7° (computed from cosine rule so that
    ‖Q − S‖ = L_push = 140 mm at static position).

    Shock top T = (700, 380) gives positive shock compression during bump
    (~10 mm over 60 mm wheel travel).
    """
    return ShockMount(
        linkage_type='fourbar',
        shock_arm_length_mm=100.0,
        shock_arm_angle_deg=90.0,
        shock_top_x_mm=700.0,
        shock_top_y_mm=380.0,
        rocker_pivot_x_mm=800.0,
        rocker_pivot_y_mm=400.0,
        rocker_length_mm=80.0,
        pushrod_length_mm=140.0,
        rocker_angle_static_deg=171.7,
    )


@pytest.fixture
def rising_rate_fourbar():
    """
    4-bar geometry tuned to exhibit rising-rate character.

    Pushrod picks up lower on the swingarm (60° arm angle) and a more
    compact rocker/pushrod ratio creates a geometry where ‖dL/du‖
    grows with travel.

    Verified feasible at u=0 and u=60 mm.
    """
    return ShockMount(
        linkage_type='fourbar',
        shock_arm_length_mm=80.0,
        shock_arm_angle_deg=60.0,
        shock_top_x_mm=690.0,
        shock_top_y_mm=360.0,
        rocker_pivot_x_mm=790.0,
        rocker_pivot_y_mm=410.0,
        rocker_length_mm=75.0,
        pushrod_length_mm=130.0,
        rocker_angle_static_deg=168.0,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_fourbar_sweep_runs(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """Sweep completes for 60 mm travel with 4-bar linkage."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount,
                           Y_cg, wheel_travel_mm=60.0, du_mm=1.0)
    assert len(result.points) == 61
    print(f"\n  4-bar sweep: {len(result.points)} points computed")


def test_fourbar_no_nan(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """No NaN anywhere in 4-bar sweep output."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount,
                           Y_cg, wheel_travel_mm=60.0)
    for p in result.points:
        assert not math.isnan(p.motion_ratio),    f"NaN MR at u={p.travel_mm}"
        assert not math.isnan(p.wheel_rate_Nmm),  f"NaN WR at u={p.travel_mm}"
        assert not math.isnan(p.shock_length_mm), f"NaN shock_len at u={p.travel_mm}"


def test_fourbar_mr_positive(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """Motion ratio must be positive for all 4-bar travel steps."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount, Y_cg, 60.0)
    for p in result.points:
        assert p.motion_ratio > 0, f"Non-positive MR={p.motion_ratio:.4f} at u={p.travel_mm}"
    mr_lo, mr_hi = result.mr_range()
    print(f"\n  MR range (4-bar): {mr_lo:.3f} → {mr_hi:.3f}")


def test_fourbar_wr_equals_k_mr_squared(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """WR = k · MR² for every 4-bar step (just as for direct mount)."""
    k = 88.0
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, k, sport_chain, fourbar_mount, Y_cg, 60.0)
    for p in result.points:
        expected = k * p.motion_ratio ** 2
        assert abs(p.wheel_rate_Nmm - expected) < 1e-6, \
            f"WR mismatch at u={p.travel_mm}: {p.wheel_rate_Nmm:.6f} vs {expected:.6f}"


def test_fourbar_shock_compresses_with_bump(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """
    With T=(700, 380), the shock must compress (positive compression) as
    the wheel rises.  Compression should be monotonically non-decreasing.
    """
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount, Y_cg, 60.0)
    compressions = [p.shock_compression_mm for p in result.points]
    assert compressions[-1] > 0, \
        f"Shock did not compress over 60 mm travel: Δ={compressions[-1]:.2f} mm"
    for i in range(1, len(compressions)):
        assert compressions[i] >= compressions[i-1] - 0.05, \
            f"Shock decompressed at u={result.points[i].travel_mm}"
    print(f"\n  4-bar shock compression over 60 mm travel: {compressions[-1]:.2f} mm")


def test_fourbar_nr_residual(sport_bike, fourbar_mount):
    """
    Newton-Raphson loop-closure residual must be < 10⁻⁶ mm²
    at every 10 mm travel step.

    Directly calls the internal NR solver and verifies:
        ‖Q − S‖² − L_push² < tol
    """
    mount = fourbar_mount
    R = (mount.rocker_pivot_x_mm, mount.rocker_pivot_y_mm)
    theta_r0 = mount.rocker_angle_static_deg * DEG2RAD

    for u_mm in range(0, 61, 10):
        theta_sa = _swingarm_angle_at_travel(
            u_mm,
            sport_bike.rear_axle_height_mm,
            sport_bike.swingarm_pivot_height_mm,
            sport_bike.swingarm_length_mm,
        )
        Sx, Sy = _shock_attach_world(
            sport_bike.swingarm_pivot_x_mm, sport_bike.swingarm_pivot_height_mm,
            theta_sa,
            mount.shock_arm_length_mm, mount.shock_arm_angle_deg * DEG2RAD,
        )
        theta_r = _solve_rocker_angle(
            (Sx, Sy), R,
            mount.rocker_length_mm, mount.pushrod_length_mm, theta_r0,
        )
        # Loop-closure residual
        Qx = R[0] + mount.rocker_length_mm * math.cos(theta_r)
        Qy = R[1] + mount.rocker_length_mm * math.sin(theta_r)
        residual = (Qx - Sx)**2 + (Qy - Sy)**2 - mount.pushrod_length_mm**2
        assert abs(residual) < 1e-6, \
            f"NR residual {residual:.3e} mm² at u={u_mm} mm (should be < 1e-6)"
        theta_r0 = theta_r  # warm-start next step

    print("\n  NR loop-closure residual < 1e-6 mm² at every step ✓")


def test_fourbar_different_from_direct(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """
    4-bar sweep must produce a different MR curve from a direct monoshock.
    The two topologies model different mechanical linkages.
    """
    direct_mount = ShockMount(
        linkage_type='direct',
        shock_arm_length_mm=100.0,
        shock_arm_angle_deg=90.0,
        shock_top_x_mm=700.0,
        shock_top_y_mm=380.0,
    )
    _, Y_cg, _ = compute_cog(sport_mass)
    r_direct = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    r_fourbar = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount, Y_cg, 60.0)

    mrs_d = [p.motion_ratio for p in r_direct.points]
    mrs_f = [p.motion_ratio for p in r_fourbar.points]
    max_diff = max(abs(a - b) for a, b in zip(mrs_d, mrs_f))
    assert max_diff > 0.01, \
        "4-bar and direct sweeps should produce different MR curves"
    print(f"\n  Max MR difference (direct vs 4-bar): {max_diff:.4f}")


def test_fourbar_stable_120mm_travel(sport_bike, sport_chain, sport_mass, fourbar_mount):
    """
    4-bar sweep must remain stable and NaN-free over 120 mm of travel
    (twice the nominal range).  Verifies NR does not diverge at extreme geometry.
    """
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, fourbar_mount,
                           Y_cg, wheel_travel_mm=120.0, du_mm=1.0)
    assert len(result.points) == 121
    nan_count = sum(1 for p in result.points if math.isnan(p.motion_ratio))
    assert nan_count == 0, f"{nan_count} NaN MR values in 120 mm sweep"
    print(f"\n  120 mm 4-bar sweep: {len(result.points)} points, {nan_count} NaN ✓")


if __name__ == '__main__':
    print("=== 4-bar Linkage Tests (standalone) ===")
    geom = BikeGeometry(24, 33, 600, 640, 1390, 580, 385, 830, 325)
    chain = ChainGeometry(16, 42, -130, 60, 4.0)
    mass = [MassComponent(55, 560, 340, 'E'), MassComponent(12, 700, 480, 'F'),
            MassComponent(75, 710, 820, 'R')]
    mount = ShockMount('fourbar', 100, 90, 700, 380, 800, 400, 80, 140, 171.7)
    _, Y_cg, _ = compute_cog(mass)

    res = compute_sweep(geom, 88.0, chain, mount, Y_cg, wheel_travel_mm=60.0)
    print(f"  Steps: {len(res.points)}")
    print(f"  MR range: {res.mr_range()[0]:.3f} → {res.mr_range()[1]:.3f}")
    print(f"  WR range: {res.wr_range()[0]:.1f} → {res.wr_range()[1]:.1f} N/mm")
    compressions = [p.shock_compression_mm for p in res.points]
    print(f"  Shock compression at 60 mm travel: {compressions[-1]:.2f} mm")
    print(f"  Linkage character: {'Rising-rate' if res.is_rising_rate() else 'Falling/Progressive'}")
    print("\nRun tests: pytest chassis_sim/tests/test_fourbar.py -v")
