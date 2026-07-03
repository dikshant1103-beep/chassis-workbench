/**
 * antiSquatAnalysis.ts — Cossalter / Foale Squat Ratio Engine (corrected)
 *
 * PHYSICS MODEL:
 *
 * The Instant Centre (IC / Point A) is found by intersecting two INFINITE lines:
 *
 *   Line 1 — Swingarm axis:
 *     Passes through swingarm pivot (X_sp, H_sp) at the static swingarm angle θ_sa.
 *     θ_sa = atan2(yc − H_sp, WB − X_sp)
 *
 *   Line 2 — Chain force line (line of action of chain tension):
 *     Passes through the drive sprocket (countershaft) at the chainForceAngle.
 *     chainForceAngle is a USER INPUT (top chain run angle from horizontal).
 *     IMPORTANT: this is NOT the geometric ds→rs angle — that always forces
 *     IC = rear axle → σ = 90° → R = 0 (degenerate case).
 *
 * Both lines are infinite; the IC is their intersection (may be far from the bike).
 *
 * SQUAT RATIO (Cossalter Ch. 5):
 *   Pr  = rear tyre contact patch = (WB, 0)  [Foale convention — always at ground]
 *   σ   = angle of squat line: atan2(IC_y − Pr_y, IC_x − Pr_x)
 *   τ   = angle of load-transfer line: atan2(Y_cg − Pr_y, X_cg − Pr_x)
 *   R   = tan(τ) / tan(σ)
 *
 *   R < 1  → anti-squat  (rear rises under acceleration)
 *   R ≈ 1  → neutral
 *   R > 1  → squat       (rear compresses under acceleration)
 *
 * ANTI-SQUAT % (Foale graphical method, Ch. 11):
 *   Draw line from Pr through IC. Find its height at x=0 (front axle vertical).
 *   AS% = h_at_x0 / Y_cg × 100
 *   AS% 100% ↔ R = 1 (neutral), consistent with both methods.
 *
 * COORDINATE SYSTEM:
 *   Origin : front tyre contact patch  (0, 0)
 *   +X     : rearward   (positive toward rear axle)
 *   +Y     : upward     (positive away from ground)
 *   Units  : mm
 *
 * REFERENCES:
 *   Cossalter, V. (2006) Motorcycle Dynamics, 2nd Ed., Ch. 5
 *   Foale, T. (2006) Motorcycle Handling and Chassis Design, Ch. 11
 */

import { GeometryParams, ChainParams } from './types';
import { computeChainForceAngle } from './antiSquat';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const CHAIN_PITCH_MM = 15.875; // 520 chain pitch

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SquatPoint {
  /** Rear axle height at this travel step (mm) */
  yc: number;
  /** Swingarm angle from horizontal (deg) */
  swingarmAngleDeg: number;
  /** Geometric chain angle ds→rs (deg) — for display only, NOT used for IC */
  chainAngleGeomDeg: number;
  /** Drive sprocket world position [x, y] (mm) — frame-fixed */
  driveSprocket: [number, number];
  /** Rear sprocket = rear axle centre [x, y] (mm) */
  rearSprocket: [number, number];
  /** Point A / IC [x, y] — intersection of swingarm line and chain FORCE line */
  pointA: [number, number] | null;
  /** Rear tyre contact patch (WB, 0) — Foale convention */
  rearContactPatch: [number, number];
  /** Squat line angle σ (deg) — measured from Pr to IC */
  sigma: number;
  /** Load-transfer line angle τ (deg) — measured from Pr to CG */
  tau: number;
  /**
   * Squat ratio R = tan(τ) / tan(σ)   [Cossalter Ch. 5]
   * NaN if lines are parallel or |tan(σ)| < 1e-9.
   */
  squatRatio: number;
  /** Foale graphical AS% — cross-check, should equal (R==1 ↔ AS%==100) */
  antiSquatPct: number;
  /** true if swingarm and chain force lines are parallel — no IC */
  parallel: boolean;
  /** Chain force line: two points that define the line for visualisation */
  chainForceLine: [[number, number], [number, number]];
  /** Sprocket radii for drawing */
  driveSprocketRadius: number;
  rearSprocketRadius: number;
}

