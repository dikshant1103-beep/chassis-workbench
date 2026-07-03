/**
 * structural/loadCases.ts — Chassis Structural Load-Case Engine (Layer A, analytical)
 *
 * Turns named riding events into standardized structural load cases: force
 * vectors + moments at the attachment points a CAE/FEM engineer needs as
 * boundary conditions. This is the first-principles rigid-body free-body
 * (D'Alembert) tier — instant, in-app. Gazebo (Layer B) later overrides the
 * dynamic-amplification factors and the dynamic cases with *measured* loads.
 *
 * Generalizes computeEnvelope() from LoadEnvelopePanel.tsx into a reusable,
 * vectorized engine with provenance tags.
 *
 * COORDINATE FRAME (vehicle):
 *   x = forward (+ toward front wheel)
 *   y = lateral (+ to the right)
 *   z = up
 *   Forces in N, moments in N·m.
 *
 * PHYSICAL BOUNDS: every case is clamped to what the bike can actually do —
 *   braking ≤ min(μg, stoppie), accel ≤ min(μg, wheelie), corner ≤ min(μg, lean),
 *   combined ≤ friction circle √(ax²+ay²) ≤ μg. (see stability.ts)
 *
 * REFERENCES (see references/REFERENCE_MAP.md):
 *   Foale Ch.7/8 — fork lever arm 600–800mm, swingarm load paths
 *   Cossalter Ch.3 — load transfer
 *   structural_constants.md — DAFs, μ
 */

import { G } from '../cog';
import { computeStoppieThreshold, computeWheelieThreshold } from '../stability';

const DEG = Math.PI / 180;
const CHAIN_PITCH = 15.875; // mm — 520/525 chain

// ── Provenance ──────────────────────────────────────────────────────────────
export type Provenance = 'analytical' | 'gazebo';
/** computed = derived rigorously from inputs; estimated = uses a documented assumption/lever */
export type Confidence = 'computed' | 'estimated';

// ── Load case definition ─────────────────────────────────────────────────────
export interface LoadCaseDef {
  id: string;
  label: string;
  axG: number;     // longitudinal accel in g (+ forward accel, − braking)
  ayG: number;     // lateral accel in g (cornering, magnitude)
  daf: number;     // vertical dynamic amplification factor (bump/pothole/landing); 1.0 = none
  kind: 'static' | 'brake' | 'accel' | 'corner' | 'combined' | 'impact';
  color: string;
}

/** Standard chassis load-case set. DAFs are `estimated` (structural_constants.md);
 *  Layer B (Gazebo) replaces them with measured transients. */
export const STANDARD_LOAD_CASES: LoadCaseDef[] = [
  { id: 'static1up',  label: 'Static (1-up)',        axG:  0.0,  ayG: 0.0,  daf: 1.0, kind: 'static',   color: 'var(--text-muted)' },
  { id: 'static2up',  label: 'Static (2-up + bags)', axG:  0.0,  ayG: 0.0,  daf: 1.0, kind: 'static',   color: 'var(--text-muted)' },
  { id: 'brake04',    label: 'Soft Brake 0.4g',      axG: -0.4,  ayG: 0.0,  daf: 1.0, kind: 'brake',    color: 'var(--cyan)' },
  { id: 'brake10',    label: 'Hard Brake 1.0g',      axG: -1.0,  ayG: 0.0,  daf: 1.0, kind: 'brake',    color: 'var(--accent)' },
  { id: 'brake12',    label: 'Emergency 1.2g',       axG: -1.2,  ayG: 0.0,  daf: 1.0, kind: 'brake',    color: 'var(--danger)' },
  { id: 'accel04',    label: 'Accel 0.4g',           axG:  0.4,  ayG: 0.0,  daf: 1.0, kind: 'accel',    color: 'var(--cyan)' },
  { id: 'accel08',    label: 'Hard Accel 0.8g',      axG:  0.8,  ayG: 0.0,  daf: 1.0, kind: 'accel',    color: 'var(--accent2)' },
  { id: 'corner10',   label: 'Corner 1.0g lat',      axG:  0.0,  ayG: 1.0,  daf: 1.0, kind: 'corner',   color: 'var(--purple)' },
  { id: 'trail',      label: 'Trail Brake (combined)',axG: -0.5, ayG: 0.6,  daf: 1.0, kind: 'combined', color: 'var(--warn)' },
  { id: 'bump',       label: 'Road Bump (DAF 2.5)',  axG:  0.0,  ayG: 0.0,  daf: 2.5, kind: 'impact',   color: '#e8b44a' },
  { id: 'pothole',    label: 'Pothole (DAF 3.5)',    axG: -0.3,  ayG: 0.0,  daf: 3.5, kind: 'impact',   color: '#d98c2b' },
  { id: 'kerb',       label: 'Kerb Strike (lat DAF 2)',axG: 0.0,  ayG: 1.0,  daf: 2.0, kind: 'impact',   color: '#c0653f' },
  { id: 'landing',    label: 'Jump Landing (DAF 4)',  axG:  0.0,  ayG: 0.0,  daf: 4.0, kind: 'impact',   color: '#b04a4a' },
];

