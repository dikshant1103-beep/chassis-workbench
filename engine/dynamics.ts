/**
 * dynamics.ts — Dynamic Load Transfer Engine
 *
 * Implements Equations 10.1–10.7 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * Covers three dynamic scenarios:
 *   1. Braking load transfer — front gains, rear loses weight
 *   2. Acceleration load transfer — rear gains, front loses weight
 *   3. Cornering — lateral acceleration, lateral force, bank angle
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 5–6.
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 3.
 *   SAE J1168 — Motorcycle Terminology
 *
 * UNIT CONVENTIONS:
 *   Mass      : kg
 *   Length    : mm  (Y_cg, WB for ratio — mm/mm = dimensionless)
 *   Speed     : m/s (cornerSpeed)
 *   Radius    : m   (cornerRadius)
 *   Track     : mm  (trackWidth — used as ratio, so mm/mm)
 *   Force     : N
 *   Accel     : m/s²
 *   Angle     : degrees (output)
 *   g         : 9.81 m/s²
 */

import { DynamicsParams, DynamicsResults } from './types';
import { G } from './cog';

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes dynamic load transfer during braking.
 *
 * Under deceleration, weight transfers from rear to front tyre.
 * The transferred load depends on deceleration magnitude, CoG height,
 * and wheelbase.
 *
 * ΔW_brake = m × a_decel × Y_cg / WB          ... Eq 10.1
 *
 * Y_cg and WB are both in mm → their ratio is dimensionless.
 * m × a gives Newtons, so ΔW_brake is in N.
 *
 * At 1.0g braking, the front tyre may carry 85–95% of total weight.
 * Rear wheel lift is imminent when Front% > ~95%.
 *
 * @param mass       Total mass m (kg)
 * @param a_decel_g  Deceleration magnitude in g (e.g., 1.0 for full ABS stop)
 * @param Y_cg       CoG height (mm)
 * @param wheelbase  WB (mm)
 * @param R_front    Static front axle reaction (N)
 * @param totalWeight Total weight W (N)
 * @returns { deltaW_brake, frontPercentBraking }
 */
export function computeBrakingTransfer(
  mass: number,
  a_decel_g: number,
  Y_cg: number,
  wheelbase: number,
  R_front: number,
  totalWeight: number,
): { deltaW_brake: number; frontPercentBraking: number } {
  if (Math.abs(wheelbase) < 1e-9) {
    throw new RangeError('computeBrakingTransfer: wheelbase cannot be zero.');
  }
  if (Math.abs(totalWeight) < 1e-9) {
    throw new RangeError('computeBrakingTransfer: totalWeight cannot be zero.');
  }

  const a_decel = a_decel_g * G; // convert g to m/s²

  // Eq 10.1 — load transfer magnitude
  const deltaW_brake = mass * a_decel * Y_cg / wheelbase;

  // Eq 10.2 — front wheel load percentage during braking
  const frontPercentBraking = ((R_front + deltaW_brake) / totalWeight) * 100;

  return { deltaW_brake, frontPercentBraking };
}

/**
 * Computes dynamic load transfer during acceleration.
 *
 * Under acceleration, weight transfers from front to rear tyre.
 *
 * ΔW_accel = m × a_accel × Y_cg / WB         ... Eq 10.3
 *
 * Front wheel lift (wheelie) is imminent when Front% drops below ~10%.
 *
 * @param mass       Total mass m (kg)
 * @param a_accel_g  Acceleration magnitude in g
 * @param Y_cg       CoG height (mm)
 * @param wheelbase  WB (mm)
 * @param R_front    Static front axle reaction (N)
 * @param totalWeight Total weight W (N)
 * @returns { deltaW_accel, frontPercentAccel }
 */
