/**
 * studio/computeStudio.ts — Suspension Design Studio orchestrator v2 (ISOLATED)
 *
 * Computes the FRONT and REAR suspension subsystems independently, so each end
 * can use a different architecture. Pure function, no store access, no side
 * effects. Reuses validated engine leaf functions (suspension.ts / cog.ts) plus
 * the book/supplemented formulas in formulas.ts.
 *
 * KEY ASSUMPTIONS (documented per spec validation requirement):
 *  - CoG height Y_cg ≈ 0.32·wheelbase when not measured.
 *  - Telescopic / USD fork: motion ratio MR = 1.0 (spring travel = wheel travel),
 *    fork spring rate is the COMBINED two-leg rate.
 *  - Trailing / leading link & swingarm: MR from real side-view arm kinematics
 *    (formulas.ts motionRatioAtTravel) — the lower mount rotates with the arm.
 *  - Twin-shock rear: two springs in parallel (rate ×2).
 *  - Linkage progression beyond the direct shock kinematics is reported as a
 *    progression ratio MR(top)/MR(bottom); a full 4-bar solve is out of scope.
 */

import {
  StudioInput, StudioResults, StudioMetric, StudioCurves, Provenance,
  FrontSuspension, RearSuspension, CoilSpring, Axle, AxleCurves, SweepRow,
} from './types';
import {
  Band, SAG_PERCENT_TARGET, FREE_SAG_PERCENT_TARGET,
  RIDE_FREQ_FRONT, rearFreqBand, DAMPING_RATIO_TARGET, MIN_SAFETY_FACTOR,
} from './knowledgeModel';
import {
  coilSpringRate, coilBind, springShearStress, safetyFactor,
  staticSag, sagPercent, motionRatioAtTravel, shockLengthAtTravel,
  springAxialForce, computeWheelRate, computeNaturalFrequency,
  computeCriticalDamping, computeSprungMasses, computeStaticAxleLoads, G,
} from './formulas';
import { linkageStateAtTravel, linkageMotionRatioAtTravel } from './linkage';
import { studioAntiSquat, studioTrail, studioChainTension } from './context';

const Y_CG_WB_FRACTION = 0.32;

function statusFor(value: number, band?: Band): 'ok' | 'warn' | 'na' {
  if (!band) return 'na';
  return value >= band.min && value <= band.max ? 'ok' : 'warn';
}

function metric(
  axle: Axle, key: string, label: string, value: number, unit: string,
  source: Provenance, cite: string, band?: Band, note?: string,
): StudioMetric {
  return {
    axle, key, label, value, unit, source, cite,
    target: band ? [band.min, band.max] : undefined,
    status: statusFor(value, band), note,
  };
}

const safeFreq = (wr: number, m: number) =>
  wr > 0 && m > 1e-6 ? computeNaturalFrequency(wr, m) : 0;

// ── Per-corner kinematic descriptor ───────────────────────────────────────────
interface CornerKin {
  /** spring (axial) rate, N/mm, including parallel spring count */
  rate: number;
  /** motion ratio at wheel travel u (mm bump) */
  mrAt: (u: number) => number;
  /** shock/spring length at wheel travel u */
  shockLenAt: (u: number) => number;
  /** spring physical geometry for stress / coil-bind */
  spring: CoilSpring;
  springCount: number;
}

function frontKin(f: FrontSuspension): CornerKin {
  const isFork = f.type === 'telescopic' || f.type === 'usd';
  if (isFork) {
    // Fork: MR = 1, spring travel = wheel travel. Rate is the combined 2-leg rate.
    return {
      rate: f.forkSpringRate,
      mrAt: () => 1,
      shockLenAt: (u) => Math.max(0, f.forkLength - u),
      spring: f.spring, springCount: 2,
    };
  }
  // Trailing / leading link — arm kinematics (same math as a swingarm).
  const rate = coilSpringRate(f.spring.wireDia, f.spring.meanCoilDia, f.spring.activeCoils, f.spring.shearModulus);
  return {
    rate,
    mrAt: (u) => motionRatioAtTravel(f.linkPivot, f.linkArmLength, f.linkArmAngleDeg, f.linkLowerMount, f.linkUpperMount, u),
    shockLenAt: (u) => shockLengthAtTravel(f.linkPivot, f.linkArmLength, f.linkArmAngleDeg, f.linkLowerMount, f.linkUpperMount, u),
    spring: f.spring, springCount: 1,
  };
}