export interface SquatAnalysisResult {
  staticPoint: SquatPoint;
  sweep: SquatPoint[];
  swingarmPivot: [number, number];
  rearAxleStatic: [number, number];
  cog: [number, number];
  ycRange: [number, number];
}

// ─── Single-step computation ──────────────────────────────────────────────────

function computeSquatAtYc(
  yc: number,
  gp: GeometryParams,
  chain: ChainParams,
  cog: [number, number],
): SquatPoint {
  const WB  = gp.wheelbase;
  const X_sp = gp.swingarmPivotX;
  const H_sp = gp.swingarmPivotHeight;

  // ── CVT / belt-drive shortcut ──────────────────────────────────────────────
  if (chain.isCVT) {
    const swingarmAngleDeg = Math.atan2(yc - H_sp, WB - X_sp) * RAD2DEG;
    const driveSprocket: [number, number] = [X_sp + chain.sprocketCenterX, H_sp + chain.sprocketCenterY];
    const rearSprocket: [number, number]  = [WB, yc];
    const rearContactPatch: [number, number] = [WB, 0];
    const ltDx = cog[0] - rearContactPatch[0];
    const ltDy = cog[1] - rearContactPatch[1];
    const tau = Math.atan2(ltDy, ltDx) * RAD2DEG;
    return {
      yc, swingarmAngleDeg, chainAngleGeomDeg: NaN,
      driveSprocket, rearSprocket, pointA: null, rearContactPatch,
      sigma: NaN, tau, squatRatio: NaN, antiSquatPct: NaN,
      parallel: true,
      chainForceLine: [[driveSprocket[0] - 300, driveSprocket[1]], [driveSprocket[0] + 300, driveSprocket[1]]],
      driveSprocketRadius: (chain.frontSprocket * CHAIN_PITCH_MM) / (2 * Math.PI),
      rearSprocketRadius:  (chain.rearSprocket  * CHAIN_PITCH_MM) / (2 * Math.PI),
    };
  }

  // ── Positions ──────────────────────────────────────────────────────────────

  const rearAxle: [number, number]       = [WB, yc];

  // Foale convention: rear contact patch is always at (WB, 0) — ground level.
  // The contact point is directly below the rear axle.
  const rearContactPatch: [number, number] = [WB, 0];

  // Drive sprocket: frame-fixed, offset from swingarm pivot
  const driveSprocket: [number, number] = [
    X_sp + chain.sprocketCenterX,
    H_sp + chain.sprocketCenterY,
  ];
  const rearSprocket: [number, number] = rearAxle;

  // Sprocket radii (520 chain: pitch = 15.875 mm)
  const driveSprocketRadius = (chain.frontSprocket * CHAIN_PITCH_MM) / (2 * Math.PI);
  const rearSprocketRadius  = (chain.rearSprocket  * CHAIN_PITCH_MM) / (2 * Math.PI);

  // ── Swingarm angle ─────────────────────────────────────────────────────────
  const swingarmAngleDeg = Math.atan2(yc - H_sp, WB - X_sp) * RAD2DEG;
  const swingarmAngleRad = swingarmAngleDeg * DEG2RAD;

  // ── Geometric chain angle (display only) ───────────────────────────────────
  // This is the actual ds→rs angle; it is NOT used for IC computation because
  // using it forces IC = rear axle → σ = 90° → R = 0 (degenerate).
  const chainDx = rearSprocket[0] - driveSprocket[0];
  const chainDy = rearSprocket[1] - driveSprocket[1];
  const chainAngleGeomDeg = Math.atan2(chainDy, chainDx) * RAD2DEG;

  // ── IC: intersection of swingarm line and chain FORCE line ─────────────────
  //
  // UNIFIED ENGINE: chain force angle is AUTO-COMPUTED from sprocket geometry.
  // chain.chainForceAngle is NO LONGER used for IC (it was compensating a sign bug).
  //
  // The corrected computeChainForceAngle() returns a negative angle for typical bikes
  // (chain slopes downward going from countershaft toward rear sprocket). ✓
  //
  const m1 = Math.tan(swingarmAngleRad);

  const r_drive = (chain.frontSprocket * CHAIN_PITCH_MM) / (2 * Math.PI);
  const r_rear  = (chain.rearSprocket  * CHAIN_PITCH_MM) / (2 * Math.PI);

  // Auto-compute chain force angle (corrected sign — no user trim added)
  const effectiveChainAngleDeg = computeChainForceAngle(
    driveSprocket[0], driveSprocket[1],
    rearAxle[0],      rearAxle[1],
    r_drive,          r_rear,
  );
  const m2 = Math.tan(effectiveChainAngleDeg * DEG2RAD);

  let pointA: [number, number] | null = null;
  let parallel = false;

  // ── Exact upper-run tangent contact point on drive sprocket (OLD coords) ──
  // The chain force LINE OF ACTION passes through the upper-run tangent contact
  // on the drive sprocket, not through the sprocket center.
  const thetaForce = (effectiveChainAngleDeg + 180) * DEG2RAD;
  const cfPerpX = -Math.sin(thetaForce);
  const cfPerpY =  Math.cos(thetaForce);
  const X_tan = driveSprocket[0] - r_drive * cfPerpX;
  const H_tan = driveSprocket[1] - r_drive * cfPerpY;

  // Chain force line points (for visualisation) — anchored at tangent contact point
  const cfExt = 600; // mm extension either side
  const cfCos = Math.cos(effectiveChainAngleDeg * DEG2RAD);
  const cfSin = Math.sin(effectiveChainAngleDeg * DEG2RAD);
  const chainForceLine: [[number, number], [number, number]] = [
    [X_tan - cfCos * cfExt, H_tan - cfSin * cfExt],
    [X_tan + cfCos * cfExt, H_tan + cfSin * cfExt],
  ];

  if (Math.abs(m1 - m2) < 1e-9) {
    parallel = true;
  } else {
    const y1_0 = H_sp  - m1 * X_sp;
    const y2_0 = H_tan - m2 * X_tan;  // line through tangent contact point
    const IC_x = (y2_0 - y1_0) / (m1 - m2);
    const IC_y = H_sp + m1 * (IC_x - X_sp);
    pointA = [IC_x, IC_y];
  }

  // ── Angles σ (squat line) and τ (load-transfer line) ──────────────────────

  let sigma = NaN;
  let tau   = NaN;
  let squatRatio   = NaN;
  let antiSquatPct = NaN;

  // τ: from rear contact patch (WB, 0) → CG
  const ltDx = cog[0] - rearContactPatch[0]; // negative (CG is forward)
  const ltDy = cog[1] - rearContactPatch[1]; // positive (CG is above ground)
  tau = Math.atan2(ltDy, ltDx) * RAD2DEG;

  if (!parallel && pointA !== null) {
    // σ: from rear contact patch (WB, 0) → IC
    const sqDx = pointA[0] - rearContactPatch[0];
    const sqDy = pointA[1] - rearContactPatch[1];
    sigma = Math.atan2(sqDy, sqDx) * RAD2DEG;

    const tanSigma = Math.tan(sigma * DEG2RAD);
    const tanTau   = Math.tan(tau   * DEG2RAD);

    if (Math.abs(tanSigma) > 1e-9) {
      squatRatio = tanTau / tanSigma;
    }

    // Foale AS%: height of squat line at x = 0 (front contact patch vertical)
    // Line from (WB, 0) through IC: slope = sqDy/sqDx
    // y at x=0: y = 0 + (sqDy/sqDx) × (0 − WB)
    if (Math.abs(sqDx) > 1e-9 && Math.abs(cog[1]) > 1e-9) {
      const h_at_front = rearContactPatch[1] + (sqDy / sqDx) * (0 - rearContactPatch[0]);
      antiSquatPct = (h_at_front / cog[1]) * 100;
    }
  }

  return {
    yc,
    swingarmAngleDeg,
    chainAngleGeomDeg,
    driveSprocket,
    rearSprocket,
    pointA: pointA ?? null,
    rearContactPatch,
    sigma,
    tau,
    squatRatio,
    antiSquatPct,
    parallel,
    chainForceLine,
    driveSprocketRadius,
    rearSprocketRadius,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute full squat ratio analysis: static point + sweep over suspension travel.
 *
 * @param gp        GeometryParams
 * @param chain     ChainParams  (chainForceAngle is the key input for IC)
 * @param cog       [X_cg, Y_cg] mm from computeCoG()
 * @param ycOffset  Half-range of yc sweep (mm) — default 50
 * @param step      Sweep step size (mm) — default 2
 */
export function computeSquatAnalysis(
  gp: GeometryParams,
  chain: ChainParams,
  cog: [number, number],
  ycOffset = 50,
  step = 2,
): SquatAnalysisResult {
  const ycStatic = gp.rearAxleHeight;
  const ycMin = ycStatic - ycOffset;
  const ycMax = ycStatic + ycOffset;

  const sweep: SquatPoint[] = [];
  for (let yc = ycMin; yc <= ycMax + 1e-6; yc += step) {
    sweep.push(computeSquatAtYc(yc, gp, chain, cog));
  }

  return {
    staticPoint: computeSquatAtYc(ycStatic, gp, chain, cog),
    sweep,
    swingarmPivot: [gp.swingarmPivotX, gp.swingarmPivotHeight],
    rearAxleStatic: [gp.wheelbase, ycStatic],
    cog,
    ycRange: [ycMin, ycMax],
  };
}

/**
 * Sweep sprocket tooth count and observe squat ratio variation.
 *
 * NOTE: R is geometrically invariant to tooth count when sprocket positions
 * are fixed (IC depends only on geometry, not ratio). The sweep confirms
 * this stability and shows how Foale AS% scales with gear ratio.
 */
export interface SprocketSweepPoint {
  teeth: number;
  gearRatio: number;
  squatRatio: number;
  antiSquatPct: number;
  swingarmAngleDeg: number;
}

export function sweepSprocketRatio(
  gp: GeometryParams,
  chain: ChainParams,
  cog: [number, number],
  sweepFront = true,
  frontRange: [number, number] = [10, 20],
  rearRange:  [number, number] = [28, 56],
): SprocketSweepPoint[] {
  const ycStatic = gp.rearAxleHeight;
  const results: SprocketSweepPoint[] = [];

  if (sweepFront) {
    for (let t = frontRange[0]; t <= frontRange[1]; t++) {
      const mod = { ...chain, frontSprocket: t };
      const pt  = computeSquatAtYc(ycStatic, gp, mod, cog);
      results.push({ teeth: t, gearRatio: t / chain.rearSprocket, squatRatio: pt.squatRatio, antiSquatPct: pt.antiSquatPct, swingarmAngleDeg: pt.swingarmAngleDeg });
    }
  } else {
    for (let t = rearRange[0]; t <= rearRange[1]; t++) {
      const mod = { ...chain, rearSprocket: t };
      const pt  = computeSquatAtYc(ycStatic, gp, mod, cog);
      results.push({ teeth: t, gearRatio: chain.frontSprocket / t, squatRatio: pt.squatRatio, antiSquatPct: pt.antiSquatPct, swingarmAngleDeg: pt.swingarmAngleDeg });
    }
  }

  return results;
}

/**
 * Condition label and color for a squat ratio value.
 */
export function squatCondition(R: number): { label: string; color: string } {
  if (!isFinite(R) || isNaN(R)) return { label: 'N/A', color: 'var(--text-muted)' };
  if (R < 0.85)  return { label: 'Anti-squat ↑', color: 'var(--accent2)' };
  if (R < 0.97)  return { label: 'Mild anti-squat', color: 'var(--accent2)' };
  if (R <= 1.03) return { label: 'Neutral ≈ 1', color: 'var(--cyan)' };
  if (R <= 1.20) return { label: 'Mild squat', color: 'var(--warn)' };
  return { label: 'Squat ↓', color: '#f85149' };
}
