import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip as RCTooltip,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { useTheme } from '../../store/useTheme';
import { ComputeAllResult } from '../../engine/types';

/* ── Status helpers ──────────────────────────────────────── */
type Status = 'ok' | 'warn' | 'bad' | 'info';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Normalize a value to 0–100 given optimal range [optLo, optHi] and absolute limits [absLo, absHi]
function normalizeRange(val: number, optLo: number, optHi: number, absLo: number, absHi: number): number {
  if (val >= optLo && val <= optHi) return clamp(90 + 10 * (1 - 2 * Math.abs((val - (optLo + optHi) / 2) / (optHi - optLo))), 80, 100);
  if (val < absLo || val > absHi) return 5;
  if (val < optLo) return clamp(50 * (val - absLo) / (optLo - absLo), 5, 79);
  return clamp(50 * (absHi - val) / (absHi - optHi), 5, 79);
}

/* ── KPI Card ───────────────────────────────────────────── */
function KPICard({ label, value, unit, sub, fillPct, status }: {
  label: string; value: string; unit?: string; sub?: string;
  fillPct: number; status: Status;
}) {
  const barColor = status === 'ok' ? 'var(--accent2)' : status === 'warn' ? 'var(--warn)' : status === 'bad' ? 'var(--danger)' : 'var(--accent)';
  return (
    <div className={`kpi-card ${status} fade-in`}>
      <div className="kpi-card-label">{label}</div>
      <div className={`kpi-card-value ${status}`}>
        {value}
        {unit && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div className="kpi-card-sub">{sub}</div>}
      <div className="kpi-bar">
        <div className="kpi-bar-fill" style={{ width: `${clamp(fillPct, 2, 100)}%`, background: barColor }} />
      </div>
    </div>
  );
}

/* ── Health item ────────────────────────────────────────── */
function HealthItem({ label, value, unit, status }: {
  label: string; value: string; unit?: string; status: Status; desc: string;
}) {
  const dotColor = status === 'ok' ? 'var(--accent2)' : status === 'warn' ? 'var(--warn)' : 'var(--danger)';
  const statusLabel = status === 'ok' ? 'OK' : status === 'warn' ? 'Check' : 'FAIL';
  return (
    <div className="health-item">
      <div className="health-dot" style={{ background: dotColor, boxShadow: `0 0 4px ${dotColor}` }} />
      <span className="health-label">{label}</span>
      <span className="health-value" style={{ color: dotColor }}>
        {value}{unit && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}> {unit}</span>}
      </span>
      <span className={`health-status ${status}`}>{statusLabel}</span>
    </div>
  );
}

/* ── Threshold card ─────────────────────────────────────── */
function ThreshCard({ label, value, unit, desc }: { label: string; value: string; unit: string; desc: string }) {
  return (
    <div className="threshold-card">
      <div className="threshold-label">{label}</div>
      <div className="threshold-value">
        {value}
        <span className="threshold-unit">{unit}</span>
      </div>
      <div className="threshold-desc">{desc}</div>
    </div>
  );
}

/* ── Radar data ─────────────────────────────────────────── */
function buildRadarData(r: ComputeAllResult) {
  const trail = r.geometry.trail;
  const stability = normalizeRange(trail, 80, 120, 40, 160);
  const comfort   = normalizeRange(r.suspension.natFreqFront, 0.9, 1.4, 0.5, 2.0);
  const as        = r.antiSquat.antiSquatPercent;
  const traction  = clamp(100 - Math.abs(as - 100) * 0.7, 5, 100);
  const integrity = clamp(normalizeRange(r.stability.stabilityIndex * 1000, 100, 150, 50, 200), 5, 100);
  const knee      = r.ergonomics.kneeAngleDeg;
  const ergScore  = normalizeRange(knee, 90, 130, 60, 160);
  const balance   = clamp(100 - Math.abs(r.cog.frontPercent - 50) * 2.5, 20, 100);
  return [
    { subject: 'Stability',  A: Math.round(stability)  },
    { subject: 'Comfort',    A: Math.round(comfort)     },
    { subject: 'Traction',   A: Math.round(traction)    },
    { subject: 'Integrity',  A: Math.round(integrity)   },
    { subject: 'Ergonomics', A: Math.round(ergScore)    },
    { subject: 'Balance',    A: Math.round(balance)     },
  ];
}

