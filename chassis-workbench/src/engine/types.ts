/**
 * types.ts — All TypeScript interfaces for the Motorcycle Chassis
 * Dynamics Workbench physics engine.
 *
 * Spec reference: Section 16 — Data Models & State Management
 * Version: v3.0
 *
 * UNIT CONVENTIONS (enforced throughout the engine):
 *   Lengths   : mm
 *   Angles    : degrees in public API, radians inside functions
 *   Mass      : kg
 *   Force     : N
 *   Spring    : N/mm
 *   Frequency : Hz
 *   Speed     : m/s (dynamics module only)
 *   Distance  : m   (dynamics module only, for radius/track)
 */

// ─────────────────────────────────────────────
// INPUT PARAMETER INTERFACES
// ─────────────────────────────────────────────

/** Section 5.1 — 18 primary chassis geometry inputs */
export interface GeometryParams {
  headAngle: number;           // degrees  — steering axis angle from vertical (rake)
  forkOffset: number;          // mm       — perpendicular distance: steering axis to front axle
  forkLength: number;          // mm       — total fork assembly length
  frontWheelDia: number;       // mm       — outer diameter of front wheel + tyre (D_f)
  rearWheelDia: number;        // mm       — outer diameter of rear wheel + tyre (D_r)
  wheelbase: number;           // mm       — centre-to-centre: front axle to rear axle
  swingarmLength: number;      // mm       — centre-to-centre: pivot to rear axle (L_sa)
  swingarmPivotHeight: number; // mm       — swingarm pivot height above ground (H_sp)
  swingarmPivotX: number;      // mm       — horizontal distance: front axle to pivot (X_sp)
  rearAxleHeight: number;      // mm       — rear axle centre above ground (H_ra)
  frontAxleHeight: number;     // mm       — front axle centre above ground (= R_f on level ground)
  steeringOffset: number;      // mm       — additional lateral offset at steering head (δ_s)
  seatHeight: number;          // mm       — lowest point of seat above ground (H_seat)
  groundClearance: number;     // mm       — lowest frame point above ground (H_gc)
}

/** Single mass component for CoG computation — Section 6 */
export interface MassComponent {
  mass: number;   // kg
  x: number;      // mm from front axle (positive toward rear)
  y: number;      // mm from ground (positive upward)
  label: string;  // e.g. "engine", "rider", "battery"
  z?: number;     // mm lateral offset from centreline (optional, defaults to 0)
  /** Tag this component as part of the front or rear unsprung assembly.
   *  When tagged, all tagged components' masses auto-sum into
   *  suspension.unsprungFront / suspension.unsprungRear. */
  unsprungSide?: 'front' | 'rear' | null;
}

/** Section 6 — Mass and CoG inputs */
export interface MassParams {
  dryWeight: number;       // kg — vehicle dry weight
  riderWeight: number;     // kg
  pillionWeight: number;   // kg
  luggageWeight: number;   // kg
  fuelCapacity: number;    // litres
  fuelLevel: number;       // 0–100 %
  engineWeight: number;    // kg
  engineX: number;         // mm from front axle
  engineY: number;         // mm from ground
  frameWeight: number;     // kg
  frameX: number;          // mm from front axle
  frameY: number;          // mm from ground
  riderX: number;
  riderY: number;
  pillionX: number;
  pillionY: number;
  luggageX: number;
  luggageY: number;
}

/** Detailed front unsprung mass breakdown — optional; when provided, sum should equal unsprungFront */
export interface UnsprungComponentsFront {
  wheelRim: number;       // kg — rim + spokes + hub
  tyre: number;           // kg
  brakeDisc: number;      // kg
  brakeCaliper: number;   // kg
  lowerForkLegs: number;  // kg — lower tubes below axle clamps + axle
}

