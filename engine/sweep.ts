/**
 * sweep.ts — Suspension Travel Sweep Engine
 *
 * Computes MR(u), WR(u), AS%(u), and trail(u) over the full rear
 * suspension travel range by simulating swingarm kinematics at each
 * 1 mm step of wheel travel.
 *
 * Two rear suspension topologies are supported:
 *
 *   'direct'  — shock connects swingarm directly to frame (monoshock)
 *   'fourbar' — Pro-Link / Uni-Trak: rocker + pushrod between swingarm
 *               and shock.  One nonlinear equation (loop closure) solved
 *               by Newton-Raphson at each step.
 *
 * COORDINATE SYSTEM
 *   Origin = front tyre contact patch, level ground.
 *   +X = rearward (positive toward rear axle).
 *   +Y = upward.
 *   All lengths in mm.
 *
 * REFERENCES
 *   Foale (2006) Ch. 6 — Motion ratio, wheel rate
 *   Foale (2006) Ch. 11 — Anti-squat, instant centre method
 *   Cossalter (2006) Ch. 5 — Suspension kinematics
 */

import { GeometryParams, SuspensionParams, ChainParams, SweepParams, SweepPoint, SweepResults } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─── Swingarm kinematics ──────────────────────────────────────────────────────

/**
 * Compute swingarm angle at wheel travel u.
 *
 * The rear axle rides on a circular arc of radius L_sa centred on the
 * swingarm pivot.  Wheel travel u (positive = bump / compression) raises
 * the rear axle: H_ra(u) = H_ra_static + u.
 *
 * θ_sa(u) = arcsin((H_ra(u) − H_sp) / L_sa)
 */
function swingarmAngleAtTravel(
  u_mm: number,
  H_ra_static: number,
  H_sp: number,
  L_sa: number,
): number {
  const H_ra_u = H_ra_static + u_mm;
  const sinTheta = (H_ra_u - H_sp) / L_sa;
  // clamp to [-1, 1] to avoid asin domain errors at geometry limits
  return Math.asin(Math.max(-1, Math.min(1, sinTheta)));
}

// ─── Shock length helpers ─────────────────────────────────────────────────────

/**
 * World-frame position of the shock attachment point on the swingarm.
 *
 * The attachment is at distance d from the pivot, at angle (θ_sa + φ_arm)
 * measured from the horizontal.
 */
function shockAttachWorld(
  X_sp: number, H_sp: number,
  theta_sa: number,
  d: number, phi_arm_rad: number,
): [number, number] {
  const angle = theta_sa + phi_arm_rad;
  return [X_sp + d * Math.cos(angle), H_sp + d * Math.sin(angle)];
}

/** Euclidean distance between two 2-D points. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Direct monoshock ─────────────────────────────────────────────────────────

function shockLengthDirect(
  u_mm: number,
  gp: GeometryParams,
  sp: SweepParams,
): number {
  const theta = swingarmAngleAtTravel(
    u_mm, gp.rearAxleHeight, gp.swingarmPivotHeight, gp.swingarmLength,
  );
  const [ax, ay] = shockAttachWorld(
    gp.swingarmPivotX, gp.swingarmPivotHeight,
    theta, sp.shockArmLength, sp.shockArmAngle * DEG2RAD,
  );
  return dist2(ax, ay, sp.shockTopX, sp.shockTopY);
}

// ─── 4-bar (Pro-Link / Uni-Trak) ─────────────────────────────────────────────

/**
 * Solve the single-DOF 4-bar loop closure for rocker angle θ_r.
 *
 * Given the swingarm attachment S(u), rocker pivot R, rocker length
 * L_rock and pushrod length L_push, find θ_r such that:
 *
 *   |Q − S|² = L_push²   where Q = R + L_rock·[cos θ_r, sin θ_r]
 *
 * Expanded: f(θ_r) = (R_x + L_rock·cos θ_r − S_x)² +
 *                    (R_y + L_rock·sin θ_r − S_y)² − L_push² = 0
 *
 * Solved by Newton-Raphson starting from the previous step's angle.
 */
