/**
 * AntiDiveDashboard.tsx — Anti-Dive & Load Transfer Analysis
 *
 * PDF Reference: "Anti-Squat and Anti-Dive Characteristics in Motorcycles", Rev 1.0
 *
 * KEY FEATURE: Interactive Parameter Playground (PDF §3 + §4)
 *   Select any geometric parameter, adjust with slider → ALL downstream
 *   metrics recompute live (IC, AS%, load transfer, AD%, lean, structural).
 *   Cause→Effect chain visualization from PDF §4.
 *
 * Sections implemented:
 *   §1.3  Longitudinal load transfer + static weight distribution
 *   §1.5  Anti-dive percentage definition
 *   §2.6  Geometric AD% for telescopic fork
 *   §3    Parametric sensitivity (INTERACTIVE, live recompute)
 *   §4    Cause→Effect chains (A–E)
 *   §5    Sport vs Naked geometry comparison
 *   §6.4  Chain tension + swingarm structural loads
 *   §7.1  AS% at lean / corner exit jackup risk
 *   §9.1  Design target classification
 *   §9.3  IC placement zone check
 *   §9.6/9.7 Integrated geometry checklist
 */

import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  computeLoadTransfer,
  computeAntiDive,
  computeLeanSweep,
  computeChainLoads,
  classifyDesignTarget,
  checkICZone,
} from '../../engine/antiDiveEngine';
import { computeAntiSquatUnified } from '../../engine/antiSquat';
import { computeSquatAnalysis } from '../../engine/antiSquatAnalysis';
import PhysicsGeometryDiagram from '../visualization/PhysicsGeometryDiagram';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
  BarChart, Bar,
} from 'recharts';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  accent:  'var(--accent)',
  accent2: 'var(--accent2)',
  cyan:    'var(--cyan)',
  warn:    'var(--warn)',
  danger:  '#f85149',
  muted:   'var(--text-muted)',
  primary: 'var(--text-primary)',
  border:  '#21262d',
  purple:  'var(--purple)',
  green:   '#3fb950',
  blue:    '#58a6ff',
  orange:  '#e3b341',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: number, dp = 1) =>
  (!isFinite(v) || isNaN(v)) ? '—' : v.toFixed(dp);

const fmtDelta = (d: number, dp = 1, unit = '') => {
  if (!isFinite(d) || isNaN(d)) return '—';
  const s = d >= 0 ? `+${d.toFixed(dp)}` : d.toFixed(dp);
  return unit ? `${s} ${unit}` : s;
};

const deltaColor = (d: number, positiveGood = true) => {
  if (Math.abs(d) < 0.1) return C.muted;
  return (d > 0) === positiveGood ? C.green : C.danger;
};

// ─── Shared small components ─────────────────────────────────────────────────

function KV({ label, value, unit = '', color, sub }: {
  label: string; value: string | number; unit?: string; color?: string; sub?: string;
}) {
  const val = typeof value === 'number' ? fmt(value) : value;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '3px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 10, color: C.muted }}>
        {label}
        {sub && <span style={{ fontSize: 8, color: '#484f58', marginLeft: 4 }}>{sub}</span>}
      </span>
      <span style={{
        fontSize: 11, fontFamily: 'Consolas, monospace',
        color: color ?? C.primary, fontWeight: 600,
      }}>
        {val}{unit && <span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function SectionHdr({ title, color = C.accent }: { title: string; color?: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      color, textTransform: 'uppercase',
      borderBottom: `1px solid ${color}40`,
      paddingBottom: 4, marginBottom: 8, marginTop: 16,
    }}>
      {title}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      background: `${color}22`, border: `1px solid ${color}66`,
      borderRadius: 3, fontSize: 10, fontWeight: 700, color,
    }}>
      {label}
    </span>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: ok ? C.green : C.warn, marginRight: 5, verticalAlign: 'middle',
    }} />
  );
}

// ─── Parameter Playground definitions ────────────────────────────────────────

interface ParamDef {
  id: string;
  label: string;
  unit: string;
  min: number;   // delta min
  max: number;   // delta max
  step: number;
  description: string;
  pdfSection: string;
}

const PARAMS: ParamDef[] = [
  {
    id: 'rearAxleHeight', label: 'Rear Axle Height', unit: 'mm',
    min: -30, max: 40, step: 2,
    description: 'Raises the entire swingarm → IC height increases proportionally. +10mm ≈ +5–8% AS%.',
    pdfSection: '§3.4',
  },
  {
    id: 'cspHeight', label: 'CSP Height (Countershaft)', unit: 'mm',
    min: -30, max: 40, step: 2,
    description: 'Most underappreciated parameter. Steepens chain line → raises effective IC → increases AS%. +10mm ≈ +4–7% AS%.',
    pdfSection: '§3.3',
  },
  {
    id: 'swingarmAngle', label: 'Swingarm Angle', unit: '°',
    min: -4, max: 5, step: 0.5,
    description: 'Steeper angle rotates swingarm line upward → raises IC → AS% increases +4–6% per degree. Display convention: CW+ (typical downward slope = positive, e.g. +4° to +8°). Delta here adds directly to geometry angle.',
    pdfSection: '§3.1',
  },
  {
    id: 'swingarmLength', label: 'Swingarm Length', unit: 'mm',
    min: -60, max: 80, step: 5,
    description: 'Longer arm reduces chain line angle (flatter) and increases wheelbase → net effect: AS% -3–5% unless angle compensated.',
    pdfSection: '§3.2',
  },
  {
    id: 'wheelbase', label: 'Wheelbase', unit: 'mm',
    min: -100, max: 100, step: 10,
    description: 'Longer WB reduces load transfer (ΔW = M·a·h/L). Slightly increases AS% at same IC (force line extends further). Reduces wheelie/stoppie tendency.',
    pdfSection: '§3.5',
  },
  {
    id: 'cogHeight', label: 'CoG Height (h_CoG)', unit: 'mm',
    min: -80, max: 80, step: 5,
    description: 'Higher CoG → more load transfer → steeper LT line → AS% decreases for same force line. Naked bikes have h_CoG 40–60mm higher than sport bikes.',
    pdfSection: '§3.6',
  },
  {
    id: 'rakeAngle', label: 'Rake Angle (ε)', unit: '°',
    min: -3, max: 4, step: 0.5,
    description: 'Steeper rake → higher geometric AD%. Minimal AS% effect. Affects trail → handling feel.',
    pdfSection: '§3.8',
  },
  {
    id: 'frontSprocket', label: 'Front Sprocket', unit: ' teeth',
    min: -3, max: 3, step: 1,
    description: 'Changing sprocket shifts chain line angle → shifts IC → AS% changes ±3–5% per tooth. Primary tuning tool in practice.',
    pdfSection: '§5.2',
  },
];

// ─── Cause→Effect chains from PDF §4 ─────────────────────────────────────────

