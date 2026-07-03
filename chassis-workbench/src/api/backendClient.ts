/**
 * backendClient.ts — Typed HTTP client for the FastAPI backend.
 *
 * All computation runs client-side in TypeScript by default.
 * When the Python backend is reachable, it provides:
 *   • DAG analysis — coupled geometry solver, handling indices
 *   • Dynamics sweep — multi-g braking/accel table
 *   • Anti-squat sweep — Cossalter squat ratio over suspension travel
 *
 * The frontend remains fully functional when the backend is offline.
 */

import { ComputeAllInput } from '../engine/types';

// In Electron the page loads from file:// — the Vite proxy isn't active.
// Detect Electron via the preload-injected flag and use the direct HTTP URL.
const isElectron: boolean =
  typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

const BASE = isElectron ? 'http://localhost:8770/api' : '/api';
const TIMEOUT_MS = 10000;  // 10s — R&D accuracy over speed; large sweeps may take time
const CHAIN_PITCH = 15.875; // mm — 520 chain

// ── Response types ────────────────────────────────────────────────────────────

export interface DagGeometry {
  wheelbase: number;
  swingarm_angle: number;
  trail: number;
  mechanical_trail: number;
  front_axle_height: number;
  rear_axle_height: number;
}

export interface DagCog {
  x_cg: number;
  y_cg: number;
  total_mass: number;
  r_front: number;
  r_rear: number;
  front_pct: number;
  rear_pct: number;
}

export interface DagAntiSquat {
  chain_force_angle: number;
  ic_x: number;
  ic_y: number;
  anti_squat_pct: number;
  squat_ratio: number;
}

export interface DagDynamics {
  load_transfer_accel: number;
  load_transfer_brake: number;
  rear_squat_mm: number;
  fork_dive_mm: number;
  wheelie_threshold_g: number;
  stoppie_threshold_g: number;
}

export interface DagCornering {
  lean_angle_deg: number;
  lateral_load_transfer: number;
  turning_radius: number;
}

export interface DagInertia {
  i_yaw: number;
  i_pitch: number;
}

export interface DagHandling {
  stability_index: number;
  agility_index: number;
  wobble_sensitivity: number;
  pitch_sensitivity: number;
}

// ── New module types (ported this session) ────────────────────────────────────

export interface DagSuspension {
  wheel_rate_front: number; wheel_rate_rear: number;
  sprung_mass: number; sprung_mass_front: number; sprung_mass_rear: number;
  nat_freq_front: number; nat_freq_rear: number;
  sag_force_front: number; sag_force_rear: number;
  sag_percent_front: number; sag_percent_rear: number;
  critical_damping_front: number; critical_damping_rear: number;
  damping_ratio_clicks: number; damping_ratio_front: number; damping_ratio_rear: number;
  optimal_damping_front: number; optimal_damping_rear: number;
  unsprung_freq_front: number; unsprung_freq_rear: number;
  load_transfer_08g: number;
}

export interface DagErgonomics {
  d_SH: number; d_SP: number; d_HP: number;
  knee_angle_deg: number; hip_angle_deg: number; forward_lean_deg: number;
}

export interface DagTire {
  front_free_radius: number; rear_free_radius: number;
  front_deflection: number; rear_deflection: number;
  front_loaded_radius: number; rear_loaded_radius: number;
  front_contact_patch_mm: number; rear_contact_patch_mm: number;
  front_dynamic_radius: number; rear_dynamic_radius: number;
  front_combined_rate: number; rear_combined_rate: number;
  front_nat_freq_corrected: number; rear_nat_freq_corrected: number;
}

export interface DagKinematicsPoint {
  travel_mm: number; axle_x: number; axle_y: number;
  wheelbase_mm: number; delta_wheelbase_mm: number;
  chain_cd_mm: number; delta_chain_mm: number; swingarm_angle_deg: number;
}

