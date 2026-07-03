"""
api/routers/optimize.py — R3: Batch particle evaluation for server-side PSO fitness

POST /api/eval-batch
  Evaluates a batch of parameter positions (PSO particles) using the full DAG
  physics model. The frontend PSO loop calls this once per iteration instead of
  N separate /api/dag-analysis requests.

Request:  base bike + list of position dicts {param_id: value} + target config
Response: list of {fitness, kpi_values, kpi_scores} — one per input position

Why batch:
  - 1 HTTP round-trip per PSO iteration (not N round-trips)
  - Enables real DAG physics in the PSO fitness function
  - Frontend keeps velocity/position update logic (pure math, stays in TS)
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from .dag_analysis import DAGRequest
from ._physics import eval_kpis, apply_position, compute_fitness

router = APIRouter()


# ── Request / Response ────────────────────────────────────────────────────────

class BatchEvalRequest(BaseModel):
    bike:      DAGRequest
    positions: List[Dict[str, float]]          # [{param_id: value}, ...]
    targets:   Optional[Dict[str, Any]] = None  # {targetKey: {enabled, lo, hi}}


class ParticleResult(BaseModel):
    fitness:    float
    kpi_values: Dict[str, float]
    kpi_scores: Dict[str, float]


class BatchEvalResponse(BaseModel):
    results: List[ParticleResult]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/eval-batch", response_model=BatchEvalResponse)
def eval_batch(req: BatchEvalRequest) -> BatchEvalResponse:
    targets = req.targets or {}
    results: list[ParticleResult] = []

    for position in req.positions:
        perturbed = apply_position(req.bike, position)
        kpis      = eval_kpis(perturbed)
        fitness, kpi_values, kpi_scores = compute_fitness(kpis, targets)

        results.append(ParticleResult(
            fitness    = round(fitness, 4),
            kpi_values = {k: round(v, 4) for k, v in kpi_values.items()},
            kpi_scores = {k: round(v, 6) for k, v in kpi_scores.items()},
        ))

    return BatchEvalResponse(results=results)
