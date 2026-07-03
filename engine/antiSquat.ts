/**
 * antiSquat.ts — Anti-Squat / Anti-Dive / Chain Geometry Engine
 *
 * Implements Equations 8.1–8.13 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * This is the most complex module. The computation uses the graphical
 * method described by Tony Foale in "Motorcycle Handling and Chassis
 * Design" (Ch. 11): find the Instant Centre (IC) from the intersection
 * of the swingarm extension line and the top chain run line, then draw
 * a line from the rear contact patch through the IC to find how high
 * it intercepts the front contact patch vertical — expressed as % of
 * CoG height = anti-squat percentage.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 11.
 *   DataMC.org. Anti-Squat Geometry calculator methodology.
 *   Suspensionsecrets.co.uk. Anti-Squat Geometry.
 *   SAE J1168 — Motorcycle Terminology
 *
 * COORDINATE SYSTEM:
 *   Origin : front tyre contact patch (ground level, under front axle)
 *   +X     : toward rear of motorcycle (positive = rearward)
 *   +Y     : upward (positive = away from ground)
 *
 * ALL INPUT ANGLES: degrees (converted to radians internally)
 * ALL LENGTHS: mm
 */

import { ChainParams, AntiSquatResults } from './types';

const DEG2RAD = Math.PI / 180;

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes overall gear ratio.
 *
 * GearRatio = Z_r / Z_f                        ... Eq 8.1
 *
 * @param Z_f  Countershaft (front) sprocket teeth
 * @param Z_r  Rear wheel sprocket teeth
 * @returns Gear ratio (dimensionless, > 1 for speed reduction)
 */
export function computeGearRatio(Z_f: number, Z_r: number): number {
  if (Math.abs(Z_f) < 1e-9) {
    throw new RangeError('computeGearRatio: front sprocket teeth cannot be zero.');
  }
  // Eq 8.1
  return Z_r / Z_f;
}

/**
 * Computes the Instant Centre (IC) of the anti-squat geometry.
 *
 * The IC is the intersection of two lines:
 *
 *   Line 1 — Swingarm extension line:
 *     Passes through swingarm pivot (X_sp, H_sp) at slope tan(θ_sa).
 *     Equation: y = H_sp + tan(θ_sa) × (x − X_sp)              (Eq 8.2)
 *
 *   Line 2 — Top chain run line:
 *     Passes through countershaft centre at (X_sp + Δx_cs, H_sp + Δy_cs)
 *     at slope tan(θ_chain).
 *     Equation: y = (H_sp + Δy_cs) + tan(θ_chain) × (x − X_sp − Δx_cs)
 *                                                               (Eq 8.3)
 *
 *   Solving the two-line intersection parametrically:
 *   IC_x = (y2_0 − y1_0 + m1×x1 − m2×x2) / (m1 − m2)          (Eq 8.4)
 *   IC_y = H_sp + tan(θ_sa) × (IC_x − X_sp)                    (Eq 8.5)
 *
 *   where m1 = tan(θ_sa), y1_0 = H_sp, x1 = X_sp
 *         m2 = tan(θ_chain), y2_0 = H_sp + Δy_cs, x2 = X_sp + Δx_cs
 *
 * @param X_sp          Swingarm pivot X from front axle (mm)
 * @param H_sp          Swingarm pivot height (mm)
 * @param swingarmAngleRad  Swingarm angle (rad) — from computeSwingarmAngle()
 * @param chainParams   ChainParams (Δx_cs, Δy_cs, chainForceAngle in deg)
 * @returns { IC_x, IC_y } in mm
 * @throws  RangeError if swingarm and chain lines are parallel (no IC)
 */
