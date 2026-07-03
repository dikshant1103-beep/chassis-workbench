/**
 * LoadEnvelopePanel.tsx — R6: Structural Load Envelope
 *
 * Computes peak structural forces and moments at 6 chassis joints across 9
 * riding scenarios (static → hard brake → bump → combined trail-brake).
 * Answers: "What load case governs each structural member?"
 *
 * Physics: Foale Ch.10 + standard load-transfer equations.
 * All forces in N, moments in N·m — actionable for tube sizing / FEM setup.
 */
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { useStore } from '../../store/useStore';

// ── Constants ─────────────────────────────────────────────────────────────────
const G           = 9.81;        // m/s²
const DEG         = Math.PI / 180;
const CHAIN_PITCH = 15.875;      // mm — 520/525 chain

// ── Scenario definitions ─────────────────────────────────────────────────────

interface Scenario {
  id: string;
  label: string;
  accelG: number;    // positive = forward accel, negative = braking
  latG: number;      // lateral acceleration (cornering)
  bumpF: number;     // vertical load amplifier (road irregularity)
  color: string;
}

const DEFAULT_SCENARIOS: Scenario[] = [
  { id: 'static',   label: 'Static',            accelG:  0.00, latG: 0.00, bumpF: 1.0, color: 'var(--text-muted)' },
  { id: 'brake04',  label: 'Soft Brake 0.4g',   accelG: -0.40, latG: 0.00, bumpF: 1.0, color: 'var(--cyan)' },
  { id: 'brake10',  label: 'Hard Brake 1.0g',   accelG: -1.00, latG: 0.00, bumpF: 1.0, color: 'var(--accent)' },
  { id: 'brake12',  label: 'Emergency 1.2g',    accelG: -1.20, latG: 0.00, bumpF: 1.0, color: 'var(--danger)' },
  { id: 'accel04',  label: 'Accel 0.4g',        accelG: +0.40, latG: 0.00, bumpF: 1.0, color: 'var(--cyan)' },
  { id: 'accel08',  label: 'Hard Accel 0.8g',   accelG: +0.80, latG: 0.00, bumpF: 1.0, color: 'var(--accent2)' },
  { id: 'corner08', label: 'Corner 0.8g lat',   accelG:  0.00, latG: 0.80, bumpF: 1.0, color: 'var(--purple)' },
  { id: 'trail',    label: 'Trail Brake',        accelG: -0.50, latG: 0.50, bumpF: 1.0, color: 'var(--warn)' },
  { id: 'bump25',   label: 'Road Bump ×2.5',     accelG:  0.00, latG: 0.00, bumpF: 2.5, color: '#e8b44a' },
];

// ── Structural member definitions ────────────────────────────────────────────

interface MemberDef {
  id: string;
  label: string;
  unit: string;
  desc: string;
}

const MEMBERS: MemberDef[] = [
  { id: 'frontAxle',  label: 'Front Axle',  unit: 'N',   desc: 'Resultant vertical + lateral load on front wheel contact' },
  { id: 'rearAxle',   label: 'Rear Axle',   unit: 'N',   desc: 'Vertical load on rear wheel (amplified by bump factor)' },
  { id: 'forkMoment', label: 'Fork Moment', unit: 'N·m', desc: 'Resultant bending moment at fork crown (brake + cornering)' },
  { id: 'headTube',   label: 'Head Tube',   unit: 'N',   desc: 'Axial compression along steering axis (front axle / cos(rake))' },
  { id: 'swaPivot',   label: 'SW Pivot',    unit: 'N',   desc: 'Resultant force at swingarm pivot (vertical + chain pull)' },
  { id: 'chainTen',   label: 'Chain',       unit: 'N',   desc: 'Chain tension during acceleration scenarios' },
];

// ── Load computation ──────────────────────────────────────────────────────────

interface ScenarioLoads {
  scenario: Scenario;
  frontAxle:  number;
  rearAxle:   number;
  forkMoment: number;
  headTube:   number;
  swaPivot:   number;
  chainTen:   number;
  leanDeg:    number;
}