const CAUSE_EFFECT: Record<string, { chain: string[]; title: string }> = {
  swingarmAngle: {
    title: 'Chain A: Increased Swingarm Angle',
    chain: [
      'INCREASE swingarm angle (θ_sw)',
      '→ Swingarm line rotates upward',
      '  → IC height increases (~+10 mm per degree)',
      '    → Force line from contact patch through IC steepens',
      '      → Force line intercept at front axle rises',
      '        → AS% increases (+4–6% per degree)',
      '          → Rear suspension extends under acceleration',
      '            → If AS% > 100%: rear jacks up under acceleration',
      '              → Spring unloads → reduced tire compliance',
      '  → Swingarm geometry alters chain line angle',
      '    → Drivetrain efficiency marginally affected (±0.3%)',
    ],
  },
  cspHeight: {
    title: 'Chain B: Raised Countershaft Sprocket (CSP) Position',
    chain: [
      'RAISE countershaft sprocket height (h_CSP: +20 mm)',
      '→ Upper chain line steepens (larger θ_chain)',
      '  → Upward component of chain tension on rear sprocket arm increases',
      '    → Extension moment on swingarm about pivot INCREASES',
      '      → Effective IC rises (chain-adjusted IC)',
      '        → AS% increases (+4–7% per +10 mm CSP)',
      '→ Lower chain line (slack span) sags differently',
      '  → Chain guide clearance may reduce (potential rattle under decel)',
      '→ Vertical engine position changes (if engine mounts shift)',
      '  → CoG height may increase slightly (+2–5 mm per +20 mm CSP)',
      '    → Load transfer increases slightly (counteracts some AS% gain)',
    ],
  },
  wheelbase: {
    title: 'Chain C: Increase in Wheelbase',
    chain: [
      'INCREASE wheelbase (L: +50 mm)',
      '→ Load transfer magnitude DECREASES (ΔW = M·a·h/L, larger L → smaller ΔW)',
      '  → Rear squat tendency REDUCES',
      '    → Less AS% needed for same suspension behavior',
      '  → Front dive tendency REDUCES',
      '    → Braking feel is less aggressive (nose drops more slowly)',
      '→ Swingarm length increases (if extension via axle pullback)',
      '  → Chain line angle flattens (rear sprocket moves rearward)',
      '    → AS% slightly decreases (offsetting load transfer reduction)',
      '→ Steering geometry changes (trail, effective rake)',
      '  → Straight-line stability increases',
      '  → Cornering agility decreases (higher steering effort)',
    ],
  },
  cogHeight: {
    title: 'Chain D: Higher CoG (Upright Rider — Naked vs. Sport)',
    chain: [
      'INCREASE h_CoG (600 → 660 mm, e.g., upright vs. tuck position)',
      '→ Load transfer INCREASES (ΔW = M·a·h/L)',
      '  → Rear squat tendency INCREASES',
      '    → Requires HIGHER AS% to counteract (or softer compression damping)',
      '  → Front dive tendency INCREASES',
      '    → Requires stiffer front spring or increased compression damping',
      '→ Wheelie threshold DECREASES',
      '  → Engine power output must be managed more carefully',
      '→ Load transfer line angle (θ_LT) STEEPENS',
      '  → For same IC position, AS% DECREASES',
      '    → Designer must raise IC (steeper swingarm, higher CSP)',
      '      → Potential conflict: steeper swingarm may increase wheelie tendency',
      '        → Trade-off: traction vs. wheelie management',
    ],
  },
  rakeAngle: {
    title: 'Chain E: Front Fork Rake — Anti-Dive Effect',
    chain: [
      'INCREASE rake angle (ε: +1°)',
      '→ Geometric AD% potential increases (tan(ε) increases)',
      '  → But actual telescopic AD% still low (dominated by friction 5–20%)',
      '→ Trail increases (Trail = R_f·cos(ε)/sin(ε) − offset/sin(ε))',
      '  → Straight-line stability increases',
      '  → Steering becomes heavier',
      '→ Fork compresses more gradually under hard braking',
      '  → Steering becomes heavier during braking (trail increases as fork dives)',
      '  → Fork tube bending moment increases',
      '    → Structural fatigue in lower fork legs',
    ],
  },
  rearAxleHeight: {
    title: 'Raised Rear Axle Height',
    chain: [
      'RAISE rear axle height (h_RA: +10 mm)',
      '→ Raises the entire swingarm assembly',
      '→ IC height increases proportionally',
      '→ Swingarm angle steepens (if pivot is fixed)',
      '→ Chain angle becomes more favorable (steeper)',
      '  → AS% increases +5–8%',
      '→ Ride height increases → static weight distribution shifts rearward',
      '→ Alters suspension sag → affects spring operating range',
    ],
  },
  swingarmLength: {
    title: 'Swingarm Length Effect',
    chain: [
      'INCREASE swingarm length (L_sw: +40 mm)',
      '→ Wheelbase increases ~35 mm (rear axle moves back)',
      '  → Load transfer reduces: ΔW ∝ 1/L → ~2.5% reduction',
      '→ Chain line angle flattens (rear sprocket moves rearward)',
      '  → Lower anti-squat contribution from chain geometry',
      '→ Net AS%: typically decreases 3–5% unless swingarm angle adjusted',
      '→ Wheelie tendency: REDUCES (shorter lever for weight transfer)',
      '→ Rear traction stability: IMPROVES under combined cornering + accel',
    ],
  },
  frontSprocket: {
    title: 'Sprocket Ratio Change',
    chain: [
      'CHANGE front sprocket (e.g., +1 tooth)',
      '→ Countershaft sprocket radius increases',
      '  → External tangent chain line angle shifts',
      '    → Chain force line direction changes',
      '      → IC position moves',
      '        → AS% changes ±3–5% per tooth',
      '→ Overall gear ratio decreases (+1T front = taller gearing)',
      '  → Less engine torque multiplication → lower chain tension',
      '    → Lower bearing load on swingarm pivot',
      '→ Practical tuning: -1 tooth rear ≈ same as +0.5 tooth front (different lever)',
    ],
  },
};

// ─── Compute all metrics for a given geometry state ──────────────────────────