/** Detailed rear unsprung mass breakdown — optional; when provided, sum should equal unsprungRear */
export interface UnsprungComponentsRear {
  wheelRim: number;       // kg — rim + spokes + hub
  tyre: number;           // kg
  brakeDisc: number;      // kg
  brakeCaliper: number;   // kg
  swingarmHalf: number;   // kg — ~50% of swingarm mass (rear portion beyond pivot midpoint)
  chainPartial: number;   // kg — chain section between sprockets (~25% of total chain)
}

/** Section 7 — Suspension dynamics inputs */
export interface SuspensionParams {
  springRateFront: number;   // N/mm  (k_f)
  springRateRear: number;    // N/mm  (k_r)
  motionRatioFront: number;  // dimensionless  (MR_f) — typical 0.85–1.0 for tele forks
  motionRatioRear: number;   // dimensionless  (MR_r) — typical 0.55–0.85 for linkage rear
  unsprungFront: number;     // kg   (m_uf) — wheel + tyre + brake + lower fork
  unsprungRear: number;      // kg   (m_ur) — wheel + tyre + brake + swingarm
  unsprungComponentsFront?: UnsprungComponentsFront;
  unsprungComponentsRear?: UnsprungComponentsRear;
  sagFront: number;          // mm   static sag (sag_f)
  sagRear: number;           // mm   static sag (sag_r)
  preloadFront: number;      // mm   spring preload (PL_f)
  preloadRear: number;       // mm   spring preload (PL_r)
  compDamping: number;       // clicks  (C_comp)
  rebDamping: number;        // clicks  (C_reb)
  forkTravel: number;        // mm   total fork travel (T_fork)
  shockTravel: number;       // mm   total shock travel (T_shock)
  /** Actual front compression damping coefficient (N·s/mm). Cossalter Ch.5 Eq 5.12 */
  dampingCoeffFront: number;
  /** Actual rear compression damping coefficient (N·s/mm). Cossalter Ch.5 Eq 5.13 */
  dampingCoeffRear: number;
}

/** Section 8 — Chain/sprocket and anti-squat inputs */
export interface ChainParams {
  frontSprocket: number;    // teeth  (Z_f) — countershaft sprocket
  rearSprocket: number;     // teeth  (Z_r) — rear wheel sprocket
  sprocketCenterX: number;  // mm offset of countershaft from SA pivot (Δx_cs, neg = forward)
  sprocketCenterY: number;  // mm offset of countershaft from SA pivot (Δy_cs, pos = above)
  chainForceAngle: number;  // degrees — LEGACY trim only; NOT used for IC (unified engine auto-computes)
  isCVT?: boolean;          // true for scooters / belt-drive bikes — disables chain IC analysis
}

/** Section 9 — Rider ergonomics triangle inputs */
export interface ErgoParams {
  handlebarX: number;  // mm from front axle  (H_x)  — auto-computed from riser geometry by ChassisViz2D
  handlebarY: number;  // mm from ground       (H_y)  — auto-computed from riser geometry by ChassisViz2D
  seatX: number;       // mm from front axle  (S_x)
  seatY: number;       // mm from ground       (S_y)
  footpegX: number;    // mm from front axle  (P_x)
  footpegY: number;    // mm from ground       (P_y)
  /** Handlebar riser height above upper triple clamp (mm). Segment along steering axis direction.
   *  0 = clip-ons (sport), ~50 = naked/cruiser, ~90 = ADV/dirt */
  riserHeight_mm?: number;
  /** Handlebar reach: signed perpendicular offset at grip end (mm).
   *  Positive = forward (clip-on), Negative = rearward pull-back.
   *  Applied in the u_perp direction (perpendicular to steering axis, rearward positive). */
  handlebarReach_mm?: number;
}

/** Section 10 — Dynamic load transfer inputs */
export interface DynamicsParams {
  brakingDecel: number;  // g  (multiples of 9.81 m/s²) — deceleration magnitude
  accelG: number;        // g  — acceleration magnitude
  cornerSpeed: number;   // m/s
  cornerRadius: number;  // m
  trackWidth: number;    // mm — conceptual lateral contact width (~100mm for single-track)
}

