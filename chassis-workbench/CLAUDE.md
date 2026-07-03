# CLAUDE.md — Motorcycle Chassis Workbench
> This file is the **single source of truth** for AI context on this project.
> Read this instead of re-scanning all source files. Update when architecture changes.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **App name** | Motorcycle Chassis Dynamics Workbench (MPAW) |
| **Stack** | Electron + React 18 + Vite + TypeScript + Zustand + Recharts + Three.js |
| **Root** | `/home/dikshant/Desktop/Moter_bike/chassis-workbench/` |
| **Entry** | `src/main.tsx` → `src/App.tsx` |
| **Build** | `npm run build` (runs tsc then vite, outputs to `dist/`) — do NOT use `tsc --noEmit` alone (hangs) |
| **Dev** | `npm run dev` → localhost:5173 |
| **Physics ref** | Foale "Motorcycle Handling and Chassis Design" Ch.5/11 + Cossalter "Motorcycle Dynamics" Ch.5 |
| **PDF ref** | `anti_squat_anti_dive_motorcycles.docx.pdf` (§1–§9) |
| **Last updated** | 2026-05-20 |

---

## 2. Directory Tree

```
src/
├── App.tsx                     ← 22-tab router + header KPI pills + family selector
│                                  NOTE: FEM tab REMOVED (2026-05-20)
├── main.tsx                    ← React DOM entry
│
├── api/
│   └── backendClient.ts        ← Typed HTTP client: checkHealth(), runDagAnalysis(), runDynamics()
│                                  Auto-detects Electron (direct HTTP) vs browser (Vite proxy)
│                                  DagAnalysisResult covers ALL 13 physics modules
│
├── hooks/
│   └── useBackendSync.ts       ← Mounted in App.tsx; pings /api/health, fires on every
│                                  input change (150ms coalesce); updates store with backend values
│
├── engine/                     ← PURE PHYSICS — no React, no side effects
│   ├── types.ts                ← ALL interfaces (anchor — every other engine file imports this)
│   ├── computeAll.ts           ← Master orchestrator: calls all engines, FEM STUBBED (returns solved:false)
│   ├── geometry.ts             ← Trail, mechanical trail, swingarm angle (atan2 — matches backend)
│   ├── cog.ts                  ← Centre of gravity, static axle loads       (Eq 6.1–6.7)
│   ├── suspension.ts           ← Wheel rate, nat freq, sag%, damping ratio  (Eq 7.1–7.15)
│   ├── antiSquat.ts            ← Chain IC, AS%, anti-dive%, pro-squat/dive  (Eq 8.1–8.13)
│   │                              Exports: computeAntiSquatUnified() ← used by ALL panels
│   ├── ergonomics.ts           ← Rider triangle, knee/hip angles             (Eq 9.1–9.6)
│   ├── dynamics.ts             ← Load transfer, cornering forces             (Eq 10.1–10.7)
│   ├── tire.ts                 ← Free radius, deflection, contact patch, dynamic growth
│   ├── kinematics.ts           ← Rear axle locus, wheelbase change, chain length
│   ├── inertia.ts              ← Pitch/roll/yaw moments of inertia (I_xx, I_yy, I_zz)
│   ├── stability.ts            ← Wheelie/stoppie thresholds, lean limit, turning radius
│   ├── forkCompliance.ts       ← Fork deflection, effective trail change under braking
│   ├── femSolver.ts            ← KEPT but NOT CALLED — FEM tab removed, stub returns solved:false
│   ├── aero.ts                 ← Drag, lift, pitch moment, top speed prediction
│   ├── sweep.ts                ← MR/WR/AS%/trail over full suspension travel
│   │                              FIXED: antiSquatAtAngle() uses tangent contact point (was wrong)
│   ├── antiDiveEngine.ts       ← Anti-dive + load transfer specialized engine (PDF §1–§9)
│   ├── antiSquatAnalysis.ts    ← Cossalter squat ratio R = tan(τ)/tan(σ), σ/τ sweep
│   ├── chassisDynamics.ts      ← Chassis dynamics forces/moments (Cossalter §1.1–1.5)
│   └── dynamicsSweep.ts        ← Dynamics metrics vs speed range
│
├── store/
│   ├── useStore.ts             ← Zustand store (anchor — ALL panels import this)
│   │   KEY ADDITIONS (2026-05-20):
│   │     backendStatus, backendResults, backendDynamics
│   │     setBackendStatus(), setBackendResults()
│   │     mergeBackendIntoResults(ts, dag, input) — patches ALL 13 sections
│   │     computeAndMerge(input, dag) — used by all setters (TS + last backend merge)
│   └── useTheme.ts             ← Light/dark toggle
│
├── data/
│   └── families.ts             ← 8 bike presets — CALIBRATED 2026-05-20:
│                                  springRateFront = COMBINED 2-leg effective rate
│                                  springRateRear  = adjusted to give target sag at actual sprung load
│                                  forkCompliance + aero added to every preset
│                                  fork_bending_stiffness: 35–180 N/mm by family
│
├── components/
│   ├── panels/                 ← Input editing + analysis panels
│   │   ├── PanelShared.tsx, GeometryPanel.tsx, MassPanel.tsx, SuspensionPanel.tsx
│   │   ├── ChainPanel.tsx, ErgoPanel.tsx, DynamicsPanel.tsx
│   │   ├── FEMPanel.tsx        ← FILE EXISTS but tab is REMOVED — do not re-add without plan
│   │   ├── GraphsPanel.tsx, ChassisSweepPanel.tsx, ChassisDynamicsPanel.tsx
│   │   ├── AntiSquatPanel.tsx, AntiDiveDashboard.tsx
│   │   └── [Tire, Stability, Fork, Aero, Inertia, System panels]
│   │
│   ├── results/                ← ResultsPanel.tsx (tabular output of ComputeAllResult)
│   ├── compare/                ← ComparePanel.tsx, SweepComparePanel.tsx
│   ├── charts/                 ← SweepChart, MultiSweepChart, RadarChart
│   ├── visualization/
│   │   ├── ChassisViz2D.tsx    ← 2D SVG engineering drawing (~1,550 lines)
│   │   │   DIAGRAM DATA FLOW: shape reads input (instant) / overlays read results (backend)
│   │   │   IC marker, AS line, chain force line, CoG → from results (backend values)
│   │   │   Bike geometry shape, wheels, swingarm → from input (TypeScript, instant)
│   │   ├── bikeProfiles.ts     ← Visual profile data for 8 bike types
│   │   └── PhysicsGeometryDiagram.tsx
│   ├── scene3d/                ← Chassis3D.tsx, FEMScene.tsx (FEMScene unused since tab removed)
│   ├── overview/               ← OverviewPanel.tsx — shows backend badge + handling indices
│   ├── mbd/                    ← MBDPanel.tsx
│   ├── ai/                     ← AIChatPanel.tsx
│   └── custom/                 ← CustomBikeModal.tsx
│
└── utils/
    └── exportUtils.ts          ← CSV/JSON download helpers
```

