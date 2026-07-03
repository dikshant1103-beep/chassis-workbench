/**
 * studio/context.ts — Context-geometry calculations for the Studio (ISOLATED)
 *
 * Front-end trail, rear anti-squat instant centre, and chain tension, computed
 * in the STUDIO frame (origin = front-wheel contact, +x rearward, +y up) so they
 * track the Studio's own edited geometry rather than the global bike.
 *
 * SOURCES:
 *   trail        — [BOOK Ch5 / Foale Eq 5.1]  T = (R·sin ε − offset) / cos ε
 *   anti-squat   — [BOOK Ch5 / Foale Ch11]    IC = swingarm-axis ∩ chain-line;
 *                  AS% via line from rear contact through IC (mirrors the
 *                  validated method in engine/sweep.ts antiSquatAtAngle).
 *   chain tension— [DERIVED]  drive force F = m·a; T = F·R_wheel / r_rearSprocket
 */

import { StudioInput, Point2 } from './types';

const DEG = Math.PI / 180;

/**
 * Ground trail (mm). SOURCE: [BOOK Ch5 / Foale Eq 5.1].
 * @param Rf  front wheel radius (mm)
 * @param rakeDeg  steering axis from vertical (deg)
 * @param offset  triple-clamp + axle offset ⊥ to steering axis (mm)
 */
export function studioTrail(Rf: number, rakeDeg: number, offset: number): number {
  const e = rakeDeg * DEG;
  return (Rf * Math.sin(e) - offset) / Math.cos(e);
}

export interface AntiSquatOut {
  IC: Point2 | null;     // instant centre (Studio frame), null if not applicable
  antiSquatPercent: number; // NaN if not applicable (e.g. CVT/parallel)
  chainForceAngleDeg: number;
}

/**
 * Rear anti-squat instant centre + AS% in the Studio frame.
 * Mirrors the validated graphical method in engine/sweep.ts (antiSquatAtAngle):
 * IC = intersection of the swingarm axis and the chain upper-run line of action;
 * AS% = height of the (rear-contact → IC) line at the front axle, ÷ Y_cg.
 *
 * @param pivot       swingarm pivot (Studio frame, mm)
 * @param swingAngleDeg  swingarm angle from horizontal (deg)
 * @param rearAxle    rear axle position (mm)
 * @param Y_cg        CoG height (mm)
 * @param csOffset    countershaft offset from pivot (mm)
 * @param frontTeeth / rearTeeth / pitch  drivetrain spec
 * @param isChain     false → returns null IC (scooter/CVT/belt)
 */
export function studioAntiSquat(
  pivot: Point2, swingAngleDeg: number, rearAxle: Point2, Y_cg: number,
  csOffset: Point2, frontTeeth: number, rearTeeth: number, pitch: number, isChain: boolean,
): AntiSquatOut {
  if (!isChain || Y_cg < 1e-6) return { IC: null, antiSquatPercent: NaN, chainForceAngleDeg: NaN };

  const r_drive = (frontTeeth * pitch) / (2 * Math.PI);
  const r_rear = (rearTeeth * pitch) / (2 * Math.PI);
  const CS: Point2 = { x: pivot.x + csOffset.x, y: pivot.y + csOffset.y };

  // Chain force angle (upper-run line of action), from rear axle toward CS.
  const dx = CS.x - rearAxle.x, dy = CS.y - rearAxle.y;
  const D = Math.hypot(dx, dy);
  if (D < 1e-6) return { IC: null, antiSquatPercent: NaN, chainForceAngleDeg: NaN };
  const thetaGeom = Math.atan2(dy, dx);
  const sinAlpha = Math.max(-1, Math.min(1, (r_rear - r_drive) / D));
  const alpha = Math.asin(sinAlpha);
  const cfa = thetaGeom + alpha; // chain force angle (rad)

  // Upper-run tangent contact point on the drive sprocket.
  const perpX = -Math.sin(cfa), perpY = Math.cos(cfa);
  const X_tan = CS.x - r_drive * perpX, H_tan = CS.y - r_drive * perpY;

  // Lines: swingarm through pivot (slope m1); chain through tangent point (slope m2).
  const m1 = Math.tan(swingAngleDeg * DEG);
  const m2 = Math.tan(cfa);
  if (Math.abs(m1 - m2) < 1e-9) return { IC: null, antiSquatPercent: NaN, chainForceAngleDeg: cfa / DEG };

  const b1 = pivot.y - m1 * pivot.x;
  const b2 = H_tan - m2 * X_tan;
  const IC_x = (b2 - b1) / (m1 - m2);
  const IC_y = m1 * IC_x + b1;

  // AS%: line from rear contact (rearAxle.x, 0) through IC, height at front axle (x=0).
  const denom = rearAxle.x - IC_x;
  if (Math.abs(denom) < 1e-9) return { IC: { x: IC_x, y: IC_y }, antiSquatPercent: NaN, chainForceAngleDeg: cfa / DEG };
  const slopeIC = (0 - IC_y) / denom;
  const hFront = IC_y + slopeIC * (0 - IC_x);
  return { IC: { x: IC_x, y: IC_y }, antiSquatPercent: (hFront / Y_cg) * 100, chainForceAngleDeg: cfa / DEG };
}

/**
 * Representative chain tension (N) under acceleration.
 * SOURCE: [DERIVED] drive force F = m·a (a = accel, m/s²);
 *   rear-wheel torque τ = F·R_wheel; chain tension T = τ / r_rearSprocket.
 */
export function studioChainTension(
  totalMass: number, a_ms2: number, R_rearWheel: number, rearTeeth: number, pitch: number,
): number {
  const F = totalMass * a_ms2;                       // drive force at contact (N)
  const r_rear = (rearTeeth * pitch) / (2 * Math.PI); // rear sprocket pitch radius (mm)
  if (r_rear < 1e-6) return 0;
  return (F * R_rearWheel) / r_rear;                  // N
}

/** Build the Studio input's drivetrain countershaft world point. */
export function countershaftPoint(input: StudioInput): Point2 {
  const p = input.rear.swingarmPivot, o = input.drivetrain.countershaftOffset;
  return { x: p.x + o.x, y: p.y + o.y };
}
