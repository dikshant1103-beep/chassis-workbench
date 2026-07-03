/**
 * LoadCasesPanel.tsx — Structural Load-Case Generator (full-width tab)
 *
 * Layer A (analytical, instant): rigid-body free-body load cases at every chassis
 * attachment point, bounded by the bike's real limits. Exports a CAE spec sheet
 * (CSV/JSON) — the deliverable handed to the ANSYS/SolidWorks team.
 *
 * Layer B (Gazebo high-fidelity): "Run high-fidelity" triggers a headless ROS 2 /
 * Gazebo job (backend) that measures real interface loads; results overlay with a
 * three-way agreement badge. Wired in M3 — button reflects backend availability.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  STANDARD_LOAD_CASES, computeLoadCases, governingCases,
  type LoadCaseDef, type LoadCaseInputs, type LoadCaseResult,
} from '../../engine/structural/loadCases';
import { triggerDownload, loadCaseSpecToCSV, loadCaseSpecToJSON } from '../../utils/exportUtils';
import { gazeboRunToCompletion, type GazeboResult } from '../../api/gazeboClient';

const ATTACH_ORDER = [
  'frontAxle', 'steeringHead', 'rearAxle', 'swingarmPivot',
  'shockMount', 'engineMount', 'footpeg', 'subframe', 'chain',
];

/** Sum the mass of components whose label contains any of the keywords. */
function massByLabel(components: { mass: number; label: string }[], ...keys: string[]): number {
  return components
    .filter(c => keys.some(k => c.label.toLowerCase().includes(k)))
    .reduce((s, c) => s + c.mass, 0);
}

