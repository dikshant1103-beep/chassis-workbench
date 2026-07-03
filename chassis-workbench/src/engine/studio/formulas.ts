/**
 * studio/formulas.ts — Pure suspension-engineering formulas (ISOLATED)
 *
 * Every exported function carries a provenance docblock:
 *   SOURCE       — where the equation comes from
 *   UNITS        — input/output units
 *   ASSUMPTIONS  — modelling assumptions
 *   LIMITATIONS  — when the result is approximate / invalid
 *
 * REUSE: leaf numeric utilities that already implement a validated Foale/
 * Cossalter formula are imported from the existing engine and re-exported here
 * (we do NOT reimplement them). New formulas not present in the engine are
 * defined below and marked book / supplemented.
 *
 * Sign / convention notes:
 *   - Motion ratio MR = (shock displacement) / (wheel displacement), 0 < MR ≤ 1
 *     for a monoshock/linkage rear. Wheel rate = k·MR²  (energy equivalence).
 *   - Wheel travel u is positive in bump (compression, axle rises toward frame).
 */

import { G, computeStaticAxleLoads } from '../cog';
import { Point2 } from './types';

const DEG = Math.PI / 180;

// ── Re-exported, already-validated engine utilities (REUSE, do not duplicate) ──
export {
  computeWheelRate,        // WR = k·MR²            [Foale Eq 7.1]
  computeNaturalFrequency, // f = (1/2π)√(WR·1e3/m) [Foale Eq 7.3]
  computeCriticalDamping,  // C_c = 2√(k·1e3·m)     [Cossalter Eq 7.12]
  computeSprungMasses,     //                       [Foale Eq 7.5–7.7]
} from '../suspension';
// G and computeStaticAxleLoads are imported above for local use; re-export them.
export { G, computeStaticAxleLoads };

// ─────────────────────────────────────────────────────────────────────────────
// COIL SPRING — rate from geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coil-spring rate from wire/coil geometry.
 *
 * SOURCE: [BOOK Ch2] — "the formula that manufacturers use to design coil
 *   springs using round cross-section wire":  k = G·d⁴ / (8·N·D³)
 * UNITS: d,D in mm; G in N/mm²; N dimensionless ⇒ k in N/mm.
 * ASSUMPTIONS: round wire, constant pitch (straight-rate), G of spring steel.
 * LIMITATIONS: progressive/dual-rate springs vary along travel — this is the
 *   average straight-rate value.
 */
export function coilSpringRate(d: number, D: number, N: number, G_mod: number): number {
  if (D <= 0 || N <= 0) return 0;
  return (G_mod * Math.pow(d, 4)) / (8 * N * Math.pow(D, 3));
}

/**
 * Equivalent rate of springs in series.
 * SOURCE: [BOOK Ch2]  1/K = Σ 1/Kᵢ   (e.g. stacked tender + main spring).
 * UNITS: N/mm in, N/mm out.
 */
export function springsInSeries(rates: number[]): number {
  const inv = rates.reduce((s, k) => s + (k > 0 ? 1 / k : 0), 0);
  return inv > 0 ? 1 / inv : 0;
}

/**
 * Combined rate of springs in parallel (e.g. two fork legs).
 * SOURCE: [BOOK Ch2] "two springs in parallel … add to each other".
 */
export function springsInParallel(rates: number[]): number {
  return rates.reduce((s, k) => s + k, 0);
}

/**
 * Spring-rate rescale when travel changes (lowering).
 * SOURCE: [BOOK Appendix 1]  k₂ = k₁·(d₁/d₂)  to keep the same spring force
 *   over a reduced travel d₂.
 * UNITS: rates N/mm, travels mm.
 */
export function rescaleRateForTravel(k1: number, travel1: number, travel2: number): number {
  if (travel2 <= 0) return k1;
  return k1 * (travel1 / travel2);
}

