/**
 * StiffnessTargetsPanel.tsx — Frame Stiffness Targets & Benchmarking (full-width tab)
 *
 * Derives the REQUIRED frame stiffness two ways (deflection-budget + frequency-
 * separation) and benchmarks the components that have published data. We set the
 * target; ANSYS achieves it. No solver here — concept lane.
 */
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { computeStiffnessTargets, type StiffnessTargetInputs } from '../../engine/structural/stiffnessTargets';
import { COMPONENT_BENCHMARKS, MODAL_ANCHORS } from '../../data/stiffnessBenchmarks';

function Stat({ label, value, unit, tag, hint }: { label: string; value: string; unit: string; tag?: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', minWidth: 150 }} title={hint}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
        {value} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
      {tag && <div style={{ fontSize: 8, color: tag === 'estimated' ? 'var(--warn)' : 'var(--accent)' }}>{tag}</div>}
    </div>
  );
}

export default function StiffnessTargetsPanel() {
  const results = useStore(s => s.results);
  const family  = useStore(s => s.familyName);

  const [twist, setTwist]   = useState(0.18); // deg
  const [latDefl, setLatDefl] = useState(1.5); // mm
  const [wobble, setWobble] = useState(MODAL_ANCHORS.wobbleHz.typical);
  const [margin, setMargin] = useState(MODAL_ANCHORS.frameModeMarginOverWobble);
  const [mu, setMu]         = useState(1.1);

  const inp: StiffnessTargetInputs = useMemo(() => ({
    totalMass: results.cog.totalMass,
    Y_cg: results.cog.Y_cg,
    R_front0: results.cog.R_front,
    R_rear0: results.cog.R_rear,
    I_roll: results.inertia.I_roll,
    mu,
    allowableTwistDeg: twist,
    allowableLatDeflMm: latDefl,
    wobbleFreqHz: wobble,
    freqMargin: margin,
  }), [results, mu, twist, latDefl, wobble, margin]);

  const t = useMemo(() => computeStiffnessTargets(inp), [inp]);

  // Benchmark chart data (normalized so different units coexist: show value at band-mid 0.5)
  const benchData = COMPONENT_BENCHMARKS.map(b => ({
    name: b.label, min: b.min, max: b.max, mid: (b.min + b.max) / 2,
    unit: b.unit, tag: b.tag, src: b.src,
  }));

  return (
    <div className="panel-body" style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Frame Stiffness Targets &amp; Benchmarking</h2>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', maxWidth: 640 }}>
            We derive the <b>required</b> frame stiffness (we set the target; ANSYS achieves it) — no solver.
            Two independent routes; the conservative max governs. Frame has no public benchmark, so its
            target is tagged <span style={{ color: 'var(--warn)' }}>estimated</span>; components below are benchmarked from published data.
          </p>
        </div>
      </div>

      {/* Tunables */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
        <label>θ twist allow (°)<input type="number" value={twist} step={0.02} min={0.05} max={0.5} onChange={e => setTwist(+e.target.value || 0.18)} style={inStyle} /></label>
        <label>δ lat allow (mm)<input type="number" value={latDefl} step={0.25} min={0.5} max={4} onChange={e => setLatDefl(+e.target.value || 1.5)} style={inStyle} /></label>
        <label>f_wobble (Hz)<input type="number" value={wobble} step={0.5} min={4} max={10} onChange={e => setWobble(+e.target.value || 7)} style={inStyle} /></label>
        <label>freq margin ×<input type="number" value={margin} step={0.1} min={1} max={3} onChange={e => setMargin(+e.target.value || 1.5)} style={inStyle} /></label>
        <label>μ corner<input type="number" value={mu} step={0.05} min={0.5} max={1.5} onChange={e => setMu(+e.target.value || 1.1)} style={inStyle} /></label>
      </div>

      {/* Derived targets */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <Stat label="Torsional — deflection route" value={t.torsionalTarget_deflection_Nm_per_deg.toFixed(0)} unit="Nm/deg" tag="estimated"
          hint={`M=${t.torsionalMoment_Nm.toFixed(0)} N·m / θ=${twist}° (lateral force ${t.corneringLatForce_N.toFixed(0)} N × CoG height)`} />
        <Stat label="Torsional — frequency route" value={t.torsionalTarget_frequency_Nm_per_deg.toFixed(0)} unit="Nm/deg" tag="estimated"
          hint={`I_roll·(2π·f)²,  f_target=${t.frameModeTarget_Hz.toFixed(1)} Hz = ${margin}× wobble`} />
        <Stat label="Torsional — RECOMMENDED" value={t.torsionalTarget_recommended_Nm_per_deg.toFixed(0)} unit="Nm/deg" tag={`governed by ${t.governingRoute}`}
          hint="max(deflection, frequency) — conservative governing target" />
        <Stat label="Lateral steering head" value={t.lateralTarget_N_per_mm.toFixed(0)} unit="N/mm" tag="estimated"
          hint={`lateral force ${t.corneringLatForce_N.toFixed(0)} N / δ=${latDefl} mm`} />
        <Stat label="Frame mode target" value={t.frameModeTarget_Hz.toFixed(1)} unit="Hz"
          hint={`must clear wobble (${wobble} Hz) by ${margin}×`} />
      </div>

      {/* Component benchmarks */}
      <h3 style={{ margin: '18px 0 6px', fontSize: 13, color: 'var(--text-primary)' }}>Component Benchmarks (published)</h3>
      <p style={{ margin: '0 0 8px', fontSize: 10, color: 'var(--text-muted)' }}>
        Bars span the published min–max band per component (mixed units — read the label). Source &amp; data tag on hover.
      </p>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={benchData} layout="vertical" margin={{ left: 60, right: 30, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 8, fill: 'var(--text-muted)' }} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 10 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.name}</div>
                  <div style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{d.min}–{d.max} {d.unit}</div>
                  <div style={{ color: d.tag === 'measured' ? 'var(--accent)' : 'var(--cyan)' }}>{d.tag} · {d.src}</div>
                </div>
              );
            }} />
            <Bar dataKey="max" fill="var(--accent2)" radius={[0, 3, 3, 0]}>
              {benchData.map((d, i) => (
                <Cell key={i} fill={d.tag === 'measured' ? 'var(--accent)' : 'var(--cyan)'} fillOpacity={0.5} />
              ))}
            </Bar>
            <ReferenceLine x={0} stroke="var(--border)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
        Targets for <b>{family}</b>. Routes: deflection-budget (Foale frame-stiffness rationale) +
        frequency-separation (Cossalter Ch.7 wobble). All frame numbers <span style={{ color: 'var(--warn)' }}>estimated</span> — no public frame benchmark exists.
      </div>
    </div>
  );
}

const inStyle: React.CSSProperties = { width: 56, marginLeft: 4, fontSize: 10, padding: '2px 4px',
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3 };