function computeEnvelope(
  totalMass: number,
  R_f0: number,    // N static front
  R_r0: number,    // N static rear
  hCg: number,     // mm CoG height
  wheelbase: number, // mm
  trail: number,   // mm
  headAngle: number, // deg from vertical
  forkOffset: number, // mm
  rearWheelDia: number, // mm
  rearSprocket: number, // teeth
  chainAngleDeg: number, // deg (chainForceAngleAuto)
  swingarmAngleDeg: number, // deg
  isCVT: boolean,
  scenarios: Scenario[],
  safetyFactor: number,
): ScenarioLoads[] {

  const headRad  = headAngle * DEG;
  const cosHead  = Math.cos(headRad);

  const r_wheel    = rearWheelDia / 2;   // mm
  const r_sprocket = (rearSprocket * CHAIN_PITCH) / (2 * Math.PI); // mm
  const chainRatio = r_wheel / r_sprocket; // wheel radius / sprocket radius

  const chainAngRad = isCVT || isNaN(chainAngleDeg)
    ? swingarmAngleDeg * DEG
    : chainAngleDeg * DEG;

  return scenarios.map(sc => {
    const { accelG, latG, bumpF } = sc;

    // Longitudinal weight transfer
    const deltaW = totalMass * Math.abs(accelG) * G * hCg / wheelbase; // N

    let R_f = accelG < 0 ? R_f0 + deltaW : R_f0 - deltaW;
    let R_r = accelG < 0 ? R_r0 - deltaW : R_r0 + deltaW;
    R_f = Math.max(0, R_f);
    R_r = Math.max(0, R_r);

    // Lateral resultant factor (fork sees combined vertical + lateral tyre force)
    const latFactor = Math.sqrt(1 + latG * latG);

    // Front axle structural load (vertical + lateral resultant, with bump)
    const frontAxle = R_f * bumpF * latFactor * safetyFactor;

    // Rear axle structural load (vertical only + bump)
    const rearAxle = R_r * bumpF * safetyFactor;

    // Fork crown bending moment
    const F_brake = R_f * Math.abs(Math.min(accelG, 0)); // braking force at front contact (N)
    const M_brake = F_brake * trail / 1000;               // N·m (trail as lever arm)
    const F_lat   = totalMass * G * latG;                 // lateral force at CoG (N)
    const M_lat   = F_lat * forkOffset / 1000;            // N·m (fork offset as approx lever)
    const forkMoment = Math.sqrt(M_brake * M_brake + M_lat * M_lat) * safetyFactor;

    // Head tube axial force (along steering axis)
    const headTube = (cosHead > 0.01 ? R_f * bumpF * latFactor / cosHead : 0) * safetyFactor;

    // Chain tension (only during acceleration)
    const chainTen = accelG > 0
      ? totalMass * accelG * G * chainRatio * safetyFactor
      : 0;

    // Swingarm pivot resultant
    const F_chain_v = chainTen * Math.sin(chainAngRad);
    const F_chain_h = chainTen * Math.cos(chainAngRad);
    const F_piv_v   = rearAxle + F_chain_v;
    const F_piv_h   = F_chain_h;
    const swaPivot  = Math.sqrt(F_piv_v * F_piv_v + F_piv_h * F_piv_h);

    const leanDeg = Math.atan(latG) / DEG;

    return { scenario: sc, frontAxle, rearAxle, forkMoment, headTube, swaPivot, chainTen, leanDeg };
  });
}

// ── Cell color by fraction of column max ─────────────────────────────────────

function cellColor(val: number, colMax: number): string {
  if (colMax < 0.001) return 'transparent';
  const frac = val / colMax;
  if (frac > 0.8) return 'var(--danger)22';
  if (frac > 0.5) return 'var(--warn)22';
  if (frac > 0.1) return 'var(--accent2)15';
  return 'transparent';
}

function cellTextColor(val: number, colMax: number): string {
  if (colMax < 0.001) return 'var(--text-muted)';
  const frac = val / colMax;
  if (frac > 0.8) return 'var(--danger)';
  if (frac > 0.5) return 'var(--warn)';
  return 'var(--text-primary)';
}

// ── Scenario row editor ───────────────────────────────────────────────────────

