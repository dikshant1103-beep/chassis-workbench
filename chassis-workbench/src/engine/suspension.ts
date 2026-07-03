/**
 * suspension.ts — Suspension Dynamics Engine
 *
 * Implements Equations 7.1–7.15 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 8–9.
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 5.
 *   SAE J1168 — Motorcycle Terminology
 *
 * UNIT CONVENTIONS:
 *   Spring rate   : N/mm
 *   Wheel rate    : N/mm
 *   Natural freq  : Hz
 *   Mass          : kg
 *   Force         : N
 *   Critical damp : N·s/m  (converted from N/mm base units internally)
 *   Damping ratio : dimensionless (0–1)
 *
 * NOTE ON DAMPING (Eq 7.12–7.14):
 *   Critical damping C_critical = 2 × √(k × m)
 *   With k in N/m (= WR × 1000) and m in kg:
 *   √(N/m × kg) = √(kg²/s²) = kg/s = N·s/m
 *   So C_critical_front is in N·s/m. The normalised ratio (Eq 7.14)
 *   uses C_max_clicks = 30 (the upper bound of the 0–30 click range
 *   stated in Section 7.1 input parameters).
 */

import { SuspensionParams, SuspensionResults } from './types';
import { G } from './cog';

const C_MAX_CLICKS = 30; // maximum damping clicks per spec Section 7.1

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes wheel rate (effective spring rate at the tyre contact patch).
 *
 * The motion ratio MR is the mechanical advantage of the linkage:
 *   MR = wheel displacement / spring displacement
 *
 * For telescopic forks MR_f ≈ 1.0 (fork spring = wheel travel).
 * For Pro-Link / Uni-Trak linkage rear: MR_r ≈ 0.55–0.85.
 *
 * Wheel Rate = k × MR²                        ... Eq 7.1 / 7.2
 *
 * The MR² factor comes from the energy equivalence derivation:
 * ½·k_wheel·x_wheel² = ½·k_spring·x_spring² and x_spring = MR·x_wheel
 *
 * @param springRate  Spring rate k (N/mm)
 * @param motionRatio MR (dimensionless)
 * @returns Wheel rate in N/mm
 */
export function computeWheelRate(
  springRate: number,
  motionRatio: number,
): number {
  // Eq 7.1 / 7.2
  return springRate * motionRatio * motionRatio;
}

/**
 * Computes sprung mass distribution across axles.
 *
 * Sprung mass = total mass − unsprung front − unsprung rear   ... Eq 7.5
 *
 * Front and rear sprung masses are the total axle load minus the
 * unsprung mass at that axle:
 *
 * m_sprung_front = m_total × (WB − X_cg) / WB − m_u_front    ... Eq 7.6
 * m_sprung_rear  = m_total × X_cg / WB − m_u_rear            ... Eq 7.7
 *
 * @param totalMass    Total vehicle + rider + payload mass (kg)
 * @param unsprungF    Front unsprung mass (kg)
 * @param unsprungR    Rear unsprung mass (kg)
 * @param X_cg         CoG distance from front axle (mm)
 * @param wheelbase    WB (mm)
 * @returns Sprung masses in kg
 * @throws  RangeError if wheelbase is zero
 */
export function computeSprungMasses(
  totalMass: number,
  unsprungF: number,
  unsprungR: number,
  X_cg: number,
  wheelbase: number,
): { sprungMass: number; sprungMassFront: number; sprungMassRear: number } {
  if (Math.abs(wheelbase) < 1e-9) {
    throw new RangeError('computeSprungMasses: wheelbase cannot be zero.');
  }

  const sprungMass = totalMass - unsprungF - unsprungR; // Eq 7.5

  // Eq 7.6 — front axle total load minus front unsprung mass
  const sprungMassFront = totalMass * (wheelbase - X_cg) / wheelbase - unsprungF;

  // Eq 7.7 — rear axle total load minus rear unsprung mass
  const sprungMassRear = totalMass * X_cg / wheelbase - unsprungR;

  return { sprungMass, sprungMassFront, sprungMassRear };
}

/**
 * Computes natural (undamped) oscillation frequency of the suspension.
 *
 * f_n = (1 / 2π) × √(WR × 1000 / m_sprung)   ... Eq 7.3 / 7.4
 *
 * The factor 1000 converts WR from N/mm to N/m so that √(N/m ÷ kg)
 * gives rad/s, divided by 2π yields Hz.
 *
 * Target ranges (Foale Ch. 9):
 *   Front fork  : 0.8–1.5 Hz (comfortable street)
 *   Rear shock  : 1.5–3.5 Hz (rear is stiffer due to linkage ratio)
 *
 * @param wheelRate    WR (N/mm)
 * @param sprungMass   m_sprung for this axle (kg)
 * @returns Natural frequency (Hz)
 * @throws  RangeError if sprungMass ≤ 0
 */
