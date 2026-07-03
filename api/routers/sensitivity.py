"""
api/routers/sensitivity.py — R2: Server-side Parameter Sensitivity Analysis

POST /api/sensitivity
  Runs central-difference elasticity for all 14 backend-mappable params × 10 KPIs
  using the full Python DAG physics model (330ms for 28 evaluations).

Why server-side vs TypeScript:
  - No 28 separate HTTP round-trips (one request, 28 internal evaluations)
  - Full DAG model accuracy (vs simplified TS computeAll)
  - forkLength excluded — not a direct DAGRequest input field
"""
import time
import math
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

from .dag_analysis import DAGRequest
from ._physics import PARAM_META, KPI_META, eval_kpis, patch_request

router = APIRouter()


# ── Request ───────────────────────────────────────────────────────────────────

class SensitivityRequest(BaseModel):
    bike:          DAGRequest
    perturb_pct:   float = 2.0
    active_groups: Optional[List[str]] = None   # None = all three


# ── Response ──────────────────────────────────────────────────────────────────

class SensCell(BaseModel):
    elasticity: float
    raw_deriv:  float

class SensParamOut(BaseModel):
    id:    str
    label: str
    group: str
    unit:  str

class SensKPIOut(BaseModel):
    id:    str
    label: str
    unit:  str

class SensitivityResponse(BaseModel):
    params:        List[SensParamOut]
    kpis:          List[SensKPIOut]
    cells:         List[List[SensCell]]   # [paramIdx][kpiIdx]
    baseline_kpi:  List[float]
    baseline_param:List[float]
    perturb_pct:   float
    compute_ms:    float


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/sensitivity", response_model=SensitivityResponse)
def sensitivity(req: SensitivityRequest) -> SensitivityResponse:
    t0 = time.perf_counter()

    allowed_groups = set(req.active_groups) if req.active_groups else {'Geometry', 'Suspension', 'Chain'}
    params = [p for p in PARAM_META if p['group'] in allowed_groups]
    kpis   = KPI_META

    # Baseline
    base_kpis   = eval_kpis(req.bike)
    baseline_kpi   = [base_kpis[k['id']] for k in kpis]
    baseline_param = []
    for p in params:
        field = p['field']
        val   = getattr(req.bike, field, None)
        baseline_param.append(float(val) if val is not None else 0.0)

    # Central difference per param
    cells: list[list[SensCell]] = []
    for pi, param in enumerate(params):
        pv = baseline_param[pi]
        delta = max(abs(pv) * (req.perturb_pct / 100.0), 1e-4)

        hi_kpis = eval_kpis(patch_request(req.bike, param['id'], pv + delta))
        lo_kpis = eval_kpis(patch_request(req.bike, param['id'], pv - delta))

        row: list[SensCell] = []
        for ki, kpi in enumerate(kpis):
            kpi_base = baseline_kpi[ki]
            kpi_hi   = hi_kpis[kpi['id']]
            kpi_lo   = lo_kpis[kpi['id']]

            raw_deriv  = (kpi_hi - kpi_lo) / (2 * delta)
            # E = (ΔK/K) / (ΔP/P) — dimensionless elasticity
            if kpi_base != 0 and pv != 0:
                elasticity = (raw_deriv * pv) / kpi_base
            else:
                elasticity = 0.0

            row.append(SensCell(
                elasticity = round(elasticity, 6) if math.isfinite(elasticity) else 0.0,
                raw_deriv  = round(raw_deriv, 6)  if math.isfinite(raw_deriv)  else 0.0,
            ))
        cells.append(row)

    compute_ms = (time.perf_counter() - t0) * 1000.0

    return SensitivityResponse(
        params         = [SensParamOut(**{k: p[k] for k in ('id','label','group','unit')}) for p in params],
        kpis           = [SensKPIOut(**{k: kp[k] for k in ('id','label','unit')}) for kp in kpis],
        cells          = cells,
        baseline_kpi   = baseline_kpi,
        baseline_param = baseline_param,
        perturb_pct    = req.perturb_pct,
        compute_ms     = round(compute_ms, 1),
    )