function computeAllMetrics(
  gp: ReturnType<typeof useStore.getState>['input']['geometry'],
  chain: ReturnType<typeof useStore.getState>['input']['chain'],
  cog: ReturnType<typeof useStore.getState>['results']['cog'],
  susp: ReturnType<typeof useStore.getState>['input']['suspension'],
  overrides: {
    rearAxleHeight?: number;
    wheelbase?: number;
    cogHeight?: number;
    headAngle?: number;
    cspHeightDelta?: number;
    swingarmAngleDelta?: number;  // degrees to add
    swingarmLengthDelta?: number;
    frontSprocketDelta?: number;
  } = {},
) {
  // Apply overrides
  const H_ra = overrides.rearAxleHeight ?? gp.rearAxleHeight;
  const WB   = overrides.wheelbase ?? gp.wheelbase;
  const Y_cg = overrides.cogHeight ?? cog.Y_cg;
  const headAngle = overrides.headAngle ?? gp.headAngle;

  // Swingarm pivot stays fixed; rear axle height / WB may change
  const X_sp = gp.swingarmPivotX;
  const H_sp = gp.swingarmPivotHeight;

  // Swingarm length delta: moves rear axle
  let H_ra_mod = H_ra;
  let WB_mod   = WB;
  if (overrides.swingarmLengthDelta) {
    // Extending arm at same angle: axle moves along current swingarm direction
    const origAngleRad = Math.atan2(H_ra - H_sp, WB - X_sp);
    H_ra_mod = H_ra + overrides.swingarmLengthDelta * Math.sin(origAngleRad);
    WB_mod   = WB   + overrides.swingarmLengthDelta * Math.cos(origAngleRad);
  }

  // Swingarm angle delta: rotate swingarm keeping length, move rear axle
  if (overrides.swingarmAngleDelta) {
    const origAngleRad = Math.atan2(H_ra_mod - H_sp, WB_mod - X_sp);
    const L_sa = Math.sqrt((WB_mod - X_sp) ** 2 + (H_ra_mod - H_sp) ** 2);
    const newAngleRad = origAngleRad + overrides.swingarmAngleDelta * Math.PI / 180;
    H_ra_mod = H_sp + L_sa * Math.sin(newAngleRad);
    WB_mod   = X_sp + L_sa * Math.cos(newAngleRad);
  }

  // CSP height delta: modifies sprocketCenterY
  const chainMod = {
    ...chain,
    sprocketCenterY: chain.sprocketCenterY + (overrides.cspHeightDelta ?? 0),
    frontSprocket: Math.max(8, chain.frontSprocket + (overrides.frontSprocketDelta ?? 0)),
  };

  // Recompute anti-squat
  const as = computeAntiSquatUnified(
    chainMod, X_sp, H_sp, WB_mod, H_ra_mod, Y_cg,
    headAngle, cog.R_front, cog.totalWeight,
  );

  // Load transfer
  const lt = computeLoadTransfer(
    cog.totalMass, WB_mod, cog.X_cg, Y_cg, 0.8, 0.8,
  );

  // Anti-dive
  const ad = computeAntiDive(
    headAngle, Y_cg, cog.X_cg, WB_mod,
    susp.springRateFront, cog.totalMass, 0.8,
  );

  // Swingarm angle (computed from geometry)
  const swAngleDeg = Math.atan2(H_ra_mod - H_sp, WB_mod - X_sp) * 180 / Math.PI;

  // Chain force angle
  const chainAngle = as.chainForceAngleAuto;

  // Design target
  const target = classifyDesignTarget(isFinite(as.antiSquatPercent) ? as.antiSquatPercent : 0);

  // IC zone
  const icZone = checkICZone(as.IC_x, as.IC_y, WB_mod, Y_cg);

  // AS at lean 30°
  const AS_at_30 = isFinite(as.antiSquatPercent) ? as.antiSquatPercent / Math.cos(30 * Math.PI / 180) : NaN;

  // Full geometry analysis for the physics diagram
  const modGp = { ...gp, wheelbase: WB_mod, rearAxleHeight: H_ra_mod };
  const squat = computeSquatAnalysis(modGp, chainMod, [cog.X_cg, Y_cg]);

  return {
    as, lt, ad, target, icZone,
    swAngleDeg, chainAngle, AS_at_30,
    WB: WB_mod, H_ra: H_ra_mod, Y_cg, squat,
  };
}


// ─── AS% Gauge ────────────────────────────────────────────────────────────────

function ASGauge({ value, baseline }: { value: number; baseline: number }) {
  if (!isFinite(value)) return <span style={{ color: C.muted, fontSize: 11 }}>—</span>;
  const color = value > 115 ? C.danger : value > 100 ? C.warn : value > 70 ? C.green : C.orange;
  const delta = value - baseline;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Consolas', color }}>
          {fmt(value, 1)}%
        </span>
        {Math.abs(delta) > 0.1 && (
          <span style={{
            fontSize: 12, fontFamily: 'Consolas', fontWeight: 700,
            color: delta > 0 ? C.green : C.danger,
          }}>
            {fmtDelta(delta, 1, '%')}
          </span>
        )}
      </div>
      {/* Bar */}
      <div style={{ position: 'relative', height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden' }}>
        {/* Zone bands */}
        {[
          { from: 0,   to: 70,  c: '#30363d' },
          { from: 70,  to: 100, c: '#1c4a1c' },
          { from: 100, to: 115, c: '#4a3a10' },
          { from: 115, to: 150, c: '#4a1c1c' },
        ].map(z => (
          <div key={z.from} style={{
            position: 'absolute', left: `${z.from / 150 * 100}%`,
            width: `${(z.to - z.from) / 150 * 100}%`,
            height: '100%', background: z.c,
          }} />
        ))}
        {/* Baseline marker */}
        <div style={{
          position: 'absolute', left: `${Math.min(baseline, 150) / 150 * 100}%`,
          width: 2, height: '100%', background: '#6e7681',
        }} />
        {/* Value marker */}
        <div style={{
          position: 'absolute', left: `${Math.min(value, 150) / 150 * 100}%`,
          width: 3, height: '100%', background: color,
          boxShadow: `0 0 4px ${color}`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#484f58' }}>
        <span>0%</span><span>70%</span><span>100%</span><span>115%</span><span>150%</span>
      </div>
    </div>
  );
}

// ─── Comparison Row ───────────────────────────────────────────────────────────

function CmpRow({ label, baseline, modified, unit = '', positiveGood = true, dp = 1 }: {
  label: string; baseline: number; modified: number;
  unit?: string; positiveGood?: boolean; dp?: number;
}) {
  const delta = modified - baseline;
  const dc = Math.abs(delta) < 0.05 ? C.muted : deltaColor(delta, positiveGood);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
      padding: '3px 6px', borderBottom: `1px solid ${C.border}`,
      fontSize: 10,
    }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: C.primary, fontFamily: 'Consolas', textAlign: 'right' }}>
        {fmt(baseline, dp)}{unit}
      </span>
      <span style={{
        color: Math.abs(delta) < 0.05 ? C.primary : dc,
        fontFamily: 'Consolas', textAlign: 'right', fontWeight: Math.abs(delta) > 0.5 ? 700 : 400,
      }}>
        {fmt(modified, dp)}{unit}
      </span>
      <span style={{ color: dc, fontFamily: 'Consolas', textAlign: 'right', fontWeight: 700 }}>
        {Math.abs(delta) < 0.05 ? '—' : fmtDelta(delta, dp, unit)}
      </span>
    </div>
  );
}

// ─── Sweep Chart ──────────────────────────────────────────────────────────────

