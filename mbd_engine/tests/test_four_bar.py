"""
Phase 1 Benchmark 3 — Four-Bar Linkage

Validates:
  1. DOF count: 3 bodies × 3 DOF − 4 revolute × 2 = 1 free DOF
  2. All joints remain assembled (constraint violation < threshold)
  3. Energy conservation (conservative, no driving torque)
  4. Grashof condition check

Physical setup:
  - Ground link: d = 0.40 m (from A at origin to D at (d,0))
  - Crank link:  a = 0.15 m  (A → B)
  - Coupler:     b = 0.35 m  (B → C)
  - Follower:    c = 0.30 m  (D → C)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
import pytest
from scipy.optimize import fsolve

from mbd_engine.core.body import RigidBody2D
from mbd_engine.core.constraints.revolute2d import RevoluteJoint2D
from mbd_engine.core.assembler import Assembler2D
from mbd_engine.core.integrator import RK4Integrator


def four_bar_closure(a, b, c, d, theta2):
    """Solve four-bar loop-closure numerically.

    Vector loop: A→B + B→C = A→D + D→C
      a*[cosθ2, sinθ2] + b*[cosθ3, sinθ3] = [d, 0] + c*[cosθ4, sinθ4]

    Returns (theta3, theta4) or None if unreachable.
    """
    A_w = np.array([0.0, 0.0])
    D_w = np.array([d,   0.0])
    B_w = A_w + a * np.array([np.cos(theta2), np.sin(theta2)])

    def residual(angles):
        t3, t4 = angles
        C_from_B = B_w + b * np.array([np.cos(t3), np.sin(t3)])
        C_from_D = D_w + c * np.array([np.cos(t4), np.sin(t4)])
        return C_from_B - C_from_D

    # Initial guess: midpoint heuristic
    mid = (B_w + D_w) / 2
    t3g = np.arctan2(mid[1] - B_w[1], mid[0] - B_w[0])
    t4g = np.arctan2(mid[1] - D_w[1], mid[0] - D_w[0])

    sol, _, ier, _ = fsolve(residual, [t3g, t4g], full_output=True)
    if ier != 1 or np.max(np.abs(residual(sol))) > 1e-8:
        return None
    return float(sol[0]), float(sol[1])


def to_local(body, world_pt):
    """Transform world_pt to body's local frame."""
    c_, s_ = np.cos(body.theta), np.sin(body.theta)
    RT = np.array([[c_, s_], [-s_, c_]])
    return RT @ (np.asarray(world_pt) - np.array([body.x, body.y]))


def build_four_bar(a=0.15, b=0.35, c=0.30, d=0.40,
                   theta2_0=np.radians(45), m=0.3):
    """Build a four-bar linkage MBD model with correctly computed geometry."""

    result = four_bar_closure(a, b, c, d, theta2_0)
    assert result is not None, "Initial configuration unreachable for given link lengths"
    theta3_0, theta4_0 = result

    # World-frame joint points
    A_w = np.array([0.0, 0.0])
    B_w = A_w + a * np.array([np.cos(theta2_0), np.sin(theta2_0)])
    D_w = np.array([d, 0.0])
    C_w = D_w + c * np.array([np.cos(theta4_0), np.sin(theta4_0)])

    # Verify closure
    assert np.allclose(B_w + b * np.array([np.cos(theta3_0), np.sin(theta3_0)]), C_w, atol=1e-8), \
        "Loop closure check failed"

    # Body CoMs and orientations
    theta_crank    = np.arctan2(B_w[1] - A_w[1], B_w[0] - A_w[0])
    theta_coupler  = np.arctan2(C_w[1] - B_w[1], C_w[0] - B_w[0])
    theta_follower = np.arctan2(C_w[1] - D_w[1], C_w[0] - D_w[0])

    crank_com    = (A_w + B_w) / 2
    coupler_com  = (B_w + C_w) / 2
    follower_com = (D_w + C_w) / 2

    # Link inertias (slender rods: I = mL²/12)
    ground   = RigidBody2D('ground',  0.0, 0.0, is_ground=True)
    crank    = RigidBody2D('crank',   m, m*a**2/12,
                           x=crank_com[0],    y=crank_com[1],    theta=theta_crank)
    coupler  = RigidBody2D('coupler', m, m*b**2/12,
                           x=coupler_com[0],  y=coupler_com[1],  theta=theta_coupler)
    follower = RigidBody2D('follower',m, m*c**2/12,
                           x=follower_com[0], y=follower_com[1], theta=theta_follower)

    # Assign DOF indices
    for idx, body in enumerate(b for b in [ground, crank, coupler, follower]
                                if not b.is_ground):
        body.dof_start = 3 * idx

    bodies = [ground, crank, coupler, follower]
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

    grounded_rev(crank,   A_w, 'A')   # crank grounded at origin
    body_rev(crank,   coupler,  B_w, 'B')   # crank tip ↔ coupler start
    body_rev(coupler, follower, C_w, 'C')   # coupler end ↔ follower tip
    grounded_rev(follower, D_w, 'D')  # follower grounded at (d,0)

    asm   = Assembler2D(bodies=bodies, constraints=constraints,
                        g=9.81, alpha_baum=50.0, beta_baum=50.0)
    integ = RK4Integrator(assembler=asm, dt=5e-4)
    return asm, integ


