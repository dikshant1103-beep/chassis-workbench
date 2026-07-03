/**
 * kinematics.ts — Suspension Kinematics Module
 *
 * Module 8: Rear axle locus, wheelbase change, and chain length change
 * as functions of suspension travel.
 *
 * REFERENCES:
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 11.
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 5.
 *
 * COORDINATE SYSTEM: same as rest of engine (X from front axle, Y from ground)
 */

import { KinematicsParams, KinematicsResults, KinematicsPoint } from './types';

const RAD2DEG = 180 / Math.PI;

/**
 * Two-sprocket chain centre distance.
 * For two sprockets of radii R1, R2 at centre distance C:
 *   L_chain ≈ 2C × cos(γ) + π(R1+R2) + (R1−R2)²/C
 *   where γ = asin((R2−R1)/C)
 * We track only the centre distance change; ΔL_chain ≈ 2 × ΔC (Foale approx)
 */
function computeCentreDistance(
  axleX: number, axleY: number,
  csX: number, csY: number,
): number {
  return Math.sqrt((axleX - csX) ** 2 + (axleY - csY) ** 2);
}

export function computeKinematics(
  p: KinematicsParams,
  swingarmLength: number,
  swingarmPivotX: number,
  swingarmPivotHeight: number,
  swingarmAngleRad: number,    // static
  _rearAxleHeightStatic: number,
  motionRatioRear: number,
  shockTravel: number,
  sprocketCenterX: number,     // offset from pivot
  sprocketCenterY: number,
  _frontSprocket: number,
  _rearSprocket: number,
): KinematicsResults {
  const rearWheelTravel = shockTravel * motionRatioRear;

  // Countershaft (fixed to frame)
  const csX = swingarmPivotX + sprocketCenterX;
  const csY = swingarmPivotHeight + sprocketCenterY;

  // Static rear axle position
  const staticAxleX = swingarmPivotX + swingarmLength * Math.cos(swingarmAngleRad);
  const staticAxleY = swingarmPivotHeight + swingarmLength * Math.sin(swingarmAngleRad);
  const staticWB = staticAxleX;
  const staticCentreDistance = computeCentreDistance(staticAxleX, staticAxleY, csX, csY);

  // Find static sag position index
  const N = p.numPositions;
  const staticSagTravel = shockTravel * 0.3; // approximate static sag ~ 30% of travel
  const staticIndex = Math.round((staticSagTravel / rearWheelTravel) * (N - 1));

  const positions: KinematicsPoint[] = [];
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * rearWheelTravel; // wheel travel from full droop
    // Angle change from static
    const deltaAngle = s / swingarmLength; // rad (small angle valid for ±50mm)
    const theta = swingarmAngleRad + deltaAngle;

    const axleX = swingarmPivotX + swingarmLength * Math.cos(theta);
    const axleY = swingarmPivotHeight + swingarmLength * Math.sin(theta);
    const wb = axleX;
    const deltaWB = wb - staticWB;

    const cd = computeCentreDistance(axleX, axleY, csX, csY);
    const deltaChainLength = 2 * (cd - staticCentreDistance);

    positions.push({
      suspensionMm: s,
      rearAxleX: axleX,
      rearAxleY: axleY,
      wheelbase: wb,
      deltaWheelbase: deltaWB,
      chainCentreDistance: cd,
      deltaChainLength,
      swingarmAngleDeg: theta * RAD2DEG,
    });
  }

  const wbChanges = positions.map(pt => Math.abs(pt.deltaWheelbase));
  const clChanges = positions.map(pt => Math.abs(pt.deltaChainLength));

  return {
    rearWheelTravel,
    staticIndex: Math.max(0, Math.min(staticIndex, N - 1)),
    positions,
    maxWheelbaseChange: Math.max(...wbChanges),
    maxChainLengthChange: Math.max(...clChanges),
  };
}