export function computeInstantCentre(
  X_sp: number,
  H_sp: number,
  swingarmAngleRad: number,
  chainParams: ChainParams,
): { IC_x: number; IC_y: number } {
  const m1 = Math.tan(swingarmAngleRad); // slope of swingarm line
  const m2 = Math.tan(chainParams.chainForceAngle * DEG2RAD); // slope of chain line

  if (Math.abs(m1 - m2) < 1e-9) {
    throw new RangeError(
      `computeInstantCentre: swingarm line (slope ${m1.toFixed(4)}) and ` +
      `chain line (slope ${m2.toFixed(4)}) are parallel — no Instant Centre exists. ` +
      `Adjust chain force angle or swingarm angle.`,
    );
  }

  // Points on each line:
  const x1 = X_sp;
  const y1_0 = H_sp;
  const x2 = X_sp + chainParams.sprocketCenterX;
  const y2_0 = H_sp + chainParams.sprocketCenterY;

  // Eq 8.4 — parametric intersection
  const IC_x = (y2_0 - y1_0 + m1 * x1 - m2 * x2) / (m1 - m2);

  // Eq 8.5 — substitute IC_x back into swingarm line
  const IC_y = H_sp + m1 * (IC_x - X_sp);

  return { IC_x, IC_y };
}

/**
 * Computes Anti-Squat percentage using the Foale graphical method.
 *
 * Draw a line from the rear tyre contact patch (WB, 0) through the
 * Instant Centre (IC_x, IC_y) and extend it forward. The height at
 * which this line crosses the front contact patch vertical (x = 0),
 * expressed as a percentage of CoG height, is the anti-squat %.
 *
 * slope_IC = (0 − IC_y) / (WB − IC_x)         ... Eq 8.6
 * height_at_front = IC_y + slope_IC × (0 − IC_x)  ... Eq 8.7
 * Anti-Squat% = (height_at_front / Y_cg) × 100    ... Eq 8.8
 *
 * Interpretation (Foale):
 *   100% → anti-squat forces exactly balance weight transfer (neutral)
 *   < 100% → rear squats under power (under-anti-squat)
 *   > 100% → rear rises under power (over-anti-squat / "jacking")
 *
 * @param IC_x      Instant Centre x-position (mm)
 * @param IC_y      Instant Centre y-position (mm)
 * @param Y_cg      CoG height from ground (mm)
 * @param wheelbase WB (mm) — rear contact patch is at (WB, 0)
 * @returns Anti-squat percentage
 * @throws  RangeError if Y_cg or (WB − IC_x) is zero
 */
export function computeAntiSquatPercent(
  IC_x: number,
  IC_y: number,
  Y_cg: number,
  wheelbase: number,
): number {
  if (Math.abs(Y_cg) < 1e-9) {
    throw new RangeError('computeAntiSquatPercent: Y_cg cannot be zero.');
  }

  const denom = wheelbase - IC_x;
  if (Math.abs(denom) < 1e-9) {
    throw new RangeError(
      `computeAntiSquatPercent: IC_x (${IC_x.toFixed(1)} mm) equals wheelbase ` +
      `(${wheelbase.toFixed(1)} mm) — anti-squat line is vertical.`,
    );
  }

  // Eq 8.6 — slope of the anti-squat line (from rear contact through IC)
  const slope_IC = (0 - IC_y) / denom;

  // Eq 8.7 — height of that line at x = 0 (front contact patch vertical)
  const height_at_front = IC_y + slope_IC * (0 - IC_x);

  // Eq 8.8
  return (height_at_front / Y_cg) * 100;
}

/**
 * Computes the swingarm-geometry-only contribution to anti-squat
 * (what AS% would be with no chain tension at all).
 *
 * When chain tension = 0, the IC moves to infinity along the swingarm
 * axis.  The anti-squat line from the rear contact patch (WB, 0) then
 * runs PARALLEL to the swingarm.  Its height at x = 0 (front contact
 * patch vertical) is:
 *
 *   h = −tan(θ_sa) × WB
 *
 * Because θ_sa < 0 for a typical bike (axle below pivot), this gives
 * a positive h, i.e. a real positive anti-squat contribution.
 *
 * AS_swingarm_only = (−tan(θ_sa) × WB / Y_cg) × 100   ... Eq 8.9 (corrected)
 *
 * Previous implementation used tan(θ_sa) × L_sa / Y_cg which is wrong:
 * it produced a negative result for all typical bikes (θ_sa < 0) and
 * used swingarm length instead of wheelbase — both errors compounded.
 *
 * Reference: Foale Ch. 11 graphical method; derived from parallel-line
 * limiting case of the IC construction.
 *
 * @param swingarmAngleRad  θ_sa (rad) — negative for axle-below-pivot
 * @param wheelbase         WB (mm)
 * @param Y_cg              CoG height (mm)
 * @returns Swingarm-only anti-squat contribution (%)
 */
