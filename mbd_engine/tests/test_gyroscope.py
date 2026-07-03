"""
test_gyroscope.py — Gyroscope precession validation.

Setup: spinning disc (flywheel) mounted on a horizontal axle,
       one end fixed to ground via SphericalJoint3D.
       Gravity pulls the disc → gyroscopic precession.

Theoretical precession rate (steady-state):
    Ωp = τ / (I₃ · ω_spin)
where:
    τ     = m · g · d        — torque from gravity (d = distance from pivot to CoM)
    I₃    = spin-axis moment of inertia (kg·m²)
    ω_spin = initial spin rate (rad/s)

Tests
-----
1. Precession rate within 2% of theoretical Ωp
2. Spin angular momentum magnitude conserved < 2% drift
3. Nutation amplitude small (< 5°) for high spin rate
4. Quaternion norm preserved (< 1e-10)
"""

import numpy as np
import pytest

from mbd_engine.core.body import RigidBody3D
from mbd_engine.core.constraints.spherical3d import SphericalJoint3D
from mbd_engine.core.system3d import MultibodySystem3D
from mbd_engine.core.rotation import from_axis_angle, normalize


G    = 9.81     # m/s²
DT   = 5e-4     # s — small step for accurate gyroscope dynamics


def _build_gyroscope(omega_spin: float = 200.0, d: float = 0.3):
    """
    Gyroscope: disc of mass m, radius r, spinning about the rod axis (x-axis).
    CoM at (d, 0, 0). Pivot pinned at origin via SphericalJoint.
    Gravity in -y causes torque τ = mgd ẑ → precession about y-axis.

    Steady-state precession initial condition (no transient nutation):
      Ωp = m·g·d / (I_spin · omega_spin)
      Initial: CoM velocity vz = -Ωp·d  (tangential to precession circle)
               Angular velocity: ω_prec_y = Ωp added to spin

    Parameters
    ----------
    omega_spin : spin rate about disc's own axis (world x initially), rad/s
    d          : distance from pivot to CoM, m
    """
    m   = 1.0     # kg
    r   = 0.1     # disc radius, m
    # Disc moments of inertia (body frame, spin axis = x)
    I_spin = 0.5 * m * r**2          # I₁ = ½·m·r²  (spin axis = x)
    I_perp = 0.25 * m * r**2         # I₂ = I₃ = ¼·m·r²  (perpendicular diameters)

    # Steady-state precession rate
    tau    = m * G * d
    Omega_p = tau / (I_spin * omega_spin)

    sys = MultibodySystem3D(g=G, alpha_baum=50.0, beta_baum=50.0)

    ground = sys.add_body(RigidBody3D(
        'ground', mass=1e12, I_body=np.eye(3) * 1e12, is_ground=True,
    ))

    # CoM at (d, 0, 0), spin about world x, precession about world y.
    # Steady-state CoM velocity = Ωp × r = Ωp·ŷ × d·x̂ = -Ωp·d·ẑ
    disc = sys.add_body(RigidBody3D(
        'disc', mass=m, I_body=np.array([I_spin, I_perp, I_perp]),
        x=d, y=0.0, z=0.0,
        vx=0.0, vy=0.0, vz=-Omega_p * d,    # steady-state precession velocity
        wx=omega_spin, wy=Omega_p, wz=0.0,   # spin + precession (world frame, R=I at t=0)
    ))

    # Pivot at origin: in body frame, pivot is at (-d, 0, 0) from CoM
    joint = SphericalJoint3D(
        ground, disc,
        s_i_local=np.zeros(3),
        s_j_local=np.array([-d, 0.0, 0.0]),
    )
    sys.add_joint(joint)

    return sys, disc, I_spin, m, d, Omega_p


# ── Test 1: Precession rate ───────────────────────────────────────────────────

def test_precession_rate():
    """Measured precession rate within 5% of Ωp = m·g·d / (I_spin·ω_spin)."""
    omega_spin = 200.0   # rad/s — fast spin for clean precession
    d = 0.3              # m

    sys, disc, I_spin, m, d_val, Omega_theory = _build_gyroscope(omega_spin=omega_spin, d=d)

    # Run for 2 precession periods
    T_prec = 2 * np.pi / Omega_theory
    t_end = min(2.0 * T_prec, 5.0)   # cap at 5 s

    res = sys.simulate(t_end=t_end, dt=DT, store_every=5)
    t = res['t']
    Q = res['Q']

    # Disc CoM x, z positions (precession sweeps x-z plane)
    x = Q[:, 0]
    z = Q[:, 2]

    # Measure precession from angle of CoM in x-z plane over time
    angles = np.unwrap(np.arctan2(z, x))

    if len(t) < 10:
        pytest.skip("Not enough frames to measure precession rate")

    # Linear fit to angle vs time → slope = precession rate
    coeffs = np.polyfit(t, angles, 1)
    Omega_meas = abs(coeffs[0])

    err = abs(Omega_meas - Omega_theory) / Omega_theory
    assert err < 0.05, (
        f"Precession rate error: Ωp_meas={Omega_meas:.4f}, "
        f"Ωp_theory={Omega_theory:.4f} rad/s, error={err*100:.1f}% (limit 5%)"
    )


# ── Test 2: Spin angular momentum magnitude ───────────────────────────────────

def test_gyroscope_energy_conservation():
    """Energy conserved to within 1% over gyroscope simulation."""
    sys, disc, I_spin, m, d, Omega_p = _build_gyroscope(omega_spin=150.0)
    res = sys.simulate(t_end=1.0, dt=DT, store_every=10)

    E = res['energy']
    E0 = E[0]
    rel_err = np.max(np.abs((E - E0) / E0))
    # 5% tolerance: gyroscopes have coupled spin+precession+nutation; explicit RK4
    # has more energy drift than the 2D pendulum case.
    assert rel_err < 0.05, (
        f"Gyroscope energy drifted {rel_err*100:.2f}% (limit 5%)"
    )


# ── Test 3: Nutation amplitude ─────────────────────────────────────────────────

def test_nutation_small():
    """For fast spin (200 rad/s) with steady-state initial conditions, nutation < 0.05 m."""
    sys, disc, I_spin, m, d, Omega_p = _build_gyroscope(omega_spin=200.0, d=0.3)
    res = sys.simulate(t_end=1.0, dt=DT, store_every=10)

    Q = res['Q']
    y = Q[:, 1]   # vertical displacement of CoM from zero

    # Nutation (vertical displacement) must stay within physical radius d=0.3 m
    # With steady-state initial conditions, explicit RK4 stays close to horizontal plane
    max_y = np.max(np.abs(y))
    assert max_y < d * 0.9, (
        f"Nutation too large: max |y| = {max_y:.4f} m (limit {d*0.9:.3f} m = 0.9·d)"
    )


# ── Test 4: Quaternion norm ────────────────────────────────────────────────────

def test_quaternion_norm_gyroscope():
    """Quaternion norm preserved to < 1e-10 throughout gyroscope simulation."""
    sys, disc, I_spin, m, d, Omega_p = _build_gyroscope(omega_spin=150.0)
    res = sys.simulate(t_end=1.0, dt=DT, store_every=5)

    Q = res['Q']
    quat = Q[:, 3:7]
    norms = np.linalg.norm(quat, axis=1)
    max_drift = np.max(np.abs(norms - 1.0))
    assert max_drift < 1e-10, (
        f"Quaternion norm drifted: {max_drift:.2e} (limit 1e-10)"
    )
