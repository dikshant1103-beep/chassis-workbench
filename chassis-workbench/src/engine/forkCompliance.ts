/**
 * forkCompliance.ts — Fork and Steering Compliance Module
 *
 * Module 11: Fork deflection under braking, effective trail change,
 * and steering torsional flex from self-aligning torque.
 *
 * REFERENCES:
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 6.
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 7.
 *
 * UNIT CONVENTIONS: mm, N, N/mm, N·m/deg, degrees
 */

import { ForkComplianceParams, ForkComplianceResults } from './types';
import { G } from './cog';

const DEG2RAD = Math.PI / 180;
const FRONT_BRAKE_SHARE = 0.70; // typical front/total braking force share
const REF_STEER_ANGLE_DEG = 5;  // reference steer angle for SAT computation

/**
 * Horizontal braking force at front axle.
 *
 * F_brake = m × a_decel × g × front_brake_share
 *
 * @param totalMass   kg
 * @param a_decel_g   g (deceleration magnitude)
 */
export function computeBrakingForceFront(totalMass: number, a_decel_g: number): number {
  return totalMass * a_decel_g * G * FRONT_BRAKE_SHARE;
}

/**
 * Fork bending deflection at axle under braking force.
 *
 * δ_fork = F_brake / k_fork_bending
 *
 * @param F_brake  N horizontal at axle
 * @param k_bend   N/mm bending stiffness at axle
 */
export function computeForkDeflection(F_brake: number, k_bend: number): number {
  if (k_bend < 1e-9) throw new RangeError('computeForkDeflection: k_bend must be > 0');
  return F_brake / k_bend;
}

/**
 * Effective trail change due to fork bending.
 *
 * When the fork bends (axle moves rearward relative to steering axis),
 * the contact patch moves forward relative to the steering axis projection —
 * reducing trail.
 *
 * Δ_trail = −δ_fork × cos(α)     where α = head angle from vertical
 *
 * (Negative = trail decreases under braking — fork deflection makes steering
 * feel more nervous because self-centering reduces)
 *
 * @param delta_fork  mm fork deflection (positive = axle moves rearward)
 * @param headAngle_deg  degrees
 */
export function computeEffectiveTrail(
  trail_static: number,
  delta_fork: number,
  headAngle_deg: number,
): { trailEffective: number; deltaTrail: number } {
  const alpha = headAngle_deg * DEG2RAD;
  const deltaTrail = -delta_fork * Math.cos(alpha);
  return {
    trailEffective: trail_static + deltaTrail,
    deltaTrail,
  };
}

/**
 * Self-aligning torque about steering axis (at reference steer angle 5°).
 *
 * M_SAT = R_front × (trail_mm / 1000) × sin(δ_ref)
 *
 * This is the restoring torque the tyre creates when steered, acting
 * through the trail moment arm. Same as geometry module Eq 5.5 but
 * used here to drive the flex calculation.
 */
export function computeSteeringTorque(R_front: number, trail_mm: number): number {
  const delta = REF_STEER_ANGLE_DEG * DEG2RAD;
  return R_front * (trail_mm / 1000) * Math.sin(delta);
}

/**
 * Steering flex angle from torsional compliance.
 *
 * δ_flex = M_SAT / k_torsional
 *
 * > 0.5° is perceptible by the rider as "vague feel"
 * > 1.5° is potentially dangerous at speed (Cossalter)
 */
export function computeSteerFlexAngle(M_SAT: number, k_torsional: number): number {
  if (k_torsional < 1e-9) throw new RangeError('computeSteerFlexAngle: k_torsional must be > 0');
  return M_SAT / k_torsional;
}

export function computeForkCompliance(
  p: ForkComplianceParams,
  totalMass: number,
  a_decel_g: number,
  trail_static: number,
  headAngle_deg: number,
  R_front: number,
): ForkComplianceResults {
  const brakingForceFront = computeBrakingForceFront(totalMass, a_decel_g);
  const forkDeflection    = computeForkDeflection(brakingForceFront, p.forkBendingStiffness);
  const { trailEffective, deltaTrail } = computeEffectiveTrail(trail_static, forkDeflection, headAngle_deg);
  const steeringTorqueNm  = computeSteeringTorque(R_front, trail_static);
  const steerFlexAngle    = computeSteerFlexAngle(steeringTorqueNm, p.forkTorsionalStiffness);

  return {
    brakingForceFront,
    forkDeflection,
    trailEffective,
    deltaTrail,
    steeringTorqueNm,
    steerFlexAngle,
    isPerceptible: steerFlexAngle > 0.5,
    isDangerous:   steerFlexAngle > 1.5,
  };
}
