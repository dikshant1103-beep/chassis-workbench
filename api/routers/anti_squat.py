"""api/routers/anti_squat.py — POST /api/anti-squat

Cossalter squat-ratio sweep via Python engine.
Mirrors antiSquatAnalysis.ts — uses the Foale graphical IC method with:
  • Auto-computed chain force angle (external tangent, same as computeAntiSquatUnified)
  • Upper-run tangent contact point as line-of-action anchor
  • atan2(ΔY, WB−X_sp) for swingarm angle (consistent with anti-squat engine)
"""

import math
from fastapi import APIRouter, HTTPException
from api.models import AntiSquatRequest, AntiSquatResponse, SquatPointOut

router = APIRouter()

CHAIN_PITCH = 15.875  # mm — 520 chain pitch


def _chain_force_angle_deg(X_cs, H_cs, WB, H_ra, r_drive, r_rear):
    """
    Auto-compute chain force angle — matches computeChainForceAngle() in antiSquat.ts.
    Returns angle in degrees (DS→RA direction, positive = upward toward rear).
    """
    dx = X_cs - WB
    dy = H_cs - H_ra
    D = math.sqrt(dx * dx + dy * dy)
    if D < 1e-6:
        return 0.0
    theta_geom = math.atan2(dy, dx)
    sin_alpha = (r_rear - r_drive) / D
    sin_alpha = max(-1.0, min(1.0, sin_alpha))
    alpha = math.asin(sin_alpha)
    result = math.degrees(theta_geom + alpha) - 180.0
    while result > 180.0:
        result -= 360.0
    while result <= -180.0:
        result += 360.0
    return result


def _compute_at_yc(yc, WB, X_sp, H_sp, cog, X_cs, H_cs, r_drive, r_rear):
    """
    Compute IC and squat metrics at a given rear axle height yc.
    Matches antiSquatAnalysis.ts computeSquatAtYc() logic exactly.
    """
    # Swingarm angle: atan2 (matches computeAntiSquatUnified / antiSquatAnalysis.ts)
    sa_rad = math.atan2(yc - H_sp, WB - X_sp)
    sa_deg = math.degrees(sa_rad)

    # Geometric chain center-to-center angle (display only, not used for IC)
    chain_dx = WB - X_cs
    chain_dy = yc - H_cs
    chain_geom_deg = math.degrees(math.atan2(chain_dy, chain_dx))

    # Auto-compute chain force angle from sprocket geometry
    cfa_deg = _chain_force_angle_deg(X_cs, H_cs, WB, yc, r_drive, r_rear)

    m1 = math.tan(sa_rad)
    m2 = math.tan(math.radians(cfa_deg))

    # Rear contact patch at ground level
    cp_x, cp_y = WB, 0.0

    # Load-transfer angle: from rear CP toward CoG
    lt_dx = cog[0] - cp_x
    lt_dy = cog[1] - cp_y
    tau = math.degrees(math.atan2(lt_dy, lt_dx))

    sigma = squat_ratio = as_pct = None

    if abs(m1 - m2) > 1e-9:
        # Upper-run tangent contact point on drive sprocket (Foale line-of-action)
        theta_force = math.radians(cfa_deg + 180.0)
        perp_x = -math.sin(theta_force)
        perp_y =  math.cos(theta_force)
        X_tan = X_cs - r_drive * perp_x
        H_tan = H_cs - r_drive * perp_y

        # IC via y-intercept form (same as computeAntiSquatUnified)
        b1 = H_sp  - m1 * X_sp
        b2 = H_tan - m2 * X_tan
        IC_x = (b2 - b1) / (m1 - m2)
        IC_y = m1 * IC_x + b1

        # Squat line angle σ: from rear CP through IC
        sq_dx = IC_x - cp_x
        sq_dy = IC_y - cp_y
        sigma = math.degrees(math.atan2(sq_dy, sq_dx))

        tan_sigma = math.tan(math.radians(sigma))
        tan_tau   = math.tan(math.radians(tau))

        if abs(tan_sigma) > 1e-9:
            squat_ratio = tan_tau / tan_sigma

        # Foale AS%: height of squat line at front axle vertical (x = 0)
        denom = WB - IC_x
        if abs(denom) > 1e-9 and abs(cog[1]) > 1e-9:
            slope_sq = (cp_y - IC_y) / (cp_x - IC_x)
            h_front = IC_y + slope_sq * (0.0 - IC_x)
            as_pct = (h_front / cog[1]) * 100.0

    return SquatPointOut(
        yc=yc,
        swingarm_angle_deg=sa_deg,
        chain_angle_deg=chain_geom_deg,
        sigma=sigma,
        tau=tau,
        squat_ratio=squat_ratio,
        anti_squat_pct=as_pct,
    )


@router.post("/anti-squat", response_model=AntiSquatResponse)
def run_anti_squat(req: AntiSquatRequest) -> AntiSquatResponse:
    """
    Cossalter squat-ratio sweep — Foale graphical IC method.
    Chain force angle is auto-computed; user-supplied chainForceAngle is ignored.
    """
    try:
        g = req.geometry
        c = req.chain

        WB   = g.wheelbase
        X_sp = g.swingarm_pivot_x
        H_sp = g.swingarm_pivot_height
        yc_static = g.rear_axle_height

        X_cs = X_sp + c.sprocket_center_x
        H_cs = H_sp + c.sprocket_center_y

        r_drive = (c.front_sprocket * CHAIN_PITCH) / (2.0 * math.pi)
        r_rear  = (c.rear_sprocket  * CHAIN_PITCH) / (2.0 * math.pi)

        cog = (req.x_cg_mm, req.y_cg_mm)

        sweep = []
        yc = yc_static - req.yc_offset_mm
        while yc <= yc_static + req.yc_offset_mm + 1e-6:
            sweep.append(_compute_at_yc(yc, WB, X_sp, H_sp, cog, X_cs, H_cs, r_drive, r_rear))
            yc += req.step_mm

        return AntiSquatResponse(
            static_point=_compute_at_yc(yc_static, WB, X_sp, H_sp, cog, X_cs, H_cs, r_drive, r_rear),
            sweep=sweep,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
