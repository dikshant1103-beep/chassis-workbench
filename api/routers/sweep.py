"""api/routers/sweep.py — POST /api/sweep"""

from fastapi import APIRouter, HTTPException
from api.models import SweepRequest, SweepResponse, SweepPointOut
from chassis_sim.geometry import BikeGeometry, ChainGeometry
from chassis_sim.sweep import ShockMount, compute_sweep

router = APIRouter()


@router.post("/sweep", response_model=SweepResponse)
def run_sweep(req: SweepRequest) -> SweepResponse:
    try:
        g = req.geometry
        s = req.suspension
        c = req.chain
        sp = req.sweep_params

        geom = BikeGeometry(
            head_angle_deg=g.head_angle,
            fork_offset_mm=g.fork_offset,
            front_wheel_dia_mm=g.front_wheel_dia,
            rear_wheel_dia_mm=g.rear_wheel_dia,
            wheelbase_mm=g.wheelbase,
            swingarm_length_mm=g.swingarm_length,
            swingarm_pivot_height_mm=g.swingarm_pivot_height,
            swingarm_pivot_x_mm=g.swingarm_pivot_x,
            rear_axle_height_mm=g.rear_axle_height,
        )
        chain = ChainGeometry(
            front_sprocket_teeth=c.front_sprocket,
            rear_sprocket_teeth=c.rear_sprocket,
            sprocket_center_x_mm=c.sprocket_center_x,
            sprocket_center_y_mm=c.sprocket_center_y,
            chain_force_angle_deg=c.chain_force_angle,
        )
        mount = ShockMount(
            linkage_type=sp.linkage_type,
            shock_arm_length_mm=sp.shock_arm_length,
            shock_arm_angle_deg=sp.shock_arm_angle,
            shock_top_x_mm=sp.shock_top_x,
            shock_top_y_mm=sp.shock_top_y,
        )

        result = compute_sweep(
            geom=geom,
            spring_rate_Nmm=s.spring_rate_rear,
            chain=chain,
            mount=mount,
            Y_cg_mm=req.y_cg_mm,
            wheel_travel_mm=req.wheel_travel_mm,
            du_mm=req.du_mm,
        )

        def to_out(p):
            return SweepPointOut(
                travel_mm=p.travel_mm,
                swingarm_angle_deg=p.swingarm_angle_deg,
                motion_ratio=p.motion_ratio,
                wheel_rate_Nmm=p.wheel_rate_Nmm,
                anti_squat_pct=p.anti_squat_pct,
                trail_mm=p.trail_mm,
            )

        return SweepResponse(
            points=[to_out(p) for p in result.points],
            static_point=to_out(result.static_point),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