export function computeNaturalFrequency(
  wheelRate: number,
  sprungMass: number,
): number {
  if (sprungMass < 1e-9) {
    throw new RangeError(
      `computeNaturalFrequency: sprungMass must be > 0 (got ${sprungMass} kg).`,
    );
  }
  // Eq 7.3 / 7.4 — convert N/mm to N/m via × 1000
  return (1 / (2 * Math.PI)) * Math.sqrt((wheelRate * 1000) / sprungMass);
}

/**
 * Computes the spring force required to support the sprung mass at
 * the specified sag with the given preload.
 *
 * F_sag = k × (sag + preload)                 ... Eq 7.8 / 7.9
 *
 * This is the static spring force at ride height. It can be compared
 * against the static axle load to verify the spring rate is appropriate.
 *
 * @param springRate  k (N/mm)
 * @param sag         Static sag (mm)
 * @param preload     Spring preload (mm)
 * @returns Spring force at sag (N)
 */
export function computeSagForce(
  springRate: number,
  sag: number,
  preload: number,
): number {
  // Eq 7.8 / 7.9
  return springRate * (sag + preload);
}

/**
 * Computes sag as a percentage of total suspension travel.
 *
 * Sag% = (sag / travel) × 100                 ... Eq 7.10 / 7.11
 *
 * Target: 25–33% for street, 28–35% for track.
 * < 20% → too much preload or too stiff a spring.
 * > 35% → too soft or too little preload.
 *
 * @param sag     Static sag (mm)
 * @param travel  Total suspension travel (mm)
 * @returns Sag as percentage (%)
 */
export function computeSagPercent(sag: number, travel: number): number {
  if (Math.abs(travel) < 1e-9) {
    throw new RangeError('computeSagPercent: travel cannot be zero.');
  }
  // Eq 7.10 / 7.11
  return (sag / travel) * 100;
}

/**
 * Computes the critical damping coefficient.
 *
 * C_critical = 2 × √(WR × 1000 × m_sprung)   ... Eq 7.12 / 7.13
 *
 * With WR in N/mm, the product WR × 1000 gives N/m.
 * √(N/m × kg) = √(kg²/s²) = kg/s = N·s/m
 * So C_critical is in N·s/m.
 *
 * Full damping characterisation requires dyno data; this gives the
 * theoretical critical value for ζ = 1.0 (critically damped).
 *
 * @param wheelRate   WR (N/mm)
 * @param sprungMass  m_sprung (kg)
 * @returns Critical damping coefficient (N·s/m)
 */
export function computeCriticalDamping(
  wheelRate: number,
  sprungMass: number,
): number {
  // Eq 7.12 / 7.13 — note: result is N·s/m not N·s/mm
  return 2 * Math.sqrt(wheelRate * 1000 * sprungMass);
}

/**
 * Computes normalised compression damping ratio from click setting.
 *
 * ζ_comp = C_comp / C_max_clicks              ... Eq 7.14
 *
 * This is a dimensionless ratio (0–1) giving the relative damping
 * position within the adjuster range. C_max_clicks = 30 per spec.
 * The actual damping force in N·s/m requires dyno characterisation.
 *
 * @param compClicks  Compression damping setting (clicks, 0–30)
 * @returns Normalised ratio (0–1)
 */
export function computeDampingRatio(compClicks: number): number {
  // Eq 7.14
  return compClicks / C_MAX_CLICKS;
}

/**
 * Estimates dynamic load transfer at 0.8g braking deceleration.
 *
 * ΔW = m_total × a × Y_cg / WB                ... Eq 7.15
 *
 * With a = 0.8 × 9.81 = 7.848 m/s² (0.8g hard braking),
 * Y_cg and WB both in mm (ratio is dimensionless), m_total in kg:
 * ΔW [N] = m × a × (Y_cg/WB)
 *
 * This load transfers from rear to front tyre. At 1.0g braking the
 * front may carry 85–95% of total weight (Foale Ch. 5).
 *
 * @param totalMass  m_total (kg)
 * @param Y_cg       CoG height from ground (mm)
 * @param wheelbase  WB (mm)
 * @returns Load transfer magnitude (N), positive = front gains load
 */