// ─────────────────────────────────────────────
// RESULT INTERFACES
// ─────────────────────────────────────────────

/** Module 1 outputs — Section 5 */
export interface GeometryResults {
  trail: number;                // mm  — Eq 5.1 (corrected Foale): (Rf·sin α − f) / cos α
  mechanicalTrail: number;      // mm  — Eq 5.2: trail / cos α
  steeringOffsetGround: number; // mm  — Eq 5.3: f · cos α
  swingarmAngleRad: number;     // rad — Eq 5.4: atan((H_ra − H_sp) / L_sa)
  swingarmAngleDeg: number;     // deg — display only
  frontWheelRadius: number;     // mm  — D_f / 2
  rearWheelRadius: number;      // mm  — D_r / 2
}

/** Module 2 outputs — Section 6 */
export interface CoGResults {
  X_cg: number;         // mm  — Eq 6.1: weighted centroid X from front axle
  Y_cg: number;         // mm  — Eq 6.2: weighted centroid Y from ground
  deltaX_sp: number;    // mm  — Eq 6.3: X_cg − X_sp (relative to swingarm pivot)
  deltaY_sp: number;    // mm  — Eq 6.4: Y_cg − H_sp
  R_front: number;      // N   — Eq 6.5: static front axle reaction
  R_rear: number;       // N   — Eq 6.6: static rear axle reaction
  frontPercent: number; // %   — Eq 6.7: front weight bias
  rearPercent: number;  // %
  totalMass: number;    // kg
  totalWeight: number;  // N
}

/** Module 3 outputs — Section 7 */
export interface SuspensionResults {
  wheelRateFront: number;       // N/mm — Eq 7.1: k_f × MR_f²
  wheelRateRear: number;        // N/mm — Eq 7.2: k_r × MR_r²
  natFreqFront: number;         // Hz   — Eq 7.3
  natFreqRear: number;          // Hz   — Eq 7.4
  sprungMass: number;           // kg   — Eq 7.5
  sprungMassFront: number;      // kg   — Eq 7.6
  sprungMassRear: number;       // kg   — Eq 7.7
  sagForceFront: number;        // N    — Eq 7.8
  sagForceRear: number;         // N    — Eq 7.9
  sagPercentFront: number;      // %    — Eq 7.10
  sagPercentRear: number;       // %    — Eq 7.11
  criticalDampingFront: number; // N·s/m — Eq 7.12
  criticalDampingRear: number;  // N·s/m — Eq 7.13
  dampingRatioComp: number;     // dimensionless — Eq 7.14 (normalised clicks)
  loadTransfer08g: number;      // N    — Eq 7.15
  /** True damping ratio front ζ_f = c_f / c_crit_f  (Cossalter Ch.5) */
  dampingRatioFront: number;
  /** True damping ratio rear ζ_r = c_r / c_crit_r */
  dampingRatioRear: number;
  /** Optimal front damping coefficient N·s/mm (ζ = 0.65 target) */
  optimalDampingFront: number;
  /** Optimal rear damping coefficient N·s/mm (ζ = 0.65 target) */
  optimalDampingRear: number;
  /** Unsprung mass resonance frequency front (wheel-hop) Hz */
  unsprungFreqFront: number;
  /** Unsprung mass resonance frequency rear (wheel-hop) Hz */
  unsprungFreqRear: number;
}

