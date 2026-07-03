/**
 * sensitivity.ts — Parameter Sensitivity / Elasticity Engine (R2)
 *
 * For each input parameter, perturbs ±δ% and computes central-difference
 * elasticity:  E_ij = (∂KPI_j / KPI_j) / (∂param_i / param_i)
 *
 * Dimensionless — directly comparable across all param/KPI unit pairs.
 * E = +1.0 means "1% param increase → 1% KPI increase".
 * E = −2.0 means "1% param increase → 2% KPI decrease".
 */

import { ComputeAllInput, ComputeAllResult } from './types';
import { computeAll } from './computeAll';

// ── Parameter + KPI descriptors ──────────────────────────────────────────────

export type SensGroup = 'Geometry' | 'Suspension' | 'Chain';

export interface SensParam {
  id:         string;
  label:      string;
  group:      SensGroup;
  unit:       string;
  getValue:   (input: ComputeAllInput) => number;
  patchValue: (input: ComputeAllInput, v: number) => ComputeAllInput;
}

export interface SensKPI {
  id:       string;
  label:    string;
  unit:     string;
  getValue: (r: ComputeAllResult, input: ComputeAllInput) => number;
}

export interface SensCell {
  elasticity: number;   // (ΔKpi/Kpi) / (ΔParam/Param) — dimensionless
  rawDeriv:   number;   // ΔKpi / ΔParam — in KPI-units per param-unit
}

export interface SensitivityResult {
  params:       SensParam[];
  kpis:         SensKPI[];
  cells:        SensCell[][];   // [paramIdx][kpiIdx]
  baselineKPI:  number[];
  baselineParam:number[];
  perturbPct:   number;
  computeMs:    number;
}

// ─────────────────────────────────────────────────────────────────────────────

export const SENS_PARAMS: SensParam[] = [
  // ── Geometry ────────────────────────────────────────────────────────────────
  {
    id: 'headAngle', label: 'Head Angle', group: 'Geometry', unit: '°',
    getValue:   i => i.geometry.headAngle,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, headAngle: v } }),
  },
  {
    id: 'forkOffset', label: 'Fork Offset', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.forkOffset,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, forkOffset: v } }),
  },
  {
    id: 'forkLength', label: 'Fork Length', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.forkLength,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, forkLength: v } }),
  },
  {
    id: 'wheelbase', label: 'Wheelbase', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.wheelbase,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, wheelbase: v } }),
  },
  {
    id: 'swingarmLen', label: 'Swingarm Len', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.swingarmLength,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, swingarmLength: v } }),
  },
  {
    id: 'pivotHeight', label: 'Pivot Height', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.swingarmPivotHeight,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, swingarmPivotHeight: v } }),
  },
  {
    id: 'pivotX', label: 'Pivot X', group: 'Geometry', unit: 'mm',
    getValue:   i => i.geometry.swingarmPivotX,
    patchValue: (i, v) => ({ ...i, geometry: { ...i.geometry, swingarmPivotX: v } }),
  },
  // ── Suspension ──────────────────────────────────────────────────────────────
  {
    id: 'springRateF', label: 'Spring Rate F', group: 'Suspension', unit: 'N/mm',
    getValue:   i => i.suspension.springRateFront,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, springRateFront: v } }),
  },
  {
    id: 'springRateR', label: 'Spring Rate R', group: 'Suspension', unit: 'N/mm',
    getValue:   i => i.suspension.springRateRear,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, springRateRear: v } }),
  },
  {
    id: 'motionRatioF', label: 'Motion Ratio F', group: 'Suspension', unit: '',
    getValue:   i => i.suspension.motionRatioFront,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, motionRatioFront: v } }),
  },
  {
    id: 'motionRatioR', label: 'Motion Ratio R', group: 'Suspension', unit: '',
    getValue:   i => i.suspension.motionRatioRear,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, motionRatioRear: v } }),
  },
  {
    id: 'unsprungF', label: 'Unsprung F', group: 'Suspension', unit: 'kg',
    getValue:   i => i.suspension.unsprungFront,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, unsprungFront: v } }),
  },
  {
    id: 'unsprungR', label: 'Unsprung R', group: 'Suspension', unit: 'kg',
    getValue:   i => i.suspension.unsprungRear,
    patchValue: (i, v) => ({ ...i, suspension: { ...i.suspension, unsprungRear: v } }),
  },
  // ── Chain / Transmission ────────────────────────────────────────────────────
  {
    id: 'frontSprocket', label: 'Front Sprocket', group: 'Chain', unit: 'T',
    getValue:   i => i.chain.frontSprocket,
    patchValue: (i, v) => ({ ...i, chain: { ...i.chain, frontSprocket: v } }),
  },
  {
    id: 'rearSprocket', label: 'Rear Sprocket', group: 'Chain', unit: 'T',
    getValue:   i => i.chain.rearSprocket,
    patchValue: (i, v) => ({ ...i, chain: { ...i.chain, rearSprocket: v } }),
  },
];

