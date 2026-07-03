import { create } from 'zustand';
import { ComputeAllInput, ComputeAllResult, MassComponent, TireParams, KinematicsParams, StabilityParams, ForkComplianceParams, FEMSectionParams, SweepParams, AeroParams, TargetConfig } from '../engine/types';
import { computeAll } from '../engine/computeAll';
import { FAMILIES } from '../data/families';
import { DEFAULT_FEM_SECTION } from '../engine/femSolver';
import type { DagAnalysisResult, DynamicsResult } from '../api/backendClient';

// ── Saved configs (Comparison Mode) ─────────────────────────────────────────

export interface SavedConfig {
  id: string;
  name: string;
  input: ComputeAllInput;
  savedAt: number;
}

const CONFIGS_LS_KEY = 'mcw_saved_configs';

function loadSavedConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(CONFIGS_LS_KEY);
    if (raw) return JSON.parse(raw) as SavedConfig[];
  } catch { /* ignore */ }
  return [];
}

// ── Custom Bikes (user-defined design library) ───────────────────────────────

export interface CustomBike {
  id: string;
  name: string;
  description: string;
  input: ComputeAllInput;
  createdAt: number;
  updatedAt: number;
}

const CUSTOM_BIKES_LS_KEY = 'mcw_custom_bikes';

function loadCustomBikes(): CustomBike[] {
  try {
    const raw = localStorage.getItem(CUSTOM_BIKES_LS_KEY);
    if (raw) return JSON.parse(raw) as CustomBike[];
  } catch { /* ignore */ }
  return [];
}

const LS_KEY = 'mcw_session';

// ── Design Journal Snapshots ─────────────────────────────────────────────────

export interface DesignSnapshot {
  id: string;
  label: string;
  note: string;
  timestamp: number;
  fromTab: string;
  familyName: string;
  input: ComputeAllInput;
  kpis: {
    trail: number;
    frontPct: number;
    natFreqF: number;
    natFreqR: number;
    antiSquat: number;
    wheelRateF: number;
    wheelRateR: number;
    sagF: number;
    sagR: number;
  };
}

const SNAPSHOTS_LS_KEY = 'mcw_snapshots';
const SNAPSHOT_MAX = 20;

function loadSnapshots(): DesignSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_LS_KEY);
    if (raw) return JSON.parse(raw) as DesignSnapshot[];
  } catch { /* ignore */ }
  return [];
}

function persistSnapshots(snaps: DesignSnapshot[]) {
  localStorage.setItem(SNAPSHOTS_LS_KEY, JSON.stringify(snaps));
}

// ── Visibility ──────────────────────────────────────────────────────────────

export type VisibilityKey =
  // ── Components ──
  | 'frontWheel' | 'rearWheel'
  | 'frontForkTubes' | 'frontForkSprings'
  | 'headTube' | 'steeringAxis'
  | 'frameRails' | 'seatTube'
  | 'swingarm' | 'rearShock' | 'rearShockSpring'
  | 'engineBlock'
  | 'riderMassPoints' | 'bikeSilhouette'
  // ── CoG / Ergo ──
  | 'cogMarker' | 'ergoTriangle' | 'ergoControls'
  | 'massComponents' | 'instantCentre'
  // ── Geometry lines ──
  | 'trailGeometry' | 'antiSquatLine' | 'loadTransferLine'
  | 'chainSystem' | 'forceLine'
  | 'wheelbaseLine' | 'pivotAxleLine' | 'swingarmExtension'
  | 'forkAxisLine' | 'handlebarForkLine'
  // ── Labels ──
  | 'labels' | 'massLabels' | 'coordLabels' | 'angleLabels' | 'dimensionLabels'
  // ── Forces ──
  | 'forceVectors' | 'coordAxes'
  // ── Advanced kinematics overlay ──
  | 'advancedKinematics'
  // ── Advanced kinematics sub-layers ──
  | 'akRakeLine' | 'akForkOffset' | 'akNormalTrail'
  | 'akRearRadius' | 'akCogCross' | 'akSquatLine' | 'akPivotLine';

export type Visibility = Record<VisibilityKey, boolean>;

const DEFAULT_VISIBILITY: Visibility = {
  // components — all on by default
  frontWheel: true, rearWheel: true,
  frontForkTubes: false, frontForkSprings: false,
  headTube: true, steeringAxis: true,
  frameRails: true, seatTube: true,
  swingarm: true, rearShock: false, rearShockSpring: false,
  engineBlock: true,
  riderMassPoints: false, bikeSilhouette: true,
  // cog/ergo
  cogMarker: true, ergoTriangle: true, ergoControls: false,
  massComponents: false, instantCentre: true,
  // geometry lines — key ones on, advanced off
  trailGeometry: true, antiSquatLine: false, loadTransferLine: false,
  chainSystem: true, forceLine: false,
  wheelbaseLine: true, pivotAxleLine: false, swingarmExtension: false,
  forkAxisLine: false, handlebarForkLine: true,
  // labels
  labels: true, massLabels: false, coordLabels: false,
  angleLabels: true, dimensionLabels: true,
  // forces
  forceVectors: false, coordAxes: true,
  // advanced kinematics overlay
  advancedKinematics: false,
  // advanced kinematics sub-layers (all on so enabling AK shows everything by default)
  akRakeLine: true, akForkOffset: true, akNormalTrail: true,
  akRearRadius: true, akCogCross: true, akSquatLine: true, akPivotLine: true,
};

// ── Default params for new optional modules ─────────────────────────────────

const DEFAULT_TIRE_PARAMS: TireParams = {
  frontSectionWidth: 120, frontAspectRatio: 70, frontRimDiameter: 17,
  frontTireStiffness: 180,
  rearSectionWidth: 190,  rearAspectRatio: 55,  rearRimDiameter: 17,
  rearTireStiffness: 200,
  speedKmh: 0,
};

