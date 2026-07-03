"""structural_engine/load_cases.py — analytical chassis load-case engine (Python mirror).

Byte-for-byte physics parity with
chassis-workbench/src/engine/structural/loadCases.ts.

Coordinate frame (vehicle): x forward+, y right+, z up+. Forces N, moments N·m.
Every case is clamped to the bike's physical limits (friction circle, stoppie/wheelie).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional

G = 9.81
DEG = math.pi / 180.0
CHAIN_PITCH = 15.875  # mm — 520/525 chain


# ── stability thresholds (mirror stability.ts) ───────────────────────────────
def stoppie_threshold(x_cg: float, y_cg: float) -> float:
    if y_cg < 1e-9:
        raise ValueError("y_cg must be > 0")
    return G * x_cg / y_cg


def wheelie_threshold(wheelbase: float, x_cg: float, y_cg: float) -> float:
    if y_cg < 1e-9:
        raise ValueError("y_cg must be > 0")
    return G * (wheelbase - x_cg) / y_cg


@dataclass
class LoadCaseDef:
    id: str
    label: str
    axG: float
    ayG: float
    daf: float
    kind: str
    color: str = ""


STANDARD_LOAD_CASES: List[LoadCaseDef] = [
    LoadCaseDef("static1up",  "Static (1-up)",         0.0,  0.0,  1.0, "static"),
    LoadCaseDef("static2up",  "Static (2-up + bags)",  0.0,  0.0,  1.0, "static"),
    LoadCaseDef("brake04",    "Soft Brake 0.4g",      -0.4,  0.0,  1.0, "brake"),
    LoadCaseDef("brake10",    "Hard Brake 1.0g",      -1.0,  0.0,  1.0, "brake"),
    LoadCaseDef("brake12",    "Emergency 1.2g",       -1.2,  0.0,  1.0, "brake"),
    LoadCaseDef("accel04",    "Accel 0.4g",            0.4,  0.0,  1.0, "accel"),
    LoadCaseDef("accel08",    "Hard Accel 0.8g",       0.8,  0.0,  1.0, "accel"),
    LoadCaseDef("corner10",   "Corner 1.0g lat",       0.0,  1.0,  1.0, "corner"),
    LoadCaseDef("trail",      "Trail Brake (combined)",-0.5, 0.6,  1.0, "combined"),
    LoadCaseDef("bump",       "Road Bump (DAF 2.5)",   0.0,  0.0,  2.5, "impact"),
    LoadCaseDef("pothole",    "Pothole (DAF 3.5)",    -0.3,  0.0,  3.5, "impact"),
    LoadCaseDef("kerb",       "Kerb Strike (lat DAF 2)",0.0, 1.0,  2.0, "impact"),
    LoadCaseDef("landing",    "Jump Landing (DAF 4)",  0.0,  0.0,  4.0, "impact"),
]


@dataclass
class LoadCaseInputs:
    totalMass: float
    R_front0: float
    R_rear0: float
    Y_cg: float
    X_cg: float
    wheelbase: float
    trail: float
    headAngleDeg: float
    forkOffset: float
    forkLeverMm: float
    rearWheelDia: float
    rearSprocket: float
    chainAngleDeg: float
    swingarmAngleDeg: float
    swingarmLengthMm: float
    isCVT: bool
    mu: float = 1.1
    brakeFrontShare: float = 0.85
    shockLeverRatio: float = 1.3
    engineMass: float = 0.0
    riderMass: float = 0.0
    pillionLuggageMass: float = 0.0


@dataclass
class AttachmentLoad:
    id: str
    label: str
    Fx: float
    Fy: float
    Fz: float
    resultantF: float
    moment: float
    confidence: str
    note: Optional[str] = None


@dataclass
class LoadCaseResult:
    def_: dict
    attachments: List[AttachmentLoad]
    Nf: float
    Nr: float
    leanDeg: float
    feasible: bool
    limitedBy: Optional[str]
    provenance: str = "analytical"


def _h3(a, b, c):
    return math.sqrt(a * a + b * b + c * c)


def compute_load_case(inp: LoadCaseInputs, d: LoadCaseDef, safety_factor: float = 1.0) -> LoadCaseResult:
    m = inp.totalMass
    WB = inp.wheelbase

    a_stoppie_g = stoppie_threshold(inp.X_cg, inp.Y_cg) / G
    a_wheelie_g = wheelie_threshold(WB, inp.X_cg, inp.Y_cg) / G
    axG, ayG, limited_by = d.axG, d.ayG, None
    req = math.hypot(axG, ayG)
    if req > inp.mu and req > 1e-6:
        s = inp.mu / req
        axG *= s
        ayG *= s
        limited_by = f"friction μ={inp.mu}"
    if axG < 0 and abs(axG) > a_stoppie_g:
        axG = -a_stoppie_g
        limited_by = f"stoppie {a_stoppie_g:.2f}g"
    if axG > 0 and axG > a_wheelie_g:
        axG = a_wheelie_g
        limited_by = f"wheelie {a_wheelie_g:.2f}g"
    feasible = limited_by is None

    ax = axG * G
    ay = ayG * G
    nz = d.daf

    dW = m * abs(ax) * inp.Y_cg / WB
    Nf = (inp.R_front0 + dW if axG < 0 else inp.R_front0 - dW) * nz
    Nr = (inp.R_rear0 - dW if axG < 0 else inp.R_rear0 + dW) * nz
    Nf = max(0.0, Nf)
    Nr = max(0.0, Nr)
    Nsum = (Nf + Nr) or 1.0

    Fx_f = Fx_r = 0.0
    if axG < 0:
        Fx_f = -m * abs(ax) * inp.brakeFrontShare
        Fx_r = -m * abs(ax) * (1 - inp.brakeFrontShare)
    elif axG > 0:
        Fx_r = m * ax
    Fy_tot = m * ay
    Fy_f = Fy_tot * Nf / Nsum
    Fy_r = Fy_tot * Nr / Nsum

    r_wheel = inp.rearWheelDia / 2
    r_sprocket = (inp.rearSprocket * CHAIN_PITCH) / (2 * math.pi)
    chain_ratio = r_wheel / r_sprocket if r_sprocket > 1e-6 else 0.0
    chain_ten = m * ax * chain_ratio if axG > 0 else 0.0
    chain_ang = (inp.swingarmAngleDeg if (inp.isCVT or math.isnan(inp.chainAngleDeg)) else inp.chainAngleDeg) * DEG

    cos_head = math.cos(inp.headAngleDeg * DEG)
    Lf = inp.forkLeverMm / 1000.0
    Lsa = inp.swingarmLengthMm / 1000.0
    sf = safety_factor
    att: List[AttachmentLoad] = []

    att.append(AttachmentLoad("frontAxle", "Front Axle",
                              Fx_f * sf, Fy_f * sf, Nf * sf, _h3(Fx_f, Fy_f, Nf) * sf, 0.0, "computed"))

    faxial = Nf / cos_head if cos_head > 0.01 else Nf
    m_head = math.hypot(Fx_f * Lf, Fy_f * Lf)
    att.append(AttachmentLoad("steeringHead", "Steering Head",
                              Fx_f * sf, Fy_f * sf, faxial * sf, _h3(Fx_f, Fy_f, faxial) * sf, m_head * sf,
                              "estimated", f"fork lever {inp.forkLeverMm}mm (Foale 600–800)"))

    att.append(AttachmentLoad("rearAxle", "Rear Axle",
                              Fx_r * sf, Fy_r * sf, Nr * sf, _h3(Fx_r, Fy_r, Nr) * sf, 0.0, "computed"))

    fpiv_v = Nr + chain_ten * math.sin(chain_ang)
    fpiv_h = Fx_r + chain_ten * math.cos(chain_ang)
    m_sa = math.hypot(Nr * Lsa, Fy_r * Lsa)
    att.append(AttachmentLoad("swingarmPivot", "Swingarm Pivot",
                              fpiv_h * sf, Fy_r * sf, fpiv_v * sf, _h3(fpiv_h, Fy_r, fpiv_v) * sf, m_sa * sf, "computed"))

    fshock = Nr * inp.shockLeverRatio
    att.append(AttachmentLoad("shockMount", "Shock Mount",
                              0.0, 0.0, fshock * sf, fshock * sf, 0.0,
                              "estimated", f"lever ratio {inp.shockLeverRatio} (no shock geometry)"))

    me = inp.engineMass
    att.append(AttachmentLoad("engineMount", "Engine Mounts",
                              me * ax * sf, me * ay * sf, me * G * nz * sf, _h3(me * ax, me * ay, me * G * nz) * sf, 0.0,
                              "computed" if me > 0 else "estimated", None if me > 0 else "engine mass unknown"))

    mr = inp.riderMass
    att.append(AttachmentLoad("footpeg", "Footpeg",
                              mr * ax * sf, mr * ay * sf, mr * G * nz * sf, _h3(mr * ax, mr * ay, mr * G * nz) * sf, 0.0,
                              "computed" if mr > 0 else "estimated"))

    ms = inp.pillionLuggageMass
    att.append(AttachmentLoad("subframe", "Subframe",
                              ms * ax * sf, ms * ay * sf, ms * G * nz * sf, _h3(ms * ax, ms * ay, ms * G * nz) * sf, 0.0,
                              "estimated", "pillion+luggage lumped"))

    att.append(AttachmentLoad("chain", "Chain Tension",
                              chain_ten * math.cos(chain_ang) * sf, 0.0, chain_ten * math.sin(chain_ang) * sf,
                              chain_ten * sf, 0.0, "computed"))

    return LoadCaseResult(asdict(d), att, Nf, Nr, math.atan(ayG) / DEG, feasible, limited_by)


def compute_load_cases(inp: LoadCaseInputs, cases: Optional[List[LoadCaseDef]] = None,
                       safety_factor: float = 1.0) -> List[LoadCaseResult]:
    cases = cases or STANDARD_LOAD_CASES
    return [compute_load_case(inp, c, safety_factor) for c in cases]