export interface DagKinematics {
  rear_wheel_travel: number; static_index: number;
  max_wheelbase_change: number; max_chain_length_change: number;
  positions: DagKinematicsPoint[];
}

export interface DagForkCompliance {
  braking_force_front: number; fork_deflection: number;
  trail_effective: number; delta_trail: number;
  steering_torque_Nm: number; steer_flex_angle_deg: number;
  is_perceptible: boolean; is_dangerous: boolean;
}

export interface DagAeroPoint {
  speed_kmh: number; drag_N: number; lift_N: number;
  power_W: number; delta_W_front_N: number;
}

export interface DagAero {
  drag_at_ref: number; lift_at_ref: number; power_at_ref_W: number;
  pitch_moment_Nm: number; delta_W_front_at_ref_N: number;
  top_speed_ms: number; top_speed_kmh: number;
  top_speed_gear_ms: number; top_speed_gear_kmh: number;
  drag_100kmh_N: number; dynamic_pressure_ref: number;
  speed_sweep: DagAeroPoint[];
}

export interface DagAnalysisResult {
  geometry: DagGeometry;
  cog: DagCog;
  anti_squat: DagAntiSquat;
  dynamics: DagDynamics;
  cornering: DagCornering;
  inertia: DagInertia;
  handling: DagHandling;
  suspension: DagSuspension;
  ergonomics: DagErgonomics;
  tire: DagTire;
  kinematics: DagKinematics;
  fork_compliance: DagForkCompliance;
  aero: DagAero;
}

export interface BrakePoint {
  decel_g: number;
  weight_transfer_N: number;
  R_front_N: number;
  R_rear_N: number;
  front_pct: number;
  anti_dive_pct: number;
  fork_compression_mm: number;
  rear_extension_mm: number;
}

export interface AccelPoint {
  accel_g: number;
  weight_transfer_N: number;
  R_front_N: number;
  R_rear_N: number;
  front_pct: number;
  wheelie_margin_pct: number;
}