export function computeSwingarmOnlyAS(
  swingarmAngleRad: number,
  wheelbase: number,
  Y_cg: number,
): number {
  if (Math.abs(Y_cg) < 1e-9) {
    throw new RangeError('computeSwingarmOnlyAS: Y_cg cannot be zero.');
  }
  // Eq 8.9 (corrected): IC at infinity → AS line parallel to swingarm
  return (-Math.tan(swingarmAngleRad) * wheelbase / Y_cg) * 100;
}

/**
 * Computes the anti-dive percentage for telescopic front forks.
 *
 * For telescopic forks (no anti-dive valve or linkage), anti-dive comes
 * only from the steering geometry reacting to braking forces.
 *
 * Anti-Dive% = tan(α) × (F_front / W) × 100   ... Eq 8.11
 *
 * Where α is the head angle (rake), F_front is the front braking force,
 * and W is total vehicle weight.
 *
 * @param headAngle_deg  Head angle α from vertical (degrees)
 * @param F_front        Front braking force (N)
 * @param totalWeight    Total weight W (N)
 * @returns Anti-dive percentage
 * @throws  RangeError if totalWeight is zero
 */
export function computeAntiDivePercent(
  headAngle_deg: number,
  F_front: number,
  totalWeight: number,
): number {
  if (Math.abs(totalWeight) < 1e-9) {
    throw new RangeError('computeAntiDivePercent: total weight cannot be zero.');
  }
  const alpha = headAngle_deg * DEG2RAD;
  // Eq 8.11
  return Math.tan(alpha) * (F_front / totalWeight) * 100;
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Full anti-squat computation — aggregates Eq 8.1 through 8.13.
 *
 * @param chain            ChainParams (sprockets, countershaft offset, chain angle)
 * @param X_sp             Swingarm pivot X from front axle (mm)
 * @param H_sp             Swingarm pivot height (mm)
 * @param swingarmAngleRad θ_sa (rad) — from computeGeometry()
 * @param swingarmLength   L_sa (mm)
 * @param wheelbase        WB (mm)
 * @param Y_cg             CoG height (mm) — from computeCoG()
 * @param headAngle_deg    Head angle (degrees) — for anti-dive
 * @param R_front          Front static axle reaction (N) — for anti-dive
 * @param totalWeight      Total weight (N) — for anti-dive
 * @returns AntiSquatResults
 */
export function computeAntiSquat(
  chain: ChainParams,
  X_sp: number,
  H_sp: number,
  swingarmAngleRad: number,
  swingarmLength: number,
  wheelbase: number,
  Y_cg: number,
  headAngle_deg: number,
  R_front: number,
  totalWeight: number,
): AntiSquatResults {
  // Eq 8.1
  const gearRatio = computeGearRatio(chain.frontSprocket, chain.rearSprocket);

  // Eq 8.4 / 8.5 — Instant Centre
  const { IC_x, IC_y } = computeInstantCentre(
    X_sp, H_sp, swingarmAngleRad, chain,
  );

  // Eq 8.8 — Anti-squat %
  const antiSquatPercent = computeAntiSquatPercent(IC_x, IC_y, Y_cg, wheelbase);

  // Eq 8.9 — swingarm-only contribution (pass wheelbase, not swingarmLength)
  const asSwingarmOnly = computeSwingarmOnlyAS(swingarmAngleRad, wheelbase, Y_cg);

  // Eq 8.10 — chain contribution = total − swingarm only
  const chainContribution = antiSquatPercent - asSwingarmOnly;

  // Eq 8.11 — anti-dive
  const antiDivePercent = computeAntiDivePercent(headAngle_deg, R_front, totalWeight);

  // Eq 8.12 — pro-squat (the squatting component when anti-squat < 0)
  const proSquat = Math.max(0, -antiSquatPercent);

  // Eq 8.13 — pro-dive
  const proDive = Math.max(0, -antiDivePercent);

  return {
    gearRatio,
    IC_x,
    IC_y,
    antiSquatPercent,
    asSwingarmOnly,
    chainContribution,
    antiDivePercent,
    proSquat,
    proDive,
  };
}
