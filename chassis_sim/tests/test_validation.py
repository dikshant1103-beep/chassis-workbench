"""
chassis_sim/tests/test_validation.py — Phase 6: Real Bike Validation

Validates chassis geometry engine against published manufacturer specs
for five production sport bikes. Tolerances are based on typical
measurement uncertainty in factory data (±2–5 mm).

Sources:
  Yamaha R1 (2015)             — Yamaha press kit
  Kawasaki ZX-10R (2016)       — Kawasaki press kit
  Honda CBR1000RR-R (2020)     — Honda press kit
  BMW S1000RR (2019)           — BMW Motorrad press kit
  Suzuki GSX-R1000 (2017)      — Suzuki press kit
  Ducati Panigale V4S (2018)   — Ducati press kit
"""

import math
import pytest
from chassis_sim.geometry import BikeGeometry, compute_trail, compute_mechanical_trail

# ── Validation helpers ────────────────────────────────────────────────────────

def make_geom(rake_deg: float, offset_mm: float, wheel_dia_mm: float = 600.0) -> BikeGeometry:
    """Minimal geometry object for trail computation (other dims set to sane defaults)."""
    return BikeGeometry(
        head_angle_deg=rake_deg,
        fork_offset_mm=offset_mm,
        front_wheel_dia_mm=wheel_dia_mm,
        rear_wheel_dia_mm=604.0,
        wheelbase_mm=1415.0,
        swingarm_length_mm=560.0,
        swingarm_pivot_height_mm=390.0,
        swingarm_pivot_x_mm=855.0,
        rear_axle_height_mm=302.0,
    )


# ── Yamaha R1 (2015) ──────────────────────────────────────────────────────────
# Published specs: rake=24.0°, offset=25mm, trail=102mm
# Note: Yamaha uses a 120/70 ZR17 front → dia≈598mm, R_f=299mm

class TestYamahaR1:
    rake    = 24.0
    offset  = 25.0
    R_f     = 299.0          # mm
    pub_trail = 102.0        # mm (published)
    tol     = 5.0            # mm tolerance

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"Yamaha R1 trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0

    def test_mechanical_trail_greater_than_trail(self):
        """MT = T/cos(α) > T for any non-zero rake."""
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T  = compute_trail(g)
        MT = compute_mechanical_trail(T, self.rake)
        assert MT > T


# ── Kawasaki ZX-10R (2016) ────────────────────────────────────────────────────
# Published specs: rake=25.0°, offset=30mm, trail=107mm

class TestKawasakiZX10R:
    rake      = 25.0
    offset    = 30.0
    R_f       = 299.0
    pub_trail = 107.0
    tol       = 5.0

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"ZX-10R trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0


# ── Honda CBR1000RR-R (2020) ─────────────────────────────────────────────────
# Published specs: rake=24.0°, offset=33mm, trail=96mm

class TestHondaCBR1000RRR:
    rake      = 24.0
    offset    = 33.0
    R_f       = 299.0
    pub_trail = 96.0
    tol       = 5.0

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"CBR1000RR-R trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0

    def test_more_offset_less_trail_than_zx10r(self):
        """Higher offset → less trail, all else equal (same rake)."""
        g_honda  = make_geom(24.0, 33.0, self.R_f * 2)
        g_yamaha = make_geom(24.0, 25.0, self.R_f * 2)
        assert compute_trail(g_honda) < compute_trail(g_yamaha)


# ── BMW S1000RR (2019) ────────────────────────────────────────────────────────
# Published specs: rake=23.9°, offset=30mm, trail=100.3mm

class TestBMWS1000RR:
    rake      = 23.9
    offset    = 30.0
    R_f       = 299.0
    pub_trail = 100.3
    tol       = 5.0

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"BMW S1000RR trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0


# ── Suzuki GSX-R1000 (2017) ───────────────────────────────────────────────────
# Published specs: rake=23.0°, offset=31mm, trail=94mm

class TestSuzukiGSXR1000:
    rake      = 23.0
    offset    = 31.0
    R_f       = 299.0
    pub_trail = 94.0
    tol       = 5.0

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"GSX-R1000 trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0

    def test_lower_rake_less_trail_than_zx10r(self):
        """Lower rake → shorter trail, all else equal (same offset)."""
        g_suzuki = make_geom(23.0, 31.0, self.R_f * 2)
        g_zx10r  = make_geom(25.0, 31.0, self.R_f * 2)
        assert compute_trail(g_suzuki) < compute_trail(g_zx10r)


# ── Ducati Panigale V4S (2018) ────────────────────────────────────────────────
# Published specs: rake=24.5°, offset=34mm, trail=99mm

class TestDucatiPanigaleV4S:
    rake      = 24.5
    offset    = 34.0
    R_f       = 299.0
    pub_trail = 99.0
    tol       = 5.0

    def test_trail_within_tolerance(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        T = compute_trail(g)
        assert abs(T - self.pub_trail) < self.tol, (
            f"Panigale V4S trail: computed {T:.1f} mm, published {self.pub_trail} mm"
        )

    def test_trail_positive(self):
        g = make_geom(self.rake, self.offset, self.R_f * 2)
        assert compute_trail(g) > 0.0


# ── Cross-bike monotonicity checks ────────────────────────────────────────────

class TestCrossBikeMonotonicity:
    """Formula-level sanity checks using real bike parameter ranges."""

    def test_trail_increases_with_rake(self):
        """Larger rake → more trail (offset constant at 30mm)."""
        trails = [compute_trail(make_geom(r, 30.0)) for r in [20, 22, 24, 26, 28]]
        assert all(trails[i+1] > trails[i] for i in range(len(trails)-1))

    def test_trail_decreases_with_offset(self):
        """Larger offset → less trail (rake constant at 24°)."""
        trails = [compute_trail(make_geom(24.0, o)) for o in [20, 25, 30, 35, 40]]
        assert all(trails[i+1] < trails[i] for i in range(len(trails)-1))

    def test_all_sport_bikes_trail_in_range(self):
        """All real sport bikes: trail in 80–130 mm (Foale Ch.2 typical range)."""
        bikes = [
            (24.0, 25.0, 299.0),   # R1
            (25.0, 30.0, 299.0),   # ZX-10R
            (24.0, 33.0, 299.0),   # CBR1000RR-R
            (23.9, 30.0, 299.0),   # S1000RR
            (23.0, 31.0, 299.0),   # GSX-R1000
            (24.5, 34.0, 299.0),   # Panigale V4S
        ]
        for (rake, offset, Rf) in bikes:
            T = compute_trail(make_geom(rake, offset, Rf * 2))
            assert 80.0 < T < 130.0, (
                f"rake={rake}° offset={offset}mm → trail={T:.1f} mm out of 80–130 mm range"
            )
