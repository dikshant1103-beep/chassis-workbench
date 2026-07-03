"""
api/main.py — FastAPI backend for Motorcycle Chassis Workbench (Phase 5)

Endpoints:
  POST /api/sweep        — suspension travel sweep (MR, WR, AS%, trail)
  POST /api/dynamics     — weight transfer / braking sweep
  POST /api/anti-squat   — Cossalter squat ratio sweep

Start server:
  cd /home/dikshant/Desktop/Moter_bike
  uvicorn api.main:app --reload --port 8000

The Vite dev server proxies /api/* → localhost:8000 (see vite.config.ts).
By default the React app computes everything client-side (zero latency).
The API is available as a heavier compute fallback when needed.

Dependencies:
  pip install fastapi uvicorn pydantic
"""

import sys
import os

# Ensure chassis_sim and mbd_engine packages are importable from api/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import sweep, dynamics, anti_squat, dag_analysis, sensitivity, monte_carlo, optimize, structural

app = FastAPI(
    title="Motorcycle Chassis Workbench API",
    description="Physics engine backend — Foale / Cossalter chassis geometry & dynamics",
    version="1.1.0",
)

# CORS: allow Vite dev server and Electron
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "file://",        # Electron
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers under /api prefix
app.include_router(sweep.router,        prefix="/api", tags=["Sweep"])
app.include_router(dynamics.router,     prefix="/api", tags=["Dynamics"])
app.include_router(anti_squat.router,   prefix="/api", tags=["Anti-Squat"])
app.include_router(dag_analysis.router, prefix="/api", tags=["DAG Analysis"])
app.include_router(sensitivity.router,  prefix="/api", tags=["R&D — Sensitivity"])
app.include_router(monte_carlo.router,  prefix="/api", tags=["R&D — Monte Carlo"])
app.include_router(optimize.router,     prefix="/api", tags=["R&D — Optimizer"])
app.include_router(structural.router,   prefix="/api", tags=["Structural — Load Cases"])


@app.get("/api/health")
def health():
    """Health check — returns ok if server is running."""
    return {"status": "ok", "version": "1.1.0"}
