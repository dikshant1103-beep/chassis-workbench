/**
 * optimizer.ts — Multi-Objective Optimizer Engine (R3)
 *
 * Supports two search modes:
 *   Hill-climb  — coordinate descent, fast (<2s), good for fine-tuning near a known good region
 *   Genetic     — population-based, thorough (~3s), explores global parameter space
 *
 * Fitness function reuses TargetConfig from R1.
 * All computation is pure synchronous TypeScript; async batching is handled in the panel.
 */

import { ComputeAllInput, ComputeAllResult, TargetConfig, TargetRange } from './types';
import { computeAll } from './computeAll';
import { SENS_PARAMS, SensParam } from './sensitivity';

// ── Fitness scoring (mirrors TargetsPanel formula) ───────────────────────────

function scoreOne(value: number, t: TargetRange): number {
  if (!t.enabled) return 1;
  const span = t.hi - t.lo;
  if (value >= t.lo && value <= t.hi) return 1;
  const dist = value < t.lo ? t.lo - value : value - t.hi;
  const decay = span > 0 ? dist / span : dist;
  return Math.max(0, 0.5 * (1 + Math.cos(Math.PI * Math.min(decay, 1))));
}

/** KPI-to-TargetConfig mapping — keeps the fitness function aligned with the Targets tab */
const KPI_TARGETS: Array<{
  label: string;
  targetKey: keyof TargetConfig;
  getVal: (r: ComputeAllResult, i: ComputeAllInput) => number;
}> = [
  { label: 'Trail',      targetKey: 'trail',               getVal: r => r.geometry.trail },
  { label: 'Front%',     targetKey: 'frontPercent',         getVal: r => r.cog.frontPercent },
  { label: 'CoG H',      targetKey: 'cogHeight',            getVal: r => r.cog.Y_cg },
  { label: 'AS%',        targetKey: 'antiSquatPercent',     getVal: r => r.antiSquat.antiSquatPercent },
  { label: 'Freq F',     targetKey: 'natFreqFront',         getVal: r => r.suspension.natFreqFront },
  { label: 'Freq R',     targetKey: 'natFreqRear',          getVal: r => r.suspension.natFreqRear },
  { label: 'Sag% F',     targetKey: 'sagPercentFront',      getVal: r => r.suspension.sagPercentFront },
  { label: 'Sag% R',     targetKey: 'sagPercentRear',       getVal: r => r.suspension.sagPercentRear },
  { label: 'WR F',       targetKey: 'wheelRateFront',       getVal: r => r.suspension.wheelRateFront },
  { label: 'WR R',       targetKey: 'wheelRateRear',        getVal: r => r.suspension.wheelRateRear },
  { label: 'S:U F',      targetKey: 'sprungUnsprungRatioF', getVal: (r, i) => r.suspension.sprungMassFront / (i.suspension.unsprungFront || 1) },
  { label: 'S:U R',      targetKey: 'sprungUnsprungRatioR', getVal: (r, i) => r.suspension.sprungMassRear  / (i.suspension.unsprungRear  || 1) },
];

export interface FitnessResult {
  fitness:   number;                    // 0–100 (percentage)
  kpiValues: Record<string, number>;   // label → value
  kpiScores: Record<string, number>;   // label → 0–1 score
}

export function evalFitness(input: ComputeAllInput, targets: TargetConfig): FitnessResult {
  let result: ComputeAllResult;
  try { result = computeAll(input); } catch { return { fitness: 0, kpiValues: {}, kpiScores: {} }; }

  const kpiValues: Record<string, number> = {};
  const kpiScores: Record<string, number> = {};
  let total = 0, count = 0;

  for (const { label, targetKey, getVal } of KPI_TARGETS) {
    const t = targets[targetKey];
    const v = getVal(result, input);
    kpiValues[label] = v;
    kpiScores[label] = scoreOne(v, t);
    if (t.enabled) { total += kpiScores[label]; count++; }
  }

  return { fitness: count > 0 ? (total / count) * 100 : 100, kpiValues, kpiScores };
}

// ── OptParam — SENS_PARAMS extended with optimizer bounds ────────────────────

export interface OptParam extends SensParam {
  enabled: boolean;
  min:     number;
  max:     number;
  step:    number;
  nominal: number;
}

