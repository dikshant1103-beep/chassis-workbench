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
 * Computes the chain force angle of the TOP run from first principles.
 *
 * WHY THIS MATTERS:
 *   The Foale anti-squat method requires the LINE OF ACTION of the chain
 *   tension on the swingarm.  This is the external tangent to the two
 *   sprockets — NOT the center-to-center line.
 *
 *   Using the center-to-center angle is DEGENERATE because both the
 *   swingarm axis AND the center-to-center line already pass through the
 *   rear axle center, giving IC = rear axle → division-by-zero in AS%.
 *
 * GEOMETRY (external tangent, top run under forward acceleration):
 *   The top-run tangent is offset from the center-to-center line by:
 *     α = arcsin((r_rear − r_drive) / D)
 *   where D = center-to-center distance, r_rear > r_drive (typical).
 *
 *   θ_force = θ_geom + α
 *
 *   where θ_geom = atan2(H_cs − yc, X_cs − WB)  is the geometric angle
 *   from rear axle toward countershaft (both in rearward-positive coords).
 *
 * REALISTIC VALUES for 520-chain supermoto:
 *   Drive (countershaft) sprocket: 13–16 teeth → r ≈ 33–40 mm
 *   Rear sprocket: 42–52 teeth → r ≈ 107–132 mm
 *   Center-to-center D ≈ 600–750 mm
 *   α ≈ arcsin(~80/680) ≈ 6–8°
 *   The top run is nearly horizontal to slightly upward (−2° to +3°).
 *   Typical chainForceAngle to substitute: 0° to +4°.
 *
 * @param X_cs   Countershaft x from front axle (mm), rearward-positive
 * @param H_cs   Countershaft height above ground (mm)
 * @param X_ra   Rear axle x from front axle (mm) = wheelbase
 * @param H_ra   Rear axle height (= yc) (mm)
 * @param r_drive  Drive (countershaft) sprocket radius (mm)
 * @param r_rear   Rear sprocket radius (mm)
 * @returns Chain force angle of TOP run (degrees, positive = slopes upward toward rear)
 */
export function computeChainForceAngle(
  X_cs: number,
  H_cs: number,
  X_ra: number,
  H_ra: number,
  r_drive: number,
  r_rear: number,
): number {
  // Vector from rear axle to countershaft (rearward-positive X, upward-positive Y)
  const dx = X_cs - X_ra;   // negative (countershaft is forward of rear axle)
  const dy = H_cs - H_ra;   // typically positive (countershaft above rear axle)

  const D = Math.sqrt(dx * dx + dy * dy);  // center-to-center distance
  if (D < 1e-6) return 0;

  // Geometric angle: direction from rear axle toward countershaft
  const theta_geom = Math.atan2(dy, dx);   // radians, typically ~170° (pointing forward-up)

  // Offset for external tangent (top run)
  // r_rear > r_drive for typical bikes, so alpha > 0 → top run tilts upward from geom line
  const sinAlpha = (r_rear - r_drive) / D;
  const alpha = Math.abs(sinAlpha) <= 1
    ? Math.asin(sinAlpha)
    : Math.sign(sinAlpha) * Math.PI / 2;

  // Angle of the top-run tangent from rear axle toward countershaft direction.
  // theta_geom ≈ 170° for typical bikes (RA → CS points forward-up).
  // Adding alpha gives the tangent direction still in RA→CS sense.
  const theta_force_rad = theta_geom + alpha;

  // Convert to the DS→RA angle (chain running direction, forward→rearward):
  //   DS→RA = RA→CS angle − 180°
  //   Result is negative for typical bikes (chain slopes DOWNWARD going rearward). ✓
  return theta_force_rad * 180 / Math.PI - 180;   // degrees  [SIGN CORRECTED]
}

/**
 * Computes the chain-force angle using sprocket tooth counts and chain pitch.
 * Convenience wrapper for computeChainForceAngle() that takes teeth counts.
 *
 * @param frontTeeth   Countershaft (drive) sprocket teeth
 * @param rearTeeth    Rear sprocket teeth
 * @param chainPitch   Chain pitch (mm): 520 = 15.875 mm, 525 = 15.875 mm, 530 = 19.05 mm
 * @param X_cs, H_cs, X_ra, H_ra  Same as computeChainForceAngle()
 */