---

## 3. Architecture: Module Dependency Graph

```
                          ┌─────────────────────────┐
                          │       types.ts           │  ← ANCHOR #1
                          │  (all interfaces)        │
                          └────────────┬────────────┘
                                       │ imported by ALL engine files
                                       ▼
                          ┌─────────────────────────┐
              ┌──────────►│      computeAll.ts       │◄──────────┐
              │           │  (orchestrates pipeline)  │           │
              │           └────────────┬────────────┘           │
              │                        │ returns ComputeAllResult │
              │                        ▼                          │
              │           ┌─────────────────────────┐            │
              │           │       useStore.ts        │  ← ANCHOR #2
              │           │  (Zustand, single store) │
              │           └──────────┬──────────────┘
              │                      │ imported by ALL panels
              │          ┌───────────┼────────────────┐
              │          ▼           ▼                 ▼
              │     GeomPanel   SuspPanel         ChainPanel ...
              │          │           │                 │
              │          └───────────┴────── setters auto-trigger
              │                                  computeAll.ts
              │
              │  SPECIALIZED ENGINES (imported directly by panels):
              │
              ├── antiSquat.ts  ──►  computeAntiSquatUnified()
              │       ▲                used by: AntiSquatPanel, AntiDiveDashboard
              │       │
              ├── antiSquatAnalysis.ts ──► computeSquatAnalysis(), squatCondition()
              │       ▲                    used by: AntiSquatPanel
              │       │
              ├── antiDiveEngine.ts ──► computeLoadTransfer(), computeAntiDive()
              │       ▲                 computeLeanSweep(), classifyDesignTarget()
              │       │                 checkICZone(), computeChainLoads()
              │       │                 used by: AntiDiveDashboard, AntiSquatPanel
              │       │
              └── chassisDynamics.ts, sweep.ts, dynamicsSweep.ts
                      used by: ChassisDynamicsPanel, ChassisSweepPanel
```

**Critical anchor files** (changing these has cascading effects):
1. `src/engine/types.ts` — every interface is here; change ripples everywhere
2. `src/store/useStore.ts` — all panels read/write through this; no direct state elsewhere
3. `src/engine/computeAll.ts` — orchestrates all engines; FEM stubbed; Step ordering matters
4. `src/engine/antiSquat.ts` → `computeAntiSquatUnified()` — used by 2 full dashboards
5. `src/api/backendClient.ts` — all backend types + toDagRequest() serialiser
6. `api/routers/dag_analysis.py` — calls all 7 Python modules; the backend entry point

---

## 4. The 22 Tabs  (FEM removed 2026-05-20)