/** Module 4 outputs — Section 8 */
export interface AntiSquatResults {
  gearRatio: number;          // dimensionless — Eq 8.1
  IC_x: number;               // mm            — Eq 8.4: instant centre x (NaN if CVT/parallel)
  IC_y: number;               // mm            — Eq 8.5: instant centre y (NaN if CVT/parallel)
  antiSquatPercent: number;   // %             — Eq 8.8 (NaN if CVT/parallel)
  asSwingarmOnly: number;     // %             — Eq 8.9
  chainContribution: number;  // %             — Eq 8.10 (NaN if CVT/parallel)
  antiDivePercent: number;    // %             — Eq 8.11
  proSquat: number;           // %             — Eq 8.12
  proDive: number;            // %             — Eq 8.13
  /** Auto-computed chain force angle used for IC (degrees). Not applicable for CVT. */
  chainForceAngleAuto: number;
  /** true when drivetrain is CVT/belt — IC/AS% are not computed */
  isCVT: boolean;
  /** Cossalter squat ratio R = tan(τ)/tan(σ). R=1 neutral, >1 anti-squat, <1 pro-squat */
  squatRatio: number;
}

/** Module 5 outputs — Section 9 */
export interface ErgoResults {
  d_SH: number;           // mm  — Eq 9.1: seat-to-handlebar distance
  d_SP: number;           // mm  — Eq 9.2: seat-to-footpeg distance
  d_HP: number;           // mm  — Eq 9.3: handlebar-to-footpeg distance
  kneeAngleDeg: number;   // deg — Eq 9.4 (law of cosines at knee joint)
  hipAngleDeg: number;    // deg — Eq 9.5 (law of cosines at hip joint)
  forwardLeanDeg: number; // deg — Eq 9.6: torso inclination from vertical
}

/** Module 6 outputs — Section 10 */
export interface DynamicsResults {
  deltaW_brake: number;        // N   — Eq 10.1: braking load transfer
  frontPercentBraking: number; // %   — Eq 10.2
  deltaW_accel: number;        // N   — Eq 10.3: acceleration load transfer
  frontPercentAccel: number;   // %   — Eq 10.4
  lateralAccel: number;        // m/s²— Eq 10.5
  lateralForce: number;        // N   — Eq 10.6
  bankAngleDeg: number;        // deg — Eq 10.7
}

// ─────────────────────────────────────────────
// MODULE 7 — TIRE PHYSICS
// ─────────────────────────────────────────────
export interface TireParams {
  frontSectionWidth: number;   // mm  e.g. 120
  frontAspectRatio: number;    // %   e.g. 70
  frontRimDiameter: number;    // inches e.g. 17
  frontTireStiffness: number;  // N/mm vertical spring rate
  rearSectionWidth: number;    // mm  e.g. 190
  rearAspectRatio: number;     // %   e.g. 55
  rearRimDiameter: number;     // inches
  rearTireStiffness: number;   // N/mm
  speedKmh: number;            // km/h for dynamic growth
}

export interface TireResults {
  frontFreeRadius: number;         // mm — R_free_f
  rearFreeRadius: number;          // mm — R_free_r
  frontLoadedRadius: number;       // mm — R_loaded_f
  rearLoadedRadius: number;        // mm — R_loaded_r
  frontDeflection: number;         // mm
  rearDeflection: number;          // mm
  frontContactPatchLength: number; // mm
  rearContactPatchLength: number;  // mm
  frontDynamicRadius: number;      // mm at speed
  rearDynamicRadius: number;       // mm
  frontCombinedRate: number;       // N/mm (suspension + tire in series)
  rearCombinedRate: number;        // N/mm
  frontNatFreqCorrected: number;   // Hz using combined rate
  rearNatFreqCorrected: number;    // Hz
}

// ─────────────────────────────────────────────
// MODULE 8 — SUSPENSION KINEMATICS
// ─────────────────────────────────────────────
export interface KinematicsParams {
  chainPitch: number;    // mm e.g. 15.875 for 525 chain
  chainLinks: number;    // integer
  numPositions: number;  // sweep resolution, default 11
}

