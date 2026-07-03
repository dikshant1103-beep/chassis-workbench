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

/** Section 7 — Suspension dynamics inputs */
export interface SuspensionParams {
  springRateFront: number;   // N/mm  (k_f)
  springRateRear: number;    // N/mm  (k_r)
  motionRatioFront: number;  // dimensionless  (MR_f) — typical 0.85–1.0 for tele forks
  motionRatioRear: number;   // dimensionless  (MR_r) — typical 0.55–0.85 for linkage rear
  unsprungFront: number;     // kg   (m_uf) — wheel + tyre + brake + lower fork
  unsprungRear: number;      // kg   (m_ur) — wheel + tyre + brake + swingarm
  sagFront: number;          // mm   static sag (sag_f)
  sagRear: number;           // mm   static sag (sag_r)
  preloadFront: number;      // mm   spring preload (PL_f)
  preloadRear: number;       // mm   spring preload (PL_r)
  compDamping: number;       // clicks  (C_comp)
  rebDamping: number;        // clicks  (C_reb)
  forkTravel: number;        // mm   total fork travel (T_fork)
  shockTravel: number;       // mm   total shock travel (T_shock)
}

/** Section 8 — Chain/sprocket and anti-squat inputs */
export interface ChainParams {
  frontSprocket: number;    // teeth  (Z_f) — countershaft sprocket
  rearSprocket: number;     // teeth  (Z_r) — rear wheel sprocket
  sprocketCenterX: number;  // mm offset of countershaft from SA pivot (Δx_cs, neg = forward)
  sprocketCenterY: number;  // mm offset of countershaft from SA pivot (Δy_cs, pos = above)
  chainForceAngle: number;  // degrees — angle of top chain run relative to horizontal (θ_chain)
}

/** Section 9 — Rider ergonomics triangle inputs */
export interface ErgoParams {
  handlebarX: number;  // mm from front axle  (H_x)
  handlebarY: number;  // mm from ground       (H_y)
  seatX: number;       // mm from front axle  (S_x)
  seatY: number;       // mm from ground       (S_y)
  footpegX: number;    // mm from front axle  (P_x)
  footpegY: number;    // mm from ground       (P_y)
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
  dampingRatioComp: number;     // dimensionless — Eq 7.14 (normalised)
  loadTransfer08g: number;      // N    — Eq 7.15
}

/** Module 4 outputs — Section 8 */
export interface AntiSquatResults {
  gearRatio: number;          // dimensionless — Eq 8.1
  IC_x: number;               // mm            — Eq 8.4: instant centre x
  IC_y: number;               // mm            — Eq 8.5: instant centre y
  antiSquatPercent: number;   // %             — Eq 8.8
  asSwingarmOnly: number;     // %             — Eq 8.9
  chainContribution: number;  // %             — Eq 8.10
  antiDivePercent: number;    // %             — Eq 8.11
  proSquat: number;           // %             — Eq 8.12
  proDive: number;            // %             — Eq 8.13
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

/** Aggregated output from computeAll() */
export interface ComputeAllResult {
  geometry: GeometryResults;
  cog: CoGResults;
  suspension: SuspensionResults;
  antiSquat: AntiSquatResults;
  ergonomics: ErgoResults;
  dynamics: DynamicsResults;
}

// ─────────────────────────────────────────────
// SUSPENSION SWEEP — new inputs
// ─────────────────────────────────────────────

/**
 * Rear shock mount geometry — required for computing the MR / WR / AS%
 * curves over the full suspension travel range.
 *
 * Monoshock model (most common):
 *   The rear shock connects directly from a point on the swingarm to a
 *   fixed point on the frame.  The shock arm length + angle define the
 *   attachment point on the swingarm; the top-mount coords define the
 *   frame attachment.
 *
 * 4-bar linkage model (Pro-Link, Uni-Trak, RADD):
 *   A rocker and pushrod are interposed between the swingarm and shock.
 *   Enable with linkageType = 'fourbar' and fill the fourBar sub-object.
 */
export interface SweepParams {
  /** 'direct' = shock on swingarm directly; 'fourbar' = Pro-Link / Uni-Trak */
  linkageType: 'direct' | 'fourbar';

  /** Distance from swingarm pivot to shock attachment point on swingarm (mm) */
  shockArmLength: number;
  /** Angle of shock arm relative to swingarm axis (deg). 0 = along swingarm. */
  shockArmAngle: number;

  /** Shock top-mount x-position from front axle (mm) */
  shockTopX: number;
  /** Shock top-mount height from ground (mm) */
  shockTopY: number;

  /** 4-bar linkage parameters (only needed when linkageType = 'fourbar') */
  fourBar?: {
    rockerPivotX: number;   // mm from front axle
    rockerPivotY: number;   // mm from ground
    rockerLength: number;   // mm
    pushrodLength: number;  // mm
    /** Angle of rocker at static (initial) position — deg */
    rockerAngleStatic: number;
  };
}

/** One row of the suspension travel sweep output */
export interface SweepPoint {
  travel_mm: number;          // wheel travel (0 = static, positive = bump)
  swingarmAngleDeg: number;   // swingarm angle at this travel position
  shockLength_mm: number;     // instantaneous shock length
  shockCompression_mm: number;// shock compression from static
  motionRatio: number;        // dx_wheel / dx_shock (dimensionless)
  wheelRate_Nmm: number;      // k_spring × MR² (N/mm)
  antiSquatPct: number;       // % at this travel (updated swingarm angle)
  trail_mm: number;           // trail if fork dives the same amount (front in phase)
}

/** Full sweep output */
export interface SweepResults {
  points: SweepPoint[];
  /** Static-position values for reference */
  static: SweepPoint;
}

/** Full input bundle passed to computeAll() */
export interface ComputeAllInput {
  geometry: GeometryParams;
  massComponents: MassComponent[];
  suspension: SuspensionParams;
  chain: ChainParams;
  ergo: ErgoParams;
  dynamics: DynamicsParams;
  sweep?: SweepParams;
}
