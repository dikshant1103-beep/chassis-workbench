/**
 * computeAll.ts — Master Physics Computation Function
 *
 * Orchestrates all 11 physics modules in dependency order.
 *
 * DATA FLOW:
 *   Input → geometry → cog → suspension → antiSquat
 *                                       → ergonomics
 *                                       → dynamics
 *                         → tire        (uses suspension wheelRate + cog loads)
 *                         → kinematics  (uses geometry + suspension)
 *                         → inertia     (uses cog)
 *                         → stability   (uses cog + geometry)
 *                         → forkCompliance (uses geometry + cog + dynamics)
 *
 * All new modules accept optional params and fall back to sensible defaults
 * so that existing presets (which don't include the new fields) continue to work.
 */

import { ComputeAllInput, ComputeAllResult, TireParams, KinematicsParams, StabilityParams, ForkComplianceParams, AeroParams, StabilityResults } from './types';
import { computeGeometry }      from './geometry';
import { computeCoG }           from './cog';
import { computeSuspension }    from './suspension';
import { computeAntiSquatUnified } from './antiSquat';
import { computeErgonomics }    from './ergonomics';
import { computeDynamics }      from './dynamics';
import { computeTire }          from './tire';
import { computeKinematics }    from './kinematics';
import { computeInertia }       from './inertia';
import { computeStability }     from './stability';
import { computeForkCompliance } from './forkCompliance';
import { computeAero }          from './aero';

// ── Defaults for optional new modules ──────────────────────────────────────

const DEFAULT_TIRE: TireParams = {
  frontSectionWidth: 120, frontAspectRatio: 70, frontRimDiameter: 17,
  frontTireStiffness: 180,
  rearSectionWidth: 190,  rearAspectRatio: 55,  rearRimDiameter: 17,
  rearTireStiffness: 200,
  speedKmh: 0,
};

const DEFAULT_KINEMATICS: KinematicsParams = {
  chainPitch: 15.875,
  chainLinks: 112,
  numPositions: 11,
};

const DEFAULT_STABILITY: StabilityParams = {
  footpegLateralOffset: 350,
  frictionCoeff: 0.8,
  steeringLockAngle: 35,
};

const DEFAULT_FORK_COMPLIANCE: ForkComplianceParams = {
  forkBendingStiffness: 45,
  forkTorsionalStiffness: 450,
  steeringHeadStiffness: 800,
};

const DEFAULT_AERO: AeroParams = {
  Cx: 0.38,
  Cz: -0.05,
  frontalArea: 0.35,
  pressureCentreX: 750,
  referenceSpeedKmh: 200,
  maxSpeedKmh: 300,
  enginePower_kW: 150,
  drivetrainEta: 0.88,
};

