/**
 * cog.test.ts — Unit tests for engine/cog.ts
 *
 * REFERENCE TEST CASES (Section 18.1):
 *   CoG (2-mass): 50kg@(0,500) + 50kg@(1000,500) → X=500, Y=500 (exact)
 *
 * TOLERANCE: ±0.5% (spec requirement), or exact where spec says "Exact".
 */

import {
  computeWeightedCentroid,
  computeCoGRelativeToPivot,
  computeStaticAxleLoads,
  computeCoG,
  G,
} from '../engine/cog';
import { MassComponent } from '../engine/types';

describe('computeWeightedCentroid', () => {
  test('SPEC TEST CASE: 2-mass symmetric → X=500, Y=500 (exact)', () => {
    const components: MassComponent[] = [
      { mass: 50, x: 0, y: 500, label: 'front mass' },
      { mass: 50, x: 1000, y: 500, label: 'rear mass' },
    ];
    const { X_cg, Y_cg } = computeWeightedCentroid(components);
    // Spec Section 18.1 tolerance: Exact
    expect(X_cg).toBe(500);
    expect(Y_cg).toBe(500);
  });

  test('Single component: CoG is at the component position', () => {
    const components: MassComponent[] = [
      { mass: 100, x: 700, y: 450, label: 'single' },
    ];
    const { X_cg, Y_cg } = computeWeightedCentroid(components);
    expect(X_cg).toBe(700);
    expect(Y_cg).toBe(450);
  });

  test('Unequal masses shift CoG toward heavier component', () => {
    // 100kg at x=400, 50kg at x=1000 → CoG at (100×400 + 50×1000)/150 = 90000/150 = 600
    const components: MassComponent[] = [
      { mass: 100, x: 400, y: 600, label: 'engine' },
      { mass: 50, x: 1000, y: 300, label: 'battery' },
    ];
    const { X_cg } = computeWeightedCentroid(components);
    expect(X_cg).toBeCloseTo((100 * 400 + 50 * 1000) / 150, 8);
    // = (40000 + 50000) / 150 = 90000/150 = 600mm
    expect(X_cg).toBeCloseTo(600, 6);
  });

  test('Three components: manual weighted average', () => {
    // engine: 40kg@x=600; frame: 15kg@x=750; rider: 75kg@x=680
    // total = 130kg, X_cg = (40×600 + 15×750 + 75×680)/130
    //       = (24000 + 11250 + 51000)/130 = 86250/130 = 663.46mm
    const components: MassComponent[] = [
      { mass: 40, x: 600, y: 350, label: 'engine' },
      { mass: 15, x: 750, y: 550, label: 'frame' },
      { mass: 75, x: 680, y: 820, label: 'rider' },
    ];
    const { X_cg } = computeWeightedCentroid(components);
    expect(X_cg).toBeCloseTo(86250 / 130, 6);
  });

  test('Throws RangeError for empty component list', () => {
    expect(() => computeWeightedCentroid([])).toThrow(RangeError);
  });

  test('Throws RangeError when total mass is zero', () => {
    const components: MassComponent[] = [
      { mass: 0, x: 500, y: 400, label: 'ghost' },
    ];
    expect(() => computeWeightedCentroid(components)).toThrow(RangeError);
  });
});

describe('computeCoGRelativeToPivot', () => {
  test('Manual exact check: CoG at (600,450), pivot at (850,370)', () => {
    const { deltaX_sp, deltaY_sp } = computeCoGRelativeToPivot(600, 450, 850, 370);
    // Eq 6.3: 600−850 = −250mm (CoG is 250mm forward of pivot)
    // Eq 6.4: 450−370 = +80mm  (CoG is 80mm above pivot)
    expect(deltaX_sp).toBe(-250);
    expect(deltaY_sp).toBe(80);
  });

  test('CoG exactly at pivot gives zero deltas', () => {
    const { deltaX_sp, deltaY_sp } = computeCoGRelativeToPivot(800, 400, 800, 400);
    expect(deltaX_sp).toBe(0);
    expect(deltaY_sp).toBe(0);
  });
});

