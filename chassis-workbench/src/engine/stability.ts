/**
 * stability.ts — Stability Thresholds Module
 *
 * Module 10: Wheelie limit, stoppie limit, lean clearance, turning radius,
 * and gradeability. All derived from existing CoG and geometry results.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 5.
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 3.
 */

import { StabilityParams, StabilityResults } from './types';
import { G } from './cog';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Wheelie threshold — acceleration at which front wheel load reaches zero.
 *
 * From: R_front_dynamic = m×g×(WB−X_cg)/WB − m×a×Y_cg/WB = 0
 * a_wheelie = g × (WB − X_cg) / Y_cg                ... derived
 */
export function computeWheelieThreshold(
  wheelbase: number, X_cg: number, Y_cg: number,
): number {
  if (Y_cg < 1e-9) throw new RangeError('computeWheelieThreshold: Y_cg must be > 0');
  return G * (wheelbase - X_cg) / Y_cg;
}

/**
 * Stoppie threshold — deceleration at which rear wheel load reaches zero.
 *
 * From: R_rear_dynamic = m×g×X_cg/WB − m×a×Y_cg/WB = 0
 * a_stoppie = g × X_cg / Y_cg                        ... derived
 */
export function computeStoppieThreshold(X_cg: number, Y_cg: number): number {
  if (Y_cg < 1e-9) throw new RangeError('computeStoppieThreshold: Y_cg must be > 0');
  return G * X_cg / Y_cg;
}

/**
 * Geometric lean limit from footpeg-to-ground clearance.
 *
 * When the bike leans at angle θ, the footpeg (at height H_peg, offset L_peg
 * laterally from centreline) sweeps toward the ground.
 * Ground contact when: H_peg × cos(θ) − L_peg × sin(θ) = 0
 * → θ_lean_max = arctan(H_peg / L_peg)
 *
 * Here we approximate H_peg ≈ groundClearance (lowest point) for a conservative limit.
 *
 * @param groundClearance  mm
 * @param footpegLateralOffset  mm from centreline to footpeg tip
 */
export function computeLeanLimit(
  groundClearance: number, footpegLateralOffset: number,
): number {
  if (footpegLateralOffset < 1e-9) return 90;
  return Math.atan(groundClearance / footpegLateralOffset) * RAD2DEG;
}

/**
 * Minimum turning radius from max steering lock angle.
 *
 * R_turn = WB / tan(δ_max)              (single-track Ackermann)
 *
 * @param wheelbase  mm
 * @param steeringLockDeg  degrees
 */
export function computeMinTurningRadius(
  wheelbase: number, steeringLockDeg: number,
): number {
  const delta = steeringLockDeg * DEG2RAD;
  const tanDelta = Math.tan(delta);
  if (Math.abs(tanDelta) < 1e-9) return Infinity;
  return wheelbase / tanDelta;
}

/**
 * Maximum climbable grade (traction-limited, rear wheel drive).
 *
 * At grade angle θ, load transfer adds to rear load:
 *   R_rear = W × cos(θ) × X_cg/WB + W × sin(θ) × Y_cg/WB
 * Traction limit: μ × R_rear = W × sin(θ)
 *
 * Solving: tan(θ_max) = μ × (X_cg/WB) / (1 − μ × Y_cg/WB)
 *
 * Note: if μ × Y_cg/WB ≥ 1 the denominator is negative — theoretically
 * unlimited grade (very soft tyre + very low CoG). Clamp to 80°.
 */
export function computeGradeMax(
  wheelbase: number, X_cg: number, Y_cg: number, mu: number,
): number {
  const xRatio = X_cg / wheelbase;
  const yRatio = Y_cg / wheelbase;
  const denom = 1 - mu * yRatio;
  if (denom < 1e-6) return 80;
  const tanTheta = mu * xRatio / denom;
  return Math.atan(tanTheta) * RAD2DEG;
}

export function computeStability(
  p: StabilityParams,
  wheelbase: number,
  X_cg: number,
  Y_cg: number,
  groundClearance: number,
): StabilityResults {
  const a_wheelie = computeWheelieThreshold(wheelbase, X_cg, Y_cg);
  const a_stoppie = computeStoppieThreshold(X_cg, Y_cg);
  const leanLimitDeg = computeLeanLimit(groundClearance, p.footpegLateralOffset);
  const R_turn_min = computeMinTurningRadius(wheelbase, p.steeringLockAngle);
  const gradeMaxDeg = computeGradeMax(wheelbase, X_cg, Y_cg, p.frictionCoeff);

  return {
    a_wheelie_ms2: a_wheelie,
    a_wheelie_g: a_wheelie / G,
    a_stoppie_ms2: a_stoppie,
    a_stoppie_g: a_stoppie / G,
    leanLimitDeg,
    R_turn_min_mm: R_turn_min,
    D_turn_circle_mm: R_turn_min * 2,
    gradeMaxDeg,
    gradeMaxPercent: Math.tan(gradeMaxDeg * DEG2RAD) * 100,
    // These 6 fields are computed and overridden by computeAll.ts
    rearSquatMm: 0,
    forkDiveMm: 0,
    stabilityIndex: 0,
    agilityIndex: 0,
    wobbleSensitivity: 0,
    pitchSensitivity: 0,
  };
}
