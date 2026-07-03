# Chassis Workbench

![TypeScript](https://img.shields.io/badge/TypeScript-React_18-blue)
![Electron](https://img.shields.io/badge/Electron-Desktop-9cf)
![Python](https://img.shields.io/badge/Python-FastAPI-green)
![Physics](https://img.shields.io/badge/Physics-Foale_%C2%B7_Cossalter-red)

**A 32-tab desktop workbench for motorcycle chassis design — real-time geometry, suspension, anti-squat/anti-dive, stability, and multibody dynamics, with every number traceable to a textbook equation.**

Physics follows Foale *Motorcycle Handling and Chassis Design* and Cossalter *Motorcycle Dynamics*; each engine module cites the equations it implements.

---

## What's inside

Two cooperating layers, so results update as you type:

- **TypeScript physics in the app** (`chassis-workbench/src/engine/`) — pure, side-effect-free modules for instant feedback: geometry/trail, CoG & axle loads, suspension rates & sag, chain-line anti-squat (unified IC construction), ergonomics, load transfer, tire growth, kinematic sweeps, inertia, wheelie/stoppie stability, fork compliance, aero.
- **Python backend** (`api/`, FastAPI) — the same physics plus the heavy jobs: full-DAG analysis, travel sweeps, sensitivity, Monte-Carlo tolerance studies, optimization, and the structural concept lane.

The frontend pings the backend on every input change (150 ms coalesced) and merges authoritative results back into the UI; without the backend it still runs on the TS engines alone.

### The 32 tabs, grouped

| Group | Tabs |
|---|---|
| Geometry & setup | trail/rake, CoG, wheelbase, rider triangle, 8 calibrated bike-family presets |
| Suspension | rates, sag, natural frequencies, damping, motion-ratio sweeps, **Suspension Design Studio** |
| Anti-squat / anti-dive | chain-line IC construction, AS%, squat ratio R = tan τ / tan σ (Cossalter), braking anti-dive |
| Dynamics & stability | load transfer, cornering, wheelie/stoppie thresholds, speed sweeps, aero |
| Research lane (R1–R7) | advanced studies incl. dedicated anti-dive engine and Cossalter chassis-dynamics forces/moments |
| Structural concept lane | **Load Cases** + **Stiffness Targets** — first-order chassis targets, no in-app FEM by design |
| 3D & validation | Three.js view, kinematics visualizer, validation dashboards |

## Repo layout

```
chassis-workbench/   Electron + React 18 + Vite + TS app (Zustand, Recharts, Three.js)
                     └── CLAUDE.md — detailed architecture doc (single source of truth)
api/                 FastAPI backend: dag_analysis, sweep, sensitivity, monte_carlo,
                     optimize, dynamics, anti_squat, structural routers
engine/              Standalone TS physics modules (shared reference implementations)
dynamics_engine/     Python motorcycle-dynamics DAG engine
chassis_sim/         Geometry/dynamics/stability simulation package (+ tests)
mbd_engine/          Multibody dynamics: generalized-alpha solver + Newton iteration,
                     constraints/forces/contact/flexible bodies (+ tests)
structural_engine/   Load cases + stiffness targets (+ tests), Gazebo model parser
gazebo_lab/          ROS2/Gazebo physics lab — instrumented rig & self-balancing bike
tests/, validation/  Cross-engine regression + validation suites
```

## Running it

```bash
# Backend
pip install fastapi uvicorn numpy scipy
uvicorn api.main:app --port 8000

# App (dev)
cd chassis-workbench
npm install
npm run dev          # Vite on localhost:5173 (Electron wraps the same build)

# Tests
bash run_tests.sh    # backend + engine test suites
```

## Design principles

- **Traceability** — engine files carry equation numbers from the source texts; no magic constants.
- **Concept-lane structural analysis** — Load Cases and Stiffness Targets produce first-order targets a frame designer can take to real FEM; the app deliberately does not pretend to be a FEM package.
- **Two implementations, one truth** — the TS and Python engines implement the same equations and are cross-checked by the validation suite (backend tests + 0-TS-error builds are the merge bar).

## Status

Active. MBD engine phases 1–3 complete (kinematics, dynamics, constraints — 32/32 tests), contact/collision is next; backend suite green; Gazebo lab includes a self-balancing bike experiment.