export interface KinematicsPoint {
  suspensionMm: number;       // position from full droop [0..rearWheelTravel]
  rearAxleX: number;          // mm from front axle
  rearAxleY: number;          // mm from ground
  wheelbase: number;          // mm
  deltaWheelbase: number;     // mm change from static
  chainCentreDistance: number;// mm between sprocket centres
  deltaChainLength: number;   // mm change from static (≈ 2 × Δcentre_dist)
  swingarmAngleDeg: number;   // deg
}

export interface KinematicsResults {
  rearWheelTravel: number;        // mm
  staticIndex: number;            // index in positions[] at static sag
  positions: KinematicsPoint[];
  maxWheelbaseChange: number;     // mm
  maxChainLengthChange: number;   // mm
}

// ─────────────────────────────────────────────
// MODULE 9 — MOMENTS OF INERTIA
// ─────────────────────────────────────────────
export interface InertiaResults {
  I_pitch: number;   // kg·m²  rotation about lateral Y-axis through CoG
  I_roll: number;    // kg·m²  rotation about longitudinal X-axis through CoG
  I_yaw: number;     // kg·m²  rotation about vertical Z-axis through CoG
  k_pitch: number;   // m  pitch radius of gyration
  k_roll: number;    // m
  k_yaw: number;     // m
}

// ─────────────────────────────────────────────
// MODULE 10 — STABILITY THRESHOLDS
// ─────────────────────────────────────────────
export interface StabilityParams {
  footpegLateralOffset: number;  // mm half-width to footpeg tip from centreline
  frictionCoeff: number;         // μ tyre-road (0.8 tarmac)
  steeringLockAngle: number;     // deg max steering angle
}

export interface StabilityResults {
  a_wheelie_ms2: number;     // m/s²
  a_wheelie_g: number;       // g
  a_stoppie_ms2: number;     // m/s²
  a_stoppie_g: number;       // g
  leanLimitDeg: number;      // deg geometric lean clearance
  R_turn_min_mm: number;     // mm min turning radius
  D_turn_circle_mm: number;  // mm turning circle diameter
  gradeMaxDeg: number;       // deg max climbable grade
  gradeMaxPercent: number;   // % grade

  // ── DAG-model handling indices (MotorcycleDynamicsModel §G8/§G5) ──────────
  /** Rear squat under accel scenario: (1 − AS%/100) × ΔW_accel / k_rear  [mm] */
  rearSquatMm: number;
  /** Fork dive under braking: (1 − AD%/100) × ΔW_brake / k_front  [mm] */
  forkDiveMm: number;
  /** Stability index SI = trail × WB / 10⁶  (higher = more stable) */
  stabilityIndex: number;
  /** Agility index AI = I_yaw / (M × WB²)  (lower = more agile) */
  agilityIndex: number;
  /** Wobble sensitivity WS = 10⁶ / (trail × WB)  (lower = more stable at speed) */
  wobbleSensitivity: number;
  /** Pitch sensitivity dF%/dWB = X_cg / WB² × 100  [%/mm] */
  pitchSensitivity: number;
}

// ─────────────────────────────────────────────
// MODULE 11 — FORK COMPLIANCE
// ─────────────────────────────────────────────
export interface ForkComplianceParams {
  forkBendingStiffness: number;    // N/mm at axle (typical 30–80)
  forkTorsionalStiffness: number;  // N·m/deg (typical 300–800)
  steeringHeadStiffness: number;   // N·m/deg (typical 500–2000)
}

export interface ForkComplianceResults {
  brakingForceFront: number;      // N horizontal at front axle
  forkDeflection: number;         // mm axle deflection
  trailEffective: number;         // mm (trail + compliance correction)
  deltaTrail: number;             // mm change from static
  steeringTorqueNm: number;       // N·m self-aligning torque at 5° steer
  steerFlexAngle: number;         // deg flex from SAT
  isPerceptible: boolean;         // flex > 0.5°
  isDangerous: boolean;           // flex > 1.5°
}

// ─────────────────────────────────────────────
// MODULE — AERODYNAMICS (Cossalter Ch. 4 / 8)
// ─────────────────────────────────────────────

