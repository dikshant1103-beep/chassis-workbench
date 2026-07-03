/**
 * studio/types.ts — Suspension Design Studio data model v2 (ISOLATED)
 *
 * v2 restructures the model into INDEPENDENT front and rear suspension
 * subsystems so the bike can use a different architecture at each end
 * (e.g. telescopic fork front + linkage monoshock rear, or scooter
 * trailing-link front + unit-swing rear).
 *
 * This module is self-contained: it does NOT modify or depend on the global
 * engine/types.ts contracts, so it cannot affect any existing calculation.
 *
 * UNIT CONVENTIONS:
 *   length mm · mass kg · force N · rate N/mm · angle degrees · freq Hz
 *   stress N/mm² (= MPa)
 *
 * Coordinate frame for all hardpoints (full-bike side view):
 *   origin = front-wheel ground contact · +x rearward · +y up.
 *
 * Primary reference: Race Tech's Motorcycle Suspension Bible (Thede & Parks,
 * 2010). Items not covered by the book are marked "supplemented".
 */

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type BikeCategory =
  | 'sport' | 'naked' | 'adv' | 'cruiser'
  | 'touring' | 'supermoto' | 'enduro' | 'scooter';

export type RideTarget = 'comfort' | 'handling' | 'sport' | 'touring' | 'offroad';

/** Front suspension architecture. */
export type FrontSuspType =
  | 'telescopic'    // conventional fork (right-side-up)
  | 'usd'           // upside-down fork
  | 'trailing-link' // arm pivots ahead, wheel trails (common on scooters)
  | 'leading-link'; // arm pivots behind, wheel leads (classic scooters/sidecars)

/** Rear suspension architecture. */
export type RearSuspType =
  | 'monoshock-direct'  // single shock straight onto swingarm
  | 'monoshock-linkage' // single shock via rocker/linkage (rising rate)
  | 'twin-shock'        // two shocks (parallel)
  | 'unit-swing';       // engine-as-swingarm single shock (scooter)

export type SpringType = 'linear' | 'progressive';
export type DamperType = 'twin-tube' | 'monotube' | 'piggyback-reservoir' | 'emulsion';

/** Where a calculation comes from — drives the "source badge" in the UI. */
export type Provenance = 'book' | 'derived' | 'supplemented';

export interface Point2 { x: number; y: number; }

// ─── Coil spring (shared by both ends) ────────────────────────────────────────

export interface CoilSpring {
  springType: SpringType;
  wireDia: number;        // mm   (d)
  meanCoilDia: number;    // mm   (D, mid-coil)
  activeCoils: number;    // (N)
  freeLength: number;     // mm   (L_free)
  preload: number;        // mm   installed preload
  shearModulus: number;   // N/mm²  (G — default chrome-silicon spring steel)
  allowableShear: number; // N/mm²  (τ_allow, for safety factor)
}

// ─── Section 1: Vehicle Data ──────────────────────────────────────────────────

export interface StudioVehicle {
  category: BikeCategory;
  vehicleMass: number;     // kg — wet vehicle mass (no rider)
  riderMass: number;       // kg
  passengerMass: number;   // kg
  cargoMass: number;       // kg
  unsprungFront: number;   // kg
  unsprungRear: number;    // kg
  frontWeightPct: number;  // % static weight bias on the front axle (laden)
  wheelbase: number;       // mm (front axle → rear axle)
  frontWheelDia: number;   // mm
  rearWheelDia: number;    // mm
}

// ─── Section 2: Front suspension subsystem ────────────────────────────────────

export interface FrontSuspension {
  type: FrontSuspType;

  // Telescopic / USD fork:
  rakeDeg: number;       // steering axis from vertical
  forkOffset: number;    // mm — triple-clamp offset ⊥ to steering axis (for trail)
  forkLength: number;    // mm
  /** Combined 2-leg effective fork spring rate (N/mm). MR_front = 1.0. */
  forkSpringRate: number;