export interface DynamicsResult {
  braking: BrakePoint[];
  accel: AccelPoint[];
  total_weight_N: number;
  x_cg_mm: number;
  y_cg_mm: number;
  total_mass_kg: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Backend ${path} returned ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ── Input serialisers ─────────────────────────────────────────────────────────

function toDagRequest(input: ComputeAllInput) {
  const geo   = input.geometry;
  const chain = input.chain;
  const susp  = input.suspension;
  const dyn   = input.dynamics;
  const ergo  = input.ergo;
  const aero  = input.aero;
  const tire  = input.tire;
  const fork  = input.forkCompliance;
  const X_sp  = geo.swingarmPivotX;
  const H_sp  = geo.swingarmPivotHeight;

  return {
    // Geometry
    swingarm_length:          geo.swingarmLength,
    swingarm_pivot_x:         X_sp,
    swingarm_pivot_height:    H_sp,
    rear_wheel_diameter:      geo.rearWheelDia,
    front_wheel_diameter:     geo.frontWheelDia,
    head_angle_deg:           geo.headAngle,
    fork_offset:              geo.forkOffset,
    wheelbase:                geo.wheelbase,
    // Chain
    front_sprocket:           chain.frontSprocket,
    rear_sprocket:            chain.rearSprocket,
    drive_sprocket_radius:    (chain.frontSprocket * CHAIN_PITCH) / (2 * Math.PI),
    rear_sprocket_radius:     (chain.rearSprocket  * CHAIN_PITCH) / (2 * Math.PI),
    countershaft_x:           X_sp + chain.sprocketCenterX,
    countershaft_height:      H_sp + chain.sprocketCenterY,
    sprocket_center_x:        chain.sprocketCenterX,
    sprocket_center_y:        chain.sprocketCenterY,
    // Suspension
    front_spring_rate:        susp.springRateFront,
    rear_spring_rate:         susp.springRateRear,
    front_motion_ratio:       susp.motionRatioFront,
    rear_motion_ratio:        susp.motionRatioRear,
    unsprung_front:           susp.unsprungFront,
    unsprung_rear:            susp.unsprungRear,
    sag_front:                susp.sagFront,
    sag_rear:                 susp.sagRear,
    preload_front:            susp.preloadFront,
    preload_rear:             susp.preloadRear,
    fork_travel:              susp.forkTravel,
    shock_travel:             susp.shockTravel,
    comp_damping_clicks:      susp.compDamping,
    damping_coeff_front:      susp.dampingCoeffFront ?? 12.0,
    damping_coeff_rear:       susp.dampingCoeffRear  ?? 18.0,
    anti_dive_pct:            25.0,
    // Ergonomics
    handlebar_x:              ergo.handlebarX,
    handlebar_y:              ergo.handlebarY,
    seat_x:                   ergo.seatX,
    seat_y:                   ergo.seatY,
    footpeg_x:                ergo.footpegX,
    footpeg_y:                ergo.footpegY,
    // Tire
    front_section_width:      tire?.frontSectionWidth  ?? 120,
    front_aspect_ratio:       tire?.frontAspectRatio   ?? 70,
    front_rim_dia_inches:     tire?.frontRimDiameter   ?? 17,
    front_tire_stiffness:     tire?.frontTireStiffness ?? 180,
    rear_section_width:       tire?.rearSectionWidth   ?? 190,
    rear_aspect_ratio:        tire?.rearAspectRatio    ?? 55,
    rear_rim_dia_inches:      tire?.rearRimDiameter    ?? 17,
    rear_tire_stiffness:      tire?.rearTireStiffness  ?? 200,
    speed_kmh:                tire?.speedKmh ?? 100,
    // Fork compliance
    fork_bending_stiffness:   fork?.forkBendingStiffness    ?? 45,
    fork_torsional_stiffness: fork?.forkTorsionalStiffness  ?? 450,
    // Aero
    aero_Cx:                  aero?.Cx                ?? 0.35,
    aero_Cz:                  aero?.Cz                ?? -0.1,
    aero_frontal_area:        aero?.frontalArea        ?? 0.35,
    engine_power_kW:          aero?.enginePower_kW    ?? 150,
    drivetrain_eta:           aero?.drivetrainEta     ?? 0.88,
    max_speed_kmh:            aero?.maxSpeedKmh       ?? 280,
    reference_speed_kmh:      aero?.referenceSpeedKmh ?? 200,
    pressure_centre_x:        aero?.pressureCentreX   ?? 600,
    top_gear_ratio_overall:   aero?.topGearRatioOverall ?? 0,
    max_rpm:                  aero?.maxRPM              ?? 0,
    // Scenario
    accel_g:                  dyn.accelG,
    brake_g:                  dyn.brakingDecel,
    lateral_accel_g:          0.8,
    track_width_mm:           dyn.trackWidth ?? 1400.0,
    // Mass
    mass_components: input.massComponents.map(mc => ({
      mass: mc.mass, x: mc.x, y: mc.y, label: mc.label ?? '',
    })),
  };
}

function toDynamicsRequest(input: ComputeAllInput) {
  const geo   = input.geometry;
  const chain = input.chain;
  const susp  = input.suspension;
  const dyn   = input.dynamics;
  return {
    geometry: {
      headAngle:            geo.headAngle,
      forkOffset:           geo.forkOffset,
      frontWheelDia:        geo.frontWheelDia,
      rearWheelDia:         geo.rearWheelDia,
      wheelbase:            geo.wheelbase,
      swingarmLength:       geo.swingarmLength,
      swingarmPivotHeight:  geo.swingarmPivotHeight,
      swingarmPivotX:       geo.swingarmPivotX,
      rearAxleHeight:       geo.rearAxleHeight,
    },
    suspension: {
      springRateFront:  susp.springRateFront,
      springRateRear:   susp.springRateRear,
      motionRatioFront: susp.motionRatioFront,
      motionRatioRear:  susp.motionRatioRear,
      unsprungFront:    susp.unsprungFront,
      unsprungRear:     susp.unsprungRear,
      sagFront: susp.sagFront, sagRear: susp.sagRear,
      preloadFront: susp.preloadFront, preloadRear: susp.preloadRear,
      compDamping: susp.compDamping, rebDamping: susp.rebDamping,
      forkTravel: susp.forkTravel, shockTravel: susp.shockTravel,
    },
    mass_components: input.massComponents.map(mc => ({
      mass: mc.mass, x: mc.x, y: mc.y, label: mc.label ?? '',
    })),
    chain: {
      frontSprocket:    chain.frontSprocket,
      rearSprocket:     chain.rearSprocket,
      sprocketCenterX:  chain.sprocketCenterX,
      sprocketCenterY:  chain.sprocketCenterY,
      chainForceAngle:  chain.chainForceAngle,
    },
    brake_bias_front:     0.70,
    decel_max_g:          dyn.brakingDecel > 0 ? dyn.brakingDecel : 1.2,
    accel_max_g:          dyn.accelG > 0 ? dyn.accelG : 1.0,
    d_g:                  0.1,
    motion_ratio_static:  susp.motionRatioRear,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${BASE}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runDagAnalysis(input: ComputeAllInput): Promise<DagAnalysisResult> {
  return post<DagAnalysisResult>('/dag-analysis', toDagRequest(input));
}

export async function runDynamics(input: ComputeAllInput): Promise<DynamicsResult> {
  return post<DynamicsResult>('/dynamics', toDynamicsRequest(input));
}

// ── R&D endpoints (R2/R3/R4) ──────────────────────────────────────────────────

export interface BackendSensCell { elasticity: number; raw_deriv: number; }
export interface BackendSensParam { id: string; label: string; group: string; unit: string; }
export interface BackendSensKPI   { id: string; label: string; unit: string; }
export interface BackendSensResult {
  params:         BackendSensParam[];
  kpis:           BackendSensKPI[];
  cells:          BackendSensCell[][];  // [paramIdx][kpiIdx]
  baseline_kpi:   number[];
  baseline_param: number[];
  perturb_pct:    number;
  compute_ms:     number;
}

export async function runSensitivity(
  input:        ComputeAllInput,
  perturbPct:   number,
  activeGroups: string[],
): Promise<BackendSensResult> {
  return post<BackendSensResult>('/sensitivity', {
    bike:          toDagRequest(input),
    perturb_pct:   perturbPct,
    active_groups: activeGroups,
  });
}

export interface BackendKPIStats {
  id:         string;
  label:      string;
  unit:       string;
  values:     number[];
  mean:       number;
  std:        number;
  p10:        number;
  p50:        number;
  p90:        number;
  pass_rate:  number | null;
  nominal:    number;
  target_lo:  number | null;
  target_hi:  number | null;
}

export interface BackendMCResult {
  n:                 number;
  elapsed_ms:        number;
  overall_pass_rate: number;
  kpis:              BackendKPIStats[];
}

export async function runMonteCarloBackend(
  input:      ComputeAllInput,
  tolerances: Record<string, number>,
  nSamples:   number,
  targets:    Record<string, { enabled: boolean; lo: number; hi: number }>,
): Promise<BackendMCResult> {
  return post<BackendMCResult>('/monte-carlo', {
    bike:       toDagRequest(input),
    tolerances,
    n_samples:  nSamples,
    targets,
  });
}

export interface BackendParticleResult {
  fitness:    number;
  kpi_values: Record<string, number>;
  kpi_scores: Record<string, number>;
}

export async function evalBatch(
  input:     ComputeAllInput,
  positions: Record<string, number>[],
  targets:   Record<string, { enabled: boolean; lo: number; hi: number }>,
): Promise<BackendParticleResult[]> {
  const res = await post<{ results: BackendParticleResult[] }>('/eval-batch', {
    bike:      toDagRequest(input),
    positions,
    targets,
  });
  return res.results;
}