function SweepChart({
  paramDef, currentDelta, baselineAS, sweepData,
}: {
  paramDef: ParamDef;
  currentDelta: number;
  baselineAS: number;
  sweepData: { x: number; as: number; ad: number }[];
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, display: 'flex', gap: 12 }}>
        <span><span style={{ color: C.green }}>━━</span> AS% (anti-squat)</span>
        <span><span style={{ color: C.cyan }}>╌╌</span> AD% (geometric anti-dive)</span>
        <span style={{ marginLeft: 'auto' }}>baseline at Δ=0 ({fmt(baselineAS, 1)}%)</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={sweepData} margin={{ top: 4, right: 20, bottom: 20, left: 40 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#21262d" />
          <XAxis dataKey="x" tick={{ fontSize: 9, fill: C.muted }}
            label={{ value: `Δ${paramDef.label} (${paramDef.unit})`, position: 'insideBottom', offset: -12, fontSize: 9, fill: C.muted }} />
          <YAxis tick={{ fontSize: 9, fill: C.muted }} unit="%" width={36}
            domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : 0;
              return [`${n.toFixed(1)}%`, name === 'as' ? 'AS%' : 'AD%'];
            }}
            labelFormatter={(v: unknown) => `Δ${paramDef.label}: ${v}${paramDef.unit}`} />
          <ReferenceLine x={0} stroke="#6e7681" strokeDasharray="4,2" />
          <ReferenceLine x={currentDelta} stroke={C.warn} strokeWidth={1.5}
            label={{ value: 'current', position: 'insideTopLeft', fontSize: 8, fill: C.warn }} />
          <ReferenceLine y={100} stroke="#f85149" strokeDasharray="3,2" />
          <Line type="monotone" dataKey="as" stroke={C.green} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ad" stroke={C.cyan} strokeWidth={1.5} dot={false} strokeDasharray="4,2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export default function AntiDiveDashboard() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);

  const gp   = input.geometry;
  const susp = input.suspension;
  const cog  = results.cog;

  // ── Local state ──────────────────────────────────────────────────────────────
  const [selectedParamId, setSelectedParamId] = useState('swingarmAngle');
  const [paramDelta, setParamDelta]           = useState(0);
  const [leanDeg, setLeanDeg]                 = useState(30);
  const [engineTorque, setEngineTorque]       = useState(120);
  const [brakeG]                               = useState(0.8);
  const [rightTab, setRightTab]               = useState<'diagram' | 'sweep' | 'lean' | 'load'>('sweep');

  const paramDef = PARAMS.find(p => p.id === selectedParamId) ?? PARAMS[0];

  // ── Baseline (current bike) ──────────────────────────────────────────────────
  const baseline = useMemo(
    () => computeAllMetrics(gp, input.chain, cog, susp),
    [gp, input.chain, cog, susp],
  );

  // ── Modified (with delta applied) ───────────────────────────────────────────
  const modified = useMemo(() => {
    const ovr: Parameters<typeof computeAllMetrics>[4] = {};
    if (selectedParamId === 'rearAxleHeight')  ovr.rearAxleHeight     = gp.rearAxleHeight + paramDelta;
    if (selectedParamId === 'wheelbase')       ovr.wheelbase          = gp.wheelbase + paramDelta;
    if (selectedParamId === 'cogHeight')       ovr.cogHeight          = cog.Y_cg + paramDelta;
    if (selectedParamId === 'rakeAngle')       ovr.headAngle          = gp.headAngle + paramDelta;
    if (selectedParamId === 'cspHeight')       ovr.cspHeightDelta     = paramDelta;
    if (selectedParamId === 'swingarmAngle')   ovr.swingarmAngleDelta = paramDelta;
    if (selectedParamId === 'swingarmLength')  ovr.swingarmLengthDelta= paramDelta;
    if (selectedParamId === 'frontSprocket')   ovr.frontSprocketDelta = Math.round(paramDelta);
    return computeAllMetrics(gp, input.chain, cog, susp, ovr);
  }, [selectedParamId, paramDelta, gp, input.chain, cog, susp]);

  // ── Sweep data (for selected parameter across full range) ────────────────────
  const sweepData = useMemo(() => {
    const steps = 20;
    const range = paramDef.max - paramDef.min;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const delta = paramDef.min + (range / steps) * i;
      const ovr: Parameters<typeof computeAllMetrics>[4] = {};
      if (selectedParamId === 'rearAxleHeight')  ovr.rearAxleHeight     = gp.rearAxleHeight + delta;
      if (selectedParamId === 'wheelbase')       ovr.wheelbase          = gp.wheelbase + delta;
      if (selectedParamId === 'cogHeight')       ovr.cogHeight          = cog.Y_cg + delta;
      if (selectedParamId === 'rakeAngle')       ovr.headAngle          = gp.headAngle + delta;
      if (selectedParamId === 'cspHeight')       ovr.cspHeightDelta     = delta;
      if (selectedParamId === 'swingarmAngle')   ovr.swingarmAngleDelta = delta;
      if (selectedParamId === 'swingarmLength')  ovr.swingarmLengthDelta= delta;
      if (selectedParamId === 'frontSprocket')   ovr.frontSprocketDelta = Math.round(delta);
      const m = computeAllMetrics(gp, input.chain, cog, susp, ovr);
      return {
        x: parseFloat(delta.toFixed(2)),
        as: isFinite(m.as.antiSquatPercent) ? parseFloat(m.as.antiSquatPercent.toFixed(2)) : null,
        ad: isFinite(m.ad.ad_geometric_pct) ? parseFloat(m.ad.ad_geometric_pct.toFixed(2)) : null,
      };
    });
  }, [selectedParamId, paramDef, gp, input.chain, cog, susp]);

  // ── Lean sweep ───────────────────────────────────────────────────────────────
  const leanSweep = useMemo(
    () => computeLeanSweep(baseline.as.antiSquatPercent, gp.wheelbase, cog.Y_cg),
    [baseline.as.antiSquatPercent, gp.wheelbase, cog.Y_cg],
  );
  const leanPoint = leanSweep.find(p => p.lean_deg === leanDeg) ?? leanSweep[0];

  // ── Load transfer (baseline) ─────────────────────────────────────────────────
  const lt = useMemo(
    () => computeLoadTransfer(cog.totalMass, gp.wheelbase, cog.X_cg, cog.Y_cg, input.dynamics.accelG, brakeG),
    [cog.totalMass, gp.wheelbase, cog.X_cg, cog.Y_cg, input.dynamics.accelG, brakeG],
  );

  // ── Chain loads ──────────────────────────────────────────────────────────────
  const PITCH_MM = 15.875;
  const r_CSP_mm = (input.chain.frontSprocket * PITCH_MM) / (2 * Math.PI);
  const GR = input.chain.rearSprocket / Math.max(input.chain.frontSprocket, 1);
  const chainLoads = useMemo(
    () => computeChainLoads(engineTorque, GR, r_CSP_mm, lt.W_rear_dynamic, gp.swingarmLength, baseline.as.chainForceAngleAuto || 5),
    [engineTorque, GR, r_CSP_mm, lt.W_rear_dynamic, gp.swingarmLength, baseline.as.chainForceAngleAuto],
  );

  // ── Colors ───────────────────────────────────────────────────────────────────
  const asBase   = isFinite(baseline.as.antiSquatPercent) ? baseline.as.antiSquatPercent : 0;
  const asMod    = isFinite(modified.as.antiSquatPercent) ? modified.as.antiSquatPercent : asBase;
  const asDelta  = asMod - asBase;

  const targetColor = baseline.target.inRange ? C.green
    : Math.abs(baseline.target.deviation) < 10 ? C.orange : C.danger;

  const jackupColor = leanPoint.jackup_risk === 'None' ? C.green
    : leanPoint.jackup_risk === 'Low'     ? C.blue
    : leanPoint.jackup_risk === 'Moderate'? C.orange : C.danger;

  const causeEffect = CAUSE_EFFECT[selectedParamId];

  // ── Current param display value ──────────────────────────────────────────────
  const currentBaseValue: Record<string, number> = {
    rearAxleHeight: gp.rearAxleHeight,
    wheelbase:      gp.wheelbase,
    cogHeight:      cog.Y_cg,
    rakeAngle:      gp.headAngle,
    cspHeight:      gp.swingarmPivotHeight + input.chain.sprocketCenterY,
    swingarmAngle:  results.geometry.swingarmAngleDeg,
    swingarmLength: gp.swingarmLength,
    frontSprocket:  input.chain.frontSprocket,
  };

  // ── Right-tab button helper ──────────────────────────────────────────────────
  const RTab = ({ id, label }: { id: typeof rightTab; label: string }) => (
    <button onClick={() => setRightTab(id)} style={{
      padding: '3px 10px', fontSize: 10, border: 'none', cursor: 'pointer', borderRadius: 3,
      background: rightTab === id ? C.cyan : '#21262d',
      color: rightTab === id ? '#000' : C.muted,
      fontWeight: rightTab === id ? 700 : 400,
    }}>{label}</button>
  );

  return (
    <div style={{
      display: 'flex', width: '100%', height: '100%',
      background: 'var(--bg-primary)', overflow: 'hidden',
      fontFamily: 'Consolas, "Courier New", monospace',
    }}>

      {/* ════════════ LEFT COLUMN — Results & Info ════════════ */}
      <div style={{
        width: '36%', minWidth: 300, maxWidth: 420,
        overflowY: 'auto', padding: '12px 12px',
        borderRight: `1px solid ${C.border}`,
      }}>

        {/* Header */}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.cyan, marginBottom: 2 }}>
          Anti-Dive & Load Transfer
        </div>
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 10 }}>
          Geometric anti-dive · Load transfer · Parameter sensitivity (§1–§9)
        </div>

        {/* ── AS% Gauge ────────────────────────────────────── */}
        <div style={{ padding: '8px 10px', background: '#161b22', borderRadius: 6, marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>
            ANTI-SQUAT %
            <span style={{ float: 'right', color: '#484f58' }}>
              {baseline.target.category}
            </span>
          </div>
          <ASGauge value={asMod} baseline={asBase} />
          <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 9 }}>
            <span><span style={{ color: '#6e7681' }}>▬</span> baseline: {fmt(asBase, 1)}%</span>
            {Math.abs(asDelta) > 0.1 && (
              <span style={{ color: asDelta > 0 ? C.green : C.danger, fontWeight: 700 }}>
                modified: {fmt(asMod, 1)}% ({fmtDelta(asDelta, 1, '%')})
              </span>
            )}
          </div>
        </div>

        {/* ── Anti-Dive ──────────────────────────────────────── */}
        <SectionHdr title="Anti-Dive — Telescopic Fork (§2.6)" color={C.cyan} />
        <KV label="Geometric AD%" value={fmt(baseline.ad.ad_geometric_pct, 1)} unit="%"
          color={baseline.ad.ad_geometric_pct > 30 ? C.green : C.orange}
          sub="tan(ε)/tan(θ_front_LT)×100" />
        <KV label="Effective practical AD%" value={fmt(baseline.ad.ad_effective_pct, 1)} unit="%"
          color={C.muted} sub="friction losses ~75%" />
        <KV label="θ_front_LT (front LT angle)" value={fmt(baseline.ad.theta_front_LT * 180 / Math.PI, 1)} unit="°" />
        <KV label="Fork axis ht at rear axle" value={fmt(baseline.ad.h_fork_at_rear, 0)} unit="mm" color={C.green} />
        <KV label="LT line ht at rear axle" value={fmt(baseline.ad.h_LT_at_rear, 0)} unit="mm" color={C.orange} />
        <KV label="Fork dive @ {brakeG}g" value={fmt(baseline.ad.fork_dive_mm, 1)} unit="mm"
          color={baseline.ad.fork_dive_mm > 35 ? C.orange : C.green} />

        {/* ── Load Transfer ──────────────────────────────────── */}
        <SectionHdr title="Load Transfer (§1.3)" color={C.accent} />
        <KV label="Static F/R split"
          value={`${fmt(lt.W_front_static / (lt.W_front_static + lt.W_rear_static) * 100, 1)}% / ${fmt(lt.W_rear_static / (lt.W_front_static + lt.W_rear_static) * 100, 1)}%`} />
        <div style={{ marginTop: 6, fontSize: 9 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 1fr 1fr', gap: '2px 0',
            padding: '3px 0', borderBottom: `1px solid ${C.border}`, color: C.muted }}>
            <span>g-level</span><span style={{ textAlign: 'right' }}>Rear (accel)</span>
            <span style={{ textAlign: 'right' }}>Front (brake)</span>
          </div>
          {lt.gLevels.map(r => (
            <div key={r.g} style={{
              display: 'grid', gridTemplateColumns: '0.6fr 1fr 1fr',
              padding: '2px 0', borderBottom: `1px solid #161b22`,
            }}>
              <span style={{ color: C.muted }}>{r.g}g</span>
              <span style={{ textAlign: 'right', color: r.g >= 0.8 ? C.accent2 : C.primary }}>
                {r.W_rear.toFixed(0)} N
              </span>
              <span style={{ textAlign: 'right', color: r.g >= 0.8 ? C.cyan : C.primary }}>
                {r.W_front_brake.toFixed(0)} N
              </span>
            </div>
          ))}
        </div>

        {/* ── Design Target ──────────────────────────────────── */}
        <SectionHdr title="Design Target (§9.1)" color={C.accent2} />
        <div style={{ marginBottom: 6 }}>
          <Badge label={baseline.target.category} color={targetColor} />
          <span style={{ fontSize: 9, color: C.muted, marginLeft: 8 }}>
            Target: {baseline.target.targetMin}–{baseline.target.targetMax}%
          </span>
        </div>
        {(() => {
          const DESIGN_TARGETS = baseline.target.allTargets;
          return (
            <div style={{ fontSize: 9, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
              {DESIGN_TARGETS.map(t => {
                const isMatch = asBase >= t.targetMin && asBase <= t.targetMax;
                const isModMatch = asMod >= t.targetMin && asMod <= t.targetMax && Math.abs(asDelta) > 0.1;
                return (
                  <div key={t.category} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '3px 7px',
                    background: isMatch ? '#1c3a2a' : isModMatch ? '#1a2c1a' : 'transparent',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{ color: isMatch ? C.green : C.muted }}>
                      {isMatch && '● '}{t.category}
                      {isModMatch && !isMatch && <span style={{ color: C.orange }}> ← modified</span>}
                    </span>
                    <span style={{ color: isMatch ? C.green : '#484f58', fontWeight: isMatch ? 700 : 400 }}>
                      {t.targetMin}–{t.targetMax}%
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── IC Zone ──────────────────────────────────────── */}
        <SectionHdr title="IC Placement (§9.3)" color={C.purple} />
        {isFinite(baseline.as.IC_x) ? (
          <>
            <KV label="IC height" value={fmt(baseline.as.IC_y, 0)} unit="mm" />
            <KV label="IC height / h_CoG" value={fmt(baseline.icZone.h_IC_pct_of_CoG, 1)} unit="%" />
            <KV label="IC fwd of rear axle" value={fmt(baseline.icZone.x_IC_mm_forward_of_rear, 0)} unit="mm" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
              {[
                { l: 'Sport h (55–70%)', ok: baseline.icZone.sport_h_ok },
                { l: 'Sport x (250–450mm)', ok: baseline.icZone.sport_x_ok },
                { l: 'Naked h (45–60%)', ok: baseline.icZone.naked_h_ok },
                { l: 'Naked x (200–380mm)', ok: baseline.icZone.naked_x_ok },
              ].map(({ l, ok }) => (
                <div key={l} style={{
                  fontSize: 9, padding: '3px 6px',
                  background: ok ? '#1c3a2a' : '#21262d',
                  border: `1px solid ${ok ? '#2ea04340' : C.border}`, borderRadius: 3,
                }}>
                  <Dot ok={ok} />
                  <span style={{ color: ok ? C.green : C.muted }}>{l}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: C.muted }}>IC not computed (CVT or parallel lines)</div>
        )}

        {/* ── Corner Exit ──────────────────────────────────── */}
        <SectionHdr title="Corner Exit — AS% at Lean (§7.1)" color={C.orange} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: C.muted, width: 80 }}>Lean angle:</span>
          <input type="range" min={0} max={60} step={5} value={leanDeg}
            onChange={e => setLeanDeg(parseInt(e.target.value))} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, width: 28, textAlign: 'right' }}>
            {leanDeg}°
          </span>
        </div>
        <KV label="AS% effective at lean" value={fmt(leanPoint.AS_effective_pct, 1)} unit="%"
          color={leanPoint.AS_effective_pct > 115 ? C.danger
            : leanPoint.AS_effective_pct > 105 ? C.orange : C.green} />
        <KV label="Jackup risk" value={leanPoint.jackup_risk} color={jackupColor} />
        <KV label="L_effective" value={fmt(leanPoint.L_effective_mm, 0)} unit="mm" />

        {/* ── Chain Structural ─────────────────────────────── */}
        <SectionHdr title="Chain Tension & Structural (§6.4)" color={C.accent} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: C.muted, width: 130 }}>Engine torque (N·m):</span>
          <input type="number" min={30} max={300} value={engineTorque}
            onChange={e => setEngineTorque(parseFloat(e.target.value) || 120)}
            style={{ width: 55, fontSize: 11, background: '#0d1117', border: `1px solid ${C.border}`, color: C.primary, padding: '2px 4px', borderRadius: 3 }} />
        </div>
        <KV label="Chain tension T_chain" value={chainLoads.T_chain >= 1000 ? fmt(chainLoads.T_chain / 1000, 2) : fmt(chainLoads.T_chain, 0)}
          unit={chainLoads.T_chain >= 1000 ? 'kN' : 'N'} color={C.orange}
          sub="T_eng × GR / r_CSP" />
        <KV label="Peak bending stress" value={fmt(chainLoads.sigma_bending, 1)} unit="MPa"
          color={chainLoads.sigma_bending > 120 ? C.danger : chainLoads.sigma_bending > 80 ? C.orange : C.green} />

        {/* ── Geometry Checklist ───────────────────────────── */}
        <SectionHdr title="Geometry Checklist (§9.6/9.7)" color={C.accent2} />
        {(() => {
          const isSport = asBase >= 85;
          const sw = baseline.swAngleDeg;
          const trail = results.geometry.trail;
          const items = isSport
            ? [
                { l: 'Swingarm angle 3–6°',    ok: sw >= 3 && sw <= 6 },
                { l: 'AS% 85–105%',             ok: asBase >= 85 && asBase <= 105 },
                { l: 'IC h 55–70% of CoG',      ok: baseline.icZone.sport_h_ok },
                { l: 'IC x 250–450mm fwd RA',   ok: baseline.icZone.sport_x_ok },
                { l: 'WB 1370–1430mm',           ok: gp.wheelbase >= 1370 && gp.wheelbase <= 1430 },
                { l: 'Trail 90–110mm',           ok: trail >= 90 && trail <= 110 },
              ]
            : [
                { l: 'Swingarm angle 1–4°',    ok: sw >= 1 && sw <= 4 },
                { l: 'AS% 70–88%',              ok: asBase >= 70 && asBase <= 88 },
                { l: 'IC h 45–60% of CoG',      ok: baseline.icZone.naked_h_ok },
                { l: 'IC x 200–380mm fwd RA',   ok: baseline.icZone.naked_x_ok },
                { l: 'WB 1430–1490mm',           ok: gp.wheelbase >= 1430 && gp.wheelbase <= 1490 },
                { l: 'Trail 100–120mm',          ok: trail >= 100 && trail <= 120 },
              ];
          return (
            <div>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>
                Profile: {isSport ? 'Sport (AS% ≥ 85%)' : 'Naked/Street (AS% < 85%)'}
              </div>
              {items.map(({ l, ok }) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, padding: '2px 0' }}>
                  <Dot ok={ok} />
                  <span style={{ color: ok ? C.primary : C.muted, flex: 1 }}>{l}</span>
                  <span style={{ color: ok ? C.green : C.orange, fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
                </div>
              ))}
            </div>
          );
        })()}

      </div>

      {/* ════════════ RIGHT COLUMN — Parameter Playground ════════════ */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 0,
      }}>

        {/* ── PARAMETER PLAYGROUND HEADER ──────────────────────── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, marginBottom: 4 }}>
            Parameter Sensitivity Playground
            <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
              Change one parameter — all downstream metrics recompute live (§3 + §4)
            </span>
          </div>

          {/* Parameter selector */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
            {PARAMS.map(p => (
              <button key={p.id} onClick={() => { setSelectedParamId(p.id); setParamDelta(0); }}
                style={{
                  padding: '4px 9px', fontSize: 9, border: 'none', cursor: 'pointer', borderRadius: 3,
                  background: selectedParamId === p.id ? C.orange : '#21262d',
                  color: selectedParamId === p.id ? '#000' : C.muted,
                  fontWeight: selectedParamId === p.id ? 700 : 400,
                }}>
                {p.label}
                <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.7 }}>{p.pdfSection}</span>
              </button>
            ))}
          </div>

          {/* Slider + current value */}
          <div style={{
            padding: '10px 14px', background: '#161b22',
            border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.orange }}>{paramDef.label}</span>
              <span style={{ fontSize: 9, color: C.muted }}>{paramDef.pdfSection}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, width: 50, textAlign: 'right' }}>
                {fmtDelta(paramDef.min, 1)}{paramDef.unit}
              </span>
              <input type="range"
                min={paramDef.min} max={paramDef.max} step={paramDef.step}
                value={paramDelta}
                onChange={e => setParamDelta(parseFloat(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ fontSize: 9, color: C.muted, width: 50 }}>
                +{paramDef.max}{paramDef.unit}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 10 }}>
              <span style={{ color: C.muted }}>
                Baseline: <span style={{ color: C.primary, fontFamily: 'Consolas', fontWeight: 600 }}>
                  {fmt(currentBaseValue[selectedParamId], selectedParamId === 'frontSprocket' ? 0 : 1)}{paramDef.unit}
                </span>
              </span>
              <span style={{ color: C.muted }}>
                Delta: <span style={{ color: paramDelta === 0 ? C.muted : C.orange, fontFamily: 'Consolas', fontWeight: 600 }}>
                  {fmtDelta(paramDelta, 1)}{paramDef.unit}
                </span>
              </span>
              <span style={{ color: C.muted }}>
                Modified: <span style={{ color: C.orange, fontFamily: 'Consolas', fontWeight: 700 }}>
                  {fmt(currentBaseValue[selectedParamId] + paramDelta, selectedParamId === 'frontSprocket' ? 0 : 1)}{paramDef.unit}
                </span>
              </span>
              <button onClick={() => setParamDelta(0)}
                style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 8px', background: '#21262d', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 3, cursor: 'pointer' }}>
                Reset
              </button>
            </div>
            <div style={{ fontSize: 9, color: '#484f58', marginTop: 8, lineHeight: 1.5 }}>
              {paramDef.description}
            </div>
          </div>

          {/* ── Before / After comparison table ── */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.primary, marginBottom: 6 }}>
              EFFECT ON ALL METRICS
              {Math.abs(asDelta) < 0.1 && <span style={{ color: C.muted, fontWeight: 400, marginLeft: 8 }}>— no change (delta = 0)</span>}
            </div>
            <div style={{
              border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
                padding: '4px 6px', background: '#161b22',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 9, color: C.muted, fontWeight: 700,
              }}>
                <span>Metric</span>
                <span style={{ textAlign: 'right' }}>Baseline</span>
                <span style={{ textAlign: 'right' }}>Modified</span>
                <span style={{ textAlign: 'right' }}>Delta</span>
              </div>
              <CmpRow label="Anti-Squat %"
                baseline={baseline.as.antiSquatPercent} modified={modified.as.antiSquatPercent}
                unit="%" positiveGood={true} dp={1} />
              <CmpRow label="IC Height (h_IC)"
                baseline={baseline.as.IC_y} modified={modified.as.IC_y}
                unit="mm" positiveGood={true} dp={0} />
              <CmpRow label="IC fwd of RA"
                baseline={baseline.icZone.x_IC_mm_forward_of_rear} modified={modified.icZone.x_IC_mm_forward_of_rear}
                unit="mm" positiveGood={true} dp={0} />
              <CmpRow label="IC ht / h_CoG"
                baseline={baseline.icZone.h_IC_pct_of_CoG} modified={modified.icZone.h_IC_pct_of_CoG}
                unit="%" positiveGood={true} dp={1} />
              <CmpRow label="Swingarm Angle"
                baseline={baseline.swAngleDeg} modified={modified.swAngleDeg}
                unit="°" positiveGood={true} dp={2} />
              <CmpRow label="Chain Force Angle"
                baseline={baseline.as.chainForceAngleAuto} modified={modified.as.chainForceAngleAuto}
                unit="°" positiveGood={true} dp={2} />
              <CmpRow label="Load Transfer @0.8g"
                baseline={baseline.lt.deltaW_accel} modified={modified.lt.deltaW_accel}
                unit="N" positiveGood={false} dp={0} />
              <CmpRow label="Rear Dynamic Load @0.8g"
                baseline={baseline.lt.W_rear_dynamic} modified={modified.lt.W_rear_dynamic}
                unit="N" positiveGood={true} dp={0} />
              <CmpRow label="Geometric AD%"
                baseline={baseline.ad.ad_geometric_pct} modified={modified.ad.ad_geometric_pct}
                unit="%" positiveGood={true} dp={1} />
              <CmpRow label="Fork Dive @0.8g"
                baseline={baseline.ad.fork_dive_mm} modified={modified.ad.fork_dive_mm}
                unit="mm" positiveGood={false} dp={1} />
              <CmpRow label="AS% at 30° lean"
                baseline={baseline.AS_at_30} modified={modified.AS_at_30}
                unit="%" positiveGood={false} dp={1} />
              <CmpRow label="Wheelbase (effective)"
                baseline={baseline.WB} modified={modified.WB}
                unit="mm" positiveGood={false} dp={0} />
            </div>
          </div>

          {/* ── Right-side tab switcher ── */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: C.muted, alignSelf: 'center', marginRight: 4 }}>View:</span>
            <RTab id="sweep"   label="AS% Sweep Chart" />
            <RTab id="diagram" label="Anti-Dive Diagram" />
            <RTab id="lean"    label="Lean Analysis" />
            <RTab id="load"    label="Load Transfer" />
          </div>

          {/* ── SWEEP CHART ────────────────────────────────── */}
          {rightTab === 'sweep' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, marginBottom: 6 }}>
                AS% + AD% vs {paramDef.label} — full parameter range
                <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                  Orange line = current delta position
                </span>
              </div>
              <SweepChart
                paramDef={paramDef}
                currentDelta={paramDelta}
                baselineAS={asBase}
                sweepData={sweepData as { x: number; as: number; ad: number }[]}
              />
            </div>
          )}

          {/* ── PHYSICS GEOMETRY DIAGRAM (Anti-Dive + Anti-Squat) ─────────── */}
          {rightTab === 'diagram' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, marginBottom: 6 }}>
                Full Physics Geometry Diagram (§2.6 + §8)
                <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                  Swingarm · Chain force line · IC · Anti-squat line · Fork axis (AD%)
                </span>
              </div>
              {modified.squat ? (
                <PhysicsGeometryDiagram
                  analysis={modified.squat}
                  frontWheelRadius={gp.frontWheelDia / 2}
                  headAngle_deg={gp.headAngle + (selectedParamId === 'rakeAngle' ? paramDelta : 0)}
                  forkOffset_mm={gp.forkOffset}
                  adPercent={modified.ad.ad_geometric_pct}
                />
              ) : (
                <div style={{ padding: 20, color: C.warn, fontSize: 11 }}>
                  ⚠ Geometry diagram unavailable — check parameters.
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, marginTop: 5, fontSize: 9, color: C.muted }}>
                <span><span style={{ color: C.blue }}>━━</span> Swingarm</span>
                <span><span style={{ color: '#ff9933' }}>╌╌</span> Chain force line</span>
                <span><span style={{ color: '#e3b341' }}>●</span> Instant Centre (IC)</span>
                <span><span style={{ color: '#79c0ff' }}>╌╌</span> Anti-squat line</span>
                <span><span style={{ color: C.green }}>━━</span> Fork axis (AD%)</span>
              </div>
            </div>
          )}

          {/* ── LEAN ANALYSIS CHART ────────────────────────── */}
          {rightTab === 'lean' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, marginBottom: 6 }}>
                AS% Effective vs Lean Angle (§7.1)
                <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                  AS%_eff = AS%_upright / cos(φ) — upright AS% = {fmt(asBase, 1)}%
                </span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={leanSweep.map(p => ({
                  lean: p.lean_deg,
                  as_base: parseFloat((asBase / Math.cos(p.lean_deg * Math.PI / 180)).toFixed(1)),
                  as_mod: parseFloat((asMod / Math.cos(p.lean_deg * Math.PI / 180)).toFixed(1)),
                }))} margin={{ top: 4, right: 20, bottom: 20, left: 40 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#21262d" />
                  <XAxis dataKey="lean" tick={{ fontSize: 9, fill: C.muted }}
                    label={{ value: 'Lean angle (°)', position: 'insideBottom', offset: -12, fontSize: 9, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 9, fill: C.muted }} unit="%" width={36} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 10 }}
                    formatter={(v: unknown, name: unknown) => {
                      const n = typeof v === 'number' ? v : 0;
                      return [`${n.toFixed(1)}%`, name === 'as_base' ? 'Baseline AS%' : 'Modified AS%'];
                    }} />
                  <ReferenceLine y={100} stroke={C.danger} strokeDasharray="4,2"
                    label={{ value: '100%', position: 'right', fontSize: 9, fill: C.danger }} />
                  <ReferenceLine y={115} stroke={C.orange} strokeDasharray="4,2"
                    label={{ value: '115%', position: 'right', fontSize: 9, fill: C.orange }} />
                  <Line type="monotone" dataKey="as_base" stroke="#6e7681"
                    strokeWidth={1.5} dot={false} name="as_base" />
                  <Line type="monotone" dataKey="as_mod" stroke={C.green}
                    strokeWidth={2} dot={false} name="as_mod" strokeDasharray={Math.abs(asDelta) < 0.1 ? '4,2' : undefined} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── LOAD TRANSFER CHART ────────────────────────── */}
          {rightTab === 'load' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, marginBottom: 6 }}>
                Axle Load vs Acceleration / Braking
                <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                  ΔW = M·a·h_CoG / L (§1.3)
                </span>
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, display: 'flex', gap: 12 }}>
                <span><span style={{ color: C.green }}>■</span> Rear (accel)</span>
                <span><span style={{ color: C.blue }}>■</span> Front (brake)</span>
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart
                  data={[
                    { label: 'Static', rear: lt.W_rear_static, front: lt.W_front_static },
                    ...lt.gLevels.map(r => ({ label: `${r.g}g`, rear: r.W_rear, front: r.W_front_brake })),
                  ]}
                  margin={{ top: 4, right: 8, bottom: 4, left: 36 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 9, fill: C.muted }} unit=" N" width={42} />
                  <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 10 }}
                    formatter={(v: unknown) => {
                      const n = typeof v === 'number' ? v : 0;
                      return [`${n.toFixed(0)} N`];
                    }} />
                  <Bar dataKey="rear" fill={C.green} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="front" fill={C.blue} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── CAUSE → EFFECT CHAIN (PDF §4) ─────────────────── */}
        {causeEffect && (
          <div style={{
            padding: '10px 14px', background: '#0d1117',
            border: `1px solid #30363d`, borderRadius: 6, marginTop: 4,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, marginBottom: 8 }}>
              CAUSE → EFFECT CHAIN (PDF §4): {causeEffect.title}
            </div>
            <div style={{ fontFamily: 'Consolas, monospace', fontSize: 9, lineHeight: 1.9 }}>
              {causeEffect.chain.map((line, i) => {
                const depth = line.match(/^(\s*→\s*)/)
                  ? line.indexOf('→') / 2 : 0;
                const isFirst = i === 0;
                const isKey = line.includes('AS%') || line.includes('IC') || line.includes('anti-squat') || line.includes('AD%');
                return (
                  <div key={i} style={{
                    paddingLeft: depth * 8,
                    color: isFirst ? C.orange
                      : isKey ? C.green
                      : line.includes('jackup') || line.includes('conflict') || line.includes('loss') ? C.danger
                      : '#8b949e',
                    fontWeight: isFirst || isKey ? 600 : 400,
                  }}>
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── EQUATIONS REFERENCE (PDF Appendix B) ──────────── */}
        <div style={{
          padding: '8px 12px', background: '#161b22',
          border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 10,
          fontSize: 9, color: '#6e7681', lineHeight: 1.7,
        }}>
          <span style={{ color: C.primary, fontWeight: 700 }}>Key Equations (Appendix B):</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 16px', marginTop: 4 }}>
            {[
              ['ΔW = M·a·h_CoG / L', 'Load transfer (§1.3)'],
              ['AS% = (h_FL / h_LT) × 100', 'Anti-squat % (§1.4)'],
              ['AD%_geo = tan(ε)/tan(θ_LT_front)', 'Geometric anti-dive (§2.6)'],
              ['h_IC ≈ h_pivot + L_sw·sin(θ_sw)', 'IC height single-pivot (§2.2)'],
              ['T_chain = T_eng·GR / r_CSP', 'Chain tension (§6.4)'],
              ['AS%_lean = AS%_upright / cos(φ)', 'AS% at lean (§7.1)'],
              ['L_eff = L·cos(φ)', 'Effective wheelbase at lean'],
              ['tan(θ_LT) = h_CoG / x_CoG_rear', 'Load transfer line angle'],
            ].map(([eq, desc]) => (
              <div key={eq}>
                <span style={{ color: C.accent2 }}>{eq}</span>
                <span style={{ color: '#484f58' }}> — {desc}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
