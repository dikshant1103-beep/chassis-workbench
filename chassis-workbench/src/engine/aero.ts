/**
 * aero.ts — Aerodynamics Module (Cossalter Ch. 4 / Ch. 8)
 *
 * PHYSICS MODEL:
 *
 *   Drag force:      F_D = ½ · ρ · Cx · A · V²          [N]
 *   Lift force:      F_L = ½ · ρ · Cz · A · V²          [N]
 *   Drag power:      P_D = F_D · V                        [W]
 *   Top speed:       V_max where F_D = F_drive            [m/s]
 *   Aero pitch moment: M_aero = F_L · (x_cp - X_cg)      [N·m]
 *     Positive M_aero → nose-up (front unloads)
 *     Negative M_aero → nose-down (front loads, rear unloads)
 *
 *   Load transfer from aero pitch moment:
 *     ΔW_aero = M_aero / WB                              [N]
 *     +ΔW_aero on front → added front load (nose-down lift)
 *
 * COORDINATE SYSTEM:
 *   x_cp: pressure centre x from front axle (mm) — forward of CoG → nose down
 *   X_cg: CoG x from front axle (mm)
 *   WB:   wheelbase (mm)
 *
 * TYPICAL VALUES (sport bike at 200 km/h):
 *   Cx ≈ 0.35 (faired), ρ ≈ 1.225 kg/m³, A ≈ 0.35 m²
 *   F_D ≈ 230 N, F_L ≈ −30 N (slight downforce with racing fairing)
 *
 * REFERENCES:
 *   Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 4, 8.
 *   Foale, T. (2006). Motorcycle Handling and Chassis Design, Ch. 13.
 */

import { AeroParams, AeroResults } from './types';

const RHO_SEA_LEVEL = 1.225; // kg/m³ — standard air density at sea level, 15°C

// ─── Speed sweep ─────────────────────────────────────────────────────────────

/**
 * Compute aerodynamic forces at a single speed.
 *
 * @param V      speed (m/s)
 * @param Cx     drag coefficient (dimensionless)
 * @param Cz     lift coefficient (positive = lift, negative = downforce)
 * @param A      frontal area (m²)
 * @param rho    air density (kg/m³) — defaults to sea-level standard
 */
export function computeDragAtSpeed(
  V: number, Cx: number, Cz: number, A: number, rho = RHO_SEA_LEVEL,
): { drag: number; lift: number; power: number } {
  const q   = 0.5 * rho * V * V;   // dynamic pressure [Pa]
  const drag  = q * Cx * A;         // [N]
  const lift  = q * Cz * A;         // [N] — positive = upward
  const power = drag * V;           // [W]
  return { drag, lift, power };
}

/**
 * Estimate top speed from engine drive force and aerodynamic drag.
 *
 * At top speed: F_drive = F_drag
 *   F_drive = P_engine × η_drive / V_max
 *   ½ρCxA·V_max² = P_engine·η / V_max
 *   V_max³ = 2·P_engine·η / (ρ·Cx·A)
 *   V_max  = cbrt(2·P_engine·η / (ρ·Cx·A))
 *
 * @param enginePower_kW   peak engine power (kW)
 * @param drivetrainEta    drivetrain efficiency (0–1, typically 0.85–0.92)
 * @param Cx               drag coefficient
 * @param A                frontal area (m²)
 * @param rho              air density (kg/m³)
 */
export function computeTopSpeed(
  enginePower_kW: number,
  drivetrainEta: number,
  Cx: number,
  A: number,
  rho = RHO_SEA_LEVEL,
): number {
  const P = enginePower_kW * 1000;  // W
  return Math.cbrt((2 * P * drivetrainEta) / (rho * Cx * A)); // m/s
}

/**
 * Aerodynamic pitch moment and resulting load transfer.
 *
 *   M_aero = F_L × (x_cp − X_cg) / 1000   [N·m]  (mm → m)
 *   ΔW_aero_front = M_aero / (WB / 1000)   [N]
 *
 * Sign convention:
 *   x_cp > X_cg → pressure centre is rearward of CoG
 *     → positive lift creates nose-up moment → front unloads
 *   x_cp < X_cg → pressure centre is forward of CoG
 *     → positive lift creates nose-down moment → front loads
 *
 * @param F_lift      lift force (N)
 * @param x_cp        pressure centre x from front axle (mm)
 * @param X_cg        CoG x from front axle (mm)
 * @param wheelbase   WB (mm)
 */
