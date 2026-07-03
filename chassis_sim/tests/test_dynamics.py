"""
chassis_sim/tests/test_dynamics.py — Phase 3 Dynamics Sweep Tests

Tests weight transfer, anti-dive, fork compression, rear extension,
and acceleration sweep against first-principles formulas.
"""

import math
import pytest
from chassis_sim.dynamics import (
    compute_dynamics_sweep,
    _weight_transfer,
    _anti_dive_pct,
    BrakePoint, AccelPoint,
)
from chassis_sim.geometry import BikeGeometry, MassComponent, ChainGeometry

G = 9.81


# ── Shared fixture ─────────────────────────────────────────────────────────────

@pytest.fixture
def sport_bike():
    """Yamaha R1-class geometry: 200 kg, 1415 mm WB, CoG at 600mm / 550mm."""
    geom = BikeGeometry(
        head_angle_deg=24.0,
        fork_offset_mm=30.0,
        front_wheel_dia_mm=600.0,
        rear_wheel_dia_mm=604.0,
        wheelbase_mm=1415.0,
        swingarm_length_mm=560.0,
        swingarm_pivot_height_mm=390.0,
        swingarm_pivot_x_mm=855.0,
        rear_axle_height_mm=302.0,
    )
    components = [
        MassComponent(mass_kg=180.0, x_mm=600.0, y_mm=550.0, label="bike_mass"),
        MassComponent(mass_kg=20.0,  x_mm=500.0, y_mm=850.0, label="rider"),
    ]
    chain = ChainGeometry(
        front_sprocket_teeth=17,
        rear_sprocket_teeth=42,
        sprocket_center_x_mm=-30.0,
        sprocket_center_y_mm=30.0,
        chain_force_angle_deg=2.0,
    )
    return geom, components, chain


# ── Unit-level formula tests ───────────────────────────────────────────────────

def test_weight_transfer_formula():
    """ΔW = m·a·Y_cg/WB — hand-calculated case."""
    # 200 kg, 1.0g, Y_cg=550mm, WB=1415mm
    # ΔW = 200 × 9.81 × (0.55/1.415) = 762.4 N
    dW = _weight_transfer(200.0, 1.0, 550.0, 1415.0)
    expected = 200.0 * 9.81 * (0.550 / 1.415)
    assert abs(dW - expected) < 0.1


def test_weight_transfer_zero_accel():
    """At 0g deceleration, no weight transfer."""
    dW = _weight_transfer(200.0, 0.0, 550.0, 1415.0)
    assert dW == 0.0


def test_anti_dive_formula():
    """AD% = tan(α) · (F_brake_front / W) · 100."""
    # α=24°, F_brake=1000N, W=2000N
    AD = _anti_dive_pct(24.0, 1000.0, 2000.0)
    expected = math.tan(math.radians(24.0)) * (1000.0 / 2000.0) * 100.0
    assert abs(AD - expected) < 0.01


def test_anti_dive_zero_braking():
    """At 0 N braking force, AD% = 0."""
    AD = _anti_dive_pct(24.0, 0.0, 2000.0)
    assert AD == 0.0


# ── compute_dynamics_sweep integration tests ──────────────────────────────────

def test_sweep_returns_correct_types(sport_bike):
    """Sweep returns DynamicsSweepResults with braking and accel lists."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    assert len(res.braking) > 0
    assert len(res.accel) > 0
    assert isinstance(res.braking[0], BrakePoint)
    assert isinstance(res.accel[0], AccelPoint)


def test_zero_decel_equals_static(sport_bike):
    """At 0g braking: no weight transfer, loads match static balance."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    p0 = res.braking[0]
    assert p0.decel_g == pytest.approx(0.0)
    assert p0.weight_transfer_N == pytest.approx(0.0, abs=0.01)
    # R_front + R_rear ≈ W
    assert abs(p0.R_front_N + p0.R_rear_N - res.total_weight_N) < 1.0


def test_front_load_increases_under_braking(sport_bike):
    """R_front must increase monotonically with deceleration."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    fronts = [p.R_front_N for p in res.braking]
    assert all(fronts[i+1] >= fronts[i] for i in range(len(fronts)-1))


def test_rear_load_decreases_under_braking(sport_bike):
    """R_rear must decrease monotonically with deceleration."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    rears = [p.R_rear_N for p in res.braking]
    assert all(rears[i+1] <= rears[i] for i in range(len(rears)-1))


def test_fork_compression_positive_and_increasing(sport_bike):
    """Fork compresses under braking and increases with deceleration."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    comps_mm = [p.fork_compression_mm for p in res.braking]
    assert comps_mm[0] == pytest.approx(0.0, abs=0.01)
    assert all(comps_mm[i+1] >= comps_mm[i] for i in range(len(comps_mm)-1))


def test_rear_extension_positive_and_increasing(sport_bike):
    """Rear shock extends under braking (unloaded) and increases with decel."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    exts = [p.rear_extension_mm for p in res.braking]
    assert exts[0] == pytest.approx(0.0, abs=0.01)
    assert all(exts[i+1] >= exts[i] for i in range(len(exts)-1))


def test_anti_dive_increases_with_decel(sport_bike):
    """Anti-dive% increases with deceleration (more braking = more anti-dive effect)."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    ads = [p.anti_dive_pct for p in res.braking]
    assert ads[0] == pytest.approx(0.0, abs=0.01)
    assert all(ads[i+1] >= ads[i] for i in range(len(ads)-1))


def test_accel_front_load_decreases(sport_bike):
    """Under acceleration front load decreases (weight transfers to rear)."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    fronts = [p.R_front_N for p in res.accel]
    assert all(fronts[i+1] <= fronts[i] for i in range(len(fronts)-1))


def test_wheelie_margin_decreases_with_accel(sport_bike):
    """Wheelie margin (front load %) decreases towards 0 as acceleration increases."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    wm = [p.wheelie_margin_pct for p in res.accel]
    assert wm[0] == pytest.approx(100.0, abs=0.1)
    assert all(wm[i+1] <= wm[i] for i in range(len(wm)-1))


def test_as_arrays_braking_shapes(sport_bike):
    """as_arrays_braking returns numpy arrays with matching lengths."""
    import numpy as np
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    arrs = res.as_arrays_braking()
    n = len(arrs['decel_g'])
    for key, arr in arrs.items():
        assert isinstance(arr, np.ndarray), f"{key} should be ndarray"
        assert len(arr) == n, f"{key} length mismatch"


def test_as_arrays_accel_no_nan(sport_bike):
    """All accel arrays contain no NaN values."""
    import numpy as np
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(geom, comps, chain)
    arrs = res.as_arrays_accel()
    for key, arr in arrs.items():
        assert not np.any(np.isnan(arr)), f"NaN found in {key}"


def test_fork_compression_magnitude(sport_bike):
    """At 1g braking, fork compression should be in a physically realistic range (5–80 mm)."""
    geom, comps, chain = sport_bike
    res = compute_dynamics_sweep(
        geom, comps, chain,
        front_spring_rate_Nmm=20.0,
        decel_max_g=1.0, d_g=1.0,
    )
    # At 1g
    p = res.braking[-1]
    assert 5.0 < p.fork_compression_mm < 80.0, (
        f"Fork compression at 1g = {p.fork_compression_mm:.1f} mm — out of physical range"
    )