| # | Tab Name | Icon | Layout | Component | Notes |
|---|----------|------|---------|-----------|-------|
| 1 | Overview | ◈ cyan | right-only | `OverviewPanel` | KPI + backend handling indices |
| 2 | Geometry | △ accent | split | `GeometryPanel` + `ChassisViz2D` | 18 params |
| 3 | Mass | ⊙ accent | split | `MassPanel` + `ChassisViz2D` | mass components list |
| 4 | Suspension | ≈ accent | split | `SuspensionPanel` + `ChassisViz2D` | spring/damper |
| 5 | Chain | ⚙ accent | split | `ChainPanel` + `ChassisViz2D` | sprockets, CVT flag |
| 6 | Ergo | ⊓ accent | split | `ErgoPanel` + `ChassisViz2D` | rider triangle |
| 7 | Dynamics | ⊗ accent | split | `DynamicsPanel` + `ChassisViz2D` | load scenarios |
| 8 | Graphs | ∿ accent2 | right-only | `GraphsPanel` | Recharts viz |
| 9 | 3D | ◺ red | right-only | `Chassis3D` | Three.js |
| 10 | Compare | ⇔ purple | full-width | `ComparePanel` | radar + bar |
| 11 | Simulator | ⟳ cyan | full-width | `MBDPanel` | multi-body dynamics |
| 12 | Chassis Sim | ≋ accent2 | full-width | `ChassisSweepPanel` | suspension sweep |
| 13 | Anti-Squat | ◆ accent | full-width | `AntiSquatPanel` | IC playground |
| 14 | Chassis Dynamics | ⊕ cyan | full-width | `ChassisDynamicsPanel` | dynamics sweep |
| 15 | Sweep Compare | ⇔ purple | full-width | `SweepComparePanel` | multi-config overlay |
| 16 | Anti-Dive | ↓ cyan | full-width | `AntiDiveDashboard` | AD% playground |
| 17 | System | ⊞ yellow | full-width | `SystemPanel` | unified params |
| 18 | Tire | ◎ accent | split | `TirePanel` + `ChassisViz2D` | tire physics |
| 19 | Inertia | ↻ accent2 | right-only | `InertiaPanel` | MOI visualization |
| 20 | Stability | ⊿ warn | split | `StabilityPanel` + `ChassisViz2D` | wheelie/stoppie |
| 21 | Fork | ⌥ accent | split | `ForkCompliancePanel` + `ChassisViz2D` | fork flex |
| 22 | Aero | ⊳ cyan | full-width | `AeroPanel` | drag/lift/speed |

**Layout rules in App.tsx:**
- `isRightOnly`: Overview, Graphs, 3D, Inertia → single right panel, no splitter
- Full-width list: Compare, Simulator, Chassis Sim, Anti-Squat, Chassis Dynamics, Sweep Compare, Anti-Dive, System, Aero
- Everything else: `ResizableSplit(InputPanel | ChassisViz2D + ResultsPanel)`
- Default split: 32% left / 68% right. Min 12%, max 68%.

---

## 5. Data Flow (Updated 2026-05-20 — Backend is primary source)

```
User moves slider
       │
       ▼
   setGeometry(patch) / setChain(patch) / etc.   [useStore.ts]
       │
       ├─ IMMEDIATE (TypeScript — structural base, instant visual feedback)
       │    computeAndMerge(input, lastDagResult)
       │    = computeAll(input) + mergeBackendIntoResults(ts, dag, input)
       │    → store.results updated → React re-renders instantly
       │
       └─ ASYNC 150ms (Python backend — real physics values)
            useBackendSync: fires after 150ms coalesce window
            POST /api/dag-analysis (all 13 modules)
            POST /api/dynamics
               │
               ▼
            mergeBackendIntoResults(ts, dag, input)
            patches ALL fields:
              geometry   → trail, swingarm_angle, wheelbase
              cog        → X_cg, Y_cg, loads, F/R%
              antiSquat  → IC, AS%, chain_force_angle, anti_dive%, gear_ratio
              dynamics   → load_transfer, frontPct_braking/accel, bank_angle
              inertia    → I_yaw, I_pitch, radii of gyration
              stability  → wheelie, stoppie, lean_limit, turn_radius, grade_max,
                           squat_mm, dive_mm, stabilityIndex, agilityIndex, etc.
              suspension → WR, fn, sag%, critical_damp, optimal_damp, unsprung_fn
              ergonomics → knee_angle, hip_angle, forward_lean
              tire       → contact_patch, dynamic_radius, combined_rate, corrected_fn
              kinematics → max_WB_change, max_chain_change
              fork       → deflection, trail_eff, SAT, flex_angle
              aero       → drag, lift, top_speed, pitch_moment
            → store.results updated → ALL panels re-render with real physics values

Backend backend status: 'offline' | 'syncing' | 'synced' | 'error'
  Shown in header BackendBadge pill (reads from store.backendStatus)

DIAGRAM SPLIT (ChassisViz2D):
  Shape (wheels, frame, swingarm, fork) → reads input directly → INSTANT
  Overlays (IC dot, AS line, chain force line, CoG) → reads results → BACKEND
```

