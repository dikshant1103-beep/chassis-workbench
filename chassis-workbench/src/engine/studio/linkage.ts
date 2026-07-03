/**
 * studio/linkage.ts — Real 4-bar rear linkage solver (ISOLATED)
 *
 * Implements the rising-rate single-shock linkage (Honda Pro-Link / Kawasaki
 * Uni-Trak style) as a single-DOF four-bar mechanism, solved by Newton-Raphson
 * at each wheel-travel step. This replaces the earlier Studio approximation that
 * treated the linkage shock as a direct swingarm member.
 *
 * MECHANISM (side view, mm):
 *   - Swingarm rotates about its frame pivot P; a point S on the swingarm (the
 *     pushrod attachment = the lower-shock-mount hardpoint) rides on a circular
 *     arc as the wheel moves.
 *   - A rocker rotates about a frame-fixed pivot R (linkage.rockerPivot); its tip
 *     Q is at distance L_rock from R.
 *   - A rigid pushrod of length L_push connects S → Q (loop-closure constraint).
 *   - The shock connects the rocker tip Q (lower) to the frame mount (upper).
 *
 * Motion ratio MR(u) = |d L_shock / d u_wheel|. The non-linear S→Q→shock chain
 * is what produces the progressive (rising) wheel-rate curve.
 *
 * SOURCE: DERIVED — same four-bar method validated in the main app's
 * engine/sweep.ts (solveRockerAngle / shockLengthFourBar). Pure, no side effects.
 */

import { RearSuspension, RearLinkage, Point2 } from './types';

const DEG = Math.PI / 180;