export function computeLoadTransfer08g(
  totalMass: number,
  Y_cg: number,
  wheelbase: number,
): number {
  if (Math.abs(wheelbase) < 1e-9) {
    throw new RangeError('computeLoadTransfer08g: wheelbase cannot be zero.');
  }
  const a = 0.8 * G; // 0.8g deceleration [m/s²]
  // Eq 7.15 — Y_cg/WB is dimensionless (both mm), so units are [kg × m/s² = N]
  return totalMass * a * Y_cg / wheelbase;
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Full suspension computation — aggregates Eq 7.1 through 7.15.
 *
 * @param p         SuspensionParams
 * @param totalMass Total system mass (kg)
 * @param X_cg      CoG x-position from front axle (mm)
 * @param Y_cg      CoG height from ground (mm)
 * @param wheelbase WB (mm)
 * @returns SuspensionResults
 */
export function computeSuspension(
  p: SuspensionParams,
  totalMass: number,
  X_cg: number,
  Y_cg: number,
  wheelbase: number,
): SuspensionResults {
  // Wheel rates — Eq 7.1 / 7.2
  const wheelRateFront = computeWheelRate(p.springRateFront, p.motionRatioFront);
  const wheelRateRear = computeWheelRate(p.springRateRear, p.motionRatioRear);

  // Sprung masses — Eq 7.5 / 7.6 / 7.7
  const { sprungMass, sprungMassFront, sprungMassRear } = computeSprungMasses(
    totalMass, p.unsprungFront, p.unsprungRear, X_cg, wheelbase,
  );

  // Natural frequencies — Eq 7.3 / 7.4
  const natFreqFront = computeNaturalFrequency(wheelRateFront, sprungMassFront);
  const natFreqRear = computeNaturalFrequency(wheelRateRear, sprungMassRear);

  // Spring force at sag — Eq 7.8 / 7.9
  const sagForceFront = computeSagForce(p.springRateFront, p.sagFront, p.preloadFront);
  const sagForceRear = computeSagForce(p.springRateRear, p.sagRear, p.preloadRear);

  // Sag percentages — Eq 7.10 / 7.11
  const sagPercentFront = computeSagPercent(p.sagFront, p.forkTravel);
  const sagPercentRear = computeSagPercent(p.sagRear, p.shockTravel);

  // Critical damping — Eq 7.12 / 7.13  (N·s/m from N/mm wheel rate)
  const criticalDampingFront = computeCriticalDamping(wheelRateFront, sprungMassFront);
  const criticalDampingRear  = computeCriticalDamping(wheelRateRear,  sprungMassRear);

  // Normalised damping ratio from adjuster clicks — Eq 7.14
  const dampingRatioComp = computeDampingRatio(p.compDamping);

  // True damping ratios from actual damping coefficients (Cossalter Ch.5 Eq 5.12/5.13)
  // ζ = c / c_crit.  c is in N·s/mm, c_crit is in N·s/m → convert: c_crit_Nsm / 1000 = N·s/mm
  const c_critF_Nsmm = criticalDampingFront / 1000;   // N·s/m → N·s/mm
  const c_critR_Nsmm = criticalDampingRear  / 1000;
  const c_f = p.dampingCoeffFront ?? 0;
  const c_r = p.dampingCoeffRear  ?? 0;
  const dampingRatioFront = c_critF_Nsmm > 0 ? c_f / c_critF_Nsmm : 0;
  const dampingRatioRear  = c_critR_Nsmm > 0 ? c_r / c_critR_Nsmm : 0;

  // Optimal damping coefficients (target ζ = 0.65 — road-sport compromise, Cossalter Ch.5)
  const ZETA_TARGET = 0.65;
  const optimalDampingFront = ZETA_TARGET * c_critF_Nsmm;   // N·s/mm
  const optimalDampingRear  = ZETA_TARGET * c_critR_Nsmm;

  // Unsprung mass resonance (wheel-hop) frequency — Cossalter Ch.5 Eq 5.18
  // ν_u = (1/2π) × √((k_tyre + k_wheel) / m_u)
  // k_wheel = wheelRate (N/mm), k_tyre from TireParams (not available here; use typical 120 N/mm)
  const K_TYRE_DEFAULT = 120;  // N/mm — typical road tyre vertical stiffness
  const unsprungFreqFront = (1 / (2 * Math.PI)) *
    Math.sqrt(((wheelRateFront + K_TYRE_DEFAULT) * 1000) / p.unsprungFront);
  const unsprungFreqRear  = (1 / (2 * Math.PI)) *
    Math.sqrt(((wheelRateRear  + K_TYRE_DEFAULT) * 1000) / p.unsprungRear);

  // Load transfer at 0.8g — Eq 7.15
  const loadTransfer08g = computeLoadTransfer08g(totalMass, Y_cg, wheelbase);

  return {
    wheelRateFront,
    wheelRateRear,
    natFreqFront,
    natFreqRear,
    sprungMass,
    sprungMassFront,
    sprungMassRear,
    sagForceFront,
    sagForceRear,
    sagPercentFront,
    sagPercentRear,
    criticalDampingFront,
    criticalDampingRear,
    dampingRatioComp,
    loadTransfer08g,
    dampingRatioFront,
    dampingRatioRear,
    optimalDampingFront,
    optimalDampingRear,
    unsprungFreqFront,
    unsprungFreqRear,
  };
}