export function computeChainForceAngleFromTeeth(
  frontTeeth: number,
  rearTeeth: number,
  chainPitch: number,
  X_cs: number,
  H_cs: number,
  X_ra: number,
  H_ra: number,
): number {
  const r_drive = (frontTeeth * chainPitch) / (2 * Math.PI);
  const r_rear  = (rearTeeth  * chainPitch) / (2 * Math.PI);
  return computeChainForceAngle(X_cs, H_cs, X_ra, H_ra, r_drive, r_rear);
}

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
 * axis. The AS line from the rear contact patch (WB, 0) runs PARALLEL
 * to the swingarm. Its height at x = 0 (front contact patch vertical):
 *
 *   h = −tan(θ_sa) × WB
 *
 * θ_sa < 0 for typical bike (axle below pivot) → h > 0 → positive AS%.
 *
 * AS_swingarm_only = (−tan(θ_sa) × WB / Y_cg) × 100   ... Eq 8.9 (corrected)
 *
 * PREVIOUS (WRONG) formula used tan(θ_sa) × L_sa / Y_cg × 100:
 *   - Wrong parameter: used swingarm LENGTH instead of WHEELBASE
 *   - Wrong sign: gave negative result for all typical motorcycles (θ_sa < 0)
 *
 * @param swingarmAngleRad  θ_sa (rad) — negative for axle-below-pivot (typical)
 * @param wheelbase         WB (mm)
 * @param Y_cg              CoG height (mm)
 * @returns Swingarm-only anti-squat contribution (%) — positive for typical bikes
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
  _swingarmLength: number,  // kept for API compat; not used after Eq 8.9 correction
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

  // Eq 8.9 — swingarm-only contribution
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
    chainForceAngleAuto: chain.chainForceAngle,   // legacy path — angle was user-supplied
    isCVT: false,
    squatRatio: 0,  // populated from backend (legacy fn lacks X_cg for Cossalter formula)
  };
}

// ─────────────────────────────────────────────────────────
// UNIFIED ENGINE — single source of truth for all modules
// ─────────────────────────────────────────────────────────

const CHAIN_PITCH_UNIFIED = 15.875; // mm — 520 chain

/**
 * computeAntiSquatUnified — ONE implementation used by ALL panels.
 *
 * Key differences from legacy computeAntiSquat():
 *  1. Chain force angle is AUTO-COMPUTED from sprocket geometry (correct sign).
 *     chain.chainForceAngle is IGNORED for IC (it was only a bug-compensation hack).
 *  2. Swingarm angle uses geometric atan2(ΔY, ΔX) — not asin(ΔY/L_sa).
 *  3. CVT/belt-drive bikes (chain.isCVT) return IC = NaN, AS% = NaN.
 *
 * @param chain      ChainParams — sprocket positions and teeth counts
 * @param X_sp       Swingarm pivot X from front axle (mm, rearward-positive)
 * @param H_sp       Swingarm pivot height (mm)
 * @param WB         Wheelbase (mm) = rear axle X in old coords
 * @param H_ra       Rear axle height (mm)
 * @param Y_cg       CoG height from ground (mm)
 * @param headAngle_deg  Head angle from vertical (degrees)
 * @param R_front    Front static reaction (N) — for anti-dive
 * @param totalWeight  Total weight (N)
 */
