"""
Phase 1 Benchmark 2 — Slider-Crank Mechanism

Validates:
  1. Constraint violations remain bounded
  2. Slider stays on x-axis (y ≈ 0, theta ≈ 0)
  3. Energy conservation (no driving torque — conservative motion)

Physical setup:
  - Crank:   length r=0.10 m, pivoted at origin
  - Coupler: length l=0.30 m
  - Slider:  moves along x-axis; constrained y=0, theta=0

All links: mass m=0.5 kg, thin rod inertia I=mL²/12.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
import pytest
from mbd_engine.core.body import RigidBody2D
from mbd_engine.core.constraints.revolute2d import RevoluteJoint2D
from mbd_engine.core.assembler import Assembler2D
from mbd_engine.core.integrator import RK4Integrator


def to_local(body, world_pt):
    """Transform world_pt into body's local frame."""
    c_, s_ = np.cos(body.theta), np.sin(body.theta)
    RT = np.array([[c_, s_], [-s_, c_]])
    return RT @ (np.asarray(world_pt) - np.array([body.x, body.y]))


class _SliderGuide:
    """Inline constraint: slider.y = 0 and slider.theta = 0."""
    N_CONSTRAINTS = 2

    def __init__(self, slider: RigidBody2D, name: str = 'slider_guide'):
        self.slider = slider
        self.name   = name
        self.row_start = -1

    def phi(self):
        return np.array([self.slider.y, self.slider.theta])

    def phi_q(self, n_dof):
        J = np.zeros((2, n_dof))
        d = self.slider.dof_start
        J[0, d + 1] = 1.0   # ∂(y)/∂y
        J[1, d + 2] = 1.0   # ∂(theta)/∂theta
        return J

    def gamma(self):
        return np.zeros(2)

    def phi_dot(self, n_dof, QD):
        return self.phi_q(n_dof) @ QD

    def __repr__(self):
        return f"SliderGuide('{self.name}')"


def build_slider_crank(r=0.10, l=0.30, m=0.5,
                       theta_crank0=np.radians(30)):
    """Build a slider-crank mechanism.

    Joints:
        A: crank pivot at world origin (grounded revolute)
        B: crank tip ↔ coupler left end (body-to-body revolute)
        C: coupler right end ↔ slider (body-to-body revolute at slider CoM)
        G: slider guide — y=0 and theta=0 (inline constraints)
    """
    # World-frame joint positions
    A_w = np.array([0.0, 0.0])                              # crank pivot
    B_w = r * np.array([np.cos(theta_crank0), np.sin(theta_crank0)])  # crank tip

    # Coupler angle: slider is on x-axis so coupler end C must have y=0
    # C_w = [r·cosθ + l·cosφ, 0] with r·sinθ + l·sinφ = 0 → sinφ = -(r/l)sinθ
    sinphi = -(r / l) * np.sin(theta_crank0)
    phi    = np.arcsin(np.clip(sinphi, -1, 1))
    C_w    = np.array([r * np.cos(theta_crank0) + l * np.cos(phi), 0.0])

    # Body CoMs and orientations
    crank_com   = (A_w + B_w) / 2
    coupler_com = (B_w + C_w) / 2
    slider_com  = C_w.copy()   # slider CoM = coupler pin location

    theta_crank   = theta_crank0
    theta_coupler = np.arctan2(C_w[1] - B_w[1], C_w[0] - B_w[0])
    theta_slider  = 0.0

    ground  = RigidBody2D('ground',  0.0, 0.0, is_ground=True)
    crank   = RigidBody2D('crank',   m, m*r**2/12,
                          x=crank_com[0],   y=crank_com[1],   theta=theta_crank)
    coupler = RigidBody2D('coupler', m, m*l**2/12,
                          x=coupler_com[0], y=coupler_com[1], theta=theta_coupler)
    slider  = RigidBody2D('slider',  m, m*(0.05)**2/12,
                          x=slider_com[0],  y=0.0,            theta=theta_slider)

    # Assign DOF indices
    for idx, body in enumerate(b for b in [ground, crank, coupler, slider]
                                if not b.is_ground):
        body.dof_start = 3 * idx

    bodies = [ground, crank, coupler, slider]
    constraints, row = [], 0

    def grounded_rev(body, world_pt, nm):
        nonlocal row
        j = RevoluteJoint2D(body_i=body, body_j=None,
                            s_i=to_local(body, world_pt),
                            world_point=np.asarray(world_pt, dtype=float),
                            name=nm)
        j.row_start = row; row += 2; constraints.append(j)

    def body_rev(bi, bj, world_pt, nm):
        nonlocal row
        j = RevoluteJoint2D(body_i=bi, body_j=bj,
                            s_i=to_local(bi, world_pt),
                            s_j=to_local(bj, world_pt),
                            name=nm)
        j.row_start = row; row += 2; constraints.append(j)

    grounded_rev(crank, A_w, 'A')          # crank pivot
    body_rev(crank, coupler, B_w, 'B')     # crank tip ↔ coupler
    body_rev(coupler, slider, C_w, 'C')    # coupler end ↔ slider

    guide = _SliderGuide(slider, name='G')
    guide.row_start = row; row += 2; constraints.append(guide)

    asm   = Assembler2D(bodies=bodies, constraints=constraints,
                        g=9.81, alpha_baum=50.0, beta_baum=50.0)
    integ = RK4Integrator(assembler=asm, dt=5e-4)
    return asm, integ