function ScenarioRow({
  sc, index, onEdit,
}: {
  sc: Scenario;
  index: number;
  onEdit: (idx: number, field: keyof Scenario, val: number) => void;
}) {
  const numInput = (field: 'accelG' | 'latG' | 'bumpF', val: number, step: number, min: number, max: number) => (
    <input type="number" value={val} step={step} min={min} max={max}
      onChange={e => onEdit(index, field, parseFloat(e.target.value) || 0)}
      style={{ width: 46, fontSize: 9, padding: '1px 3px', background: 'var(--surface2)',
        border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3,
        textAlign: 'center' }} />
  );

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 6px', fontSize: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block', flexShrink: 0,
          background: sc.color.startsWith('var') ? undefined : sc.color,
          backgroundColor: sc.color.startsWith('var') ? sc.color : undefined }} />
        <span style={{ color: 'var(--text-primary)' }}>{sc.label}</span>
      </td>
      <td style={{ padding: '4px 3px', textAlign: 'center' }}>
        {numInput('accelG', sc.accelG, 0.1, -2.0, 2.0)}
      </td>
      <td style={{ padding: '4px 3px', textAlign: 'center' }}>
        {numInput('latG', sc.latG, 0.1, 0.0, 1.5)}
      </td>
      <td style={{ padding: '4px 3px', textAlign: 'center' }}>
        {numInput('bumpF', sc.bumpF, 0.5, 1.0, 5.0)}
      </td>
    </tr>
  );
}

// ── Tooltip formatter ─────────────────────────────────────────────────────────

const BarTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { label: string; value: number; unit: string } }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 5, fontSize: 10 }}>
      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.label}</div>
      <div style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
        {d.value.toFixed(0)} {d.unit}
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