export function computeAntiSquatUnified(
  chain: import('./types').ChainParams,
  X_sp: number,
  H_sp: number,
  WB: number,
  H_ra: number,
  Y_cg: number,
  headAngle_deg: number,
  R_front: number,
  totalWeight: number,
): import('./types').AntiSquatResults {
  const gearRatio = chain.rearSprocket / Math.max(chain.frontSprocket, 1);

  // ── Swingarm angle (geometric, correct for all L_sa values) ────────────────
  // atan2 uses actual pivot-to-axle vector, not the approximated asin(ΔY/L_sa)
  const swingarmAngleRad = Math.atan2(H_ra - H_sp, WB - X_sp);

  // ── Swingarm-only anti-squat (no chain contribution) ─────────────────────
  const asSwingarmOnly = Math.abs(Y_cg) > 1e-9
    ? (-Math.tan(swingarmAngleRad) * WB / Y_cg) * 100
    : 0;

  // ── Anti-dive ─────────────────────────────────────────────────────────────
  const antiDivePercent = Math.abs(totalWeight) > 1e-9
    ? Math.tan(headAngle_deg * DEG2RAD) * (R_front / totalWeight) * 100
    : 0;

  // ── CVT / belt-drive shortcut ──────────────────────────────────────────────
  if (chain.isCVT) {
    return {
      gearRatio,
      IC_x: NaN, IC_y: NaN,
      antiSquatPercent: NaN,
      asSwingarmOnly,
      chainContribution: NaN,
      antiDivePercent,
      proSquat: 0, proDive: Math.max(0, -antiDivePercent),
      chainForceAngleAuto: NaN,
      isCVT: true,
      squatRatio: 0,
    };
  }

  // ── Countershaft position (OLD coords: origin = front axle, +X rearward) ──
  const X_cs = X_sp + chain.sprocketCenterX;
  const H_cs = H_sp + chain.sprocketCenterY;

  // ── Auto-compute chain force angle from sprocket geometry ─────────────────
  // Uses corrected computeChainForceAngle() — result is negative for typical bikes
  // (chain slopes slightly downward going from countershaft toward rear sprocket).
  const r_drive = (chain.frontSprocket * CHAIN_PITCH_UNIFIED) / (2 * Math.PI);
  const r_rear  = (chain.rearSprocket  * CHAIN_PITCH_UNIFIED) / (2 * Math.PI);

  const chainForceAngleAuto = computeChainForceAngle(
    X_cs, H_cs, WB, H_ra, r_drive, r_rear,
  );

  // ── Exact upper-run tangent contact point on drive sprocket (OLD coords) ──
  // The chain force LINE OF ACTION passes through the point where the tension
  // run leaves the drive sprocket, NOT through the sprocket center.
  //
  // theta_force = (chainForceAngleAuto + 180) * DEG2RAD  — actual tangent direction
  // Perpendicular (90°CCW) points "below" the chain (into chain interior):
  //   perpX = −sin(theta_force),  perpY = cos(theta_force)
  // Upper (tension) contact point = center − r × perp  (away from interior)
  const thetaForce = (chainForceAngleAuto + 180) * DEG2RAD;
  const perpX = -Math.sin(thetaForce);
  const perpY =  Math.cos(thetaForce);
  const X_tan = X_cs - r_drive * perpX;   // upper tangent contact on DS
  const H_tan = H_cs - r_drive * perpY;

  // ── IC: intersection of swingarm extension and chain force line ───────────
  const m1 = Math.tan(swingarmAngleRad);
  const m2 = Math.tan(chainForceAngleAuto * DEG2RAD);

  let IC_x = NaN, IC_y = NaN;
  let antiSquatPercent = NaN;
  let chainContribution = NaN;

  if (Math.abs(m1 - m2) > 1e-9 && Math.abs(Y_cg) > 1e-9) {
    // y-intercepts of the two lines (both in old coords, at x=0):
    const b1 = H_sp  - m1 * X_sp;   // swingarm line y-intercept
    const b2 = H_tan - m2 * X_tan;  // chain force line through upper tangent contact point

    IC_x = (b2 - b1) / (m1 - m2);
    IC_y = m1 * IC_x + b1;

    // Foale graphical AS%: line from rear contact patch (WB, 0) through IC
    const denom = WB - IC_x;
    if (Math.abs(denom) > 1e-9) {
      const slope_AS = (0 - IC_y) / denom;
      const h_at_front = IC_y + slope_AS * (0 - IC_x);
      antiSquatPercent = (h_at_front / Y_cg) * 100;
      chainContribution = antiSquatPercent - asSwingarmOnly;
    }
  }

  const proSquat   = isFinite(antiSquatPercent) ? Math.max(0, -antiSquatPercent) : 0;
  const proDive    = Math.max(0, -antiDivePercent);

  return {
    gearRatio,
    IC_x, IC_y,
    antiSquatPercent,
    asSwingarmOnly,
    chainContribution,
    antiDivePercent,
    proSquat, proDive,
    chainForceAngleAuto,
    isCVT: false,
    squatRatio: 0,  // populated from backend; Cossalter formula needs X_cg (not in this fn)
  };
}
