/**
 * studio/knowledgeModel.ts — Engineering knowledge model (v2, front + rear)
 *
 * Single source of truth for "what the reference says". Annotated:
 *   [BOOK]         — Race Tech's Motorcycle Suspension Bible (Thede & Parks 2010)
 *   [SUPPLEMENTED] — accepted vehicle-dynamics practice (Foale / Cossalter /
 *                    ride-frequency literature) where the book is qualitative.
 *
 * Ride-frequency bands and the "rear 10–20% stiffer than front" rule come from
 * standard ride-frequency practice (Penske / DRTuned / 3DM), scaled to
 * motorcycles. They are flagged [SUPPLEMENTED] so the UI marks provenance.
 */

import {
  BikeCategory, RideTarget, FrontSuspType, RearSuspType,
  StudioInput, CoilSpring, Point2, RearSuspension,
} from './types';
import { coilSpringRate, motionRatioAtTravel, springShearStress } from './formulas';
import { calibrateLinkage, linkageMotionRatioAtTravel } from './linkage';

const G_ACC = 9.81;

export interface Band { min: number; max: number; }

// ─── Sag target bands (% of travel) [BOOK Ch2 sag table] ──────────────────────
export const SAG_PERCENT_TARGET: Record<RideTarget, Band> = {
  comfort:  { min: 30, max: 38 },
  touring:  { min: 28, max: 35 },
  handling: { min: 27, max: 33 },
  sport:    { min: 25, max: 33 },
  offroad:  { min: 30, max: 38 },
};
export const FREE_SAG_PERCENT_TARGET: Band = { min: 5, max: 20 }; // [BOOK Ch2 free sag]

// ─── Ride-frequency bands (Hz) [SUPPLEMENTED] ─────────────────────────────────
// Rear runs ~10–20% higher than front (standard practice). Front bands below;
// rear bands derived by ×1.15 in code so the rule is explicit + auditable.
export const RIDE_FREQ_FRONT: Record<RideTarget, Band> = {
  comfort:  { min: 0.8, max: 1.3 },
  touring:  { min: 0.9, max: 1.4 },
  handling: { min: 1.1, max: 1.6 },
  sport:    { min: 1.3, max: 2.0 },
  offroad:  { min: 0.8, max: 1.4 },
};
export const REAR_FREQ_FACTOR = 1.15; // [SUPPLEMENTED] rear ~15% stiffer than front
export function rearFreqBand(rt: RideTarget): Band {
  const f = RIDE_FREQ_FRONT[rt];
  return { min: +(f.min * REAR_FREQ_FACTOR).toFixed(2), max: +(f.max * REAR_FREQ_FACTOR).toFixed(2) };
}

export const DAMPING_RATIO_TARGET: Record<RideTarget, Band> = {
  comfort:  { min: 0.20, max: 0.40 },
  touring:  { min: 0.25, max: 0.45 },
  handling: { min: 0.30, max: 0.55 },
  sport:    { min: 0.40, max: 0.70 },
  offroad:  { min: 0.25, max: 0.45 },
};

export const MIN_SAFETY_FACTOR = 1.2;                       // [SUPPLEMENTED Shigley]
export const LINKAGE_LEVERAGE_RANGE: Band = { min: 1.0, max: 4.0 }; // [BOOK App.1]

// ─── Material defaults ────────────────────────────────────────────────────────
export const G_CHROME_SILICON_NMM2 = 79481; // N/mm² (= 8102 kg/mm² ×9.81) [BOOK Ch2]
// Allowable shear for silicon-chrome shock/fork spring wire. The book quotes
// ultimate ≳1700 N/mm² for spring steel; ~0.6× ultimate is the usual working
// shear allowable for highly-stressed suspension springs. [SUPPLEMENTED — Shigley]
export const ALLOWABLE_SHEAR_NMM2 = 1080;    // N/mm²

