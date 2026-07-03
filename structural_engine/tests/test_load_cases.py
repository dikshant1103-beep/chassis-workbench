"""Validation tests for the structural load-case engine.

Closed-form anchors (must hold to <1e-6) so the engine is provably not a mockup:
  - static reactions equal the cog.ts static axle loads
  - vertical reactions sum to total weight (DAF=1)
  - braking transfer equals m·a·Ycg/WB
  - friction circle / stoppie / wheelie clamp flags infeasible cases
"""

import math

import pytest

from structural_engine.load_cases import (
    LoadCaseInputs,
    LoadCaseDef,
    STANDARD_LOAD_CASES,
    compute_load_case,
    compute_load_cases,
    G,
)


def make_inputs(**over):
    m = 200.0
    W = m * G
    base = dict(
        totalMass=m, R_front0=W * 0.5, R_rear0=W * 0.5, Y_cg=600, X_cg=700,
        wheelbase=1400, trail=95, headAngleDeg=24, forkOffset=30, forkLeverMm=720,
        rearWheelDia=620, rearSprocket=42, chainAngleDeg=10, swingarmAngleDeg=5,
        swingarmLengthMm=580, isCVT=False, mu=1.1, engineMass=60, riderMass=80,
        pillionLuggageMass=0,
    )
    base.update(over)
    return LoadCaseInputs(**base)


def att(r, aid):
    return next(a for a in r.attachments if a.id == aid)


def test_static_reactions_match_cog():
    inp = make_inputs()
    r = compute_load_cases(inp, STANDARD_LOAD_CASES)[0]
    assert r.def_["id"] == "static1up"
    assert math.isclose(r.Nf, inp.R_front0, abs_tol=1e-6)
    assert math.isclose(r.Nr, inp.R_rear0, abs_tol=1e-6)
    assert math.isclose(att(r, "frontAxle").Fz, inp.R_front0, abs_tol=1e-6)


def test_vertical_sum_equals_weight():
    inp = make_inputs()
    r = compute_load_cases(inp)[0]
    assert math.isclose(r.Nf + r.Nr, inp.totalMass * G, abs_tol=1e-6)


def test_braking_transfer_closed_form():
    inp = make_inputs()
    r = next(x for x in compute_load_cases(inp) if x.def_["id"] == "brake10")
    dW = inp.totalMass * 1.0 * G * inp.Y_cg / inp.wheelbase
    assert math.isclose(r.Nf, inp.R_front0 + dW, abs_tol=1e-6)
    assert math.isclose(r.Nr, inp.R_rear0 - dW, abs_tol=1e-6)


def test_friction_circle_clamps_infeasible():
    inp = make_inputs()
    hard = compute_load_case(inp, LoadCaseDef("x", "x", -1.5, 1.5, 1.0, "combined"))
    assert hard.feasible is False
    assert hard.limitedBy is not None


def test_daf_scales_vertical_linearly():
    inp = make_inputs()
    bump = next(x for x in compute_load_cases(inp) if x.def_["id"] == "bump")  # DAF 2.5
    assert math.isclose(bump.Nf, inp.R_front0 * 2.5, abs_tol=1e-6)


def test_emergency_brake_flagged():
    inp = make_inputs()
    em = next(x for x in compute_load_cases(inp) if x.def_["id"] == "brake12")
    # 1.2g pure braking exceeds μ=1.1 → clamped
    assert em.feasible is False


def test_no_negative_reactions():
    inp = make_inputs()
    for r in compute_load_cases(inp):
        assert r.Nf >= 0 and r.Nr >= 0