// ── Engine inputs ────────────────────────────────────────────────────────────
export interface LoadCaseInputs {
  totalMass: number;       // kg
  R_front0: number;        // N  — static front reaction
  R_rear0: number;         // N  — static rear reaction
  Y_cg: number;            // mm — CoG height
  X_cg: number;            // mm — CoG from front axle
  wheelbase: number;       // mm
  trail: number;           // mm
  headAngleDeg: number;    // deg from vertical (rake)
  forkOffset: number;      // mm
  forkLeverMm: number;     // mm — front axle → steering head distance (Foale 600–800)
  rearWheelDia: number;    // mm
  rearSprocket: number;    // teeth
  chainAngleDeg: number;   // deg (antiSquat.chainForceAngleAuto)
  swingarmAngleDeg: number;// deg
  swingarmLengthMm: number;// mm
  isCVT: boolean;
  mu: number;              // tyre–road friction (bound)
  brakeFrontShare: number; // 0..1 fraction of braking on front (sport ~0.85)
  shockLeverRatio: number; // shock force / wheel force (estimated ~1.3)
  // component masses (kg) for inertial attachment loads — pass 0 if unknown
  engineMass: number;
  riderMass: number;
  pillionLuggageMass: number;
}

// ── Outputs ──────────────────────────────────────────────────────────────────
export interface AttachmentLoad {
  id: string;
  label: string;
  Fx: number; Fy: number; Fz: number;   // N (vehicle frame)
  resultantF: number;                    // N
  moment: number;                        // N·m (resultant bending/torque where defined)
  confidence: Confidence;
  note?: string;
}

export interface LoadCaseResult {
  def: LoadCaseDef;
  attachments: AttachmentLoad[];
  Nf: number;            // N — front vertical reaction (with transfer + DAF)
  Nr: number;            // N — rear vertical reaction
  leanDeg: number;       // equilibrium lean for the lateral accel
  feasible: boolean;     // within physical limits?
  limitedBy: string | null;
  provenance: Provenance;
}

const hypot3 = (a: number, b: number, c: number) => Math.sqrt(a * a + b * b + c * c);

