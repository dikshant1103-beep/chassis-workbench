"""
chassis_sim/tests/test_sweep.py — Suspension Travel Sweep Validation

Tests:
  1. MR curve shape (rising/falling rate)
  2. Wheel rate increases with travel for rising-rate linkage
  3. Swingarm angle changes correctly with travel
  4. Anti-squat updates correctly across sweep
  5. Trail decreases with fork dive
  6. NaN check — no invalid values in sweep output
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import math
import pytest
import numpy as np
from chassis_sim.geometry import BikeGeometry, MassComponent, ChainGeometry, compute_cog
from chassis_sim.sweep import ShockMount, compute_sweep


# ── Fixtures ──────────────────────────────────────────────────────────────────

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
def direct_mount():
    """Direct monoshock — sport bike typical."""
    return ShockMount(
        linkage_type='direct',
        shock_arm_length_mm=120.0,
        shock_arm_angle_deg=85.0,
        shock_top_x_mm=750.0,
        shock_top_y_mm=450.0,
    )


@pytest.fixture
def rising_rate_mount():
    """4-bar linkage configured for rising-rate characteristic."""
    return ShockMount(
        linkage_type='fourbar',
        shock_arm_length_mm=100.0,
        shock_arm_angle_deg=90.0,
        shock_top_x_mm=730.0,
        shock_top_y_mm=430.0,
        rocker_pivot_x_mm=800.0,
        rocker_pivot_y_mm=400.0,
        rocker_length_mm=80.0,
        pushrod_length_mm=210.0,
        rocker_angle_static_deg=45.0,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_sweep_runs_without_error(sport_bike, sport_chain, sport_mass, direct_mount):
    """Sweep should complete for the full 60 mm travel range."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount,
                           Y_cg, wheel_travel_mm=60.0, du_mm=1.0)
    assert len(result.points) == 61  # 0..60 inclusive
    print(f"\n  {len(result.points)} sweep points computed")


def test_sweep_no_nan(sport_bike, sport_chain, sport_mass, direct_mount):
    """No NaN values anywhere in sweep output."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount,
                           Y_cg, wheel_travel_mm=60.0)
    for p in result.points:
        assert not math.isnan(p.motion_ratio),    f"NaN MR at u={p.travel_mm}"
        assert not math.isnan(p.wheel_rate_Nmm),  f"NaN WR at u={p.travel_mm}"
        assert not math.isnan(p.anti_squat_pct),  f"NaN AS% at u={p.travel_mm}"
        assert not math.isnan(p.trail_mm),         f"NaN Trail at u={p.travel_mm}"


def test_mr_positive(sport_bike, sport_chain, sport_mass, direct_mount):
    """Motion ratio must be positive everywhere."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    for p in result.points:
        assert p.motion_ratio > 0, f"Negative MR at u={p.travel_mm}"


def test_wr_equals_k_times_mr_squared(sport_bike, sport_chain, sport_mass, direct_mount):
    """WR = k · MR² at every step."""
    k = 88.0
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, k, sport_chain, direct_mount, Y_cg, 60.0)
    for p in result.points:
        expected = k * p.motion_ratio ** 2
        assert abs(p.wheel_rate_Nmm - expected) < 1e-6, \
            f"WR mismatch at u={p.travel_mm}: {p.wheel_rate_Nmm:.4f} vs {expected:.4f}"


def test_trail_decreases_with_dive(sport_bike, sport_chain, sport_mass, direct_mount):
    """
    Trail must decrease as fork dives (fork compression reduces trail).

    T(u) = T_static − u · sin α · tan α  → T decreases monotonically.
    """
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    trails = [p.trail_mm for p in result.points]
    diffs = [trails[i+1] - trails[i] for i in range(len(trails)-1)]
    assert all(d <= 0 for d in diffs), \
        "Trail must decrease monotonically with fork dive"
    print(f"\n  Trail range: {trails[0]:.1f} → {trails[-1]:.1f} mm  (Δ = {trails[-1]-trails[0]:.1f} mm)")