const DEFAULT_KINEMATICS_PARAMS: KinematicsParams = {
  chainPitch: 15.875,
  chainLinks: 112,
  numPositions: 11,
};

const DEFAULT_STABILITY_PARAMS: StabilityParams = {
  footpegLateralOffset: 350,
  frictionCoeff: 0.8,
  steeringLockAngle: 35,
};

const DEFAULT_FORK_COMPLIANCE_PARAMS: ForkComplianceParams = {
  forkBendingStiffness: 180,    // N/mm — 43mm USD sport fork (gives ~5mm at 1g brake)
  forkTorsionalStiffness: 700,  // N·m/deg
  steeringHeadStiffness: 1200,
};

// Default shock mount geometry for a typical sport bike (direct monoshock)
// Shock arm: 120 mm from pivot, 85° above swingarm axis
// Shock top: 750 mm from front axle, 450 mm height
export const DEFAULT_SWEEP_PARAMS: SweepParams = {
  linkageType: 'direct',
  shockArmLength: 120,
  shockArmAngle: 85,
  shockTopX: 750,
  shockTopY: 450,
  motionRatioOverride: 0,  // 0 = use suspension.motionRatioRear (set by ChassisSweepPanel)
  fourBar: {
    rockerPivotX: 800,
    rockerPivotY: 400,
    rockerLength: 80,
    pushrodLength: 140,
    rockerAngleStatic: 171.7,
  },
};

// ── Store interface ──────────────────────────────────────────────────────────

interface StoreState {
  input: ComputeAllInput;
  results: ComputeAllResult;
  familyName: string;
  error: string | null;

  savedConfigs: SavedConfig[];
  saveCurrentConfig: (name: string) => void;
  removeSavedConfig: (id: string) => void;
  renameSavedConfig: (id: string, name: string) => void;
  addToSweep: (input: ComputeAllInput, name: string) => void;

  customBikes: CustomBike[];
  saveCustomBike: (name: string, description: string, inputOverride?: ComputeAllInput) => string;
  updateCustomBike: (id: string, input: ComputeAllInput) => void;
  removeCustomBike: (id: string) => void;
  renameCustomBike: (id: string, name: string, description: string) => void;
  loadCustomBike: (id: string) => void;

  visibility: Visibility;
  setVisibility: (patch: Partial<Visibility>) => void;

  setGeometry: (patch: Partial<ComputeAllInput['geometry']>) => void;
  setSuspension: (patch: Partial<ComputeAllInput['suspension']>) => void;
  setChain: (patch: Partial<ComputeAllInput['chain']>) => void;
  setErgo: (patch: Partial<ComputeAllInput['ergo']>) => void;
  setDynamics: (patch: Partial<ComputeAllInput['dynamics']>) => void;
  setMassComponents: (components: MassComponent[]) => void;
  updateMassComponent: (index: number, patch: Partial<MassComponent>) => void;
  familyNameDisplay: string;
  loadFamily: (name: string) => void;

  setTire: (patch: Partial<TireParams>) => void;
  setKinematics: (patch: Partial<KinematicsParams>) => void;
  setStability: (patch: Partial<StabilityParams>) => void;
  setForkCompliance: (patch: Partial<ForkComplianceParams>) => void;
  setFEMSection: (patch: Partial<FEMSectionParams>) => void;
  setSweep: (patch: Partial<SweepParams>) => void;
  setAero: (patch: Partial<AeroParams>) => void;

  saveSession: () => void;
  loadSession: () => void;
  hasSavedSession: () => boolean;

  exportJSON: () => void;
  exportCSV: () => void;

  // ── Backend sync state ────────────────────────────────────────────────────
  backendStatus: 'offline' | 'syncing' | 'synced' | 'error';
  backendResults: DagAnalysisResult | null;
  backendDynamics: DynamicsResult | null;
  setBackendStatus: (status: 'offline' | 'syncing' | 'synced' | 'error') => void;
  setBackendResults: (dag: DagAnalysisResult | null, dynamics: DynamicsResult | null) => void;

  // ── R&D — Design Targets ──────────────────────────────────────────────────
  targetConfig: TargetConfig;
  setTargetConfig: (patch: Partial<TargetConfig>) => void;

  // ── R&D — Optimizer ───────────────────────────────────────────────────────
  applyOptimizedInput: (input: ComputeAllInput) => void;

  // ── R5 — Design Journal ───────────────────────────────────────────────────
  snapshots: DesignSnapshot[];
  addSnapshot: (label: string, fromTab: string) => string;
  deleteSnapshot: (id: string) => void;
  updateSnapshot: (id: string, label: string, note: string) => void;
  loadSnapshot: (id: string) => void;
}

/**
 * When any MassComponent carries an unsprungSide tag, compute the total
 * front / rear unsprung mass from those components and return a patch for
 * the suspension input.  Called inside setMassComponents / updateMassComponent
 * so the link is always one-directional: Mass tab drives Suspension totals.
 * Returns an empty object when no components are tagged (manual sliders stay).
 */
function syncUnsprungFromMass(
  components: MassComponent[],
): Partial<ComputeAllInput['suspension']> {
  const hasFront = components.some(c => c.unsprungSide === 'front');
  const hasRear  = components.some(c => c.unsprungSide === 'rear');
  if (!hasFront && !hasRear) return {};
  const patch: Partial<ComputeAllInput['suspension']> = {};
  if (hasFront) {
    patch.unsprungFront = +components
      .filter(c => c.unsprungSide === 'front')
      .reduce((s, c) => s + c.mass, 0)
      .toFixed(1);
  }
  if (hasRear) {
    patch.unsprungRear = +components
      .filter(c => c.unsprungSide === 'rear')
      .reduce((s, c) => s + c.mass, 0)
      .toFixed(1);
  }
  return patch;
}