export function computeAll(input: ComputeAllInput): ComputeAllResult {
  const { geometry: gp, massComponents, suspension: sp,
    chain, ergo, dynamics: dp } = input;

  const tireP   = input.tire          ?? DEFAULT_TIRE;
  const kinP    = input.kinematics    ?? DEFAULT_KINEMATICS;
  const stabP   = input.stability     ?? DEFAULT_STABILITY;
  const forkP   = input.forkCompliance ?? DEFAULT_FORK_COMPLIANCE;

  // Step 1: Geometry
  const geometry = computeGeometry(gp);

  // Step 2: CoG
  const cog = computeCoG(massComponents, gp.wheelbase, gp.swingarmPivotX, gp.swingarmPivotHeight);

  // Step 3: Suspension
  const suspension = computeSuspension(sp, cog.totalMass, cog.X_cg, cog.Y_cg, gp.wheelbase);

  // Step 4: Anti-Squat — unified engine (auto chain angle, geometric SA angle)
  const antiSquat = computeAntiSquatUnified(
    chain,
    gp.swingarmPivotX, gp.swingarmPivotHeight,
    gp.wheelbase, gp.rearAxleHeight,
    cog.Y_cg, gp.headAngle, cog.R_front, cog.totalWeight,
  );

  // Step 5: Ergonomics
  const ergonomics = computeErgonomics(ergo);

  // Step 6: Dynamics
  const dynamics = computeDynamics(dp, cog.totalMass, cog.Y_cg, gp.wheelbase, cog.R_front, cog.totalWeight);

  // Step 7: Tire physics
  const tire = computeTire(
    tireP, cog.R_front, cog.R_rear,
    suspension.wheelRateFront, suspension.wheelRateRear,
    suspension.sprungMassFront, suspension.sprungMassRear,
  );

  // Step 8: Kinematics
  const kinematics = computeKinematics(
    kinP,
    gp.swingarmLength, gp.swingarmPivotX, gp.swingarmPivotHeight,
    geometry.swingarmAngleRad, gp.rearAxleHeight,
    sp.motionRatioRear, sp.shockTravel,
    chain.sprocketCenterX, chain.sprocketCenterY,
    chain.frontSprocket, chain.rearSprocket,
  );

  // Step 9: Inertia
  const inertia = computeInertia(massComponents, cog.X_cg, cog.Y_cg);

  // Step 10: Stability
  const stabilityBase = computeStability(stabP, gp.wheelbase, cog.X_cg, cog.Y_cg, gp.groundClearance);

  // ── DAG-model handling indices (MotorcycleDynamicsModel §G5 / §G8) ──────────
  // These 6 metrics are unique outputs of the Python DAG model, ported here so
  // they are always available without a running API server.

  const WB_mm = gp.wheelbase;
  const trailMm = geometry.trail;
  const WB_m = WB_mm / 1000;

  // SI = trail × WB / 10^6  (Cossalter — higher = more stable)
  const stabilityIndex = (trailMm * WB_mm) / 1_000_000;
  // WS = 10^6 / (trail × WB)  (lower = more stable at speed)
  const wobbleSensitivity = trailMm > 0 && WB_mm > 0 ? 1_000_000 / (trailMm * WB_mm) : 0;
  // AI = I_yaw / (M × WB²)  (lower = more agile)
  const agilityIndex = inertia.I_yaw > 0 && cog.totalMass > 0 && WB_m > 0
    ? inertia.I_yaw / (cog.totalMass * WB_m * WB_m) : 0;
  // dF%/dWB = X_cg / WB² × 100  (%/mm)
  const pitchSensitivity = WB_mm > 0 ? cog.X_cg / (WB_mm * WB_mm) * 100 : 0;

  // Rear squat prediction: (1 − AS%/100) × ΔW_accel / k_rear  [mm]
  const asPercent = isFinite(antiSquat.antiSquatPercent) ? antiSquat.antiSquatPercent : 0;
  const rearSquatMm = suspension.wheelRateRear > 0
    ? Math.max(0, (1 - asPercent / 100) * dynamics.deltaW_accel / suspension.wheelRateRear)
    : 0;
  // Fork dive prediction: (1 − AD%/100) × ΔW_brake / k_front  [mm]
  const adPercent = isFinite(antiSquat.antiDivePercent) ? antiSquat.antiDivePercent : 0;
  const forkDiveMm = suspension.wheelRateFront > 0
    ? Math.max(0, (1 - adPercent / 100) * dynamics.deltaW_brake / suspension.wheelRateFront)
    : 0;

  const stability: StabilityResults = {
    ...stabilityBase,
    rearSquatMm,
    forkDiveMm,
    stabilityIndex,
    agilityIndex,
    wobbleSensitivity,
    pitchSensitivity,
  };

  // Step 11: Fork compliance
  const forkCompliance = computeForkCompliance(
    forkP, cog.totalMass, dp.brakingDecel,
    geometry.trail, gp.headAngle, cog.R_front,
  );

  // FEM removed — stub result so downstream code that checks fem.solved stays safe
  const fem: import('./types').FEMResults = {
    nodes: [], elements: [], maxDisplacement: 0, maxStress: 0,
    minSafetyFactor: 999, criticalElement: 'none', solved: false,
  };

  // Step 13: Aerodynamics
  const aeroP = input.aero ?? DEFAULT_AERO;
  const aero  = computeAero(aeroP, cog.X_cg, gp.wheelbase);

  return { geometry, cog, suspension, antiSquat, ergonomics, dynamics, tire, kinematics, inertia, stability, forkCompliance, fem, aero };
}