// ─── Glossary (subset) [BOOK Ch3 Glossary] ────────────────────────────────────
export const GLOSSARY: Record<string, string> = {
  sag: 'Compression from fully extended. Static (rider) sag is set first; free sag (bike only) checks the spring rate. [Book Ch2]',
  motionRatio: 'Shock displacement ÷ wheel displacement. Wheel rate = spring rate × MR². [Book Ch5 / Foale]',
  wheelRate: 'Effective stiffness at the contact patch = k·MR². [Foale Eq 7.1]',
  preload: 'How far the spring is compressed at install. Changes ride height/sag, NOT rate. [Book Ch2]',
  coilBind: 'When all coils touch (≈ N·d). Usable stroke must stay below this. [Book Ch2]',
  risingRate: 'Wheel rate that increases through travel (progression). Set by linkage/shock-angle geometry. [Supplemented]',
  trailingLink: 'Front arm pivoted to the steering column with the wheel trailing; spring/damper between arm and column. Common on scooters. [Supplemented]',
  unitSwing: 'Scooter rear where the engine/transmission IS the swingarm, with a single shock near the axle. [Supplemented]',
};

// ─── Suspension-architecture descriptors (UI labels + notes) ──────────────────
export const FRONT_TYPES: { val: FrontSuspType; label: string; note: string }[] = [
  { val: 'telescopic',    label: 'Telescopic fork', note: 'Conventional fork. Spring travel = wheel travel (MR≈1), two legs in parallel.' },
  { val: 'usd',           label: 'USD fork',        note: 'Upside-down fork. Stiffer, less unsprung mass; same MR≈1 spring model.' },
  { val: 'trailing-link', label: 'Trailing link',   note: 'Arm pivots ahead, wheel trails; spring/damper between arm and column. Scooters.' },
  { val: 'leading-link',  label: 'Leading link',    note: 'Arm pivots behind, wheel leads. Classic scooters / sidecars; anti-dive.' },
];
export const REAR_TYPES: { val: RearSuspType; label: string; note: string }[] = [
  { val: 'monoshock-direct',  label: 'Monoshock (direct)',  note: 'Single shock straight onto the swingarm. Simple, near-linear rate.' },
  { val: 'monoshock-linkage', label: 'Monoshock (linkage)', note: 'Single shock via rocker linkage → rising rate (Pro-Link / Uni-Trak).' },
  { val: 'twin-shock',        label: 'Twin shock',          note: 'Two shocks in parallel. Classic / cruiser / retro.' },
  { val: 'unit-swing',        label: 'Unit-swing (scooter)',note: 'Engine = swingarm, single shock near axle. Scooter rear.' },
];

// ─── Spring builder ───────────────────────────────────────────────────────────
function spring(d: number, D: number, N: number, free: number, preload: number): CoilSpring {
  return {
    springType: 'linear', wireDia: d, meanCoilDia: D, activeCoils: N,
    freeLength: free, preload,
    shearModulus: G_CHROME_SILICON_NMM2, allowableShear: ALLOWABLE_SHEAR_NMM2,
  };
}

// ─── Per-category defaults ────────────────────────────────────────────────────
interface CatDef {
  vehicleMass: number; riderMass: number; uF: number; uR: number; frontPct: number;
  wb: number; Rf: number; Rr: number;
  frontType: FrontSuspType; rearType: RearSuspType;
  /** combined two-leg effective fork spring rate (N/mm) */
  forkRate: number; forkTravel: number; rakeDeg: number; forkLen: number;
  saLen: number; saAngle: number; wheelTravel: number; shockStroke: number;
  // rear coil mean-diameter D + active coils N (wire dia is SIZED to hit freq):
  rDD: number; rN: number;
  // front coil mean-diameter D + active coils N (link types / fork stress):
  fDD: number; fN: number;
}

