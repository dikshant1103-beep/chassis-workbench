/**
 * chassisDynamics.ts — Cossalter 2014 Chassis Dynamics Engine
 *
 * Implements geometry-derivable formulas from:
 *   Cossalter, V., Lot, R., Massaro, M. (2014). Motorcycle Dynamics, §1.1–1.5
 *
 * All units: SI (kg, m, N, Hz, s, rad/s) internally; converted at call sites.
 * See roadmap for excluded formulas requiring tyre data or full MBD.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─── Fork / Steering Axis ────────────────────────────────────────────────────

/**
 * Fork velocity ratio — Cossalter Eq 1.43
 * τ = 1 / cos(ε)
 * Ratio of fork axial velocity to wheel vertical velocity.
 * @param headAngle_deg  Head angle ε from vertical (°)
 */
export function computeForkVelocityRatio(headAngle_deg: number): number {
  const eps = headAngle_deg * DEG2RAD;
  return 1 / Math.cos(eps);
}

/**
 * Fork equivalent vertical stiffness — Cossalter Eq 1.44
 * k_z = k_L / cos²(ε)
 * @param k_L_Nmm     Fork spring rate along fork axis (N/mm)
 * @param headAngle_deg  Head angle ε (°)
 * @returns  k_z in N/mm
 */
export function computeForkEquivStiffness(k_L_Nmm: number, headAngle_deg: number): number {
  const cos_eps = Math.cos(headAngle_deg * DEG2RAD);
  return k_L_Nmm / (cos_eps * cos_eps);
}

/**
 * Fork equivalent vertical damping — Cossalter Eq 1.44 (same cosine transform)
 * c_z = c_L / cos²(ε)
 * @param c_L  Fork damping coeff along fork axis (N·s/mm)
 * @param headAngle_deg  Head angle ε (°)
 * @returns  c_z in N·s/mm
 */
export function computeForkEquivDamping(c_L: number, headAngle_deg: number): number {
  const cos_eps = Math.cos(headAngle_deg * DEG2RAD);
  return c_L / (cos_eps * cos_eps);
}

/**
 * Combined series spring + tyre rate — Cossalter Eq 1.47
 * k' = k_z · k_T / (k_z + k_T)
 * @param k_z_Nmm  Equivalent vertical spring rate (N/mm)
 * @param k_T_Nmm  Tyre vertical stiffness (N/mm)
 * @returns  k' in N/mm
 */
export function computeCombinedRate(k_z_Nmm: number, k_T_Nmm: number): number {
  return (k_z_Nmm * k_T_Nmm) / (k_z_Nmm + k_T_Nmm);
}

// ─── 2-DOF In-Plane Vibration — Cossalter §1.3 ──────────────────────────────

/**
 * 2-DOF half-vehicle natural frequencies — Cossalter Eq 1.48–1.49
 *
 * NOTE: The printed formula has a typo (k_T·m_u). Physically correct (verified
 * against the paper's own numerical example: f01=1.58Hz, f02=18.15Hz) is:
 *   a_1 = k_z(m_s + m_u) + k_T · m_s
 * See roadmap for derivation details.
 *
 * State: [z_s, z_u] — sprung mass displacement, unsprung mass displacement
 * M·z̈ + K·z = 0,  M = diag(m_s, m_u),  K = [[k_z, -k_z], [-k_z, k_z+k_T]]
 * Characteristic: a_2·λ² − a_1·λ + a_0 = 0,  λ = ω²
 *
 * @param k_z_Nmm  Equiv vertical spring rate (N/mm) — fork-axis spring projected
 * @param k_T_Nmm  Tyre vertical stiffness (N/mm)
 * @param m_s_kg   Sprung mass (kg) — half-vehicle front share
 * @param m_u_kg   Unsprung mass (kg) — wheel + fork lowers etc.
 * @returns  { bounce_Hz, hop_Hz } — bounce < 2 Hz, hop 10–20 Hz
 */
