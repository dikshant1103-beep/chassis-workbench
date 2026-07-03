import { useStore } from '../../store/useStore';
import { TargetConfig, TargetRange } from '../../engine/types';

// ── Fitness scoring ──────────────────────────────────────────────────────────

/** Score 0–1. 1.0 inside range, cosine falloff to 0 at 2× outside range width. */
function scoreKPI(value: number, t: TargetRange): number {
  if (!t.enabled) return 1;
  const span = t.hi - t.lo;
  if (value >= t.lo && value <= t.hi) return 1;
  const dist = value < t.lo ? t.lo - value : value - t.hi;
  const decay = span > 0 ? dist / span : dist;   // normalised distance
  return Math.max(0, 0.5 * (1 + Math.cos(Math.PI * Math.min(decay, 1))));
}

function computeFitness(
  scores: { label: string; score: number; enabled: boolean }[],
): number {
  const active = scores.filter(s => s.enabled);
  if (!active.length) return 100;
  return Math.round(active.reduce((sum, s) => sum + s.score, 0) / active.length * 100);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FitnessGauge({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'var(--accent2)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  const r = 54, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  const half = circ / 2;
  const offset = half * (1 - pct / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={128} height={80} viewBox="0 0 128 128" style={{ overflow: 'visible' }}>
        {/* Background arc */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="var(--surface2)" strokeWidth={10}
          strokeDasharray={`${half} ${circ}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform="rotate(180 64 64)"
        />
        {/* Value arc */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={10}
          strokeDasharray={`${half - offset} ${circ}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform="rotate(180 64 64)"
          style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }}
        />
        <text x={64} y={78} textAnchor="middle"
          style={{ fontSize: 28, fontWeight: 700, fill: color, fontFamily: 'monospace' }}>
          {pct}
        </text>
        <text x={64} y={94} textAnchor="middle"
          style={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
          FITNESS %
        </text>
      </svg>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>
        {pct >= 80 ? 'ON TARGET' : pct >= 50 ? 'NEAR TARGET' : 'OFF TARGET'}
      </div>
    </div>
  );
}

interface KpiEntry {
  key: keyof TargetConfig;
  label: string;
  unit: string;
  value: number;
  score: number;
  step: number;
  absMin: number;
  absMax: number;
}

function KpiCard({ entry, t, onChange }: {
  entry: KpiEntry;
  t: TargetRange;
  onChange: (key: keyof TargetConfig, patch: Partial<TargetRange>) => void;
}) {
  const color = !t.enabled ? 'var(--text-muted)'
    : entry.score >= 0.95 ? 'var(--accent2)'
    : entry.score >= 0.5  ? 'var(--warn)'
    : 'var(--danger)';

  const barW = 260;
  const span = entry.absMax - entry.absMin;
  const toPx = (v: number) => Math.max(0, Math.min(barW, (v - entry.absMin) / span * barW));
  const loX   = toPx(t.lo);
  const hiX   = toPx(t.hi);
  const valX  = toPx(entry.value);

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6, border: `1px solid ${t.enabled ? color + '44' : 'var(--border)'}`,
      background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6,
      opacity: t.enabled ? 1 : 0.55,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}>
          <input type="checkbox" checked={t.enabled}
            onChange={e => onChange(entry.key, { enabled: e.target.checked })}
            style={{ accentColor: 'var(--accent)', width: 12, height: 12 }} />
          <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{entry.label}</span>
        </label>
        <span style={{ fontSize: 10, color, fontFamily: 'monospace', fontWeight: 700 }}>
          {entry.value.toFixed(entry.step < 1 ? 2 : 1)} {entry.unit}
        </span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 2,
          background: color + '22', color, border: `1px solid ${color}55`,
        }}>
          {t.enabled ? `${Math.round(entry.score * 100)}%` : '—'}
        </span>
      </div>

      {/* Visual bar */}
      <div style={{ position: 'relative', height: 18 }}>
        {/* Track */}
        <div style={{ position: 'absolute', top: 7, left: 0, right: 0, height: 4,
          background: 'var(--surface2)', borderRadius: 2 }} />
        {/* Target zone */}
        <div style={{ position: 'absolute', top: 6, left: loX, width: hiX - loX, height: 6,
          background: 'var(--accent2)', opacity: 0.25, borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: 5, left: loX, width: hiX - loX, height: 8,
          border: '1px solid var(--accent2)', opacity: 0.5, borderRadius: 2 }} />
        {/* Current value marker */}
        <div style={{
          position: 'absolute', top: 3, left: valX - 4, width: 8, height: 12,
          background: color, borderRadius: 2,
          transition: 'left 0.3s ease, background 0.3s ease',
          boxShadow: `0 0 4px ${color}88`,
        }} />
      </div>

      {/* Lo / Hi range inputs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
        <span style={{ color: 'var(--text-muted)', width: 20 }}>Lo</span>
        <input type="number" value={t.lo} step={entry.step}
          min={entry.absMin} max={t.hi - entry.step}
          onChange={e => onChange(entry.key, { lo: parseFloat(e.target.value) || t.lo })}
          style={{ width: 64, fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 3, padding: '2px 4px' }} />
        <span style={{ color: 'var(--text-muted)', width: 20 }}>Hi</span>
        <input type="number" value={t.hi} step={entry.step}
          min={t.lo + entry.step} max={entry.absMax}
          onChange={e => onChange(entry.key, { hi: parseFloat(e.target.value) || t.hi })}
          style={{ width: 64, fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', borderRadius: 3, padding: '2px 4px' }} />
        <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'right' }}>{entry.unit}</span>
      </div>
    </div>
  );
}

// ── Radar chart (SVG, 12 axes collapsed to enabled ones) ─────────────────────

function RadarChart({ entries, targets }: {
  entries: KpiEntry[];
  targets: TargetConfig;
}) {
  const active = entries.filter(e => targets[e.key].enabled);
  if (active.length < 3) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 200, color: 'var(--text-muted)', fontSize: 11 }}>
        Enable ≥ 3 targets to see radar
      </div>
    );
  }
  const n = active.length;
  const cx = 130, cy = 130, R = 110;
  const step = (2 * Math.PI) / n;
  const angle = (i: number) => -Math.PI / 2 + i * step;
  const pt = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  const valuePath = active.map((e, i) => {
    const t = targets[e.key];
    const span = t.hi - t.lo;
    const norm = span > 0 ? Math.max(0, Math.min(1, (e.value - t.lo + span * 0.5) / (span * 2))) : 0.5;
    const p = pt(i, norm * R);
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ') + 'Z';

  const targetPath = active.map((_, i) => {
    const p = pt(i, R * 0.5);  // centre of target range = 50% = midpoint normalisation
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ') + 'Z';

  return (
    <svg width={260} height={260} viewBox="0 0 260 260">
      {/* Grid rings */}
      {gridLevels.map(frac => (
        <polygon key={frac}
          points={active.map((_, i) => { const p = pt(i, frac * R); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="var(--border)" strokeWidth={frac === 1 ? 1.5 : 0.8} />
      ))}
      {/* Axes */}
      {active.map((_, i) => {
        const p = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y}
          stroke="var(--border)" strokeWidth={0.8} />;
      })}
      {/* Target zone (±half range around centre) */}
      <polygon points={active.map((_, i) => { const p = pt(i, R * 0.75); return `${p.x},${p.y}`; }).join(' ')}
        fill="var(--accent2)" fillOpacity={0.08} stroke="var(--accent2)" strokeWidth={1} strokeDasharray="3,3" />
      <polygon points={active.map((_, i) => { const p = pt(i, R * 0.25); return `${p.x},${p.y}`; }).join(' ')}
        fill="none" stroke="var(--accent2)" strokeWidth={0.5} strokeDasharray="3,3" />
      {/* Target outline */}
      <polygon points={targetPath.replace(/[MLZ]/g, '')}
        fill="var(--accent2)" fillOpacity={0.0} stroke="var(--accent2)" strokeWidth={1} strokeDasharray="4,2" />
      {/* Value polygon */}
      <path d={valuePath} fill="var(--accent)" fillOpacity={0.2}
        stroke="var(--accent)" strokeWidth={1.5} />
      {/* Value dots */}
      {active.map((e, i) => {
        const t = targets[e.key];
        const span = t.hi - t.lo;
        const norm = span > 0 ? Math.max(0, Math.min(1, (e.value - t.lo + span * 0.5) / (span * 2))) : 0.5;
        const p = pt(i, norm * R);
        const col = e.score >= 0.95 ? 'var(--accent2)' : e.score >= 0.5 ? 'var(--warn)' : 'var(--danger)';
        return <circle key={i} cx={p.x} cy={p.y} r={4} fill={col} stroke="var(--bg)" strokeWidth={1.5} />;
      })}
      {/* Labels */}
      {active.map((e, i) => {
        const p = pt(i, R + 16);
        const anchor = p.x < cx - 5 ? 'end' : p.x > cx + 5 ? 'start' : 'middle';
        return (
          <text key={i} x={p.x} y={p.y} textAnchor={anchor}
            style={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {e.label}
          </text>
        );
      })}
    </svg>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function TargetsPanel() {
  const results      = useStore(s => s.results);
  const susp         = useStore(s => s.input.suspension);
  const massComps    = useStore(s => s.input.massComponents);
  const targetConfig = useStore(s => s.targetConfig);
  const setTargetConfig = useStore(s => s.setTargetConfig);

  const { geometry, cog, suspension, antiSquat } = results;

  // Live computed values
  const ratioF = suspension.sprungMassFront / (susp.unsprungFront || 1);
  const ratioR = suspension.sprungMassRear  / (susp.unsprungRear  || 1);

  const rawEntries: Array<Omit<KpiEntry, 'score'>> = [
    { key: 'trail',               label: 'Trail',         unit: 'mm',  value: geometry.trail,                step: 1,    absMin: 30,  absMax: 200 },
    { key: 'frontPercent',        label: 'Front %',       unit: '%',   value: cog.frontPercent,              step: 0.5,  absMin: 25,  absMax: 75  },
    { key: 'antiSquatPercent',    label: 'Anti-Squat',    unit: '%',   value: antiSquat.antiSquatPercent,    step: 5,    absMin: 0,   absMax: 200 },
    { key: 'natFreqFront',        label: 'Freq F',        unit: 'Hz',  value: suspension.natFreqFront,       step: 0.05, absMin: 0.3, absMax: 3.0 },
    { key: 'natFreqRear',         label: 'Freq R',        unit: 'Hz',  value: suspension.natFreqRear,        step: 0.1,  absMin: 0.5, absMax: 6.0 },
    { key: 'sagPercentFront',     label: 'Sag% F',        unit: '%',   value: suspension.sagPercentFront,    step: 1,    absMin: 5,   absMax: 50  },
    { key: 'sagPercentRear',      label: 'Sag% R',        unit: '%',   value: suspension.sagPercentRear,     step: 1,    absMin: 5,   absMax: 50  },
    { key: 'wheelRateFront',      label: 'WR Front',      unit: 'N/mm',value: suspension.wheelRateFront,     step: 0.5,  absMin: 1,   absMax: 40  },
    { key: 'wheelRateRear',       label: 'WR Rear',       unit: 'N/mm',value: suspension.wheelRateRear,      step: 1,    absMin: 5,   absMax: 100 },
    { key: 'cogHeight',           label: 'CoG Height',    unit: 'mm',  value: cog.Y_cg,                      step: 5,    absMin: 300, absMax: 900 },
    { key: 'sprungUnsprungRatioF',label: 'S:U Ratio F',   unit: ':1',  value: ratioF,                        step: 0.5,  absMin: 1,   absMax: 15  },
    { key: 'sprungUnsprungRatioR',label: 'S:U Ratio R',   unit: ':1',  value: ratioR,                        step: 0.5,  absMin: 1,   absMax: 15  },
  ];
  const entries: KpiEntry[] = rawEntries.map(e => ({
    ...e,
    score: scoreKPI(e.value, targetConfig[e.key as keyof TargetConfig]),
  }));

  const fitness = computeFitness(entries.map(e => ({
    label: e.label, score: e.score, enabled: targetConfig[e.key].enabled,
  })));

  function onChange(key: keyof TargetConfig, patch: Partial<TargetRange>) {
    setTargetConfig({ [key]: { ...targetConfig[key], ...patch } });
  }

  // Split into two columns
  const leftEntries  = entries.slice(0, 6);
  const rightEntries = entries.slice(6);

  const enabledCount = entries.filter(e => targetConfig[e.key].enabled).length;
  const hitCount     = entries.filter(e => targetConfig[e.key].enabled && e.score >= 0.95).length;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 0 }}>

      {/* ── Left: target configurator ── */}
      <div style={{ width: 340, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--border)',
        padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 4 }}>
          Target Ranges
        </div>
        {leftEntries.map(e => (
          <KpiCard key={e.key} entry={e} t={targetConfig[e.key]} onChange={onChange} />
        ))}
      </div>

      {/* ── Middle: target configurator (cont.) ── */}
      <div style={{ width: 340, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--border)',
        padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 4 }}>
          &nbsp;
        </div>
        {rightEntries.map(e => (
          <KpiCard key={e.key} entry={e} t={targetConfig[e.key]} onChange={onChange} />
        ))}
      </div>

      {/* ── Right: fitness dashboard ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex',
        flexDirection: 'column', gap: 16 }}>

        {/* Score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24,
          padding: '14px 16px', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <FitnessGauge pct={fitness} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>{hitCount}</span>
              {' / '}{enabledCount} KPIs on target
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 200, lineHeight: 1.6 }}>
              Enable targets on the left and adjust design parameters to drive all KPIs green.
              Fitness = mean score across enabled targets.
            </div>
            {massComps.some(c => c.unsprungSide) && (
              <div style={{ fontSize: 9, color: 'var(--cyan)', marginTop: 2 }}>
                S:U ratios live-linked from Mass tab
              </div>
            )}
          </div>
        </div>

        {/* Per-KPI score bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 4 }}>
            KPI Score Breakdown
          </div>
          {entries.filter(e => targetConfig[e.key as keyof TargetConfig].enabled).map(e => {
            const pct = Math.round(e.score * 100);
            const col = pct >= 95 ? 'var(--accent2)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
            return (
              <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>
                  {e.label}
                </span>
                <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4,
                  position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, left: 0,
                    width: `${pct}%`, background: col, borderRadius: 4,
                    transition: 'width 0.3s ease, background 0.3s ease' }} />
                </div>
                <span style={{ fontSize: 10, color: col, fontFamily: 'monospace', width: 30,
                  textAlign: 'right', flexShrink: 0 }}>
                  {pct}%
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 70,
                  textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>
                  {e.value.toFixed(e.step < 1 ? 2 : 1)} {e.unit}
                </span>
              </div>
            );
          })}
          {enabledCount === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              No targets enabled — check the boxes on the left.
            </div>
          )}
        </div>

        {/* Radar chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
            letterSpacing: 1 }}>
            Design Radar
          </div>
          <div style={{ display: 'flex', justifyContent: 'center',
            background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)',
            padding: 12 }}>
            <RadarChart entries={entries} targets={targetConfig} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Blue polygon = current values normalised within target range ±50% margin.
            Green dashed = target zone boundary.
          </div>
        </div>

      </div>
    </div>
  );
}
