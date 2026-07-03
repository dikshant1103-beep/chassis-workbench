/**
 * cog.ts — Centre of Gravity (CoG) Physics Engine
 *
 * Implements Equations 6.1–6.7 from the Motorcycle Chassis Dynamics
 * Workbench Technical Specification v3.0.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 3.
 *   DataMC.org. Mass, Weight and Center of Gravity.
 *   SAE J1168 — Motorcycle Terminology (g = 9.81 m/s²)
 *
 * UNIT CONVENTIONS:
 *   Mass     : kg
 *   Position : mm (X from front axle, Y from ground)
 *   Force    : N
 *   g        : 9.81 m/s² (exact, per spec Section 6.3)
 */

import { MassComponent, CoGResults } from './types';

/** Gravitational acceleration — SAE J1168, consistent with spec Eq 6.3 */
export const G = 9.81; // m/s²

// ─────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Computes the combined CoG position using the weighted centroid method.
 *
 * X_cg = Σ(m_i × x_i) / Σ(m_i)               ... Eq 6.1
 * Y_cg = Σ(m_i × y_i) / Σ(m_i)               ... Eq 6.2
 *
 * All mass components — vehicle, rider, pillion, luggage, fuel — are
 * included. The fuel mass is computed from (fuelCapacity × fuelLevel/100
 * × 0.745 kg/L) before being added to the component list.
 *
 * @param components  Array of {mass(kg), x(mm), y(mm)} mass points
 * @returns { X_cg, Y_cg } in mm
 * @throws  RangeError if total mass is zero or component list is empty
 */
export function computeWeightedCentroid(
  components: MassComponent[],
): { X_cg: number; Y_cg: number } {
  if (components.length === 0) {
    throw new RangeError(
      'computeWeightedCentroid: mass component list is empty.',
    );
  }

  const totalMass = components.reduce((sum, c) => sum + c.mass, 0);

  if (Math.abs(totalMass) < 1e-9) {
    throw new RangeError(
      'computeWeightedCentroid: total mass is zero — cannot compute centroid.',
    );
  }

  // Eq 6.1 — horizontal CoG from front axle
  const X_cg = components.reduce((sum, c) => sum + c.mass * c.x, 0) / totalMass;

  // Eq 6.2 — vertical CoG from ground
  const Y_cg = components.reduce((sum, c) => sum + c.mass * c.y, 0) / totalMass;

  return { X_cg, Y_cg };
}

/**
 * Expresses the CoG position relative to the swingarm pivot.
 *
 * Per Tony Foale / DataMC methodology: the motorcycle pitches about the
 * swingarm pivot during suspension travel, so pivot-relative CoG
 * coordinates give more physically meaningful dynamic positions.
 *
 * ΔX_sp = X_cg − X_sp                         ... Eq 6.3
 * ΔY_sp = Y_cg − H_sp                         ... Eq 6.4
 *
 * @param X_cg  CoG x-position (mm from front axle)
 * @param Y_cg  CoG y-position (mm from ground)
 * @param X_sp  Swingarm pivot x-position (mm from front axle)
 * @param H_sp  Swingarm pivot height (mm from ground)
 * @returns { deltaX_sp, deltaY_sp } in mm
 */
export function computeCoGRelativeToPivot(
  X_cg: number,
  Y_cg: number,
  X_sp: number,
  H_sp: number,
): { deltaX_sp: number; deltaY_sp: number } {
  return {
    deltaX_sp: X_cg - X_sp,  // Eq 6.3
    deltaY_sp: Y_cg - H_sp,  // Eq 6.4
  };
}

/**
 * Computes static axle load reactions on a level surface.
 *
 * R_front = W × (WB − X_cg) / WB              ... Eq 6.5
 * R_rear  = W × X_cg / WB                     ... Eq 6.6
 * Front%  = ((WB − X_cg) / WB) × 100          ... Eq 6.7
 *
 * These are the static normal forces at each tyre contact patch.
 * W = Σ(m_i) × 9.81 N.
 *
 * Healthy range for Front%: 42–58% (most motorcycles).
 * Sport bikes: 50–53% front-biased. Cruisers: 45–48% front.
 *
 * @param totalMass  Total system mass (kg)
 * @param X_cg       CoG distance from front axle (mm)
 * @param wheelbase  WB (mm)
 * @returns Axle reactions and weight distribution percentages
 * @throws  RangeError if wheelbase is zero
 */
export function computeStaticAxleLoads(
  totalMass: number,
  X_cg: number,
  wheelbase: number,
): { R_front: number; R_rear: number; frontPercent: number; rearPercent: number } {
  if (Math.abs(wheelbase) < 1e-9) {
    throw new RangeError(
      'computeStaticAxleLoads: wheelbase cannot be zero.',
    );
  }

  const W = totalMass * G;  // total weight [N]

  // Eq 6.5: front reaction — moment balance about rear axle
  const R_front = W * (wheelbase - X_cg) / wheelbase;

  // Eq 6.6: rear reaction — moment balance about front axle
  const R_rear = W * X_cg / wheelbase;

  // Eq 6.7: front weight percentage
  const frontPercent = ((wheelbase - X_cg) / wheelbase) * 100;

  return { R_front, R_rear, frontPercent, rearPercent: 100 - frontPercent };
}

// ─────────────────────────────────────────────────────────
// AGGREGATE FUNCTION
// ─────────────────────────────────────────────────────────

/**
 * Full CoG computation — aggregates Eq 6.1 through 6.7.
 *
 * @param components      All mass components (vehicle + occupants + payload)
 * @param wheelbase       WB (mm)
 * @param swingarmPivotX  X_sp (mm from front axle)
 * @param swingarmPivotH  H_sp (mm from ground)
 * @returns CoGResults
 */
export function computeCoG(
  components: MassComponent[],
  wheelbase: number,
  swingarmPivotX: number,
  swingarmPivotH: number,
): CoGResults {
  const { X_cg, Y_cg } = computeWeightedCentroid(components);

  const { deltaX_sp, deltaY_sp } = computeCoGRelativeToPivot(
    X_cg, Y_cg, swingarmPivotX, swingarmPivotH,
  );

  const totalMass = components.reduce((sum, c) => sum + c.mass, 0);

  const { R_front, R_rear, frontPercent, rearPercent } = computeStaticAxleLoads(
    totalMass, X_cg, wheelbase,
  );

  return {
    X_cg,
    Y_cg,
    deltaX_sp,
    deltaY_sp,
    R_front,
    R_rear,
    frontPercent,
    rearPercent,
    totalMass,
    totalWeight: totalMass * G,
  };
}