**Interactive playground panels (Anti-Squat, Anti-Dive) are self-contained:**
- They read baseline from `useStore` (input + results — which now come from backend)
- Apply local overrides via `useState` (slider delta)
- Recompute via `useMemo` using engine functions directly (TypeScript only, not backend)
- Never write back to the store

---

## 6. State Management

### Zustand Store shape
```typescript
{
  // Inputs
  input: ComputeAllInput           // geometry, mass, suspension, chain, ergo, dynamics + optional
  familyName: string               // active preset name ("Sport / Supersport", etc.)
  results: ComputeAllResult        // auto-recomputed on every input change

  // Persistence
  savedConfigs: SavedConfig[]      // ≤8 configs for Sweep Compare
  customBikes: CustomBike[]        // user library (unlimited)

  // UI
  visibility: Visibility           // 25 boolean toggles for ChassisViz2D layers
  error: string | null
}
```

### localStorage keys
| Key | Contents | Used by |
|-----|----------|---------|
| `mcw_session` | `{ input, familyName }` | loadSession() on startup |
| `mcw_saved_configs` | `SavedConfig[]` | Sweep Compare panel |
| `mcw_custom_bikes` | `CustomBike[]` | Family dropdown + Compare |

### Setters (all auto-recompute `results`)
```
setGeometry(patch)         → input.geometry
setSuspension(patch)       → input.suspension
setChain(patch)            → input.chain
setErgo(patch)             → input.ergo
setDynamics(patch)         → input.dynamics
setMassComponents(list)    → input.massComponents
updateMassComponent(i,p)   → input.massComponents[i]
setTire / setKinematics / setStability / setForkCompliance
setFEMSection / setSweep / setAero
loadFamily(name)           → full input replacement from families.ts
```

---

## 7. Physics Engine Pipeline

### computeAll.ts execution order
```
Step 1:  geometry   = computeGeometry(input.geometry)
Step 2:  cog        = computeCoG(input.massComponents, input.geometry)
Step 3:  suspension = computeSuspension(input.suspension, cog, geometry)
Step 4:  antiSquat  = computeAntiSquat(input.chain, geometry, cog)
         ⚠  NOTE: computeAll uses legacy computeAntiSquat().
            Panels use computeAntiSquatUnified() which auto-computes chain angle.
            SYS-A: unify these (open issue).
Step 5:  ergonomics = computeErgonomics(input.ergo, geometry)
Step 6:  dynamics   = computeDynamics(input.dynamics, cog, geometry)
Step 7:  tire       = computeTire(input.tire or DEFAULT, cog, suspension)
Step 8:  kinematics = computeKinematics(input.kinematics or DEFAULT, geometry, suspension)
Step 9:  inertia    = computeInertia(input.massComponents, cog)
Step 10: stability  = computeStability(input.stability or DEFAULT, cog, geometry, dynamics)
Step 11: forkComp   = computeForkCompliance(input.forkCompliance or DEFAULT, geometry, dynamics)
Step 12: fem        = computeFEM(input.femSection or DEFAULT, geometry, cog, dynamics)
Step 13: aero       = computeAero(input.aero or DEFAULT, cog, geometry)
```

### Key physics formulas (quick reference)
```
Trail           = (R_f·cos(ε) - fork_offset) / sin(ε)           [geometry.ts Eq 5.1]
Swingarm angle  = atan2(H_ra - H_sp, WB - X_sp)                 [geometry.ts Eq 5.4]
AS% (Foale)     = h_at_front_vertical / Y_cg × 100              [antiSquat.ts Eq 8.8]
R (Cossalter)   = tan(τ) / tan(σ)                               [antiSquatAnalysis.ts]
θ_chain (auto)  = θ_geom + arcsin((r_rear - r_drive) / D)       [antiSquat.ts external tangent]
AD% (geometric) = tan(ε) / tan(θ_front_LT) × 100               [antiDiveEngine.ts §2.6]
AS%_eff lean    = AS%_upright / cos(φ)                          [antiDiveEngine.ts §7.1]
ΔW (load xfer)  = M × a_g × g × h_CoG / L                      [antiDiveEngine.ts §1.3]
Nat freq        = (1/2π) × sqrt(WR / m_sprung)                  [suspension.ts Eq 7.3]
```

---

## 8. Coordinate Systems

### ChassisViz2D (2D SVG panel)
```
Physics frame:  origin = swingarm pivot, +X forward (toward front), +Y up
Screen frame:   origin = top-left, +X right, +Y down
Transform:      sx = ox - px×scale    (mirror: physics +X → screen LEFT)
                sy = oy - py×scale
Front wheel renders LEFT, rear wheel renders RIGHT (conventional motorcycle view)
```

