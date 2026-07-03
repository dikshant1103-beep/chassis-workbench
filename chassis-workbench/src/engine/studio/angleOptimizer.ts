/**
 * studio/angleOptimizer.ts — Optimal shock mounting angle v2 (ISOLATED)
 *
 * Iterates the shock installation angle (from vertical) over a practical range,
 * holding the installed shock length and lower mount fixed and repositioning the
 * upper (frame) mount onto the corresponding arc. Evaluates the resulting
 * behaviour at the chosen end (rear by default) and returns the best angle plus
 * a structured engineering rationale.
 *
 * SOURCE of the angle→MR coupling: DERIVED kinematics (formulas.ts); spring rate
 * from [BOOK Ch2]; stress from [SUPPLEMENTED Shigley]; ride-frequency band from
 * the knowledge model. Web research (Vorsprung / ProMechA / Wavey Dynamics)
 * confirms mounting angle changes both MR magnitude and rate progression.
 */

import {
  StudioInput, AngleOptimizerResult, AngleOptimizerSample, Point2, Axle,
} from './types';
import { RIDE_FREQ_FRONT, rearFreqBand, MIN_SAFETY_FACTOR } from './knowledgeModel';
import {
  coilSpringRate, coilBind, springShearStress, safetyFactor,
  motionRatioAtTravel, shockLengthAtTravel, springAxialForce,
  computeWheelRate, computeNaturalFrequency, computeSprungMasses,
} from './formulas';

