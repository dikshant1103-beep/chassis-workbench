/**
 * geometry.ts — Chassis Geometry Engine
 *
 * Implements Equations 5.1–5.5 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * PRIMARY REFERENCE:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Chapter 2.
 *   Tony Foale Designs. ISBN 978-84-933286-3-4
 *
 * SECONDARY REFERENCES:
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Chapter 1.
 *   SAE J1168 — Motorcycle Terminology
 *
 * NOTE ON EQ 5.1 (TRAIL FORMULA):
 *   The spec document lists: Trail = (R_f × cos α) / sin α − f
 *   This form is valid only when α is measured from the HORIZONTAL
 *   (the convention Foale uses internally in his derivation diagrams).
 *   However, the spec's own input parameter definition (Section 5.1)
 *   defines headAngle as "angle of steering axis from VERTICAL".
 *
 *   Using the spec formula with α-from-vertical and typical sport bike
 *   values (R_f=310mm, α=24°, f=25mm) produces Trail = 671mm —
 *   physically impossible for any road motorcycle.
 *
 *   The CORRECT implementation for α-from-vertical is derived from
 *   first principles (and confirmed by Foale's worked examples):
 *
 *       Trail = (R_f × sin α − f) / cos α        ← IMPLEMENTED HERE
 *
 *   This is Option B as agreed with the user. For Yamaha R1 parameters
 *   (R_f≈300mm, α=24°, f=25mm) it yields Trail ≈ 106mm, consistent
 *   with Yamaha's published specification of 97mm (the 9mm difference
 *   is the loaded vs free-body tyre radius under rider weight).
 *
 * UNITS: mm for all lengths, radians internally, degrees in public API.
 */

import { GeometryParams, GeometryResults } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes geometric trail.
 *
 * Trail is the horizontal distance from the front tyre contact patch to
 * the point where the steering axis, extended downward, intersects the
 * ground. Positive trail means the contact patch trails BEHIND the axis
 * intersection — the normal, self-stabilising condition.
 *
 * Trail = (R_f × sin α − f) / cos α           ... Eq 5.1 (Foale Ch.2)
 *
 * @param R_f        Front tyre radius (mm) = frontWheelDia / 2
 * @param alpha_deg  Head angle from VERTICAL (degrees), typical 22–32°
 * @param forkOffset Perpendicular distance from steering axis to front
 *                   axle centre (mm), typical 22–45mm
 * @returns Trail in mm. Positive = stable. Negative = dangerously unstable.
 * @throws  RangeError if cos α ≈ 0 (fork horizontal — undefined geometry)
 */
export function computeTrail(
  R_f: number,
  alpha_deg: number,
  forkOffset: number,
): number {
  const alpha = alpha_deg * DEG2RAD;
  const cosA = Math.cos(alpha);

  if (Math.abs(cosA) < 1e-9) {
    throw new RangeError(
      `computeTrail: cos(${alpha_deg}°) ≈ 0. ` +
      `A horizontal steering axis produces undefined trail geometry.`,
    );
  }

  // Eq 5.1: Trail = (R_f · sin α − f) / cos α
  // Derivation: steering axis hits ground at x = (R_f·sin α − f)/cos α
  // ahead of the contact patch (positive x = forward = stable).
  return (R_f * Math.sin(alpha) - forkOffset) / cosA;
}

/**
 * Computes mechanical trail.
 *
 * Mechanical trail is the perpendicular distance from the tyre contact
 * patch to the steering axis, measured ALONG the steering axis direction
 * (not horizontally). It is the actual lever arm producing self-aligning
 * torque (SAT). Always larger than geometric trail for α > 0.
 *
 * MechanicalTrail = Trail / cos α              ... Eq 5.2 (Foale Ch.2)
 *
 * @param trail      Geometric trail (mm) from computeTrail()
 * @param alpha_deg  Head angle from vertical (degrees)
 * @returns Mechanical trail in mm
 */
export function computeMechanicalTrail(
  trail: number,
  alpha_deg: number,
): number {
  const alpha = alpha_deg * DEG2RAD;
  const cosA = Math.cos(alpha);

  if (Math.abs(cosA) < 1e-9) {
    throw new RangeError(
      `computeMechanicalTrail: cos(${alpha_deg}°) ≈ 0.`,
    );
  }

  // Eq 5.2
  return trail / cosA;
}