function dist(a: Point2, b: Point2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Swingarm angle (deg) at wheel travel u (bump positive). */
function armAngleAtTravel(pivot: Point2, L: number, angle0Deg: number, u: number): number {
  const y0 = pivot.y + L * Math.sin(angle0Deg * DEG);
  const s = (y0 + u - pivot.y) / L;
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}
function rotateAbout(p: Point2, pivot: Point2, dAngleDeg: number): Point2 {
  const dx = p.x - pivot.x, dy = p.y - pivot.y;
  const c = Math.cos(dAngleDeg * DEG), s = Math.sin(dAngleDeg * DEG);
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}

/**
 * Solve the four-bar loop for the rocker angle θ_r such that |Q − S| = L_push,
 * with Q = R + L_rock·[cos θ_r, sin θ_r]. Newton-Raphson warm-started at θ_r0.
 */
function solveRockerAngle(S: Point2, R: Point2, L_rock: number, L_push: number, theta_r0: number): number {
  let theta = theta_r0;
  for (let i = 0; i < 50; i++) {
    const Qx = R.x + L_rock * Math.cos(theta);
    const Qy = R.y + L_rock * Math.sin(theta);
    const dx = Qx - S.x, dy = Qy - S.y;
    const fval = dx * dx + dy * dy - L_push * L_push;
    const df = 2 * (-L_rock * Math.sin(theta) * dx + L_rock * Math.cos(theta) * dy);
    if (Math.abs(df) < 1e-12) break;
    const dtheta = -fval / df;
    theta += dtheta;
    if (Math.abs(dtheta) < 1e-9) break;
  }
  return theta;
}

/** Rocker tip Q and shock length at wheel travel u. */
export function linkageStateAtTravel(r: RearSuspension, lk: RearLinkage, u: number): {
  rockerTip: Point2; shockLen: number; pushrodFrom: Point2;
} {
  const angle = armAngleAtTravel(r.swingarmPivot, r.swingarmLength, r.swingarmAngleDeg, u);
  // Pushrod attachment S = the swingarm-fixed lower-shock-mount hardpoint, rotated.
  const S = rotateAbout(r.lowerShockMount, r.swingarmPivot, angle - r.swingarmAngleDeg);
  const theta_r = solveRockerAngle(
    S, lk.rockerPivot, lk.rockerLength, lk.pushrodLength, lk.rockerAngleStatic * DEG,
  );
  const Q: Point2 = {
    x: lk.rockerPivot.x + lk.rockerLength * Math.cos(theta_r),
    y: lk.rockerPivot.y + lk.rockerLength * Math.sin(theta_r),
  };
  return { rockerTip: Q, shockLen: dist(Q, r.upperShockMount), pushrodFrom: S };
}

/** Motion ratio MR(u) = |dL_shock/du| via central difference. */
export function linkageMotionRatioAtTravel(r: RearSuspension, lk: RearLinkage, u: number, h = 0.5): number {
  const Lp = linkageStateAtTravel(r, lk, u + h).shockLen;
  const Lm = linkageStateAtTravel(r, lk, u - h).shockLen;
  return Math.abs((Lp - Lm) / (2 * h));
}

/**
 * Generate a geometrically valid default linkage that achieves a target static
 * motion ratio with a mild rising rate, using the real solver as a design tool.
 * A hand-picked four-bar is easily degenerate; this searches rocker length +
 * static angle (with a good transmission angle and convergent loop closure) and
 * returns the best-scoring valid mechanism. SOURCE: DERIVED design search.
 *
 * @param r           rear suspension (pivot, swingarm, lowerShockMount=pushrod
 *                    attach on swingarm, upperShockMount=shock top)
 * @param targetMR    desired static motion ratio (e.g. 0.32)
 */
export function calibrateLinkage(r: RearSuspension, targetMR: number): RearLinkage {
  const P = r.swingarmPivot, L = r.swingarmLength;
  const S = r.lowerShockMount;            // pushrod attach on the swingarm
  const U = r.upperShockMount;            // shock top (frame)

  // Rocker pivot: on the frame, above the pivot and forward of the shock top.
  const R: Point2 = { x: P.x + 0.10 * L, y: P.y + 0.42 * L };

  let best: { lk: RearLinkage; err: number } | null = null;
  for (let rockerLen = 35; rockerLen <= 110; rockerLen += 5) {
    for (let angDeg = 0; angDeg < 360; angDeg += 10) {
      const ang = angDeg * DEG;
      const Q0: Point2 = { x: R.x + rockerLen * Math.cos(ang), y: R.y + rockerLen * Math.sin(ang) };
      const pushrodLen = dist(S, Q0);
      if (pushrodLen < 40 || pushrodLen > 260) continue;
      const shockLen0 = dist(Q0, U);
      if (shockLen0 < 120) continue;

      // transmission angle between rocker (R→Q0) and pushrod (S→Q0): want ~90°.
      const a1 = { x: Q0.x - R.x, y: Q0.y - R.y };
      const a2 = { x: Q0.x - S.x, y: Q0.y - S.y };
      const cosT = (a1.x * a2.x + a1.y * a2.y) / ((dist(R, Q0) || 1) * (dist(S, Q0) || 1));
      if (Math.abs(cosT) > 0.78) continue; // transmission angle < 39° or > 141° → skip

      const lk: RearLinkage = { rockerPivot: R, rockerLength: rockerLen, pushrodLength: pushrodLen, rockerAngleStatic: angDeg };
      const mr0 = linkageMotionRatioAtTravel(r, lk, 0);
      const mrT = linkageMotionRatioAtTravel(r, lk, r.wheelTravel * 0.9);
      if (!(mr0 > 0.12 && mr0 < 0.85) || !isFinite(mrT)) continue;
      const rising = mrT / mr0;
      if (rising < 0.80 || rising > 1.45) continue; // physical leverage curves

      // prefer target MR + mild rising rate (≈1.05–1.20).
      const err = Math.abs(mr0 - targetMR) + 0.4 * Math.abs(rising - 1.12);
      if (!best || err < best.err) best = { lk, err };
    }
  }

  // Fallback: a simple valid rocker if no candidate qualified (rare).
  return best?.lk ?? {
    rockerPivot: R, rockerLength: 60,
    pushrodLength: Math.max(60, dist(S, { x: R.x + 60, y: R.y })),
    rockerAngleStatic: 200,
  };
}
