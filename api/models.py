"""
api/models.py — Pydantic request/response models for the FastAPI backend.

Field names use camelCase to match TypeScript interfaces.
Pydantic's alias_generator handles camelCase ↔ snake_case automatically.
"""

from __future__ import annotations
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import List, Optional, Literal


def _cfg() -> ConfigDict:
    return ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── Input models ──────────────────────────────────────────────────────────────

class GeometryIn(BaseModel):
    model_config = _cfg()

    head_angle: float         # degrees
    fork_offset: float        # mm
    fork_length: float = 680  # mm
    front_wheel_dia: float    # mm
    rear_wheel_dia: float     # mm
    wheelbase: float          # mm
    swingarm_length: float    # mm
    swingarm_pivot_height: float  # mm
    swingarm_pivot_x: float       # mm
    rear_axle_height: float       # mm
    front_axle_height: float = 300
    steering_offset: float = 0
    seat_height: float = 820
    ground_clearance: float = 130


class SuspensionIn(BaseModel):
    model_config = _cfg()

    spring_rate_front: float = 20.0   # N/mm
    spring_rate_rear: float  = 88.0   # N/mm
    motion_ratio_front: float = 1.0
    motion_ratio_rear: float  = 0.70
    unsprung_front: float = 18.0      # kg
    unsprung_rear: float  = 22.0      # kg
    sag_front: float  = 30.0          # mm
    sag_rear: float   = 25.0          # mm
    preload_front: float = 5.0
    preload_rear: float  = 8.0
    comp_damping: float  = 12.0
    reb_damping: float   = 14.0
    fork_travel: float   = 120.0      # mm
    shock_travel: float  = 65.0       # mm


class ChainIn(BaseModel):
    model_config = _cfg()

    front_sprocket: int   = 17
    rear_sprocket: int    = 42
    sprocket_center_x: float = -30.0
    sprocket_center_y: float = 30.0
    chain_force_angle: float = 2.0    # degrees


class MassComponentIn(BaseModel):
    model_config = _cfg()

    mass: float
    x: float
    y: float
    label: str = ""


class SweepParamsIn(BaseModel):
    model_config = _cfg()

    linkage_type: Literal['direct', 'fourbar'] = 'direct'
    shock_arm_length: float = 120.0
    shock_arm_angle: float  = 85.0
    shock_top_x: float = 750.0
    shock_top_y: float = 450.0


class SweepRequest(BaseModel):
    """POST /api/sweep"""
    model_config = _cfg()

    geometry: GeometryIn
    suspension: SuspensionIn
    chain: ChainIn
    sweep_params: SweepParamsIn = SweepParamsIn()
    y_cg_mm: float
    wheel_travel_mm: float = 100.0
    du_mm: float = 1.0


class DynamicsRequest(BaseModel):
    """POST /api/dynamics"""
    model_config = _cfg()

    geometry: GeometryIn
    suspension: SuspensionIn
    mass_components: List[MassComponentIn]
    chain: ChainIn
    brake_bias_front: float = 0.70
    decel_max_g: float = 1.20
    accel_max_g: float = 1.00
    d_g: float = 0.05
    motion_ratio_static: float = 0.70


class AntiSquatRequest(BaseModel):
    """POST /api/anti-squat"""
    model_config = _cfg()

    geometry: GeometryIn
    chain: ChainIn
    x_cg_mm: float
    y_cg_mm: float
    yc_offset_mm: float = 50.0
    step_mm: float = 2.0


# ── Response models ───────────────────────────────────────────────────────────

class SweepPointOut(BaseModel):
    travel_mm: float
    swingarm_angle_deg: float
    motion_ratio: float
    wheel_rate_Nmm: float
    anti_squat_pct: float
    trail_mm: float


class SweepResponse(BaseModel):
    points: List[SweepPointOut]
    static_point: SweepPointOut


class BrakePointOut(BaseModel):
    decel_g: float
    weight_transfer_N: float
    R_front_N: float
    R_rear_N: float
    front_pct: float
    anti_dive_pct: float
    fork_compression_mm: float
    rear_extension_mm: float


class AccelPointOut(BaseModel):
    accel_g: float
    weight_transfer_N: float
    R_front_N: float
    R_rear_N: float
    front_pct: float
    wheelie_margin_pct: float


class DynamicsResponse(BaseModel):
    braking: List[BrakePointOut]
    accel: List[AccelPointOut]
    total_weight_N: float
    x_cg_mm: float
    y_cg_mm: float
    total_mass_kg: float


class SquatPointOut(BaseModel):
    yc: float
    swingarm_angle_deg: float
    chain_angle_deg: float
    sigma: Optional[float]
    tau: Optional[float]
    squat_ratio: Optional[float]
    anti_squat_pct: Optional[float]


class AntiSquatResponse(BaseModel):
    static_point: SquatPointOut
    sweep: List[SquatPointOut]
