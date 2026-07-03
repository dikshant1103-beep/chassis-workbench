/**
 * structural/stiffnessTargets.ts — Frame Stiffness Target Engine (concept lane)
 *
 * We do NOT solve the frame (that's ANSYS's job). We DERIVE the *required*
 * stiffness target two independent ways and benchmark the components that have
 * published data. Two first-principles routes:
 *
 *   1. Deflection-budget:  K_target = M_applied / θ_allowable
 *      The steering head must not twist/deflect more than a handling-quality
 *      budget under the worst cornering load. (Foale frame-stiffness rationale)
 *
 *   2. Frequency-separation: K_target = I_eff · (2π·f_target)²
 *      The frame's structural torsional mode must sit a margin ABOVE the
 *      rigid-body wobble mode so the two don't couple. (Cossalter Ch.7:
 *      ν_wobble = (1/2π)√(K_λf·a_n/I_f), 4–10 Hz; frame mode must clear it.)
 *
 * Recommended target = max(route 1, route 2) — the conservative governing value.
 * Frame stiffness has no reliable public benchmark (proprietary) → the derived
 * target is tagged 'estimated'; swingarm/fork ARE benchmarked (published ranges).
 *
 * REFERENCES: references/extractions/structural_constants.md
 */

import { G } from '../cog';

const DEG = Math.PI / 180;

export interface StiffnessTargetInputs {
  totalMass: number;       // kg
  Y_cg: number;            // mm — CoG height (torsion lever)
  R_front0: number;        // N — static front reaction (for lateral force share)
  R_rear0: number;         // N
  I_roll: number;          // kg·m² — proxy for frame torsional inertia
  mu: number;              // cornering lateral capability (g ≈ μ)
  // tunables (from structural_constants.md)
  allowableTwistDeg: number;   // θ_allow, steering-head twist under full corner (0.10–0.25)
  allowableLatDeflMm: number;  // δ_allow, head lateral deflection (≈1–2 mm)
  wobbleFreqHz: number;        // f_wobble estimate (4–10 Hz band)
  freqMargin: number;          // frame mode must clear wobble by this factor (≈1.5)
}

export interface BenchmarkBand {
  label: string;
  unit: string;
  min: number;
  max: number;
  tag: 'measured' | 'lit' | 'estimated';
  src: string;
}

export interface StiffnessTargetResult {
  // Torsional frame target (Nm/deg)
  torsionalTarget_deflection_Nm_per_deg: number;
  torsionalTarget_frequency_Nm_per_deg: number;
  torsionalTarget_recommended_Nm_per_deg: number;
  governingRoute: 'deflection' | 'frequency';
  // Lateral steering-head target (N/mm)
  lateralTarget_N_per_mm: number;
  // intermediate (for transparency)
  corneringLatForce_N: number;
  torsionalMoment_Nm: number;
  frameModeTarget_Hz: number;
  provenance: 'analytical';
  targetTag: 'estimated';  // frame has no public benchmark
}

/**
 * Derive required frame stiffness targets.
 */
export function computeStiffnessTargets(inp: StiffnessTargetInputs): StiffnessTargetResult {
  const ay = inp.mu * G;                        // m/s² lateral capability
  // lateral force at front contact (share by static vertical load)
  const latTotal = inp.totalMass * ay;          // N
  const frontShare = inp.R_front0 / (inp.R_front0 + inp.R_rear0 || 1);
  const Fy_front = latTotal * frontShare;       // N

  // ── Route 1: deflection-budget (torsion) ──────────────────────────────────
  // Torsional moment on the frame ≈ lateral force × CoG-height lever arm.
  const lever_m = inp.Y_cg / 1000;              // m
  const M_t = Fy_front * lever_m;               // N·m
  const Kt_defl = inp.allowableTwistDeg > 1e-6 ? M_t / inp.allowableTwistDeg : 0; // Nm/deg

  // ── Route 2: frequency-separation (torsion) ───────────────────────────────
  const f_target = inp.freqMargin * inp.wobbleFreqHz;          // Hz
  const omega = 2 * Math.PI * f_target;                         // rad/s
  const Kt_freq_Nm_per_rad = inp.I_roll * omega * omega;        // N·m/rad
  const Kt_freq = Kt_freq_Nm_per_rad * DEG;                     // → N·m/deg

  const recommended = Math.max(Kt_defl, Kt_freq);
  const governingRoute = Kt_freq >= Kt_defl ? 'frequency' : 'deflection';

  // ── Lateral steering-head target (deflection budget) ──────────────────────
  const Klat = inp.allowableLatDeflMm > 1e-6 ? Fy_front / inp.allowableLatDeflMm : 0; // N/mm

  return {
    torsionalTarget_deflection_Nm_per_deg: Kt_defl,
    torsionalTarget_frequency_Nm_per_deg: Kt_freq,
    torsionalTarget_recommended_Nm_per_deg: recommended,
    governingRoute,
    lateralTarget_N_per_mm: Klat,
    corneringLatForce_N: Fy_front,
    torsionalMoment_Nm: M_t,
    frameModeTarget_Hz: f_target,
    provenance: 'analytical',
    targetTag: 'estimated',
  };
}
