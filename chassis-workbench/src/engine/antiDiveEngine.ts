/**
 * antiDiveEngine.ts — Anti-Dive & Load Transfer Physics Engine
 *
 * Implements formulas from:
 *   "Anti-Squat and Anti-Dive Characteristics in Motorcycles"
 *   Engineering-Grade Technical Reference Rev 1.0
 *   Sections 1.3, 1.5, 2.4, 2.6, 3, 6.4, 7.1, 9
 *
 * ALL LENGTHS: mm  |  ANGLES: degrees in API, radians internal  |  MASS: kg  |  FORCE: N
 */

const DEG2RAD = Math.PI / 180;
const G = 9.81; // m/s²

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1.3 — Longitudinal Load Transfer
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadTransferResult {
  /** Static front axle load (N) — moments about rear axle */
  W_front_static: number;
  /** Static rear axle load (N) — moments about front axle */
  W_rear_static: number;
  /** Load transfer at given acceleration g (N, positive = rearward) */
  deltaW_accel: number;
  /** Dynamic rear load under acceleration (N) */
  W_rear_dynamic: number;
  /** Dynamic front load under braking (N) */
  W_front_brake: number;
  /** Dynamic rear load under braking (N) */
  W_rear_brake: number;
  /** Load transfer line angle from rear CP (rad) — used for AS% geometry */
  theta_LT_rear: number;
  /** Load transfer at multiple g levels for table display */
  gLevels: { g: number; deltaW: number; W_rear: number; W_front_brake: number }[];
}

/**
 * Compute full load transfer analysis (PDF §1.3).
 *
 * Coordinate note: X_cg measured from FRONT axle toward rear.
 *   a (PDF) = rear axle → CoG = wheelbase − X_cg
 *   b (PDF) = front axle → CoG = X_cg
 *
 * Static distribution moments:
 *   W_front = M·g·a/L   (a = rear→CoG, so W_front is larger when CoG is rearward)
 *   W_rear  = M·g·b/L
 *
 * @param M         Total mass (kg)
 * @param wheelbase Wheelbase (mm)
 * @param X_cg      CoG x from front axle (mm)
 * @param Y_cg      CoG height from ground (mm)
 * @param accel_g   Acceleration (g) for primary row
 * @param brake_g   Braking deceleration (g) for primary row
 */