export const CATEGORY_DEFAULTS: Record<BikeCategory, CatDef> = {
  sport:     { vehicleMass: 200, riderMass: 75, uF: 12, uR: 16, frontPct: 51, wb: 1410, Rf: 310, Rr: 325, frontType: 'usd',          rearType: 'monoshock-linkage', forkRate: 19, forkTravel: 120, rakeDeg: 24, forkLen: 720, saLen: 580, saAngle: -8, wheelTravel: 130, shockStroke: 62, rDD: 60, rN: 6, fDD: 36, fN: 8 },
  naked:     { vehicleMass: 195, riderMass: 75, uF: 12, uR: 16, frontPct: 50, wb: 1430, Rf: 310, Rr: 325, frontType: 'telescopic',   rearType: 'monoshock-linkage', forkRate: 18, forkTravel: 130, rakeDeg: 25, forkLen: 700, saLen: 575, saAngle: -8, wheelTravel: 135, shockStroke: 60, rDD: 60, rN: 6, fDD: 36, fN: 8 },
  adv:       { vehicleMass: 230, riderMass: 80, uF: 14, uR: 18, frontPct: 49, wb: 1560, Rf: 340, Rr: 330, frontType: 'usd',          rearType: 'monoshock-linkage', forkRate: 16, forkTravel: 200, rakeDeg: 27, forkLen: 800, saLen: 620, saAngle: -6, wheelTravel: 210, shockStroke: 78, rDD: 62, rN: 7, fDD: 38, fN: 10 },
  cruiser:   { vehicleMass: 290, riderMass: 80, uF: 15, uR: 20, frontPct: 47, wb: 1690, Rf: 320, Rr: 340, frontType: 'telescopic',   rearType: 'twin-shock',        forkRate: 18, forkTravel: 120, rakeDeg: 30, forkLen: 760, saLen: 560, saAngle: -4, wheelTravel: 100, shockStroke: 55, rDD: 60, rN: 7, fDD: 38, fN: 8 },
  touring:   { vehicleMass: 360, riderMass: 80, uF: 16, uR: 22, frontPct: 48, wb: 1660, Rf: 320, Rr: 340, frontType: 'telescopic',   rearType: 'monoshock-direct',   forkRate: 20, forkTravel: 130, rakeDeg: 29, forkLen: 760, saLen: 600, saAngle: -5, wheelTravel: 120, shockStroke: 60, rDD: 64, rN: 7, fDD: 40, fN: 8 },
  supermoto: { vehicleMass: 145, riderMass: 75, uF: 11, uR: 14, frontPct: 50, wb: 1480, Rf: 310, Rr: 320, frontType: 'usd',          rearType: 'monoshock-linkage', forkRate: 11, forkTravel: 270, rakeDeg: 25, forkLen: 900, saLen: 600, saAngle: -7, wheelTravel: 290, shockStroke: 95, rDD: 58, rN: 8, fDD: 36, fN: 11 },
  enduro:    { vehicleMass: 120, riderMass: 75, uF: 11, uR: 14, frontPct: 49, wb: 1490, Rf: 370, Rr: 345, frontType: 'usd',          rearType: 'monoshock-linkage', forkRate: 10, forkTravel: 300, rakeDeg: 26, forkLen: 950, saLen: 605, saAngle: -7, wheelTravel: 310, shockStroke: 105,rDD: 58, rN: 8, fDD: 36, fN: 11 },
  scooter:   { vehicleMass: 120, riderMass: 75, uF: 9,  uR: 13, frontPct: 47, wb: 1290, Rf: 200, Rr: 200, frontType: 'trailing-link', rearType: 'unit-swing',       forkRate: 12, forkTravel: 90,  rakeDeg: 26, forkLen: 520, saLen: 360, saAngle: -3, wheelTravel: 90,  shockStroke: 70, rDD: 50, rN: 6, fDD: 44, fN: 7 },
};

/**
 * Size a coil spring to hit a target ride frequency, then fit preload + free
 * length for ~32% sag with coil-bind margin. This is the proper design direction:
 * choose stiffness from the target frequency rather than guessing wire diameter.
 *
 * SOURCE: [Foale Eq 7.1/7.3] wheelRate = k·MR², f = (1/2π)√(WR·1000/m);
 *         [BOOK Ch2] k = G·d⁴/(8·N·D³) inverted for d; sag fit [DERIVED].
 */
function sizeSpring(
  targetFreqHz: number, sprungMassKg: number, MR: number,
  D0: number, N: number, travel: number, cornerLoadN: number, count = 1,
): { wireDia: number; coilDia: number; preload: number; freeLength: number } {
  const m = Math.max(1, sprungMassKg);
  const wheelRateTarget = Math.pow(2 * Math.PI * targetFreqHz, 2) * m / 1000; // N/mm (combined)
  const mr = MR > 0 ? MR : 1;
  const kAxial = wheelRateTarget / (mr * mr) / count; // per-spring axial rate
  const targetSag = 0.32 * travel;
  const loadPerSpring = cornerLoadN / count;

  // Size wire dia to the rate, then grow coil dia until the spring is safe
  // (SF ≥ 1.3 at full compression). Larger D lowers peak shear stress.
  let D = D0, d = 10, preload = 5;
  for (let i = 0; i < 8; i++) {
    d = Math.pow((kAxial * 8 * N * Math.pow(D, 3)) / G_CHROME_SILICON_NMM2, 0.25);
    d = Math.max(6, Math.min(18, Math.round(d * 10) / 10));
    const kActual = coilSpringRate(d, D, N, G_CHROME_SILICON_NMM2);
    preload = Math.max(3, Math.min(loadPerSpring / (kActual * mr) - mr * targetSag, 0.55 * travel));
    const force = kActual * (preload + mr * travel);
    const stress = springShearStress(force, D, d);
    if (stress <= ALLOWABLE_SHEAR_NMM2 / 1.3 || D >= 92) break;
    D += 4;
  }
  const solid = (N + 2) * d;
  const freeLength = Math.round(solid + preload + mr * travel + 25);
  return { wireDia: d, coilDia: D, preload: Math.round(preload * 10) / 10, freeLength };
}