function rearKin(r: RearSuspension): CornerKin {
  const count = r.type === 'twin-shock' ? 2 : 1;
  const baseRate = coilSpringRate(r.spring.wireDia, r.spring.meanCoilDia, r.spring.activeCoils, r.spring.shearModulus);
  const P = r.swingarmPivot, L = r.swingarmLength, a0 = r.swingarmAngleDeg;

  // monoshock-linkage → REAL four-bar solve (rising rate). Other types → the
  // shock acts directly between a swingarm-fixed mount and the frame.
  if (r.type === 'monoshock-linkage' && r.linkage) {
    const lk = r.linkage;
    return {
      rate: baseRate,
      mrAt: (u) => linkageMotionRatioAtTravel(r, lk, u),
      shockLenAt: (u) => linkageStateAtTravel(r, lk, u).shockLen,
      spring: r.spring, springCount: 1,
    };
  }
  return {
    rate: baseRate * count,
    mrAt: (u) => motionRatioAtTravel(P, L, a0, r.lowerShockMount, r.upperShockMount, u),
    shockLenAt: (u) => shockLengthAtTravel(P, L, a0, r.lowerShockMount, r.upperShockMount, u),
    spring: r.spring, springCount: count,
  };
}

// ── Per-corner computation ────────────────────────────────────────────────────
interface CornerOut {
  MR: number; wheelRate: number; rideFreq: number; critDamp: number; optDamp: number;
  sag: number; sagPct: number; freeSagPct: number; riderSag: number;
  workingShockTravel: number; springComp: number; coilBindMargin: number;
  solidLength: number; usableStroke: number; springForce: number; shockForce: number;
  wheelForce: number; springStress: number; sf: number; progression: number;
  staticLoad: number; dynLoad: number; sprungMass: number;
  curves: AxleCurves;
}

function computeCorner(
  kin: CornerKin, travel: number, preload: number,
  cornerLoad: number, cornerLoadBike: number, dynLoad: number,
  sprungMass: number, zetaTarget: number, warnings: string[], tag: string,
): CornerOut {
  const MR = kin.mrAt(0);
  const wheelRate = computeWheelRate(kin.rate, MR);          // k·MR² [Foale Eq 7.1]
  const rideFreq = safeFreq(wheelRate, sprungMass);
  const critDamp = wheelRate > 0 && sprungMass > 0 ? computeCriticalDamping(wheelRate, sprungMass) : 0;
  const optDamp = zetaTarget * critDamp;

  const preloadForceWheel = springAxialForce(kin.rate, preload) * MR;
  const sag = staticSag(cornerLoad, wheelRate, preloadForceWheel);
  const freeSag = staticSag(cornerLoadBike, wheelRate, preloadForceWheel);
  const riderSag = Math.max(0, sag - freeSag);
  const sagPct = sagPercent(sag, travel);
  const freeSagPct = sagPercent(freeSag, travel);

  const workingShockTravel = MR * travel;
  const springComp = preload + workingShockTravel;
  const { solidLength, usableStroke } = coilBind(kin.spring.freeLength, kin.spring.activeCoils, kin.spring.wireDia);
  const coilBindMargin = usableStroke - springComp;
  if (coilBindMargin < 0) warnings.push(`${tag}: spring reaches coil bind before full travel — raise free length or reduce preload/travel.`);

  // Force per spring (twin-shock splits the corner load across two springs).
  const springForce = springAxialForce(kin.rate, springComp);
  const shockForce = springForce;
  const wheelForce = shockForce * MR * kin.springCount;
  const perSpringForce = springForce; // rate already includes count; per-spring uses base geometry
  const springStress = springShearStress(perSpringForce / Math.max(1, kin.springCount), kin.spring.meanCoilDia, kin.spring.wireDia);
  const sf = safetyFactor(kin.spring.allowableShear, springStress);
  if (sf < MIN_SAFETY_FACTOR) warnings.push(`${tag}: spring safety factor ${sf.toFixed(2)} below ${MIN_SAFETY_FACTOR}.`);

  // Sweep over travel → curves + progression.
  const sweep: SweepRow[] = [];
  const STEPS = 30;
  const shockLen0 = kin.shockLenAt(0);
  let mrTop = MR, mrBottom = MR;
  for (let i = 0; i <= STEPS; i++) {
    const u = (i / STEPS) * travel;
    const mr = kin.mrAt(u);
    const shockTravelU = Math.max(0, shockLen0 - kin.shockLenAt(u));
    const wr = computeWheelRate(kin.rate, mr);
    const compU = preload + shockTravelU;
    const fU = springAxialForce(kin.rate, compU);
    sweep.push({
      wheelTravel: u, shockTravel: shockTravelU, motionRatio: mr, wheelRate: wr,
      springForce: fU, springStress: springShearStress(fU / Math.max(1, kin.springCount), kin.spring.meanCoilDia, kin.spring.wireDia),
      shockForce: fU, rideFrequency: safeFreq(wr, sprungMass), springCompression: compU,
    });
    if (i === 0) mrBottom = mr;
    if (i === STEPS) mrTop = mr;
  }
  const progression = mrBottom > 0 ? mrTop / mrBottom : 1;

  const forceDeflection: AxleCurves['forceDeflection'] = [];
  const maxDef = Math.max(usableStroke, springComp);
  for (let i = 0; i <= 20; i++) {
    const x = (i / 20) * maxDef;
    forceDeflection.push({ deflection: x, force: springAxialForce(kin.rate, x) });
  }

  return {
    MR, wheelRate, rideFreq, critDamp, optDamp, sag, sagPct, freeSagPct, riderSag,
    workingShockTravel, springComp, coilBindMargin, solidLength, usableStroke,
    springForce, shockForce, wheelForce, springStress, sf, progression,
    staticLoad: cornerLoad, dynLoad, sprungMass,
    curves: { sweep, forceDeflection },
  };
}

