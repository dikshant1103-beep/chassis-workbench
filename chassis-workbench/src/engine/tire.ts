/**
 * tire.ts — Tire Physics Module
 *
 * Module 7: Tire geometry, deflection, contact patch, dynamic growth,
 * and combined suspension+tire spring rate.
 *
 * REFERENCES:
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 2.
 *   Pacejka, H. (2012). Tire and Vehicle Dynamics, Ch. 1.
 *
 * UNIT CONVENTIONS: mm, N, kg, km/h, N/mm
 */

import { TireParams, TireResults } from './types';

const K_GROWTH = 2e-6; // empirical centrifugal growth coefficient for road tyres [1/(m/s)²]

/**
 * Free radius from ISO tire code dimensions.
 * R_free = (rimDiameter_inches × 25.4 / 2) + (sectionWidth × aspectRatio / 100)
 */
export function computeFreeRadius(
  sectionWidth: number,
  aspectRatio: number,
  rimDiameter_inches: number,
): number {
  const rimRadius_mm = (rimDiameter_inches * 25.4) / 2;
  const sidewallHeight = sectionWidth * (aspectRatio / 100);
  return rimRadius_mm + sidewallHeight;
}

/**
 * Tire deflection under static normal load.
 * delta = F_normal / k_tire          (linear spring model)
 *
 * @param normalLoad  N
 * @param k_tire      N/mm
 */
export function computeTireDeflection(normalLoad: number, k_tire: number): number {
  if (k_tire < 1e-9) throw new RangeError('computeTireDeflection: k_tire must be > 0');
  return normalLoad / k_tire;
}

/**
 * Contact patch half-length from Hertz-like approximation (Cossalter Eq 2.1).
 * a_cp = sqrt(2 × R_loaded × delta)
 * L_cp = 2 × a_cp
 */
export function computeContactPatch(R_loaded: number, deflection: number): number {
  if (R_loaded < 1e-9 || deflection < 0) return 0;
  return 2 * Math.sqrt(2 * R_loaded * deflection);
}

/**
 * Dynamic radius under centrifugal growth (Cossalter Eq 2.4).
 * R_dyn = R_free × (1 + K_GROWTH × V²)
 * V in m/s
 */
export function computeDynamicRadius(R_free: number, speedKmh: number): number {
  const V = speedKmh / 3.6;
  return R_free * (1 + K_GROWTH * V * V);
}

/**
 * Combined spring rate of suspension wheel rate + tire (springs in series).
 * 1/k_comb = 1/k_wheel + 1/k_tire
 */
export function computeCombinedRate(k_wheel: number, k_tire: number): number {
  if (k_wheel < 1e-9 || k_tire < 1e-9) return Math.min(k_wheel, k_tire);
  return (k_wheel * k_tire) / (k_wheel + k_tire);
}

/**
 * Natural frequency corrected for tire compliance.
 * f_n = (1/2π) × sqrt(k_combined × 1000 / m_sprung)
 */
export function computeCorrectedNatFreq(k_combined: number, m_sprung: number): number {
  if (m_sprung < 1e-9) throw new RangeError('computeCorrectedNatFreq: m_sprung must be > 0');
  return (1 / (2 * Math.PI)) * Math.sqrt((k_combined * 1000) / m_sprung);
}

export function computeTire(
  p: TireParams,
  R_front: number,
  R_rear: number,
  wheelRateFront: number,
  wheelRateRear: number,
  sprungMassFront: number,
  sprungMassRear: number,
): TireResults {
  // Free radii
  const frontFreeRadius = computeFreeRadius(p.frontSectionWidth, p.frontAspectRatio, p.frontRimDiameter);
  const rearFreeRadius  = computeFreeRadius(p.rearSectionWidth,  p.rearAspectRatio,  p.rearRimDiameter);

  // Deflections under static axle loads
  const frontDeflection = computeTireDeflection(R_front, p.frontTireStiffness);
  const rearDeflection  = computeTireDeflection(R_rear,  p.rearTireStiffness);

  // Loaded radii
  const frontLoadedRadius = frontFreeRadius - frontDeflection;
  const rearLoadedRadius  = rearFreeRadius  - rearDeflection;

  // Contact patch lengths
  const frontContactPatchLength = computeContactPatch(frontLoadedRadius, frontDeflection);
  const rearContactPatchLength  = computeContactPatch(rearLoadedRadius,  rearDeflection);

  // Dynamic radii at speed
  const frontDynamicRadius = computeDynamicRadius(frontFreeRadius, p.speedKmh);
  const rearDynamicRadius  = computeDynamicRadius(rearFreeRadius,  p.speedKmh);

  // Combined spring rates
  const frontCombinedRate = computeCombinedRate(wheelRateFront, p.frontTireStiffness);
  const rearCombinedRate  = computeCombinedRate(wheelRateRear,  p.rearTireStiffness);

  // Corrected natural frequencies
  const frontNatFreqCorrected = computeCorrectedNatFreq(frontCombinedRate, sprungMassFront);
  const rearNatFreqCorrected  = computeCorrectedNatFreq(rearCombinedRate,  sprungMassRear);

  return {
    frontFreeRadius, rearFreeRadius,
    frontLoadedRadius, rearLoadedRadius,
    frontDeflection, rearDeflection,
    frontContactPatchLength, rearContactPatchLength,
    frontDynamicRadius, rearDynamicRadius,
    frontCombinedRate, rearCombinedRate,
    frontNatFreqCorrected, rearNatFreqCorrected,
  };
}