  // Trailing / leading link (arm-pivoted) — also used to draw + compute MR:
  /** Arm pivot, fixed to the steering column / lower frame (mm). */
  linkPivot: Point2;
  linkArmLength: number;   // mm pivot → front axle
  linkArmAngleDeg: number; // arm angle from horizontal (trailing: axle behind/below)
  linkLowerMount: Point2;  // spring/damper lower mount, on the arm (mm)
  linkUpperMount: Point2;  // spring/damper upper mount, on the column/frame (mm)

  travel: number;          // mm wheel travel
  spring: CoilSpring;
}

// ─── Section 3: Rear suspension subsystem ─────────────────────────────────────

export interface RearLinkage {
  rockerPivot: Point2;     // frame-fixed rocker pivot (mm)
  rockerLength: number;    // mm
  pushrodLength: number;   // mm
  rockerAngleStatic: number; // deg
}

export interface RearSuspension {
  type: RearSuspType;
  damperType: DamperType;
  swingarmPivot: Point2;   // frame-fixed (mm)
  swingarmLength: number;  // mm pivot → rear axle
  swingarmAngleDeg: number;// deg from horizontal (− = axle below pivot)
  lowerShockMount: Point2; // rigid on swingarm (mm)
  upperShockMount: Point2; // frame-fixed (mm)
  linkage: RearLinkage | null; // present for 'monoshock-linkage'
  wheelTravel: number;     // mm
  shockStroke: number;     // mm
  spring: CoilSpring;
}

// ─── Drivetrain (for chain line + anti-squat instant centre) ──────────────────

export interface StudioDrivetrain {
  isChainDrive: boolean;   // false for scooter/CVT/belt → no chain IC
  frontSprocket: number;   // teeth (countershaft)
  rearSprocket: number;    // teeth
  chainPitch: number;      // mm (520 chain = 15.875)
  /** Countershaft offset from the swingarm pivot (mm). CS is near the pivot by
   *  design — that is why manufacturers minimise anti-squat change over travel. */
  countershaftOffset: Point2;
}

// ─── Section 4: Ride Targets ──────────────────────────────────────────────────

export interface StudioTargets { rideTarget: RideTarget; }

// ─── Aggregate input ──────────────────────────────────────────────────────────

export interface StudioInput {
  vehicle: StudioVehicle;
  front: FrontSuspension;
  rear: RearSuspension;
  drivetrain: StudioDrivetrain;
  targets: StudioTargets;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export type Axle = 'front' | 'rear';

export interface StudioMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  source: Provenance;
  cite: string;
  axle?: Axle;            // which end this metric describes (for grouping)
  target?: [number, number];
  status?: 'ok' | 'warn' | 'na';
  note?: string;
}

export interface SweepRow {
  wheelTravel: number;     // mm
  shockTravel: number;     // mm
  motionRatio: number;     // -
  wheelRate: number;       // N/mm
  springForce: number;     // N
  springStress: number;    // N/mm²
  shockForce: number;      // N
  rideFrequency: number;   // Hz
  springCompression: number; // mm
}

export interface AxleCurves {
  sweep: SweepRow[];
  forceDeflection: { deflection: number; force: number }[];
}

export interface StudioCurves {
  front: AxleCurves;
  rear: AxleCurves;
}

export interface StudioResults {
  metrics: StudioMetric[];        // tagged with axle
  curves: StudioCurves;
  raw: Record<string, number>;
  warnings: string[];
}

// ─── Angle optimizer (operates on the rear shock unless noted) ────────────────

export interface AngleOptimizerSample {
  angleDeg: number;
  motionRatio: number;
  wheelRate: number;
  shockForce: number;
  springCompression: number;
  rideFrequency: number;
  suspensionTravel: number;
  safetyFactor: number;
  packagingClearance: number;
  progression: number;       // MR(top)/MR(bottom) — rising-rate indicator
  score: number;
  feasible: boolean;
}

export interface AngleOptimizerResult {
  axle: Axle;
  samples: AngleOptimizerSample[];
  best: AngleOptimizerSample | null;
  reasons: string[];
}