export default function LoadCasesPanel() {
  const input    = useStore(s => s.input);
  const results  = useStore(s => s.results);
  const family   = useStore(s => s.familyName);

  const [cases, setCases]   = useState<LoadCaseDef[]>(STANDARD_LOAD_CASES);
  const [sf, setSf]         = useState(1.5);
  const [applySf, setApplySf] = useState(true);
  const [mu, setMu]         = useState(1.1);
  const [gz, setGz]         = useState<GazeboResult | null>(null);
  const [gzState, setGzState] = useState<string | null>(null);

  const lcInputs: LoadCaseInputs = useMemo(() => {
    const g = input.geometry;
    const comps = input.massComponents;
    const forkLever = g.forkLength > 0 ? g.forkLength : 700; // Foale 600–800
    return {
      totalMass: results.cog.totalMass,
      R_front0: results.cog.R_front,
      R_rear0:  results.cog.R_rear,
      Y_cg: results.cog.Y_cg,
      X_cg: results.cog.X_cg,
      wheelbase: g.wheelbase,
      trail: results.geometry.trail,
      headAngleDeg: g.headAngle,
      forkOffset: g.forkOffset,
      forkLeverMm: forkLever,
      rearWheelDia: g.rearWheelDia,
      rearSprocket: input.chain.rearSprocket,
      chainAngleDeg: results.antiSquat.chainForceAngleAuto,
      swingarmAngleDeg: results.geometry.swingarmAngleDeg,
      swingarmLengthMm: g.swingarmLength,
      isCVT: results.antiSquat.isCVT,
      mu,
      brakeFrontShare: 0.85,
      shockLeverRatio: 1.3,
      engineMass: massByLabel(comps, 'engine'),
      riderMass:  massByLabel(comps, 'rider'),
      pillionLuggageMass: massByLabel(comps, 'pillion', 'luggage', 'passenger'),
    };
  }, [input, results, mu]);

  const env: LoadCaseResult[] = useMemo(
    () => computeLoadCases(lcInputs, cases, applySf ? sf : 1.0),
    [lcInputs, cases, sf, applySf],
  );
  const gov = useMemo(() => governingCases(env), [env]);

  function editCase(idx: number, field: keyof LoadCaseDef, val: number) {
    setCases(prev => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c));
  }

  const meta = {
    project: 'Chassis Workbench — Load-Case Spec',
    family,
    safetyFactor: applySf ? String(sf) : '1.0 (unfactored)',
    mu: String(mu),
  };

  function exportCSV() {
    triggerDownload(loadCaseSpecToCSV(env, meta), `loadcases_${family.replace(/\W+/g, '_')}.csv`, 'text/csv');
  }
  function exportJSON() {
    triggerDownload(loadCaseSpecToJSON(env, meta), `loadcases_${family.replace(/\W+/g, '_')}.json`, 'application/json');
  }

  async function runGazebo() {
    const g = input.geometry;
    setGz(null); setGzState('starting');
    const bikeParams = {
      total_mass: results.cog.totalMass,
      wheelbase_mm: g.wheelbase, rake_deg: g.headAngle,
      front_wheel_dia_mm: g.frontWheelDia, rear_wheel_dia_mm: g.rearWheelDia,
      swingarm_length_mm: g.swingarmLength, swingarm_pivot_height_mm: g.swingarmPivotHeight,
      swingarm_pivot_x_mm: g.swingarmPivotX, cg_height_mm: results.cog.Y_cg, cg_x_mm: results.cog.X_cg, mu,
    };
    try {
      const r = await gazeboRunToCompletion(
        { mode: 'rig', world: 'flat', params: bikeParams },
        (s, e) => setGzState(`${s} (${e}s)`),
      );
      setGz(r);
      setGzState(r.ok ? 'done' : (r.error || 'error'));
    } catch (e) {
      setGzState(`backend unreachable — ${(e as Error).message}`);
    }
  }

  // analytical static reactions at the two measured joints (R0 calibration reference)
  const analyticalStatic = useMemo(() => {
    const s = env.find(r => r.def.id === 'static1up');
    const sh = s?.attachments.find(a => a.id === 'steeringHead')?.Fz ?? 0;
    const sp = s?.attachments.find(a => a.id === 'swingarmPivot')?.Fz ?? 0;
    return { steeringHead: Math.abs(sh), swingarmPivot: Math.abs(sp) };
  }, [env]);

  const agreement = (att: 'steeringHead' | 'swingarmPivot'): number | null => {
    const gzFz = gz?.cases?.static1up?.[att]?.Fz_N;
    const an = analyticalStatic[att];
    if (!gzFz || !an || an < 1) return null;
    return 100 * (1 - Math.abs(gzFz - an) / an);
  };

  const cellBg = (val: number, max: number, governing: boolean) => {
    if (governing) return 'var(--danger)28';
    if (max < 1) return 'transparent';
    const f = val / max;
    if (f > 0.66) return 'var(--warn)20';
    if (f > 0.33) return 'var(--accent2)12';
    return 'transparent';
  };

  // per-attachment column max for color scaling
  const colMax: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id of ATTACH_ORDER) m[id] = Math.max(...env.map(r => r.attachments.find(a => a.id === id)?.resultantF ?? 0), 1);
    return m;
  }, [env]);

  const labelFor = (id: string) => env[0]?.attachments.find(a => a.id === id)?.label ?? id;

  return (
    <div className="panel-body" style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Structural Load-Case Generator</h2>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', maxWidth: 620 }}>
            Interface loads at every chassis attachment point, as FEM boundary conditions. Every case is
            clamped to the bike's physical limits (friction circle, stoppie/wheelie). Forces N, moments N·m.
            Export the spec for your CAE pipeline.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>μ
            <input type="number" value={mu} step={0.05} min={0.3} max={1.5}
              onChange={e => setMu(parseFloat(e.target.value) || 1.1)}
              style={inStyle} />
          </label>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>SF
            <input type="number" value={sf} step={0.1} min={1} max={3}
              onChange={e => setSf(parseFloat(e.target.value) || 1.5)}
              style={inStyle} />
          </label>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={applySf} onChange={e => setApplySf(e.target.checked)} /> apply SF
          </label>
          <button onClick={exportCSV} style={btnStyle}>⭳ CSV</button>
          <button onClick={exportJSON} style={btnStyle}>⭳ JSON</button>
          <button onClick={runGazebo} title="Headless ROS 2 / Gazebo rig run — measured FT loads"
            disabled={!!gzState && gzState !== 'done' && !gzState.includes('error') && !gzState.includes('unreachable')}
            style={{ ...btnStyle, borderColor: 'var(--cyan)' }}>⚙ Run high-fidelity (Gazebo)</button>
        </div>
      </div>

      {/* Results matrix: rows = load cases, cols = attachment points (resultant N) */}
      <div style={{ marginTop: 14, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={thLeft}>Load Case</th>
              <th style={thMini}>aₓ g</th>
              <th style={thMini}>a_y g</th>
              <th style={thMini}>DAF</th>
              <th style={thMini}>feas.</th>
              {ATTACH_ORDER.map(id => (
                <th key={id} style={thNum} title={labelFor(id)}>{labelFor(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {env.map((r, idx) => (
              <tr key={r.def.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 6px' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 5,
                    background: r.def.color.startsWith('var') ? undefined : r.def.color,
                    backgroundColor: r.def.color.startsWith('var') ? r.def.color : undefined }} />
                  <span style={{ color: 'var(--text-primary)' }}>{r.def.label}</span>
                </td>
                <td style={tdMini}><input type="number" value={r.def.axG} step={0.1} min={-2} max={2}
                  onChange={e => editCase(idx, 'axG', parseFloat(e.target.value) || 0)} style={cellInput} /></td>
                <td style={tdMini}><input type="number" value={r.def.ayG} step={0.1} min={0} max={1.5}
                  onChange={e => editCase(idx, 'ayG', parseFloat(e.target.value) || 0)} style={cellInput} /></td>
                <td style={tdMini}><input type="number" value={r.def.daf} step={0.5} min={1} max={5}
                  onChange={e => editCase(idx, 'daf', parseFloat(e.target.value) || 1)} style={cellInput} /></td>
                <td style={{ ...tdMini, color: r.feasible ? 'var(--accent)' : 'var(--warn)' }}
                  title={r.limitedBy ?? 'within limits'}>{r.feasible ? '✓' : '⚠'}</td>
                {ATTACH_ORDER.map(id => {
                  const a = r.attachments.find(x => x.id === id);
                  const val = a?.resultantF ?? 0;
                  const governing = gov[id]?.caseId === r.def.id && val > 1;
                  return (
                    <td key={id} style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace',
                      background: cellBg(val, colMax[id], governing),
                      color: governing ? 'var(--danger)' : 'var(--text-primary)',
                      fontWeight: governing ? 700 : 400 }}
                      title={a?.note ? `${a.note}${a.moment ? ` | M=${a.moment.toFixed(0)} N·m` : ''}` : (a?.moment ? `M=${a.moment.toFixed(0)} N·m` : '')}>
                      {val >= 1 ? val.toFixed(0) : '—'}
                      {a?.confidence === 'estimated' && <span style={{ color: 'var(--warn)', fontSize: 8 }}>*</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gazebo Layer-B overlay (high-fidelity measured loads) */}
      {gzState && (
        <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--cyan)', borderRadius: 6, background: 'var(--surface)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cyan)' }}>
            ⚙ Gazebo high-fidelity (rig) — provenance: {gz?.provenance ?? 'analytical'} · status: {gzState}
          </div>
          {!gz && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Spawning Gazebo + ROS 2, applying load wrenches, reading FT sensors… (needs the gazebo_lab package built &amp; backend running)
          </div>}
          {gz && !gz.ok && <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 4 }}>{gz.error}</div>}
          {gz && gz.ok && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
                {(['steeringHead', 'swingarmPivot'] as const).map(att => {
                  const ag = agreement(att);
                  const gzFz = gz.cases?.static1up?.[att]?.Fz_N;
                  return (
                    <div key={att} style={{ fontSize: 10, padding: '6px 10px', borderRadius: 5,
                      background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                      <div style={{ color: 'var(--text-muted)' }}>{att} (static)</div>
                      <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                        Gazebo {gzFz?.toFixed(0) ?? '—'} N · analytical {analyticalStatic[att].toFixed(0)} N
                      </div>
                      {ag !== null && (
                        <div style={{ color: ag > 90 ? 'var(--accent)' : ag > 75 ? 'var(--warn)' : 'var(--danger)', fontWeight: 700 }}>
                          three-way agreement {ag.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {gz.measured_daf && Object.keys(gz.measured_daf).length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  <b style={{ color: 'var(--cyan)' }}>Measured DAF</b> (replaces estimated): {Object.entries(gz.measured_daf).map(([c, m]) =>
                    `${c} ${Object.values(m).map(v => v.toFixed(1)).join('/')}×`).join('  ·  ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><b style={{ color: 'var(--danger)' }}>bold</b> = governing case for that member</span>
        <span><span style={{ color: 'var(--warn)' }}>*</span> = estimated (assumed lever/mass; see tooltip)</span>
        <span>Hover a cell for moment + provenance notes</span>
        <span>Provenance: <b>analytical</b> (Gazebo overlay in M3)</span>
      </div>
    </div>
  );
}

const inStyle: React.CSSProperties = { width: 46, marginLeft: 4, fontSize: 10, padding: '2px 4px',
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3 };
const btnStyle: React.CSSProperties = { fontSize: 10, padding: '4px 8px', background: 'var(--surface2)',
  border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, cursor: 'pointer' };
const cellInput: React.CSSProperties = { width: 42, fontSize: 9, padding: '1px 2px', textAlign: 'center',
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3 };
const thLeft: React.CSSProperties = { textAlign: 'left', padding: '5px 6px', color: 'var(--text-muted)', fontWeight: 600 };
const thMini: React.CSSProperties = { textAlign: 'center', padding: '5px 3px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 9 };
const thNum: React.CSSProperties = { textAlign: 'right', padding: '5px 6px', color: 'var(--text-muted)', fontWeight: 600,
  fontSize: 9, whiteSpace: 'nowrap', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' };
const tdMini: React.CSSProperties = { textAlign: 'center', padding: '2px 3px' };