// ─────────────────────────────────────────────────────────────────────────────
// COIL SPRING — stress, coil bind, safety factor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wahl curvature-correction factor.
 * SOURCE: [SUPPLEMENTED — Shigley, Mechanical Engineering Design] for a helical
 *   compression spring with spring index C = D/d:
 *     K_w = (4C − 1)/(4C − 4) + 0.615/C
 * The book describes spring stress qualitatively but not numerically, so the
 * stress model is supplemented from standard machine design.
 */
export function wahlFactor(C: number): number {
  if (C <= 1) return 1;
  return (4 * C - 1) / (4 * C - 4) + 0.615 / C;
}

/**
 * Peak shear stress in a helical compression spring at axial force F.
 * SOURCE: [SUPPLEMENTED — Shigley]  τ = K_w · 8·F·D / (π·d³)
 * UNITS: F in N; D,d in mm ⇒ τ in N/mm² (= MPa).
 * ASSUMPTIONS: round wire, force along the coil axis.
 */
export function springShearStress(F: number, D: number, d: number): number {
  if (d <= 0) return 0;
  const C = D / d;
  return (wahlFactor(C) * 8 * F * D) / (Math.PI * Math.pow(d, 3));
}

/**
 * Solid (coil-bind) length and usable compression before bind.
 * SOURCE: [BOOK Ch2 — coil bind = "all the spring's coils touch"].
 *   solidLength ≈ N_total·d ; usable stroke = freeLength − solidLength.
 * UNITS: mm. ASSUMPTIONS: total coils ≈ active + 2 (squared & ground ends, BOOK).
 * LIMITATIONS: ignores set/sacking; uses nominal wire diameter.
 */
export function coilBind(freeLength: number, activeCoils: number, d: number): {
  solidLength: number; usableStroke: number;
} {
  const totalCoils = activeCoils + 2;        // [BOOK Ch2] squared & ground ⇒ +2
  const solidLength = totalCoils * d;
  return { solidLength, usableStroke: Math.max(0, freeLength - solidLength) };
}

/**
 * Safety factor on spring shear stress.
 * SOURCE: [SUPPLEMENTED — Shigley]  SF = τ_allowable / τ_working.
 */