export function computeAccelTransfer(
  mass: number,
  a_accel_g: number,
  Y_cg: number,
  wheelbase: number,
  R_front: number,
  totalWeight: number,
): { deltaW_accel: number; frontPercentAccel: number } {
  if (Math.abs(wheelbase) < 1e-9) {
    throw new RangeError('computeAccelTransfer: wheelbase cannot be zero.');
  }
  if (Math.abs(totalWeight) < 1e-9) {
    throw new RangeError('computeAccelTransfer: totalWeight cannot be zero.');
  }

  const a_accel = a_accel_g * G;

  // Eq 10.3
  const deltaW_accel = mass * a_accel * Y_cg / wheelbase;

  // Eq 10.4
  const frontPercentAccel = ((R_front - deltaW_accel) / totalWeight) * 100;

  return { deltaW_accel, frontPercentAccel };
}

/**
 * Computes lateral (cornering) dynamics.
 *
 * a_lateral = V² / R                          ... Eq 10.5
 * F_lateral = m × a_lateral                   ... Eq 10.6 (corrected)
 * Bank Angle = arctan(V² / (R × g))           ... Eq 10.7
 *
 * F_lateral is the total centripetal force the tyre contact patch must
 * supply (N).  For a single-track vehicle the full centripetal force acts
 * at one contact patch — there is no lateral weight split between tracks.
 * The previous formula (m × a × Y_cg / trackWidth) computed a load
 * transfer between two imaginary tracks, which is only valid for cars.
 *
 * trackWidth is kept as a user input parameter but is no longer used in
 * this formula (reserved for a future 3-D roll/load-transfer model).
 *
 * @param mass         Total mass m (kg)
 * @param cornerSpeed  V (m/s)
 * @param cornerRadius R (m)
 * @param Y_cg         CoG height (mm) — retained for future 3-D use
 * @param trackWidth   Reserved for future 3-D roll model (currently unused)
 * @returns { lateralAccel, lateralForce, bankAngleDeg }
 * @throws  RangeError if cornerRadius ≤ 0
 */
export function computeCornering(
  mass: number,
  cornerSpeed: number,
  cornerRadius: number,
  Y_cg: number,
  trackWidth: number,
): { lateralAccel: number; lateralForce: number; bankAngleDeg: number } {
  if (cornerRadius < 1e-9) {
    throw new RangeError(
      `computeCornering: cornerRadius must be > 0 (got ${cornerRadius} m).`,
    );
  }

  // Eq 10.5 — centripetal acceleration
  const lateralAccel = (cornerSpeed * cornerSpeed) / cornerRadius;

  // Eq 10.6 (corrected) — total centripetal force; single-track: no lateral load split
  const lateralForce = mass * lateralAccel;

  // Eq 10.7 — equilibrium bank angle from gravity/centripetal balance
  const bankAngleDeg = Math.atan((cornerSpeed * cornerSpeed) / (cornerRadius * G))
    * (180 / Math.PI);

  return { lateralAccel, lateralForce, bankAngleDeg };
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Full dynamics computation — aggregates Eq 10.1 through 10.7.
 *
 * @param p           DynamicsParams
 * @param mass        Total mass (kg) — from CoG results
 * @param Y_cg        CoG height (mm) — from CoG results
 * @param wheelbase   WB (mm) — from geometry params
 * @param R_front     Static front reaction (N) — from CoG results
 * @param totalWeight Total weight (N) — from CoG results
 * @returns DynamicsResults
 */
export function computeDynamics(
  p: DynamicsParams,
  mass: number,
  Y_cg: number,
  wheelbase: number,
  R_front: number,
  totalWeight: number,
): DynamicsResults {
  const { deltaW_brake, frontPercentBraking } = computeBrakingTransfer(
    mass, p.brakingDecel, Y_cg, wheelbase, R_front, totalWeight,
  );

  const { deltaW_accel, frontPercentAccel } = computeAccelTransfer(
    mass, p.accelG, Y_cg, wheelbase, R_front, totalWeight,
  );

  const { lateralAccel, lateralForce, bankAngleDeg } = computeCornering(
    mass, p.cornerSpeed, p.cornerRadius, Y_cg, p.trackWidth,
  );

  return {
    deltaW_brake,
    frontPercentBraking,
    deltaW_accel,
    frontPercentAccel,
    lateralAccel,
    lateralForce,
    bankAngleDeg,
  };
}