export const SENS_KPIS: SensKPI[] = [
  { id: 'trail',     label: 'Trail',    unit: 'mm',   getValue: r => r.geometry.trail },
  { id: 'frontPct',  label: 'F/R %',   unit: '%',    getValue: r => r.cog.frontPercent },
  { id: 'cogH',      label: 'CoG H',   unit: 'mm',   getValue: r => r.cog.Y_cg },
  { id: 'antiSquat', label: 'AS%',     unit: '%',    getValue: r => r.antiSquat.antiSquatPercent },
  { id: 'natFreqF',  label: 'Freq F',  unit: 'Hz',   getValue: r => r.suspension.natFreqFront },
  { id: 'natFreqR',  label: 'Freq R',  unit: 'Hz',   getValue: r => r.suspension.natFreqRear },
  { id: 'sagF',      label: 'Sag% F',  unit: '%',    getValue: r => r.suspension.sagPercentFront },
  { id: 'sagR',      label: 'Sag% R',  unit: '%',    getValue: r => r.suspension.sagPercentRear },
  { id: 'wrF',       label: 'WR F',    unit: 'N/mm', getValue: r => r.suspension.wheelRateFront },
  { id: 'wrR',       label: 'WR R',    unit: 'N/mm', getValue: r => r.suspension.wheelRateRear },
];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run central-difference sensitivity analysis.
 * @param input        Current bike input
 * @param perturbPct   Perturbation size as % of each param's nominal value (default 2%)
 * @param activeGroups Groups to include; all three by default
 */
export function computeSensitivity(
  input: ComputeAllInput,
  perturbPct  = 2,
  activeGroups: Set<SensGroup> = new Set(['Geometry', 'Suspension', 'Chain']),
): SensitivityResult {
  const t0 = performance.now();

  const params = SENS_PARAMS.filter(p => activeGroups.has(p.group));

  // Baseline
  const baseResult    = computeAll(input);
  const baselineKPI   = SENS_KPIS.map(k => k.getValue(baseResult, input));
  const baselineParam = params.map(p => p.getValue(input));

  const cells: SensCell[][] = params.map((param, pi) => {
    const pv = baselineParam[pi];
    // δ = perturbPct% of nominal, with a floor so we never perturb by 0
    const δ  = Math.max(Math.abs(pv) * (perturbPct / 100), 1e-4);

    const hiResult = computeAll(param.patchValue(input, pv + δ));
    const loResult = computeAll(param.patchValue(input, pv - δ));

    return SENS_KPIS.map((kpi, ki) => {
      const kpiBase = baselineKPI[ki];
      const kpiHi   = kpi.getValue(hiResult, input);
      const kpiLo   = kpi.getValue(loResult, input);

      const rawDeriv  = (kpiHi - kpiLo) / (2 * δ);
      // E = (ΔK/K) / (ΔP/P)  — dimensionless elasticity
      const elasticity = (kpiBase !== 0 && pv !== 0)
        ? (rawDeriv * pv) / kpiBase
        : 0;

      return { elasticity: isFinite(elasticity) ? elasticity : 0, rawDeriv };
    });
  });

  return {
    params, kpis: SENS_KPIS, cells,
    baselineKPI, baselineParam,
    perturbPct,
    computeMs: performance.now() - t0,
  };
}
