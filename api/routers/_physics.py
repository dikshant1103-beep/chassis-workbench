"""
api/routers/_physics.py — shared minimal physics evaluator for R&D batch computations.

Runs DAG model + suspension module only (skips tire/ergo/kin/fork/aero for speed).
Returns 10 KPI values: trail, frontPct, cogH, antiSquat, natFreqF/R, sagF/R, wrF/R.

Approx 3-5ms per call in Python vs 0.3ms for TS computeAll.
Used by: sensitivity.py, monte_carlo.py, optimize.py
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dynamics_engine.motorcycle_dynamics import MotorcycleDynamicsModel, MassComponent
from dynamics_engine.modules.suspension_engine import SuspensionInputs, compute_suspension
from .dag_analysis import DAGRequest, _DEFAULT_MASS_COMPONENTS

CHAIN_PITCH = 15.875  # mm — 520 chain

# ── Param definitions ─────────────────────────────────────────────────────────
# Maps frontend param_id → DAGRequest snake_case field name.
# forkLength is intentionally absent — not a direct DAGRequest field.

PARAM_META = [
    {'id': 'headAngle',    'label': 'Head Angle',     'group': 'Geometry',   'unit': '°',    'field': 'head_angle_deg'},
    {'id': 'forkOffset',   'label': 'Fork Offset',    'group': 'Geometry',   'unit': 'mm',   'field': 'fork_offset'},
    {'id': 'wheelbase',    'label': 'Wheelbase',      'group': 'Geometry',   'unit': 'mm',   'field': 'wheelbase'},
    {'id': 'swingarmLen',  'label': 'Swingarm Len',   'group': 'Geometry',   'unit': 'mm',   'field': 'swingarm_length'},
    {'id': 'pivotHeight',  'label': 'Pivot Height',   'group': 'Geometry',   'unit': 'mm',   'field': 'swingarm_pivot_height'},
    {'id': 'pivotX',       'label': 'Pivot X',        'group': 'Geometry',   'unit': 'mm',   'field': 'swingarm_pivot_x'},
    {'id': 'springRateF',  'label': 'Spring Rate F',  'group': 'Suspension', 'unit': 'N/mm', 'field': 'front_spring_rate'},
    {'id': 'springRateR',  'label': 'Spring Rate R',  'group': 'Suspension', 'unit': 'N/mm', 'field': 'rear_spring_rate'},
    {'id': 'motionRatioF', 'label': 'Motion Ratio F', 'group': 'Suspension', 'unit': '',     'field': 'front_motion_ratio'},
    {'id': 'motionRatioR', 'label': 'Motion Ratio R', 'group': 'Suspension', 'unit': '',     'field': 'rear_motion_ratio'},
    {'id': 'unsprungF',    'label': 'Unsprung F',     'group': 'Suspension', 'unit': 'kg',   'field': 'unsprung_front'},
    {'id': 'unsprungR',    'label': 'Unsprung R',     'group': 'Suspension', 'unit': 'kg',   'field': 'unsprung_rear'},
    {'id': 'frontSprocket','label': 'Front Sprocket', 'group': 'Chain',      'unit': 'T',    'field': 'front_sprocket'},
    {'id': 'rearSprocket', 'label': 'Rear Sprocket',  'group': 'Chain',      'unit': 'T',    'field': 'rear_sprocket'},
]

PARAM_FIELD = {p['id']: p['field'] for p in PARAM_META}

# ── KPI definitions ───────────────────────────────────────────────────────────

KPI_META = [
    {'id': 'trail',     'label': 'Trail',   'unit': 'mm'},
    {'id': 'frontPct',  'label': 'Front%',  'unit': '%'},
    {'id': 'cogH',      'label': 'CoG H',   'unit': 'mm'},
    {'id': 'antiSquat', 'label': 'AS%',     'unit': '%'},
    {'id': 'natFreqF',  'label': 'Freq F',  'unit': 'Hz'},
    {'id': 'natFreqR',  'label': 'Freq R',  'unit': 'Hz'},
    {'id': 'sagF',      'label': 'Sag% F',  'unit': '%'},
    {'id': 'sagR',      'label': 'Sag% R',  'unit': '%'},
    {'id': 'wrF',       'label': 'WR F',    'unit': 'N/mm'},
    {'id': 'wrR',       'label': 'WR R',    'unit': 'N/mm'},
]

# Maps KPI id → TargetConfig key (camelCase, matches TypeScript TargetConfig)
KPI_TO_TARGET_KEY = {
    'trail':     'trail',
    'frontPct':  'frontPercent',
    'cogH':      'cogHeight',
    'antiSquat': 'antiSquatPercent',
    'natFreqF':  'natFreqFront',
    'natFreqR':  'natFreqRear',
    'sagF':      'sagPercentFront',
    'sagR':      'sagPercentRear',
    'wrF':       'wheelRateFront',
    'wrR':       'wheelRateRear',
}

# ── Core evaluator ────────────────────────────────────────────────────────────

def eval_kpis(req: DAGRequest) -> dict:
    """
    Minimal evaluation: DAG model + suspension → 10 KPI scalars.
    Skips tire, ergonomics, kinematics, fork compliance, aero for batch speed.
    """
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

    x_cg       = r['cog']['x_cg']
    y_cg       = r['cog']['y_cg']
    total_mass = r['cog']['total_mass']
    wb         = r['geometry']['wheelbase']

    susp = compute_suspension(SuspensionInputs(
        spring_rate_front   = req.front_spring_rate,
        spring_rate_rear    = req.rear_spring_rate,
        motion_ratio_front  = req.front_motion_ratio,
        motion_ratio_rear   = req.rear_motion_ratio,
        unsprung_front      = req.unsprung_front,
        unsprung_rear       = req.unsprung_rear,
        sag_front           = req.sag_front,
        sag_rear            = req.sag_rear,
        preload_front       = req.preload_front,
        preload_rear        = req.preload_rear,
        fork_travel         = req.fork_travel,
        shock_travel        = req.shock_travel,
        comp_damping_clicks = req.comp_damping_clicks,
        damping_coeff_front = req.damping_coeff_front,
        damping_coeff_rear  = req.damping_coeff_rear,
        total_mass=total_mass, x_cg=x_cg, y_cg=y_cg, wheelbase=wb,
    ))

    return {
        'trail':     r['geometry']['trail'],
        'frontPct':  r['cog']['front_pct'],
        'cogH':      r['cog']['y_cg'],
        'antiSquat': r['anti_squat']['anti_squat_pct'],
        'natFreqF':  susp.nat_freq_front,
        'natFreqR':  susp.nat_freq_rear,
        'sagF':      susp.sag_percent_front,
        'sagR':      susp.sag_percent_rear,
        'wrF':       susp.wheel_rate_front,
        'wrR':       susp.wheel_rate_rear,
    }


def patch_request(base: DAGRequest, param_id: str, value: float) -> DAGRequest:
    """Apply a single param perturbation, maintaining derived fields (e.g. sprocket radii)."""
    data = base.model_dump(by_alias=False)
    if param_id == 'frontSprocket':
        t = max(1, round(value))
        data['front_sprocket'] = t
        data['drive_sprocket_radius'] = (t * CHAIN_PITCH) / (2 * math.pi)
    elif param_id == 'rearSprocket':
        t = max(1, round(value))
        data['rear_sprocket'] = t
        data['rear_sprocket_radius'] = (t * CHAIN_PITCH) / (2 * math.pi)
    elif param_id == 'wheelbase':
        # wheelbase is a derived DAG node — translate delta to swingarm_pivot_x shift
        # nominal_wb = pivot_x + swingarm_length (approximately, on flat ground)
        nominal_wb = base.swingarm_pivot_x + base.swingarm_length
        delta = value - nominal_wb
        data['swingarm_pivot_x'] = base.swingarm_pivot_x + delta
        # also update countershaft_x which is offset from pivot
        data['countershaft_x'] = base.countershaft_x + delta
        data['wheelbase'] = value
    else:
        field = PARAM_FIELD.get(param_id)
        if field:
            data[field] = value
    return DAGRequest(**data)


def apply_position(base: DAGRequest, position: dict) -> DAGRequest:
    """Apply a full position dict {param_id: value} to a base request."""
    req = base
    for param_id, value in position.items():
        req = patch_request(req, param_id, float(value))
    return req


def score_kpi(value: float, lo: float, hi: float) -> float:
    """Cosine falloff fitness — 1.0 inside [lo,hi], decays to 0 at 2× span outside."""
    if lo <= value <= hi:
        return 1.0
    span = hi - lo
    dist = (lo - value) if value < lo else (value - hi)
    decay = dist / span if span > 0 else dist
    return max(0.0, 0.5 * (1 + math.cos(math.pi * min(decay, 1.0))))


def compute_fitness(kpis: dict, targets: dict) -> tuple[float, dict, dict]:
    """
    Compute fitness score from KPI values + target ranges.
    targets: {targetKey: {enabled, lo, hi}} — matches TargetConfig structure.
    Returns (fitness_0_100, kpi_values_by_label, kpi_scores_by_label).
    """
    kpi_values = {}
    kpi_scores = {}
    total, count = 0.0, 0

    for km in KPI_META:
        kpi_id  = km['id']
        label   = km['label']
        value   = kpis.get(kpi_id, 0.0)
        kpi_values[label] = value

        tkey = KPI_TO_TARGET_KEY.get(kpi_id)
        t    = targets.get(tkey) if tkey else None
        if t and t.get('enabled', False):
            score = score_kpi(value, t['lo'], t['hi'])
            total += score
            count += 1
            kpi_scores[label] = score
        else:
            kpi_scores[label] = 1.0

    fitness = (total / count * 100.0) if count > 0 else 100.0
    return fitness, kpi_values, kpi_scores
