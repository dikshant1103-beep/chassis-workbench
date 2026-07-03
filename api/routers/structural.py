"""api/routers/structural.py — Structural load cases + stiffness targets.

POST /api/structural/loadcases       — analytical load cases (mirror of TS)
POST /api/structural/stiffness-target — stiffness target derivation (M2)

Gazebo high-fidelity endpoints (/api/structural/gazebo/*) are added in M3.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import asdict
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from structural_engine.load_cases import (
    LoadCaseInputs,
    LoadCaseDef,
    STANDARD_LOAD_CASES,
    compute_load_cases,
)
from structural_engine.stiffness_targets import (
    StiffnessTargetInputs,
    compute_stiffness_targets,
)

router = APIRouter()


class LoadCaseInputsIn(BaseModel):
    totalMass: float
    R_front0: float
    R_rear0: float
    Y_cg: float
    X_cg: float
    wheelbase: float
    trail: float
    headAngleDeg: float
    forkOffset: float
    forkLeverMm: float = 700.0
    rearWheelDia: float
    rearSprocket: float
    chainAngleDeg: float
    swingarmAngleDeg: float
    swingarmLengthMm: float
    isCVT: bool = False
    mu: float = 1.1
    brakeFrontShare: float = 0.85
    shockLeverRatio: float = 1.3
    engineMass: float = 0.0
    riderMass: float = 0.0
    pillionLuggageMass: float = 0.0


class LoadCaseDefIn(BaseModel):
    id: str
    label: str
    axG: float
    ayG: float
    daf: float = 1.0
    kind: str = "custom"
    color: str = ""


class LoadCasesRequest(BaseModel):
    inputs: LoadCaseInputsIn
    cases: Optional[List[LoadCaseDefIn]] = None
    safetyFactor: float = Field(1.0, ge=0.1, le=5.0)


@router.post("/structural/loadcases")
def run_loadcases(req: LoadCasesRequest):
    try:
        inp = LoadCaseInputs(**req.inputs.model_dump())
        defs = (
            [LoadCaseDef(**c.model_dump()) for c in req.cases]
            if req.cases
            else STANDARD_LOAD_CASES
        )
        results = compute_load_cases(inp, defs, req.safetyFactor)
        return {
            "provenance": "analytical",
            "cases": [
                {
                    "def": r.def_,
                    "Nf": r.Nf,
                    "Nr": r.Nr,
                    "leanDeg": r.leanDeg,
                    "feasible": r.feasible,
                    "limitedBy": r.limitedBy,
                    "attachments": [asdict(a) for a in r.attachments],
                }
                for r in results
            ],
        }
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


class StiffnessTargetIn(BaseModel):
    totalMass: float
    Y_cg: float
    R_front0: float
    R_rear0: float
    I_roll: float
    mu: float = 1.1
    allowableTwistDeg: float = 0.18
    allowableLatDeflMm: float = 1.5
    wobbleFreqHz: float = 7.0
    freqMargin: float = 1.5


@router.post("/structural/stiffness-target")
def run_stiffness_target(req: StiffnessTargetIn):
    try:
        inp = StiffnessTargetInputs(**req.model_dump())
        return compute_stiffness_targets(inp)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Gazebo high-fidelity (Layer B) — async job: spawn headless run, parse FT logs.
# Jobs are tracked in-process; runs land in <tmp>/gazebo_lab_runs/<id>/.
# ─────────────────────────────────────────────────────────────────────────────

_JOBS: Dict[str, dict] = {}
_RUNS_ROOT = os.path.join(tempfile.gettempdir(), "gazebo_lab_runs")
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class GazeboRunRequest(BaseModel):
    mode: str = Field("rig", pattern="^(rig|ride)$")
    world: str = "flat"
    params: dict = Field(default_factory=dict)  # BikeParams fields
    timeout: float = 90.0


@router.post("/structural/gazebo/run")
def gazebo_run(req: GazeboRunRequest):
    """Spawn a headless Gazebo structural run. Returns a job id to poll."""
    job_id = uuid.uuid4().hex[:12]
    run_dir = os.path.join(_RUNS_ROOT, job_id)
    os.makedirs(run_dir, exist_ok=True)

    env = dict(os.environ)
    env["PYTHONPATH"] = _REPO_ROOT + os.pathsep + env.get("PYTHONPATH", "")
    cmd = [
        sys.executable, "-m", "gazebo_lab.run_loadcases",
        "--mode", req.mode, "--run-dir", run_dir,
        "--world", req.world, "--params", json.dumps(req.params),
        "--timeout", str(req.timeout),
    ]
    try:
        proc = subprocess.Popen(cmd, cwd=os.path.join(_REPO_ROOT, "gazebo_lab"),
                                env=env, stdout=open(os.path.join(run_dir, "stdout.log"), "w"),
                                stderr=subprocess.STDOUT)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"cannot launch run: {e}")

    _JOBS[job_id] = {"pid": proc.pid, "proc": proc, "run_dir": run_dir,
                     "mode": req.mode, "world": req.world, "started": time.time()}
    return {"job_id": job_id, "state": "starting", "run_dir": run_dir}


@router.get("/structural/gazebo/status/{job_id}")
def gazebo_status(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="unknown job")
    run_dir = job["run_dir"]
    state = "running"
    status_path = os.path.join(run_dir, "status.json")
    if os.path.exists(status_path):
        try:
            state = json.load(open(status_path)).get("state", "running")
        except Exception:
            pass
    rc = job["proc"].poll()
    if rc is not None and state not in ("done", "error"):
        state = "done" if os.path.exists(os.path.join(run_dir, "manifest.json")) else "error"
    return {"job_id": job_id, "state": state, "returncode": rc,
            "elapsed": round(time.time() - job["started"], 1)}


@router.get("/structural/gazebo/result/{job_id}")
def gazebo_result(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="unknown job")
    from structural_engine.gazebo_parse import parse_ft_log
    return parse_ft_log(job["run_dir"])