### antiSquat.ts / antiSquatAnalysis.ts
```
Origin = front tyre contact patch (0, 0)
+X = rearward (toward rear axle)
+Y = upward
Rear contact patch = (WB, 0)
```

### computeAll.ts / CoG outputs
```
X_cg = distance from FRONT axle rearward (mm)
Y_cg = height from ground (mm)
Swingarm pivot: X_sp from front axle, H_sp height
Rear axle: WB from front axle, H_ra height
```

---

## 9. The 8 Bike Presets (families.ts)

| Name | Rake | Key features |
|------|------|--------------|
| Sport / Supersport | 24° | 95mm trail, 320/220mm travel, 14/42T sprocket |
| Naked / Roadster | 25° | 100mm trail, 120/130mm travel, 15/42T |
| Adventure / ADV | 27° | 120mm trail, 200/220mm travel, 15/42T |
| Cruiser | 30° | 115mm trail, 130/120mm travel, 15/45T, 655mm swingarm |
| Touring / Luxury | 30° | 120mm trail, 120/110mm travel, 15/43T, 692mm swingarm |
| Supermoto | 25° | 105mm trail, 270/180mm travel, 13/42T, lightweight |
| Enduro / Off-Road | 26° | 120mm trail, 300/280mm travel, 13/52T, 21" front wheel |
| Scooter / Urban | 26° | 90mm trail, 90/100mm travel, isCVT=true, 44mm forkOffset |

**All presets corrected 2026-04-08:**
- Scooter: forkOffset 75→44, rearSprocket 68→45
- Cruiser: swingarmLength 640→655
- Touring: swingarmLength 650→692
- Enduro: forkOffset 22→32
- ALL 8: rider mass Y += 200mm (CoG at hip, not seat surface)

---

## 10. Interactive Playgrounds (Anti-Squat + Anti-Dive)

Both tabs share the same architecture pattern:

### Parameters → Overrides → Live Recompute
```typescript
// Local state only — never writes to store
const [selectedParamId, setSelectedParamId] = useState('rearAxleHeight');
const [paramDelta, setParamDelta] = useState(0);

// Baseline = current bike from store
const baseline = useMemo(() => computeAllMetrics(gp, chain, cog, susp), [...]);

// Modified = baseline + slider delta
const modified = useMemo(() => {
  const ovr = {}; // build override object from selectedParamId + paramDelta
  return computeAllMetrics(gp, chain, cog, susp, ovr);
}, [selectedParamId, paramDelta, ...]);

// Sweep = full range of selected parameter
const sweepData = useMemo(() => 20-point sweep across paramDef.min→max, [...]);
```

### Anti-Squat parameters (9)
`rearAxleHeight`, `cspHeight`, `cspPositionX`, `swingarmAngle`, `swingarmLength`,
`wheelbase`, `cogHeight`, `frontSprocket`, `rearSprocket`

### Anti-Dive parameters (8)
`rearAxleHeight`, `cspHeight`, `swingarmAngle`, `swingarmLength`,
`wheelbase`, `cogHeight`, `rakeAngle`, `frontSprocket`

### Swingarm angle delta implementation
```typescript
// Rotate arm keeping length, rear axle moves
const ang0 = atan2(H_ra - H_sp, WB - X_sp);
const L_sa = sqrt((WB - X_sp)² + (H_ra - H_sp)²);
const ang1 = ang0 + delta_deg × π/180;
H_ra_new = H_sp + L_sa × sin(ang1);
WB_new   = X_sp + L_sa × cos(ang1);
```

---

## 11. Geometric Constraints (Ground Contact Law)

These rules MUST be maintained at all times. Any code that changes wheel size or
suspension state must enforce them.

### Tyre Ground Contact (Primary Constraint)
```
CONSTRAINT: Both tyre contact patches always lie at Y = 0 (ground level).

Front axle height = frontWheelDia / 2     (always, on flat ground)
Rear axle height  = rearWheelDia  / 2     (always, on flat ground)
```

**Enforced in**: `src/store/useStore.ts → setGeometry(patch)`:
```typescript
if (patch.rearWheelDia !== undefined)  geom.rearAxleHeight = geom.rearWheelDia  / 2;
if (patch.frontWheelDia !== undefined) geom.frontAxleHeight = geom.frontWheelDia / 2;
```

**Enforced in**: `ChassisViz2D.tsx`: Front axle `FA` always uses `R_f` (not stored `frontAxleHeight`).

### Suspension Compression (Secondary Constraint)
When suspension compresses by Δh:
- The **wheel stays on the ground** (contact patch Y = 0).
- The **chassis pitches / translates vertically** — not the wheel.
- For the rear: the swingarm rotates, so swingarm pivot height H_sp changes.
- For the front: the fork compresses along the steering axis direction
  `Δaxle = Δfork_length × cos(headAngle)` (vertical) and
  `Δaxle_x = Δfork_length × sin(headAngle)` (horizontal — trail changes slightly).