def test_slider_crank_initial_closure():
    """Initial constraint violation must be near machine epsilon."""
    asm, _ = build_slider_crank()
    viol = asm.constraint_violation()
    print(f"\n  Slider-crank initial ‖Φ‖∞ = {viol:.2e} m")
    assert viol < 1e-10, f"Geometry setup error: initial violation = {viol:.2e}"


def test_slider_crank_constraint_violation():
    """All constraints stay < 1e-3 m over 3 seconds."""
    asm, integ = build_slider_crank()
    res = integ.simulate(t_end=3.0, dt=5e-4)
    max_viol = np.max(res['constraint_violation'])
    print(f"\n  Slider-crank max ‖Φ‖∞ = {max_viol:.2e} m")
    assert max_viol < 1e-3, f"Constraint violation {max_viol:.2e} too large"


def test_slider_crank_slider_on_axis():
    """Slider y-coordinate stays < 1e-3 m from x-axis."""
    asm, integ = build_slider_crank()
    res = integ.simulate(t_end=3.0, dt=5e-4)
    # Slider is body index 2 → dof_start = 6; y = col 7
    y_slider = res['Q'][:, 7]
    max_y = np.max(np.abs(y_slider))
    print(f"\n  Slider max |y| = {max_y:.2e} m")
    assert max_y < 1e-3, f"Slider left axis: max|y| = {max_y:.2e} m"


def test_slider_crank_energy_conservation():
    """Energy drift < 1% over 3 seconds."""
    asm, integ = build_slider_crank()
    res = integ.simulate(t_end=3.0, dt=5e-4)
    max_drift = np.max(np.abs(res['energy_rel_error']))
    print(f"\n  Slider-crank energy drift = {max_drift*100:.4f}%")
    assert max_drift < 0.01, f"Energy drift {max_drift*100:.4f}% exceeds 1%"


if __name__ == '__main__':
    print("=== Slider-Crank Benchmarks ===")
    test_slider_crank_initial_closure()
    print("  ✓ Initial closure")
    test_slider_crank_constraint_violation()
    print("  ✓ Constraint violation")
    test_slider_crank_slider_on_axis()
    print("  ✓ Slider on axis")
    test_slider_crank_energy_conservation()
    print("  ✓ Energy conservation")
    print("\nAll slider-crank benchmarks PASSED.")