export function computeStudio(input: StudioInput): StudioResults {
  const { vehicle: v, front: f, rear: r, targets: t, drivetrain: dt } = input;
  const warnings: string[] = [];

  const totalMass = Math.max(1, v.vehicleMass + v.riderMass + v.passengerMass + v.cargoMass);
  const massBike = Math.max(1, v.vehicleMass);
  const WB = Math.max(1, v.wheelbase);
  const X_cg = WB * (1 - v.frontWeightPct / 100);
  const Y_cg = Y_CG_WB_FRACTION * WB;

  const axleLoad = computeStaticAxleLoads(totalMass, X_cg, WB);
  const axleLoadBike = computeStaticAxleLoads(massBike, WB * (1 - v.frontWeightPct / 100), WB);
  const { sprungMassFront, sprungMassRear, sprungMass } =
    computeSprungMasses(totalMass, v.unsprungFront, v.unsprungRear, X_cg, WB);

  const dW_brake = totalMass * 0.8 * G * (Y_cg / WB);
  const dW_accel = totalMass * 0.5 * G * (Y_cg / WB);

  const zeta = DAMPING_RATIO_TARGET[t.rideTarget];
  const zetaTarget = (zeta.min + zeta.max) / 2;

  const frontOut = computeCorner(
    frontKin(f), f.travel, f.spring.preload,
    axleLoad.R_front, axleLoadBike.R_front, axleLoad.R_front + dW_brake,
    sprungMassFront, zetaTarget, warnings, 'Front',
  );
  const rearOut = computeCorner(
    rearKin(r), r.wheelTravel, r.spring.preload,
    axleLoad.R_rear, axleLoadBike.R_rear, axleLoad.R_rear - dW_accel,
    sprungMassRear, zetaTarget, warnings, 'Rear',
  );

  const sagBand = SAG_PERCENT_TARGET[t.rideTarget];
  const freqF = RIDE_FREQ_FRONT[t.rideTarget];
  const freqR = rearFreqBand(t.rideTarget);

  // ── Metrics (tagged by axle) ───────────────────────────────────────────────
  const metrics: StudioMetric[] = [];
  const addCorner = (axle: Axle, o: CornerOut, freqBand: Band) => {
    const A = axle === 'front' ? 'F' : 'R';
    metrics.push(
      metric(axle, `staticLoad${A}`, 'Static load', o.staticLoad, 'N', 'derived', 'Foale Eq 6.5/6.6'),
      metric(axle, `dynLoad${A}`, axle === 'front' ? 'Dynamic load (0.8g brake)' : 'Dynamic load (0.5g accel)', o.dynLoad, 'N', 'derived', 'Foale Ch5'),
      metric(axle, `mr${A}`, 'Motion ratio', o.MR, '–', 'derived', 'Foale Ch6'),
      metric(axle, `suspRatio${A}`, 'Suspension ratio (1/MR)', o.MR > 0 ? 1 / o.MR : 0, '–', 'derived', 'Foale Ch6'),
      metric(axle, `prog${A}`, 'Rising-rate (MR top/bottom)', o.progression, '–', 'supplemented', 'leverage curve'),
      metric(axle, `wheelRate${A}`, 'Wheel rate', o.wheelRate, 'N/mm', 'derived', 'Foale Eq 7.1'),
      metric(axle, `effRate${A}`, 'Effective spring rate', frontKinRate(input, axle), 'N/mm', 'book', 'Book Ch2 (G·d⁴/8ND³)'),
      metric(axle, `rideFreq${A}`, 'Ride frequency', o.rideFreq, 'Hz', 'supplemented', 'ride-freq practice', freqBand),
      metric(axle, `natFreq${A}`, 'Natural frequency', o.rideFreq, 'Hz', 'derived', 'Foale Eq 7.3', freqBand),
      metric(axle, `dampRatio${A}`, 'Damping ratio (target ζ)', zetaTarget, '–', 'supplemented', 'Cossalter Ch5', DAMPING_RATIO_TARGET[t.rideTarget]),
      metric(axle, `critDamp${A}`, 'Critical damping', o.critDamp, 'N·s/m', 'derived', 'Cossalter Eq 7.12'),
      metric(axle, `optDamp${A}`, 'Optimal damping coeff.', o.optDamp, 'N·s/m', 'supplemented', 'Cossalter Ch5'),
      metric(axle, `staticSag${A}`, 'Static sag', o.sag, 'mm', 'book', 'Book Ch2'),
      metric(axle, `staticSagPct${A}`, 'Static sag %', o.sagPct, '%', 'book', 'Book Ch2', sagBand),
      metric(axle, `riderSag${A}`, 'Rider sag', o.riderSag, 'mm', 'book', 'Book Ch2'),
      metric(axle, `freeSagPct${A}`, 'Free sag %', o.freeSagPct, '%', 'book', 'Book Ch2', FREE_SAG_PERCENT_TARGET),
      metric(axle, `wheelTravel${A}`, 'Wheel travel', axle === 'front' ? f.travel : r.wheelTravel, 'mm', 'derived', 'geometry'),
      metric(axle, `shockTravel${A}`, 'Shock travel (working)', o.workingShockTravel, 'mm', 'derived', 'MR·wheel travel'),
      metric(axle, `springComp${A}`, 'Spring compression (max)', o.springComp, 'mm', 'derived', 'preload + stroke'),
      metric(axle, `coilBind${A}`, 'Coil-bind margin', o.coilBindMargin, 'mm', 'book', 'Book Ch2'),
      metric(axle, `solidLen${A}`, 'Spring solid length', o.solidLength, 'mm', 'book', 'Book Ch2'),
      metric(axle, `shockForce${A}`, 'Shock force (max)', o.shockForce, 'N', 'derived', 'F = k·x'),
      metric(axle, `wheelForce${A}`, 'Wheel force (max)', o.wheelForce, 'N', 'derived', 'F_wheel = F_shock·MR'),
      metric(axle, `springForce${A}`, 'Spring force (max)', o.springForce, 'N', 'book', 'Book Ch2 (F=k·x)'),
      metric(axle, `springStress${A}`, 'Spring shear stress (max)', o.springStress, 'N/mm²', 'supplemented', 'Shigley (Wahl)'),
      metric(axle, `sf${A}`, 'Safety factor (spring)', o.sf, '–', 'supplemented', 'Shigley', { min: MIN_SAFETY_FACTOR, max: 99 }),
      metric(axle, `maxDefl${A}`, 'Maximum spring deflection', o.springComp, 'mm', 'derived', 'geometry'),
      metric(axle, `packaging${A}`, 'Packaging clearance', o.coilBindMargin, 'mm', 'derived', 'coil-bind packaging'),
    );
  };
  addCorner('front', frontOut, freqF);
  addCorner('rear', rearOut, freqR);
  metrics.push(metric('rear', 'sprungMass', 'Sprung mass (total)', sprungMass, 'kg', 'derived', 'Foale Eq 7.5'));

  // ── Context geometry (track Studio edits) ──────────────────────────────────
  const Rf = v.frontWheelDia / 2, Rr = v.rearWheelDia / 2;
  const rearAxle = {
    x: r.swingarmPivot.x + r.swingarmLength * Math.cos(r.swingarmAngleDeg * Math.PI / 180),
    y: r.swingarmPivot.y + r.swingarmLength * Math.sin(r.swingarmAngleDeg * Math.PI / 180),
  };
  const trail = studioTrail(Rf, f.rakeDeg, f.forkOffset);
  const as = studioAntiSquat(
    r.swingarmPivot, r.swingarmAngleDeg, rearAxle, Y_cg,
    dt.countershaftOffset, dt.frontSprocket, dt.rearSprocket, dt.chainPitch, dt.isChainDrive,
  );
  // representative chain tension at 0.5g accel (matches dynamic-load assumption)
  const chainTension = dt.isChainDrive
    ? studioChainTension(totalMass, 0.5 * G, Rr, dt.rearSprocket, dt.chainPitch) : 0;

  metrics.push(
    metric('front', 'trailF', 'Front trail', trail, 'mm', 'book', 'Book Ch5 / Foale Eq 5.1'),
    metric('rear', 'antiSquatR', 'Anti-squat', as.antiSquatPercent, '%', 'book', 'Book Ch5 / Foale Ch11'),
    metric('rear', 'chainTensionR', 'Chain tension (0.5g)', chainTension, 'N', 'derived', 'T = F·R/r_sprocket'),
  );

  const curves: StudioCurves = { front: frontOut.curves, rear: rearOut.curves };

  const raw: Record<string, number> = {
    totalMass, sprungMass, sprungMassFront, sprungMassRear, X_cg, Y_cg,
    frontMR: frontOut.MR, rearMR: rearOut.MR,
    frontWheelRate: frontOut.wheelRate, rearWheelRate: rearOut.wheelRate,
    frontRideFreq: frontOut.rideFreq, rearRideFreq: rearOut.rideFreq,
    frontSag: frontOut.sag, rearSag: rearOut.sag,
    frontSagPct: frontOut.sagPct, rearSagPct: rearOut.sagPct,
    frontSF: frontOut.sf, rearSF: rearOut.sf,
    frontProgression: frontOut.progression, rearProgression: rearOut.progression,
    staticLoadFront: axleLoad.R_front, staticLoadRear: axleLoad.R_rear,
    // context geometry (Studio-frame, tracks edits)
    trail, antiSquatPct: as.antiSquatPercent, chainForceAngleDeg: as.chainForceAngleDeg,
    chainTension, icX: as.IC ? as.IC.x : NaN, icY: as.IC ? as.IC.y : NaN,
    isChainDrive: dt.isChainDrive ? 1 : 0,
    rearAxleX: rearAxle.x, rearAxleY: rearAxle.y,
  };

  return { metrics, curves, raw, warnings };
}

// effective spring rate (axial) for display — fork uses combined rate, others coil rate × count
function frontKinRate(input: StudioInput, axle: Axle): number {
  if (axle === 'front') {
    const f = input.front;
    if (f.type === 'telescopic' || f.type === 'usd') return f.forkSpringRate;
    return coilSpringRate(f.spring.wireDia, f.spring.meanCoilDia, f.spring.activeCoils, f.spring.shearModulus);
  }
  const r = input.rear;
  const count = r.type === 'twin-shock' ? 2 : 1;
  return coilSpringRate(r.spring.wireDia, r.spring.meanCoilDia, r.spring.activeCoils, r.spring.shearModulus) * count;
}
