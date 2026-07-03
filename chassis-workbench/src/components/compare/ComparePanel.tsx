import { useState } from 'react';
import { FAMILIES } from '../../data/families';
import { computeAll } from '../../engine/computeAll';
import { ComputeAllResult } from '../../engine/types';
import { useStore } from '../../store/useStore';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const COLOR_A = '#1f6feb';
const COLOR_B = '#f78166';

function safeCompute(input: any): ComputeAllResult | null {
  try { return computeAll(input); } catch { return null; }
}

// ── Status helpers ──────────────────────────────────────────────────────────
function trailSt(t: number)  { return t >= 80 && t <= 120 ? 'ok' : t >= 60 && t <= 150 ? 'warn' : 'bad'; }
function freqSt(f: number)   { return f >= 0.9 && f <= 1.4 ? 'ok' : f >= 0.7 && f <= 1.8 ? 'warn' : 'bad'; }
function asSt(v: number)     { return v >= 60 && v <= 120  ? 'ok' : v >= 30 && v <= 140  ? 'warn' : 'bad'; }
function frontSt(v: number)  { return v >= 48 && v <= 55   ? 'ok' : 'warn'; }

// ── Radar score normalisation ───────────────────────────────────────────────
function radarScores(r: ComputeAllResult) {
  const trail   = r.geometry.trail;
  const trailScore = trail >= 80 && trail <= 120
    ? 100 - Math.abs(trail - 100) / 20 * 40
    : trail >= 60 && trail <= 150
      ? 50 - Math.abs(trail - 100) / 50 * 30
      : 20;

  const nf = r.suspension.natFreqFront;
  const comfortScore = nf >= 0.9 && nf <= 1.2
    ? 100 : nf >= 0.7 && nf <= 1.5
    ? 70 : 40;

  const as = r.antiSquat.antiSquatPercent;
  const tractionScore = as >= 65 && as <= 110
    ? 100 : as >= 40 && as <= 140
    ? 60 : 30;

  const fp = r.cog.frontPercent;
  const balanceScore = fp >= 46 && fp <= 54
    ? 100 : fp >= 40 && fp <= 60
    ? 70 : 40;

  const knee = r.ergonomics.kneeAngleDeg;
  const ergoScore = knee >= 105 && knee <= 145
    ? 100 : knee >= 90 && knee <= 160
    ? 65 : 35;

  const sf = 4; // FEM removed — use neutral score
  const integrityScore = sf >= 5 ? 100 : sf >= 3 ? 80 : sf >= 2 ? 55 : 30;

  return {
    Stability:   Math.round(trailScore),
    Comfort:     Math.round(comfortScore),
    Traction:    Math.round(tractionScore),
    Balance:     Math.round(balanceScore),
    Ergonomics:  Math.round(ergoScore),
    Integrity:   Math.round(integrityScore),
  };
}

// ── Delta badge ─────────────────────────────────────────────────────────────
function DeltaBadge({ a, b, goodDir = '', unit = '', dec = 1 }: {
  a: number; b: number; goodDir?: 'up' | 'down' | ''; unit?: string; dec?: number;
}) {
  const diff = b - a;
  if (Math.abs(diff) < 0.005) return <span className="cmp-delta-badge neutral">—</span>;
  const up = diff > 0;
  const arrow = up ? '▲' : '▼';
  const good = goodDir ? (up ? goodDir === 'up' : goodDir === 'down') : null;
  const cls = good === null ? 'neutral' : good ? 'good' : 'bad-delta';
  return (
    <span className={`cmp-delta-badge ${cls}`}>
      {arrow} {Math.abs(diff).toFixed(dec)}{unit}
    </span>
  );
}

// ── Horizontal double bar ────────────────────────────────────────────────────
function DualBar({ label, a, b, lo, hi, unit = '', goodDir = '', dec = 1 }: {
  label: string; a: number; b: number;
  lo: number; hi: number; unit?: string;
  goodDir?: 'up' | 'down' | ''; dec?: number;
}) {
  const range = hi - lo || 1;
  const pctA = Math.max(0, Math.min(100, ((a - lo) / range) * 100));
  const pctB = Math.max(0, Math.min(100, ((b - lo) / range) * 100));
  return (
    <div className="dual-bar-row">
      <div className="dual-bar-label">{label}</div>
      <div className="dual-bar-track">
        <div className="dual-bar-a" style={{ width: `${pctA}%` }} title={`A: ${a.toFixed(dec)}${unit}`} />
      </div>
      <div className="dual-bar-track">
        <div className="dual-bar-b" style={{ width: `${pctB}%` }} title={`B: ${b.toFixed(dec)}${unit}`} />
      </div>
      <div className="dual-bar-vals">
        <span style={{ color: COLOR_A }}>{a.toFixed(dec)}</span>
        <DeltaBadge a={a} b={b} goodDir={goodDir} unit={unit} dec={dec} />
        <span style={{ color: COLOR_B }}>{b.toFixed(dec)}</span>
        <span className="dual-bar-unit">{unit}</span>
      </div>
    </div>
  );
}