export function computeLoadTransfer(
  M: number,
  wheelbase: number,
  X_cg: number,
  Y_cg: number,
  accel_g: number,
  brake_g: number,
): LoadTransferResult {
  const WB = wheelbase;           // mm
  const a_mm = WB - X_cg;        // rear axle → CoG (mm)
  const W_total = M * G;          // N

  // Static distribution (PDF §1.3)
  const W_front_static = W_total * (a_mm / WB);
  const W_rear_static  = W_total * (X_cg / WB);

  // ΔW = M × a_g × g × h_CoG / L  (mm/mm cancel)
  const kLT = M * G * Y_cg / WB; // N/g — load transfer constant

  const deltaW_accel = kLT * accel_g;
  const deltaW_brake = kLT * brake_g;

  const W_rear_dynamic   = W_rear_static  + deltaW_accel;
  const W_front_brake    = W_front_static + deltaW_brake;
  const W_rear_brake     = W_rear_static  - deltaW_brake;

  // Load transfer line angle from REAR contact patch: tan(θ) = h_CoG / x_CoG_from_rear
  const x_CoG_from_rear = a_mm; // mm
  const theta_LT_rear = Math.atan2(Y_cg, x_CoG_from_rear);

  // Multi-g table rows (PDF §3 sensitivity reference)
  const gLevels = [0.3, 0.5, 0.8, 1.0, 1.2].map(g => ({
    g,
    deltaW:       kLT * g,
    W_rear:       W_rear_static  + kLT * g,
    W_front_brake: W_front_static + kLT * g,
  }));

  return {
    W_front_static, W_rear_static,
    deltaW_accel, W_rear_dynamic,
    W_front_brake, W_rear_brake,
    theta_LT_rear,
    gLevels,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2.6 — Anti-Dive Geometric Construction (Telescopic Fork)
// ─────────────────────────────────────────────────────────────────────────────

export interface AntiDiveResult {
  /** Geometric AD% for telescopic (PDF §2.6): tan(rake) / tan(θ_front_LT) × 100 */
  ad_geometric_pct: number;
  /** Practical effective AD% (5-20% due to friction losses — PDF §2.6) */
  ad_effective_pct: number;
  /** Front load transfer line angle from front CP (rad) */
  theta_front_LT: number;
  /** Rake angle in radians */
  theta_rake: number;
  /** Height of fork axis extension at rear axle vertical (mm) */
  h_fork_at_rear: number;
  /** Height of front load transfer line at rear axle vertical (mm) */
  h_LT_at_rear: number;
  /** Fork dive under braking (mm) — from PDF §9.5 rule: 1 N/mm spring rate = 8-12mm dive per 1g */
  fork_dive_mm: number;
}

/**
 * Geometric anti-dive analysis for telescopic front fork (PDF §2.6).
 *
 * The fork IC is at infinity along the fork axis.
 * Force line = fork axis direction = angle "rake" from vertical.
 *
 * Comparison is made at the FRONT AXLE VERTICAL (x=0 from front CP):
 *   Wait — PDF says "rear axle vertical" for the intersection reference.
 *   Actually §2.5: AS% uses the FRONT axle vertical as reference.
 *   For AD%, §2.6 uses: compare fork axis line vs front LT line at "rear axle vertical".
 *   AD% = tan(rake) / tan(θ_front_LT) × 100  [dimensionless ratio]
 *
 * @param rake_deg      Head angle from vertical (degrees)
 * @param h_CoG         CoG height from ground (mm)
 * @param X_cg          CoG x from front axle (mm)
 * @param wheelbase     Wheelbase (mm)
 * @param spring_front  Front spring rate (N/mm)
 * @param M_total       Total mass (kg)
 * @param brake_g       Braking deceleration (g)
 */
export function computeAntiDive(
  rake_deg: number,
  h_CoG: number,
  X_cg: number,
  wheelbase: number,
  spring_front: number,
  M_total: number,
  brake_g: number,
): AntiDiveResult {
  const theta_rake     = rake_deg * DEG2RAD;
  // Front LT line: from front CP (0,0) to CoG at (X_cg, h_CoG)
  const theta_front_LT = Math.atan2(h_CoG, X_cg);  // angle from front CP

  const tan_rake     = Math.tan(theta_rake);
  const tan_front_LT = Math.tan(theta_front_LT);

  // AD% (geometric, telescopic) — PDF §2.6
  const ad_geometric_pct = Math.abs(tan_front_LT) > 1e-9
    ? (tan_rake / tan_front_LT) * 100
    : 0;

  // Effective practical AD% (PDF §2.6: "5-20% for standard USD telescopics")
  // Friction losses reduce geometric to ~15-30% of theoretical
  const ad_effective_pct = Math.min(ad_geometric_pct * 0.25, 22);

  // Heights at rear axle vertical (for SVG visualization)
  const h_fork_at_rear = tan_rake * wheelbase;         // fork axis extended to WB
  const h_LT_at_rear   = (h_CoG / X_cg) * wheelbase;  // LT line extended to WB

  // Fork dive under braking (PDF §9.5: 1 N/mm spring = 8-12 mm dive per 1g)
  // ΔF_front = M × brake_g × g × h_CoG / WB (N load transfer)
  const deltaF_front = M_total * brake_g * G * (h_CoG / 1000) / (wheelbase / 1000);
  // Dive = ΔF / k_front (simplified, no geometric AD effect)
  const fork_dive_mm = spring_front > 0 ? deltaF_front / spring_front : 0;

  return {
    ad_geometric_pct,
    ad_effective_pct,
    theta_front_LT,
    theta_rake,
    h_fork_at_rear,
    h_LT_at_rear,
    fork_dive_mm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7.1 — Anti-Squat at Lean (Corner Exit)
// ─────────────────────────────────────────────────────────────────────────────

export interface LeanAnalysisPoint {
  lean_deg: number;
  L_effective_mm: number;
  h_CoG_effective_mm: number;
  AS_effective_pct: number;
  jackup_risk: 'None' | 'Low' | 'Moderate' | 'High' | 'Very High';
}

/**
 * Compute AS% at lean angle sweep (PDF §7.1).
 *
 * AS%_effective = AS%_upright / cos(φ)
 * (force line height is unchanged, load transfer line height reduces by cos(φ))
 *
 * @param AS_upright    Anti-squat % at upright position
 * @param wheelbase     Wheelbase (mm)
 * @param h_CoG         CoG height (mm)
 */
export function computeLeanSweep(
  AS_upright: number,
  wheelbase: number,
  h_CoG: number,
): LeanAnalysisPoint[] {
  return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(lean_deg => {
    const phi = lean_deg * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const L_effective_mm   = wheelbase * cosPhi;
    const h_CoG_effective_mm = h_CoG * cosPhi;
    const AS_effective_pct = cosPhi > 1e-9 ? AS_upright / cosPhi : AS_upright;

    let jackup_risk: LeanAnalysisPoint['jackup_risk'] = 'None';
    if (AS_effective_pct > 130)     jackup_risk = 'Very High';
    else if (AS_effective_pct > 115) jackup_risk = 'High';
    else if (AS_effective_pct > 105) jackup_risk = 'Moderate';
    else if (AS_effective_pct > 100) jackup_risk = 'Low';

    return { lean_deg, L_effective_mm, h_CoG_effective_mm, AS_effective_pct, jackup_risk };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6.4 — Chain Tension & Structural Loads
// ─────────────────────────────────────────────────────────────────────────────

export interface ChainLoadResult {
  /** Chain tension (N) */
  T_chain: number;
  /** Bearing radial load at pivot (N) */
  F_bearing: number;
  /** Swingarm bending moment (N·mm) */
  M_bending: number;
  /** Peak bending stress at pivot (MPa) — for aluminum hollow rectangular (I ≈ 20000 mm⁴, c = 30mm) */
  sigma_bending: number;
}

/**
 * Chain load and swingarm structural analysis (PDF §6.1, §6.4).
 *
 * T_chain = T_engine × GR / r_CSP
 * M_bending ≈ W_rear_dynamic × L_sw / 2  (simplified uniform distribution)
 *
 * @param T_engine_Nm   Engine peak torque (N·m)
 * @param GR            Overall gear ratio (dimensionless)
 * @param r_CSP_mm      Countershaft sprocket pitch radius (mm)
 * @param W_rear_dyn    Dynamic rear axle load under acceleration (N)
 * @param L_sw_mm       Swingarm length (mm)
 * @param chain_angle_deg  Chain force angle from horizontal (deg)
 */
export function computeChainLoads(
  T_engine_Nm: number,
  GR: number,
  r_CSP_mm: number,
  W_rear_dyn: number,
  L_sw_mm: number,
  chain_angle_deg: number,
): ChainLoadResult {
  // T_chain = T_engine × GR / r_CSP  (N·m / m = N)
  const T_chain = r_CSP_mm > 0 ? T_engine_Nm * GR / (r_CSP_mm / 1000) : 0;

  // Bearing radial load: perpendicular component of chain tension on pivot bearing
  const theta_chain = Math.abs(chain_angle_deg) * DEG2RAD;
  const F_bearing = T_chain * Math.sin(theta_chain);

  // Swingarm bending: cantilever beam, load at axle (PDF §6.1 simplified)
  const M_bending = W_rear_dyn * (L_sw_mm / 2);  // N·mm (force × half-length)

  // Bending stress (aluminum hollow rectangular section, PDF §6.1 typical values)
  // I ≈ 20,000 mm⁴ (hollow rectangular), c = 30 mm (outer fiber distance)
  const I_sw = 20000;  // mm⁴
  const c_sw = 30;     // mm
  const sigma_bending = (M_bending * c_sw) / I_sw;  // MPa = N/mm²

  return { T_chain, F_bearing, M_bending, sigma_bending };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9.1 — Design Target Classification
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignTarget {
  category: string;
  targetMin: number;
  targetMax: number;
  description: string;
  inRange: boolean;
  deviation: number;  // % below min or above max; 0 if in range
}

export interface ICZoneCheck {
  h_IC_pct_of_CoG: number;           // IC height as % of h_CoG
  x_IC_mm_forward_of_rear: number;   // IC horizontal position (mm forward of rear axle)
  sport_h_ok: boolean;               // 55-70% for sport
  sport_x_ok: boolean;               // 250-450mm for sport
  naked_h_ok: boolean;               // 45-60% for naked
  naked_x_ok: boolean;               // 200-380mm for naked
}

const DESIGN_TARGETS = [
  { category: 'MotoGP / WSBK Race',      targetMin: 100, targetMax: 115, description: 'Maximum traction, electronics-managed jackup' },
  { category: 'Track Day / Homologated', targetMin: 90,  targetMax: 105, description: 'High traction, minimal jackup on clean tarmac' },
  { category: 'Sport Bike (Road)',        targetMin: 85,  targetMax: 100, description: 'Balanced performance and compliance' },
  { category: 'Performance Naked',       targetMin: 80,  targetMax: 92,  description: 'Street performance with comfort' },
  { category: 'Standard Naked / Roadster',targetMin: 70, targetMax: 85,  description: 'Comfort priority, accessible feel' },
  { category: 'Touring / Adventure',     targetMin: 60,  targetMax: 80,  description: 'Luggage load sensitivity, long-distance comfort' },
];

/**
 * Classify bike against design targets (PDF §9.1).
 */
export function classifyDesignTarget(AS_pct: number): DesignTarget & { allTargets: typeof DESIGN_TARGETS } {
  // Find best matching category (smallest range containing the value, or closest)
  let best = DESIGN_TARGETS[0];
  let bestDev = Infinity;

  for (const t of DESIGN_TARGETS) {
    if (AS_pct >= t.targetMin && AS_pct <= t.targetMax) {
      // In range — prefer the "best fit" (smallest range midpoint distance)
      const dev = Math.abs(AS_pct - (t.targetMin + t.targetMax) / 2);
      if (dev < bestDev) { best = t; bestDev = dev; }
    }
  }
  if (bestDev === Infinity) {
    // Not in any range — find closest
    for (const t of DESIGN_TARGETS) {
      const dev = AS_pct < t.targetMin ? t.targetMin - AS_pct : AS_pct - t.targetMax;
      if (dev < bestDev) { best = t; bestDev = dev; }
    }
  }

  const inRange = AS_pct >= best.targetMin && AS_pct <= best.targetMax;
  const deviation = inRange ? 0
    : AS_pct < best.targetMin ? AS_pct - best.targetMin   // negative = below target
    : AS_pct - best.targetMax;                             // positive = above target

  return { ...best, inRange, deviation, allTargets: DESIGN_TARGETS };
}

/**
 * IC placement zone assessment (PDF §9.3).
 *
 * @param IC_x      IC x from front axle (mm, rearward-positive)
 * @param IC_y      IC y from ground (mm)
 * @param wheelbase Wheelbase (mm)
 * @param h_CoG     CoG height (mm)
 */
export function checkICZone(
  IC_x: number,
  IC_y: number,
  wheelbase: number,
  h_CoG: number,
): ICZoneCheck {
  const h_IC_pct_of_CoG = h_CoG > 0 ? (IC_y / h_CoG) * 100 : 0;
  // IC horizontal: distance forward of rear axle = wheelbase - IC_x (since IC_x is from front)
  const x_IC_mm_forward_of_rear = wheelbase - IC_x;

  return {
    h_IC_pct_of_CoG,
    x_IC_mm_forward_of_rear,
    sport_h_ok: h_IC_pct_of_CoG >= 55 && h_IC_pct_of_CoG <= 70,
    sport_x_ok: x_IC_mm_forward_of_rear >= 250 && x_IC_mm_forward_of_rear <= 450,
    naked_h_ok: h_IC_pct_of_CoG >= 45 && h_IC_pct_of_CoG <= 60,
    naked_x_ok: x_IC_mm_forward_of_rear >= 200 && x_IC_mm_forward_of_rear <= 380,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Parametric Sensitivity (PDF §3.1–3.8)
// ─────────────────────────────────────────────────────────────────────────────

export interface SensitivityRow {
  parameter: string;
  change: string;
  delta_AS_pct: string;
  delta_AD_pct: string;
  effect: string;
}

/**
 * Build parametric sensitivity table from PDF §3 data.
 * Uses the reference values from the document's baseline bike (M=220kg, h_CoG=620mm, L=1400mm).
 */
export function buildSensitivityTable(
  AS_pct: number,
  h_CoG: number,
  _wheelbase: number,
  _swingarmAngle_deg: number,
): SensitivityRow[] {
  // Sensitivity per PDF §3 (approximate, geometry-dependent):
  // +1° swingarm angle → +4–6% AS%
  // +10mm CSP height → +4–7% AS%
  // +10mm rear axle height → +5–8% AS%
  // +50mm wheelbase → AS% slightly increases but load transfer decreases 3.4%
  // +50mm h_CoG → AS% decreases ~8% (from §3.6 formula: AS%_new = AS%_old × h_old/h_new)
  // Rake ±4° → AD% changes ~20% of geometric

  const h_CoG_new = h_CoG + 50;
  const AS_delta_hCoG = AS_pct * (h_CoG / h_CoG_new) - AS_pct; // negative

  return [
    {
      parameter: 'Swingarm Angle',
      change: '+1°',
      delta_AS_pct: '+4 to +6%',
      delta_AD_pct: '—',
      effect: 'Raises IC → higher AS%',
    },
    {
      parameter: 'Countershaft Height',
      change: '+10 mm',
      delta_AS_pct: '+4 to +7%',
      delta_AD_pct: '—',
      effect: 'Steeper chain line → raises IC',
    },
    {
      parameter: 'Rear Axle Height',
      change: '+10 mm',
      delta_AS_pct: '+5 to +8%',
      delta_AD_pct: '—',
      effect: 'Raises swingarm → IC rises',
    },
    {
      parameter: 'Wheelbase',
      change: '+50 mm',
      delta_AS_pct: '+1 to +2%',
      delta_AD_pct: 'Slight ↓',
      effect: 'Load transfer −3.4%; force line longer',
    },
    {
      parameter: 'CoG Height (h_CoG)',
      change: '+50 mm',
      delta_AS_pct: `${AS_delta_hCoG.toFixed(1)}%`,
      delta_AD_pct: 'Increases AD',
      effect: `AS% × ${(h_CoG / h_CoG_new).toFixed(3)} (${((h_CoG / h_CoG_new - 1) * 100).toFixed(1)}%)`,
    },
    {
      parameter: 'Rake Angle',
      change: '+1°',
      delta_AS_pct: 'Minimal',
      delta_AD_pct: '+3 to +5%',
      effect: 'AD geometric potential increases; actual still low (friction)',
    },
    {
      parameter: 'Sprocket Ratio +1T Front',
      change: '−1 tooth rear',
      delta_AS_pct: '+3 to +5%',
      delta_AD_pct: '—',
      effect: 'Chain line angle shifts → IC moves',
    },
  ];
}