/** Fork preload sized from the COMBINED fork rate (MR=1), plus a stress-display
 *  coil sized to represent ONE leg (rate ≈ forkRate/2, per-leg load). */
function fitFork(
  forkRateCombined: number, frontCornerN: number, travel: number, D0: number, N: number,
): { wireDia: number; coilDia: number; preload: number; freeLength: number } {
  const preload = Math.max(3, Math.min(frontCornerN / forkRateCombined - 0.32 * travel, 0.55 * travel));
  // per-leg coil sized to forkRate/2 and per-leg load (= half the corner)
  let D = D0, d = 9;
  const kLeg = forkRateCombined / 2;
  for (let i = 0; i < 8; i++) {
    d = Math.max(6, Math.min(18, Math.round(Math.pow((kLeg * 8 * N * Math.pow(D, 3)) / G_CHROME_SILICON_NMM2, 0.25) * 10) / 10));
    const force = kLeg * (preload + travel);
    const stress = springShearStress(force, D, d);
    if (stress <= ALLOWABLE_SHEAR_NMM2 / 1.3 || D >= 80) break;
    D += 4;
  }
  const freeLength = Math.round((N + 2) * d + preload + travel + 25);
  return { wireDia: d, coilDia: D, preload: Math.round(preload * 10) / 10, freeLength };
}