/** Compute structural loads at every attachment point for one load case. */
export function computeLoadCase(
  inp: LoadCaseInputs,
  def: LoadCaseDef,
  safetyFactor = 1.0,
): LoadCaseResult {
  const m = inp.totalMass;
  const WB = inp.wheelbase;

  // --- physical-limit clamp (friction circle + stoppie/wheelie) ---------------
  const aStoppie_g = computeStoppieThreshold(inp.X_cg, inp.Y_cg) / G;
  const aWheelie_g = computeWheelieThreshold(WB, inp.X_cg, inp.Y_cg) / G;
  let axG = def.axG, ayG = def.ayG, limitedBy: string | null = null;
  // friction circle
  const reqMag = Math.hypot(axG, ayG);
  if (reqMag > inp.mu && reqMag > 1e-6) {
    const s = inp.mu / reqMag; axG *= s; ayG *= s; limitedBy = `friction μ=${inp.mu}`;
  }
  if (axG < 0 && Math.abs(axG) > aStoppie_g) { axG = -aStoppie_g; limitedBy = `stoppie ${aStoppie_g.toFixed(2)}g`; }
  if (axG > 0 && axG > aWheelie_g)           { axG = aWheelie_g;  limitedBy = `wheelie ${aWheelie_g.toFixed(2)}g`; }
  const feasible = limitedBy === null;

  const ax = axG * G;   // m/s² (signed)
  const ay = ayG * G;   // m/s²
  const nz = def.daf;   // vertical amplification

  // --- vertical reactions with longitudinal transfer + DAF --------------------
  const dW = m * Math.abs(ax) * inp.Y_cg / WB;        // N
  let Nf = (axG < 0 ? inp.R_front0 + dW : inp.R_front0 - dW) * nz;
  let Nr = (axG < 0 ? inp.R_rear0 - dW : inp.R_rear0 + dW) * nz;
  Nf = Math.max(0, Nf); Nr = Math.max(0, Nr);
  const Nsum = Nf + Nr || 1;

  // --- contact longitudinal / lateral forces ----------------------------------
  let Fx_f = 0, Fx_r = 0;
  if (axG < 0) { Fx_f = -m * Math.abs(ax) * inp.brakeFrontShare; Fx_r = -m * Math.abs(ax) * (1 - inp.brakeFrontShare); }
  else if (axG > 0) { Fx_r = m * ax; }   // rear-wheel drive
  const Fy_tot = m * ay;
  const Fy_f = Fy_tot * Nf / Nsum;
  const Fy_r = Fy_tot * Nr / Nsum;

  // --- chain tension (accel only) ---------------------------------------------
  const r_wheel = inp.rearWheelDia / 2;
  const r_sprocket = (inp.rearSprocket * CHAIN_PITCH) / (2 * Math.PI);
  const chainRatio = r_sprocket > 1e-6 ? r_wheel / r_sprocket : 0;
  const chainTen = axG > 0 ? m * ax * chainRatio : 0;
  const chainAng = (inp.isCVT || isNaN(inp.chainAngleDeg) ? inp.swingarmAngleDeg : inp.chainAngleDeg) * DEG;

  const cosHead = Math.cos(inp.headAngleDeg * DEG);
  const Lf = inp.forkLeverMm / 1000;     // m
  const Lsa = inp.swingarmLengthMm / 1000; // m
  const sf = safetyFactor;

  const att: AttachmentLoad[] = [];

  // 1. Front axle (contact resultant)
  att.push({
    id: 'frontAxle', label: 'Front Axle',
    Fx: Fx_f * sf, Fy: Fy_f * sf, Fz: Nf * sf,
    resultantF: hypot3(Fx_f, Fy_f, Nf) * sf, moment: 0,
    confidence: 'computed',
  });

  // 2. Steering-head bearings (axial along steer axis + bending from contact forces)
  const Faxial_head = cosHead > 0.01 ? Nf / cosHead : Nf;
  const M_head = Math.hypot(Fx_f * Lf, Fy_f * Lf); // N·m bending at head
  att.push({
    id: 'steeringHead', label: 'Steering Head',
    Fx: Fx_f * sf, Fy: Fy_f * sf, Fz: Faxial_head * sf,
    resultantF: hypot3(Fx_f, Fy_f, Faxial_head) * sf, moment: M_head * sf,
    confidence: 'estimated', note: `fork lever ${inp.forkLeverMm}mm (Foale 600–800)`,
  });

  // 3. Rear axle (contact resultant)
  att.push({
    id: 'rearAxle', label: 'Rear Axle',
    Fx: Fx_r * sf, Fy: Fy_r * sf, Fz: Nr * sf,
    resultantF: hypot3(Fx_r, Fy_r, Nr) * sf, moment: 0,
    confidence: 'computed',
  });

  // 4. Swingarm pivot (rear vertical + chain pull + lateral, bending over arm)
  const Fpiv_v = Nr + chainTen * Math.sin(chainAng);
  const Fpiv_h = Fx_r + chainTen * Math.cos(chainAng);
  const M_sa = Math.hypot(Nr * Lsa, Fy_r * Lsa);
  att.push({
    id: 'swingarmPivot', label: 'Swingarm Pivot',
    Fx: Fpiv_h * sf, Fy: Fy_r * sf, Fz: Fpiv_v * sf,
    resultantF: hypot3(Fpiv_h, Fy_r, Fpiv_v) * sf, moment: M_sa * sf,
    confidence: 'computed',
  });

  // 5. Shock / linkage mount (rear suspension force, estimated lever ratio)
  const Fshock = Nr * inp.shockLeverRatio;
  att.push({
    id: 'shockMount', label: 'Shock Mount',
    Fx: 0, Fy: 0, Fz: Fshock * sf,
    resultantF: Fshock * sf, moment: 0,
    confidence: 'estimated', note: `lever ratio ${inp.shockLeverRatio} (no shock geometry)`,
  });

  // 6. Engine mounts (engine inertial load)
  const me = inp.engineMass;
  att.push({
    id: 'engineMount', label: 'Engine Mounts',
    Fx: me * ax * sf, Fy: me * ay * sf, Fz: me * G * nz * sf,
    resultantF: hypot3(me * ax, me * ay, me * G * nz) * sf, moment: 0,
    confidence: me > 0 ? 'computed' : 'estimated',
    note: me > 0 ? undefined : 'engine mass unknown',
  });

  // 7. Footpeg (rider inertial load)
  const mr = inp.riderMass;
  att.push({
    id: 'footpeg', label: 'Footpeg',
    Fx: mr * ax * sf, Fy: mr * ay * sf, Fz: mr * G * nz * sf,
    resultantF: hypot3(mr * ax, mr * ay, mr * G * nz) * sf, moment: 0,
    confidence: mr > 0 ? 'computed' : 'estimated',
  });

  // 8. Subframe (pillion + luggage)
  const ms = inp.pillionLuggageMass;
  att.push({
    id: 'subframe', label: 'Subframe',
    Fx: ms * ax * sf, Fy: ms * ay * sf, Fz: ms * G * nz * sf,
    resultantF: hypot3(ms * ax, ms * ay, ms * G * nz) * sf, moment: 0,
    confidence: 'estimated', note: 'pillion+luggage lumped',
  });

  // 9. Chain (scalar tension)
  att.push({
    id: 'chain', label: 'Chain Tension',
    Fx: chainTen * Math.cos(chainAng) * sf, Fy: 0, Fz: chainTen * Math.sin(chainAng) * sf,
    resultantF: chainTen * sf, moment: 0,
    confidence: 'computed',
  });

  return {
    def, attachments: att, Nf, Nr,
    leanDeg: Math.atan(ayG) / DEG,
    feasible, limitedBy, provenance: 'analytical',
  };
}

/** Aggregate over a list of load cases. */
export function computeLoadCases(
  inp: LoadCaseInputs,
  cases: LoadCaseDef[] = STANDARD_LOAD_CASES,
  safetyFactor = 1.0,
): LoadCaseResult[] {
  return cases.map(c => computeLoadCase(inp, c, safetyFactor));
}

/** Governing (worst) case per attachment point, by resultant force. */
export function governingCases(results: LoadCaseResult[]): Record<string, { caseId: string; value: number }> {
  const out: Record<string, { caseId: string; value: number }> = {};
  for (const r of results) {
    for (const a of r.attachments) {
      if (!out[a.id] || a.resultantF > out[a.id].value) out[a.id] = { caseId: r.def.id, value: a.resultantF };
    }
  }
  return out;
}