export default function LoadEnvelopePanel() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);

  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
  const [safetyFactor, setSafetyFactor] = useState(1.5);
  const [showFactored, setShowFactored] = useState(true);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  function editScenario(idx: number, field: keyof Scenario, val: number) {
    setScenarios(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  }

  const envelope = useMemo(() => {
    const { cog, geometry, antiSquat } = results;
    const { headAngle, forkOffset, wheelbase, rearWheelDia } = input.geometry;
    const { rearSprocket } = input.chain;
    return computeEnvelope(
      cog.totalMass,
      cog.R_front,
      cog.R_rear,
      cog.Y_cg,
      wheelbase,
      geometry.trail,
      headAngle,
      forkOffset,
      rearWheelDia,
      rearSprocket,
      antiSquat.chainForceAngleAuto,
      geometry.swingarmAngleDeg,
      antiSquat.isCVT,
      scenarios,
      showFactored ? safetyFactor : 1.0,
    );
  }, [input, results, scenarios, safetyFactor, showFactored]);

  // Column maxima for color normalization
  const colMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mem of MEMBERS) {
      m[mem.id] = Math.max(...envelope.map(r => r[mem.id as keyof ScenarioLoads] as number), 0.001);
    }
    return m;
  }, [envelope]);

  // Worst scenario per member
  const worstScenario = useMemo(() => {
    const w: Record<string, string> = {};
    for (const mem of MEMBERS) {
      const best = envelope.reduce((a, b) =>
        (b[mem.id as keyof ScenarioLoads] as number) > (a[mem.id as keyof ScenarioLoads] as number) ? b : a);
      w[mem.id] = best.scenario.label;
    }
    return w;
  }, [envelope]);

  // Bar chart data — peak per member across all scenarios
  const barData = useMemo(() => MEMBERS.map(mem => ({
    label: mem.label,
    unit: mem.unit,
    value: colMax[mem.id],
    id: mem.id,
    fill: colMax[mem.id] > 4000 ? '#f85149' : colMax[mem.id] > 2000 ? '#e8b44a' : '#3fb950',
  })), [colMax]);

  // Per-member scenario breakdown for selected member
  const selectedBarData = useMemo(() => {
    if (!selectedMember) return [];
    return envelope.map(r => ({
      label: r.scenario.label,
      value: r[selectedMember as keyof ScenarioLoads] as number,
      color: r.scenario.color,
    }));
  }, [envelope, selectedMember]);

  const memberUnit = MEMBERS.find(m => m.id === selectedMember)?.unit ?? '';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: scenario configurator ── */}
      <div style={{
        width: 320, flexShrink: 0, borderRight: '1px solid var(--border)',
        overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Riding Scenarios
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Edit g-values per scenario. Bump factor multiplies vertical axle loads (road irregularity).
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', fontSize: 8 }}>
              <th style={{ padding: '2px 6px', textAlign: 'left' }}>Scenario</th>
              <th style={{ padding: '2px 3px', textAlign: 'center' }}>Accel g</th>
              <th style={{ padding: '2px 3px', textAlign: 'center' }}>Lat g</th>
              <th style={{ padding: '2px 3px', textAlign: 'center' }}>Bump×</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((sc, i) => (
              <ScenarioRow key={sc.id} sc={sc} index={i} onEdit={editScenario} />
            ))}
          </tbody>
        </table>

        <button onClick={() => setScenarios(DEFAULT_SCENARIOS)}
          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
            background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Reset to defaults
        </button>

        {/* Safety factor */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Safety Factor
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <input type="range" min={1.0} max={3.0} step={0.1}
              value={safetyFactor}
              onChange={e => setSafetyFactor(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-primary)',
              minWidth: 28, textAlign: 'right' }}>
              {safetyFactor.toFixed(1)}×
            </span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 9, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showFactored}
              onChange={e => setShowFactored(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }} />
            Apply safety factor to loads
          </label>
          <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            1.5× — general structural (ISO 4210)<br />
            2.0× — fatigue-sensitive joints<br />
            2.5× — safety-critical primary structure
          </div>
        </div>

        {/* Legend */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Load Level
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--danger)' }} />
              <span style={{ color: 'var(--text-muted)' }}>&gt; 80% of scenario max — critical</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--warn)' }} />
              <span style={{ color: 'var(--text-muted)' }}>50–80% — elevated</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent2)' }} />
              <span style={{ color: 'var(--text-muted)' }}>&lt; 50% — nominal</span>
            </div>
          </div>
        </div>

        {/* Bike context */}
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 3 }}>Design basis</div>
          Total mass: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {results.cog.totalMass.toFixed(0)} kg</span><br />
          CoG height: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {results.cog.Y_cg.toFixed(0)} mm</span><br />
          Static F/R: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {results.cog.R_front.toFixed(0)} / {results.cog.R_rear.toFixed(0)} N</span><br />
          Trail: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {results.geometry.trail.toFixed(1)} mm</span>
        </div>
      </div>

      {/* ── Right: table + charts ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Load matrix table ── */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Load Matrix{showFactored ? ` (×${safetyFactor.toFixed(1)} safety factor)` : ' (unfactored)'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr>
                  <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--text-muted)',
                    borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
                    Scenario
                  </th>
                  {MEMBERS.map(mem => (
                    <th key={mem.id}
                      onClick={() => setSelectedMember(prev => prev === mem.id ? null : mem.id)}
                      title={mem.desc}
                      style={{
                        padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                        borderBottom: '2px solid var(--border)', cursor: 'pointer',
                        color: selectedMember === mem.id ? 'var(--accent)' : 'var(--text-muted)',
                        borderBottomColor: selectedMember === mem.id ? 'var(--accent)' : 'var(--border)',
                      }}>
                      {mem.label}<br />
                      <span style={{ fontSize: 7, fontWeight: 400 }}>{mem.unit}</span>
                    </th>
                  ))}
                  <th style={{ padding: '5px 8px', textAlign: 'center', color: 'var(--text-muted)',
                    borderBottom: '2px solid var(--border)', fontSize: 7 }}>
                    Lean°
                  </th>
                </tr>
              </thead>
              <tbody>
                {envelope.map((row, ri) => (
                  <tr key={row.scenario.id}
                    style={{ background: ri % 2 ? 'var(--surface2)' : 'transparent' }}>
                    {/* Scenario label */}
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 1,
                        marginRight: 5, background: row.scenario.color,
                        backgroundColor: row.scenario.color }} />
                      <span style={{ color: 'var(--text-primary)' }}>{row.scenario.label}</span>
                    </td>

                    {/* Member loads */}
                    {MEMBERS.map(mem => {
                      const val = row[mem.id as keyof ScenarioLoads] as number;
                      const isMax = Math.abs(val - colMax[mem.id]) < 0.01;
                      return (
                        <td key={mem.id}
                          style={{
                            padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace',
                            background: cellColor(val, colMax[mem.id]),
                            color: cellTextColor(val, colMax[mem.id]),
                            fontWeight: isMax ? 700 : 400,
                            border: isMax ? '1px solid var(--warn)44' : 'none',
                          }}>
                          {val < 1 ? '—' : mem.id === 'forkMoment' ? val.toFixed(1) : val.toFixed(0)}
                        </td>
                      );
                    })}

                    {/* Lean angle */}
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontFamily: 'monospace',
                      color: 'var(--text-muted)', fontSize: 8 }}>
                      {row.leanDeg < 0.5 ? '—' : `${row.leanDeg.toFixed(0)}°`}
                    </td>
                  </tr>
                ))}

                {/* MAX row */}
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                  <td style={{ padding: '5px 8px', fontSize: 9, fontWeight: 700, color: 'var(--warn)' }}>
                    PEAK (design)
                  </td>
                  {MEMBERS.map(mem => (
                    <td key={mem.id}
                      style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace',
                        fontSize: 10, fontWeight: 700, color: 'var(--warn)' }}>
                      {mem.id === 'forkMoment'
                        ? colMax[mem.id].toFixed(1)
                        : colMax[mem.id].toFixed(0)}
                    </td>
                  ))}
                  <td />
                </tr>

                {/* Worst scenario row */}
                <tr style={{ background: 'var(--surface2)' }}>
                  <td style={{ padding: '3px 8px', fontSize: 8, color: 'var(--text-muted)' }}>
                    Governing scenario
                  </td>
                  {MEMBERS.map(mem => (
                    <td key={mem.id}
                      style={{ padding: '3px 8px', textAlign: 'right', fontSize: 8, color: 'var(--text-muted)' }}>
                      {worstScenario[mem.id]}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Peak loads bar chart ── */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Peak Load per Structural Member
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical"
                margin={{ top: 4, right: 60, left: 90, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 8, fill: 'var(--text-muted)' }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={80} />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--border)' }} />
                <ReferenceLine x={0} stroke="var(--border)" />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {barData.map(entry => (
                    <Cell key={entry.id} fill={entry.fill} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 3 }}>
            Red &gt; 4 000 N — Amber 2 000–4 000 N — Green &lt; 2 000 N  ·  Fork Moment in N·m (scale × 10 for display)
          </div>
        </div>

        {/* ── Selected member breakdown ── */}
        {selectedMember && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              {MEMBERS.find(m => m.id === selectedMember)?.label} — Scenario Breakdown
              <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--text-muted)',
                textTransform: 'none', marginLeft: 6 }}>
                ({memberUnit}) · click column header again to dismiss
              </span>
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedBarData} layout="vertical"
                  margin={{ top: 4, right: 60, left: 140, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 8, fill: 'var(--text-muted)' }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={130} />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--border)' }} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {selectedBarData.map((entry, i) => (
                      <Cell key={i} fill={entry.value > colMax[selectedMember] * 0.8 ? '#f85149'
                        : entry.value > colMax[selectedMember] * 0.5 ? '#e8b44a' : '#3fb950'}
                        fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Usage guide ── */}
        <div style={{
          padding: '10px 14px', borderRadius: 6, background: 'var(--surface)',
          border: '1px solid var(--border)', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.8,
        }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>How to use: </span>
          Click any column header to see scenario breakdown for that member.
          Bold values = governing scenario for that member. PEAK row = design load for tube sizing.
          Set safety factor to 1.5× for welded steel, 2.0× for fatigue joints, 2.5× for safety-critical.
          <br />
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Physics: </span>
          Front/Rear Axle = vertical + lateral load (N) with bump amplification. Fork Moment = √(brake overturning² + lateral bending²) at crown (N·m). Head Tube = axial steering-column compression. SW Pivot = swingarm bearing resultant including chain pull. Chain = F_traction × (wheel/sprocket radius ratio).
        </div>
      </div>
    </div>
  );
}