> **Open Issue**: Full suspension-compression chassis-pitch coupling is not yet
> implemented. Suspension travel slider currently moves axle heights directly
> without enforcing chassis pitch. Tracked as SYS-B.

### Static Sag (Visual Pre-Compression)
`ChassisViz2D` has local-only sag state (`sagFront_mm`, `sagRear_mm`) that does **not** write to the store. Sag sliders appear bottom-left of the canvas.

- **Front sag**: fork crown translates along the steering-axis direction by `sagFront_mm`.
  `FA_sag_dx = sagFront_mm × sin(α)`,  `FA_sag_dy = -sagFront_mm × cos(α)`
  This shifts `HT_sag` and `HT_TOP_sag` — affects head-tube cylinder and fork rendering.
- **Rear sag**: `sagRear_mm` is available in state. Visual pivot offset not yet rendered (SYS-B).
- Slider max = 40% of `SuspensionParams.forkTravel` / `shockTravel`.

### ChassisViz2D Coordinate Notes
| Quantity | Stored as | Used in viz |
|----------|-----------|-------------|
| Front axle height | `geo.frontAxleHeight` (= `R_f`) | `R_f` directly (enforces ground contact) |
| Rear axle height | `geo.rearAxleHeight` (= `R_r`) | `geo.rearAxleHeight` (kept = `R_r` by store) |
| Ground Y (physics) | computed | `GROUND_Y = -H_sp` |
| Both contact patches | (WB, 0) and (0, 0) old-coords | `FC = (X_sp, GROUND_Y)`, `RC = (X_sp−WB, GROUND_Y)` |

---

## 12. ChassisViz2D — Rendering Reference

### Variable declaration order (CRITICAL — do not reorder)
```
1. Basic geometry:   X_sp, H_sp, WB, R_f, R_r, PIVOT, FA, RA, GROUND_Y, FC, RC
2. Steering geom:    sinA, cosA, HT, SA_TOP, SA_GND, HT_TOP      ← MUST come before sag
3. Static sag:       FA_sag_dx, FA_sag_dy, HT_sag, HT_TOP_sag    ← uses HT, sinA, cosA
4. Tyre sidewalls:   tireSidewall_f/r, R_f_rim, R_r_rim
5. Head tube:        HT_TUBE_R  (corners computed inline in screen space at render time)
6. Chain geom:       DS, RS, r_drive, r_rear, CHAIN_TOP_A/B, CHAIN_BOT_A/B
7. Anti-squat IC:    IC_fromAnalysis (useMemo)
8. CoG, load xfer:   COG, LT_END
9. Ergo:             ERGO_H, ERGO_S, ERGO_P
10. Riser/grip:      RISER_TOP, HB_GRIP  ← uses HT_TOP_sag, sinA, cosA, ergo.riserHeight_mm
11. Screen coords:   useMemo([S, ...]) → sPivot, sFa, sRa, sHt, _sHtTop, sHtSag, sHtTopSag,
                                          sRiserTop, sHbGrip, ...
12. Grip sync:       useEffect → physToOld(HB_GRIP) → setErgo({handlebarX, handlebarY})
```

**Bug history**: sag variables were placed BEFORE steering geometry in a prior session,
causing TDZ crash (`HT` not yet declared). Fixed 2026-04-14. Never move sag above steering.

### Layer rendering order (SVG painters algorithm, bottom→top)
```
grid → ground → coord axes → wheelbase dim → silhouette stroke
→ front wheel → rear wheel → swingarm → swingarm extension
→ frame spine → fork tubes → fork axis → head tube cylinder
→ steering axis → trail geometry → chain system → chain force line
→ anti-squat line → load transfer line → handlebar + stem
→ engine block → mass dots → CoG crosshair → instant centre
→ ergo triangle → ergo drag handles → pivot marker
→ scale bar → bike type badge → Tech Specs HUD
```

### Head tube 3D cylinder (vis.headTube)
Rendered as filled rectangle (two edge lines) with a specular highlight line.
Geometry computed inline in screen space from `sHtSag`/`sHtTopSag`:
```
rx = HT_TUBE_R × sc   (screen-space radius, HT_TUBE_R = 22 mm)
perpendicular = rotate axis direction 90°
4 corners = sHtSag ± perp×rx,  sHtTopSag ± perp×rx
highlight at +30% of left-side offset
```

### Handlebar riser + grip polyline (vis.handlebarForkLine)
Replaced single-stem + bar silhouette with a **physics-derived multi-segment polyline**
that auto-rotates with the steering axis (rake coupling built-in).

**3-point geometry:**
```
sHtTopSag  → sRiserTop → sHbGrip
  (triple clamp)  (riser top)  (grip end)
```

