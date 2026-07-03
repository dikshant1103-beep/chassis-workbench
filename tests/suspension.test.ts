/**
 * suspension.test.ts — Unit tests for engine/suspension.ts
 *
 * REFERENCE TEST CASES (Section 18.1):
 *   Wheel Rate   : k=10 N/mm, MR=0.95 → 9.025 N/mm  (Exact)
 *   Natural Freq : WR=9.025, m=125kg  → ~1.352 Hz    (±0.05 Hz)
 *
 * TOLERANCE: ±0.5% per spec Section 18 unless stated "Exact".
 */

import {
  computeWheelRate,
  computeSprungMasses,
  computeNaturalFrequency,
  computeSagForce,
  computeSagPercent,
  computeCriticalDamping,
  computeDampingRatio,
  computeLoadTransfer08g,
  computeSuspension,
} from '../engine/suspension';
import { G } from '../engine/cog';
import { SuspensionParams } from '../engine/types';

describe('computeWheelRate', () => {
  test('SPEC TEST CASE: k=10 N/mm, MR=0.95 → 9.025 N/mm (Exact)', () => {
    // 10 × 0.95² = 10 × 0.9025 = 9.025
    expect(computeWheelRate(10, 0.95)).toBe(9.025);
  });

  test('MR=1.0 (telescopic fork): wheel rate = spring rate', () => {
    expect(computeWheelRate(10, 1.0)).toBe(10);
  });

  test('MR=0.7 (linkage rear): wheel rate = 10×0.49 = 4.9', () => {
    // Use toBeCloseTo — 0.7² = 0.49 has floating-point representation error
    expect(computeWheelRate(10, 0.7)).toBeCloseTo(4.9, 10);
  });

  test('WR is proportional to k for fixed MR', () => {
    const MR = 0.8;
    expect(computeWheelRate(20, MR)).toBe(2 * computeWheelRate(10, MR));
  });

  test('WR is proportional to MR² for fixed k', () => {
    // Double MR quadruples WR: (2×MR)² = 4×MR²
    expect(computeWheelRate(10, 0.8)).toBeCloseTo(10 * 0.64, 10);
    expect(computeWheelRate(10, 1.6)).toBeCloseTo(10 * 2.56, 10);
  });
});

describe('computeNaturalFrequency', () => {
  test('SPEC TEST CASE: WR=9.025 N/mm, m=125kg → ~1.352 Hz', () => {
    // f = (1/2π) × √(9.025 × 1000 / 125) = (1/2π) × √72.2
    // = (1/6.2832) × 8.4971 = 1.3520 Hz
    const freq = computeNaturalFrequency(9.025, 125);
    expect(freq).toBeCloseTo(1.352, 2);
    // Also check it's within spec tolerance ±0.05 Hz of 1.35 Hz
    expect(Math.abs(freq - 1.35)).toBeLessThan(0.05);
  });

  test('Higher spring rate → higher natural frequency', () => {
    const f1 = computeNaturalFrequency(9, 100);
    const f2 = computeNaturalFrequency(18, 100);
    // Doubling spring rate multiplies freq by √2
    expect(f2 / f1).toBeCloseTo(Math.sqrt(2), 4);
  });

  test('Higher sprung mass → lower natural frequency', () => {
    const f1 = computeNaturalFrequency(10, 100);
    const f2 = computeNaturalFrequency(10, 400);
    // Quadrupling mass halves frequency
    expect(f2 / f1).toBeCloseTo(0.5, 4);
  });

  test('Throws RangeError for zero sprung mass', () => {
    expect(() => computeNaturalFrequency(10, 0)).toThrow(RangeError);
  });

  test('Front fork target range: 0.8–1.6 Hz', () => {
    // k=9 N/mm, MR=0.95, WR=8.1225 N/mm, m_sprung_front≈90kg (typical)
    // f = (1/2π)×√(8122.5/90) = (1/2π)×√90.25 = (1/2π)×9.5 = 1.512 Hz
    const WR_f = computeWheelRate(9, 0.95); // 8.1225 N/mm
    const freq = computeNaturalFrequency(WR_f, 90);
    expect(freq).toBeGreaterThan(0.8);
    expect(freq).toBeLessThan(1.6);  // stiffer fork → slightly above 1.5 Hz is acceptable
  });
});

describe('computeSprungMasses', () => {
  test('Sprung mass = total − unsprung front − unsprung rear', () => {
    const { sprungMass } = computeSprungMasses(200, 15, 18, 700, 1400);
    expect(sprungMass).toBe(200 - 15 - 18); // = 167kg
  });

  test('Front + rear sprung mass = total sprung mass', () => {
    const { sprungMass, sprungMassFront, sprungMassRear } =
      computeSprungMasses(200, 15, 18, 700, 1400);
    expect(sprungMassFront + sprungMassRear).toBeCloseTo(sprungMass, 8);
  });

  test('Sprung mass split matches CoG position ratio', () => {
    // X_cg=700mm, WB=1400mm → front share = (1400−700)/1400 = 0.5
    const { sprungMassFront, sprungMassRear, sprungMass } =
      computeSprungMasses(200, 10, 15, 700, 1400);
    expect(sprungMassFront / sprungMass).toBeCloseTo(0.5, 6);
    expect(sprungMassRear / sprungMass).toBeCloseTo(0.5, 6);
  });

  test('Throws RangeError for zero wheelbase', () => {
    expect(() => computeSprungMasses(200, 10, 15, 700, 0)).toThrow(RangeError);
  });
});