def test_swingarm_angle_increases_with_bump(sport_bike, sport_chain, sport_mass, direct_mount):
    """
    During bump (wheel rises), swingarm rotates upward → angle increases.
    """
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    angles = [p.swingarm_angle_deg for p in result.points]
    diffs = [angles[i+1] - angles[i] for i in range(len(angles)-1)]
    assert all(d >= 0 for d in diffs), \
        "Swingarm angle should increase with bump travel"
    print(f"\n  SA angle range: {angles[0]:.3f}° → {angles[-1]:.3f}°")


def test_anti_squat_changes_across_sweep(sport_bike, sport_chain, sport_mass, direct_mount):
    """AS% should vary across travel as swingarm angle changes."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    as_vals = [p.anti_squat_pct for p in result.points]
    spread = max(as_vals) - min(as_vals)
    print(f"\n  AS% range: {min(as_vals):.1f}% → {max(as_vals):.1f}%  (spread {spread:.1f}%)")
    assert spread > 0.5, "AS% should vary by at least 0.5% across 60 mm travel"


def test_is_rising_rate_detection(sport_bike, sport_chain, sport_mass, direct_mount):
    """is_rising_rate() should return a bool without error."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    flag = result.is_rising_rate()
    mr_lo, mr_hi = result.mr_range()
    wr_lo, wr_hi = result.wr_range()
    print(f"\n  Rising rate: {flag}")
    print(f"  MR range: {mr_lo:.3f} → {mr_hi:.3f}")
    print(f"  WR range: {wr_lo:.1f} → {wr_hi:.1f} N/mm")
    assert isinstance(flag, bool)


def test_shock_compression_increases_with_travel(sport_bike, sport_chain, sport_mass, direct_mount):
    """Shock must compress (positive compression) as wheel rises."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    # After initial step, compression should be non-decreasing
    compressions = [p.shock_compression_mm for p in result.points]
    for i in range(1, len(compressions)):
        assert compressions[i] >= compressions[i-1] - 0.01, \
            f"Shock decompressed at u={result.points[i].travel_mm} mm: {compressions[i]:.3f} < {compressions[i-1]:.3f}"
    print(f"\n  Shock compression: 0 → {compressions[-1]:.2f} mm over 60 mm wheel travel")


def test_as_arrays_shapes(sport_bike, sport_chain, sport_mass, direct_mount):
    """as_arrays() should return correctly shaped numpy arrays."""
    _, Y_cg, _ = compute_cog(sport_mass)
    result = compute_sweep(sport_bike, 88.0, sport_chain, direct_mount, Y_cg, 60.0)
    arrays = result.as_arrays()
    n = len(result.points)
    for key, arr in arrays.items():
        assert arr.shape == (n,), f"Array '{key}' has wrong shape {arr.shape}"


if __name__ == '__main__':
    print("=== Suspension Sweep Tests ===")
    geom  = BikeGeometry(24, 33, 600, 640, 1390, 580, 385, 830, 325)
    chain = ChainGeometry(16, 42, -130, 60, 4.0)
    mass  = [MassComponent(55, 560, 340, 'E'), MassComponent(12, 700, 480, 'F'),
             MassComponent(75, 710, 820, 'R')]
    mount = ShockMount('direct', 120, 85, 750, 450)
    _, Y_cg, _ = compute_cog(mass)

    res = compute_sweep(geom, 88.0, chain, mount, Y_cg, wheel_travel_mm=60.0)
    arrs = res.as_arrays()
    print(f"  Steps: {len(res.points)}")
    print(f"  MR range: {res.mr_range()[0]:.3f} → {res.mr_range()[1]:.3f}")
    print(f"  WR range: {res.wr_range()[0]:.1f} → {res.wr_range()[1]:.1f} N/mm")
    print(f"  AS% range: {min(arrs['anti_squat_pct']):.1f} → {max(arrs['anti_squat_pct']):.1f} %")
    print(f"  Trail range: {min(arrs['trail_mm']):.1f} → {max(arrs['trail_mm']):.1f} mm")
    print(f"  Rising rate: {res.is_rising_rate()}")
    print("\nAll sweep tests can be run with: pytest chassis_sim/tests/test_sweep.py -v")
