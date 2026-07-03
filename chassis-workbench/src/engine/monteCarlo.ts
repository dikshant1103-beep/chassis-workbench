/**
 * monteCarlo.ts — R4: Monte Carlo Tolerance Analysis
 *
 * Samples each input parameter uniformly within ±tolerance (manufacturing spread),
 * runs computeAll() N times, and computes per-KPI distributions.
 *
 * Tells engineers: "Given real-world build variation, what fraction of bikes
 * will hit their performance targets?" — Cpk thinking for chassis dynamics.
 */

import { ComputeAllInput, TargetConfig } from './types';
import { computeAll } from './computeAll';
import { SENS_PARAMS, SENS_KPIS } from './sensitivity';

// ── MCParam ──────────────────────────────────────────────────────────────────

export interface MCParam {
  id:         string;
  label:      string;
  unit:       string;
  group:      string;
  nominal:    number;
  tolerance:  number;   // absolute ±  (manufacturing spread, 1-sigma or max)
  enabled:    boolean;
  getValue:   (i: ComputeAllInput) => number;
  patchValue: (i: ComputeAllInput, v: number) => ComputeAllInput;
}

// Physics-informed default tolerances (1-sigma manufacturing spread)
const DEFAULT_TOL: Record<string, number> = {
  headAngle:    0.5,    // ±0.5° — frame-welding jig tolerance
  forkOffset:   2,      // ±2 mm — triple-clamp machining
  forkLength:   3,      // ±3 mm — fork tube cut length
  wheelbase:    5,      // ±5 mm — frame assembly stack-up
  swingarmLen:  3,      // ±3 mm — swingarm pivot to axle
  pivotHeight:  2,      // ±2 mm — pivot boss machining
  pivotX:       3,      // ±3 mm — pivot boss X location
  springRateF:  2,      // ±2 N/mm — spring winding tolerance
  springRateR:  2,      // ±2 N/mm
  motionRatioF: 0.02,   // ±0.02 — linkage arm length variation
  motionRatioR: 0.02,
  unsprungF:    0.3,    // ±0.3 kg — wheel/brake component variation
  unsprungR:    0.3,
  frontSprocket:1,      // ±1 tooth (discrete swap)
  rearSprocket: 2,      // ±2 teeth (discrete swap)
};

export function buildMCParams(input: ComputeAllInput): MCParam[] {
  return SENS_PARAMS.map(p => ({
    id:         p.id,
    label:      p.label,
    unit:       p.unit,
    group:      p.group,
    nominal:    p.getValue(input),
    tolerance:  DEFAULT_TOL[p.id] ?? Math.max(Math.abs(p.getValue(input)) * 0.02, 0.01),
    enabled:    true,
    getValue:   p.getValue,
    patchValue: p.patchValue,
  }));
}

// ── KPI target key map ───────────────────────────────────────────────────────

type TCKey = keyof TargetConfig;

const KPITC_KEY: Record<string, TCKey> = {
  trail:     'trail',
  frontPct:  'frontPercent',
  cogH:      'cogHeight',
  antiSquat: 'antiSquatPercent',
  natFreqF:  'natFreqFront',
  natFreqR:  'natFreqRear',
  sagF:      'sagPercentFront',
  sagR:      'sagPercentRear',
  wrF:       'wheelRateFront',
  wrR:       'wheelRateRear',
};

// ── Output types ─────────────────────────────────────────────────────────────

export interface KPIStats {
  id:        string;
  label:     string;
  unit:      string;
  values:    number[];   // all N samples (kept for histogram rendering)
  sorted:    number[];   // pre-sorted
  mean:      number;
  std:       number;
  p10:       number;
  p50:       number;
  p90:       number;
  passRate:  number;     // 0–1 (NaN if no target set)
  nominal:   number;     // baseline design value
  targetLo:  number | null;
  targetHi:  number | null;
}

export interface MCResult {
  n:               number;
  kpis:            KPIStats[];
  elapsed:         number;
  overallPassRate: number;   // fraction of samples ALL targeted KPIs pass simultaneously
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.min(Math.ceil(idx), sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Main runner ──────────────────────────────────────────────────────────────

/**
 * Run Monte Carlo simulation.
 * Yields progress every BATCH samples via onProgress (called from async loop).
 * stopRef.current = true halts early.
 */
export async function runMonteCarlo(
  base:       ComputeAllInput,
  params:     MCParam[],
  targets:    TargetConfig,
  n:          number,
  onProgress: (done: number, total: number) => void,
  stopRef:    { current: boolean },
): Promise<MCResult> {
  const t0 = performance.now();
  const BATCH = 25;
  const enabled = params.filter(p => p.enabled && p.tolerance > 0);

  // Accumulate raw values per KPI
  const kpiArrays: number[][] = SENS_KPIS.map(() => []);

  for (let i = 0; i < n; i++) {
    if (stopRef.current) break;

    // Uniform sample: nominal ± tol
    let inp = base;
    for (const p of enabled) {
      const v = p.nominal + (Math.random() * 2 - 1) * p.tolerance;
      inp = p.patchValue(inp, v);
    }

    const r = computeAll(inp);
    SENS_KPIS.forEach((kpi, j) => kpiArrays[j].push(kpi.getValue(r, inp)));

    if ((i + 1) % BATCH === 0) {
      onProgress(i + 1, n);
      await new Promise(res => setTimeout(res, 0));
    }
  }

  const actualN  = kpiArrays[0].length;
  const baseRes  = computeAll(base);

  const kpis: KPIStats[] = SENS_KPIS.map((kpi, j) => {
    const vals   = kpiArrays[j];
    const sorted = [...vals].sort((a, b) => a - b);
    const mean   = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const std    = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1));
    const tKey   = KPITC_KEY[kpi.id];
    const tr     = tKey ? targets[tKey] : null;
    const targetLo = (tr?.enabled) ? tr.lo : null;
    const targetHi = (tr?.enabled) ? tr.hi : null;
    const passRate = (targetLo !== null && targetHi !== null)
      ? vals.filter(v => v >= targetLo! && v <= targetHi!).length / (vals.length || 1)
      : NaN;
    const nominal = kpi.getValue(baseRes, base);

    return {
      id: kpi.id, label: kpi.label, unit: kpi.unit, values: vals, sorted,
      mean, std,
      p10: pct(sorted, 10),
      p50: pct(sorted, 50),
      p90: pct(sorted, 90),
      passRate, nominal, targetLo, targetHi,
    };
  });

  // Overall: fraction of samples where EVERY targeted KPI passes simultaneously
  const targeted = kpis.filter(k => k.targetLo !== null);
  let overallPassRate = 1;
  if (targeted.length > 0 && actualN > 0) {
    let passCount = 0;
    for (let i = 0; i < actualN; i++) {
      if (targeted.every(k => k.values[i] >= k.targetLo! && k.values[i] <= k.targetHi!)) {
        passCount++;
      }
    }
    overallPassRate = passCount / actualN;
  }

  return { n: actualN, kpis, elapsed: performance.now() - t0, overallPassRate };
}
