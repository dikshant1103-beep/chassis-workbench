/**
 * families.ts — 8 motorcycle family presets
 *
 * All values are physically self-consistent and derived from:
 *   • Published manufacturer specs (geometry, dimensions)
 *   • Foale (2006) Ch. 8–9 — suspension setup methodology
 *   • Cossalter (2006) — aerodynamics reference data
 *
 * Spring rates are COMBINED front (both legs equivalent) for telescopic forks.
 * Sag values satisfy: WR × (preload + sag) = total_sprung_axle_load ± rounding.
 * Fork bending stiffness: realistic lateral stiffness at axle from tube EI analysis.
 * Aero: based on published drag coefficient data and typical engine outputs.
 *
 * Last calibrated: 2026-05-20
 */

import { ComputeAllInput } from '../engine/types';

export interface FamilyPreset {
  name: string;
  description: string;
  input: ComputeAllInput;
}

// ── Sport / Supersport ───────────────────────────────────────────────────────
// Reference: Yamaha YZF-R1 / Honda CBR1000RR-R class
// Sprung load: front 769 N / rear 634 N
// Spring: k×MR²×(preload+sag) = axle load → 19×0.941×43=769 N ✓  45.5×0.4225×33=634 N ✓
const sport: ComputeAllInput = {
  geometry: {
    headAngle: 24, forkOffset: 33, forkLength: 720,
    frontWheelDia: 600, rearWheelDia: 640,
    wheelbase: 1390, swingarmLength: 580,
    swingarmPivotHeight: 385, swingarmPivotX: 830,
    rearAxleHeight: 325, frontAxleHeight: 300,
    steeringOffset: 0, seatHeight: 820, groundClearance: 130,
  },
  massComponents: [
    { mass: 55, x: 560, y: 340, label: 'Engine' },
    { mass: 12, x: 700, y: 480, label: 'Frame' },
    { mass: 4,  x: 380, y: 220, label: 'Battery' },
    { mass: 8,  x: 460, y: 240, label: 'Exhaust' },
    { mass: 6,  x: 750, y: 280, label: 'Swingarm+Wheel' },
    { mass: 7,  x: 300, y: 300, label: 'Front Wheel' },
    { mass: 10, x: 690, y: 340, label: 'Fuel (full)' },
    { mass: 75, x: 710, y: 1020, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 19.0, springRateRear: 45.5,
    motionRatioFront: 0.97, motionRatioRear: 0.65,
    unsprungFront: 14, unsprungRear: 20,
    unsprungComponentsFront: { wheelRim: 4.5, tyre: 4.0, brakeDisc: 1.5, brakeCaliper: 1.5, lowerForkLegs: 2.5 },
    unsprungComponentsRear:  { wheelRim: 5.0, tyre: 5.0, brakeDisc: 1.0, brakeCaliper: 0.8, swingarmHalf: 5.5, chainPartial: 2.7 },
    sagFront: 35, sagRear: 25, preloadFront: 8, preloadRear: 8,
    compDamping: 12, rebDamping: 15, forkTravel: 120, shockTravel: 58,
    dampingCoeffFront: 12, dampingCoeffRear: 18,
  },
  chain: {
    frontSprocket: 16, rearSprocket: 42,
    sprocketCenterX: -270, sprocketCenterY: -105,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 320, handlebarY: 960,
    seatX: 760, seatY: 820,
    footpegX: 820, footpegY: 330,
    riserHeight_mm: 15, handlebarReach_mm: 40,
  },
  dynamics: {
    brakingDecel: 0.8, accelG: 0.5,
    cornerSpeed: 15, cornerRadius: 50, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 180,     // N/mm — 43mm USD tubes, ~5mm deflection at 1g brake
    forkTorsionalStiffness: 700,   // N·m/deg
    steeringHeadStiffness: 1200,
  },
  aero: {
    Cx: 0.33, Cz: -0.05, frontalArea: 0.35,
    pressureCentreX: 650, referenceSpeedKmh: 250, maxSpeedKmh: 300,
    enginePower_kW: 182, drivetrainEta: 0.88,
    topGearRatioOverall: 4.41, maxRPM: 14000,  // primary 1.739 × 6th 0.966 × 42/16; ~383 km/h ceiling
  },
};

// ── Naked / Roadster ─────────────────────────────────────────────────────────
// Reference: Yamaha MT-09 / Kawasaki Z900 class
// Sprung load: front 752 N / rear 611 N
const naked: ComputeAllInput = {
  geometry: {
    headAngle: 25, forkOffset: 30, forkLength: 680,
    frontWheelDia: 600, rearWheelDia: 640,
    wheelbase: 1450, swingarmLength: 600,
    swingarmPivotHeight: 390, swingarmPivotX: 860,
    rearAxleHeight: 330, frontAxleHeight: 300,
    steeringOffset: 0, seatHeight: 810, groundClearance: 145,
  },
  massComponents: [
    { mass: 50, x: 580, y: 340, label: 'Engine' },
    { mass: 12, x: 720, y: 490, label: 'Frame' },
    { mass: 4,  x: 390, y: 220, label: 'Battery' },
    { mass: 7,  x: 470, y: 250, label: 'Exhaust' },
    { mass: 6,  x: 780, y: 280, label: 'Swingarm+Wheel' },
    { mass: 7,  x: 300, y: 300, label: 'Front Wheel' },
    { mass: 12, x: 700, y: 350, label: 'Fuel (full)' },
    { mass: 75, x: 730, y: 1035, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 18.5, springRateRear: 35.0,
    motionRatioFront: 0.97, motionRatioRear: 0.68,
    unsprungFront: 14, unsprungRear: 20,
    unsprungComponentsFront: { wheelRim: 4.5, tyre: 4.0, brakeDisc: 1.5, brakeCaliper: 1.5, lowerForkLegs: 2.5 },
    unsprungComponentsRear:  { wheelRim: 5.0, tyre: 5.0, brakeDisc: 1.0, brakeCaliper: 0.8, swingarmHalf: 5.5, chainPartial: 2.7 },
    sagFront: 35, sagRear: 30, preloadFront: 8, preloadRear: 8,
    compDamping: 10, rebDamping: 12, forkTravel: 130, shockTravel: 62,
    dampingCoeffFront: 10, dampingCoeffRear: 15,
  },
  chain: {
    frontSprocket: 17, rearSprocket: 42,
    sprocketCenterX: -280, sprocketCenterY: -110,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 400, handlebarY: 1040,
    seatX: 780, seatY: 810,
    footpegX: 840, footpegY: 330,
    riserHeight_mm: 55, handlebarReach_mm: -40,
  },
  dynamics: {
    brakingDecel: 0.8, accelG: 0.4,
    cornerSpeed: 12, cornerRadius: 40, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 130,    // N/mm — 41mm USD tubes
    forkTorsionalStiffness: 550,
    steeringHeadStiffness: 900,
  },
  aero: {
    Cx: 0.62, Cz: 0.02, frontalArea: 0.45,
    pressureCentreX: 680, referenceSpeedKmh: 180, maxSpeedKmh: 240,
    enginePower_kW: 88, drivetrainEta: 0.88,
    topGearRatioOverall: 4.28, maxRPM: 10500,  // MT-09 class: primary 1.741 × 6th 0.878 × 42/15; ~296 km/h ceiling
  },
};

// ── Adventure / ADV ──────────────────────────────────────────────────────────
// Reference: BMW R1250GS / KTM 1290 Adventure class
// Sprung load: front 868 N / rear 692 N
const adv: ComputeAllInput = {
  geometry: {
    headAngle: 27, forkOffset: 28, forkLength: 780,
    frontWheelDia: 660, rearWheelDia: 660,
    wheelbase: 1510, swingarmLength: 630,
    swingarmPivotHeight: 420, swingarmPivotX: 890,
    rearAxleHeight: 360, frontAxleHeight: 330,
    steeringOffset: 0, seatHeight: 860, groundClearance: 220,
  },
  massComponents: [
    { mass: 55, x: 600, y: 360, label: 'Engine' },
    { mass: 14, x: 750, y: 510, label: 'Frame' },
    { mass: 5,  x: 400, y: 240, label: 'Battery' },
    { mass: 8,  x: 500, y: 260, label: 'Exhaust' },
    { mass: 7,  x: 820, y: 300, label: 'Swingarm+Wheel' },
    { mass: 8,  x: 330, y: 330, label: 'Front Wheel' },
    { mass: 20, x: 700, y: 380, label: 'Fuel (full)' },
    { mass: 80, x: 750, y: 1075, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 18.0, springRateRear: 31.0,
    motionRatioFront: 0.95, motionRatioRear: 0.70,
    unsprungFront: 16, unsprungRear: 22,
    unsprungComponentsFront: { wheelRim: 5.5, tyre: 5.0, brakeDisc: 1.5, brakeCaliper: 1.5, lowerForkLegs: 2.5 },
    unsprungComponentsRear:  { wheelRim: 5.5, tyre: 5.5, brakeDisc: 1.0, brakeCaliper: 0.8, swingarmHalf: 6.5, chainPartial: 2.7 },
    sagFront: 48, sagRear: 40, preloadFront: 5, preloadRear: 6,
    compDamping: 8, rebDamping: 10, forkTravel: 200, shockTravel: 80,
    dampingCoeffFront: 8, dampingCoeffRear: 12,
  },
  chain: {
    frontSprocket: 17, rearSprocket: 45,
    sprocketCenterX: -290, sprocketCenterY: -120,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 440, handlebarY: 1120,
    seatX: 800, seatY: 860,
    footpegX: 870, footpegY: 370,
    riserHeight_mm: 90, handlebarReach_mm: -30,
  },
  dynamics: {
    brakingDecel: 0.7, accelG: 0.35,
    cornerSpeed: 10, cornerRadius: 35, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 150,    // N/mm — 48mm WP USD
    forkTorsionalStiffness: 480,
    steeringHeadStiffness: 800,
  },
  aero: {
    Cx: 0.55, Cz: 0.05, frontalArea: 0.50,
    pressureCentreX: 700, referenceSpeedKmh: 160, maxSpeedKmh: 220,
    enginePower_kW: 100, drivetrainEta: 0.88,
    topGearRatioOverall: 4.40, maxRPM: 7750,   // GS1250 class: ~220 km/h ceiling
  },
};

// ── Cruiser ──────────────────────────────────────────────────────────────────
// Reference: Harley-Davidson Sportster S / Indian Scout class
// Sprung load: front 964 N / rear 802 N
const cruiser: ComputeAllInput = {
  geometry: {
    headAngle: 30, forkOffset: 55, forkLength: 740,
    frontWheelDia: 670, rearWheelDia: 660,
    wheelbase: 1620, swingarmLength: 655,
    swingarmPivotHeight: 380, swingarmPivotX: 970,
    rearAxleHeight: 330, frontAxleHeight: 335,
    steeringOffset: 0, seatHeight: 720, groundClearance: 125,
  },
  massComponents: [
    { mass: 70, x: 620, y: 350, label: 'Engine' },
    { mass: 15, x: 820, y: 480, label: 'Frame' },
    { mass: 5,  x: 520, y: 220, label: 'Battery' },
    { mass: 12, x: 960, y: 260, label: 'Exhaust' },
    { mass: 8,  x: 950, y: 280, label: 'Swingarm+Wheel' },
    { mass: 8,  x: 335, y: 335, label: 'Front Wheel' },
    { mass: 14, x: 700, y: 350, label: 'Fuel (full)' },
    { mass: 85, x: 820, y: 895, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 24.0, springRateRear: 39.0,
    motionRatioFront: 0.96, motionRatioRear: 0.72,
    unsprungFront: 15, unsprungRear: 22,
    unsprungComponentsFront: { wheelRim: 5.0, tyre: 5.0, brakeDisc: 1.2, brakeCaliper: 1.2, lowerForkLegs: 2.6 },
    unsprungComponentsRear:  { wheelRim: 6.0, tyre: 6.0, brakeDisc: 1.0, brakeCaliper: 0.8, swingarmHalf: 5.5, chainPartial: 2.7 },
    sagFront: 38, sagRear: 32, preloadFront: 6, preloadRear: 8,
    compDamping: 8, rebDamping: 10, forkTravel: 140, shockTravel: 65,
    dampingCoeffFront: 9, dampingCoeffRear: 14,
  },
  chain: {
    frontSprocket: 16, rearSprocket: 38,
    sprocketCenterX: -350, sprocketCenterY: -90,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 560, handlebarY: 1020,
    seatX: 840, seatY: 720,
    footpegX: 1020, footpegY: 280,
    riserHeight_mm: 50, handlebarReach_mm: -130,
  },
  dynamics: {
    brakingDecel: 0.6, accelG: 0.3,
    cornerSpeed: 10, cornerRadius: 40, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 65,     // N/mm — 39mm conventional tubes (more compliant)
    forkTorsionalStiffness: 320,
    steeringHeadStiffness: 600,
  },
  aero: {
    Cx: 0.68, Cz: 0.10, frontalArea: 0.55,
    pressureCentreX: 750, referenceSpeedKmh: 130, maxSpeedKmh: 180,
    enginePower_kW: 55, drivetrainEta: 0.88,
    topGearRatioOverall: 4.04, maxRPM: 6000,   // HD Softail class: ~185 km/h ceiling
  },
};

// ── Touring / Luxury ─────────────────────────────────────────────────────────
// Reference: BMW K1600 / Yamaha FJR1300 class (with luggage)
// Sprung load: front 1109 N / rear 931 N
const touring: ComputeAllInput = {
  geometry: {
    headAngle: 30, forkOffset: 35, forkLength: 760,
    frontWheelDia: 620, rearWheelDia: 640,
    wheelbase: 1685, swingarmLength: 692,
    swingarmPivotHeight: 400, swingarmPivotX: 1000,
    rearAxleHeight: 340, frontAxleHeight: 310,
    steeringOffset: 0, seatHeight: 815, groundClearance: 140,
  },
  massComponents: [
    { mass: 75, x: 650, y: 360, label: 'Engine' },
    { mass: 18, x: 840, y: 500, label: 'Frame' },
    { mass: 5,  x: 450, y: 230, label: 'Battery' },
    { mass: 10, x: 900, y: 270, label: 'Exhaust' },
    { mass: 8,  x: 950, y: 290, label: 'Swingarm+Wheel' },
    { mass: 8,  x: 310, y: 310, label: 'Front Wheel' },
    { mass: 16, x: 720, y: 370, label: 'Fuel (full)' },
    { mass: 80, x: 840, y: 1030, label: 'Rider' },
    { mass: 25, x: 980, y: 500, label: 'Luggage' },
  ],
  suspension: {
    springRateFront: 27.5, springRateRear: 51.0,
    motionRatioFront: 0.97, motionRatioRear: 0.66,
    unsprungFront: 15, unsprungRear: 22,
    unsprungComponentsFront: { wheelRim: 4.5, tyre: 4.5, brakeDisc: 1.5, brakeCaliper: 1.5, lowerForkLegs: 3.0 },
    unsprungComponentsRear:  { wheelRim: 5.5, tyre: 5.5, brakeDisc: 1.5, brakeCaliper: 1.0, swingarmHalf: 5.5, chainPartial: 3.0 },
    sagFront: 35, sagRear: 32, preloadFront: 8, preloadRear: 10,
    compDamping: 12, rebDamping: 14, forkTravel: 130, shockTravel: 60,
    dampingCoeffFront: 12, dampingCoeffRear: 17,
  },
  chain: {
    frontSprocket: 16, rearSprocket: 46,
    sprocketCenterX: -350, sprocketCenterY: -100,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 520, handlebarY: 1080,
    seatX: 870, seatY: 815,
    footpegX: 960, footpegY: 350,
    riserHeight_mm: 45, handlebarReach_mm: -90,
  },
  dynamics: {
    brakingDecel: 0.7, accelG: 0.3,
    cornerSpeed: 10, cornerRadius: 45, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 150,    // N/mm — 43mm USD (BMW/Yamaha touring spec)
    forkTorsionalStiffness: 450,
    steeringHeadStiffness: 900,
  },
  aero: {
    Cx: 0.38, Cz: 0.02, frontalArea: 0.55,
    pressureCentreX: 800, referenceSpeedKmh: 180, maxSpeedKmh: 240,
    enginePower_kW: 118, drivetrainEta: 0.88,
    topGearRatioOverall: 4.21, maxRPM: 8000,   // FJR1300/K1600 class: ~230 km/h ceiling
  },
};

// ── Supermoto ────────────────────────────────────────────────────────────────
// Reference: KTM 690 SMC / Husqvarna 701 Supermoto class
// Sprung load: front 631 N / rear 498 N
const supermoto: ComputeAllInput = {
  geometry: {
    headAngle: 25, forkOffset: 25, forkLength: 760,
    frontWheelDia: 600, rearWheelDia: 612,
    wheelbase: 1420, swingarmLength: 590,
    swingarmPivotHeight: 370, swingarmPivotX: 840,
    rearAxleHeight: 306, frontAxleHeight: 300,
    steeringOffset: 0, seatHeight: 880, groundClearance: 260,
  },
  massComponents: [
    { mass: 35, x: 550, y: 330, label: 'Engine' },
    { mass: 9,  x: 700, y: 460, label: 'Frame' },
    { mass: 3,  x: 370, y: 200, label: 'Battery' },
    { mass: 5,  x: 440, y: 230, label: 'Exhaust' },
    { mass: 5,  x: 750, y: 260, label: 'Swingarm+Wheel' },
    { mass: 6,  x: 300, y: 300, label: 'Front Wheel' },
    { mass: 8,  x: 660, y: 320, label: 'Fuel (full)' },
    { mass: 75, x: 690, y: 1130, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 14.5, springRateRear: 36.0,
    motionRatioFront: 0.96, motionRatioRear: 0.63,
    unsprungFront: 13, unsprungRear: 18,
    unsprungComponentsFront: { wheelRim: 4.0, tyre: 3.5, brakeDisc: 1.5, brakeCaliper: 1.5, lowerForkLegs: 2.5 },
    unsprungComponentsRear:  { wheelRim: 4.5, tyre: 4.0, brakeDisc: 1.0, brakeCaliper: 0.8, swingarmHalf: 5.5, chainPartial: 2.2 },
    sagFront: 42, sagRear: 30, preloadFront: 5, preloadRear: 5,
    compDamping: 10, rebDamping: 12, forkTravel: 270, shockTravel: 90,
    dampingCoeffFront: 7, dampingCoeffRear: 10,
  },
  chain: {
    frontSprocket: 13, rearSprocket: 50,
    sprocketCenterX: -290, sprocketCenterY: -100,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 360, handlebarY: 1080,
    seatX: 740, seatY: 880,
    footpegX: 820, footpegY: 340,
    riserHeight_mm: 80, handlebarReach_mm: 0,
  },
  dynamics: {
    brakingDecel: 0.9, accelG: 0.55,
    cornerSpeed: 14, cornerRadius: 30, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 160,    // N/mm — 48mm USD motocross-derived
    forkTorsionalStiffness: 600,
    steeringHeadStiffness: 1000,
  },
  aero: {
    Cx: 0.70, Cz: 0.05, frontalArea: 0.40,
    pressureCentreX: 660, referenceSpeedKmh: 160, maxSpeedKmh: 210,
    enginePower_kW: 55, drivetrainEta: 0.88,
    topGearRatioOverall: 5.33, maxRPM: 9000,   // KTM 690 SMC-R class: ~195 km/h ceiling
  },
};

// ── Enduro / Off-Road ────────────────────────────────────────────────────────
// Reference: KTM EXC / Husqvarna TE 300 class (road-legal enduro)
// Sprung load: front 576 N / rear 473 N
const enduro: ComputeAllInput = {
  geometry: {
    headAngle: 26, forkOffset: 38, forkLength: 900,
    frontWheelDia: 700, rearWheelDia: 680,
    wheelbase: 1480, swingarmLength: 620,
    swingarmPivotHeight: 440, swingarmPivotX: 870,
    rearAxleHeight: 380, frontAxleHeight: 350,
    steeringOffset: 0, seatHeight: 940, groundClearance: 320,
  },
  massComponents: [
    { mass: 30, x: 580, y: 360, label: 'Engine' },
    { mass: 8,  x: 730, y: 490, label: 'Frame' },
    { mass: 2,  x: 390, y: 210, label: 'Battery' },
    { mass: 4,  x: 480, y: 250, label: 'Exhaust' },
    { mass: 6,  x: 800, y: 290, label: 'Swingarm+Wheel' },
    { mass: 7,  x: 350, y: 350, label: 'Front Wheel' },
    { mass: 10, x: 680, y: 360, label: 'Fuel (full)' },
    { mass: 75, x: 730, y: 1240, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 6.0, springRateRear: 29.0,
    motionRatioFront: 0.95, motionRatioRear: 0.60,
    unsprungFront: 15, unsprungRear: 20,
    unsprungComponentsFront: { wheelRim: 5.5, tyre: 5.0, brakeDisc: 1.5, brakeCaliper: 1.0, lowerForkLegs: 2.0 },
    unsprungComponentsRear:  { wheelRim: 5.5, tyre: 5.0, brakeDisc: 0.8, brakeCaliper: 0.7, swingarmHalf: 5.5, chainPartial: 2.5 },
    sagFront: 105, sagRear: 42, preloadFront: 2, preloadRear: 4,
    compDamping: 8, rebDamping: 10, forkTravel: 300, shockTravel: 120,
    dampingCoeffFront: 6, dampingCoeffRear: 9,
  },
  chain: {
    frontSprocket: 14, rearSprocket: 52,
    sprocketCenterX: -290, sprocketCenterY: -140,
    chainForceAngle: 0,
  },
  ergo: {
    handlebarX: 420, handlebarY: 1180,
    seatX: 770, seatY: 940,
    footpegX: 850, footpegY: 390,
    riserHeight_mm: 90, handlebarReach_mm: 0,
  },
  dynamics: {
    brakingDecel: 0.6, accelG: 0.4,
    cornerSpeed: 8, cornerRadius: 25, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 80,     // N/mm — 48mm USD, intentional flex for off-road feel
    forkTorsionalStiffness: 380,
    steeringHeadStiffness: 700,
  },
  aero: {
    Cx: 0.80, Cz: 0.08, frontalArea: 0.45,
    pressureCentreX: 700, referenceSpeedKmh: 120, maxSpeedKmh: 160,
    enginePower_kW: 38, drivetrainEta: 0.88,
    topGearRatioOverall: 7.02, maxRPM: 8500,   // KTM EXC class: ~155 km/h ceiling
  },
};

// ── Scooter / Urban ──────────────────────────────────────────────────────────
// Reference: Yamaha TMAX / Honda Forza 750 class (maxi-scooter)
// Sprung load: front 477 N / rear 495 N
const scooter: ComputeAllInput = {
  geometry: {
    headAngle: 26, forkOffset: 44, forkLength: 560,
    frontWheelDia: 520, rearWheelDia: 520,
    wheelbase: 1280, swingarmLength: 520,
    swingarmPivotHeight: 330, swingarmPivotX: 760,
    rearAxleHeight: 280, frontAxleHeight: 260,
    steeringOffset: 0, seatHeight: 760, groundClearance: 120,
  },
  massComponents: [
    { mass: 20, x: 700, y: 280, label: 'Engine+CVT' },
    { mass: 10, x: 640, y: 400, label: 'Frame' },
    { mass: 4,  x: 450, y: 200, label: 'Battery' },
    { mass: 4,  x: 800, y: 220, label: 'Exhaust' },
    { mass: 5,  x: 820, y: 240, label: 'Swingarm+Wheel' },
    { mass: 5,  x: 260, y: 260, label: 'Front Wheel' },
    { mass: 7,  x: 640, y: 300, label: 'Fuel (full)' },
    { mass: 70, x: 660, y: 960, label: 'Rider' },
  ],
  suspension: {
    springRateFront: 16.0, springRateRear: 28.5,
    motionRatioFront: 0.96, motionRatioRear: 0.75,
    unsprungFront: 10, unsprungRear: 16,
    unsprungComponentsFront: { wheelRim: 3.0, tyre: 3.0, brakeDisc: 1.0, brakeCaliper: 1.0, lowerForkLegs: 2.0 },
    unsprungComponentsRear:  { wheelRim: 3.5, tyre: 3.5, brakeDisc: 0.8, brakeCaliper: 0.7, swingarmHalf: 5.5, chainPartial: 2.0 },
    sagFront: 28, sagRear: 25, preloadFront: 5, preloadRear: 6,
    compDamping: 8, rebDamping: 10, forkTravel: 90, shockTravel: 70,
    dampingCoeffFront: 10, dampingCoeffRear: 15,
  },
  chain: {
    frontSprocket: 14, rearSprocket: 45,
    sprocketCenterX: -60, sprocketCenterY: -110,
    chainForceAngle: 0,
    isCVT: true,
  },
  ergo: {
    handlebarX: 480, handlebarY: 970,
    seatX: 680, seatY: 760,
    footpegX: 800, footpegY: 250,
    riserHeight_mm: 30, handlebarReach_mm: 50,
  },
  dynamics: {
    brakingDecel: 0.55, accelG: 0.2,
    cornerSpeed: 8, cornerRadius: 25, trackWidth: 100,
  },
  forkCompliance: {
    forkBendingStiffness: 35,     // N/mm — 31mm conventional telescopic tubes
    forkTorsionalStiffness: 200,
    steeringHeadStiffness: 450,
  },
  aero: {
    Cx: 0.65, Cz: 0.08, frontalArea: 0.40,
    pressureCentreX: 680, referenceSpeedKmh: 100, maxSpeedKmh: 150,
    enginePower_kW: 35, drivetrainEta: 0.85,  // CVT: slightly lower efficiency
    topGearRatioOverall: 5.61, maxRPM: 8000,   // TMAX class CVT equivalent: ~140 km/h ceiling
  },
};

export const FAMILIES: FamilyPreset[] = [
  { name: 'Sport / Supersport', description: '24° rake · 43mm USD · faired · R1 class',     input: sport },
  { name: 'Naked / Roadster',   description: '25° rake · 41mm USD · upright · MT-09 class', input: naked },
  { name: 'Adventure / ADV',    description: '27° rake · 48mm USD · long travel · GS class', input: adv },
  { name: 'Cruiser',            description: '30° rake · conv forks · relaxed · Sporster class', input: cruiser },
  { name: 'Touring / Luxury',   description: '30° rake · 43mm USD · luggage · K1600 class',  input: touring },
  { name: 'Supermoto',          description: '25° rake · 48mm USD · 270mm travel · KTM SM', input: supermoto },
  { name: 'Enduro / Off-Road',  description: '26° rake · 48mm USD · 300mm travel · EXC class', input: enduro },
  { name: 'Scooter / Urban',    description: '26° rake · 31mm conv · CVT · TMAX class',      input: scooter },
];