export interface AeroParams {
  /** Drag coefficient (dimensionless). Faired sport bike ≈ 0.35, naked ≈ 0.55 */
  Cx: number;
  /** Lift coefficient (dimensionless). Positive = upward lift, negative = downforce */
  Cz: number;
  /** Frontal area (m²). Sport bike ≈ 0.33, naked ≈ 0.50 */
  frontalArea: number;
  /** Pressure centre x from front axle (mm). Typically 600–900 mm for sport bikes */
  pressureCentreX: number;
  /** Reference speed for single-point output (km/h) */
  referenceSpeedKmh: number;
  /** Maximum speed for sweep chart (km/h) */
  maxSpeedKmh: number;
  /** Peak engine power (kW) — for top speed prediction */
  enginePower_kW: number;
  /** Drivetrain efficiency 0–1 (typically 0.88) */
  drivetrainEta: number;
  /** Air density (kg/m³). Default 1.225 (sea level, 15°C) */
  airDensity?: number;
  /** Total gear ratio engine-to-wheel in top gear (primary × gearbox × sprocket). 0 = not set */
  topGearRatioOverall?: number;
  /** Engine RPM at peak power (used for gear-limited top speed ceiling) */
  maxRPM?: number;
}

export interface AeroSpeedPoint {
  speedKmh: number;
  dragN: number;
  liftN: number;
  powerW: number;
  deltaWFrontN: number;
}

export interface AeroResults {
  /** Drag force at reference speed (N) */
  dragAtRef: number;
  /** Lift force at reference speed (N). Negative = downforce */
  liftAtRef: number;
  /** Drag power at reference speed (W) */
  powerAtRef_W: number;
  /** Aerodynamic pitch moment at reference speed (N·m) */
  pitchMoment_Nm: number;
  /** Front wheel load change from aero pitch moment (N). Positive = added load */
  deltaWFrontAtRef_N: number;
  /** Top speed (m/s): min(power-limited, gear-limited) */
  topSpeed_ms: number;
  /** Top speed (km/h): min(power-limited, gear-limited) */
  topSpeed_kmh: number;
  /** RPM-ceiling limited top speed (km/h). 0 if gear data not available */
  topSpeedGear_kmh: number;
  /** RPM-ceiling limited top speed (m/s). 0 if gear data not available */
  topSpeedGear_ms: number;
  /** Drag force at 100 km/h (N) — standard comparison reference */
  drag100kmh_N: number;
  /** Dynamic pressure at reference speed (Pa) */
  dynamicPressureRef: number;
  /** Full speed sweep (0 to maxSpeedKmh in 10 km/h steps) */
  speedSweep: AeroSpeedPoint[];
}

/** Aggregated output from computeAll() */
export interface ComputeAllResult {
  geometry: GeometryResults;
  cog: CoGResults;
  suspension: SuspensionResults;
  antiSquat: AntiSquatResults;
  ergonomics: ErgoResults;
  dynamics: DynamicsResults;
  tire: TireResults;
  kinematics: KinematicsResults;
  inertia: InertiaResults;
  stability: StabilityResults;
  forkCompliance: ForkComplianceResults;
  fem: FEMResults;
  aero: AeroResults;
}

/** Full input bundle passed to computeAll() */
// ─────────────────────────────────────────────
// MODULE — SUSPENSION TRAVEL SWEEP
// ─────────────────────────────────────────────

/**
 * Rear shock mount geometry for travel sweep computation.
 * Determines MR(u), WR(u), AS%(u), Trail(u) curves.
 */