Physics computation:
```typescript
u_sa   = (-sinA, cosA)          // along steering axis (upward-rearward)
u_perp = (cosA, sinA)           // perpendicular to axis (forward-upward)

// Upper triple clamp = FA + forkLength × u_sa  (NOT HT_TOP_sag which is only 80mm from crown)
UPPER_TC     = FA + forkLength × u_sa
UPPER_TC_sag = UPPER_TC + (FA_sag_dx, FA_sag_dy)   // sag drops the triple clamp
RISER_TOP    = UPPER_TC_sag + riserHeight_mm × u_sa
HB_GRIP      = RISER_TOP + handlebarReach_mm × u_perp
// reach > 0 = forward (clip-on), reach < 0 = pull-back (cruiser)
```

**Key distinction**: `HT_TOP_sag` is the top of the 80mm *head tube cylinder* (frame tube near axle).
The *upper triple clamp* is `FA + forkLength × u_sa`, which for sport (720mm fork, 24° rake) gives ~960mm
height — matching the stored `handlebarY: 960`.

`useEffect` syncs `HB_GRIP` → `setErgo({handlebarX, handlebarY})` on every geometry change,
so the Ergo engine and Ergo panel always see the physically-derived grip location.

**Grip-end cross-section silhouette** (keyed on `profile.handlebarType`):
| Type | Render at `sHbGrip` | Used by |
|------|--------|---------|
| `clipOn` | Two end-on circles + clamp line | Sport |
| `wide` | Thick horizontal bar + end circles | Supermoto, Enduro |
| `pullBack` | Twin end-on circles + centre bar | Cruiser, Touring |
| `riser` | Wide cross-bar + end circles | ADV |
| `standard` | Single end-on circle | Naked, Scooter |
| `caf` | End-on circle shifted forward | (café racer) |

**ErgoParams additions** (`src/engine/types.ts`):
```typescript
riserHeight_mm?:    number  // mm above upper triple clamp along steering axis
handlebarReach_mm?: number  // mm perpendicular offset (+forward / −pullback)
```
Preset defaults in `families.ts`:
| Bike | riserHeight | reach |
|------|-------------|-------|
| Sport | 15 | +40 (clip-on forward) |
| Naked | 55 | −40 (slight pull-back) |
| ADV | 90 | −30 |
| Cruiser | 50 | −130 (strong pull-back) |
| Touring | 45 | −90 |
| Supermoto | 80 | 0 |
| Enduro | 90 | 0 |
| Scooter | 30 | +50 |

### Tech Specs HUD (always visible, top-right SVG overlay)
Displays live values from `results`:
- Static Trail (mm) — green if 80–120, red otherwise
- Rake Angle (°)
- Swingarm Angle (°)
- Anti-Squat Index (%) — green if 80–120, red otherwise

### Tyre profile rendering
Both wheels rendered as filled annulus (sidewall) + rim ring + 6 spoke lines:
```
R_rim = max(R_outer − sidewall_h, R_outer × 0.55)
sidewall_h = tireSpec.width × tireSpec.aspect / 100   (mm)
```
TireSpec data comes from `bikeProfiles.ts` per bike class.

---

## 13. bikeProfiles.ts — Visual Template Reference

Each of the 8 `BikeProfile` entries contains:
```typescript
handlebarType: HandlebarType  // 'clipOn'|'standard'|'wide'|'pullBack'|'riser'|'caf'
tireSpec: TireSpec            // { frontWidth, frontAspect, rearWidth, rearAspect }
fairing: 'full'|'half'|'naked'|'scrambler'|'tall'
accentColor / frameColor      // hex strings for silhouette/frame rendering
outline: [number,number][]    // normalised [t,v] path for bike silhouette shape
```

`detectCategory(familyName)` → `BikeCategory` (keyword match on family name string).
`getProfile(cat)` → `BikeProfile`.

---

## 14. Python Backend Architecture (added 2026-05-20)

**Root:** `/home/dikshant/Desktop/Moter_bike/`

```
api/
├── main.py                     ← FastAPI app, CORS, router registration
├── models.py                   ← Pydantic request/response models (camelCase ↔ snake_case)
└── routers/
    ├── dag_analysis.py         ← POST /api/dag-analysis — calls ALL 7 modules, returns 13 sections
    ├── dynamics.py             ← POST /api/dynamics — multi-g braking/accel sweep
    ├── sweep.py                ← POST /api/sweep — MR/WR/AS% vs travel (shock geometry needed)
    └── anti_squat.py           ← POST /api/anti-squat — Cossalter squat ratio sweep

dynamics_engine/
├── motorcycle_dynamics.py      ← DAG model: 40+ parameter nodes, topological propagation
│                                  FIXED 2026-05-20: _anti_squat_IC uses tangent contact point
└── modules/                    ← Standalone Python physics modules (NEW 2026-05-20)
    ├── suspension_engine.py    ← Port of suspension.ts (WR, fn, sag, damping, unsprung)
    ├── ergonomics_engine.py    ← Port of ergonomics.ts (knee/hip/lean, law of cosines)
    ├── tire_engine.py          ← Port of tire.ts (contact patch, dynamic radius, combined rate)
    ├── kinematics_engine.py    ← Port of kinematics.ts (axle locus, WB change, chain length)
    ├── fork_compliance_engine.py ← Port of forkCompliance.ts (deflection, trail reduction, SAT)
    └── aero_engine.py          ← Port of aero.ts (drag, lift, top speed, pitch moment)

chassis_sim/                    ← Original quasi-static Python engine (used by /api/sweep)
mbd_engine/                     ← Multi-body dynamics (32 tests passing)

validation/
├── validate_and_report.py      ← Full validation script — run with PYTHONPATH="" python3
└── validation_report.docx      ← Generated report: 39 checks, 84% pass rate
```