describe('computeSagForce', () => {
  test('F_sag = k × (sag + preload)', () => {
    // k=10 N/mm, sag=35mm, preload=5mm → F = 10 × 40 = 400 N
    expect(computeSagForce(10, 35, 5)).toBe(400);
  });

  test('Zero preload: F_sag = k × sag', () => {
    expect(computeSagForce(12, 30, 0)).toBe(360);
  });

  test('Zero sag: F_sag = k × preload', () => {
    expect(computeSagForce(10, 0, 15)).toBe(150);
  });
});

describe('computeSagPercent', () => {
  test('sag=35mm, T_fork=120mm → 29.17%', () => {
    expect(computeSagPercent(35, 120)).toBeCloseTo(29.167, 2);
  });

  test('Target range 25–33% for street', () => {
    // sag=30mm, travel=120mm → 25%
    expect(computeSagPercent(30, 120)).toBeCloseTo(25, 6);
    // sag=40mm, travel=120mm → 33.33%
    expect(computeSagPercent(40, 120)).toBeCloseTo(33.333, 2);
  });

  test('Throws RangeError for zero travel', () => {
    expect(() => computeSagPercent(30, 0)).toThrow(RangeError);
  });
});

describe('computeCriticalDamping', () => {
  test('Units check: result is N·s/m (not N·s/mm)', () => {
    // WR=9.025 N/mm → WR×1000 = 9025 N/m, m=125kg
    // C = 2×√(9025×125) = 2×√1128125 = 2×1062.14 = 2124.28 N·s/m
    const C = computeCriticalDamping(9.025, 125);
    expect(C).toBeCloseTo(2 * Math.sqrt(9.025 * 1000 * 125), 4);
    expect(C).toBeGreaterThan(2000); // realistic motorcycle damping range
  });

  test('Doubling sprung mass increases C by √2', () => {
    const C1 = computeCriticalDamping(10, 100);
    const C2 = computeCriticalDamping(10, 200);
    expect(C2 / C1).toBeCloseTo(Math.sqrt(2), 4);
  });
});

describe('computeDampingRatio', () => {
  test('Max clicks (30) → ratio = 1.0', () => {
    expect(computeDampingRatio(30)).toBe(1.0);
  });

  test('Zero clicks → ratio = 0', () => {
    expect(computeDampingRatio(0)).toBe(0);
  });

  test('15 clicks (half) → ratio = 0.5', () => {
    expect(computeDampingRatio(15)).toBe(0.5);
  });
});

describe('computeLoadTransfer08g', () => {
  test('Manual: m=200kg, Y_cg=500mm, WB=1400mm at 0.8g', () => {
    // ΔW = 200 × (0.8×9.81) × 500 / 1400
    // = 200 × 7.848 × 500 / 1400
    // = 200 × 7.848 × 0.35714
    // = 200 × 2.8028 = 560.57 N
    const a = 0.8 * G;
    const expected = 200 * a * 500 / 1400;
    expect(computeLoadTransfer08g(200, 500, 1400)).toBeCloseTo(expected, 4);
  });

  test('Higher CoG → more load transfer', () => {
    const lt1 = computeLoadTransfer08g(200, 400, 1400);
    const lt2 = computeLoadTransfer08g(200, 600, 1400);
    expect(lt2).toBeGreaterThan(lt1);
  });

  test('Longer wheelbase → less load transfer', () => {
    const lt1 = computeLoadTransfer08g(200, 500, 1200);
    const lt2 = computeLoadTransfer08g(200, 500, 1600);
    expect(lt2).toBeLessThan(lt1);
  });

  test('Throws RangeError for zero wheelbase', () => {
    expect(() => computeLoadTransfer08g(200, 500, 0)).toThrow(RangeError);
  });
});

describe('computeSuspension (aggregate)', () => {
  const params: SuspensionParams = {
    springRateFront: 9.5,    // N/mm
    springRateRear: 85,      // N/mm
    motionRatioFront: 0.97,  // near 1.0 for tele fork
    motionRatioRear: 0.65,   // typical Pro-Link linkage
    unsprungFront: 14,       // kg
    unsprungRear: 20,        // kg
    sagFront: 32,            // mm
    sagRear: 28,             // mm
    preloadFront: 5,         // mm
    preloadRear: 10,         // mm
    compDamping: 12,         // clicks
    rebDamping: 15,          // clicks
    forkTravel: 120,         // mm
    shockTravel: 60,         // mm
  };

  const totalMass = 200;  // kg
  const X_cg = 680;       // mm
  const Y_cg = 480;       // mm
  const WB = 1400;        // mm

  test('Wheel rate front = 9.5 × 0.97² = 8.9359 N/mm', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.wheelRateFront).toBeCloseTo(9.5 * 0.97 * 0.97, 8);
  });

  test('Wheel rate rear = 85 × 0.65² = 35.9125 N/mm', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.wheelRateRear).toBeCloseTo(85 * 0.65 * 0.65, 8);
  });

  test('Sprung mass = 200 − 14 − 20 = 166 kg', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.sprungMass).toBe(166);
  });

  test('Front + rear sprung mass = total sprung mass', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.sprungMassFront + r.sprungMassRear).toBeCloseTo(r.sprungMass, 6);
  });

  test('Sag% front = 32/120 × 100 = 26.67%', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.sagPercentFront).toBeCloseTo(26.667, 2);
  });

  test('Damping ratio = 12/30 = 0.4', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.dampingRatioComp).toBe(0.4);
  });

  test('Natural frequencies in realistic motorcycle range', () => {
    const r = computeSuspension(params, totalMass, X_cg, Y_cg, WB);
    expect(r.natFreqFront).toBeGreaterThan(0.5);
    expect(r.natFreqFront).toBeLessThan(2.5);
    expect(r.natFreqRear).toBeGreaterThan(0.8);
    expect(r.natFreqRear).toBeLessThan(5.0);
  });
});
