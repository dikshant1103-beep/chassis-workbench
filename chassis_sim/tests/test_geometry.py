"""
chassis_sim/tests/test_geometry.py — Static geometry formula validation

All tests compare against published motorcycle specifications or
Foale/Cossalter worked examples.

References:
  Foale (2006) Motorcycle Handling and Chassis Design — Appendix A
  Cossalter (2006) Motorcycle Dynamics — Table 1.1
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import math
import pytest
from chassis_sim.geometry import (
    BikeGeometry, MassComponent, ChainGeometry,
    compute_trail, compute_mechanical_trail,
    compute_swingarm_angle_rad, compute_cog, compute_axle_loads,
    compute_instant_centre, compute_anti_squat_pct,
    compute_anti_squat_swingarm_only, compute_static,
)


# ── Shared sport-bike fixture ─────────────────────────────────────────────────

@pytest.fixture
def sport_bike():
    """Typical 600cc sport bike — matches 'sport' preset in families.ts."""
    return BikeGeometry(
        head_angle_deg=24.0,
        fork_offset_mm=33.0,
        front_wheel_dia_mm=600.0,   # R_f = 300 mm
        rear_wheel_dia_mm=640.0,
        wheelbase_mm=1390.0,
        swingarm_length_mm=580.0,
        swingarm_pivot_height_mm=385.0,
        swingarm_pivot_x_mm=830.0,
        rear_axle_height_mm=325.0,
    )


@pytest.fixture
def sport_chain():
    return ChainGeometry(
        front_sprocket_teeth=16,
        rear_sprocket_teeth=42,
        sprocket_center_x_mm=-130.0,
        sprocket_center_y_mm=60.0,
        chain_force_angle_deg=4.0,
    )


@pytest.fixture
def sport_mass():
    return [
        MassComponent(55, 560, 340, 'Engine'),
        MassComponent(12, 700, 480, 'Frame'),
        MassComponent(75, 710, 820, 'Rider'),
        MassComponent(10, 690, 340, 'Fuel'),
    ]


# ── Trail tests ───────────────────────────────────────────────────────────────

def test_trail_formula_sport(sport_bike):
    """Sport bike (α=24°, R_f=300, f=33) → trail ≈ 93–107 mm."""
    T = compute_trail(sport_bike)
    print(f"\n  Trail = {T:.2f} mm")
    assert 85 <= T <= 115, f"Trail {T:.1f} mm outside sport-bike range [85,115]"


def test_trail_formula_known_values():
    """
    Hand-verified: α=24°, R_f=310, f=25 → T = ?

    T = (310·sin(24°) − 25) / cos(24°)
      = (310·0.4067 − 25) / 0.9135
      = (126.1 − 25) / 0.9135
      = 101.1 / 0.9135 ≈ 110.6 mm
    """
    geom = BikeGeometry(
        head_angle_deg=24.0, fork_offset_mm=25.0,
        front_wheel_dia_mm=620.0, rear_wheel_dia_mm=640.0,
        wheelbase_mm=1400.0, swingarm_length_mm=580.0,
        swingarm_pivot_height_mm=380.0, swingarm_pivot_x_mm=820.0,
        rear_axle_height_mm=320.0,
    )
    T = compute_trail(geom)
    expected = (310 * math.sin(math.radians(24)) - 25) / math.cos(math.radians(24))
    print(f"\n  Trail = {T:.2f} mm, expected = {expected:.2f} mm")
    assert abs(T - expected) < 0.01


def test_trail_positive_for_stable_geometry(sport_bike):
    """Stable geometry must give positive trail."""
    assert compute_trail(sport_bike) > 0


def test_trail_decreases_with_more_offset():
    """More fork offset → less trail (steering gets lighter)."""
    geom1 = BikeGeometry(24, 25, 600, 640, 1390, 580, 385, 830, 325)
    geom2 = BikeGeometry(24, 40, 600, 640, 1390, 580, 385, 830, 325)
    assert compute_trail(geom1) > compute_trail(geom2)


def test_trail_increases_with_more_rake():
    """More rake → more trail."""
    geom1 = BikeGeometry(22, 33, 600, 640, 1390, 580, 385, 830, 325)
    geom2 = BikeGeometry(28, 33, 600, 640, 1390, 580, 385, 830, 325)
    assert compute_trail(geom1) < compute_trail(geom2)


def test_mechanical_trail_gt_geometric(sport_bike):
    """Mechanical trail > geometric trail for α > 0."""
    T = compute_trail(sport_bike)
    MT = compute_mechanical_trail(T, sport_bike.head_angle_deg)
    alpha = sport_bike.head_angle_deg
    print(f"\n  T={T:.2f}  MT={MT:.2f}  ratio={MT/T:.4f}  (expected 1/cos({alpha}°)={1/math.cos(math.radians(alpha)):.4f})")
    assert MT > T
    assert abs(MT - T / math.cos(math.radians(alpha))) < 0.01


# ── Swingarm angle tests ──────────────────────────────────────────────────────

def test_swingarm_angle_negative_for_typical_bike(sport_bike):
    """Typical bike: rear axle below pivot → angle is negative."""
    theta = compute_swingarm_angle_rad(sport_bike)
    deg = math.degrees(theta)
    print(f"\n  Swingarm angle = {deg:.3f}°")
    assert theta < 0, f"Expected negative angle, got {deg:.3f}°"


def test_swingarm_angle_range(sport_bike):
    """Sport bikes: swingarm angle typically −2° to −8°."""
    deg = math.degrees(compute_swingarm_angle_rad(sport_bike))
    assert -10 <= deg <= 0, f"Angle {deg:.2f}° outside expected range"


def test_swingarm_angle_formula():
    """Verify atan2 formula against hand calculation."""
    geom = BikeGeometry(24, 33, 600, 640, 1390, 580,
                        swingarm_pivot_height_mm=380,
                        swingarm_pivot_x_mm=820,
                        rear_axle_height_mm=320)
    theta = compute_swingarm_angle_rad(geom)
    expected = math.atan2(320 - 380, 580)
    assert abs(theta - expected) < 1e-9


# ── CoG tests ─────────────────────────────────────────────────────────────────

def test_cog_basic(sport_mass):
    X_cg, Y_cg, total = compute_cog(sport_mass)
    print(f"\n  X_cg={X_cg:.1f} mm  Y_cg={Y_cg:.1f} mm  total={total:.1f} kg")
    assert total == pytest.approx(sum(c.mass_kg for c in sport_mass))
    assert 400 <= X_cg <= 900, "CoG x position unreasonable"
    assert 200 <= Y_cg <= 700, "CoG height unreasonable"


def test_axle_loads_sum_to_weight(sport_mass, sport_bike):
    X_cg, _, total = compute_cog(sport_mass)
    R_f, R_r, pct = compute_axle_loads(total, X_cg, sport_bike.wheelbase_mm)
    G = 9.81
    assert abs(R_f + R_r - total * G) < 0.01, "Axle loads don't sum to total weight"


def test_axle_loads_front_percent(sport_mass, sport_bike):
    X_cg, _, total = compute_cog(sport_mass)
    R_f, R_r, pct_f = compute_axle_loads(total, X_cg, sport_bike.wheelbase_mm)
    pct_r = 100 - pct_f
    print(f"\n  Front {pct_f:.1f}% / Rear {pct_r:.1f}%")
    assert 35 <= pct_f <= 65, f"Front% {pct_f:.1f} outside expected range"
    assert abs(pct_f + pct_r - 100) < 0.001


# ── Anti-squat swingarm-only correction test ──────────────────────────────────

def test_anti_squat_swingarm_only_sign(sport_bike):
    """
    Corrected formula must give POSITIVE contribution for typical θ_sa < 0.

    Previous (wrong) formula gave negative result.
    """
    theta_sa = compute_swingarm_angle_rad(sport_bike)
    assert theta_sa < 0, "Precondition: swingarm angle is negative"

    AS_sa = compute_anti_squat_swingarm_only(theta_sa, sport_bike.wheelbase_mm, Y_cg_mm=500)
    print(f"\n  θ_sa={math.degrees(theta_sa):.2f}°  AS_swingarm_only={AS_sa:.2f}%")
    assert AS_sa > 0, f"AS swingarm-only must be positive, got {AS_sa:.2f}%"


def test_anti_squat_swingarm_only_magnitude():
    """
    For θ_sa = −5°, WB = 1380, Y_cg = 520:
    AS_sa = −tan(−5°) × 1380 / 520 × 100
          = 0.0875 × 1380 / 520 × 100 ≈ 23.2%
    """
    theta_sa_rad = math.radians(-5)
    WB = 1380.0
    Y_cg = 520.0
    AS_sa = compute_anti_squat_swingarm_only(theta_sa_rad, WB, Y_cg)
    expected = -math.tan(theta_sa_rad) * WB / Y_cg * 100
    print(f"\n  AS_swingarm_only = {AS_sa:.3f}%  expected = {expected:.3f}%")
    assert abs(AS_sa - expected) < 0.001
    assert 15 <= AS_sa <= 35, f"Magnitude {AS_sa:.1f}% out of expected range [15,35]"


def test_anti_squat_full_greater_than_swingarm_only(sport_bike, sport_chain, sport_mass):
    """Full AS% (with chain) must exceed swingarm-only (chain adds to it)."""
    X_cg, Y_cg, total = compute_cog(sport_mass)
    theta_sa = compute_swingarm_angle_rad(sport_bike)
    IC_x, IC_y = compute_instant_centre(sport_bike, sport_chain, theta_sa)
    AS_full = compute_anti_squat_pct(IC_x, IC_y, Y_cg, sport_bike.wheelbase_mm)
    AS_sa   = compute_anti_squat_swingarm_only(theta_sa, sport_bike.wheelbase_mm, Y_cg)
    print(f"\n  AS_full={AS_full:.1f}%  AS_swingarm_only={AS_sa:.1f}%  chain={AS_full-AS_sa:.1f}%")
    assert AS_full > AS_sa, "Chain should increase anti-squat above swingarm-only"


def test_static_compute_runs(sport_bike, sport_chain, sport_mass):
    """Full static compute should run without error."""
    res = compute_static(sport_bike, sport_mass, sport_chain)
    print(f"\n  Trail={res.trail_mm:.1f}mm  AS={res.anti_squat_pct:.1f}%  "
          f"Chain={res.chain_contribution_pct:.1f}%  F%={res.front_pct:.1f}%")
    assert res.trail_mm > 0
    assert res.anti_squat_pct > 0
    assert res.chain_contribution_pct > 0


if __name__ == '__main__':
    print("=== Geometry Formula Tests ===")
    b = BikeGeometry(24, 33, 600, 640, 1390, 580, 385, 830, 325)
    c = ChainGeometry(16, 42, -130, 60, 4.0)
    m = [MassComponent(55, 560, 340, 'Engine'), MassComponent(12, 700, 480, 'Frame'),
         MassComponent(75, 710, 820, 'Rider'), MassComponent(10, 690, 340, 'Fuel')]
    res = compute_static(b, m, c)
    print(f"  Trail         = {res.trail_mm:.2f} mm")
    print(f"  SA angle      = {res.swingarm_angle_deg:.3f}°")
    print(f"  AS%           = {res.anti_squat_pct:.2f}%")
    print(f"  AS swingarm   = {res.anti_squat_swingarm_only_pct:.2f}%")
    print(f"  Chain contrib = {res.chain_contribution_pct:.2f}%")
    print(f"  Front %       = {res.front_pct:.2f}%")
    print(f"  CoG height    = {res.Y_cg_mm:.1f} mm")
    print("\nAll geometry tests can be run with: pytest chassis_sim/tests/test_geometry.py -v")