export function compute2DOFModes(
  k_z_Nmm: number,
  k_T_Nmm: number,
  m_s_kg: number,
  m_u_kg: number,
): { bounce_Hz: number; hop_Hz: number } {
  // Convert N/mm → N/m for SI
  const k_z = k_z_Nmm * 1000;
  const k_T = k_T_Nmm * 1000;

  const a2 = m_s_kg * m_u_kg;
  const a1 = k_z * (m_s_kg + m_u_kg) + k_T * m_s_kg;  // corrected formula
  const a0 = k_z * k_T;

  const disc = a1 * a1 - 4 * a2 * a0;
  if (disc < 0) return { bounce_Hz: NaN, hop_Hz: NaN };

  const sqrtDisc = Math.sqrt(disc);
  const omega1_sq = (a1 - sqrtDisc) / (2 * a2);
  const omega2_sq = (a1 + sqrtDisc) / (2 * a2);

  const bounce_Hz = Math.sqrt(Math.max(omega1_sq, 0)) / (2 * Math.PI);
  const hop_Hz    = Math.sqrt(Math.max(omega2_sq, 0)) / (2 * Math.PI);

  return { bounce_Hz, hop_Hz };
}

// ─── Steering Kinematics — Cossalter §1.1 ───────────────────────────────────

/**
 * Kinematic steering angle (handlebar → actual wheel steer) — Cossalter Eq 1.2
 * Δ = arctan(cos(ε) / cos(φ) · tan(δ))
 * @param delta_deg      Handlebar steer angle δ (°)
 * @param headAngle_deg  Head angle ε from vertical (°)
 * @param roll_deg       Roll angle φ (° from vertical)
 * @returns  Actual wheel steering angle Δ (°)
 */
export function computeKinematicSteeringAngle(
  delta_deg: number,
  headAngle_deg: number,
  roll_deg: number,
): number {
  const delta = delta_deg * DEG2RAD;
  const eps   = headAngle_deg * DEG2RAD;
  const phi   = roll_deg * DEG2RAD;
  const cos_phi = Math.cos(phi);
  if (Math.abs(cos_phi) < 1e-9) return NaN;
  return Math.atan((Math.cos(eps) / cos_phi) * Math.tan(delta)) * RAD2DEG;
}

/**
 * Turning curvature C = 1/R_c — Cossalter Eq 1.3
 * C = cos(ε) / (p · cos(φ)) · tan(δ)
 * where p = wheelbase
 * @param delta_deg      Handlebar steer δ (°)
 * @param headAngle_deg  Head angle ε (°)
 * @param roll_deg       Roll angle φ (°)
 * @param wheelbase_mm   Wheelbase p (mm)
 * @returns  Turning radius R_c (m), or Infinity when δ → 0
 */
export function computeTurningRadius(
  delta_deg: number,
  headAngle_deg: number,
  roll_deg: number,
  wheelbase_mm: number,
): number {
  const delta = delta_deg * DEG2RAD;
  const eps   = headAngle_deg * DEG2RAD;
  const phi   = roll_deg * DEG2RAD;
  const p_m   = wheelbase_mm / 1000;
  const cos_phi = Math.cos(phi);
  if (Math.abs(delta) < 1e-9 || Math.abs(cos_phi) < 1e-9) return Infinity;
  const C = (Math.cos(eps) / (p_m * cos_phi)) * Math.tan(delta);
  return Math.abs(C) < 1e-9 ? Infinity : 1 / Math.abs(C);
}

// ─── Roll Dynamics — Cossalter §1.4 ─────────────────────────────────────────

/**
 * Steady-state roll angle from speed + corner radius — Cossalter Eq 1.75
 * φ₀ = arctan(V² / (g · R_c))
 * @param speed_ms   Cornering speed V (m/s)
 * @param radius_m   Corner radius R_c (m)
 * @returns  Roll angle φ₀ (°) from vertical
 */
export function computeRollBasic(speed_ms: number, radius_m: number): number {
  if (radius_m <= 0) return NaN;
  return Math.atan((speed_ms * speed_ms) / (9.81 * radius_m)) * RAD2DEG;
}

/**
 * Roll correction for tyre section — Cossalter Eq 1.76
 * Δφ = arcsin(t · sin(φ₀) / (h − t))
 * where t = tyre section height, h = CoG height from ground
 * @param phi0_deg        Basic roll angle (°)
 * @param tyreSectionH_m  Tyre section height t (m) — aspectRatio × sectionWidth
 * @param cogHeight_m     CoG height h (m) from ground
 * @returns  Roll correction Δφ (°) — positive adds to φ₀
 */
export function computeRollCorrection(
  phi0_deg: number,
  tyreSectionH_m: number,
  cogHeight_m: number,
): number {
  const phi0 = phi0_deg * DEG2RAD;
  const denom = cogHeight_m - tyreSectionH_m;
  if (Math.abs(denom) < 1e-6) return NaN;
  const arg = (tyreSectionH_m * Math.sin(phi0)) / denom;
  if (Math.abs(arg) > 1) return NaN;
  return Math.asin(arg) * RAD2DEG;
}