// ── Group bar chart ──────────────────────────────────────────────────────────
function GroupChart({ title, data }: {
  title: string;
  data: { name: string; A: number; B: number; unit?: string }[];
}) {
  return (
    <div className="cmp-chart-card">
      <div className="cmp-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(90, data.length * 30 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, left: 20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text2)', fontSize: 10 }} width={82} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
            formatter={(val: any) => [`${Number(val).toFixed(2)}`]}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: 'var(--muted)' }} />
          <Bar dataKey="A" fill={COLOR_A} radius={[0, 3, 3, 0]} maxBarSize={12} />
          <Bar dataKey="B" fill={COLOR_B} radius={[0, 3, 3, 0]} maxBarSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Score card ───────────────────────────────────────────────────────────────
function ScoreCard({ label, scoreA, scoreB }: { label: string; scoreA: number; scoreB: number }) {
  const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null;
  return (
    <div className="cmp-score-card">
      <div className="cmp-score-label">{label}</div>
      <div className="cmp-score-bars">
        <div className="cmp-score-bar-row">
          <span className="cmp-score-bike" style={{ color: COLOR_A }}>A</span>
          <div className="cmp-score-track">
            <div style={{ width: `${scoreA}%`, height: '100%', background: COLOR_A, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
          <span className="cmp-score-num" style={{ color: COLOR_A }}>{scoreA}</span>
        </div>
        <div className="cmp-score-bar-row">
          <span className="cmp-score-bike" style={{ color: COLOR_B }}>B</span>
          <div className="cmp-score-track">
            <div style={{ width: `${scoreB}%`, height: '100%', background: COLOR_B, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
          <span className="cmp-score-num" style={{ color: COLOR_B }}>{scoreB}</span>
        </div>
      </div>
      {winner && (
        <div className="cmp-score-winner" style={{ color: winner === 'A' ? COLOR_A : COLOR_B }}>
          Bike {winner} wins
        </div>
      )}
    </div>
  );
}

// ── Custom Bikes Compare ──────────────────────────────────────────────────────

const COLORS_MULTI = ['#1f6feb', '#f78166', '#3fb950', '#d29922', '#a371f7', '#79c0ff'];

function CustomBikesCompare() {
  const customBikes = useStore(s => s.customBikes);
  const loadCustomBike = useStore(s => s.loadCustomBike);
  const removeCustomBike = useStore(s => s.removeCustomBike);

  const [leftId, setLeftId]   = useState<string>(customBikes[0]?.id ?? '');
  const [rightId, setRightId] = useState<string>(customBikes[1]?.id ?? customBikes[0]?.id ?? '');
  const [showTable, setShowTable] = useState(false);

  if (customBikes.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
        <div style={{ fontSize: 14, marginBottom: 6 }}>No custom bikes yet.</div>
        <div style={{ fontSize: 11 }}>
          Use the family dropdown → "+ New Custom Bike…" to create one,<br />
          then customise parameters on the input tabs and click "Update Custom".
        </div>
      </div>
    );
  }

  const leftBike  = customBikes.find(b => b.id === leftId)  ?? customBikes[0];
  const rightBike = customBikes.find(b => b.id === rightId) ?? customBikes[Math.min(1, customBikes.length - 1)];

  const aResults = safeCompute(leftBike.input);
  const bResults = safeCompute(rightBike.input);

  if (!aResults || !bResults) return <div style={{ color: 'var(--danger)', padding: 16 }}>Compute error.</div>;

  const a = aResults;
  const b = bResults;
  const scA = radarScores(a);
  const scB = radarScores(b);
  const totalA = Math.round(Object.values(scA).reduce((s, v) => s + v, 0) / 6);
  const totalB = Math.round(Object.values(scB).reduce((s, v) => s + v, 0) / 6);
  const radarData = Object.keys(scA).map(k => ({
    subject: k,
    A: scA[k as keyof typeof scA],
    B: scB[k as keyof typeof scB],
    fullMark: 100,
  }));

  const BikeSelector = ({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) => (
    <select
      className="cmp-family-select"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {customBikes.filter(b => b.id !== exclude).map(b => (
        <option key={b.id} value={b.id}>{b.name}{b.description ? ` — ${b.description}` : ''}</option>
      ))}
    </select>
  );

  return (
    <div className="cmp-layout">
      {/* Header */}
      <div className="cmp-header">
        <div className="cmp-bike-block cmp-bike-a">
          <span className="cmp-badge-big" style={{ background: COLOR_A }}>A</span>
          <div style={{ flex: 1 }}>
            <BikeSelector value={leftId} onChange={setLeftId} exclude={rightId} />
            <div className="cmp-bike-sub">Custom bike</div>
          </div>
          <div className="cmp-total-score" style={{ color: COLOR_A }}>{totalA}<span style={{ fontSize: 12, fontWeight: 400 }}>/100</span></div>
        </div>
        <div className="cmp-vs-block"><span className="cmp-vs-text">VS</span></div>
        <div className="cmp-bike-block cmp-bike-b">
          <span className="cmp-badge-big" style={{ background: COLOR_B }}>B</span>
          <div style={{ flex: 1 }}>
            <BikeSelector value={rightId} onChange={setRightId} exclude={leftId} />
            <div className="cmp-bike-sub">Custom bike</div>
          </div>
          <div className="cmp-total-score" style={{ color: COLOR_B }}>{totalB}<span style={{ fontSize: 12, fontWeight: 400 }}>/100</span></div>
        </div>
      </div>

      {/* Multi-bike overview strip */}
      {customBikes.length > 2 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            All Custom Bikes — Score Overview
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {customBikes.map((bike, i) => {
              const r = safeCompute(bike.input);
              if (!r) return null;
              const sc = radarScores(r);
              const total = Math.round(Object.values(sc).reduce((s, v) => s + v, 0) / 6);
              const color = COLORS_MULTI[i % COLORS_MULTI.length];
              return (
                <div
                  key={bike.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                    background: 'var(--bg)', border: `1px solid ${color}`, borderRadius: 20,
                    cursor: 'pointer', fontSize: 11,
                  }}
                  onClick={() => { setLeftId(bike.id); }}
                  title="Click to set as Bike A"
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                  <span style={{ color: 'var(--text)' }}>{bike.name}</span>
                  <span style={{ color, fontWeight: 700 }}>{total}</span>
                  <button
                    onClick={e => { e.stopPropagation(); loadCustomBike(bike.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer', padding: 0 }}
                    title="Load into workbench"
                  >Load</button>
                  <button
                    onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${bike.name}"?`)) removeCustomBike(bike.id); }}
                    style={{ background: 'none', border: 'none', color: '#f85149', fontSize: 9, cursor: 'pointer', padding: 0 }}
                  >✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="cmp-body">
        <div className="cmp-left-col">
          <div className="cmp-card">
            <div className="cmp-card-title">Performance Profile</div>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
                <Radar name={leftBike.name} dataKey="A" stroke={COLOR_A} fill={COLOR_A} fillOpacity={0.15} strokeWidth={2} />
                <Radar name={rightBike.name} dataKey="B" stroke={COLOR_B} fill={COLOR_B} fillOpacity={0.12} strokeWidth={2} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text2)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="cmp-score-grid">
            {Object.keys(scA).map(k => (
              <ScoreCard key={k} label={k}
                scoreA={scA[k as keyof typeof scA]}
                scoreB={scB[k as keyof typeof scB]} />
            ))}
          </div>
          <GroupChart title="Steering Geometry" data={[
            { name: 'Trail (mm)',  A: a.geometry.trail,            B: b.geometry.trail },
            { name: 'Mech Trail', A: a.geometry.mechanicalTrail,  B: b.geometry.mechanicalTrail },
            { name: 'SA Angle',   A: a.geometry.swingarmAngleDeg, B: b.geometry.swingarmAngleDeg },
          ]} />
          <GroupChart title="Ergonomics" data={[
            { name: 'Knee Angle', A: a.ergonomics.kneeAngleDeg,   B: b.ergonomics.kneeAngleDeg },
            { name: 'Hip Angle',  A: a.ergonomics.hipAngleDeg,    B: b.ergonomics.hipAngleDeg },
            { name: 'Fwd Lean',   A: a.ergonomics.forwardLeanDeg, B: b.ergonomics.forwardLeanDeg },
          ]} />
        </div>
        <div className="cmp-right-col">
          <GroupChart title="Centre of Gravity & Mass" data={[
            { name: 'CoG X (mm)', A: a.cog.X_cg,        B: b.cog.X_cg },
            { name: 'CoG Y (mm)', A: a.cog.Y_cg,        B: b.cog.Y_cg },
            { name: 'Total kg',   A: a.cog.totalMass,   B: b.cog.totalMass },
            { name: 'Front %',    A: a.cog.frontPercent, B: b.cog.frontPercent },
          ]} />
          <GroupChart title="Suspension" data={[
            { name: 'Nat Freq F', A: a.suspension.natFreqFront,    B: b.suspension.natFreqFront },
            { name: 'Nat Freq R', A: a.suspension.natFreqRear,     B: b.suspension.natFreqRear },
            { name: 'WR Front',   A: a.suspension.wheelRateFront,  B: b.suspension.wheelRateFront },
            { name: 'WR Rear',    A: a.suspension.wheelRateRear,   B: b.suspension.wheelRateRear },
          ]} />
          <GroupChart title="Anti-Squat / Chain" data={[
            { name: 'Anti-Squat %', A: a.antiSquat.antiSquatPercent,  B: b.antiSquat.antiSquatPercent },
            { name: 'Anti-Dive %',  A: a.antiSquat.antiDivePercent,   B: b.antiSquat.antiDivePercent },
            { name: 'Gear Ratio',   A: a.antiSquat.gearRatio,         B: b.antiSquat.gearRatio },
          ]} />
          <GroupChart title="Dynamics" data={[
            { name: 'Front % Brake', A: a.dynamics.frontPercentBraking, B: b.dynamics.frontPercentBraking },
            { name: 'Bank Angle',    A: a.dynamics.bankAngleDeg,        B: b.dynamics.bankAngleDeg },
            { name: 'ΔW Brake (N)',  A: a.dynamics.deltaW_brake,        B: b.dynamics.deltaW_brake },
          ]} />
          <div className="cmp-card">
            <div className="cmp-card-title">Key Metrics</div>
            <div className="dual-bar-header">
              <span />
              <span style={{ color: COLOR_A, fontSize: 11, fontWeight: 700 }}>▮ {leftBike.name}</span>
              <span style={{ color: COLOR_B, fontSize: 11, fontWeight: 700 }}>▮ {rightBike.name}</span>
              <span />
            </div>
            <DualBar label="Trail"      a={a.geometry.trail}             b={b.geometry.trail}             lo={60}  hi={150} unit="mm" dec={0} />
            <DualBar label="Front %"    a={a.cog.frontPercent}           b={b.cog.frontPercent}           lo={30}  hi={70}  unit="%" dec={1} />
            <DualBar label="Anti-Squat" a={a.antiSquat.antiSquatPercent} b={b.antiSquat.antiSquatPercent} lo={0}   hi={150} unit="%" dec={0} />
            <DualBar label="Total kg"   a={a.cog.totalMass}              b={b.cog.totalMass}              lo={100} hi={350} unit="kg" goodDir="down" dec={0} />
          </div>
        </div>
      </div>

      <div className="cmp-table-toggle">
        <button className="cmp-toggle-btn" onClick={() => setShowTable(v => !v)}>
          {showTable ? '▲ Hide' : '▼ Show'} detailed diff table
        </button>
      </div>
      {showTable && (
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th style={{ color: COLOR_A }}>{leftBike.name}</th>
                <th>Δ B−A</th>
                <th style={{ color: COLOR_B }}>{rightBike.name}</th>
              </tr>
            </thead>
            <tbody>
              {[
                { group: 'Geometry' },
                { label: 'Trail',       aV: a.geometry.trail,            bV: b.geometry.trail,            u: 'mm', d: 1 },
                { label: 'SA Angle',    aV: a.geometry.swingarmAngleDeg, bV: b.geometry.swingarmAngleDeg, u: '°',  d: 2 },
                { group: 'CoG' },
                { label: 'CoG X',      aV: a.cog.X_cg,        bV: b.cog.X_cg,        u: 'mm', d: 0 },
                { label: 'CoG Y',      aV: a.cog.Y_cg,        bV: b.cog.Y_cg,        u: 'mm', d: 0 },
                { label: 'Front %',    aV: a.cog.frontPercent, bV: b.cog.frontPercent, u: '%',  d: 1 },
                { label: 'Total Mass', aV: a.cog.totalMass,   bV: b.cog.totalMass,   u: 'kg', d: 1 },
                { group: 'Suspension' },
                { label: 'Nat Freq F', aV: a.suspension.natFreqFront,    bV: b.suspension.natFreqFront,    u: 'Hz',   d: 3 },
                { label: 'Nat Freq R', aV: a.suspension.natFreqRear,     bV: b.suspension.natFreqRear,     u: 'Hz',   d: 3 },
                { label: 'WR Front',   aV: a.suspension.wheelRateFront,  bV: b.suspension.wheelRateFront,  u: 'N/mm', d: 2 },
                { label: 'WR Rear',    aV: a.suspension.wheelRateRear,   bV: b.suspension.wheelRateRear,   u: 'N/mm', d: 2 },
                { group: 'Anti-Squat' },
                { label: 'AS %',       aV: a.antiSquat.antiSquatPercent,  bV: b.antiSquat.antiSquatPercent,  u: '%', d: 1 },
                { label: 'Anti-Dive %',aV: a.antiSquat.antiDivePercent,   bV: b.antiSquat.antiDivePercent,   u: '%', d: 1 },
                { group: 'Dynamics' },
                { label: 'Bank Angle', aV: a.dynamics.bankAngleDeg,        bV: b.dynamics.bankAngleDeg,        u: '°', d: 1 },
                { label: 'ΔW Brake',   aV: a.dynamics.deltaW_brake,        bV: b.dynamics.deltaW_brake,        u: 'N', d: 0 },
              ].map((row, i) => {
                if ('group' in row) return <tr key={i} className="cmp-section"><td colSpan={4}>{row.group}</td></tr>;
                const { label, aV, bV, u = '', d = 1 } = row as any;
                return (
                  <tr key={i}>
                    <td className="cmp-label">{label}</td>
                    <td className="cmp-val cmp-val-a">{aV.toFixed(d)}<span className="cmp-unit">{u}</span></td>
                    <td className="cmp-delta"><DeltaBadge a={aV} b={bV} unit={u} dec={d} /></td>
                    <td className="cmp-val cmp-val-b">{bV.toFixed(d)}<span className="cmp-unit">{u}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function ComparePanel() {
  const storeResults    = useStore(s => s.results);
  const storeFamilyName = useStore(s => s.familyName);
  const familyNameDisplay = useStore(s => s.familyNameDisplay);

  const [subTab, setSubTab] = useState<'preset' | 'custom'>('preset');
  const defaultB = FAMILIES.find(f => f.name !== storeFamilyName) ?? FAMILIES[1];
  const [bFamily, setBFamily] = useState(defaultB.name);
  const [showTable, setShowTable] = useState(false);

  const bPreset  = FAMILIES.find(f => f.name === bFamily) ?? defaultB;
  const bResults = safeCompute(bPreset.input);

  const a = storeResults;
  const b = bResults;

  if (!b) return <div style={{ color: 'var(--danger)', padding: 16 }}>Failed to compute Bike B.</div>;

  const scA = radarScores(a);
  const scB = radarScores(b);

  const radarData = Object.keys(scA).map(k => ({
    subject: k,
    A: scA[k as keyof typeof scA],
    B: scB[k as keyof typeof scB],
    fullMark: 100,
  }));

  // Overall score (avg)
  const totalA = Math.round(Object.values(scA).reduce((s, v) => s + v, 0) / 6);
  const totalB = Math.round(Object.values(scB).reduce((s, v) => s + v, 0) / 6);

  const SUB_TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 18px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text-muted)',
    borderRadius: 6,
  });

  return (
    <div className="cmp-layout">

      {/* ── Sub-tab switcher ── */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button style={SUB_TAB_STYLE(subTab === 'preset')} onClick={() => setSubTab('preset')}>
          ⇔ Preset Compare
        </button>
        <button style={SUB_TAB_STYLE(subTab === 'custom')} onClick={() => setSubTab('custom')}>
          ◈ Custom Bikes
        </button>
      </div>

      {subTab === 'custom' && <CustomBikesCompare />}

      {subTab === 'preset' && <>
      {/* ── Header ── */}
      <div className="cmp-header">
        <div className="cmp-bike-block cmp-bike-a">
          <span className="cmp-badge-big" style={{ background: COLOR_A }}>A</span>
          <div>
            <div className="cmp-bike-title">{familyNameDisplay}</div>
            <div className="cmp-bike-sub">Current session — edit on left tabs</div>
          </div>
          <div className="cmp-total-score" style={{ color: COLOR_A }}>{totalA}<span style={{ fontSize: 12, fontWeight: 400 }}>/100</span></div>
        </div>

        <div className="cmp-vs-block">
          <span className="cmp-vs-text">VS</span>
        </div>

        <div className="cmp-bike-block cmp-bike-b">
          <span className="cmp-badge-big" style={{ background: COLOR_B }}>B</span>
          <div style={{ flex: 1 }}>
            <select className="cmp-family-select" value={bFamily} onChange={e => setBFamily(e.target.value)}>
              {FAMILIES.map(f => <option key={f.name} value={f.name}>{f.name} — {f.description}</option>)}
            </select>
            <div className="cmp-bike-sub">Choose any preset</div>
          </div>
          <div className="cmp-total-score" style={{ color: COLOR_B }}>{totalB}<span style={{ fontSize: 12, fontWeight: 400 }}>/100</span></div>
        </div>
      </div>

      <div className="cmp-body">
        {/* ── Left column: Radar + Score cards ── */}
        <div className="cmp-left-col">

          {/* Radar overlay */}
          <div className="cmp-card">
            <div className="cmp-card-title">Performance Profile</div>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
                <Radar name={storeFamilyName} dataKey="A" stroke={COLOR_A} fill={COLOR_A} fillOpacity={0.15} strokeWidth={2} />
                <Radar name={bFamily} dataKey="B" stroke={COLOR_B} fill={COLOR_B} fillOpacity={0.12} strokeWidth={2} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text2)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Score cards grid */}
          <div className="cmp-score-grid">
            {Object.keys(scA).map(k => (
              <ScoreCard key={k} label={k}
                scoreA={scA[k as keyof typeof scA]}
                scoreB={scB[k as keyof typeof scB]} />
            ))}
          </div>

          {/* Geometry bar chart */}
          <GroupChart title="Steering Geometry" data={[
            { name: 'Trail (mm)',   A: a.geometry.trail,              B: b.geometry.trail,              unit: 'mm' },
            { name: 'Mech Trail',  A: a.geometry.mechanicalTrail,    B: b.geometry.mechanicalTrail,    unit: 'mm' },
            { name: 'SA Angle',    A: a.geometry.swingarmAngleDeg,   B: b.geometry.swingarmAngleDeg,   unit: '°' },
          ]} />

          {/* Ergonomics chart */}
          <GroupChart title="Ergonomics" data={[
            { name: 'Knee Angle', A: a.ergonomics.kneeAngleDeg,   B: b.ergonomics.kneeAngleDeg,   unit: '°' },
            { name: 'Hip Angle',  A: a.ergonomics.hipAngleDeg,    B: b.ergonomics.hipAngleDeg,    unit: '°' },
            { name: 'Fwd Lean',   A: a.ergonomics.forwardLeanDeg, B: b.ergonomics.forwardLeanDeg, unit: '°' },
            { name: 'S–H Dist',   A: a.ergonomics.d_SH,           B: b.ergonomics.d_SH,           unit: 'mm' },
          ]} />
        </div>

        {/* ── Right column: Bar comparisons + chart groups ── */}
        <div className="cmp-right-col">

          {/* CoG & Mass */}
          <GroupChart title="Centre of Gravity & Mass" data={[
            { name: 'CoG X (mm)',   A: a.cog.X_cg,        B: b.cog.X_cg,        unit: 'mm' },
            { name: 'CoG Y (mm)',   A: a.cog.Y_cg,        B: b.cog.Y_cg,        unit: 'mm' },
            { name: 'Total kg',     A: a.cog.totalMass,   B: b.cog.totalMass,   unit: 'kg' },
            { name: 'Front %',      A: a.cog.frontPercent, B: b.cog.frontPercent, unit: '%' },
          ]} />

          {/* Suspension */}
          <GroupChart title="Suspension" data={[
            { name: 'Nat Freq F',   A: a.suspension.natFreqFront,    B: b.suspension.natFreqFront,    unit: 'Hz' },
            { name: 'Nat Freq R',   A: a.suspension.natFreqRear,     B: b.suspension.natFreqRear,     unit: 'Hz' },
            { name: 'WR Front',     A: a.suspension.wheelRateFront,  B: b.suspension.wheelRateFront,  unit: 'N/mm' },
            { name: 'WR Rear',      A: a.suspension.wheelRateRear,   B: b.suspension.wheelRateRear,   unit: 'N/mm' },
            { name: 'Sag % F',      A: a.suspension.sagPercentFront, B: b.suspension.sagPercentFront, unit: '%' },
            { name: 'Sag % R',      A: a.suspension.sagPercentRear,  B: b.suspension.sagPercentRear,  unit: '%' },
          ]} />

          {/* Anti-Squat */}
          <GroupChart title="Anti-Squat / Chain" data={[
            { name: 'Anti-Squat %', A: a.antiSquat.antiSquatPercent,  B: b.antiSquat.antiSquatPercent,  unit: '%' },
            { name: 'Chain Contrib',A: a.antiSquat.chainContribution, B: b.antiSquat.chainContribution, unit: '%' },
            { name: 'Anti-Dive %',  A: a.antiSquat.antiDivePercent,   B: b.antiSquat.antiDivePercent,   unit: '%' },
            { name: 'Gear Ratio',   A: a.antiSquat.gearRatio,         B: b.antiSquat.gearRatio,         unit: ':1' },
          ]} />

          {/* Dynamics */}
          <GroupChart title="Dynamics" data={[
            { name: 'Front % Brake', A: a.dynamics.frontPercentBraking, B: b.dynamics.frontPercentBraking, unit: '%' },
            { name: 'Bank Angle',    A: a.dynamics.bankAngleDeg,        B: b.dynamics.bankAngleDeg,        unit: '°' },
            { name: 'ΔW Brake (N)',  A: a.dynamics.deltaW_brake,        B: b.dynamics.deltaW_brake,        unit: 'N' },
            { name: 'ΔW Accel (N)', A: a.dynamics.deltaW_accel,        B: b.dynamics.deltaW_accel,        unit: 'N' },
            { name: 'Lat Force (N)', A: a.dynamics.lateralForce,        B: b.dynamics.lateralForce,        unit: 'N' },
          ]} />

          {/* Metric comparison bars */}
          <div className="cmp-card">
            <div className="cmp-card-title">Key Metrics — Side-by-Side</div>
            <div className="dual-bar-header">
              <span />
              <span style={{ color: COLOR_A, fontSize: 11, fontWeight: 700 }}>▮ Bike A</span>
              <span style={{ color: COLOR_B, fontSize: 11, fontWeight: 700 }}>▮ Bike B</span>
              <span />
            </div>
            <DualBar label="Trail"      a={a.geometry.trail}               b={b.geometry.trail}               lo={60}  hi={150} unit="mm" dec={0} />
            <DualBar label="Front %"    a={a.cog.frontPercent}             b={b.cog.frontPercent}             lo={30}  hi={70}  unit="%" goodDir="up" dec={1} />
            <DualBar label="Nat Freq F" a={a.suspension.natFreqFront}      b={b.suspension.natFreqFront}      lo={0.5} hi={2.5} unit="Hz" dec={2} />
            <DualBar label="Nat Freq R" a={a.suspension.natFreqRear}       b={b.suspension.natFreqRear}       lo={0.8} hi={3.0} unit="Hz" dec={2} />
            <DualBar label="Anti-Squat" a={a.antiSquat.antiSquatPercent}   b={b.antiSquat.antiSquatPercent}   lo={0}   hi={150} unit="%" goodDir="up" dec={0} />
            <DualBar label="Knee°"      a={a.ergonomics.kneeAngleDeg}      b={b.ergonomics.kneeAngleDeg}      lo={80}  hi={170} unit="°" dec={0} />
            <DualBar label="Bank°"      a={a.dynamics.bankAngleDeg}        b={b.dynamics.bankAngleDeg}        lo={10}  hi={58}  unit="°" goodDir="up" dec={0} />
            <DualBar label="Total kg"   a={a.cog.totalMass}                b={b.cog.totalMass}                lo={100} hi={350} unit="kg" goodDir="down" dec={0} />
          </div>
        </div>
      </div>

      {/* ── Collapsible diff table ── */}
      <div className="cmp-table-toggle">
        <button className="cmp-toggle-btn" onClick={() => setShowTable(v => !v)}>
          {showTable ? '▲ Hide' : '▼ Show'} detailed diff table
        </button>
      </div>

      {showTable && (
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th style={{ color: COLOR_A }}>Bike A</th>
                <th>Δ B−A</th>
                <th style={{ color: COLOR_B }}>Bike B</th>
              </tr>
            </thead>
            <tbody>
              {[
                { group: 'Geometry' },
                { label: 'Trail',          aV: a.geometry.trail,               bV: b.geometry.trail,               u: 'mm', d: 1, st: trailSt },
                { label: 'Mech Trail',     aV: a.geometry.mechanicalTrail,     bV: b.geometry.mechanicalTrail,     u: 'mm', d: 1 },
                { label: 'SA Angle',       aV: a.geometry.swingarmAngleDeg,    bV: b.geometry.swingarmAngleDeg,    u: '°',  d: 2 },
                { group: 'CoG' },
                { label: 'CoG X',          aV: a.cog.X_cg,         bV: b.cog.X_cg,         u: 'mm', d: 0 },
                { label: 'CoG Y',          aV: a.cog.Y_cg,         bV: b.cog.Y_cg,         u: 'mm', d: 0 },
                { label: 'Front %',        aV: a.cog.frontPercent,  bV: b.cog.frontPercent,  u: '%',  d: 1, st: frontSt },
                { label: 'Total Mass',     aV: a.cog.totalMass,     bV: b.cog.totalMass,     u: 'kg', d: 1, gd: 'down' as const },
                { group: 'Suspension' },
                { label: 'Nat Freq F',     aV: a.suspension.natFreqFront,    bV: b.suspension.natFreqFront,    u: 'Hz',   d: 3, st: freqSt },
                { label: 'Nat Freq R',     aV: a.suspension.natFreqRear,     bV: b.suspension.natFreqRear,     u: 'Hz',   d: 3, st: freqSt },
                { label: 'WR Front',       aV: a.suspension.wheelRateFront,  bV: b.suspension.wheelRateFront,  u: 'N/mm', d: 2 },
                { label: 'WR Rear',        aV: a.suspension.wheelRateRear,   bV: b.suspension.wheelRateRear,   u: 'N/mm', d: 2 },
                { label: 'Sag% F',         aV: a.suspension.sagPercentFront, bV: b.suspension.sagPercentFront, u: '%',    d: 1 },
                { label: 'Sag% R',         aV: a.suspension.sagPercentRear,  bV: b.suspension.sagPercentRear,  u: '%',    d: 1 },
                { group: 'Anti-Squat' },
                { label: 'Anti-Squat %',   aV: a.antiSquat.antiSquatPercent,  bV: b.antiSquat.antiSquatPercent,  u: '%',  d: 1, st: asSt },
                { label: 'Chain Contrib',  aV: a.antiSquat.chainContribution, bV: b.antiSquat.chainContribution, u: '%',  d: 1 },
                { label: 'Anti-Dive %',    aV: a.antiSquat.antiDivePercent,   bV: b.antiSquat.antiDivePercent,   u: '%',  d: 1 },
                { group: 'Ergonomics' },
                { label: 'Knee Angle',     aV: a.ergonomics.kneeAngleDeg,   bV: b.ergonomics.kneeAngleDeg,   u: '°', d: 1 },
                { label: 'Hip Angle',      aV: a.ergonomics.hipAngleDeg,    bV: b.ergonomics.hipAngleDeg,    u: '°', d: 1 },
                { label: 'Forward Lean',   aV: a.ergonomics.forwardLeanDeg, bV: b.ergonomics.forwardLeanDeg, u: '°', d: 1 },
                { group: 'Dynamics' },
                { label: 'Front% Braking', aV: a.dynamics.frontPercentBraking, bV: b.dynamics.frontPercentBraking, u: '%', d: 1 },
                { label: 'Bank Angle',     aV: a.dynamics.bankAngleDeg,        bV: b.dynamics.bankAngleDeg,        u: '°', d: 1 },
                { label: 'ΔW Brake',       aV: a.dynamics.deltaW_brake,        bV: b.dynamics.deltaW_brake,        u: 'N', d: 0 },
                { label: 'ΔW Accel',       aV: a.dynamics.deltaW_accel,        bV: b.dynamics.deltaW_accel,        u: 'N', d: 0 },
              ].map((row, i) => {
                if ('group' in row) {
                  return <tr key={i} className="cmp-section"><td colSpan={4}>{row.group}</td></tr>;
                }
                const { label, aV, bV, u = '', d = 1, st, gd } = row as any;
                const stA = st ? st(aV) : '';
                const stB = st ? st(bV) : '';
                return (
                  <tr key={i}>
                    <td className="cmp-label">{label}</td>
                    <td className={`cmp-val cmp-val-a ${stA}`}>{aV.toFixed(d)}<span className="cmp-unit">{u}</span></td>
                    <td className="cmp-delta">
                      <DeltaBadge a={aV} b={bV} goodDir={gd ?? ''} unit={u} dec={d} />
                    </td>
                    <td className={`cmp-val cmp-val-b ${stB}`}>{bV.toFixed(d)}<span className="cmp-unit">{u}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </div>
  );
}
