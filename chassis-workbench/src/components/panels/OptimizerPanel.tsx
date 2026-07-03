import { useState, useRef, useMemo, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { ComputeAllInput } from '../../engine/types';
import {
  buildOptParams, evalFitness, hillClimbPass, randomIndividual,
  crossover, mutate, evalPopulation, insertTopN,
  initSwarm, psoStep, psoMoveParticles, posToInput,
  OptParam, OptConfig, PSOParticle,
} from '../../engine/optimizer';
import { evalBatch } from '../../api/backendClient';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fitColor(f: number) {
  return f >= 80 ? 'var(--accent2)' : f >= 50 ? 'var(--warn)' : 'var(--danger)';
}

// ── Single-line sparkline ─────────────────────────────────────────────────────

function Sparkline({ data, w = 420, h = 80 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return <div style={{ height: h, background: 'var(--surface2)', borderRadius: 4 }} />;
  const min = Math.max(0,  Math.min(...data) - 5);
  const max = Math.min(100, Math.max(...data) + 2);
  const span = max - min || 1;
  const xs = data.map((_, i) => (i / (data.length - 1)) * w);
  const ys = data.map(v => h - ((v - min) / span) * (h - 8) - 4);
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `M${pts.replace(/ /g, 'L')} L${w},${h} L0,${h}Z`;
  const best = Math.max(...data);
  const col  = fitColor(best);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={0.3} />
          <stop offset="100%" stopColor={col} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5} />
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={3}
        fill={col} stroke="var(--bg)" strokeWidth={1.5} />
      <text x={2} y={h-2} style={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {min.toFixed(0)}%
      </text>
      <text x={2} y={10} style={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {max.toFixed(0)}%
      </text>
    </svg>
  );
}

// ── Dual sparkline (PSO: gbest solid + swarm mean dashed) ──────────────────────

function DualSparkline({
  gbest, mean, w = 560, h = 80,
}: { gbest: number[]; mean: number[]; w?: number; h?: number }) {
  if (gbest.length < 2) return <div style={{ height: h, background: 'var(--surface2)', borderRadius: 4 }} />;
  const allVals = [...gbest, ...mean].filter(v => isFinite(v));
  const minV = Math.max(0,  Math.min(...allVals) - 3);
  const maxV = Math.min(100, Math.max(...allVals) + 2);
  const span = maxV - minV || 1;
  const n    = gbest.length;
  const toX  = (i: number) => (i / Math.max(n - 1, 1)) * w;
  const toY  = (v: number) => h - ((v - minV) / span) * (h - 8) - 4;

  const gPts = gbest.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const mPts = mean.length > 1
    ? mean.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
    : '';
  const area = `M${gPts.replace(/ /g, 'L')} L${w},${h} L0,${h}Z`;
  const col  = fitColor(gbest[gbest.length - 1]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="dualGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={0.25} />
          <stop offset="100%" stopColor={col} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dualGrad)" />
      {/* gbest — solid */}
      <polyline points={gPts} fill="none" stroke={col} strokeWidth={2} />
      {/* swarm mean — dashed */}
      {mPts && (
        <polyline points={mPts} fill="none" stroke="var(--cyan)" strokeWidth={1}
          strokeDasharray="3 3" opacity={0.7} />
      )}
      <circle cx={toX(n-1)} cy={toY(gbest[n-1])} r={3}
        fill={col} stroke="var(--bg)" strokeWidth={1.5} />
      {/* Legend */}
      <text x={w - 80} y={10}
        style={{ fontSize: 8, fill: col, fontFamily: 'monospace' }}>— gbest</text>
      <text x={w - 80} y={20}
        style={{ fontSize: 8, fill: 'var(--cyan)', fontFamily: 'monospace', opacity: 0.7 }}>- - mean</text>
      <text x={2} y={h-2} style={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {minV.toFixed(0)}%
      </text>
      <text x={2} y={10} style={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {maxV.toFixed(0)}%
      </text>
    </svg>
  );
}

// ── Param row ─────────────────────────────────────────────────────────────────

function ParamRow({ p, onChange }: {
  p: OptParam;
  onChange: (id: string, patch: Partial<OptParam>) => void;
}) {
  return (
    <tr style={{ opacity: p.enabled ? 1 : 0.45 }}>
      <td style={{ padding: '3px 4px' }}>
        <input type="checkbox" checked={p.enabled}
          onChange={e => onChange(p.id, { enabled: e.target.checked })}
          style={{ accentColor: 'var(--accent)', width: 11, height: 11 }} />
      </td>
      <td style={{ padding: '3px 6px', fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {p.label}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 4 }}>
          {p.nominal.toFixed(p.step < 1 ? 2 : 1)}{p.unit}
        </span>
      </td>
      <td style={{ padding: '3px 3px' }}>
        <input type="number" value={p.min} step={p.step}
          onChange={e => onChange(p.id, { min: parseFloat(e.target.value) || p.min })}
          style={{ width: 52, fontSize: 9, background: 'var(--surface2)',
            border: '1px solid var(--border)', color: 'var(--text-primary)',
            borderRadius: 3, padding: '1px 3px' }} />
      </td>
      <td style={{ padding: '3px 3px' }}>
        <input type="number" value={p.max} step={p.step}
          onChange={e => onChange(p.id, { max: parseFloat(e.target.value) || p.max })}
          style={{ width: 52, fontSize: 9, background: 'var(--surface2)',
            border: '1px solid var(--border)', color: 'var(--text-primary)',
            borderRadius: 3, padding: '1px 3px' }} />
      </td>
      <td style={{ padding: '3px 3px' }}>
        <input type="number" value={p.step} step={p.step / 2}
          min={0.001}
          onChange={e => onChange(p.id, { step: parseFloat(e.target.value) || p.step })}
          style={{ width: 44, fontSize: 9, background: 'var(--surface2)',
            border: '1px solid var(--border)', color: 'var(--text-primary)',
            borderRadius: 3, padding: '1px 3px' }} />
      </td>
    </tr>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({
  cfg, rank, onApply,
}: {
  cfg: OptConfig; rank: number;
  onApply: () => void;
}) {
  const col = fitColor(cfg.fitness);
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6,
      border: `1px solid ${rank === 1 ? col + '88' : 'var(--border)'}`,
      background: rank === 1 ? col + '0a' : 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', width: 14 }}>#{rank}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: 'monospace' }}>
          {cfg.fitness.toFixed(1)}%
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onApply} style={{
          fontSize: 9, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
          background: col + '22', color: col,
          border: `1px solid ${col}55`, fontWeight: 600,
        }}>
          Apply
        </button>
      </div>

      {cfg.changedParams.length > 0 && (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.7 }}>
          {cfg.changedParams.slice(0, 4).map((c, i) => {
            const delta = c.to - c.from;
            const sign  = delta > 0 ? '+' : '';
            return (
              <span key={i} style={{ marginRight: 8 }}>
                <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
                {' '}<span style={{ color: delta > 0 ? 'var(--accent2)' : 'var(--danger)', fontFamily: 'monospace' }}>
                  {sign}{delta.toFixed(c.unit === '°' || c.unit === '' ? 2 : 1)}{c.unit}
                </span>
              </span>
            );
          })}
          {cfg.changedParams.length > 4 && (
            <span style={{ color: 'var(--text-muted)' }}>+{cfg.changedParams.length - 4} more</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
        {Object.entries(cfg.kpiScores).slice(0, 8).map(([label, score]) => {
          const s = score * 100;
          const c = s >= 95 ? 'var(--accent2)' : s >= 50 ? 'var(--warn)' : 'var(--danger)';
          return (
            <span key={label} style={{ fontSize: 8, color: 'var(--text-muted)' }}>
              {label} <span style={{ color: c, fontFamily: 'monospace' }}>{s.toFixed(0)}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Mode = 'hill' | 'genetic' | 'pso';

const GROUP_ORDER = ['Geometry', 'Suspension', 'Chain'] as const;
const GROUP_COLORS: Record<string, string> = {
  Geometry:   'var(--accent)',
  Suspension: 'var(--cyan)',
  Chain:      'var(--warn)',
};

const MODE_LABELS: Record<Mode, string> = {
  hill:    '⚡ Hill-climb',
  genetic: '🧬 Genetic',
  pso:     '🌀 PSO',
};

export default function OptimizerPanel() {
  const input         = useStore(s => s.input);
  const targets       = useStore(s => s.targetConfig);
  const applyInput    = useStore(s => s.applyOptimizedInput);
  const backendStatus = useStore(s => s.backendStatus);

  const [params, setParams] = useState<OptParam[]>(() => buildOptParams(input));
  useEffect(() => {
    setParams(prev => buildOptParams(input).map(fresh => {
      const existing = prev.find(p => p.id === fresh.id);
      return existing ? { ...fresh, enabled: existing.enabled, min: existing.min, max: existing.max, step: existing.step } : fresh;
    }));
  }, [input]);

  const [mode, setMode]             = useState<Mode>('pso');
  const [maxIter, setMaxIter]       = useState(300);
  const [popSize, setPopSize]       = useState(24);
  const [generations, setGenerations] = useState(60);
  const [swarmSize, setSwarmSize]   = useState(30);
  const [psoIter, setPsoIter]       = useState(100);

  const [running, setRunning]       = useState(false);
  const [trajectory, setTrajectory] = useState<number[]>([]);
  const [meanTraj, setMeanTraj]     = useState<number[]>([]);
  const [liveIter, setLiveIter]     = useState(0);
  const [liveFit, setLiveFit]       = useState<number | null>(null);
  const [lastMove, setLastMove]     = useState('');
  const [results, setResults]       = useState<OptConfig[]>([]);
  const [elapsedMs, setElapsedMs]   = useState(0);
  const [diversity, setDiversity]   = useState<number | null>(null);

  const stopRef = useRef(false);

  const initFitness = useMemo(
    () => evalFitness(input, targets).fitness,
    [input, targets],
  );

  function updateParam(id: string, patch: Partial<OptParam>) {
    setParams(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  // ── Hill-climb runner ─────────────────────────────────────────────────────

  async function runHillClimb() {
    stopRef.current = false;
    setRunning(true); setResults([]); setTrajectory([]); setMeanTraj([]); setLiveIter(0);
    const t0 = performance.now();
    const enabledParams = params.filter(p => p.enabled);
    if (!enabledParams.length) { setRunning(false); return; }

    let { fitness } = evalFitness(input, targets);
    let currentCfg: OptConfig = { input, fitness, kpiValues: {}, kpiScores: {}, generation: 0, changedParams: [] };
    let topConfigs: OptConfig[] = [];
    const traj = [fitness];
    let noImprove = 0;

    for (let i = 0; i < maxIter; i++) {
      if (stopRef.current) break;
      const next = hillClimbPass(currentCfg.input, enabledParams, targets, currentCfg.fitness, input, i);
      const improved = next.fitness > currentCfg.fitness + 0.01;
      currentCfg = next;
      traj.push(next.fitness);
      topConfigs = insertTopN(topConfigs, next);
      noImprove  = improved ? 0 : noImprove + 1;
      if (i % 15 === 0) {
        setTrajectory([...traj]);
        setLiveIter(i); setLiveFit(next.fitness);
        setLastMove(next.changedParams[next.changedParams.length - 1]?.label ?? '');
        await new Promise(r => setTimeout(r, 0));
      }
      if (noImprove >= 30 || next.fitness >= 99.5) break;
    }

    setTrajectory(traj); setResults(topConfigs);
    setElapsedMs(performance.now() - t0); setRunning(false);
  }

  // ── Genetic runner ────────────────────────────────────────────────────────

  async function runGenetic() {
    stopRef.current = false;
    setRunning(true); setResults([]); setTrajectory([]); setMeanTraj([]); setLiveIter(0);
    const t0 = performance.now();
    const enabledParams = params.filter(p => p.enabled);
    if (!enabledParams.length) { setRunning(false); return; }

    let population: ComputeAllInput[] = [
      input,
      ...Array.from({ length: popSize - 1 }, () => randomIndividual(input, enabledParams)),
    ];

    let topConfigs: OptConfig[] = [];
    const traj: number[] = [];

    for (let g = 0; g < generations; g++) {
      if (stopRef.current) break;
      const evaluated = evalPopulation(population, targets);
      const best = evaluated[0];
      traj.push(best.fitness);

      topConfigs = insertTopN(topConfigs, {
        ...best, generation: g,
        changedParams: params.filter(p => p.enabled).map(p => ({
          label: p.label, unit: p.unit, from: p.getValue(input), to: p.getValue(best.input),
        })).filter(c => Math.abs(c.to - c.from) > 1e-9),
      });

      const elite = evaluated.slice(0, Math.ceil(popSize / 2)).map(e => e.input);
      const children: ComputeAllInput[] = [...elite];
      while (children.length < popSize) {
        const a = elite[Math.floor(Math.random() * elite.length)];
        const b = elite[Math.floor(Math.random() * elite.length)];
        children.push(mutate(crossover(a, b, enabledParams), enabledParams));
      }
      population = children;

      setTrajectory([...traj]); setLiveIter(g);
      setLiveFit(best.fitness);
      setLastMove(`Gen ${g + 1}/${generations} — best ${best.fitness.toFixed(1)}%`);
      await new Promise(r => setTimeout(r, 0));
      if (best.fitness >= 99.5) break;
    }

    setResults(topConfigs); setElapsedMs(performance.now() - t0); setRunning(false);
  }

  // ── PSO runner ────────────────────────────────────────────────────────────

  async function runPSO() {
    stopRef.current = false;
    setRunning(true); setResults([]); setTrajectory([]); setMeanTraj([]);
    setLiveIter(0); setDiversity(null);
    const t0 = performance.now();
    const enabledParams = params.filter(p => p.enabled);
    if (!enabledParams.length) { setRunning(false); return; }

    const useBackend = backendStatus === 'synced';

    // Convert TargetConfig to plain dict for backend
    const targetsPlain: Record<string, { enabled: boolean; lo: number; hi: number }> = {};
    for (const [k, v] of Object.entries(targets)) {
      targetsPlain[k] = { enabled: v.enabled, lo: v.lo, hi: v.hi };
    }

    // ── Init swarm ──
    let swarmInit: { particles: PSOParticle[]; gbest: Record<string,number>; gbestFit: number; backendOk: boolean };

    if (useBackend) {
      const positions = Array.from({ length: swarmSize }, (_, i) => {
        const pos: Record<string, number> = {};
        for (const p of enabledParams) {
          pos[p.id] = i === 0 ? p.getValue(input) : p.min + Math.random() * (p.max - p.min);
        }
        return pos;
      });
      const vels = positions.map(() => {
        const vel: Record<string, number> = {};
        for (const p of enabledParams) {
          vel[p.id] = (Math.random() - 0.5) * (p.max - p.min) * 0.1;
        }
        return vel;
      });
      try {
        const evals  = await evalBatch(input, positions, targetsPlain);
        const particles = evals.map((e, i) => ({
          pos: positions[i], vel: vels[i],
          pbestPos: { ...positions[i] }, pbestFit: e.fitness, curFit: e.fitness,
        }));
        let gbestFit = -Infinity, gbest = particles[0].pos;
        for (const pt of particles) {
          if (pt.pbestFit > gbestFit) { gbestFit = pt.pbestFit; gbest = { ...pt.pbestPos }; }
        }
        swarmInit = { particles, gbest, gbestFit, backendOk: true };
      } catch {
        const sw = initSwarm(input, enabledParams, swarmSize, targets);
        swarmInit = { ...sw, backendOk: false };
      }
    } else {
      const sw = initSwarm(input, enabledParams, swarmSize, targets);
      swarmInit = { ...sw, backendOk: false };
    }

    await runPSOLoop(
      swarmInit.particles, swarmInit.gbest, swarmInit.gbestFit,
      enabledParams, t0, useBackend && swarmInit.backendOk, targetsPlain,
    );
  }

  async function runPSOLoop(
    initParticles:  PSOParticle[],
    initGbest:      Record<string, number>,
    initGbestFit:   number,
    enabledParams:  OptParam[],
    t0:             number,
    useBackend:     boolean,
    targetsPlain:   Record<string, { enabled: boolean; lo: number; hi: number }>,
  ) {
    const w0   = 0.9;
    const wMin = 0.4;
    let particles = initParticles;
    let gbest     = initGbest;
    let gbestFit  = initGbestFit;
    let topConfigs: OptConfig[] = [];
    const gbestTraj: number[] = [gbestFit];
    const meanTrajArr: number[] = [];

    for (let it = 0; it < psoIter; it++) {
      if (stopRef.current) break;
      const w = w0 - (w0 - wMin) * (it / psoIter);

      if (useBackend) {
        // Velocity + position update (pure math, TS)
        const moved = psoMoveParticles(particles, gbest, enabledParams, input, w);
        const positions = moved.map(m => m.newPos);
        let evals: Array<{ fitness: number; kpi_values: Record<string,number>; kpi_scores: Record<string,number> }>;
        try {
          evals = await evalBatch(input, positions, targetsPlain);
        } catch {
          // Backend gone mid-run — switch to TS for rest
          const step = psoStep(particles, gbest, gbestFit, enabledParams, targets, input, w);
          particles = step.particles; gbest = step.gbest; gbestFit = step.gbestFit;
          gbestTraj.push(gbestFit); meanTrajArr.push(step.meanFit);
          continue;
        }

        let newGbest = gbest, newGbestFit = gbestFit;
        let sumFit = 0;
        const updated: PSOParticle[] = particles.map((pt, i) => {
          const { newPos, newVel } = moved[i];
          const fitness = evals[i].fitness;
          sumFit += fitness;
          const improved    = fitness > pt.pbestFit;
          const newPbestPos = improved ? { ...newPos } : pt.pbestPos;
          const newPbestFit = improved ? fitness : pt.pbestFit;
          if (newPbestFit > newGbestFit) { newGbestFit = newPbestFit; newGbest = { ...newPbestPos }; }
          return { pos: newPos, vel: newVel, pbestPos: newPbestPos, pbestFit: newPbestFit, curFit: fitness };
        });
        particles = updated; gbest = newGbest; gbestFit = newGbestFit;
        const meanFit = sumFit / particles.length;
        gbestTraj.push(gbestFit); meanTrajArr.push(meanFit);
      } else {
        const step = psoStep(particles, gbest, gbestFit, enabledParams, targets, input, w);
        particles = step.particles; gbest = step.gbest; gbestFit = step.gbestFit;
        gbestTraj.push(gbestFit); meanTrajArr.push(step.meanFit);
      }

      const fits  = particles.map(p => p.curFit);
      const fMean = fits.reduce((a, b) => a + b, 0) / fits.length;
      const fStd  = Math.sqrt(fits.reduce((a, b) => a + (b - fMean) ** 2, 0) / fits.length);

      const gbestInput = posToInput(gbest, input, enabledParams);
      const { fitness, kpiValues, kpiScores } = evalFitness(gbestInput, targets);
      const cfg: OptConfig = {
        input: gbestInput, fitness, kpiValues, kpiScores, generation: it,
        changedParams: enabledParams.map(p => ({
          label: p.label, unit: p.unit,
          from: p.getValue(input), to: p.getValue(gbestInput),
        })).filter(c => Math.abs(c.to - c.from) > 1e-9),
      };
      topConfigs = insertTopN(topConfigs, cfg);

      setTrajectory([...gbestTraj]); setMeanTraj([...meanTrajArr]);
      setLiveIter(it); setLiveFit(gbestFit); setDiversity(fStd);
      setLastMove(
        `PSO iter ${it + 1}/${psoIter} · w=${w.toFixed(3)} · ${useBackend ? '⚡ DAG' : '⚙ TS'} · diversity=${fStd.toFixed(2)}%`
      );
      await new Promise(r => setTimeout(r, 0));
      if (gbestFit >= 99.5) break;
    }

    setResults(topConfigs); setElapsedMs(performance.now() - t0); setRunning(false);
  }

  function handleRun() {
    if (mode === 'hill') runHillClimb();
    else if (mode === 'genetic') runGenetic();
    else runPSO();
  }
  function handleStop() { stopRef.current = true; }

  const enabledCount  = params.filter(p => p.enabled).length;
  const activeTargets = Object.values(targets).filter(t => t.enabled).length;

  const isPSO = mode === 'pso';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: param configurator ── */}
      <div style={{
        width: 400, flexShrink: 0, overflowY: 'auto',
        borderRight: '1px solid var(--border)', padding: '10px 10px',
      }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 8 }}>
          Parameters to Optimize
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ width: 16 }} />
              <th style={{ textAlign: 'left', padding: '2px 6px' }}>Param</th>
              <th style={{ textAlign: 'center', padding: '2px 3px' }}>Min</th>
              <th style={{ textAlign: 'center', padding: '2px 3px' }}>Max</th>
              <th style={{ textAlign: 'center', padding: '2px 3px' }}>Step</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map(group => {
              const groupParams = params.filter(p => p.group === group);
              return [
                <tr key={`grp-${group}`}>
                  <td colSpan={5} style={{
                    padding: '8px 4px 3px', fontSize: 9, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: 1,
                    color: GROUP_COLORS[group], borderTop: '1px solid var(--border)',
                  }}>
                    {group}
                  </td>
                </tr>,
                ...groupParams.map(p => (
                  <ParamRow key={p.id} p={p} onChange={updateParam} />
                )),
              ];
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
          {enabledCount} params enabled ·{' '}
          <button onClick={() => setParams(buildOptParams(input))}
            style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text-muted)' }}>
            Reset
          </button>
        </div>

        {/* Algorithm config */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 8 }}>
            Algorithm
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['hill', 'genetic', 'pso'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                fontSize: 9, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`,
                background: mode === m ? 'var(--accent)22' : 'var(--surface2)',
                color: mode === m ? 'var(--accent)' : 'var(--text-muted)',
              }}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {mode === 'hill' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
              <span style={{ color: 'var(--text-muted)' }}>Max iterations</span>
              <input type="range" min={50} max={800} step={50} value={maxIter}
                onChange={e => setMaxIter(parseInt(e.target.value))}
                style={{ width: 80, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', width: 30 }}>
                {maxIter}
              </span>
            </div>
          )}

          {mode === 'genetic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', width: 80 }}>Population</span>
                <input type="range" min={10} max={50} step={2} value={popSize}
                  onChange={e => setPopSize(parseInt(e.target.value))}
                  style={{ width: 80, accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', width: 24 }}>{popSize}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', width: 80 }}>Generations</span>
                <input type="range" min={20} max={150} step={10} value={generations}
                  onChange={e => setGenerations(parseInt(e.target.value))}
                  style={{ width: 80, accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', width: 24 }}>{generations}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                Est. {popSize * generations} computeAll() calls
              </div>
            </div>
          )}

          {mode === 'pso' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', width: 80 }}>Swarm size</span>
                <input type="range" min={10} max={60} step={5} value={swarmSize}
                  onChange={e => setSwarmSize(parseInt(e.target.value))}
                  style={{ width: 80, accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', width: 24 }}>{swarmSize}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', width: 80 }}>Iterations</span>
                <input type="range" min={30} max={200} step={10} value={psoIter}
                  onChange={e => setPsoIter(parseInt(e.target.value))}
                  style={{ width: 80, accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', width: 24 }}>{psoIter}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {swarmSize * psoIter} evaluations · w 0.9→0.4 · c₁=c₂=1.5
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.6,
                padding: '5px 6px', background: 'var(--surface2)', borderRadius: 4 }}>
                v = w·v + c₁·r₁·(pbest−x) + c₂·r₂·(gbest−x)<br/>
                Velocity clamped ±(max−min)/4 per dimension<br/>
                Inertia w decays linearly: exploration → exploitation
              </div>
            </div>
          )}

          {activeTargets === 0 && (
            <div style={{ marginTop: 8, fontSize: 9, color: 'var(--warn)',
              padding: '5px 8px', background: 'var(--warn)11', borderRadius: 4 }}>
              ⚠ No targets enabled — go to Targets tab first
            </div>
          )}
        </div>
      </div>

      {/* ── Right: progress + results ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Run / stop + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={running ? handleStop : handleRun}
            disabled={!running && (enabledCount === 0 || activeTargets === 0)}
            style={{
              fontSize: 11, padding: '7px 20px', borderRadius: 5, cursor: 'pointer',
              fontWeight: 600, border: 'none',
              background: running ? 'var(--danger)' : 'var(--accent)',
              color: '#fff',
              opacity: (!running && (enabledCount === 0 || activeTargets === 0)) ? 0.4 : 1,
            }}>
            {running ? '■ Stop'
              : `▶ Run ${MODE_LABELS[mode]}${mode === 'pso' && backendStatus === 'synced' ? ' ⚡' : ''}`}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Baseline fitness:{' '}
              <span style={{ color: fitColor(initFitness), fontFamily: 'monospace', fontWeight: 700 }}>
                {initFitness.toFixed(1)}%
              </span>
            </div>
            {liveFit !== null && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Current best:{' '}
                <span style={{ color: fitColor(liveFit), fontFamily: 'monospace', fontWeight: 700 }}>
                  {liveFit.toFixed(1)}%
                </span>
                {liveFit > initFitness && (
                  <span style={{ color: 'var(--accent2)', marginLeft: 6 }}>
                    +{(liveFit - initFitness).toFixed(1)}pp
                  </span>
                )}
              </div>
            )}
          </div>

          {/* PSO diversity badge */}
          {isPSO && diversity !== null && (
            <div style={{ fontSize: 9, color: 'var(--text-muted)',
              padding: '3px 7px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 4 }}>
              swarm diversity{' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--cyan)' }}>
                ±{diversity.toFixed(2)}%
              </span>
            </div>
          )}

          {running && (
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto', maxWidth: 260 }}>
              {mode === 'hill' ? `Iter ${liveIter}` : lastMove}
            </div>
          )}
          {!running && elapsedMs > 0 && (
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Finished in {elapsedMs.toFixed(0)}ms
            </div>
          )}
        </div>

        {/* Fitness trajectory */}
        {trajectory.length > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 6,
            background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
              {isPSO ? 'PSO convergence — gbest (solid) · swarm mean (dashed)' : `Fitness trajectory — ${trajectory.length} samples`}
              {lastMove && !running && !isPSO && (
                <span style={{ marginLeft: 8, color: 'var(--accent2)' }}>
                  last move: {lastMove}
                </span>
              )}
            </div>
            {isPSO
              ? <DualSparkline gbest={trajectory} mean={meanTraj} w={560} h={80} />
              : <Sparkline data={trajectory} w={560} h={72} />
            }
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
              letterSpacing: 1 }}>
              Top Configurations — click Apply to load into workbench
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((cfg, i) => (
                <ResultCard
                  key={i} cfg={cfg} rank={i + 1}
                  onApply={() => applyInput(cfg.input)}
                />
              ))}
            </div>

            {/* KPI comparison table */}
            <div style={{ marginTop: 4, overflowX: 'auto' }}>
              <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
                letterSpacing: 1, marginBottom: 6 }}>
                KPI Comparison
              </div>
              <table style={{ borderCollapse: 'collapse', fontSize: 9, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '3px 8px',
                      color: 'var(--text-muted)', fontWeight: 400,
                      borderBottom: '1px solid var(--border)' }}>KPI</th>
                    <th style={{ textAlign: 'center', padding: '3px 8px',
                      color: 'var(--text-muted)', fontWeight: 400,
                      borderBottom: '1px solid var(--border)' }}>Baseline</th>
                    {results.map((_, i) => (
                      <th key={i} style={{ textAlign: 'center', padding: '3px 8px',
                        color: 'var(--text-muted)', fontWeight: 400,
                        borderBottom: '1px solid var(--border)' }}>
                        #{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(results[0].kpiValues).map(label => {
                    const baseVal = evalFitness(input, targets).kpiValues[label] ?? 0;
                    return (
                      <tr key={label}>
                        <td style={{ padding: '2px 8px', color: 'var(--text-muted)' }}>{label}</td>
                        <td style={{ padding: '2px 8px', textAlign: 'center',
                          fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {baseVal.toFixed(2)}
                        </td>
                        {results.map((cfg, i) => {
                          const v   = cfg.kpiValues[label] ?? 0;
                          const Δ   = v - baseVal;
                          const col = Math.abs(Δ) < 0.01 ? 'var(--text-muted)'
                            : Δ > 0 ? 'var(--accent2)' : 'var(--danger)';
                          return (
                            <td key={i} style={{ padding: '2px 8px', textAlign: 'center',
                              fontFamily: 'monospace', color: col }}>
                              {v.toFixed(2)}
                              {Math.abs(Δ) >= 0.01 && (
                                <span style={{ fontSize: 8, marginLeft: 2 }}>
                                  ({Δ > 0 ? '+' : ''}{Δ.toFixed(2)})
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Empty state */}
        {!running && results.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>{mode === 'pso' ? '🌀' : '⚙'}</div>
            <div style={{ fontSize: 11 }}>
              {activeTargets === 0
                ? 'Set targets in the Targets tab, then run the optimizer.'
                : `${enabledCount} params · ${activeTargets} targets · Press Run ${MODE_LABELS[mode]}`}
            </div>
            {mode === 'pso' && activeTargets > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7,
                maxWidth: 380, padding: '8px 12px', background: 'var(--surface2)',
                borderRadius: 6, border: '1px solid var(--border)' }}>
                PSO (Kennedy & Eberhart 1995) — {swarmSize} particles explore the full parameter space simultaneously.<br/>
                Each particle remembers its personal best and follows the swarm's global best.<br/>
                Inertia w decays 0.9→0.4 for smooth transition from exploration to fine-tuning.
              </div>
            )}
            {activeTargets > 0 && (
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                Baseline: <span style={{ color: fitColor(initFitness), fontFamily: 'monospace' }}>
                  {initFitness.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