# ── Tests ────────────────────────────────────────────────────────────────────

def test_four_bar_dof_count():
    """Four-bar: 3 moving bodies × 3 DOF − 4 joints × 2 = 1 free DOF."""
    asm, _ = build_four_bar()
    assert asm.n_dof == 9, f"Expected 9 DOF, got {asm.n_dof}"
    assert asm.n_con == 8, f"Expected 8 constraints, got {asm.n_con}"
    free = asm.n_dof - asm.n_con
    print(f"\n  DOF = {asm.n_dof} - {asm.n_con} = {free} free DOF")
    assert free == 1


def test_four_bar_initial_closure():
    """Initial constraint violation must be near machine epsilon."""
    asm, _ = build_four_bar()
    viol = asm.constraint_violation()
    print(f"\n  Initial ‖Φ‖∞ = {viol:.2e} m")
    assert viol < 1e-10, f"Initial constraint violation {viol:.2e} too large — geometry setup error"


def test_four_bar_constraint_violation():
    """All joints stay assembled within 1e-3 m over 3 seconds."""
    asm, integ = build_four_bar()
    res = integ.simulate(t_end=3.0, dt=5e-4)
    max_viol = np.max(res['constraint_violation'])
    print(f"\n  Four-bar max ‖Φ‖∞ = {max_viol:.2e} m")
    assert max_viol < 1e-3, f"Constraint violation {max_viol:.2e} m too large"


def test_four_bar_energy_conservation():
    """Energy drift < 2% over 3 seconds (no driving torque)."""
    asm, integ = build_four_bar()
    res = integ.simulate(t_end=3.0, dt=5e-4)
    max_drift = np.max(np.abs(res['energy_rel_error']))
    print(f"\n  Four-bar energy drift = {max_drift*100:.4f}%")
    assert max_drift < 0.02, f"Energy drift {max_drift*100:.4f}% too large"


def test_grashof_condition():
    """Default link lengths must satisfy Grashof condition."""
    a, b, c, d = 0.15, 0.35, 0.30, 0.40
    links = sorted([a, b, c, d])
    grashof = (links[0] + links[3]) <= (links[1] + links[2])
    print(f"\n  Grashof: {links[0]:.2f}+{links[3]:.2f}={links[0]+links[3]:.2f} "
          f"<= {links[1]:.2f}+{links[2]:.2f}={links[1]+links[2]:.2f} → {grashof}")
    assert grashof


if __name__ == '__main__':
    print("=== Four-Bar Benchmarks ===")
    test_grashof_condition()
    print("  ✓ Grashof condition")
    test_four_bar_dof_count()
    print("  ✓ DOF count")
    test_four_bar_initial_closure()
    print("  ✓ Initial closure")
    test_four_bar_constraint_violation()
    print("  ✓ Constraint violation")
    test_four_bar_energy_conservation()
    print("  ✓ Energy conservation")
    print("\nAll four-bar benchmarks PASSED.")