/** Physics-derived safe bounds for each parameter */
const PARAM_BOUNDS: Record<string, { min: number; max: number; step: number }> = {
  headAngle:    { min: 17,   max: 35,   step: 0.5  },
  forkOffset:   { min: 10,   max: 85,   step: 1    },
  forkLength:   { min: 500,  max: 950,  step: 5    },
  wheelbase:    { min: 1150, max: 1750, step: 5    },
  swingarmLen:  { min: 350,  max: 680,  step: 5    },
  pivotHeight:  { min: 260,  max: 480,  step: 5    },
  pivotX:       { min: 450,  max: 850,  step: 5    },
  springRateF:  { min: 4,    max: 45,   step: 0.5  },
  springRateR:  { min: 8,    max: 110,  step: 1    },
  motionRatioF: { min: 0.4,  max: 1.6,  step: 0.05 },
  motionRatioR: { min: 0.25, max: 1.0,  step: 0.05 },
  unsprungF:    { min: 4,    max: 28,   step: 0.5  },
  unsprungR:    { min: 7,    max: 38,   step: 0.5  },
  frontSprocket:{ min: 10,   max: 22,   step: 1    },
  rearSprocket: { min: 32,   max: 65,   step: 1    },
};

/** Default-enabled params — suspension and key geometry */
const DEFAULT_ENABLED = new Set([
  'headAngle', 'forkOffset', 'springRateF', 'springRateR',
  'motionRatioF', 'motionRatioR',
]);