describe('computeStaticAxleLoads', () => {
  test('SPEC TEST CASE: symmetric loading → 50% / 50%', () => {
    // 100kg total, X_cg=500mm, WB=1000mm
    const { R_front, R_rear, frontPercent, rearPercent } =
      computeStaticAxleLoads(100, 500, 1000);
    // Eq 6.5: R_front = (100 × 9.81) × (1000−500)/1000 = 490.5 N
    expect(R_front).toBeCloseTo(490.5, 3);
    expect(R_rear).toBeCloseTo(490.5, 3);
    expect(frontPercent).toBeCloseTo(50, 6);
    expect(rearPercent).toBeCloseTo(50, 6);
  });

  test('CoG at front axle (X_cg=0) → 100% front, 0% rear', () => {
    const { frontPercent, rearPercent } = computeStaticAxleLoads(150, 0, 1400);
    expect(frontPercent).toBeCloseTo(100, 6);
    expect(rearPercent).toBeCloseTo(0, 6);
  });

  test('CoG at rear axle (X_cg=WB) → 0% front, 100% rear', () => {
    const { frontPercent, rearPercent } = computeStaticAxleLoads(150, 1400, 1400);
    expect(frontPercent).toBeCloseTo(0, 6);
    expect(rearPercent).toBeCloseTo(100, 6);
  });

  test('Front + rear percent always sums to 100', () => {
    const { frontPercent, rearPercent } = computeStaticAxleLoads(200, 700, 1380);
    expect(frontPercent + rearPercent).toBeCloseTo(100, 8);
  });

  test('R_front + R_rear = total weight', () => {
    const mass = 220;
    const { R_front, R_rear } = computeStaticAxleLoads(mass, 650, 1380);
    expect(R_front + R_rear).toBeCloseTo(mass * G, 4);
  });

  test('Typical sport bike: X_cg ≈ 680mm, WB=1400mm → ~51.4% front', () => {
    // (1400−680)/1400 × 100 = 720/1400 × 100 = 51.43%
    const { frontPercent } = computeStaticAxleLoads(180, 680, 1400);
    expect(frontPercent).toBeCloseTo(51.429, 2);
  });

  test('Throws RangeError when wheelbase is zero', () => {
    expect(() => computeStaticAxleLoads(200, 500, 0)).toThrow(RangeError);
  });
});

describe('computeCoG (aggregate)', () => {
  test('SPEC TEST CASE: 2-mass → exact CoG + correct axle loads', () => {
    const components: MassComponent[] = [
      { mass: 50, x: 0, y: 500, label: 'A' },
      { mass: 50, x: 1000, y: 500, label: 'B' },
    ];
    const result = computeCoG(components, 1000, 800, 400);
    expect(result.X_cg).toBe(500);
    expect(result.Y_cg).toBe(500);
    expect(result.totalMass).toBe(100);
    expect(result.totalWeight).toBeCloseTo(100 * G, 8);
    // 50/50 split
    expect(result.frontPercent).toBeCloseTo(50, 6);
  });

  test('Pivot relative coordinates are correct', () => {
    const components: MassComponent[] = [
      { mass: 100, x: 600, y: 450, label: 'vehicle' },
    ];
    // Single mass: CoG = (600, 450), pivot = (850, 380)
    const result = computeCoG(components, 1400, 850, 380);
    expect(result.deltaX_sp).toBeCloseTo(600 - 850, 6); // −250mm
    expect(result.deltaY_sp).toBeCloseTo(450 - 380, 6); //  +70mm
  });

  test('Realistic 4-component motorcycle: front bias expected', () => {
    // Typical naked bike with rider
    const components: MassComponent[] = [
      { mass: 35, x: 550, y: 340, label: 'engine' },
      { mass: 12, x: 700, y: 500, label: 'frame' },
      { mass: 3,  x: 400, y: 200, label: 'battery' },
      { mass: 75, x: 720, y: 820, label: 'rider' },
    ];
    const totalM = 35 + 12 + 3 + 75; // 125kg
    const result = computeCoG(components, 1400, 850, 390);
    expect(result.totalMass).toBe(totalM);
    // Verify via manual calculation
    const X_manual = (35*550 + 12*700 + 3*400 + 75*720) / totalM;
    expect(result.X_cg).toBeCloseTo(X_manual, 6);
  });
});