/** Build a complete default StudioInput v2 for a category. */
export function defaultStudioInput(category: BikeCategory): StudioInput {
  const d = CATEGORY_DEFAULTS[category];
  const isFork = d.frontType === 'telescopic' || d.frontType === 'usd';

  // Full-bike frame: origin = front contact patch, +x rearward, +y up.
  const frontAxle: Point2 = { x: 0, y: d.Rf };
  const saRad = d.saAngle * Math.PI / 180;
  // Swingarm pivot: forward of the rear axle, mid-height.
  const pivot: Point2 = { x: Math.round(d.wb - d.saLen * Math.cos(saRad)), y: d.Rr + 70 };
  // Rear shock: lower mount ~38% ALONG the swingarm (realistic lever arm → MR ≈
  // 0.3–0.5 and real shock-angle sensitivity); upper mount high on the frame.
  const lowerShock: Point2 = {
    x: Math.round(pivot.x + 0.38 * d.saLen * Math.cos(saRad)),
    y: Math.round(pivot.y + 0.38 * d.saLen * Math.sin(saRad) + 30),
  };
  const upperShock: Point2 = { x: Math.round(pivot.x + d.saLen * 0.12), y: pivot.y + 350 };

  // Front link (trailing/leading) — constructed so the arm tip lands EXACTLY on
  // the front axle (so the wheel draws in the right place). Lower mount ~55%
  // along the arm; upper mount up the steering column.
  const linkArmLength = 200, linkArmAngleDeg = -28;
  const lRad = linkArmAngleDeg * Math.PI / 180;
  const linkPivot: Point2 = {
    x: Math.round(frontAxle.x - linkArmLength * Math.cos(lRad)),
    y: Math.round(frontAxle.y - linkArmLength * Math.sin(lRad)),
  };
  const linkLower: Point2 = {
    x: Math.round(linkPivot.x + 0.55 * linkArmLength * Math.cos(lRad)),
    y: Math.round(linkPivot.y + 0.55 * linkArmLength * Math.sin(lRad) + 35),
  };
  const linkUpper: Point2 = { x: linkPivot.x + 20, y: linkPivot.y + 230 };

  // Corner loads (sprung weight at each axle) for spring sizing.
  const W = (d.vehicleMass + d.riderMass) * G_ACC;
  const frontCornerN = W * d.frontPct / 100 - d.uF * G_ACC;
  const rearCornerN = W * (1 - d.frontPct / 100) - d.uR * G_ACC;
  const frontSprungKg = frontCornerN / G_ACC;
  const rearSprungKg = rearCornerN / G_ACC;

  // Target ride frequencies (band midpoints) for this category's ride goal.
  const rt = rideTargetForCategory(category);
  const fFreqTarget = (RIDE_FREQ_FRONT[rt].min + RIDE_FREQ_FRONT[rt].max) / 2;
  const rBand = rearFreqBand(rt);
  const rFreqTarget = (rBand.min + rBand.max) / 2;

  const frontMR = isFork ? 1 : motionRatioAtTravel(linkPivot, linkArmLength, linkArmAngleDeg, linkLower, linkUpper, 0);
  const isLinkage = d.rearType === 'monoshock-linkage';
  const isChain = d.frontType !== 'trailing-link' && d.frontType !== 'leading-link'
    && d.rearType !== 'unit-swing'; // scooters use CVT/belt
  const rearCount = d.rearType === 'twin-shock' ? 2 : 1;

  // Build rear geometry (spring sized AFTER we know the actual motion ratio).
  const rear: RearSuspension = {
    type: d.rearType,
    damperType: 'piggyback-reservoir',
    swingarmPivot: pivot, swingarmLength: d.saLen, swingarmAngleDeg: d.saAngle,
    lowerShockMount: lowerShock, upperShockMount: upperShock,
    linkage: null,
    wheelTravel: d.wheelTravel, shockStroke: d.shockStroke,
    spring: spring(12, d.rDD, d.rN, 200, 8), // placeholder, replaced below
  };
  // Generate a geometrically valid rising-rate linkage via the real solver, then
  // use its ACTUAL static MR to size the rear spring (so sag is consistent).
  if (isLinkage) rear.linkage = calibrateLinkage(rear, 0.32);
  const rearMR = isLinkage && rear.linkage
    ? linkageMotionRatioAtTravel(rear, rear.linkage, 0)
    : motionRatioAtTravel(pivot, d.saLen, d.saAngle, lowerShock, upperShock, 0);

  // Size springs. Rear/link coils sized to target frequency + stress; the fork
  // uses its given combined rate with a stress-display coil.
  const rf = sizeSpring(rFreqTarget, rearSprungKg, rearMR > 0 ? rearMR : 0.38, d.rDD, d.rN, d.wheelTravel, rearCornerN, rearCount);
  rear.spring = spring(rf.wireDia, rf.coilDia, d.rN, rf.freeLength, rf.preload);
  const ff = isFork
    ? fitFork(d.forkRate, frontCornerN, d.forkTravel, d.fDD, d.fN)
    : sizeSpring(fFreqTarget, frontSprungKg, frontMR > 0 ? frontMR : 1, d.fDD, d.fN, d.forkTravel, frontCornerN);

  return {
    vehicle: {
      category,
      vehicleMass: d.vehicleMass, riderMass: d.riderMass,
      passengerMass: 0, cargoMass: 0,
      unsprungFront: d.uF, unsprungRear: d.uR, frontWeightPct: d.frontPct,
      wheelbase: d.wb, frontWheelDia: d.Rf * 2, rearWheelDia: d.Rr * 2,
    },
    front: {
      type: d.frontType,
      rakeDeg: d.rakeDeg, forkOffset: 30, forkLength: d.forkLen, forkSpringRate: d.forkRate,
      linkPivot, linkArmLength, linkArmAngleDeg,
      linkLowerMount: linkLower, linkUpperMount: linkUpper,
      travel: d.forkTravel,
      spring: spring(ff.wireDia, ff.coilDia, d.fN, ff.freeLength, ff.preload),
    },
    rear,
    drivetrain: {
      isChainDrive: isChain,
      frontSprocket: 15, rearSprocket: 45, chainPitch: 15.875,
      countershaftOffset: { x: -10, y: 15 }, // just above + slightly forward of pivot
    },
    targets: { rideTarget: rideTargetForCategory(category) },
  };
}

function rideTargetForCategory(c: BikeCategory): RideTarget {
  switch (c) {
    case 'sport': case 'supermoto': return 'sport';
    case 'cruiser': case 'touring': return 'touring';
    case 'adv': case 'enduro': return 'offroad';
    default: return 'handling';
  }
}
