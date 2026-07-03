/**
 * MonteCarloPanel.tsx — R4: Monte Carlo / Tolerance Analysis
 *
 * Answers: "Given real-world manufacturing variation on each parameter,
 * what fraction of bikes will hit the design targets?"
 */
import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { buildMCParams, runMonteCarlo, KPIStats, MCParam } from '../../engine/monteCarlo';
import { runMonteCarloBackend, BackendKPIStats } from '../../api/backendClient';

// ── Histogram card ────────────────────────────────────────────────────────────

const BINS = 22;

function Histogram({ stat, w = 320, h = 90 }: { stat: KPIStats; w?: number; h?: number }) {
  const { values, sorted, p10, p50, p90, nominal, targetLo, targetHi } = stat;
  if (values.length < 2) return (
    <div style={{ height: h, background: 'var(--surface2)', borderRadius: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, color: 'var(--text-muted)' }}>
      No data
    </div>
  );

  const minV = sorted[0];
  const maxV = sorted[sorted.length - 1];
  const span = maxV - minV || 1;
  const bw   = span / BINS;

  // Bin the data
  const counts = new Array(BINS).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - minV) / bw), BINS - 1);
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);

  // Coordinate helpers
  const toX = (v: number) => ((v - minV) / span) * w;
  const toY = (c: number) => h - (c / maxCount) * (h - 10) - 2;

  // Bar color per bin
  const barColor = (i: number) => {
    const binCenter = minV + (i + 0.5) * bw;
    if (targetLo !== null && targetHi !== null) {
      return binCenter >= targetLo && binCenter <= targetHi
        ? 'var(--accent2)' : 'var(--danger)';
    }
    return 'var(--accent)';
  };

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Target range background */}
      {targetLo !== null && targetHi !== null && (
        <rect
          x={Math.max(0, toX(targetLo))}
          y={0}
          width={Math.min(w, toX(targetHi)) - Math.max(0, toX(targetLo))}
          height={h}
          fill="var(--accent2)" fillOpacity={0.08}
        />
      )}

      {/* Bars */}
      {counts.map((c, i) => {
        if (c === 0) return null;
        const bx = toX(minV + i * bw);
        const bw2 = (w / BINS) * 0.85;
        return (
          <rect key={i}
            x={bx} y={toY(c)}
            width={bw2} height={h - toY(c) - 2}
            fill={barColor(i)} opacity={0.85} rx={1}
          />
        );
      })}

      {/* Target range borders */}
      {targetLo !== null && (
        <line x1={toX(targetLo)} y1={0} x2={toX(targetLo)} y2={h}
          stroke="var(--accent2)" strokeWidth={1} strokeDasharray="3 2" />
      )}
      {targetHi !== null && (
        <line x1={toX(targetHi)} y1={0} x2={toX(targetHi)} y2={h}
          stroke="var(--accent2)" strokeWidth={1} strokeDasharray="3 2" />
      )}

      {/* P10 */}
      <line x1={toX(p10)} y1={4} x2={toX(p10)} y2={h}
        stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" />
      <text x={toX(p10) + 2} y={11}
        style={{ fontSize: 7, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>P10</text>

      {/* P90 */}
      <line x1={toX(p90)} y1={4} x2={toX(p90)} y2={h}
        stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" />
      <text x={toX(p90) - 18} y={11}
        style={{ fontSize: 7, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>P90</text>

      {/* P50 median */}
      <line x1={toX(p50)} y1={0} x2={toX(p50)} y2={h}
        stroke="var(--text-primary)" strokeWidth={1.5} />

      {/* Nominal (design point) */}
      <line x1={toX(nominal)} y1={0} x2={toX(nominal)} y2={h}
        stroke="var(--cyan)" strokeWidth={1.5} strokeDasharray="4 2" />

      {/* Axis labels */}
      <text x={1} y={h - 1}
        style={{ fontSize: 7, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {minV.toFixed(minV < 10 ? 2 : 0)}
      </text>
      <text x={w - 2} y={h - 1} textAnchor="end"
        style={{ fontSize: 7, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {maxV.toFixed(maxV < 10 ? 2 : 0)}
      </text>
    </svg>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KPICard({ stat }: { stat: KPIStats }) {
  const { label, unit, nominal, mean, std, p50, passRate, targetLo, targetHi } = stat;
  const hasTarget = targetLo !== null && !isNaN(passRate);
  const pctPass   = hasTarget ? passRate * 100 : null;
  const passColor = pctPass === null ? 'var(--text-muted)'
    : pctPass >= 90 ? 'var(--accent2)' : pctPass >= 70 ? 'var(--warn)' : 'var(--danger)';

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6,
      background: 'var(--surface)',
      border: `1px solid ${hasTarget && pctPass !== null && pctPass < 70 ? 'var(--danger)44' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{unit}</span>
        <div style={{ flex: 1 }} />
        {pctPass !== null && (
          <span style={{ fontSize: 14, fontWeight: 700, color: passColor, fontFamily: 'monospace' }}>
            {pctPass.toFixed(0)}% pass
          </span>
        )}
      </div>

      <Histogram stat={stat} w={280} h={80} />

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 8, color: 'var(--text-muted)' }}>
        <span>design <span style={{ color: 'var(--cyan)', fontFamily: 'monospace' }}>{nominal.toFixed(nominal < 10 ? 2 : 1)}</span></span>
        <span>mean <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{mean.toFixed(mean < 10 ? 2 : 1)}</span></span>
        <span>σ <span style={{ fontFamily: 'monospace' }}>{std.toFixed(std < 10 ? 2 : 1)}</span></span>
        <span>P50 <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{p50.toFixed(p50 < 10 ? 2 : 1)}</span></span>
        {hasTarget && targetLo !== null && targetHi !== null && (
          <span>target <span style={{ color: 'var(--accent2)', fontFamily: 'monospace' }}>
            {targetLo.toFixed(1)}–{targetHi.toFixed(1)}
          </span></span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 7, color: 'var(--text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width={12} height={4}><line x1={0} y1={2} x2={12} y2={2} stroke="var(--cyan)" strokeWidth={1.5} strokeDasharray="3 2" /></svg>
          design
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width={12} height={4}><line x1={0} y1={2} x2={12} y2={2} stroke="var(--text-primary)" strokeWidth={1.5} /></svg>
          P50
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <svg width={12} height={4}><line x1={0} y1={2} x2={12} y2={2} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" /></svg>
          P10/P90
        </span>
      </div>
    </div>
  );
}

// ── Param row ─────────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  Geometry:   'var(--accent)',
  Suspension: 'var(--cyan)',
  Chain:      'var(--warn)',
};

function ParamRow({ p, onChange }: {
  p: MCParam;
  onChange: (id: string, patch: Partial<MCParam>) => void;
}) {
  return (
    <tr style={{ opacity: p.enabled ? 1 : 0.4 }}>
      <td style={{ padding: '2px 3px' }}>
        <input type="checkbox" checked={p.enabled}
          onChange={e => onChange(p.id, { enabled: e.target.checked })}
          style={{ accentColor: 'var(--accent)', width: 11, height: 11 }} />
      </td>
      <td style={{ padding: '2px 6px', fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {p.label}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 4 }}>
          {p.nominal.toFixed(p.nominal < 10 ? 2 : 1)}{p.unit}
        </span>
      </td>
      <td style={{ padding: '2px 3px' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', marginRight: 2 }}>±</span>
        <input type="number" value={p.tolerance} step={0.1} min={0}
          onChange={e => onChange(p.id, { tolerance: parseFloat(e.target.value) || 0 })}
          style={{ width: 56, fontSize: 9, background: 'var(--surface2)',
            border: '1px solid var(--border)', color: 'var(--text-primary)',
            borderRadius: 3, padding: '1px 3px' }} />
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 2 }}>{p.unit}</span>
      </td>
    </tr>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const SAMPLE_PRESETS = [200, 500, 1000, 2000] as const;
const GROUP_ORDER = ['Geometry', 'Suspension', 'Chain'] as const;

/** Normalise backend KPIStats to the TS KPIStats shape */
function normaliseBackendKPI(b: BackendKPIStats): KPIStats {
  const sorted = [...b.values].sort((a, c) => a - c);
  return {
    id:        b.id,
    label:     b.label,
    unit:      b.unit,
    values:    b.values,
    sorted,
    mean:      b.mean,
    std:       b.std,
    p10:       b.p10,
    p50:       b.p50,
    p90:       b.p90,
    passRate:  b.pass_rate ?? NaN,
    nominal:   b.nominal,
    targetLo:  b.target_lo,
    targetHi:  b.target_hi,
  };
}

export default function MonteCarloPanel() {
  const input         = useStore(s => s.input);
  const targets       = useStore(s => s.targetConfig);
  const backendStatus = useStore(s => s.backendStatus);

  const [params, setParams] = useState<MCParam[]>(() => buildMCParams(input));
  useEffect(() => {
    setParams(prev => buildMCParams(input).map(fresh => {
      const existing = prev.find(p => p.id === fresh.id);
      return existing
        ? { ...fresh, enabled: existing.enabled, tolerance: existing.tolerance }
        : fresh;
    }));
  }, [input]);

  const [nSamples, setNSamples]   = useState<number>(500);
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [usingBackend, setUsingBackend] = useState(false);
  const [result, setResult]       = useState<{ kpis: KPIStats[]; n: number; elapsed: number; overallPassRate: number } | null>(null);
  const stopRef = useRef(false);

  function updateParam(id: string, patch: Partial<MCParam>) {
    setParams(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  async function handleRun() {
    stopRef.current = false;
    setRunning(true); setProgress(0); setResult(null);

    if (backendStatus === 'synced') {
      // ── Backend path: full DAG physics ──
      setUsingBackend(true);
      try {
        const tolerances: Record<string, number> = {};
        for (const p of params) {
          if (p.enabled && p.tolerance > 0) tolerances[p.id] = p.tolerance;
        }
        // Convert TargetConfig to plain dict for JSON serialisation
        const targetsPlain: Record<string, { enabled: boolean; lo: number; hi: number }> = {};
        for (const [k, v] of Object.entries(targets)) {
          targetsPlain[k] = { enabled: v.enabled, lo: v.lo, hi: v.hi };
        }
        const bmc = await runMonteCarloBackend(input, tolerances, nSamples, targetsPlain);
        setResult({
          n:              bmc.n,
          elapsed:        bmc.elapsed_ms,
          overallPassRate:bmc.overall_pass_rate,
          kpis:           bmc.kpis.map(normaliseBackendKPI),
        });
      } catch {
        // Fall back to TS on backend error
        setUsingBackend(false);
        const mc = await runMonteCarlo(
          input, params, targets, nSamples,
          (done, total) => setProgress(done / total),
          stopRef,
        );
        setResult(mc);
      }
    } else {
      // ── TypeScript path: offline fallback ──
      setUsingBackend(false);
      const mc = await runMonteCarlo(
        input, params, targets, nSamples,
        (done, total) => setProgress(done / total),
        stopRef,
      );
      setResult(mc);
    }

    setRunning(false); setProgress(1);
  }

  function handleStop() { stopRef.current = true; }

  const enabledCount = params.filter(p => p.enabled).length;
  const hasTargets   = Object.values(targets).some(t => t.enabled);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: param configurator ── */}
      <div style={{
        width: 360, flexShrink: 0, overflowY: 'auto',
        borderRight: '1px solid var(--border)', padding: '12px 10px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Manufacturing Tolerances
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Set ±tolerance for each parameter. Uniform distribution assumed.
          Samples = one fully-assembled bike with random variation on each param.
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ width: 16 }} />
              <th style={{ textAlign: 'left', padding: '2px 6px', fontSize: 9 }}>Parameter</th>
              <th style={{ textAlign: 'left', padding: '2px 3px', fontSize: 9 }}>Tolerance</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map(group => {
              const gp = params.filter(p => p.group === group);
              return [
                <tr key={`grp-${group}`}>
                  <td colSpan={3} style={{
                    padding: '7px 4px 3px', fontSize: 9, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: 1,
                    color: GROUP_COLORS[group], borderTop: '1px solid var(--border)',
                  }}>
                    {group}
                  </td>
                </tr>,
                ...gp.map(p => <ParamRow key={p.id} p={p} onChange={updateParam} />),
              ];
            })}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setParams(buildMCParams(input))}
            style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Reset tolerances
          </button>
          <button onClick={() => setParams(prev => prev.map(p => ({ ...p, enabled: true })))}
            style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Enable all
          </button>
        </div>

        {/* Sample count */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 8 }}>
            Samples
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {SAMPLE_PRESETS.map(n => (
              <button key={n} onClick={() => setNSamples(n)} style={{
                fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${nSamples === n ? 'var(--accent)' : 'var(--border)'}`,
                background: nSamples === n ? 'var(--accent)22' : 'var(--surface2)',
                color: nSamples === n ? 'var(--accent)' : 'var(--text-muted)',
              }}>
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 5 }}>
            Est. ~{(nSamples * 0.3).toFixed(0)}ms ·{' '}
            {enabledCount} params vary · {nSamples} bikes simulated
          </div>
        </div>

        {/* Run */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {/* Physics engine badge */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{
              fontSize: 8, padding: '2px 7px', borderRadius: 3,
              border: `1px solid ${backendStatus === 'synced' ? 'var(--cyan)44' : 'var(--border)'}`,
              background: backendStatus === 'synced' ? 'var(--cyan)15' : 'var(--surface2)',
              color: backendStatus === 'synced' ? 'var(--cyan)' : 'var(--text-muted)',
            }}>
              {backendStatus === 'synced' ? '⚡ Full DAG physics (Python)' : '⚙ TypeScript engine (offline)'}
            </div>
          </div>
          <button
            onClick={running ? handleStop : handleRun}
            disabled={!running && enabledCount === 0}
            style={{
              width: '100%', fontSize: 11, padding: '8px', borderRadius: 5,
              cursor: 'pointer', fontWeight: 600, border: 'none',
              background: running ? 'var(--danger)' : 'var(--accent)',
              color: '#fff', opacity: (!running && enabledCount === 0) ? 0.4 : 1,
            }}>
            {running ? '■ Stop' : `▶ Run ${nSamples.toLocaleString()} Samples`}
          </button>

          {/* Progress bar */}
          {running && (
            <div style={{ marginTop: 8, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${progress * 100}%`,
                background: 'var(--accent)',
                transition: 'width 0.1s linear',
              }} />
            </div>
          )}
          {running && (
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
              {Math.round(progress * nSamples)} / {nSamples} samples…
            </div>
          )}

          {!hasTargets && (
            <div style={{ marginTop: 8, fontSize: 9, color: 'var(--warn)',
              padding: '5px 8px', background: 'var(--warn)11', borderRadius: 4 }}>
              ⚠ No targets enabled — set targets in the Targets tab to see pass rates
            </div>
          )}
        </div>
      </div>

      {/* ── Right: results ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

        {/* Summary */}
        {result && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {/* Overall pass rate */}
            <div style={{
              padding: '12px 16px', borderRadius: 8, minWidth: 140, textAlign: 'center',
              background: 'var(--surface)', border: `2px solid ${
                result.overallPassRate >= 0.9 ? 'var(--accent2)66'
                : result.overallPassRate >= 0.7 ? 'var(--warn)66' : 'var(--danger)66'}`,
            }}>
              <div style={{
                fontSize: 28, fontWeight: 700, fontFamily: 'monospace',
                color: result.overallPassRate >= 0.9 ? 'var(--accent2)'
                  : result.overallPassRate >= 0.7 ? 'var(--warn)' : 'var(--danger)',
              }}>
                {(result.overallPassRate * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                overall pass rate
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>
                (all targets simultaneously)
              </div>
            </div>

            {/* Stats pills */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Simulated{' '}
                <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {result.n.toLocaleString()}
                </span>{' '}bikes in{' '}
                <span style={{ fontFamily: 'monospace' }}>{result.elapsed.toFixed(0)}ms</span>
                {' '}·{' '}
                <span style={{ color: usingBackend ? 'var(--cyan)' : 'var(--text-muted)' }}>
                  {usingBackend ? '⚡ DAG model' : '⚙ TS engine'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Worst KPI:{' '}
                <span style={{ color: 'var(--danger)', fontFamily: 'monospace' }}>
                  {(() => {
                    const worst = result.kpis
                      .filter(k => !isNaN(k.passRate))
                      .sort((a, b) => a.passRate - b.passRate)[0];
                    return worst ? `${worst.label} (${(worst.passRate * 100).toFixed(0)}%)` : '—';
                  })()}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {enabledCount} parameters varied · uniform ±tolerance
              </div>
            </div>

            {/* Cpk-style interpretation */}
            <div style={{
              marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)',
              padding: '10px 12px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 6, maxWidth: 220, lineHeight: 1.7,
            }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>Interpretation</div>
              <div><span style={{ color: 'var(--accent2)' }}>≥ 90%</span> — production-ready</div>
              <div><span style={{ color: 'var(--warn)' }}>70–90%</span> — tighten tolerances</div>
              <div><span style={{ color: 'var(--danger)' }}>&lt; 70%</span> — redesign or constrain</div>
              <div style={{ marginTop: 4 }}>
                Bars: <span style={{ color: 'var(--accent2)' }}>■</span> in-target{' '}
                <span style={{ color: 'var(--danger)' }}>■</span> out-of-target
              </div>
            </div>
          </div>
        )}

        {/* KPI histogram grid */}
        {result && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 10,
          }}>
            {result.kpis.map(stat => (
              <KPICard key={stat.id} stat={stat} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!result && !running && (
          <div style={{
            flex: 1, height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 14, color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: 40, opacity: 0.25 }}>🎲</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Monte Carlo Tolerance Analysis
            </div>
            <div style={{ fontSize: 10, textAlign: 'center', maxWidth: 400, lineHeight: 1.8 }}>
              Set manufacturing tolerances on the left, then run.<br/>
              Each sample = one bike with randomly varied parameters.<br/>
              Histograms show the KPI distribution across the whole production spread.
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 9 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontFamily: 'monospace', color: 'var(--accent2)' }}>N</div>
                <div>samples</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontFamily: 'monospace', color: 'var(--cyan)' }}>P10–P90</div>
                <div>percentile band</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontFamily: 'monospace', color: 'var(--warn)' }}>σ</div>
                <div>std deviation</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