export function computeAeroPitchMoment(
  F_lift: number, x_cp: number, X_cg: number, wheelbase: number,
): { moment_Nm: number; deltaW_front_N: number } {
  const arm   = (x_cp - X_cg) / 1000;  // mm → m
  const M     = F_lift * arm;            // N·m
  const dW    = M / (wheelbase / 1000); // N (positive = added to front)
  return { moment_Nm: M, deltaW_front_N: dW };
}

// ─── Main computation ─────────────────────────────────────────────────────────

/**
 * Full aerodynamics analysis: sweep over speed range + pitch moment at vmax.
 */
export function computeAero(
  p: AeroParams,
  X_cg: number,
  wheelbase: number,
): AeroResults {
  const rho = p.airDensity ?? RHO_SEA_LEVEL;

  // ── Speed sweep ─────────────────────────────────────────────────────────
  const speedPoints: AeroResults['speedSweep'] = [];
  const V_max_kmh = Math.max(p.maxSpeedKmh, 50);

  for (let v_kmh = 0; v_kmh <= V_max_kmh + 1e-6; v_kmh += 10) {
    const V = v_kmh / 3.6;   // km/h → m/s
    const { drag, lift, power } = computeDragAtSpeed(V, p.Cx, p.Cz, p.frontalArea, rho);
    const { deltaW_front_N } = computeAeroPitchMoment(lift, p.pressureCentreX, X_cg, wheelbase);
    speedPoints.push({
      speedKmh: +v_kmh.toFixed(1),
      dragN:    +drag.toFixed(2),
      liftN:    +lift.toFixed(2),
      powerW:   +power.toFixed(1),
      deltaWFrontN: +deltaW_front_N.toFixed(2),
    });
  }

  // ── At cruise / reference speed ──────────────────────────────────────────
  const V_ref = p.referenceSpeedKmh / 3.6;
  const { drag: dragRef, lift: liftRef, power: powerRef } =
    computeDragAtSpeed(V_ref, p.Cx, p.Cz, p.frontalArea, rho);

  const { moment_Nm, deltaW_front_N: deltaWFrontRef } =
    computeAeroPitchMoment(liftRef, p.pressureCentreX, X_cg, wheelbase);

  // ── Top speed ────────────────────────────────────────────────────────────
  const V_top_power_ms = computeTopSpeed(p.enginePower_kW, p.drivetrainEta, p.Cx, p.frontalArea, rho);

  // Gear-limited ceiling: V = 2π × R_wheel × (maxRPM/60) / topGearRatioOverall
  // rearWheelDia not in AeroParams — backend provides the real value; TS uses power-limited as fallback
  const V_top_gear_ms = (p.topGearRatioOverall && p.topGearRatioOverall > 0 && p.maxRPM && p.maxRPM > 0)
    ? 0  // backend will compute correctly with actual wheel radius; TS sets 0 = "not available"
    : 0;

  const V_top_ms = V_top_power_ms;  // backend overrides with min(power, gear) once online

  // ── Drag at 100 km/h (standard reference) ────────────────────────────────
  const { drag: drag100 } = computeDragAtSpeed(100 / 3.6, p.Cx, p.Cz, p.frontalArea, rho);

  return {
    dragAtRef:          +dragRef.toFixed(1),
    liftAtRef:          +liftRef.toFixed(1),
    powerAtRef_W:       +powerRef.toFixed(0),
    pitchMoment_Nm:     +moment_Nm.toFixed(1),
    deltaWFrontAtRef_N: +deltaWFrontRef.toFixed(1),
    topSpeed_ms:        +V_top_ms.toFixed(2),
    topSpeed_kmh:       +(V_top_ms * 3.6).toFixed(1),
    topSpeedGear_kmh:   V_top_gear_ms > 0 ? +(V_top_gear_ms * 3.6).toFixed(1) : 0,
    topSpeedGear_ms:    +V_top_gear_ms.toFixed(2),
    drag100kmh_N:       +drag100.toFixed(1),
    dynamicPressureRef: +(0.5 * rho * V_ref * V_ref).toFixed(2),
    speedSweep:         speedPoints,
  };
}