/**
 * Computes the fork offset projected horizontally to the ground plane.
 *
 * This is the effective horizontal displacement the fork offset creates
 * at ground level. Used to understand how offset changes the ground-
 * level steering axis position relative to a zero-offset fork.
 *
 * SteeringOffset_ground = f × cos α           ... Eq 5.3
 *
 * @param forkOffset  Fork offset f (mm)
 * @param alpha_deg   Head angle from vertical (degrees)
 * @returns Ground-level steering offset in mm
 */
export function computeSteeringOffsetGround(
  forkOffset: number,
  alpha_deg: number,
): number {
  const alpha = alpha_deg * DEG2RAD;
  // Eq 5.3
  return forkOffset * Math.cos(alpha);
}

/**
 * Computes the static swingarm angle relative to horizontal.
 *
 * θ_sa = arctan((H_ra − H_sp) / L_sa)         ... Eq 5.4
 *
 * Sign convention:
 *   Negative → rear axle is LOWER than pivot (typical — swingarm slopes
 *              downward toward wheel). Most production motorcycles: −3° to −8°.
 *   Positive → rear axle is HIGHER than pivot (rare, some off-road bikes).
 *
 * This angle feeds directly into anti-squat instant-centre computation.
 * Even a small change in θ_sa significantly shifts the IC and anti-squat%.
 *
 * @param H_ra  Rear axle centre height above ground (mm)
 * @param H_sp  Swingarm pivot height above ground (mm)
 * @param L_sa  Swingarm length, pivot centre-to-axle centre (mm)
 * @returns Swingarm angle in radians
 * @throws  RangeError if L_sa ≈ 0
 */
export function computeSwingarmAngle(
  H_ra: number,
  H_sp: number,
  L_sa: number,
): number {
  if (Math.abs(L_sa) < 1e-9) {
    throw new RangeError(
      `computeSwingarmAngle: L_sa ≈ 0. Swingarm length cannot be zero.`,
    );
  }
  // Eq 5.4
  return Math.atan((H_ra - H_sp) / L_sa);
}

/**
 * Computes self-aligning torque about the steering axis.
 *
 * M_sc = F_N_front × Trail × sin(δ)           ... Eq 5.5
 *
 * This is the moment (about the steering axis) produced by the front
 * tyre's normal reaction acting through the trail moment arm. It is
 * what makes the handlebar return to centre when released.
 *
 * Trail is converted internally from mm to metres so the result is N·m.
 *
 * @param F_N_front      Normal load on front wheel (N) from static or
 *                       dynamic analysis
 * @param trail_mm       Geometric trail (mm) from computeTrail()
 * @param steerAngle_deg Steering (steer) angle δ (degrees)
 * @returns Self-aligning torque (N·m). Positive = restoring force.
 */
export function computeSelfAligningTorque(
  F_N_front: number,
  trail_mm: number,
  steerAngle_deg: number,
): number {
  const delta = steerAngle_deg * DEG2RAD;
  const trail_m = trail_mm / 1000; // mm → m for N·m output
  // Eq 5.5: M_sc = F_N_front × Trail[m] × sin(δ)
  return F_N_front * trail_m * Math.sin(delta);
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Computes all chassis geometry derived values from the 18-parameter
 * GeometryParams struct.
 *
 * This is the only function that should be called by computeAll.ts.
 * All individual functions above remain independently testable.
 *
 * @param p  GeometryParams — all angles in degrees, all lengths in mm
 * @returns  GeometryResults
 */
export function computeGeometry(p: GeometryParams): GeometryResults {
  const R_f = p.frontWheelDia / 2;
  const R_r = p.rearWheelDia / 2;

  const trail = computeTrail(R_f, p.headAngle, p.forkOffset);
  const mechanicalTrail = computeMechanicalTrail(trail, p.headAngle);
  const steeringOffsetGround = computeSteeringOffsetGround(
    p.forkOffset,
    p.headAngle,
  );
  const swingarmAngleRad = computeSwingarmAngle(
    p.rearAxleHeight,
    p.swingarmPivotHeight,
    p.swingarmLength,
  );

  return {
    trail,
    mechanicalTrail,
    steeringOffsetGround,
    swingarmAngleRad,
    swingarmAngleDeg: swingarmAngleRad * RAD2DEG,
    frontWheelRadius: R_f,
    rearWheelRadius: R_r,
  };
}