function safeCompute(input: ComputeAllInput): { results: ComputeAllResult | null; error: string | null } {
  try {
    return { results: computeAll(input), error: null };
  } catch (e) {
    return { results: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Compute TypeScript results and immediately merge in the last backend DAG
 * result if one is available. This means every slider change shows backend-
 * enhanced values instantly (using the previous sync), then the new backend
 * sync fires after the 800ms debounce and updates any changed fields.
 */
function computeAndMerge(
  input: ComputeAllInput,
  dag: DagAnalysisResult | null,
): { results: ComputeAllResult | null; error: string | null } {
  const { results, error } = safeCompute(input);
  if (results && dag) {
    return { results: mergeBackendIntoResults(results, dag, input), error };
  }
  return { results, error };
}

/**
 * Merge Python DAG results into a TypeScript ComputeAllResult.
 * Covers every field shown in every panel — backend is the single source of truth.
 * TypeScript result serves as structural base and fallback for uncomputed fields.
 *
 * @param ts    TypeScript-computed result (base structure)
 * @param dag   Python backend full-pipeline result (all 13 modules)
 * @param input Current input state (needed to compute derived fields)
 */
function mergeBackendIntoResults(
  ts: ComputeAllResult,
  dag: DagAnalysisResult,
  input: ComputeAllInput,
): ComputeAllResult {
  const DEG2RAD = Math.PI / 180;
  const G = 9.81;

  // ── Derived fields computed from DAG outputs + input ─────────────────────
  const totalWeight = dag.cog.total_mass * G;

  // Front/rear % under braking and accel
  const frontPctBraking = totalWeight > 0
    ? ((dag.cog.r_front + dag.dynamics.load_transfer_brake) / totalWeight) * 100 : ts.dynamics.frontPercentBraking;
  const frontPctAccel = totalWeight > 0
    ? ((dag.cog.r_front - dag.dynamics.load_transfer_accel) / totalWeight) * 100 : ts.dynamics.frontPercentAccel;

  // Anti-dive % (Foale method: tan(α) × F_front_brake / W_total × 100)
  const alpha = input.geometry.headAngle * DEG2RAD;
  const frontBrakeForce = dag.cog.total_mass * input.dynamics.brakingDecel * G * 0.70;
  const antiDivePct = totalWeight > 0
    ? Math.tan(alpha) * (frontBrakeForce / totalWeight) * 100 : ts.antiSquat.antiDivePercent;

  // Gear ratio and chain contribution
  const gearRatio = input.chain.rearSprocket / Math.max(input.chain.frontSprocket, 1);
  const asSwingarmOnly = Math.abs(dag.cog.y_cg) > 1e-9
    ? (-Math.tan(dag.geometry.swingarm_angle * DEG2RAD) * dag.geometry.wheelbase / dag.cog.y_cg) * 100
    : ts.antiSquat.asSwingarmOnly;
  const chainContrib = dag.anti_squat.anti_squat_pct - asSwingarmOnly;

  // Lean limit (footpeg geometry)
  const footpegOffset = input.stability?.footpegLateralOffset ?? 350;
  const leanLimitDeg = footpegOffset > 1e-9
    ? Math.atan(input.geometry.groundClearance / footpegOffset) * (180 / Math.PI)
    : ts.stability.leanLimitDeg;

  // Minimum turning radius
  const steerLock = input.stability?.steeringLockAngle ?? 35;
  const tanLock = Math.tan(steerLock * DEG2RAD);
  const R_turn_mm = tanLock > 1e-9 ? dag.geometry.wheelbase / tanLock : ts.stability.R_turn_min_mm;

  // Grade max (traction-limited, rear drive)
  const mu = input.stability?.frictionCoeff ?? 0.8;
  const xRatio = dag.cog.x_cg / dag.geometry.wheelbase;
  const yRatio = dag.cog.y_cg / dag.geometry.wheelbase;
  const denomGrade = 1 - mu * yRatio;
  const gradeMaxDeg = denomGrade > 1e-6
    ? Math.atan(mu * xRatio / denomGrade) * (180 / Math.PI) : 80;

  // Lateral acceleration
  const cornerRadius = Math.max(input.dynamics.cornerRadius, 0.1);
  const lateralAccel = (input.dynamics.cornerSpeed ** 2) / cornerRadius;

  // Inertia radii of gyration (from DAG I values)
  const m = dag.cog.total_mass;
  const kPitch = m > 0 ? Math.sqrt(dag.inertia.i_pitch / m) : ts.inertia.k_pitch;
  const kYaw   = m > 0 ? Math.sqrt(dag.inertia.i_yaw   / m) : ts.inertia.k_yaw;
  const kRoll  = ts.inertia.k_roll;  // I_roll not in DAG, keep TS

  return {
    ...ts,
    geometry: {
      ...ts.geometry,
      trail:             dag.geometry.trail,
      mechanicalTrail:   dag.geometry.mechanical_trail,
      swingarmAngleDeg:  dag.geometry.swingarm_angle,
      swingarmAngleRad:  dag.geometry.swingarm_angle * DEG2RAD,
    },
    cog: {
      ...ts.cog,
      X_cg:         dag.cog.x_cg,
      Y_cg:         dag.cog.y_cg,
      R_front:      dag.cog.r_front,
      R_rear:       dag.cog.r_rear,
      frontPercent: dag.cog.front_pct,
      rearPercent:  dag.cog.rear_pct,
      totalMass:    dag.cog.total_mass,
      totalWeight:  dag.cog.total_mass * 9.81,
    },
    antiSquat: {
      ...ts.antiSquat,
      gearRatio:           gearRatio,
      IC_x:                dag.anti_squat.ic_x,
      IC_y:                dag.anti_squat.ic_y,
      antiSquatPercent:    dag.anti_squat.anti_squat_pct,
      chainForceAngleAuto: dag.anti_squat.chain_force_angle,
      asSwingarmOnly:      asSwingarmOnly,
      chainContribution:   chainContrib,
      antiDivePercent:     antiDivePct,
      proSquat:            Math.max(0, -dag.anti_squat.anti_squat_pct),
      proDive:             Math.max(0, -antiDivePct),
      squatRatio:          dag.anti_squat.squat_ratio ?? 0,
    },
    dynamics: {
      ...ts.dynamics,
      deltaW_brake:        dag.dynamics.load_transfer_brake,
      deltaW_accel:        dag.dynamics.load_transfer_accel,
      frontPercentBraking: frontPctBraking,
      frontPercentAccel:   frontPctAccel,
      bankAngleDeg:        dag.cornering.lean_angle_deg,
      lateralAccel:        lateralAccel,
      lateralForce:        dag.cornering.lateral_load_transfer,
    },
    inertia: {
      ...ts.inertia,
      I_yaw:   dag.inertia.i_yaw,
      I_pitch: dag.inertia.i_pitch,
      k_pitch: kPitch,
      k_yaw:   kYaw,
      k_roll:  kRoll,
    },
    stability: {
      ...ts.stability,
      a_wheelie_g:       dag.dynamics.wheelie_threshold_g,
      a_wheelie_ms2:     dag.dynamics.wheelie_threshold_g * G,
      a_stoppie_g:       dag.dynamics.stoppie_threshold_g,
      a_stoppie_ms2:     dag.dynamics.stoppie_threshold_g * G,
      rearSquatMm:       dag.dynamics.rear_squat_mm,
      forkDiveMm:        dag.dynamics.fork_dive_mm,
      stabilityIndex:    dag.handling.stability_index,
      agilityIndex:      dag.handling.agility_index,
      wobbleSensitivity: dag.handling.wobble_sensitivity,
      pitchSensitivity:  dag.handling.pitch_sensitivity,
      leanLimitDeg:      leanLimitDeg,
      R_turn_min_mm:     R_turn_mm,
      D_turn_circle_mm:  R_turn_mm * 2,
      gradeMaxDeg:       gradeMaxDeg,
      gradeMaxPercent:   Math.tan(gradeMaxDeg * DEG2RAD) * 100,
    },
    // ── New modules (full pipeline coverage) ─────────────────────────────────
    ...(dag.suspension ? {
      suspension: {
        ...ts.suspension,
        wheelRateFront:       dag.suspension.wheel_rate_front,
        wheelRateRear:        dag.suspension.wheel_rate_rear,
        sprungMass:           dag.suspension.sprung_mass,
        sprungMassFront:      dag.suspension.sprung_mass_front,
        sprungMassRear:       dag.suspension.sprung_mass_rear,
        natFreqFront:         dag.suspension.nat_freq_front,
        natFreqRear:          dag.suspension.nat_freq_rear,
        sagForceFront:        dag.suspension.sag_force_front,
        sagForceRear:         dag.suspension.sag_force_rear,
        sagPercentFront:      dag.suspension.sag_percent_front,
        sagPercentRear:       dag.suspension.sag_percent_rear,
        criticalDampingFront: dag.suspension.critical_damping_front,
        criticalDampingRear:  dag.suspension.critical_damping_rear,
        dampingRatioComp:     dag.suspension.damping_ratio_clicks,
        dampingRatioFront:    dag.suspension.damping_ratio_front,
        dampingRatioRear:     dag.suspension.damping_ratio_rear,
        optimalDampingFront:  dag.suspension.optimal_damping_front,
        optimalDampingRear:   dag.suspension.optimal_damping_rear,
        unsprungFreqFront:    dag.suspension.unsprung_freq_front,
        unsprungFreqRear:     dag.suspension.unsprung_freq_rear,
        loadTransfer08g:      dag.suspension.load_transfer_08g,
      },
    } : {}),
    ...(dag.ergonomics ? {
      ergonomics: {
        ...ts.ergonomics,
        d_SH:           dag.ergonomics.d_SH,
        d_SP:           dag.ergonomics.d_SP,
        d_HP:           dag.ergonomics.d_HP,
        kneeAngleDeg:   dag.ergonomics.knee_angle_deg,
        hipAngleDeg:    dag.ergonomics.hip_angle_deg,
        forwardLeanDeg: dag.ergonomics.forward_lean_deg,
      },
    } : {}),
    ...(dag.tire ? {
      tire: {
        ...ts.tire,
        frontFreeRadius:         dag.tire.front_free_radius,
        rearFreeRadius:          dag.tire.rear_free_radius,
        frontDeflection:         dag.tire.front_deflection,
        rearDeflection:          dag.tire.rear_deflection,
        frontLoadedRadius:       dag.tire.front_loaded_radius,
        rearLoadedRadius:        dag.tire.rear_loaded_radius,
        frontContactPatchLength: dag.tire.front_contact_patch_mm,
        rearContactPatchLength:  dag.tire.rear_contact_patch_mm,
        frontDynamicRadius:      dag.tire.front_dynamic_radius,
        rearDynamicRadius:       dag.tire.rear_dynamic_radius,
        frontCombinedRate:       dag.tire.front_combined_rate,
        rearCombinedRate:        dag.tire.rear_combined_rate,
        frontNatFreqCorrected:   dag.tire.front_nat_freq_corrected,
        rearNatFreqCorrected:    dag.tire.rear_nat_freq_corrected,
      },
    } : {}),
    ...(dag.fork_compliance ? {
      forkCompliance: {
        ...ts.forkCompliance,
        brakingForceFront: dag.fork_compliance.braking_force_front,
        forkDeflection:    dag.fork_compliance.fork_deflection,
        trailEffective:    dag.fork_compliance.trail_effective,
        deltaTrail:        dag.fork_compliance.delta_trail,
        steeringTorqueNm:  dag.fork_compliance.steering_torque_Nm,
        steerFlexAngle:    dag.fork_compliance.steer_flex_angle_deg,
        isPerceptible:     dag.fork_compliance.is_perceptible,
        isDangerous:       dag.fork_compliance.is_dangerous,
      },
    } : {}),
    ...(dag.aero ? {
      aero: {
        ...ts.aero,
        dragAtRef:          dag.aero.drag_at_ref,
        liftAtRef:          dag.aero.lift_at_ref,
        powerAtRef_W:       dag.aero.power_at_ref_W,
        pitchMoment_Nm:     dag.aero.pitch_moment_Nm,
        deltaWFrontAtRef_N: dag.aero.delta_W_front_at_ref_N,
        topSpeed_ms:        dag.aero.top_speed_ms,
        topSpeed_kmh:       dag.aero.top_speed_kmh,
        topSpeedGear_kmh:   dag.aero.top_speed_gear_kmh,
        topSpeedGear_ms:    dag.aero.top_speed_gear_ms,
        drag100kmh_N:       dag.aero.drag_100kmh_N,
        dynamicPressureRef: dag.aero.dynamic_pressure_ref,
      },
    } : {}),
  };
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function resultsToCSV(r: ComputeAllResult): string {
  const rows: [string, string, string, string][] = [
    ['Module', 'Parameter', 'Value', 'Unit'],
    ['Geometry', 'Trail', r.geometry.trail.toFixed(2), 'mm'],
    ['Geometry', 'Mechanical Trail', r.geometry.mechanicalTrail.toFixed(2), 'mm'],
    ['Geometry', 'Steering Offset Ground', r.geometry.steeringOffsetGround.toFixed(2), 'mm'],
    ['Geometry', 'Swingarm Angle', r.geometry.swingarmAngleDeg.toFixed(3), 'deg'],
    ['CoG', 'X_cg', r.cog.X_cg.toFixed(1), 'mm'],
    ['CoG', 'Y_cg', r.cog.Y_cg.toFixed(1), 'mm'],
    ['CoG', 'Front %', r.cog.frontPercent.toFixed(2), '%'],
    ['CoG', 'Rear %', r.cog.rearPercent.toFixed(2), '%'],
    ['CoG', 'Total Mass', r.cog.totalMass.toFixed(1), 'kg'],
    ['CoG', 'R Front', r.cog.R_front.toFixed(0), 'N'],
    ['CoG', 'R Rear', r.cog.R_rear.toFixed(0), 'N'],
    ['Suspension', 'Wheel Rate Front', r.suspension.wheelRateFront.toFixed(3), 'N/mm'],
    ['Suspension', 'Wheel Rate Rear', r.suspension.wheelRateRear.toFixed(3), 'N/mm'],
    ['Suspension', 'Nat. Freq. Front', r.suspension.natFreqFront.toFixed(4), 'Hz'],
    ['Suspension', 'Nat. Freq. Rear', r.suspension.natFreqRear.toFixed(4), 'Hz'],
    ['Suspension', 'Sag % Front', r.suspension.sagPercentFront.toFixed(2), '%'],
    ['Suspension', 'Sag % Rear', r.suspension.sagPercentRear.toFixed(2), '%'],
    ['Suspension', 'Sprung Mass', r.suspension.sprungMass.toFixed(1), 'kg'],
    ['Suspension', 'Load Transfer 0.8g', r.suspension.loadTransfer08g.toFixed(0), 'N'],
    ['AntiSquat', 'Gear Ratio', r.antiSquat.gearRatio.toFixed(4), ''],
    ['AntiSquat', 'IC x', r.antiSquat.IC_x.toFixed(0), 'mm'],
    ['AntiSquat', 'IC y', r.antiSquat.IC_y.toFixed(0), 'mm'],
    ['AntiSquat', 'Anti-Squat %', r.antiSquat.antiSquatPercent.toFixed(1), '%'],
    ['AntiSquat', 'Chain Contribution', r.antiSquat.chainContribution.toFixed(1), '%'],
    ['AntiSquat', 'Anti-Dive %', r.antiSquat.antiDivePercent.toFixed(1), '%'],
    ['Ergonomics', 'Knee Angle', r.ergonomics.kneeAngleDeg.toFixed(1), 'deg'],
    ['Ergonomics', 'Hip Angle', r.ergonomics.hipAngleDeg.toFixed(1), 'deg'],
    ['Ergonomics', 'Forward Lean', r.ergonomics.forwardLeanDeg.toFixed(1), 'deg'],
    ['Ergonomics', 'Seat-Handle dist', r.ergonomics.d_SH.toFixed(0), 'mm'],
    ['Dynamics', 'Front % Braking', r.dynamics.frontPercentBraking.toFixed(1), '%'],
    ['Dynamics', 'Front % Accel', r.dynamics.frontPercentAccel.toFixed(1), '%'],
    ['Dynamics', 'Bank Angle', r.dynamics.bankAngleDeg.toFixed(1), 'deg'],
    ['Dynamics', 'Lateral Force', r.dynamics.lateralForce.toFixed(0), 'N'],
    ['Dynamics', 'dW Brake', r.dynamics.deltaW_brake.toFixed(0), 'N'],
    ['Dynamics', 'dW Accel', r.dynamics.deltaW_accel.toFixed(0), 'N'],
    ['Tire', 'Front Free Radius', r.tire.frontFreeRadius.toFixed(1), 'mm'],
    ['Tire', 'Rear Free Radius', r.tire.rearFreeRadius.toFixed(1), 'mm'],
    ['Tire', 'Front Deflection', r.tire.frontDeflection.toFixed(2), 'mm'],
    ['Tire', 'Rear Deflection', r.tire.rearDeflection.toFixed(2), 'mm'],
    ['Tire', 'Front Contact Patch', r.tire.frontContactPatchLength.toFixed(1), 'mm'],
    ['Tire', 'Rear Contact Patch', r.tire.rearContactPatchLength.toFixed(1), 'mm'],
    ['Inertia', 'I_pitch', r.inertia.I_pitch.toFixed(3), 'kg·m²'],
    ['Inertia', 'I_roll', r.inertia.I_roll.toFixed(3), 'kg·m²'],
    ['Inertia', 'I_yaw', r.inertia.I_yaw.toFixed(3), 'kg·m²'],
    ['Stability', 'Wheelie g', r.stability.a_wheelie_g.toFixed(3), 'g'],
    ['Stability', 'Stoppie g', r.stability.a_stoppie_g.toFixed(3), 'g'],
    ['Stability', 'Lean Limit', r.stability.leanLimitDeg.toFixed(1), 'deg'],
    ['Stability', 'Min Turn Radius', r.stability.R_turn_min_mm.toFixed(0), 'mm'],
    ['Stability', 'Max Grade', r.stability.gradeMaxDeg.toFixed(1), 'deg'],
    ['ForkCompliance', 'Fork Deflection', r.forkCompliance.forkDeflection.toFixed(2), 'mm'],
    ['ForkCompliance', 'Effective Trail', r.forkCompliance.trailEffective.toFixed(1), 'mm'],
    ['ForkCompliance', 'Steer Flex Angle', r.forkCompliance.steerFlexAngle.toFixed(3), 'deg'],
  ];
  return rows.map(r => r.join(',')).join('\n');
}

// Try to restore last session from localStorage on startup
function loadInitialInput(): { input: ComputeAllInput; familyName: string } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { input: ComputeAllInput; familyName: string };
      if (saved.input && saved.familyName) return saved;
    }
  } catch { /* ignore */ }
  return { input: FAMILIES[0].input, familyName: FAMILIES[0].name };
}

const { input: defaultInput, familyName: defaultFamily } = loadInitialInput();
const initial = safeCompute(defaultInput);

export const useStore = create<StoreState>((set, get) => ({
  input: defaultInput,
  results: initial.results!,
  familyName: defaultFamily,
  familyNameDisplay: defaultFamily,
  error: initial.error,

  savedConfigs: loadSavedConfigs(),
  customBikes: loadCustomBikes(),

  // Backend sync — starts offline; useBackendSync hook drives transitions
  backendStatus: 'offline',
  backendResults: null,
  backendDynamics: null,
  setBackendStatus: (status) => set({ backendStatus: status }),

  // R&D — Design Targets (sensible defaults covering common sport/naked targets)
  targetConfig: {
    trail:                { enabled: true,  lo: 80,   hi: 120  },
    frontPercent:         { enabled: true,  lo: 44,   hi: 56   },
    antiSquatPercent:     { enabled: true,  lo: 70,   hi: 110  },
    natFreqFront:         { enabled: true,  lo: 0.8,  hi: 1.4  },
    natFreqRear:          { enabled: true,  lo: 1.2,  hi: 3.0  },
    sagPercentFront:      { enabled: true,  lo: 22,   hi: 30   },
    sagPercentRear:       { enabled: true,  lo: 22,   hi: 30   },
    wheelRateFront:       { enabled: false, lo: 5,    hi: 18   },
    wheelRateRear:        { enabled: false, lo: 20,   hi: 60   },
    cogHeight:            { enabled: false, lo: 500,  hi: 750  },
    sprungUnsprungRatioF: { enabled: false, lo: 5,    hi: 12   },
    sprungUnsprungRatioR: { enabled: false, lo: 5,    hi: 12   },
  },
  setTargetConfig: (patch) => set(s => ({ targetConfig: { ...s.targetConfig, ...patch } })),

  applyOptimizedInput: (input) => {
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  // ── R5 — Design Journal ────────────────────────────────────────────────────
  snapshots: loadSnapshots(),

  addSnapshot: (label, fromTab) => {
    const { input, results, familyName, snapshots } = get();
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const snap: DesignSnapshot = {
      id, label, note: '', timestamp: Date.now(), fromTab, familyName,
      input: JSON.parse(JSON.stringify(input)),
      kpis: {
        trail:      results.geometry?.trail       ?? 0,
        frontPct:   results.cog?.frontPercent     ?? 0,
        natFreqF:   results.suspension?.natFreqFront ?? 0,
        natFreqR:   results.suspension?.natFreqRear  ?? 0,
        antiSquat:  results.antiSquat?.antiSquatPercent ?? 0,
        wheelRateF: results.suspension?.wheelRateFront ?? 0,
        wheelRateR: results.suspension?.wheelRateRear  ?? 0,
        sagF:       results.suspension?.sagPercentFront ?? 0,
        sagR:       results.suspension?.sagPercentRear  ?? 0,
      },
    };
    const updated = [...snapshots.slice(-(SNAPSHOT_MAX - 1)), snap];
    persistSnapshots(updated);
    set({ snapshots: updated });
    return id;
  },

  deleteSnapshot: (id) => {
    const updated = get().snapshots.filter(s => s.id !== id);
    persistSnapshots(updated);
    set({ snapshots: updated });
  },

  updateSnapshot: (id, label, note) => {
    const updated = get().snapshots.map(s => s.id === id ? { ...s, label, note } : s);
    persistSnapshots(updated);
    set({ snapshots: updated });
  },

  loadSnapshot: (id) => {
    const snap = get().snapshots.find(s => s.id === id);
    if (!snap) return;
    const { results, error } = computeAndMerge(snap.input, get().backendResults);
    set({ input: snap.input, results: results ?? get().results, error,
          familyName: snap.familyName, familyNameDisplay: snap.familyName });
  },

  setBackendResults: (dag, dynamics) => {
    if (dag) {
      const merged = mergeBackendIntoResults(get().results, dag, get().input);
      set({ backendResults: dag, backendDynamics: dynamics, results: merged });
    } else {
      set({ backendResults: null, backendDynamics: dynamics });
    }
  },

  saveCurrentConfig: (name) => {
    const { input, savedConfigs } = get();
    const id = `${Date.now()}`;
    const newConfig: SavedConfig = { id, name, input: JSON.parse(JSON.stringify(input)), savedAt: Date.now() };
    const updated = [...savedConfigs.slice(-7), newConfig]; // max 8
    localStorage.setItem(CONFIGS_LS_KEY, JSON.stringify(updated));
    set({ savedConfigs: updated });
  },

  removeSavedConfig: (id) => {
    const updated = get().savedConfigs.filter(c => c.id !== id);
    localStorage.setItem(CONFIGS_LS_KEY, JSON.stringify(updated));
    set({ savedConfigs: updated });
  },

  renameSavedConfig: (id, name) => {
    const updated = get().savedConfigs.map(c => c.id === id ? { ...c, name } : c);
    localStorage.setItem(CONFIGS_LS_KEY, JSON.stringify(updated));
    set({ savedConfigs: updated });
  },

  addToSweep: (input, name) => {
    const { savedConfigs } = get();
    if (savedConfigs.length >= 8) return;
    const id = `lib_${Date.now()}`;
    const newConfig: SavedConfig = { id, name, input: JSON.parse(JSON.stringify(input)), savedAt: Date.now() };
    const updated = [...savedConfigs, newConfig];
    localStorage.setItem(CONFIGS_LS_KEY, JSON.stringify(updated));
    set({ savedConfigs: updated });
  },

  saveCustomBike: (name, description, inputOverride) => {
    const { input, customBikes } = get();
    const id = `custom_${Date.now()}`;
    const bike: CustomBike = {
      id, name, description,
      input: JSON.parse(JSON.stringify(inputOverride ?? input)),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const updated = [...customBikes, bike];
    localStorage.setItem(CUSTOM_BIKES_LS_KEY, JSON.stringify(updated));
    set({ customBikes: updated });
    return id;
  },

  updateCustomBike: (id, input) => {
    const updated = get().customBikes.map(b =>
      b.id === id ? { ...b, input: JSON.parse(JSON.stringify(input)), updatedAt: Date.now() } : b
    );
    localStorage.setItem(CUSTOM_BIKES_LS_KEY, JSON.stringify(updated));
    set({ customBikes: updated });
  },

  removeCustomBike: (id) => {
    const updated = get().customBikes.filter(b => b.id !== id);
    localStorage.setItem(CUSTOM_BIKES_LS_KEY, JSON.stringify(updated));
    set({ customBikes: updated });
  },

  renameCustomBike: (id, name, description) => {
    const updated = get().customBikes.map(b =>
      b.id === id ? { ...b, name, description, updatedAt: Date.now() } : b
    );
    localStorage.setItem(CUSTOM_BIKES_LS_KEY, JSON.stringify(updated));
    set({ customBikes: updated });
  },

  loadCustomBike: (id) => {
    const bike = get().customBikes.find(b => b.id === id);
    if (!bike) return;
    const { results, error } = computeAndMerge(bike.input, get().backendResults);
    set({ input: bike.input, results: results ?? get().results, error, familyName: bike.id, familyNameDisplay: bike.name });
  },

  visibility: DEFAULT_VISIBILITY,
  setVisibility: (patch) => set(s => ({ visibility: { ...s.visibility, ...patch } })),

  setGeometry: (patch) => {
    const prevGeom = get().input.geometry;
    const geom = { ...prevGeom, ...patch };
    let massComponents = get().input.massComponents;

    // ── Constraint 1: Ground contact — axle height must equal wheel radius ──
    if (patch.rearWheelDia !== undefined) {
      geom.rearAxleHeight = geom.rearWheelDia / 2;
    }
    if (patch.frontWheelDia !== undefined) {
      geom.frontAxleHeight = geom.frontWheelDia / 2;
    }

    // ── Constraint 2: Swingarm / wheelbase coupling ──────────────────────────
    // The swingarm is a rigid component. Given pivot position (X_sp, H_sp),
    // swingarm length L_sa, and rear axle height H_ra (= R_r, ground-fixed):
    //
    //   WB = X_sp + √(L_sa² − (H_ra − H_sp)²)
    //
    // Rule A: if ANY swingarm geometry param changed → re-derive wheelbase.
    //         (the rear axle follows the swingarm — pivot moves in the frame)
    // Rule B: if wheelbase changed directly (no swingarm param changed) →
    //         re-derive swingarmPivotX so the pivot slides fore/aft to achieve
    //         the requested WB while keeping L_sa and H_sp constant.

    const swingarmChanged =
      patch.swingarmPivotX      !== undefined ||
      patch.swingarmPivotHeight !== undefined ||
      patch.swingarmLength      !== undefined ||
      patch.rearAxleHeight      !== undefined ||
      patch.rearWheelDia        !== undefined;   // rearWheelDia changes H_ra

    const wbChangedAlone = patch.wheelbase !== undefined && !swingarmChanged;

    // Horizontal reach of swingarm: √(L_sa² − ΔY²)
    const deltaY     = geom.rearAxleHeight - geom.swingarmPivotHeight;
    const L_horiz_sq = geom.swingarmLength * geom.swingarmLength - deltaY * deltaY;
    const geometryFeasible = L_horiz_sq >= 0;

    if (swingarmChanged && geometryFeasible) {
      geom.wheelbase = geom.swingarmPivotX + Math.sqrt(L_horiz_sq);
    } else if (wbChangedAlone && geometryFeasible) {
      geom.swingarmPivotX = geom.wheelbase - Math.sqrt(L_horiz_sq);
    }

    // ── Constraint 3: Frame-relative mass coupling ───────────────────────────
    //
    // Masses (engine, rider, fuel, etc.) are FRAME-MOUNTED components.
    // When frame geometry changes the masses move with the frame:
    //
    // 3a) Swingarm LENGTH or direct WHEELBASE change → frame stretches/shrinks.
    //     All mass X positions (from front axle) scale proportionally so the
    //     CoG distribution (CoG% of WB) is preserved.
    //     → X_cg changes in mm → CoG marker moves horizontally in the viz.
    //
    // 3b) Swingarm PIVOT HEIGHT change → frame rises or drops.
    //     All mass Y positions (from ground) shift by the same ΔH so every
    //     frame-mounted component tracks the new chassis height.
    //     → Y_cg changes → reflected in RCards and load distribution.

    // 3a: Wheelbase scaling
    const oldWB = prevGeom.wheelbase;
    const newWB = geom.wheelbase;
    if (Math.abs(newWB - oldWB) > 0.01 && oldWB > 0) {
      const ratio = newWB / oldWB;
      massComponents = massComponents.map(mc => ({
        ...mc,
        x: mc.x * ratio,
      }));
    }

    // 3b: Frame height shift
    const oldHsp = prevGeom.swingarmPivotHeight;
    const newHsp = geom.swingarmPivotHeight;
    if (Math.abs(newHsp - oldHsp) > 0.01) {
      const dH = newHsp - oldHsp;
      massComponents = massComponents.map(mc => ({
        ...mc,
        y: Math.max(mc.y + dH, 0),
      }));
    }

    const input = { ...get().input, geometry: geom, massComponents };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setSuspension: (patch) => {
    const input = { ...get().input, suspension: { ...get().input.suspension, ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setChain: (patch) => {
    const input = { ...get().input, chain: { ...get().input.chain, ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setErgo: (patch) => {
    const input = { ...get().input, ergo: { ...get().input.ergo, ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setDynamics: (patch) => {
    const input = { ...get().input, dynamics: { ...get().input.dynamics, ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setMassComponents: (massComponents) => {
    const unsprungPatch = syncUnsprungFromMass(massComponents);
    const suspension = { ...get().input.suspension, ...unsprungPatch };
    const input = { ...get().input, massComponents, suspension };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  updateMassComponent: (index, patch) => {
    const massComponents = get().input.massComponents.map((c, i) =>
      i === index ? { ...c, ...patch } : c
    );
    const unsprungPatch = syncUnsprungFromMass(massComponents);
    const suspension = { ...get().input.suspension, ...unsprungPatch };
    const input = { ...get().input, massComponents, suspension };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  loadFamily: (name) => {
    const preset = FAMILIES.find(f => f.name === name);
    if (!preset) return;
    const { results, error } = computeAndMerge(preset.input, get().backendResults);
    set({ input: preset.input, results: results ?? get().results, error, familyName: name, familyNameDisplay: name });
  },

  setTire: (patch) => {
    const input = { ...get().input, tire: { ...(get().input.tire ?? DEFAULT_TIRE_PARAMS), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setKinematics: (patch) => {
    const input = { ...get().input, kinematics: { ...(get().input.kinematics ?? DEFAULT_KINEMATICS_PARAMS), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setStability: (patch) => {
    const input = { ...get().input, stability: { ...(get().input.stability ?? DEFAULT_STABILITY_PARAMS), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setForkCompliance: (patch) => {
    const input = { ...get().input, forkCompliance: { ...(get().input.forkCompliance ?? DEFAULT_FORK_COMPLIANCE_PARAMS), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setFEMSection: (patch) => {
    const input = { ...get().input, femSection: { ...(get().input.femSection ?? DEFAULT_FEM_SECTION), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setSweep: (patch) => {
    const input = { ...get().input, sweep: { ...(get().input.sweep ?? DEFAULT_SWEEP_PARAMS), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  setAero: (patch) => {
    const DEFAULT_AERO: AeroParams = {
      Cx: 0.38, Cz: -0.05, frontalArea: 0.35, pressureCentreX: 750,
      referenceSpeedKmh: 200, maxSpeedKmh: 300, enginePower_kW: 150, drivetrainEta: 0.88,
    };
    const input = { ...get().input, aero: { ...(get().input.aero ?? DEFAULT_AERO), ...patch } };
    const { results, error } = computeAndMerge(input, get().backendResults);
    set({ input, results: results ?? get().results, error });
  },

  saveSession: () => {
    const { input, familyName } = get();
    localStorage.setItem(LS_KEY, JSON.stringify({ input, familyName }));
  },

  loadSession: () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { input: ComputeAllInput; familyName: string };
      const { results, error } = safeCompute(saved.input);
      set({ input: saved.input, results: results ?? get().results, error, familyName: saved.familyName });
    } catch { /* ignore */ }
  },

  hasSavedSession: () => !!localStorage.getItem(LS_KEY),

  exportJSON: () => {
    const { input, results, familyName } = get();
    const payload = JSON.stringify({ familyName, input, results }, null, 2);
    triggerDownload(payload, `chassis-${familyName.replace(/\W+/g, '_')}.json`, 'application/json');
  },

  exportCSV: () => {
    const { results, familyName } = get();
    const csv = resultsToCSV(results);
    triggerDownload(csv, `chassis-${familyName.replace(/\W+/g, '_')}.csv`, 'text/csv');
  },
}));
