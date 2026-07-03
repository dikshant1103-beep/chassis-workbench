/**
 * dynamicsSweep.ts — Dynamics Sweep Engine (Phase 3)
 *
 * Computes weight transfer, axle loads, anti-dive %, fork compression,
 * and rear extension across a range of braking and acceleration events.
 *
 * FORMULAS
 *   ΔW = m · a · Y_cg / WB          (Foale Eq 6.12 — weight transfer)
 *   AD% = tan(α) · (F_brake_front / W) · 100  (Foale Eq 8.11 — anti-dive)
 *
 * All lengths in mm, forces in N, mass in kg, acceleration in multiples of g.
 */

import type { GeometryParams, SuspensionParams } from './types';

const G = 9.81; // m/s²

// ── Result types ───────────────────────────────────────────────────────────────

export interface BrakePoint {
  decel_g: number;
  decel_ms2: number;
  weightTransfer_N: number;
  R_front_N: number;
  R_rear_N: number;
  frontPct: number;
  rearPct: number;
  antiDivePct: number;
  forkCompression_mm: number;
  rearExtension_mm: number;
}

export interface AccelPoint {
  accel_g: number;
  accel_ms2: number;
  weightTransfer_N: number;
  R_front_N: number;
  R_rear_N: number;
  frontPct: number;
  rearPct: number;
  wheelieMarginPct: number;
}

export interface DynamicsSweepResult {
  braking: BrakePoint[];
  accel: AccelPoint[];
  totalWeight_N: number;
  X_cg_mm: number;
  Y_cg_mm: number;
  totalMass_kg: number;
  staticFrontPct: number;
  staticRearPct: number;
}

// ── Core formula functions ─────────────────────────────────────────────────────

/**
 * Longitudinal weight transfer.
 * ΔW = m · a · Y_cg / WB   (Foale Eq 6.12)
 * Returns magnitude (N). Caller applies sign.
 */
function weightTransfer(
  mass_kg: number,
  accel_g: number,
  Y_cg_mm: number,
  wheelbase_mm: number,
): number {
  return mass_kg * (accel_g * G) * (Y_cg_mm / 1000) / (wheelbase_mm / 1000);
}

/**
 * Anti-dive percentage.
 * AD% = tan(α) · (F_brake_front / W) · 100   (Foale Eq 8.11)
 */
function antiDivePct(
  headAngle_deg: number,
  brakeForceFront_N: number,
  totalWeight_N: number,
): number {
  if (totalWeight_N < 1e-9) return 0;
  return Math.tan((headAngle_deg * Math.PI) / 180) * (brakeForceFront_N / totalWeight_N) * 100;
}

// ── Main sweep function ────────────────────────────────────────────────────────

export interface DynamicsSweepOptions {
  brakeBiasFront?: number;   // fraction of braking on front (default 0.70)
  decelMaxG?: number;        // max deceleration sweep (default 1.20g)
  accelMaxG?: number;        // max acceleration sweep (default 1.00g)
  dG?: number;               // step size in g (default 0.05)
  motionRatioStatic?: number; // rear suspension MR at static (default 0.70)
}

export function computeDynamicsSweep(
  geom: GeometryParams,
  susp: SuspensionParams,
  X_cg_mm: number,
  Y_cg_mm: number,
  totalMass_kg: number,
  opts: DynamicsSweepOptions = {},
): DynamicsSweepResult {
  const {
    brakeBiasFront = 0.70,
    decelMaxG = 1.20,
    accelMaxG = 1.00,
    dG = 0.05,
    motionRatioStatic = 0.70,
  } = opts;

  const W = totalMass_kg * G;
  const WB = geom.wheelbase;

  const R_front_static = W * (WB - X_cg_mm) / WB;
  const R_rear_static  = W * X_cg_mm / WB;

  // Fork: acts directly → front wheel rate ≈ spring rate (MR_f ≈ 1 for tele forks)
  const k_front_Nmm = susp.springRateFront;
  // Rear wheel rate = k_rear · MR²
  const k_rear_wheel_Nmm = susp.springRateRear * motionRatioStatic ** 2;

  // ── Braking sweep ──────────────────────────────────────────────────────────
  const braking: BrakePoint[] = [];
  const nBrake = Math.round(decelMaxG / dG) + 1;

  for (let i = 0; i < nBrake; i++) {
    const a_g = i * dG;
    const dW = weightTransfer(totalMass_kg, a_g, Y_cg_mm, WB);

    let R_f = R_front_static + dW;
    let R_r = R_rear_static  - dW;
    R_r = Math.max(0, R_r);
    R_f = Math.min(W, R_f);

    const frontPct = W > 0 ? (R_f / W) * 100 : 0;
    const rearPct  = W > 0 ? (R_r / W) * 100 : 0;

    const F_brake_total = totalMass_kg * a_g * G;
    const F_brake_front = brakeBiasFront * F_brake_total;
    const AD = antiDivePct(geom.headAngle, F_brake_front, W);

    const delta_R_front = R_f - R_front_static;
    const forkComp_mm   = k_front_Nmm > 0 ? delta_R_front / k_front_Nmm : 0;

    const delta_R_rear  = R_rear_static - R_r;
    const rearExt_mm    = k_rear_wheel_Nmm > 0 ? delta_R_rear / k_rear_wheel_Nmm : 0;

    braking.push({
      decel_g: a_g,
      decel_ms2: a_g * G,
      weightTransfer_N: dW,
      R_front_N: R_f,
      R_rear_N: R_r,
      frontPct,
      rearPct,
      antiDivePct: AD,
      forkCompression_mm: forkComp_mm,
      rearExtension_mm: rearExt_mm,
    });
  }

  // ── Acceleration sweep ─────────────────────────────────────────────────────
  const accel: AccelPoint[] = [];
  const nAccel = Math.round(accelMaxG / dG) + 1;

  for (let i = 0; i < nAccel; i++) {
    const a_g = i * dG;
    const dW = weightTransfer(totalMass_kg, a_g, Y_cg_mm, WB);

    let R_f = R_front_static - dW;
    let R_r = R_rear_static  + dW;
    R_f = Math.max(0, R_f);
    R_r = Math.min(W, R_r);

    const frontPct = W > 0 ? (R_f / W) * 100 : 0;
    const rearPct  = W > 0 ? (R_r / W) * 100 : 0;
    const wheelieMarginPct = R_front_static > 0 ? (R_f / R_front_static) * 100 : 0;

    accel.push({
      accel_g: a_g,
      accel_ms2: a_g * G,
      weightTransfer_N: dW,
      R_front_N: R_f,
      R_rear_N: R_r,
      frontPct,
      rearPct,
      wheelieMarginPct,
    });
  }

  return {
    braking,
    accel,
    totalWeight_N: W,
    X_cg_mm,
    Y_cg_mm,
    totalMass_kg,
    staticFrontPct: W > 0 ? (R_front_static / W) * 100 : 0,
    staticRearPct:  W > 0 ? (R_rear_static  / W) * 100 : 0,
  };
}
