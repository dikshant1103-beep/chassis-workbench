"""Validation for the stiffness-target engine.

Closed-form anchors:
  - deflection route: K = M/θ exactly
  - frequency route:  K = I·(2πf)²  (converted to per-deg)
  - recommended = max(routes); governing label matches
"""

import math

from structural_engine.stiffness_targets import (
    StiffnessTargetInputs,
    compute_stiffness_targets,
    G,
    DEG,
)


def make(**over):
    base = dict(totalMass=200.0, Y_cg=600.0, R_front0=981.0, R_rear0=981.0,
                I_roll=35.0, mu=1.1, allowableTwistDeg=0.18, allowableLatDeflMm=1.5,
                wobbleFreqHz=7.0, freqMargin=1.5)
    base.update(over)
    return StiffnessTargetInputs(**base)


def test_deflection_route_closed_form():
    inp = make()
    r = compute_stiffness_targets(inp)
    fy = inp.totalMass * inp.mu * G * (inp.R_front0 / (inp.R_front0 + inp.R_rear0))
    m_t = fy * inp.Y_cg / 1000.0
    assert math.isclose(r["torsionalTarget_deflection_Nm_per_deg"], m_t / inp.allowableTwistDeg, rel_tol=1e-9)


def test_frequency_route_closed_form():
    inp = make()
    r = compute_stiffness_targets(inp)
    f = inp.freqMargin * inp.wobbleFreqHz
    expect = inp.I_roll * (2 * math.pi * f) ** 2 * DEG
    assert math.isclose(r["torsionalTarget_frequency_Nm_per_deg"], expect, rel_tol=1e-9)


def test_recommended_is_max():
    r = compute_stiffness_targets(make())
    assert r["torsionalTarget_recommended_Nm_per_deg"] == max(
        r["torsionalTarget_deflection_Nm_per_deg"], r["torsionalTarget_frequency_Nm_per_deg"]
    )


def test_frame_target_tagged_estimated():
    assert compute_stiffness_targets(make())["targetTag"] == "estimated"


def test_lateral_target_positive():
    assert compute_stiffness_targets(make())["lateralTarget_N_per_mm"] > 0
