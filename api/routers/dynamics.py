"""api/routers/dynamics.py — POST /api/dynamics"""

from fastapi import APIRouter, HTTPException
from api.models import DynamicsRequest, DynamicsResponse, BrakePointOut, AccelPointOut
from chassis_sim.geometry import BikeGeometry, ChainGeometry, MassComponent
from chassis_sim.dynamics import compute_dynamics_sweep

router = APIRouter()


@router.post("/dynamics", response_model=DynamicsResponse)
def run_dynamics(req: DynamicsRequest) -> DynamicsResponse:
    try:
        g = req.geometry
        c = req.chain

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
        components = [
            MassComponent(mass_kg=m.mass, x_mm=m.x, y_mm=m.y, label=m.label)
            for m in req.mass_components
        ]

        result = compute_dynamics_sweep(
            geom=geom,
            components=components,
            chain=chain,
            front_spring_rate_Nmm=req.suspension.spring_rate_front,
            rear_spring_rate_Nmm=req.suspension.spring_rate_rear,
            motion_ratio_static=req.motion_ratio_static,
            brake_bias_front=req.brake_bias_front,
            decel_max_g=req.decel_max_g,
            accel_max_g=req.accel_max_g,
            d_g=req.d_g,
        )

        return DynamicsResponse(
            braking=[BrakePointOut(
                decel_g=p.decel_g,
                weight_transfer_N=p.weight_transfer_N,
                R_front_N=p.R_front_N,
                R_rear_N=p.R_rear_N,
                front_pct=p.front_pct,
                anti_dive_pct=p.anti_dive_pct,
                fork_compression_mm=p.fork_compression_mm,
                rear_extension_mm=p.rear_extension_mm,
            ) for p in result.braking],
            accel=[AccelPointOut(
                accel_g=p.accel_g,
                weight_transfer_N=p.weight_transfer_N,
                R_front_N=p.R_front_N,
                R_rear_N=p.R_rear_N,
                front_pct=p.front_pct,
                wheelie_margin_pct=p.wheelie_margin_pct,
            ) for p in result.accel],
            total_weight_N=result.total_weight_N,
            x_cg_mm=result.X_cg_mm,
            y_cg_mm=result.Y_cg_mm,
            total_mass_kg=result.total_mass_kg,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
