/**
 * ergonomics.ts — Rider Ergonomics Triangle Engine
 *
 * Implements Equations 9.1–9.6 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * The ergonomic triangle is defined by three rider contact points in
 * the 2D sagittal plane (side view):
 *   H = handlebar grip centre
 *   S = seat point (hip contact)
 *   P = footpeg centre
 *
 * Joint angles are computed via the law of cosines.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 13.
 *   cycle-ergo.com — ergonomic data for production motorcycles
 *   ISO 11960 — Two-wheeled vehicles vocabulary
 *
 * UNITS: mm for positions, degrees for output angles.
 */

import { ErgoParams, ErgoResults } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes Euclidean distances between the three ergonomic triangle
 * vertices (handlebar H, seat S, footpeg P).
 *
 * d_SH = √((S_x − H_x)² + (S_y − H_y)²)   [Seat to Handlebar] ... Eq 9.1
 * d_SP = √((S_x − P_x)² + (S_y − P_y)²)   [Seat to Footpeg]   ... Eq 9.2
 * d_HP = √((H_x − P_x)² + (H_y − P_y)²)   [Handlebar to Footpeg] ... Eq 9.3
 *
 * @param H_x  Handlebar x (mm from front axle)
 * @param H_y  Handlebar y (mm from ground)
 * @param S_x  Seat x (mm from front axle)
 * @param S_y  Seat y (mm from ground)
 * @param P_x  Footpeg x (mm from front axle)
 * @param P_y  Footpeg y (mm from ground)
 * @returns Triangle side lengths in mm
 */
export function computeTriangleSides(
  H_x: number, H_y: number,
  S_x: number, S_y: number,
  P_x: number, P_y: number,
): { d_SH: number; d_SP: number; d_HP: number } {
  // Eq 9.1
  const d_SH = Math.sqrt((S_x - H_x) ** 2 + (S_y - H_y) ** 2);
  // Eq 9.2
  const d_SP = Math.sqrt((S_x - P_x) ** 2 + (S_y - P_y) ** 2);
  // Eq 9.3
  const d_HP = Math.sqrt((H_x - P_x) ** 2 + (H_y - P_y) ** 2);

  return { d_SH, d_SP, d_HP };
}

/**
 * Computes knee angle at the footpeg vertex using the law of cosines.
 *
 * The knee joint is at P (footpeg). The two limb segments meeting there
 * are P→S (lower leg: footpeg to seat/hip) and P→H (footpeg to handlebar,
 * representative of upper body posture).
 *
 * Knee Angle = arccos((d_SP² + d_HP² − d_SH²) / (2 × d_SP × d_HP))
 *                                                              ... Eq 9.4
 *
 * Typical ranges (Foale Ch. 13):
 *   Sport   : 85–105° (tight, leaning forward)
 *   Naked   : 95–115°
 *   ADV     : 100–120° (standing friendly)
 *   Cruiser : 105–130°
 *
 * @param d_SH  Seat-handlebar distance (mm)
 * @param d_SP  Seat-footpeg distance (mm)
 * @param d_HP  Handlebar-footpeg distance (mm)
 * @returns Knee angle (degrees)
 * @throws  RangeError if cosine argument is outside [−1, 1] (degenerate triangle)
 */
export function computeKneeAngle(
  d_SH: number,
  d_SP: number,
  d_HP: number,
): number {
  if (d_SP < 1e-9 || d_HP < 1e-9) {
    throw new RangeError(
      'computeKneeAngle: d_SP and d_HP must be > 0 (check footpeg coordinates).',
    );
  }
  // Eq 9.4 — law of cosines at vertex P (footpeg)
  const cosKnee = (d_SP ** 2 + d_HP ** 2 - d_SH ** 2) / (2 * d_SP * d_HP);

  // Clamp to [−1, 1] to guard against floating-point rounding beyond domain
  const cosKneeClamped = Math.max(-1, Math.min(1, cosKnee));

  return Math.acos(cosKneeClamped) * RAD2DEG;
}

/**
 * Computes hip angle at the seat vertex using the law of cosines.
 *
 * The hip joint is at S (seat). The two segments meeting there are
 * S→H (torso: seat to handlebar) and S→P (thigh: seat to footpeg).
 *
 * Hip Angle = arccos((d_SH² + d_SP² − d_HP²) / (2 × d_SH × d_SP))
 *                                                              ... Eq 9.5
 *
 * @param d_SH  Seat-handlebar distance (mm)
 * @param d_SP  Seat-footpeg distance (mm)
 * @param d_HP  Handlebar-footpeg distance (mm)
 * @returns Hip angle (degrees)
 */
export function computeHipAngle(
  d_SH: number,
  d_SP: number,
  d_HP: number,
): number {
  if (d_SH < 1e-9 || d_SP < 1e-9) {
    throw new RangeError(
      'computeHipAngle: d_SH and d_SP must be > 0 (check seat/handlebar coordinates).',
    );
  }
  // Eq 9.5 — law of cosines at vertex S (seat/hip)
  const cosHip = (d_SH ** 2 + d_SP ** 2 - d_HP ** 2) / (2 * d_SH * d_SP);
  const cosHipClamped = Math.max(-1, Math.min(1, cosHip));

  return Math.acos(cosHipClamped) * RAD2DEG;
}

/**
 * Computes the rider's forward lean angle (torso inclination).
 *
 * This is the angle the line from seat (S) to handlebar (H) makes with
 * the vertical. Positive = leaning forward (sport position).
 * Zero = perfectly upright. Negative = reclined (cruiser).
 *
 * Forward Lean = arctan((H_x − S_x) / (S_y − H_y))           ... Eq 9.6
 *
 * The formula: horizontal displacement of handlebar relative to seat,
 * divided by vertical rise from handlebar to seat. arctan gives the
 * lean angle from vertical.
 *
 * @param H_x  Handlebar x (mm from front axle)
 * @param H_y  Handlebar y (mm from ground)
 * @param S_x  Seat x (mm from front axle)
 * @param S_y  Seat y (mm from ground)
 * @returns Forward lean angle (degrees). +ve = forward, −ve = reclined.
 */
export function computeForwardLean(
  H_x: number,
  H_y: number,
  S_x: number,
  S_y: number,
): number {
  const dY = S_y - H_y; // vertical: seat higher than handlebar (normal case)
  if (Math.abs(dY) < 1e-9) {
    // Seat and handlebar at same height — forward lean is ±90°
    return H_x > S_x ? 90 : -90;
  }
  // Eq 9.6
  return Math.atan((H_x - S_x) / dY) * RAD2DEG;
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Full ergonomics computation — aggregates Eq 9.1 through 9.6.
 *
 * @param p  ErgoParams
 * @returns  ErgoResults
 */
export function computeErgonomics(p: ErgoParams): ErgoResults {
  const { d_SH, d_SP, d_HP } = computeTriangleSides(
    p.handlebarX, p.handlebarY,
    p.seatX, p.seatY,
    p.footpegX, p.footpegY,
  );

  const kneeAngleDeg = computeKneeAngle(d_SH, d_SP, d_HP);
  const hipAngleDeg = computeHipAngle(d_SH, d_SP, d_HP);
  const forwardLeanDeg = computeForwardLean(
    p.handlebarX, p.handlebarY,
    p.seatX, p.seatY,
  );

  return { d_SH, d_SP, d_HP, kneeAngleDeg, hipAngleDeg, forwardLeanDeg };
}