/**
 * Combined roll equilibrium: φ_total = φ₀ + Δφ — Cossalter Eq 1.75–1.76
 */
export function computeRollEquilibrium(
  speed_ms: number,
  radius_m: number,
  cogHeight_m: number,
  tyreSectionH_m: number,
): { basic_deg: number; correction_deg: number; total_deg: number } {
  const basic_deg = computeRollBasic(speed_ms, radius_m);
  const correction_deg = computeRollCorrection(basic_deg, tyreSectionH_m, cogHeight_m);
  const total_deg = basic_deg + (isNaN(correction_deg) ? 0 : correction_deg);
  return { basic_deg, correction_deg: isNaN(correction_deg) ? 0 : correction_deg, total_deg };
}

// ─── Wheel Spin — Cossalter Eq 1.74 ─────────────────────────────────────────

/**
 * Wheel spin frequency — Cossalter Eq 1.74
 * f_w = V / (2π · R)
 * @param speed_ms    Forward speed V (m/s)
 * @param wheelRadius_m  Wheel radius R (m) — half of outer diameter
 * @returns  Spin frequency (Hz)
 */
export function computeWheelSpinFreq(speed_ms: number, wheelRadius_m: number): number {
  if (wheelRadius_m <= 0) return NaN;
  return speed_ms / (2 * Math.PI * wheelRadius_m);
}

// ─── Body Capsize — Cossalter Eq 1.84 ───────────────────────────────────────

/**
 * Body capsize time constant — Cossalter Eq 1.84
 * τ_bc = √((I_x + M·h²) / (M·g·h))
 * where I_x = roll moment of inertia about CoG axis
 * @param I_roll_kgm2  Roll inertia I_x (kg·m²)
 * @param totalMass_kg Total mass M (kg)
 * @param cogHeight_m  CoG height h (m)
 * @returns  Capsize time constant τ_bc (s). Larger → less tendency to fall.
 */
export function computeBodyCapsizeTC(
  I_roll_kgm2: number,
  totalMass_kg: number,
  cogHeight_m: number,
): number {
  const numerator   = I_roll_kgm2 + totalMass_kg * cogHeight_m * cogHeight_m;
  const denominator = totalMass_kg * 9.81 * cogHeight_m;
  if (denominator <= 0) return NaN;
  return Math.sqrt(numerator / denominator);
}

// ─── Sweep Generators ────────────────────────────────────────────────────────

/**
 * Steering angle sweep: Δ vs δ for given roll angles
 */
export function steeringAngleSweep(
  headAngle_deg: number,
  roll_deg: number,
  deltaRange: [number, number] = [0, 30],
  steps = 61,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const step = (deltaRange[1] - deltaRange[0]) / (steps - 1);
  for (let i = 0; i < steps; i++) {
    const delta = deltaRange[0] + i * step;
    pts.push({ x: delta, y: computeKinematicSteeringAngle(delta, headAngle_deg, roll_deg) });
  }
  return pts;
}

/**
 * Wheel spin frequency sweep: f_w vs speed (km/h)
 */
export function wheelSpinSweep(
  wheelRadius_m: number,
  speedRange_kmh: [number, number] = [0, 300],
  steps = 61,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const step = (speedRange_kmh[1] - speedRange_kmh[0]) / (steps - 1);
  for (let i = 0; i < steps; i++) {
    const v_kmh = speedRange_kmh[0] + i * step;
    const v_ms  = v_kmh / 3.6;
    pts.push({ x: v_kmh, y: computeWheelSpinFreq(v_ms, wheelRadius_m) });
  }
  return pts;
}

/**
 * Roll angle vs speed for a fixed corner radius
 */