/* ── Dev Progress ───────────────────────────────────────── */
const DEV_TRACKS = [
  {
    name: 'MBD Engine (Python)',
    phases: [
      { label: 'Phase 1 · 2D Rigid Body + RK4',       status: 'done',    tests: '14/14' },
      { label: 'Phase 2 · 3D Joints + Quaternions',    status: 'done',    tests: '23/23' },
      { label: 'Phase 3 · Gen-α DAE Solver',           status: 'done',    tests: '32/32' },
      { label: 'Phase 4 · Contact + Collision',        status: 'next',    tests: '—' },
      { label: 'Phase 5 · Flexible Bodies (FEM)',      status: 'pending', tests: '—' },
      { label: 'Phase 6 · Optimization / Sweep',       status: 'pending', tests: '—' },
      { label: 'Phase 7 · Full GUI Simulator',         status: 'pending', tests: '—' },
    ],
  },
  {
    name: 'Chassis Sim (Python)',
    phases: [
      { label: 'Phase 1–6 · Quasi-static engine',      status: 'done',    tests: '82/82' },
      { label: 'Phase 7+10 · Damping + Aero',          status: 'done',    tests: '✓' },
      { label: 'Phase 8 · Stability eigenvalues',      status: 'next',    tests: '—' },
      { label: 'Phase 12 · Pacejka tyre model',        status: 'pending', tests: '—' },
      { label: 'Phase 9 · Steering feedback torque',   status: 'pending', tests: '—' },
      { label: 'Phase 11 · Rider posture coupling',    status: 'pending', tests: '—' },
    ],
  },
  {
    name: 'Workbench UI (React/Electron)',
    phases: [
      { label: '15 analysis tabs (live)',              status: 'done',    tests: '✓' },
      { label: 'TypeScript physics engine',            status: 'done',    tests: '✓' },
      { label: 'Electron desktop app',                 status: 'done',    tests: '✓' },
      { label: 'FastAPI backend + IPC',                status: 'done',    tests: '✓' },
      { label: 'MBD Simulator tab (live sim UI)',      status: 'next',    tests: '—' },
      { label: '3D scene viewport (Three.js)',         status: 'pending', tests: '—' },
    ],
  },
];

const SCOLOR: Record<string, string> = {
  done:    'var(--cyan)',
  next:    'var(--accent)',
  pending: 'var(--muted, #555)',
};
const SICON: Record<string, string> = { done: '✓', next: '▶', pending: '○' };