export function buildOptParams(input: ComputeAllInput): OptParam[] {
  return SENS_PARAMS.map(p => {
    const bounds = PARAM_BOUNDS[p.id] ?? { min: 0, max: 1000, step: 1 };
    const nominal = p.getValue(input);
    return {
      ...p,
      enabled: DEFAULT_ENABLED.has(p.id),
      nominal,
      min:  bounds.min,
      max:  bounds.max,
      step: bounds.step,
    };
  });
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface OptConfig {
  input:      ComputeAllInput;
  fitness:    number;
  kpiValues:  Record<string, number>;
  kpiScores:  Record<string, number>;
  generation: number;
  changedParams: Array<{ label: string; from: number; to: number; unit: string }>;
}

function buildChangedParams(orig: ComputeAllInput, next: ComputeAllInput, params: OptParam[]) {
  return params
    .map(p => ({ label: p.label, unit: p.unit, from: p.getValue(orig), to: p.getValue(next) }))
    .filter(c => Math.abs(c.to - c.from) > 1e-9);
}

// ── Top-N config list (deduplicates near-identical fitness) ──────────────────

export function insertTopN(
  list: OptConfig[], candidate: OptConfig, n = 5,
): OptConfig[] {
  const isDup = list.some(c => Math.abs(c.fitness - candidate.fitness) < 0.05);
  if (isDup) {
    return list.map(c =>
      Math.abs(c.fitness - candidate.fitness) < 0.05 && candidate.fitness > c.fitness
        ? candidate : c,
    );
  }
  const next = [...list, candidate].sort((a, b) => b.fitness - a.fitness);
  return next.slice(0, n);
}

// ── Hill-climb (coordinate descent) ─────────────────────────────────────────

/**
 * One full coordinate-descent pass: try ±step for every enabled param,
 * greedily accept improvements.  Returns the updated input and whether
 * any improvement was found.
 */
export function hillClimbPass(
  current:  ComputeAllInput,
  params:   OptParam[],
  targets:  TargetConfig,
  curFit:   number,
  baseInput: ComputeAllInput,
  gen:       number,
): OptConfig {
  let best    = current;
  let bestFit = curFit;

  const shuffled = [...params.filter(p => p.enabled)].sort(() => Math.random() - 0.5);

  for (const p of shuffled) {
    const v = p.getValue(best);
    for (const δ of [p.step, -p.step]) {
      const nv = Math.max(p.min, Math.min(p.max, v + δ));
      if (Math.abs(nv - v) < 1e-9) continue;
      try {
        const candidate = p.patchValue(best, nv);
        const { fitness } = evalFitness(candidate, targets);
        if (fitness > bestFit) { bestFit = fitness; best = candidate; }
      } catch { /* invalid geometry, skip */ }
    }
  }

  const { kpiValues, kpiScores } = evalFitness(best, targets);
  return {
    input: best, fitness: bestFit, kpiValues, kpiScores, generation: gen,
    changedParams: buildChangedParams(baseInput, best, params),
  };
}

// ── Genetic algorithm ────────────────────────────────────────────────────────

function clampToStep(v: number, min: number, max: number, step: number): number {
  const steps = Math.round((v - min) / step);
  return Math.max(min, Math.min(max, min + steps * step));
}

export function randomIndividual(base: ComputeAllInput, params: OptParam[]): ComputeAllInput {
  let cfg = base;
  for (const p of params) {
    if (!p.enabled) continue;
    const steps  = Math.floor((p.max - p.min) / p.step);
    const chosen = p.min + Math.floor(Math.random() * (steps + 1)) * p.step;
    cfg = p.patchValue(cfg, Math.max(p.min, Math.min(p.max, chosen)));
  }
  return cfg;
}

export function crossover(a: ComputeAllInput, b: ComputeAllInput, params: OptParam[]): ComputeAllInput {
  let child = a;
  for (const p of params) {
    if (!p.enabled) continue;
    child = p.patchValue(child, Math.random() > 0.5 ? p.getValue(b) : p.getValue(a));
  }
  return child;
}

export function mutate(cfg: ComputeAllInput, params: OptParam[], rate = 0.25): ComputeAllInput {
  let result = cfg;
  for (const p of params) {
    if (!p.enabled || Math.random() > rate) continue;
    const v  = p.getValue(result);
    const δ  = (Math.random() > 0.5 ? 1 : -1) * p.step * (1 + Math.floor(Math.random() * 3));
    const nv = clampToStep(v + δ, p.min, p.max, p.step);
    result = p.patchValue(result, nv);
  }
  return result;
}

/** Evaluate a full population and return sorted individuals */
export function evalPopulation(
  population: ComputeAllInput[],
  targets:    TargetConfig,
): Array<{ input: ComputeAllInput; fitness: number; kpiValues: Record<string,number>; kpiScores: Record<string,number> }> {
  return population
    .map(ind => {
      const { fitness, kpiValues, kpiScores } = evalFitness(ind, targets);
      return { input: ind, fitness, kpiValues, kpiScores };
    })
    .sort((a, b) => b.fitness - a.fitness);
}

// ── Particle Swarm Optimization (Kennedy & Eberhart 1995) ─────────────────────

export interface PSOParticle {
  pos:      Record<string, number>; // continuous position in param space
  vel:      Record<string, number>; // velocity per param
  pbestPos: Record<string, number>; // personal best position
  pbestFit: number;                 // personal best fitness
  curFit:   number;                 // current fitness
}

/** Apply a continuous-space position to a ComputeAllInput (discretised at eval time). */
export function posToInput(
  pos:    Record<string, number>,
  base:   ComputeAllInput,
  params: OptParam[],
): ComputeAllInput {
  let cfg = base;
  for (const p of params) {
    if (!p.enabled) continue;
    const v = clampToStep(pos[p.id] ?? p.getValue(base), p.min, p.max, p.step);
    cfg = p.patchValue(cfg, v);
  }
  return cfg;
}

/** Initialise a swarm. Particle 0 starts at the current design; rest are random. */
export function initSwarm(
  baseInput: ComputeAllInput,
  params:    OptParam[],
  size:      number,
  targets:   TargetConfig,
): { particles: PSOParticle[]; gbest: Record<string, number>; gbestFit: number } {
  const enabled = params.filter(p => p.enabled);
  const particles: PSOParticle[] = [];

  for (let i = 0; i < size; i++) {
    const pos: Record<string, number> = {};
    for (const p of enabled) {
      if (i === 0) {
        pos[p.id] = p.getValue(baseInput);
      } else {
        pos[p.id] = p.min + Math.random() * (p.max - p.min);
      }
    }
    const vel: Record<string, number> = {};
    for (const p of enabled) {
      vel[p.id] = (Math.random() - 0.5) * (p.max - p.min) * 0.1;
    }
    const inp = posToInput(pos, baseInput, params);
    const { fitness } = evalFitness(inp, targets);
    particles.push({ pos, vel, pbestPos: { ...pos }, pbestFit: fitness, curFit: fitness });
  }

  let gbestFit = -Infinity;
  let gbest    = particles[0].pos;
  for (const pt of particles) {
    if (pt.pbestFit > gbestFit) { gbestFit = pt.pbestFit; gbest = { ...pt.pbestPos }; }
  }

  return { particles, gbest, gbestFit };
}

/**
 * Velocity + position update only — NO fitness evaluation.
 * Use this when fitness will be evaluated externally (e.g. backend batch call).
 */
export function psoMoveParticles(
  particles: PSOParticle[],
  gbest:     Record<string, number>,
  params:    OptParam[],
  baseInput: ComputeAllInput,
  w:         number,
  c1 = 1.5,
  c2 = 1.5,
): Array<{ newPos: Record<string, number>; newVel: Record<string, number> }> {
  const enabled = params.filter(p => p.enabled);
  return particles.map(pt => {
    const newPos: Record<string, number> = {};
    const newVel: Record<string, number> = {};
    for (const p of enabled) {
      const vMax = (p.max - p.min) / 4;
      const r1   = Math.random();
      const r2   = Math.random();
      const v    = w * pt.vel[p.id]
        + c1 * r1 * ((pt.pbestPos[p.id] ?? p.getValue(baseInput)) - pt.pos[p.id])
        + c2 * r2 * ((gbest[p.id]       ?? p.getValue(baseInput)) - pt.pos[p.id]);
      newVel[p.id] = Math.max(-vMax, Math.min(vMax, v));
      newPos[p.id] = Math.max(p.min, Math.min(p.max, pt.pos[p.id] + newVel[p.id]));
    }
    return { newPos, newVel };
  });
}

/**
 * Execute one full PSO iteration over all particles.
 * w: inertia weight (caller decreases linearly from 0.9 → 0.4 over iterations)
 * c1/c2: cognitive/social coefficients (Kennedy & Eberhart standard: 1.5)
 */
export function psoStep(
  particles: PSOParticle[],
  gbest:     Record<string, number>,
  gbestFit:  number,
  params:    OptParam[],
  targets:   TargetConfig,
  baseInput: ComputeAllInput,
  w:         number,
  c1 = 1.5,
  c2 = 1.5,
): { particles: PSOParticle[]; gbest: Record<string, number>; gbestFit: number; meanFit: number } {
  const enabled = params.filter(p => p.enabled);
  const updated: PSOParticle[] = [];
  let newGbest    = gbest;
  let newGbestFit = gbestFit;
  let sumFit = 0;

  for (const pt of particles) {
    const newPos: Record<string, number> = {};
    const newVel: Record<string, number> = {};

    for (const p of enabled) {
      const vMax = (p.max - p.min) / 4;
      const r1   = Math.random();
      const r2   = Math.random();
      const v    = w * pt.vel[p.id]
        + c1 * r1 * ((pt.pbestPos[p.id] ?? p.getValue(baseInput)) - pt.pos[p.id])
        + c2 * r2 * ((gbest[p.id]       ?? p.getValue(baseInput)) - pt.pos[p.id]);

      newVel[p.id] = Math.max(-vMax, Math.min(vMax, v));
      newPos[p.id] = Math.max(p.min, Math.min(p.max, pt.pos[p.id] + newVel[p.id]));
    }

    const inp     = posToInput(newPos, baseInput, params);
    const { fitness } = evalFitness(inp, targets);
    sumFit += fitness;

    const improved    = fitness > pt.pbestFit;
    const newPbestPos = improved ? { ...newPos } : pt.pbestPos;
    const newPbestFit = improved ? fitness       : pt.pbestFit;

    if (newPbestFit > newGbestFit) {
      newGbestFit = newPbestFit;
      newGbest    = { ...newPbestPos };
    }

    updated.push({ pos: newPos, vel: newVel, pbestPos: newPbestPos, pbestFit: newPbestFit, curFit: fitness });
  }

  return {
    particles: updated,
    gbest:     newGbest,
    gbestFit:  newGbestFit,
    meanFit:   sumFit / particles.length,
  };
}
