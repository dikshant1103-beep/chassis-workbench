"""structural_engine/stiffness_targets.py — frame stiffness target derivation (Python mirror).

Parity with chassis-workbench/src/engine/structural/stiffnessTargets.ts.
We DERIVE the required target (deflection-budget + frequency-separation); we do not
solve the frame. Frame target tagged 'estimated' (no public benchmark).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

G = 9.81
DEG = math.pi / 180.0


@dataclass
class StiffnessTargetInputs:
    totalMass: float
    Y_cg: float
    R_front0: float
    R_rear0: float
    I_roll: float
    mu: float = 1.1
    allowableTwistDeg: float = 0.18
    allowableLatDeflMm: float = 1.5
    wobbleFreqHz: float = 7.0
    freqMargin: float = 1.5


def compute_stiffness_targets(inp: StiffnessTargetInputs) -> dict:
    ay = inp.mu * G
    lat_total = inp.totalMass * ay
    front_share = inp.R_front0 / ((inp.R_front0 + inp.R_rear0) or 1.0)
    fy_front = lat_total * front_share

    lever_m = inp.Y_cg / 1000.0
    m_t = fy_front * lever_m
    kt_defl = m_t / inp.allowableTwistDeg if inp.allowableTwistDeg > 1e-6 else 0.0

    f_target = inp.freqMargin * inp.wobbleFreqHz
    omega = 2 * math.pi * f_target
    kt_freq = inp.I_roll * omega * omega * DEG  # Nm/deg

    recommended = max(kt_defl, kt_freq)
    governing = "frequency" if kt_freq >= kt_defl else "deflection"
    klat = fy_front / inp.allowableLatDeflMm if inp.allowableLatDeflMm > 1e-6 else 0.0

    return {
        "torsionalTarget_deflection_Nm_per_deg": kt_defl,
        "torsionalTarget_frequency_Nm_per_deg": kt_freq,
        "torsionalTarget_recommended_Nm_per_deg": recommended,
        "governingRoute": governing,
        "lateralTarget_N_per_mm": klat,
        "corneringLatForce_N": fy_front,
        "torsionalMoment_Nm": m_t,
        "frameModeTarget_Hz": f_target,
        "provenance": "analytical",
        "targetTag": "estimated",
    }
