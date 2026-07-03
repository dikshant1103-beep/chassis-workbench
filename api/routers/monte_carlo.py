"""
api/routers/monte_carlo.py — R4: Server-side Monte Carlo Tolerance Analysis

POST /api/monte-carlo
  Runs N samples of the full DAG physics model with uniform parameter variation.
  Returns per-KPI distributions (mean, std, P10/P50/P90, pass rate, histogram values).

Why server-side:
  - Full DAG model accuracy (vs simplified TS computeAll)
  - N=500 takes ~1-2s in Python (3-5ms/eval × 500 = 1.5-2.5s)
  - Client gets single response; no streaming overhead
"""
import time, math, random
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Optional, Any

from .dag_analysis import DAGRequest
from ._physics import PARAM_META, KPI_META, eval_kpis, patch_request, KPI_TO_TARGET_KEY

router = APIRouter()


# ── Request ───────────────────────────────────────────────────────────────────

class MCRequest(BaseModel):
    bike:         DAGRequest
    tolerances:   Dict[str, float]           # param_id → absolute ±tolerance
    n_samples:    int = 500
    seed:         Optional[int] = None
    targets:      Optional[Dict[str, Any]] = None  # {targetKey: {enabled, lo, hi}}


# ── Response ──────────────────────────────────────────────────────────────────

class KPIStatsOut(BaseModel):
    id:        str
    label:     str
    unit:      str
    values:    List[float]   # all N samples (for histogram rendering)
    mean:      float
    std:       float
    p10:       float
    p50:       float
    p90:       float
    pass_rate: Optional[float]  # None if no target set
    nominal:   float
    target_lo: Optional[float]
    target_hi: Optional[float]

class MCResponse(BaseModel):
    n:                  int
    elapsed_ms:         float
    overall_pass_rate:  float
    kpis:               List[KPIStatsOut]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _percentile(sorted_vals: list, p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = (p / 100.0) * (len(sorted_vals) - 1)
    lo  = int(idx)
    hi  = min(int(math.ceil(idx)), len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/monte-carlo", response_model=MCResponse)
def monte_carlo(req: MCRequest) -> MCResponse:
    t0 = time.perf_counter()

    if req.seed is not None:
        random.seed(req.seed)

    n       = max(1, min(req.n_samples, 5000))   # cap at 5000
    targets = req.targets or {}

    # Enabled params with non-zero tolerance
    enabled = [
        p for p in PARAM_META
        if req.tolerances.get(p['id'], 0.0) > 0
    ]

    # Baseline nominal values
    baseline_kpis = eval_kpis(req.bike)

    # Accumulate per-KPI sample arrays
    kpi_arrays: dict[str, list[float]] = {k['id']: [] for k in KPI_META}

    for _ in range(n):
        # Perturb each enabled param uniformly within ±tolerance
        perturbed = req.bike
        for p in enabled:
            tol = req.tolerances[p['id']]
            v   = getattr(req.bike, p['field'], None)
            if v is None:
                continue
            sampled = float(v) + (random.random() * 2.0 - 1.0) * tol
            perturbed = patch_request(perturbed, p['id'], sampled)

        kpis = eval_kpis(perturbed)
        for k in KPI_META:
            kpi_arrays[k['id']].append(kpis[k['id']])

    # Compute stats
    kpi_stats: list[KPIStatsOut] = []
    for km in KPI_META:
        kpi_id = km['id']
        vals   = kpi_arrays[kpi_id]
        if not vals:
            continue
        sorted_v = sorted(vals)
        mean     = sum(vals) / len(vals)
        variance = sum((v - mean) ** 2 for v in vals) / len(vals)
        std      = math.sqrt(variance)

        # Target range
        tkey      = KPI_TO_TARGET_KEY.get(kpi_id)
        t         = targets.get(tkey) if tkey else None
        target_lo = float(t['lo']) if t and t.get('enabled') else None
        target_hi = float(t['hi']) if t and t.get('enabled') else None
        pass_rate: Optional[float] = None
        if target_lo is not None and target_hi is not None:
            pass_rate = sum(1 for v in vals if target_lo <= v <= target_hi) / len(vals)

        kpi_stats.append(KPIStatsOut(
            id        = kpi_id,
            label     = km['label'],
            unit      = km['unit'],
            values    = [round(v, 4) for v in vals],
            mean      = round(mean, 4),
            std       = round(std, 4),
            p10       = round(_percentile(sorted_v, 10), 4),
            p50       = round(_percentile(sorted_v, 50), 4),
            p90       = round(_percentile(sorted_v, 90), 4),
            pass_rate = round(pass_rate, 4) if pass_rate is not None else None,
            nominal   = round(baseline_kpis[kpi_id], 4),
            target_lo = target_lo,
            target_hi = target_hi,
        ))

    # Overall: fraction of samples where ALL targeted KPIs pass simultaneously
    targeted_ids = [km['id'] for km in KPI_META if km['id'] in kpi_arrays
                    and KPI_TO_TARGET_KEY.get(km['id']) and
                    targets.get(KPI_TO_TARGET_KEY[km['id']], {}).get('enabled')]
    overall_pass_rate = 1.0
    if targeted_ids and n > 0:
        pass_count = 0
        for i in range(n):
            all_pass = True
            for kid in targeted_ids:
                tkey = KPI_TO_TARGET_KEY[kid]
                t    = targets.get(tkey, {})
                v    = kpi_arrays[kid][i]
                if v < t['lo'] or v > t['hi']:
                    all_pass = False
                    break
            if all_pass:
                pass_count += 1
        overall_pass_rate = pass_count / n

    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return MCResponse(
        n                 = n,
        elapsed_ms        = round(elapsed_ms, 1),
        overall_pass_rate = round(overall_pass_rate, 4),
        kpis              = kpi_stats,
    )