**Start backend:**
```bash
cd /home/dikshant/Desktop/Moter_bike
uvicorn api.main:app --reload --port 8000
```
Or launch `npm run electron:dev` — Electron auto-spawns uvicorn on port 8000.

**Run tests:**
```bash
./run_tests.sh chassis_sim/tests/ mbd_engine/tests/ -v
# NOT bare pytest — ROS2 PYTHONPATH conflict (conftest.py strips paths)
```

**Key backend invariants:**
- All angles: degrees in API, radians internally
- All lengths: mm  |  All mass: kg  |  All force: N
- Swingarm angle uses `atan2(H_ra−H_sp, WB−X_sp)` — matches TypeScript `computeAntiSquatUnified`
- AS% uses upper-run tangent contact point (not CS center) — consistent with TS engine
- Spring rates: `springRateFront` = COMBINED 2-leg effective rate for forks

---

## 15. Known Issues / Open Work

| ID | Status | Description |
|----|--------|-------------|
| **SYS-A** | **RESOLVED 2026-04-14** | `computeAntiSquatUnified()` now used everywhere. |
| **SYS-B** | Open | Rear static sag visual not wired to SVG swingarm pivot. |
| **FEM-TAB** | **REMOVED 2026-05-20** | FEM tab deleted from App.tsx. femSolver.ts stubbed (returns solved:false). FEMPanel.tsx/FEMScene.tsx kept but unused. Do not re-add without a proper structural model plan. |
| **SWEEP-MR** | Open | `/api/sweep` endpoint: MR=6.1 (wrong) due to default ShockMount geometry (shockArmAngle=85°). Needs calibrated shock geometry defaults per preset. |
| **AS%-PRESET** | **RESOLVED 2026-05-20** | Sport AS%=185% (Foale) + R=0.975 (Cossalter) now both shown in header KPI pill. R=0.975 ≈ neutral — Foale 185% is a known artifact when IC is between axles. KPI green when 0.7≤R≤1.3. |
| **AERO-TOPSPEED** | **RESOLVED 2026-05-20** | Top speed now = min(power-limited, gear-limited). Each preset has topGearRatioOverall + maxRPM. Sport: 473→383 km/h. Drag forces at reference speeds unchanged. |
| **Phase 4 MBD** | Next | Contact + Collision in chassis_sim (broadphase, GJK, LCP/Lemke, tire contact). |
| **Phase 8 chassis_sim** | Sprint 3 | Whipple eigenvalue modes vs speed (capsize/weave/wobble). |
| **Phase 12 chassis_sim** | Sprint 4 | Pacejka tire model. |

---

## 15. How to Add a New Tab

1. Create `src/components/panels/MyPanel.tsx` — export default component
2. Add to `TABS` array in `App.tsx` (string name)
3. Add to `TAB_META` in `App.tsx` (icon, color, shortcut)
4. Add `const isMyTab = activeTab === 'MyTab';` in App.tsx
5. Render: `{isMyTab && <MyPanel />}` inside the body section
6. If full-width: add `!isMyTab` to the normal-layout exclusion list
7. If two-pane: the `ResizableSplit` wrapper is applied automatically by the normal layout branch
8. Update `MEMORY.md` and this file

---

## 16. CSS / Styling Conventions

- CSS variables: `var(--accent)`, `var(--accent2)`, `var(--cyan)`, `var(--warn)`, `var(--purple)`
- `var(--text-primary)`, `var(--text-muted)`, `var(--surface)`, `var(--bg)`, `var(--border)`
- All inline styles (no Tailwind, no CSS modules)
- Panel classes: `left-panel`, `right-panel`, `panel-body`, `btn-sm`
- Design tokens object pattern: `const C = { accent, cyan, warn, ... }` in each dashboard

---

## 17. Export & Persistence

```
JSON export  → exportJSON() → full ComputeAllInput + ComputeAllResult
CSV export   → exportCSV()  → flattened key-value table
Session      → saveSession() / loadSession() → mcw_session in localStorage
Configs      → savedConfigs → mcw_saved_configs (≤8, used by Sweep Compare)
Custom bikes → customBikes  → mcw_custom_bikes (unlimited, used everywhere)
```