export function safetyFactor(allowable: number, working: number): number {
  if (working <= 0) return Infinity;
  return allowable / working;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAG (book Ch2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static sag from sprung corner load, wheel rate and preload.
 * SOURCE: [BOOK Ch2] sag is the compression under load: at equilibrium the
 *   spring force equals the static corner load. Working at the WHEEL:
 *     sag = (corner_load − preload_force_at_wheel) / wheelRate
 * UNITS: load N, wheelRate N/mm, preload mm ⇒ sag mm.
 * ASSUMPTIONS: linear rate; preload expressed as spring mm × wheelRate at wheel.
 */
export function staticSag(cornerLoadN: number, wheelRate: number, preloadForceN: number): number {
  if (wheelRate <= 0) return 0;
  return Math.max(0, (cornerLoadN - preloadForceN) / wheelRate);
}

/**
 * Sag as a percentage of total travel.  SOURCE: [BOOK Ch2]  sag% = sag/travel·100.
 */
export function sagPercent(sag: number, travel: number): number {
  if (travel <= 0) return 0;
  return (sag / travel) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// REAR SHOCK KINEMATICS — motion ratio from side-view hardpoints
// ─────────────────────────────────────────────────────────────────────────────
//
// DERIVED (mirrors the validated method in engine/sweep.ts, kept local so the
// Studio is self-contained). The rear axle rides a circular arc about the
// swingarm pivot; the lower shock mount is rigid on the swingarm and rotates with
// it. Shock length L(u) is the distance from the (rotated) lower mount to the
// fixed upper mount. MR(u) = |dL/du| via finite difference.

/** Rear-axle Y for a given swingarm angle (deg from horizontal). */
function axleY(pivot: Point2, L: number, angleDeg: number): number {
  return pivot.y + L * Math.sin(angleDeg * DEG);
}

/** Swingarm angle (deg) that places the axle at height (pivot.y + L·sinθ) raised by u. */
function angleAtTravel(pivot: Point2, L: number, angle0Deg: number, u: number): number {
  const y0 = axleY(pivot, L, angle0Deg);
  const s = (y0 + u - pivot.y) / L;
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}

/** Position of a swingarm-fixed point after the arm rotates from angle0 to angle1. */
function rotatedAboutPivot(p: Point2, pivot: Point2, dAngleDeg: number): Point2 {
  const dx = p.x - pivot.x, dy = p.y - pivot.y;
  const c = Math.cos(dAngleDeg * DEG), s = Math.sin(dAngleDeg * DEG);
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Shock length at wheel travel u (mm of bump).
 * SOURCE: DERIVED (mirrors engine/sweep.ts shockLength* kinematics).
 */
export function shockLengthAtTravel(
  pivot: Point2, L: number, angle0Deg: number,
  lowerStatic: Point2, upper: Point2, u: number,
): number {
  const angle1 = angleAtTravel(pivot, L, angle0Deg, u);
  const lower = rotatedAboutPivot(lowerStatic, pivot, angle1 - angle0Deg);
  return dist(lower, upper);
}

/**
 * Instantaneous motion ratio MR = |dL_shock / du_wheel| at travel u.
 * SOURCE: DERIVED [Foale Ch6 motion-ratio definition].
 * LIMITATIONS: degenerate (returns 0) if the shock is near-perpendicular to its
 *   travel or hardpoints are coincident.
 */
export function motionRatioAtTravel(
  pivot: Point2, L: number, angle0Deg: number,
  lowerStatic: Point2, upper: Point2, u: number, h = 0.5,
): number {
  const Lp = shockLengthAtTravel(pivot, L, angle0Deg, lowerStatic, upper, u + h);
  const Lm = shockLengthAtTravel(pivot, L, angle0Deg, lowerStatic, upper, u - h);
  return Math.abs((Lp - Lm) / (2 * h));
}

/** Instant shock angle from vertical (deg) in the static-pose-plus-u position. */
export function shockAngleFromVertical(
  pivot: Point2, L: number, angle0Deg: number,
  lowerStatic: Point2, upper: Point2, u = 0,
): number {
  const angle1 = angleAtTravel(pivot, L, angle0Deg, u);
  const lower = rotatedAboutPivot(lowerStatic, pivot, angle1 - angle0Deg);
  const dx = upper.x - lower.x, dy = upper.y - lower.y;
  // angle from vertical (the +y axis)
  return Math.abs(Math.atan2(dx, dy) / DEG);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD / FORCE relationships
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corner static load (N) at one wheel from sprung mass share.
 * SOURCE: [Foale Eq 6.5–6.7] via computeStaticAxleLoads (reused).
 */
export function cornerStaticLoad(totalMass: number, X_cg: number, wheelbase: number, axle: 'front' | 'rear'): number {
  const { R_front, R_rear } = computeStaticAxleLoads(totalMass, X_cg, wheelbase);
  return axle === 'front' ? R_front : R_rear;
}

/**
 * Dynamic axle load under longitudinal acceleration a (g).
 * SOURCE: [Foale Ch5] load transfer ΔW = m·a·g·(h/WB); front gains on braking.
 * UNITS: mass kg, h & WB mm, a in g ⇒ N.
 */
export function dynamicAxleLoad(
  totalMass: number, X_cg: number, Y_cg: number, wheelbase: number,
  a_g: number, axle: 'front' | 'rear',
): number {
  const { R_front, R_rear } = computeStaticAxleLoads(totalMass, X_cg, wheelbase);
  const dW = totalMass * a_g * G * (Y_cg / wheelbase); // N transferred to front on braking
  // a_g > 0 = braking (front gains), a_g < 0 = acceleration (rear gains)
  return axle === 'front' ? R_front + dW : R_rear - dW;
}

/** Shock axial force from spring compression. SOURCE: [BOOK Ch2] F = k·x. */
export function springAxialForce(k: number, compressionMm: number): number {
  return k * Math.max(0, compressionMm);
}

/**
 * Wheel force from shock force via motion ratio.
 * SOURCE: DERIVED (virtual work) F_wheel = F_shock · MR.
 */
export function wheelForceFromShock(shockForce: number, MR: number): number {
  return shockForce * MR;
}