function solveRockerAngle(
  S: [number, number],
  R: [number, number],
  L_rock: number,
  L_push: number,
  theta_r0: number,
): number {
  let theta = theta_r0;
  for (let iter = 0; iter < 50; iter++) {
    const Qx = R[0] + L_rock * Math.cos(theta);
    const Qy = R[1] + L_rock * Math.sin(theta);
    const dx = Qx - S[0], dy = Qy - S[1];
    const f  = dx * dx + dy * dy - L_push * L_push;
    const df = 2 * (-L_rock * Math.sin(theta) * dx + L_rock * Math.cos(theta) * dy);
    if (Math.abs(df) < 1e-12) break;
    const dtheta = -f / df;
    theta += dtheta;
    if (Math.abs(dtheta) < 1e-9) break;
  }
  return theta;
}

function shockLengthFourBar(
  u_mm: number,
  gp: GeometryParams,
  sp: SweepParams,
  theta_r0: number,
): { shockLen: number; theta_r: number } {
  const fb = sp.fourBar!;
  const theta_sa = swingarmAngleAtTravel(
    u_mm, gp.rearAxleHeight, gp.swingarmPivotHeight, gp.swingarmLength,
  );
  // Swingarm attachment (S)
  const [Sx, Sy] = shockAttachWorld(
    gp.swingarmPivotX, gp.swingarmPivotHeight,
    theta_sa, sp.shockArmLength, sp.shockArmAngle * DEG2RAD,
  );
  // Rocker pivot (R) — fixed to frame
  const R: [number, number] = [fb.rockerPivotX, fb.rockerPivotY];

  // Solve for rocker angle
  const theta_r = solveRockerAngle(
    [Sx, Sy], R, fb.rockerLength, fb.pushrodLength, theta_r0,
  );

  // Rocker tip Q
  const Qx = R[0] + fb.rockerLength * Math.cos(theta_r);
  const Qy = R[1] + fb.rockerLength * Math.sin(theta_r);

  // Shock length = |Q − shock_top|
  const shockLen = dist2(Qx, Qy, sp.shockTopX, sp.shockTopY);
  return { shockLen, theta_r };
}

// ─── Anti-squat at travel position ────────────────────────────────────────────

/**
 * Compute anti-squat % for a given swingarm angle using the Foale
 * graphical / instant-centre method.
 *
 * Reproduces the logic in antiSquat.ts but as a pure function so the
 * sweep engine doesn't depend on the full computeAll pipeline.
 */
function antiSquatAtAngle(
  theta_sa_rad: number,
  X_sp: number, H_sp: number,
  wheelbase: number,
  Y_cg: number,
  chain: ChainParams,
): number {
  const m1 = Math.tan(theta_sa_rad);
  const m2 = Math.tan(chain.chainForceAngle * DEG2RAD);
  if (Math.abs(m1 - m2) < 1e-9) return NaN; // parallel lines — no IC

  const x1 = X_sp, y1 = H_sp;
  const x2 = X_sp + chain.sprocketCenterX;
  const y2 = H_sp + chain.sprocketCenterY;

  const IC_x = (y2 - y1 + m1 * x1 - m2 * x2) / (m1 - m2);
  const IC_y = H_sp + m1 * (IC_x - X_sp);

  const denom = wheelbase - IC_x;
  if (Math.abs(denom) < 1e-9) return NaN;

  const slope_IC = (0 - IC_y) / denom;
  const h_front  = IC_y + slope_IC * (0 - IC_x);
  return (h_front / Y_cg) * 100;
}

// ─── Trail under fork dive ────────────────────────────────────────────────────

/**
 * Trail as a function of fork compression u_f (positive = dive).
 *
 * As the fork compresses, the steering axis tilts slightly forward,
 * reducing trail:
 *   T(u_f) = T_static − u_f × sin(α) × tan(α)
 *
 * Wheelbase also increases: W(u_f) = W_static + u_f × cos(α)
 * (not returned here but used for reference in sweep chart).
 *
 * Foale Ch. 2 derived form.
 */
function trailAtForkDive(
  u_f_mm: number,
  R_f: number,
  alpha_rad: number,
  forkOffset: number,
): number {
  const T_static = (R_f * Math.sin(alpha_rad) - forkOffset) / Math.cos(alpha_rad);
  return T_static - u_f_mm * Math.sin(alpha_rad) * Math.tan(alpha_rad);
}

// ─── Motion ratio (central difference) ───────────────────────────────────────

