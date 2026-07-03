"""
api/routers/dag_analysis.py — Full-physics analysis endpoint.

POST /api/dag-analysis
  Runs every physics module in Python and returns a complete result
  that covers 100% of the TypeScript computeAll() pipeline:

  Existing (from DAG model):
    geometry, cog, anti_squat, dynamics, cornering, inertia, handling

  New (6 modules ported this session):
    suspension, ergonomics, tire, kinematics, fork_compliance, aero
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import List, Optional

from dynamics_engine.motorcycle_dynamics import MotorcycleDynamicsModel, MassComponent
from dynamics_engine.modules.suspension_engine    import SuspensionInputs, compute_suspension
from dynamics_engine.modules.ergonomics_engine    import ErgoInputs, compute_ergonomics
from dynamics_engine.modules.tire_engine          import TireInputs, compute_tire
from dynamics_engine.modules.kinematics_engine    import KinematicsInputs, compute_kinematics
from dynamics_engine.modules.fork_compliance_engine import ForkComplianceInputs, compute_fork_compliance
from dynamics_engine.modules.aero_engine          import AeroInputs, compute_aero

router = APIRouter()


def _cfg():
    return ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ══════════════════════════════════════════════════════════════════════════════
# REQUEST
# ══════════════════════════════════════════════════════════════════════════════

class MassComponentIn(BaseModel):
    model_config = _cfg()
    mass: float
    x: float
    y: float
    label: str = ""


class DAGRequest(BaseModel):
    """Complete bike parameter set — mirrors TypeScript ComputeAllInput."""
    model_config = _cfg()

    # ── Geometry ──────────────────────────────────────────────────────────────
    swingarm_length: float          = 580.0
    swingarm_pivot_x: float         = 830.0
    swingarm_pivot_height: float    = 385.0
    rear_wheel_diameter: float      = 640.0
    front_wheel_diameter: float     = 600.0
    head_angle_deg: float           = 24.0
    fork_offset: float              = 33.0
    wheelbase: float                = 1390.0   # mm (stored input)

    # ── Chain ─────────────────────────────────────────────────────────────────
    front_sprocket: int             = 16
    rear_sprocket: int              = 42
    drive_sprocket_radius: float    = 40.5
    rear_sprocket_radius: float     = 106.0
    countershaft_x: float           = 560.0
    countershaft_height: float      = 280.0
    sprocket_center_x: float        = -270.0   # offset from pivot
    sprocket_center_y: float        = -105.0

    # ── Suspension (calibrated: WR×(preload+sag) = sprung axle load) ─────────
    front_spring_rate: float        = 19.0   # N/mm combined (both legs)
    rear_spring_rate: float         = 45.5   # N/mm at shock
    front_motion_ratio: float       = 0.97
    rear_motion_ratio: float        = 0.65
    unsprung_front: float           = 14.0
    unsprung_rear: float            = 20.0
    sag_front: float                = 35.0   # mm rider sag
    sag_rear: float                 = 25.0
    preload_front: float            = 8.0
    preload_rear: float             = 8.0
    fork_travel: float              = 120.0
    shock_travel: float             = 58.0
    comp_damping_clicks: float      = 12.0
    damping_coeff_front: float      = 12.0
    damping_coeff_rear: float       = 18.0
    anti_dive_pct: float            = 25.0

    # ── Ergonomics ────────────────────────────────────────────────────────────
    handlebar_x: float              = 320.0
    handlebar_y: float              = 960.0
    seat_x: float                   = 760.0
    seat_y: float                   = 820.0
    footpeg_x: float                = 820.0
    footpeg_y: float                = 330.0

    # ── Tire ──────────────────────────────────────────────────────────────────
    front_section_width: float      = 120.0
    front_aspect_ratio: float       = 70.0
    front_rim_dia_inches: float     = 17.0
    front_tire_stiffness: float     = 180.0
    rear_section_width: float       = 190.0
    rear_aspect_ratio: float        = 55.0
    rear_rim_dia_inches: float      = 17.0
    rear_tire_stiffness: float      = 200.0
    speed_kmh: float                = 100.0

    # ── Fork compliance ───────────────────────────────────────────────────────
    fork_bending_stiffness: float   = 180.0  # N/mm — 43mm USD sport (~5mm at 1g)
    fork_torsional_stiffness: float = 700.0  # N·m/deg

    # ── Aero (sport/supersport defaults — R1 class) ───────────────────────────
    aero_Cx: float                  = 0.33
    aero_Cz: float                  = -0.05
    aero_frontal_area: float        = 0.35
    engine_power_kW: float          = 182.0  # kW — Yamaha R1 class
    drivetrain_eta: float           = 0.88
    max_speed_kmh: float            = 300.0
    reference_speed_kmh: float      = 250.0
    pressure_centre_x: float        = 650.0

    # ── Scenario ──────────────────────────────────────────────────────────────
    accel_g: float                  = 1.0
    brake_g: float                  = 1.0
    lateral_accel_g: float          = 0.8
    track_width_mm: float           = 1400.0

    # ── Gear data (for gear-limited top speed) ────────────────────────────────
    top_gear_ratio_overall: float   = 0.0   # total engine-to-wheel ratio; 0 = not set
    max_rpm: float                  = 0.0   # engine RPM at peak power; 0 = not set

    # ── Mass components ───────────────────────────────────────────────────────
    mass_components: Optional[List[MassComponentIn]] = None


# ══════════════════════════════════════════════════════════════════════════════
# RESPONSE MODELS
# ══════════════════════════════════════════════════════════════════════════════

class GeometryOut(BaseModel):
    wheelbase: float; swingarm_angle: float; trail: float
    mechanical_trail: float; front_axle_height: float; rear_axle_height: float

class CogOut(BaseModel):
    x_cg: float; y_cg: float; total_mass: float
    r_front: float; r_rear: float; front_pct: float; rear_pct: float

class AntiSquatOut(BaseModel):
    chain_force_angle: float; ic_x: float; ic_y: float; anti_squat_pct: float
    squat_ratio: float = 0.0

class DynamicsOut(BaseModel):
    load_transfer_accel: float; load_transfer_brake: float
    rear_squat_mm: float; fork_dive_mm: float
    wheelie_threshold_g: float; stoppie_threshold_g: float

class CorneringOut(BaseModel):
    lean_angle_deg: float; lateral_load_transfer: float; turning_radius: float

class InertiaOut(BaseModel):
    i_yaw: float; i_pitch: float

class HandlingOut(BaseModel):
    stability_index: float; agility_index: float
    wobble_sensitivity: float; pitch_sensitivity: float

class SuspensionOut(BaseModel):
    wheel_rate_front: float; wheel_rate_rear: float
    sprung_mass: float; sprung_mass_front: float; sprung_mass_rear: float
    nat_freq_front: float; nat_freq_rear: float
    sag_force_front: float; sag_force_rear: float
    sag_percent_front: float; sag_percent_rear: float
    critical_damping_front: float; critical_damping_rear: float
    damping_ratio_clicks: float; damping_ratio_front: float; damping_ratio_rear: float
    optimal_damping_front: float; optimal_damping_rear: float
    unsprung_freq_front: float; unsprung_freq_rear: float
    load_transfer_08g: float

class ErgoOut(BaseModel):
    d_SH: float; d_SP: float; d_HP: float
    knee_angle_deg: float; hip_angle_deg: float; forward_lean_deg: float

class TireOut(BaseModel):
    front_free_radius: float; rear_free_radius: float
    front_deflection: float; rear_deflection: float
    front_loaded_radius: float; rear_loaded_radius: float
    front_contact_patch_mm: float; rear_contact_patch_mm: float
    front_dynamic_radius: float; rear_dynamic_radius: float
    front_combined_rate: float; rear_combined_rate: float
    front_nat_freq_corrected: float; rear_nat_freq_corrected: float

class KinematicsPointOut(BaseModel):
    travel_mm: float; axle_x: float; axle_y: float
    wheelbase_mm: float; delta_wheelbase_mm: float
    chain_cd_mm: float; delta_chain_mm: float; swingarm_angle_deg: float

class KinematicsOut(BaseModel):
    rear_wheel_travel: float; static_index: int
    max_wheelbase_change: float; max_chain_length_change: float
    positions: List[KinematicsPointOut]

class ForkComplianceOut(BaseModel):
    braking_force_front: float; fork_deflection: float
    trail_effective: float; delta_trail: float
    steering_torque_Nm: float; steer_flex_angle_deg: float
    is_perceptible: bool; is_dangerous: bool

class AeroSpeedPointOut(BaseModel):
    speed_kmh: float; drag_N: float; lift_N: float
    power_W: float; delta_W_front_N: float

class AeroOut(BaseModel):
    drag_at_ref: float; lift_at_ref: float; power_at_ref_W: float
    pitch_moment_Nm: float; delta_W_front_at_ref_N: float
    top_speed_ms: float; top_speed_kmh: float
    top_speed_gear_ms: float; top_speed_gear_kmh: float
    drag_100kmh_N: float; dynamic_pressure_ref: float
    speed_sweep: List[AeroSpeedPointOut]


class DAGResponse(BaseModel):
    # Original DAG outputs
    geometry: GeometryOut
    cog: CogOut
    anti_squat: AntiSquatOut
    dynamics: DynamicsOut
    cornering: CorneringOut
    inertia: InertiaOut
    handling: HandlingOut
    # New full-pipeline outputs
    suspension: SuspensionOut
    ergonomics: ErgoOut
    tire: TireOut
    kinematics: KinematicsOut
    fork_compliance: ForkComplianceOut
    aero: AeroOut


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

_DEFAULT_MASS_COMPONENTS = [
    MassComponent('Engine',         55.0,  560.0, 340.0),
    MassComponent('Frame',          12.0,  700.0, 480.0),
    MassComponent('Battery',         4.0,  380.0, 220.0),
    MassComponent('Exhaust',         8.0,  460.0, 240.0),
    MassComponent('Swingarm+Wheel',  6.0,  750.0, 280.0),
    MassComponent('Front Wheel',     7.0,  300.0, 300.0),
    MassComponent('Fuel (full)',     10.0,  690.0, 340.0),
    MassComponent('Rider',          75.0,  710.0, 1020.0),
]


@router.post("/dag-analysis", response_model=DAGResponse)
def dag_analysis(req: DAGRequest) -> DAGResponse:
    """
    Full motorcycle physics pipeline — all modules computed in Python.
    Covers 100% of the TypeScript computeAll() pipeline.
    """

    # ── 1. DAG model (geometry, CoG, anti-squat, dynamics, inertia, handling) ──
    model = MotorcycleDynamicsModel.__new__(MotorcycleDynamicsModel)
    model._params = {}
    model._mass_components = []
    model._topo_order = []
    model._define_parameters()
    model._build_topo_order()

    dag_inputs = {
        'swingarm_length':       req.swingarm_length,
        'swingarm_pivot_x':      req.swingarm_pivot_x,
        'swingarm_pivot_height': req.swingarm_pivot_height,
        'rear_wheel_diameter':   req.rear_wheel_diameter,
        'front_wheel_diameter':  req.front_wheel_diameter,
        'head_angle_deg':        req.head_angle_deg,
        'fork_offset':           req.fork_offset,
        'drive_sprocket_teeth':  float(req.front_sprocket),
        'rear_sprocket_teeth':   float(req.rear_sprocket),
        'drive_sprocket_radius': req.drive_sprocket_radius,
        'rear_sprocket_radius':  req.rear_sprocket_radius,
        'countershaft_x':        req.countershaft_x,
        'countershaft_height':   req.countershaft_height,
        'front_spring_rate':     req.front_spring_rate,
        'rear_spring_rate':      req.rear_spring_rate,
        'front_motion_ratio':    req.front_motion_ratio,
        'rear_motion_ratio':     req.rear_motion_ratio,
        'anti_dive_pct':         req.anti_dive_pct,
        'accel_g':               req.accel_g,
        'brake_g':               req.brake_g,
        'lateral_accel_g':       req.lateral_accel_g,
        'speed_kmh':             req.speed_kmh,
        'track_width_mm':        req.track_width_mm,
    }
    for k, v in dag_inputs.items():
        if k in model._params:
            model._params[k].value = float(v)

    model._mass_components = (
        [MassComponent(mc.label or f"comp_{i}", mc.mass, mc.x, mc.y)
         for i, mc in enumerate(req.mass_components)]
        if req.mass_components else list(_DEFAULT_MASS_COMPONENTS)
    )

    model.recompute()
    r = model.report()

    # Resolved CoG from DAG (used as inputs for other modules)
    x_cg = r['cog']['x_cg']
    y_cg = r['cog']['y_cg']
    total_mass = r['cog']['total_mass']
    r_front = r['cog']['r_front']
    r_rear  = r['cog']['r_rear']
    wb = r['geometry']['wheelbase']
    trail = r['geometry']['trail']

    # ── 2. Suspension ──────────────────────────────────────────────────────────
    susp = compute_suspension(SuspensionInputs(
        spring_rate_front=req.front_spring_rate,
        spring_rate_rear=req.rear_spring_rate,
        motion_ratio_front=req.front_motion_ratio,
        motion_ratio_rear=req.rear_motion_ratio,
        unsprung_front=req.unsprung_front,
        unsprung_rear=req.unsprung_rear,
        sag_front=req.sag_front, sag_rear=req.sag_rear,
        preload_front=req.preload_front, preload_rear=req.preload_rear,
        fork_travel=req.fork_travel, shock_travel=req.shock_travel,
        comp_damping_clicks=req.comp_damping_clicks,
        damping_coeff_front=req.damping_coeff_front,
        damping_coeff_rear=req.damping_coeff_rear,
        total_mass=total_mass, x_cg=x_cg, y_cg=y_cg, wheelbase=wb,
    ))

    # ── 3. Ergonomics ──────────────────────────────────────────────────────────
    ergo = compute_ergonomics(ErgoInputs(
        handlebar_x=req.handlebar_x, handlebar_y=req.handlebar_y,
        seat_x=req.seat_x, seat_y=req.seat_y,
        footpeg_x=req.footpeg_x, footpeg_y=req.footpeg_y,
    ))

    # ── 4. Tire ────────────────────────────────────────────────────────────────
    tire = compute_tire(TireInputs(
        front_section_width=req.front_section_width,
        front_aspect_ratio=req.front_aspect_ratio,
        front_rim_diameter_inches=req.front_rim_dia_inches,
        front_tire_stiffness=req.front_tire_stiffness,
        rear_section_width=req.rear_section_width,
        rear_aspect_ratio=req.rear_aspect_ratio,
        rear_rim_diameter_inches=req.rear_rim_dia_inches,
        rear_tire_stiffness=req.rear_tire_stiffness,
        speed_kmh=req.speed_kmh,
        R_front_N=r_front, R_rear_N=r_rear,
        wheel_rate_front=susp.wheel_rate_front,
        wheel_rate_rear=susp.wheel_rate_rear,
        sprung_mass_front=susp.sprung_mass_front,
        sprung_mass_rear=susp.sprung_mass_rear,
    ))

    # ── 5. Kinematics ──────────────────────────────────────────────────────────
    sa_angle_rad = math.atan2(
        r['geometry']['rear_axle_height'] - req.swingarm_pivot_height,
        wb - req.swingarm_pivot_x,
    )
    kin = compute_kinematics(KinematicsInputs(
        swingarm_length=req.swingarm_length,
        swingarm_pivot_x=req.swingarm_pivot_x,
        swingarm_pivot_height=req.swingarm_pivot_height,
        swingarm_angle_rad=sa_angle_rad,
        motion_ratio_rear=req.rear_motion_ratio,
        shock_travel=req.shock_travel,
        sprocket_center_x=req.sprocket_center_x,
        sprocket_center_y=req.sprocket_center_y,
        num_positions=11,
    ))

    # ── 6. Fork compliance ─────────────────────────────────────────────────────
    fork = compute_fork_compliance(ForkComplianceInputs(
        fork_bending_stiffness=req.fork_bending_stiffness,
        fork_torsional_stiffness=req.fork_torsional_stiffness,
        total_mass=total_mass, a_decel_g=req.brake_g,
        trail_static=trail, head_angle_deg=req.head_angle_deg,
        R_front=r_front,
    ))

    # Cossalter squat ratio R = tan(τ) / tan(σ)  [Ch. 5]
    # σ = angle from rear contact patch (wb, 0) → IC
    # τ = angle from rear contact patch (wb, 0) → CoG
    ic_x_v = r['anti_squat']['IC_x']
    ic_y_v = r['anti_squat']['IC_y']
    squat_ratio = 0.0
    if (ic_x_v is not None and ic_y_v is not None and
            not (math.isnan(float(ic_x_v)) or math.isnan(float(ic_y_v)))):
        cp_x = float(wb)   # rear contact patch x (front axle at origin, +x rearward)
        # σ: rear CP → IC
        sq_dx = float(ic_x_v) - cp_x
        sq_dy = float(ic_y_v)          # cp_y = 0
        # τ: rear CP → CoG
        lt_dx = float(x_cg) - cp_x    # negative (CoG is forward of rear axle)
        lt_dy = float(y_cg)
        sigma = math.atan2(sq_dy, sq_dx)
        tau   = math.atan2(lt_dy, lt_dx)
        tan_sigma = math.tan(sigma)
        tan_tau   = math.tan(tau)
        squat_ratio = round(tan_tau / tan_sigma, 4) if abs(tan_sigma) > 1e-6 else 999.0

    # ── 7. Aero ────────────────────────────────────────────────────────────────
    aero = compute_aero(AeroInputs(
        Cx=req.aero_Cx, Cz=req.aero_Cz, frontal_area=req.aero_frontal_area,
        engine_power_kW=req.engine_power_kW, drivetrain_eta=req.drivetrain_eta,
        max_speed_kmh=req.max_speed_kmh, reference_speed_kmh=req.reference_speed_kmh,
        pressure_centre_x=req.pressure_centre_x, X_cg=x_cg, wheelbase=wb,
        top_gear_ratio_overall=req.top_gear_ratio_overall,
        max_rpm=req.max_rpm,
        rear_wheel_radius_mm=req.rear_wheel_diameter / 2.0,
    ))

    # ── Assemble response ──────────────────────────────────────────────────────
    return DAGResponse(
        geometry=GeometryOut(**r['geometry']),
        cog=CogOut(**r['cog']),
        anti_squat=AntiSquatOut(
            chain_force_angle=r['anti_squat']['chain_force_angle'],
            ic_x=r['anti_squat']['IC_x'], ic_y=r['anti_squat']['IC_y'],
            anti_squat_pct=r['anti_squat']['anti_squat_pct'],
            squat_ratio=squat_ratio,
        ),
        dynamics=DynamicsOut(**r['dynamics']),
        cornering=CorneringOut(**r['cornering']),
        inertia=InertiaOut(i_yaw=r['inertia']['I_yaw'], i_pitch=r['inertia']['I_pitch']),
        handling=HandlingOut(**r['handling']),
        suspension=SuspensionOut(
            wheel_rate_front=susp.wheel_rate_front,
            wheel_rate_rear=susp.wheel_rate_rear,
            sprung_mass=susp.sprung_mass,
            sprung_mass_front=susp.sprung_mass_front,
            sprung_mass_rear=susp.sprung_mass_rear,
            nat_freq_front=susp.nat_freq_front,
            nat_freq_rear=susp.nat_freq_rear,
            sag_force_front=susp.sag_force_front,
            sag_force_rear=susp.sag_force_rear,
            sag_percent_front=susp.sag_percent_front,
            sag_percent_rear=susp.sag_percent_rear,
            critical_damping_front=susp.critical_damping_front,
            critical_damping_rear=susp.critical_damping_rear,
            damping_ratio_clicks=susp.damping_ratio_clicks,
            damping_ratio_front=susp.damping_ratio_front,
            damping_ratio_rear=susp.damping_ratio_rear,
            optimal_damping_front=susp.optimal_damping_front,
            optimal_damping_rear=susp.optimal_damping_rear,
            unsprung_freq_front=susp.unsprung_freq_front,
            unsprung_freq_rear=susp.unsprung_freq_rear,
            load_transfer_08g=susp.load_transfer_08g,
        ),
        ergonomics=ErgoOut(
            d_SH=ergo.d_SH, d_SP=ergo.d_SP, d_HP=ergo.d_HP,
            knee_angle_deg=ergo.knee_angle_deg,
            hip_angle_deg=ergo.hip_angle_deg,
            forward_lean_deg=ergo.forward_lean_deg,
        ),
        tire=TireOut(
            front_free_radius=tire.front_free_radius,
            rear_free_radius=tire.rear_free_radius,
            front_deflection=tire.front_deflection,
            rear_deflection=tire.rear_deflection,
            front_loaded_radius=tire.front_loaded_radius,
            rear_loaded_radius=tire.rear_loaded_radius,
            front_contact_patch_mm=tire.front_contact_patch_mm,
            rear_contact_patch_mm=tire.rear_contact_patch_mm,
            front_dynamic_radius=tire.front_dynamic_radius,
            rear_dynamic_radius=tire.rear_dynamic_radius,
            front_combined_rate=tire.front_combined_rate,
            rear_combined_rate=tire.rear_combined_rate,
            front_nat_freq_corrected=tire.front_nat_freq_corrected,
            rear_nat_freq_corrected=tire.rear_nat_freq_corrected,
        ),
        kinematics=KinematicsOut(
            rear_wheel_travel=kin.rear_wheel_travel,
            static_index=kin.static_index,
            max_wheelbase_change=kin.max_wheelbase_change,
            max_chain_length_change=kin.max_chain_length_change,
            positions=[KinematicsPointOut(
                travel_mm=p.travel_mm, axle_x=p.axle_x, axle_y=p.axle_y,
                wheelbase_mm=p.wheelbase_mm, delta_wheelbase_mm=p.delta_wheelbase_mm,
                chain_cd_mm=p.chain_cd_mm, delta_chain_mm=p.delta_chain_mm,
                swingarm_angle_deg=p.swingarm_angle_deg,
            ) for p in kin.positions],
        ),
        fork_compliance=ForkComplianceOut(
            braking_force_front=fork.braking_force_front,
            fork_deflection=fork.fork_deflection,
            trail_effective=fork.trail_effective,
            delta_trail=fork.delta_trail,
            steering_torque_Nm=fork.steering_torque_Nm,
            steer_flex_angle_deg=fork.steer_flex_angle_deg,
            is_perceptible=fork.is_perceptible,
            is_dangerous=fork.is_dangerous,
        ),
        aero=AeroOut(
            drag_at_ref=aero.drag_at_ref,
            lift_at_ref=aero.lift_at_ref,
            power_at_ref_W=aero.power_at_ref_W,
            pitch_moment_Nm=aero.pitch_moment_Nm,
            delta_W_front_at_ref_N=aero.delta_W_front_at_ref_N,
            top_speed_ms=aero.top_speed_ms,
            top_speed_kmh=aero.top_speed_kmh,
            top_speed_gear_ms=aero.top_speed_gear_ms,
            top_speed_gear_kmh=aero.top_speed_gear_kmh,
            drag_100kmh_N=aero.drag_100kmh_N,
            dynamic_pressure_ref=aero.dynamic_pressure_ref,
            speed_sweep=[AeroSpeedPointOut(
                speed_kmh=p.speed_kmh, drag_N=p.drag_N, lift_N=p.lift_N,
                power_W=p.power_W, delta_W_front_N=p.delta_W_front_N,
            ) for p in aero.speed_sweep],
        ),
    )