const DEG = Math.PI / 180;
const ANGLE_MIN = 15, ANGLE_MAX = 75, ANGLE_STEP = 1;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function optimizeShockAngle(input: StudioInput, axle: Axle = 'rear'): AngleOptimizerResult {
  const { vehicle: v, targets: t } = input;
  const WB = Math.max(1, v.wheelbase);
  const X_cg = WB * (1 - v.frontWeightPct / 100);
  const totalMass = Math.max(1, v.vehicleMass + v.riderMass + v.passengerMass + v.cargoMass);
  const { sprungMassFront, sprungMassRear } =
    computeSprungMasses(totalMass, v.unsprungFront, v.unsprungRear, X_cg, WB);
  const sprungMass = axle === 'front' ? sprungMassFront : sprungMassRear;

  // Geometry of the corner being optimized.
  const isFront = axle === 'front';
  const pivot = isFront ? input.front.linkPivot : input.rear.swingarmPivot;
  const armLen = isFront ? input.front.linkArmLength : input.rear.swingarmLength;
  const armAngle = isFront ? input.front.linkArmAngleDeg : input.rear.swingarmAngleDeg;
  const lower = isFront ? input.front.linkLowerMount : input.rear.lowerShockMount;
  const upper = isFront ? input.front.linkUpperMount : input.rear.upperShockMount;
  const spring = isFront ? input.front.spring : input.rear.spring;
  const travel = isFront ? input.front.travel : input.rear.wheelTravel;
  const shockStroke = isFront ? input.front.travel : input.rear.shockStroke;

  const kRear = coilSpringRate(spring.wireDia, spring.meanCoilDia, spring.activeCoils, spring.shearModulus);
  const { usableStroke } = coilBind(spring.freeLength, spring.activeCoils, spring.wireDia);
  const freqBand = isFront ? RIDE_FREQ_FRONT[t.rideTarget] : rearFreqBand(t.rideTarget);
  const freqMid = (freqBand.min + freqBand.max) / 2;

  // Installed shock length held fixed; reposition the upper mount on its arc,
  // ON THE SAME SIDE the shock currently leans (so the sweep passes through the
  // as-built configuration and explores realistic neighbouring angles).
  const L_install = shockLengthAtTravel(pivot, armLen, armAngle, lower, upper, 0);
  const leanSign = (upper.x - lower.x) >= 0 ? 1 : -1; // forward(−) vs rearward(+)

  const samples: AngleOptimizerSample[] = [];

  for (let angle = ANGLE_MIN; angle <= ANGLE_MAX + 1e-9; angle += ANGLE_STEP) {
    const upperA: Point2 = {
      x: lower.x + leanSign * L_install * Math.sin(angle * DEG),
      y: lower.y + L_install * Math.cos(angle * DEG),
    };

    const MR = motionRatioAtTravel(pivot, armLen, armAngle, lower, upperA, 0);
    const mrBottom = motionRatioAtTravel(pivot, armLen, armAngle, lower, upperA, 0);
    const mrTop = motionRatioAtTravel(pivot, armLen, armAngle, lower, upperA, travel);
    const progression = mrBottom > 0 ? mrTop / mrBottom : 1;

    const wheelRate = computeWheelRate(kRear, MR);
    const rideFrequency = sprungMass > 0 && wheelRate > 0 ? computeNaturalFrequency(wheelRate, sprungMass) : 0;

    const workingShockTravel = Math.min(shockStroke, MR * travel);
    const springCompression = spring.preload + workingShockTravel;
    const springForce = springAxialForce(kRear, springCompression);
    const shockForce = springForce;
    const stress = springShearStress(springForce, spring.meanCoilDia, spring.wireDia);
    const sf = safetyFactor(spring.allowableShear, stress);
    const packagingClearance = usableStroke - springCompression;
    const suspensionTravel = MR > 0 ? Math.min(travel, Math.max(0, (usableStroke - spring.preload) / MR)) : 0;

    const feasible = MR > 0.2 && MR < 1.1 && sf >= MIN_SAFETY_FACTOR && packagingClearance > 0;

    // Composite score (higher = better). The spring is FIXED during the sweep, so
    // ride frequency tracks the target only near the as-built leverage; rising
    // rate and packaging pull toward more angle → an interior optimum.
    const freqErr = freqMid > 0 ? Math.abs(rideFrequency - freqMid) / freqMid : 1;
    const freqScore = clamp01(1 - freqErr);                       // peaks at target freq
    const sfScore = clamp01((sf - 1) / 1.0);                      // reward headroom above 1
    const stressScore = clamp01(1 - stress / spring.allowableShear);
    const packScore = clamp01(packagingClearance / 20);
    // Reward mild rising rate (progression ~0.85–0.95 = MR falls through travel).
    const progScore = clamp01(1 - Math.abs(progression - 0.90) / 0.30);

    // Mild preference for a realistic mounting angle (~30° from vertical) breaks
    // boundary ties so the recommendation lands in the practical interior.
    const centerScore = clamp01(1 - Math.abs(angle - 30) / 45);

    let score = 0.50 * freqScore + 0.14 * progScore + 0.12 * sfScore
              + 0.08 * stressScore + 0.08 * packScore + 0.08 * centerScore;
    if (!feasible) score *= 0.25;

    samples.push({
      angleDeg: angle, motionRatio: MR, wheelRate, shockForce, springCompression,
      rideFrequency, suspensionTravel, safetyFactor: sf, packagingClearance,
      progression, score, feasible,
    });
  }

  const feasibleSamples = samples.filter(x => x.feasible);
  const pool = feasibleSamples.length ? feasibleSamples : samples;
  const best = pool.reduce<AngleOptimizerSample | null>(
    (b, x) => (b === null || x.score > b.score ? x : b), null,
  );

  const reasons: string[] = [];
  if (best) {
    reasons.push(`Best motion ratio: ${best.motionRatio.toFixed(3)} (lever sweet-spot ≈ 0.50 for balanced wheel rate)`);
    const inBand = best.rideFrequency >= freqBand.min && best.rideFrequency <= freqBand.max;
    reasons.push(`Target ride frequency ${inBand ? 'achieved' : 'closest available'}: ${best.rideFrequency.toFixed(2)} Hz (target ${freqBand.min}–${freqBand.max} Hz, "${t.rideTarget}")`);
    reasons.push(`Rising-rate ${best.progression < 0.98 ? 'present' : 'mild/linear'}: MR ${best.progression.toFixed(3)} top/bottom`);
    reasons.push(`Lowest peak spring stress region (SF ${best.safetyFactor.toFixed(2)}, min ${MIN_SAFETY_FACTOR})`);
    reasons.push(`Packaging ${best.packagingClearance > 0 ? 'satisfied' : 'TIGHT'}: ${best.packagingClearance.toFixed(1)} mm stroke margin before coil bind`);
    if (!best.feasible) reasons.push('⚠ No fully-feasible angle in range — best is least-compromised; revisit spring/geometry.');
  } else {
    reasons.push('No valid angle samples — check geometry inputs.');
  }

  return { axle, samples, best, reasons };
}