export function rollVsSpeedSweep(
  radius_m: number,
  cogHeight_m: number,
  tyreSectionH_m: number,
  speedRange_kmh: [number, number] = [30, 200],
  steps = 60,
): Array<{ x: number; y: number; y2: number }> {
  const pts: Array<{ x: number; y: number; y2: number }> = [];
  const step = (speedRange_kmh[1] - speedRange_kmh[0]) / (steps - 1);
  for (let i = 0; i < steps; i++) {
    const v_kmh = speedRange_kmh[0] + i * step;
    const v_ms  = v_kmh / 3.6;
    const { basic_deg, total_deg } = computeRollEquilibrium(v_ms, radius_m, cogHeight_m, tyreSectionH_m);
    pts.push({ x: v_kmh, y: basic_deg, y2: total_deg });
  }
  return pts;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface ChassisDynamicsResult {
  // Fork
  forkVelocityRatio: number;         // τ = 1/cos(ε)
  forkEquivStiffness_Nmm: number;    // k_z N/mm
  forkEquivDamping_Nsmm: number;     // c_z N·s/mm
  combinedRate_Nmm: number;          // k' N/mm (front)
  // 2-DOF front
  frontBounce_Hz: number;
  frontHop_Hz: number;
  // Steering
  kinematicSteer_deg: number;        // Δ at current δ and φ
  turningRadius_m: number;           // R_c
  // Roll
  rollBasic_deg: number;             // φ₀
  rollCorrection_deg: number;        // Δφ
  rollTotal_deg: number;             // φ_total
  // Wheel spin
  frontSpinFreq_Hz: number;
  rearSpinFreq_Hz: number;
  // Capsize
  bodyCapsizeTC_s: number;
}

// ─── Aggregator ──────────────────────────────────────────────────────────────

export interface ChassisDynamicsInput {
  headAngle_deg: number;
  wheelbase_mm: number;
  // Fork spring rate along axis (N/mm) — motionRatio-corrected
  forkSpringRate_Nmm: number;
  // Fork damping coeff along axis (N·s/mm)
  forkDamping_Nsmm: number;
  // Front tyre stiffness (N/mm)
  frontTireStiffness_Nmm: number;
  // Sprung mass front half (kg)
  sprungMassFront_kg: number;
  // Front unsprung mass (kg)
  unsprungFront_kg: number;
  // CoG height from ground (m)
  cogHeight_m: number;
  // Total mass (kg)
  totalMass_kg: number;
  // Roll inertia I_roll (kg·m²)
  I_roll_kgm2: number;
  // Front wheel radius (m)
  frontWheelRadius_m: number;
  // Rear wheel radius (m)
  rearWheelRadius_m: number;
  // Front tyre section height (m) — aspectRatio × sectionWidth
  tyreSectionH_m: number;
  // Local panel inputs
  steerAngle_deg: number;            // δ — handlebar steer
  rollAngle_deg: number;             // φ — lean angle (from dynamics or manual)
  speed_ms: number;                  // V (m/s)
  cornerRadius_m: number;            // R_c (m)
}

export function computeChassisDynamics(inp: ChassisDynamicsInput): ChassisDynamicsResult {
  const k_z  = computeForkEquivStiffness(inp.forkSpringRate_Nmm, inp.headAngle_deg);
  const c_z  = computeForkEquivDamping(inp.forkDamping_Nsmm, inp.headAngle_deg);
  const k_prime = computeCombinedRate(k_z, inp.frontTireStiffness_Nmm);

  const { bounce_Hz: frontBounce_Hz, hop_Hz: frontHop_Hz } = compute2DOFModes(
    k_z,
    inp.frontTireStiffness_Nmm,
    inp.sprungMassFront_kg,
    inp.unsprungFront_kg,
  );

  const kinematicSteer_deg = computeKinematicSteeringAngle(
    inp.steerAngle_deg,
    inp.headAngle_deg,
    inp.rollAngle_deg,
  );
  const turningRadius_m = computeTurningRadius(
    inp.steerAngle_deg,
    inp.headAngle_deg,
    inp.rollAngle_deg,
    inp.wheelbase_mm,
  );

  const { basic_deg: rollBasic_deg, correction_deg: rollCorrection_deg, total_deg: rollTotal_deg }
    = computeRollEquilibrium(inp.speed_ms, inp.cornerRadius_m, inp.cogHeight_m, inp.tyreSectionH_m);

  const frontSpinFreq_Hz = computeWheelSpinFreq(inp.speed_ms, inp.frontWheelRadius_m);
  const rearSpinFreq_Hz  = computeWheelSpinFreq(inp.speed_ms, inp.rearWheelRadius_m);

  const bodyCapsizeTC_s = computeBodyCapsizeTC(inp.I_roll_kgm2, inp.totalMass_kg, inp.cogHeight_m);

  return {
    forkVelocityRatio: computeForkVelocityRatio(inp.headAngle_deg),
    forkEquivStiffness_Nmm: k_z,
    forkEquivDamping_Nsmm: c_z,
    combinedRate_Nmm: k_prime,
    frontBounce_Hz,
    frontHop_Hz,
    kinematicSteer_deg,
    turningRadius_m,
    rollBasic_deg,
    rollCorrection_deg,
    rollTotal_deg,
    frontSpinFreq_Hz,
    rearSpinFreq_Hz,
    bodyCapsizeTC_s,
  };
}