export interface SweepParams {
  /** 'direct' = shock on swingarm; 'fourbar' = Pro-Link / Uni-Trak */
  linkageType: 'direct' | 'fourbar';
  /** Distance from swingarm pivot to shock attachment (mm) */
  shockArmLength: number;
  /** Angle of shock arm relative to swingarm axis (deg) */
  shockArmAngle: number;
  /** Shock top-mount x from front axle (mm) */
  shockTopX: number;
  /** Shock top-mount height from ground (mm) */
  shockTopY: number;
  fourBar?: {
    rockerPivotX: number;
    rockerPivotY: number;
    rockerLength: number;
    pushrodLength: number;
    rockerAngleStatic: number;
  };
  /**
   * When > 0 bypass shock geometry and use this as the constant motion ratio
   * (shock_compression / wheel_travel — same convention as SuspensionParams.motionRatioRear).
   * Set automatically from suspension.motionRatioRear so MR is always physically correct.
   */
  motionRatioOverride?: number;
}

export interface SweepPoint {
  travel_mm: number;
  swingarmAngleDeg: number;
  shockLength_mm: number;
  shockCompression_mm: number;
  motionRatio: number;
  wheelRate_Nmm: number;
  antiSquatPct: number;
  trail_mm: number;
}

export interface SweepResults {
  points: SweepPoint[];
  static: SweepPoint;
}

export interface ComputeAllInput {
  geometry: GeometryParams;
  massComponents: MassComponent[];
  suspension: SuspensionParams;
  chain: ChainParams;
  ergo: ErgoParams;
  dynamics: DynamicsParams;
  tire?: TireParams;
  kinematics?: KinematicsParams;
  stability?: StabilityParams;
  forkCompliance?: ForkComplianceParams;
  femSection?: FEMSectionParams;
  sweep?: SweepParams;
  aero?: AeroParams;
}

// ─────────────────────────────────────────────
// MODULE 12 — FRAME FEM
// ─────────────────────────────────────────────

export interface FEMSectionParams {
  forkOD: number;       // mm outer diameter
  forkWall: number;     // mm wall thickness
  frameOD: number;      // mm
  frameWall: number;    // mm
  swingarmOD: number;   // mm
  swingarmWall: number; // mm
  forkMaterial: 'steel' | 'aluminum' | 'cfrp' | 'titanium';
  frameMaterial: 'steel' | 'aluminum' | 'cfrp' | 'titanium';
  swingarmMaterial: 'steel' | 'aluminum' | 'cfrp' | 'titanium';
}

export interface FEMNodeResult {
  id: number;
  x: number; y: number;
  dx: number; dy: number;
  dtheta: number;
}

export interface FEMElementResult {
  id: number;
  label: string;
  node1: number; node2: number;
  length: number;
  axialForce: number;
  shearForce: number;
  momentMax: number;
  axialStress: number;
  bendingStress: number;
  combinedStress: number;
  safetyFactor: number;
  stressColor: string;
}

export interface FEMResults {
  nodes: FEMNodeResult[];
  elements: FEMElementResult[];
  maxDisplacement: number;
  maxStress: number;
  minSafetyFactor: number;
  criticalElement: string;
  solved: boolean;
  error?: string;
}

// ─────────────────────────────────────────────
// R&D — DESIGN TARGET CARD
// ─────────────────────────────────────────────

/** A single KPI target: enabled flag + acceptable [lo, hi] range */
export interface TargetRange {
  enabled: boolean;
  lo: number;
  hi: number;
}

/** Full design intent — one TargetRange per tracked KPI */
export interface TargetConfig {
  trail:               TargetRange;   // mm
  frontPercent:        TargetRange;   // %
  antiSquatPercent:    TargetRange;   // %
  natFreqFront:        TargetRange;   // Hz
  natFreqRear:         TargetRange;   // Hz
  sagPercentFront:     TargetRange;   // %
  sagPercentRear:      TargetRange;   // %
  wheelRateFront:      TargetRange;   // N/mm
  wheelRateRear:       TargetRange;   // N/mm
  cogHeight:           TargetRange;   // mm
  sprungUnsprungRatioF: TargetRange;  // :1
  sprungUnsprungRatioR: TargetRange;  // :1
}