function DevProgress() {
  const totalTests = 32 + 82;  // MBD + chassis_sim
  const donePhases = DEV_TRACKS.reduce((acc, t) => acc + t.phases.filter(p => p.status === 'done').length, 0);
  const totalPhases = DEV_TRACKS.reduce((acc, t) => acc + t.phases.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary bar */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}>
        {[
          { label: 'Tests Passing', value: `${totalTests} / ${totalTests}`, sub: 'All green' },
          { label: 'Phases Done',   value: `${donePhases} / ${totalPhases}`, sub: 'of all tracks' },
          { label: 'MBD Engine',    value: '32 / 32', sub: 'Phase 3 complete · Gen-α' },
          { label: 'Chassis Sim',   value: '82 / 82', sub: 'Phases 1–7 + 10 done' },
          { label: 'Current Phase', value: 'MBD 4 · CS 8', sub: 'Contact · Stability' },
        ].map(m => (
          <div key={m.label} style={{ minWidth: 120 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cyan)', fontFamily: 'Consolas,monospace' }}>{m.value}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Track columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {DEV_TRACKS.map(track => (
          <div key={track.name} style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 10, fontFamily: 'Consolas,monospace' }}>
              {track.name}
            </div>
            {track.phases.map((ph, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 6, fontSize: 11,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  background: ph.status === 'done' ? 'var(--cyan)' : 'transparent',
                  border: `1.5px solid ${SCOLOR[ph.status]}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                  color: ph.status === 'done' ? '#000' : SCOLOR[ph.status],
                }}>
                  {SICON[ph.status]}
                </span>
                <span style={{
                  flex: 1,
                  color: ph.status === 'done' ? 'var(--text)' : ph.status === 'next' ? 'var(--accent)' : 'var(--muted, #555)',
                }}>
                  {ph.label}
                </span>
                {ph.tests !== '—' && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 8,
                    background: 'rgba(0,200,150,0.12)', color: 'var(--cyan)',
                    border: '1px solid var(--cyan)', fontFamily: 'Consolas,monospace',
                    flexShrink: 0,
                  }}>
                    {ph.tests}
                  </span>
                )}
              </div>
            ))}
            {/* Progress bar */}
            <div style={{ marginTop: 10, height: 3, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.round(track.phases.filter(p => p.status === 'done').length / track.phases.length * 100)}%`,
                background: 'var(--cyan)',
              }} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
              {track.phases.filter(p => p.status === 'done').length}/{track.phases.length} phases
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN OVERVIEW PANEL
   ══════════════════════════════════════════════════════════ */
export default function OverviewPanel() {
  const r              = useStore(s => s.results);
  const inp            = useStore(s => s.input);
  const backendResults = useStore(s => s.backendResults);
  void useStore(s => s.backendDynamics); // reserved for future braking sweep panel
  const backendStatus  = useStore(s => s.backendStatus);
  const { theme } = useTheme();
  const dk = theme === 'dark';

  // Prefer backend values when synced; fall back to TypeScript engine
  const py = backendStatus === 'synced' && backendResults !== null;
  const hi = {
    rearSquatMm:        py ? backendResults!.dynamics.rear_squat_mm        : r.stability.rearSquatMm,
    forkDiveMm:         py ? backendResults!.dynamics.fork_dive_mm         : r.stability.forkDiveMm,
    stabilityIndex:     py ? backendResults!.handling.stability_index      : r.stability.stabilityIndex,
    agilityIndex:       py ? backendResults!.handling.agility_index        : r.stability.agilityIndex,
    wobbleSensitivity:  py ? backendResults!.handling.wobble_sensitivity   : r.stability.wobbleSensitivity,
    pitchSensitivity:   py ? backendResults!.handling.pitch_sensitivity    : r.stability.pitchSensitivity,
    wheelieG:           py ? backendResults!.dynamics.wheelie_threshold_g  : r.stability.a_wheelie_g,
    stoppieG:           py ? backendResults!.dynamics.stoppie_threshold_g  : r.stability.a_stoppie_g,
  };
  const src = py ? ' (PY)' : ' (TS)';

  const trail = r.geometry.trail;
  const trailStatus: Status = trail >= 80 && trail <= 120 ? 'ok' : trail >= 60 && trail <= 150 ? 'warn' : 'bad';
  const trailFill = normalizeRange(trail, 80, 120, 40, 160);

  const frontPct = r.cog.frontPercent;
  const balanceStatus: Status = frontPct >= 45 && frontPct <= 58 ? 'ok' : 'warn';


  const asStatus: Status = r.antiSquat.antiSquatPercent >= 60 && r.antiSquat.antiSquatPercent <= 120 ? 'ok' : 'warn';

  const freqF = r.suspension.natFreqFront;
  const freqStatus: Status = freqF >= 0.9 && freqF <= 1.4 ? 'ok' : freqF >= 0.7 && freqF <= 1.8 ? 'warn' : 'bad';

  const kneeStatus: Status = r.ergonomics.kneeAngleDeg >= 90 && r.ergonomics.kneeAngleDeg <= 130 ? 'ok' : 'warn';

  const radarData = buildRadarData(r);
  const radarColor = dk ? '#1f6feb' : '#0969da';
  const gridColor  = dk ? '#21262d' : '#d8dee4';
  const labelColor = dk ? '#8b949e' : '#636e7b';

  return (
    <div className="overview-panel fade-in">

      {/* ── KPI Row ─────────────────────────────────────── */}
      <div className="overview-section-title">Key Performance Indicators</div>
      <div className="overview-kpi-grid">
        <KPICard
          label="Steering Trail"
          value={trail.toFixed(1)} unit="mm"
          sub="Target 80–120 mm"
          fillPct={trailFill} status={trailStatus}
        />
        <KPICard
          label="CoG Height"
          value={r.cog.Y_cg.toFixed(0)} unit="mm"
          sub={`X: ${r.cog.X_cg.toFixed(0)} mm from front`}
          fillPct={clamp((800 - r.cog.Y_cg) / 5, 20, 100)} status="info"
        />
        <KPICard
          label="Weight Split"
          value={`${r.cog.frontPercent.toFixed(1)}%`}
          sub={`${r.cog.frontPercent.toFixed(1)}% F / ${r.cog.rearPercent.toFixed(1)}% R`}
          fillPct={normalizeRange(frontPct, 46, 55, 35, 65)} status={balanceStatus}
        />
        <KPICard
          label="Anti-Squat"
          value={r.antiSquat.antiSquatPercent.toFixed(1)} unit="%"
          sub={`Target 80–120% · Chain: ${r.antiSquat.chainContribution.toFixed(1)}%`}
          fillPct={normalizeRange(r.antiSquat.antiSquatPercent, 80, 120, 20, 180)} status={asStatus}
        />
        <KPICard
          label="Nat. Freq. Front"
          value={r.suspension.natFreqFront.toFixed(3)} unit="Hz"
          sub={`Rear: ${r.suspension.natFreqRear.toFixed(3)} Hz`}
          fillPct={normalizeRange(freqF, 0.9, 1.4, 0.4, 2.0)} status={freqStatus}
        />
      </div>

      {/* ── Weight split visual bar ──────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Weight Distribution
        </div>
        <div className="weight-split-bar">
          <div className="weight-front" style={{ flex: frontPct }}>
            {frontPct.toFixed(0)}% F
          </div>
          <div className="weight-rear" style={{ flex: 100 - frontPct }}>
            R {r.cog.rearPercent.toFixed(0)}%
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
          <span>R_front = {r.cog.R_front.toFixed(0)} N</span>
          <span>Total = {r.cog.totalWeight.toFixed(0)} N · {r.cog.totalMass.toFixed(1)} kg</span>
          <span>R_rear = {r.cog.R_rear.toFixed(0)} N</span>
        </div>
      </div>

      {/* ── Radar + Health Check Row ────────────────────── */}
      <div className="overview-row">

        {/* Radar chart */}
        <div className="overview-card">
          <h3>Bike Profile</h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
              <PolarGrid stroke={gridColor} />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: labelColor, fontSize: 10, fontFamily: 'Consolas,monospace' }}
              />
              <Radar
                name="Bike" dataKey="A"
                stroke={radarColor} fill={radarColor} fillOpacity={0.25}
                strokeWidth={2}
              />
              <RCTooltip
                contentStyle={{
                  background: 'var(--surface2)', border: '1px solid var(--border2)',
                  borderRadius: 6, fontSize: 11, fontFamily: 'Consolas,monospace',
                }}
                formatter={(v: unknown) => [`${v}/100`, '']}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Health check */}
        <div className="overview-card">
          <h3>System Health Check</h3>
          <div className="health-grid">
            <HealthItem
              label="Steering Trail"
              value={trail.toFixed(1)} unit="mm"
              status={trailStatus}
              desc="Target 80–120mm"
            />
            <HealthItem
              label="Sag% Front"
              value={r.suspension.sagPercentFront.toFixed(1)} unit="%"
              status={r.suspension.sagPercentFront >= 22 && r.suspension.sagPercentFront <= 32 ? 'ok' : 'warn'}
              desc="Target 22–32%"
            />
            <HealthItem
              label="Sag% Rear"
              value={r.suspension.sagPercentRear.toFixed(1)} unit="%"
              status={r.suspension.sagPercentRear >= 22 && r.suspension.sagPercentRear <= 32 ? 'ok' : 'warn'}
              desc="Target 22–32%"
            />
            <HealthItem
              label="Nat Freq Front"
              value={r.suspension.natFreqFront.toFixed(3)} unit="Hz"
              status={freqStatus}
              desc="Target 0.9–1.4Hz"
            />
            <HealthItem
              label="Anti-Squat"
              value={r.antiSquat.antiSquatPercent.toFixed(1)} unit="%"
              status={asStatus}
              desc="Target 80–120%"
            />
            <HealthItem
              label="Anti-Dive"
              value={r.antiSquat.antiDivePercent.toFixed(1)} unit="%"
              status={r.antiSquat.antiDivePercent >= 20 ? 'ok' : 'warn'}
              desc="Higher = less fork dive"
            />
            <HealthItem
              label="Knee Angle"
              value={r.ergonomics.kneeAngleDeg.toFixed(1)} unit="°"
              status={kneeStatus}
              desc="Target 90–130°"
            />
            <HealthItem
              label="Hip Angle"
              value={r.ergonomics.hipAngleDeg.toFixed(1)} unit="°"
              status={r.ergonomics.hipAngleDeg >= 40 && r.ergonomics.hipAngleDeg <= 90 ? 'ok' : 'warn'}
              desc="Target 40–90°"
            />
          </div>
        </div>
      </div>

      {/* ── Stability Thresholds Row ─────────────────────── */}
      <div className="overview-section-title">Stability Thresholds</div>
      <div className="threshold-row">
        <ThreshCard
          label="Wheelie Limit"
          value={r.stability.a_wheelie_g.toFixed(2)} unit="g"
          desc="Accel. for front lift"
        />
        <ThreshCard
          label="Stoppie Limit"
          value={r.stability.a_stoppie_g.toFixed(2)} unit="g"
          desc="Decel. for rear lift"
        />
        <ThreshCard
          label="Lean Clearance"
          value={r.stability.leanLimitDeg.toFixed(1)} unit="°"
          desc="Footpeg ground contact"
        />
        <ThreshCard
          label="Min Turn Radius"
          value={(r.stability.R_turn_min_mm / 1000).toFixed(2)} unit="m"
          desc={`at ${inp.stability?.steeringLockAngle ?? 35}° lock`}
        />
        <ThreshCard
          label="Max Grade"
          value={r.stability.gradeMaxDeg.toFixed(1)} unit="°"
          desc={`${r.stability.gradeMaxPercent.toFixed(0)}% slope (μ=${inp.stability?.frictionCoeff ?? 0.8})`}
        />
        <ThreshCard
          label="Load at 0.8g"
          value={r.suspension.loadTransfer08g.toFixed(0)} unit="N"
          desc="Braking load transfer"
        />
      </div>

      {/* ── Dynamics Row ─────────────────────────────────── */}
      <div className="overview-section-title">Dynamic Load Transfer</div>
      <div className="threshold-row">
        <ThreshCard label="Front % Braking" value={r.dynamics.frontPercentBraking.toFixed(1)} unit="%" desc={`at ${inp.dynamics.brakingDecel}g decel`} />
        <ThreshCard label="Front % Accel"   value={r.dynamics.frontPercentAccel.toFixed(1)}   unit="%" desc={`at ${inp.dynamics.accelG}g accel`} />
        <ThreshCard label="Bank Angle"      value={r.dynamics.bankAngleDeg.toFixed(1)}        unit="°" desc={`${inp.dynamics.cornerSpeed}m/s in ${inp.dynamics.cornerRadius}m radius`} />
        <ThreshCard label="Lateral Force"   value={r.dynamics.lateralForce.toFixed(0)}        unit="N" desc="Through CoG at corner" />
      </div>

      {/* ── Tire Physics ─────────────────────────────────── */}
      <div className="overview-section-title">Tire Physics</div>
      <div className="threshold-row">
        <ThreshCard label="Front Loaded R" value={r.tire.frontLoadedRadius.toFixed(1)} unit="mm" desc={`Free: ${r.tire.frontFreeRadius.toFixed(1)} mm`} />
        <ThreshCard label="Rear Loaded R"  value={r.tire.rearLoadedRadius.toFixed(1)}  unit="mm" desc={`Free: ${r.tire.rearFreeRadius.toFixed(1)} mm`} />
        <ThreshCard label="Contact F"      value={r.tire.frontContactPatchLength.toFixed(1)} unit="mm" desc="Front contact patch" />
        <ThreshCard label="Contact R"      value={r.tire.rearContactPatchLength.toFixed(1)}  unit="mm" desc="Rear contact patch" />
        <ThreshCard label="f_n Front (corr)" value={r.tire.frontNatFreqCorrected.toFixed(3)} unit="Hz" desc="With tire compliance" />
        <ThreshCard label="f_n Rear (corr)"  value={r.tire.rearNatFreqCorrected.toFixed(3)}  unit="Hz" desc="With tire compliance" />
      </div>

      {/* ── Handling Indices ─────────────────────────────── */}
      <div className="overview-section-title" style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
        Handling Indices
        <span style={{
          fontSize: 9, fontFamily: 'monospace', padding: '1px 5px',
          borderRadius: 3, background: py ? 'var(--accent2)' : 'var(--surface)',
          color: py ? '#000' : 'var(--text-muted)', border: '1px solid var(--border)',
        }}>{py ? 'PYTHON DAG' : 'TypeScript'}</span>
      </div>
      <div className="threshold-row">
        <ThreshCard
          label="Rear Squat"
          value={hi.rearSquatMm.toFixed(1)} unit="mm"
          desc={`Under ${inp.dynamics.accelG}g accel${src}`}
        />
        <ThreshCard
          label="Fork Dive"
          value={hi.forkDiveMm.toFixed(1)} unit="mm"
          desc={`Under ${inp.dynamics.brakingDecel}g braking${src}`}
        />
        <ThreshCard
          label="Stability Index"
          value={hi.stabilityIndex.toFixed(4)} unit=""
          desc={`trail × WB / 10⁶${src} · higher = stable`}
        />
        <ThreshCard
          label="Agility Index"
          value={hi.agilityIndex.toFixed(4)} unit=""
          desc={`I_yaw / (M × WB²)${src} · lower = agile`}
        />
        <ThreshCard
          label="Wobble Sensitivity"
          value={hi.wobbleSensitivity.toFixed(2)} unit=""
          desc={`10⁶ / (trail × WB)${src}`}
        />
        <ThreshCard
          label="Pitch Sensitivity"
          value={hi.pitchSensitivity.toFixed(4)} unit="%/mm"
          desc={`dF% / dWB${src}`}
        />
      </div>

      {/* ── Development Progress ─────────────────────────── */}
      <div className="overview-section-title" style={{ marginTop: 20 }}>Development Progress</div>
      <DevProgress />

    </div>
  );
}