function motionRatio(
  u_mm: number,
  du: number,
  shockLenFn: (u: number) => number,
): number {
  const L_lo = shockLenFn(u_mm - du);
  const L_hi = shockLenFn(u_mm + du);
  // MR = du_wheel / du_shock; shock compresses as wheel rises → signs cancel
  // d(shock_length)/d(travel) is negative (shock gets shorter as wheel rises)
  const dL_du = (L_hi - L_lo) / (2 * du);
  // MR = |wheel travel change / shock compression change| = 1 / |dL/du|
  return Math.abs(1 / dL_du);
}

// ─── Main sweep function ──────────────────────────────────────────────────────

/**
 * Compute the full suspension travel sweep.
 *
 * @param gp         GeometryParams
 * @param susp       SuspensionParams (spring rate, shock travel)
 * @param chain      ChainParams (for anti-squat)
 * @param sweep      SweepParams (shock mount geometry)
 * @param Y_cg_mm    CoG height (mm) — from CoG module
 * @param du_mm      Step size (default 1 mm)
 * @returns SweepResults
 */
export function computeSweep(
  gp: GeometryParams,
  susp: SuspensionParams,
  chain: ChainParams,
  sweep: SweepParams,
  Y_cg_mm: number,
  du_mm = 1,
): SweepResults {
  const alpha_rad = gp.headAngle * DEG2RAD;
  const R_f = gp.frontWheelDia / 2;
  const k   = susp.springRateRear; // N/mm
  const maxTravel = susp.shockTravel / (sweep.linkageType === 'direct'
    ? 1.0
    : 1.0); // will be refined by actual MR; use shock travel as proxy for now

  // Travel range: 0 (static) to full wheel bump travel
  // We use shock travel * typical MR as proxy for wheel travel
  // Users can override via shockTravel input
  const nSteps = Math.round(maxTravel / du_mm) + 1;
  const points: SweepPoint[] = [];

  let theta_r0 = sweep.fourBar ? sweep.fourBar.rockerAngleStatic * DEG2RAD : 0;
  // Compute shock length at u=0 for compression reference
  const shockLen0 = sweep.linkageType === 'direct'
    ? shockLengthDirect(0, gp, sweep)
    : (() => { const r = shockLengthFourBar(0, gp, sweep, theta_r0); theta_r0 = r.theta_r; return r.shockLen; })();

  const shockLenFn = (u: number): number => {
    if (sweep.linkageType === 'direct') return shockLengthDirect(u, gp, sweep);
    return shockLengthFourBar(u, gp, sweep, theta_r0).shockLen;
  };

  for (let i = 0; i < nSteps; i++) {
    const u = i * du_mm;

    const theta_sa = swingarmAngleAtTravel(
      u, gp.rearAxleHeight, gp.swingarmPivotHeight, gp.swingarmLength,
    );

    let shockLen: number;
    if (sweep.linkageType === 'direct') {
      shockLen = shockLengthDirect(u, gp, sweep);
    } else {
      const res = shockLengthFourBar(u, gp, sweep, theta_r0);
      shockLen = res.shockLen;
      theta_r0 = res.theta_r; // warm-start for next step
    }

    const shockCompression = shockLen0 - shockLen;

    // Motion ratio (central difference; skip endpoints)
    let MR: number;
    if (u < du_mm || u > (nSteps - 2) * du_mm) {
      // forward/backward difference at endpoints
      const du2 = du_mm;
      const L1 = shockLenFn(u);
      const L2 = shockLenFn(u + (u < du_mm ? du2 : -du2));
      const sign = u < du_mm ? 1 : -1;
      const dL = sign * (L2 - L1) / du2;
      MR = Math.abs(1 / dL);
    } else {
      MR = motionRatio(u, du_mm, shockLenFn);
    }

    const WR = k * MR * MR;

    const AS = antiSquatAtAngle(
      theta_sa, gp.swingarmPivotX, gp.swingarmPivotHeight,
      gp.wheelbase, Y_cg_mm, chain,
    );

    // Trail: assume fork dives proportionally to rear bump (in-phase)
    // For pure rear sweep, trail stays static. For fork-dive sweep,
    // u is used as fork compression too. User can inspect independently.
    const trail = trailAtForkDive(u, R_f, alpha_rad, gp.forkOffset);

    points.push({
      travel_mm: u,
      swingarmAngleDeg: theta_sa * RAD2DEG,
      shockLength_mm: shockLen,
      shockCompression_mm: shockCompression,
      motionRatio: MR,
      wheelRate_Nmm: WR,
      antiSquatPct: isNaN(AS) ? 0 : AS,
      trail_mm: trail,
    });
  }

  return { points, static: points[0] };
}
