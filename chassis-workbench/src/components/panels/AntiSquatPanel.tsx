/**
 * AntiSquatPanel.tsx — Interactive Anti-Squat Parameter Playground
 *
 * PDF Reference: "Anti-Squat and Anti-Dive Characteristics in Motorcycles", Rev 1.0
 *
 * KEY FEATURE: Interactive Parameter Playground
 *   Select any geometric parameter, adjust with slider → ALL downstream
 *   metrics recompute live: AS%, IC position, σ, τ, R, chain angle, lean.
 *   Cause→Effect chain visualization from PDF §4.
 *
 * Physics:
 *   Foale graphical method — line from rear contact patch through IC
 *   intercept at front axle vertical / h_CoG × 100 = AS%
 *   Cossalter squat ratio R = tan(τ)/tan(σ)
 *   Unified engine: computeAntiSquatUnified (auto chain force angle)
 */

import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { computeSquatAnalysis, squatCondition } from '../../engine/antiSquatAnalysis';
import { computeAntiSquatUnified } from '../../engine/antiSquat';
import { classifyDesignTarget, checkICZone, computeLeanSweep } from '../../engine/antiDiveEngine';
import PhysicsGeometryDiagram from '../visualization/PhysicsGeometryDiagram';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  accent:  'var(--accent)',
  cyan:    'var(--cyan)',
  warn:    'var(--warn)',
  danger:  '#f85149',
  muted:   'var(--text-muted)',
  primary: 'var(--text-primary)',
  border:  '#21262d',
  green:   '#3fb950',
  blue:    '#58a6ff',
  orange:  '#e3b341',
  purple:  'var(--purple)',
};

const DEG2RAD = Math.PI / 180;

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

// ─── Small components ─────────────────────────────────────────────────────────

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
      <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: color ?? C.primary, fontWeight: 600 }}>
        {val}{unit && <span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function SectionHdr({ title, color = C.cyan }: { title: string; color?: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color,
      textTransform: 'uppercase', borderBottom: `1px solid ${color}40`,
      paddingBottom: 4, marginBottom: 8, marginTop: 16,
    }}>
      {title}
    </div>
  );
}

// ─── Parameter definitions ────────────────────────────────────────────────────

interface ParamDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  description: string;
  pdfSection: string;
}

const PARAMS: ParamDef[] = [
  {
    id: 'rearAxleHeight', label: 'Rear Axle Height', unit: 'mm',
    min: -30, max: 40, step: 2,
    description: 'Raises rear axle → swingarm steepens → IC rises → AS% increases. +10 mm ≈ +5–8% AS%.',
    pdfSection: '§3.4',
  },
  {
    id: 'cspHeight', label: 'CSP Height (Countershaft)', unit: 'mm',
    min: -30, max: 40, step: 2,
    description: 'Most underappreciated lever. Higher countershaft steepens chain line → IC rises → AS% increases. +10 mm ≈ +4–7% AS%.',
    pdfSection: '§3.3',
  },
  {
    id: 'cspPositionX', label: 'CSP Position X (fwd/aft)', unit: 'mm',
    min: -40, max: 40, step: 5,
    description: 'Move countershaft forward/rearward → chain line angle shifts → IC moves horizontally → AS% changes ±2–4%.',
    pdfSection: '§3.3',
  },
  {
    id: 'swingarmAngle', label: 'Swingarm Angle', unit: '°',
    min: -4, max: 5, step: 0.5,
    description: 'Rotate swingarm (keeping length) → IC moves up/down → AS% changes +4–6% per degree. Display convention: CW+ (typical downward slope = positive, e.g. +4° to +8°). Delta here adds directly to geometry angle.',
    pdfSection: '§3.1',
  },
  {
    id: 'swingarmLength', label: 'Swingarm Length', unit: 'mm',
    min: -60, max: 80, step: 5,
    description: 'Longer arm → rear moves back (WB increases) → chain flatter → net AS% −3–5% unless angle compensated.',
    pdfSection: '§3.2',
  },
  {
    id: 'wheelbase', label: 'Wheelbase', unit: 'mm',
    min: -100, max: 100, step: 10,
    description: 'Longer WB reduces load transfer (ΔW = M·a·h/L). τ shallows → R changes → squat tendency varies.',
    pdfSection: '§3.5',
  },
  {
    id: 'cogHeight', label: 'CoG Height (h_CoG)', unit: 'mm',
    min: -80, max: 80, step: 5,
    description: 'Higher CoG → steeper load transfer line → R increases → more squat tendency. Naked bikes ≈ 40–60 mm higher than sport.',
    pdfSection: '§3.6',
  },
  {
    id: 'frontSprocket', label: 'Front Sprocket', unit: ' teeth',
    min: -3, max: 3, step: 1,
    description: 'Larger front sprocket → drive radius increases → chain tangent shifts → IC moves → AS% changes ±3–5%/tooth.',
    pdfSection: '§5.2',
  },
  {
    id: 'rearSprocket', label: 'Rear Sprocket', unit: ' teeth',
    min: -8, max: 8, step: 1,
    description: 'Larger rear sprocket → rear radius increases → chain tangent shifts (opposite direction) → AS% changes ±2–4%/tooth.',
    pdfSection: '§5.2',
  },
];

// ─── Cause→Effect chains ──────────────────────────────────────────────────────

const CAUSE_EFFECT: Record<string, { chain: string[]; title: string }> = {
  rearAxleHeight: {
    title: 'Chain A: Raised Rear Axle Height',
    chain: [
      'RAISE rear axle height (+10 mm)',
      '→ Swingarm angle steepens (same pivot, higher axle)',
      '  → Swingarm extension line rotates upward',
      '    → Intersection with chain force line (IC) moves up',
      '      → Squat line (Pr → IC) angle σ increases',
      '        → AS% increases +5–8%',
      '          → Rear suspension extends more under acceleration',
      '→ Ride height increases → static weight distribution shifts rearward',
      '→ Suspension sag changes → spring preload may need adjustment',
    ],
  },
  cspHeight: {
    title: 'Chain B: Raised Countershaft Sprocket Height',
    chain: [
      'RAISE countershaft sprocket +10 mm (h_CSP)',
      '→ Top chain run steepens (higher start point)',
      '  → Upward chain tension component on rear sprocket increases',
      '    → Extension moment on swingarm about pivot INCREASES',
      '      → IC rises (chain force line rotates up)',
      '        → σ steepens → AS% increases +4–7%',
      '→ Lower (slack) chain run geometry changes',
      '  → Chain guide clearance may reduce under decel',
      '→ If engine mounts shift: CoG height slightly increases (+2–5 mm)',
      '  → Load transfer increases (partially offsets AS% gain)',
    ],
  },
  cspPositionX: {
    title: 'Chain B2: Countershaft Position (Fore/Aft)',
    chain: [
      'MOVE countershaft forward (-20 mm)',
      '→ Center-to-center line direction changes',
      '  → External tangent chain force angle shifts',
      '    → IC moves horizontally (forward/rearward)',
      '      → σ angle changes proportionally',
      '        → AS% changes ±2–4%',
      '→ Chain length changes (may require adjustment)',
      '→ Typically used in engine design phase, not field tuning',
    ],
  },
  swingarmAngle: {
    title: 'Chain A2: Swingarm Angle Change',
    chain: [
      'INCREASE swingarm angle (+1°)',
      '→ Swingarm extension line rotates upward',
      '  → IC height increases ~10 mm per degree',
      '    → Squat line (Pr → IC) steepens (σ increases)',
      '      → AS% increases +4–6% per degree',
      '        → Rear suspension extends under hard acceleration',
      '          → Above 100%: rear jack-up under power',
      '            → Spring unloads → reduced tire compliance',
      '  → Chain geometry marginally affected (drivetrain eff ±0.3%)',
    ],
  },
  swingarmLength: {
    title: 'Chain F: Longer Swingarm',
    chain: [
      'INCREASE swingarm length +40 mm',
      '→ Wheelbase increases ~35 mm (rear axle moves back)',
      '  → Load transfer REDUCES: ΔW ∝ 1/L → ~2.5% reduction',
      '    → Less squat tendency from inertia',
      '→ Chain line angle flattens (rear sprocket moved rearward)',
      '  → Chain contribution to AS% DECREASES',
      '→ Net AS%: typically −3–5% unless swingarm angle re-adjusted',
      '→ Rear traction stability improves under accel+cornering',
      '→ Wheelie tendency reduces (shorter lever for weight transfer)',
    ],
  },
  wheelbase: {
    title: 'Chain C: Wheelbase Increase',
    chain: [
      'INCREASE wheelbase +50 mm',
      '→ Load transfer DECREASES (ΔW = M·a·h/L — larger L)',
      '  → τ angle shallows (load transfer line less steep)',
      '    → R = tan(τ)/tan(σ) DECREASES → less squat tendency',
      '→ Squat line reference point (Pr) moves rearward',
      '  → For same IC, σ shallows → AS% slightly changes',
      '→ Steering geometry changes (increased stability)',
      '  → Cornering agility decreases',
      '→ Combined: typically neutral to slight anti-squat improvement',
    ],
  },
  cogHeight: {
    title: 'Chain D: Higher Centre of Gravity',
    chain: [
      'INCREASE h_CoG +40 mm (e.g., naked vs. sport geometry)',
      '→ Load transfer INCREASES: ΔW = M·a·h/L',
      '  → Rear squat tendency INCREASES',
      '    → HIGHER AS% needed to counteract (or softer compression)',
      '→ Load transfer line angle τ STEEPENS',
      '  → For same IC position: R = tan(τ)/tan(σ) INCREASES',
      '    → Must raise IC to compensate',
      '      → Steeper swingarm OR higher CSP required',
      '→ Wheelie threshold DECREASES',
      '→ AS%_eff at lean = AS%_upright / cos(φ) → jackup risk at corner exit',
    ],
  },
  frontSprocket: {
    title: 'Chain E: Front Sprocket Change',
    chain: [
      'INCREASE front sprocket +1 tooth',
      '→ Drive sprocket radius INCREASES',
      '  → External tangent offset α = arcsin((r_rear−r_drive)/D) DECREASES',
      '    → Chain force line angle shifts',
      '      → IC position moves',
      '        → AS% changes ±3–5% per tooth',
      '→ Overall gear ratio decreases (+1T = taller gearing)',
      '  → Chain tension at same engine torque DECREASES',
      '    → Lower bearing/pivot loads',
      '→ Most accessible field tuning method for AS% adjustment',
    ],
  },
  rearSprocket: {
    title: 'Chain E2: Rear Sprocket Change',
    chain: [
      'INCREASE rear sprocket +2 teeth',
      '→ Rear sprocket radius INCREASES',
      '  → External tangent offset α = arcsin((r_rear−r_drive)/D) INCREASES',
      '    → Chain force line angle shifts (opposite to front sprocket)',
      '      → IC position moves',
      '        → AS% changes ±2–4% per 2 teeth',
      '→ Overall gear ratio increases (+2T rear = shorter gearing)',
      '  → Chain tension at same engine torque INCREASES',
      '    → Higher bearing/pivot loads',
      '→ Combined +1T front / -2T rear: similar ratio, but different chain geometry',
    ],
  },
};

// ─── Core computation function ────────────────────────────────────────────────

type GpType    = ReturnType<typeof useStore.getState>['input']['geometry'];
type ChainType = ReturnType<typeof useStore.getState>['input']['chain'];
type CogType   = ReturnType<typeof useStore.getState>['results']['cog'];

interface ASOverrides {
  rearAxleHeight?:     number;
  wheelbase?:          number;
  cogHeight?:          number;
  cspHeightDelta?:     number;
  cspPositionDelta?:   number;
  swingarmAngleDelta?: number;
  swingarmLengthDelta?: number;
  frontSprocketDelta?: number;
  rearSprocketDelta?:  number;
}

function computeAllMetrics(
  gp: GpType, chain: ChainType, cog: CogType,
  overrides: ASOverrides = {},
) {
  const X_sp = gp.swingarmPivotX;
  const H_sp = gp.swingarmPivotHeight;

  let H_ra = overrides.rearAxleHeight ?? gp.rearAxleHeight;
  let WB   = overrides.wheelbase      ?? gp.wheelbase;
  const Y_cg = overrides.cogHeight    ?? cog.Y_cg;
  const X_cg = cog.X_cg;

  // Swingarm length delta: extend at current angle
  if (overrides.swingarmLengthDelta) {
    const ang = Math.atan2(H_ra - H_sp, WB - X_sp);
    H_ra = H_ra + overrides.swingarmLengthDelta * Math.sin(ang);
    WB   = WB   + overrides.swingarmLengthDelta * Math.cos(ang);
  }

  // Swingarm angle delta: rotate arm, keep length
  if (overrides.swingarmAngleDelta) {
    const ang0 = Math.atan2(H_ra - H_sp, WB - X_sp);
    const L_sa = Math.sqrt((WB - X_sp) ** 2 + (H_ra - H_sp) ** 2);
    const ang1 = ang0 + overrides.swingarmAngleDelta * DEG2RAD;
    H_ra = H_sp + L_sa * Math.sin(ang1);
    WB   = X_sp + L_sa * Math.cos(ang1);
  }

  // Modified chain params
  const modChain: ChainType = {
    ...chain,
    sprocketCenterY: chain.sprocketCenterY + (overrides.cspHeightDelta   ?? 0),
    sprocketCenterX: chain.sprocketCenterX + (overrides.cspPositionDelta ?? 0),
    frontSprocket: Math.max(8,  chain.frontSprocket + (overrides.frontSprocketDelta ?? 0)),
    rearSprocket:  Math.max(16, chain.rearSprocket  + (overrides.rearSprocketDelta  ?? 0)),
  };

  // Modified geometry
  const modGp: GpType = { ...gp, rearAxleHeight: H_ra, wheelbase: WB };

  // Run unified anti-squat engine
  const as = computeAntiSquatUnified(
    modChain, X_sp, H_sp, WB, H_ra, Y_cg,
    gp.headAngle, cog.R_front ?? 0, cog.totalWeight ?? (cog.totalMass * 9.81),
  );

  // Squat analysis (for diagram)
  let squat: ReturnType<typeof computeSquatAnalysis> | null = null;
  try {
    squat = computeSquatAnalysis(modGp, modChain, [X_cg, Y_cg]);
  } catch { /* ignore */ }

  // Derived geometry
  const swAngleDeg  = Math.atan2(H_ra - H_sp, WB - X_sp) * 180 / Math.PI;
  const chainAngle  = as.chainForceAngleAuto;
  const target      = classifyDesignTarget(isFinite(as.antiSquatPercent) ? as.antiSquatPercent : 0);
  const icZone      = checkICZone(as.IC_x, as.IC_y, WB, Y_cg);
  const AS_at_30    = isFinite(as.antiSquatPercent) ? as.antiSquatPercent / Math.cos(30 * DEG2RAD) : NaN;

  // σ and τ from squat analysis
  const sigma = squat?.staticPoint.sigma ?? NaN;
  const tau   = squat?.staticPoint.tau   ?? NaN;
  const R     = squat?.staticPoint.squatRatio ?? NaN;

  return { as, squat, target, icZone, swAngleDeg, chainAngle, AS_at_30, WB, H_ra, Y_cg, X_cg, sigma, tau, R };
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
          <span style={{ fontSize: 12, fontFamily: 'Consolas', fontWeight: 700, color: delta > 0 ? C.green : C.danger }}>
            {fmtDelta(delta, 1, '%')}
          </span>
        )}
      </div>
      <div style={{ position: 'relative', height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden' }}>
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
        <div style={{
          position: 'absolute', left: `${Math.min(baseline, 150) / 150 * 100}%`,
          width: 2, height: '100%', background: '#6e7681',
        }} />
        <div style={{
          position: 'absolute', left: `${Math.min(value, 150) / 150 * 100}%`,
          width: 3, height: '100%', background: color, boxShadow: `0 0 4px ${color}`,
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
      padding: '3px 6px', borderBottom: `1px solid ${C.border}`, fontSize: 10,
    }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: C.primary, fontFamily: 'Consolas', textAlign: 'right' }}>
        {fmt(baseline, dp)}{unit}
      </span>
      <span style={{ color: Math.abs(delta) < 0.05 ? C.primary : dc, fontFamily: 'Consolas', textAlign: 'right', fontWeight: Math.abs(delta) > 0.5 ? 700 : 400 }}>
        {fmt(modified, dp)}{unit}
      </span>
      <span style={{ color: dc, fontFamily: 'Consolas', textAlign: 'right', fontWeight: 700 }}>
        {Math.abs(delta) < 0.05 ? '—' : fmtDelta(delta, dp, unit)}
      </span>
    </div>
  );
}

// ─── Sweep Chart ──────────────────────────────────────────────────────────────

function SweepChartAS({ paramDef, currentDelta, baselineAS, sweepData }: {
  paramDef: ParamDef; currentDelta: number; baselineAS: number;
  sweepData: { x: number; as: number | null; R: number | null }[];
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, display: 'flex', gap: 12 }}>
        <span><span style={{ color: C.green }}>━━</span> AS% (anti-squat)</span>
        <span><span style={{ color: C.orange }}>╌╌</span> R (squat ratio ×100)</span>
        <span style={{ marginLeft: 'auto' }}>baseline ({fmt(baselineAS, 1)}%)</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={sweepData} margin={{ top: 4, right: 20, bottom: 20, left: 40 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#21262d" />
          <XAxis dataKey="x" tick={{ fontSize: 9, fill: C.muted }}
            label={{ value: `Δ${paramDef.label} (${paramDef.unit})`, position: 'insideBottom', offset: -12, fontSize: 9, fill: C.muted }} />
          <YAxis tick={{ fontSize: 9, fill: C.muted }} width={36} domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : 0;
              const label = name === 'as' ? 'AS%' : 'R×100';
              return [`${n.toFixed(1)}`, label];
            }}
            labelFormatter={(v: unknown) => `Δ${paramDef.label}: ${v}${paramDef.unit}`} />
          <ReferenceLine x={0} stroke="#6e7681" strokeDasharray="4,2" />
          <ReferenceLine x={currentDelta} stroke={C.warn} strokeWidth={1.5}
            label={{ value: 'current', position: 'insideTopLeft', fontSize: 8, fill: C.warn }} />
          <ReferenceLine y={100} stroke="#f85149" strokeDasharray="3,2" />
          <ReferenceLine y={100} stroke={C.orange} strokeDasharray="3,2" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="as" stroke={C.green} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="R" stroke={C.orange} strokeWidth={1.5} dot={false} strokeDasharray="4,2" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Lean Chart ───────────────────────────────────────────────────────────────

function LeanChart({ AS_upright, WB, Y_cg }: { AS_upright: number; WB: number; Y_cg: number }) {
  const sweep = useMemo(() => computeLeanSweep(AS_upright, WB, Y_cg), [AS_upright, WB, Y_cg]);
  return (
    <div>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
        <span style={{ color: C.green }}>━━</span> AS%_eff = AS%_upright / cos(φ)
        <span style={{ color: C.muted, marginLeft: 8 }}>upright = {fmt(AS_upright, 1)}%</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={sweep.map(p => ({ lean: p.lean_deg, as_eff: parseFloat(p.AS_effective_pct.toFixed(1)) }))} margin={{ top: 4, right: 20, bottom: 20, left: 40 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#21262d" />
          <XAxis dataKey="lean" tick={{ fontSize: 9, fill: C.muted }}
            label={{ value: 'Lean angle φ (°)', position: 'insideBottom', offset: -12, fontSize: 9, fill: C.muted }} />
          <YAxis tick={{ fontSize: 9, fill: C.muted }} unit="%" width={36} />
          <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 10 }}
            formatter={(v: unknown) => {
              const n = typeof v === 'number' ? v : 0;
              return [`${n.toFixed(1)}%`, 'AS%_eff'];
            }} />
          <ReferenceLine y={100} stroke="#f85149" strokeDasharray="3,2" />
          <ReferenceLine y={115} stroke={C.warn} strokeDasharray="3,2" />
          <Line type="monotone" dataKey="as_eff" stroke={C.green} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
        Red line = 100% (neutral) · Orange = 115% (jackup threshold)
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export default function AntiSquatPanel() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);

  const gp    = input.geometry;
  const chain = input.chain;
  const cog   = results.cog;

  // ── Local state ──────────────────────────────────────────────────────────────
  const [selectedParamId, setSelectedParamId] = useState('rearAxleHeight');
  const [paramDelta, setParamDelta]           = useState(0);
  const [leanDeg, setLeanDeg]                 = useState(30);
  const [rightTab, setRightTab]               = useState<'diagram' | 'sweep' | 'lean'>('sweep');

  const paramDef = PARAMS.find(p => p.id === selectedParamId) ?? PARAMS[0];

  // ── Baseline ────────────────────────────────────────────────────────────────
  const baseline = useMemo(() => computeAllMetrics(gp, chain, cog), [gp, chain, cog]);

  // ── Modified (with delta) ───────────────────────────────────────────────────
  const modified = useMemo(() => {
    const ovr: ASOverrides = {};
    if (selectedParamId === 'rearAxleHeight')  ovr.rearAxleHeight      = gp.rearAxleHeight + paramDelta;
    if (selectedParamId === 'wheelbase')        ovr.wheelbase           = gp.wheelbase + paramDelta;
    if (selectedParamId === 'cogHeight')        ovr.cogHeight           = cog.Y_cg + paramDelta;
    if (selectedParamId === 'cspHeight')        ovr.cspHeightDelta      = paramDelta;
    if (selectedParamId === 'cspPositionX')     ovr.cspPositionDelta    = paramDelta;
    if (selectedParamId === 'swingarmAngle')    ovr.swingarmAngleDelta  = paramDelta;
    if (selectedParamId === 'swingarmLength')   ovr.swingarmLengthDelta = paramDelta;
    if (selectedParamId === 'frontSprocket')    ovr.frontSprocketDelta  = Math.round(paramDelta);
    if (selectedParamId === 'rearSprocket')     ovr.rearSprocketDelta   = Math.round(paramDelta);
    return computeAllMetrics(gp, chain, cog, ovr);
  }, [selectedParamId, paramDelta, gp, chain, cog]);

  // ── Sweep data ───────────────────────────────────────────────────────────────
  const sweepData = useMemo(() => {
    const steps = 20;
    const range = paramDef.max - paramDef.min;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const delta = paramDef.min + (range / steps) * i;
      const ovr: ASOverrides = {};
      if (selectedParamId === 'rearAxleHeight')  ovr.rearAxleHeight      = gp.rearAxleHeight + delta;
      if (selectedParamId === 'wheelbase')        ovr.wheelbase           = gp.wheelbase + delta;
      if (selectedParamId === 'cogHeight')        ovr.cogHeight           = cog.Y_cg + delta;
      if (selectedParamId === 'cspHeight')        ovr.cspHeightDelta      = delta;
      if (selectedParamId === 'cspPositionX')     ovr.cspPositionDelta    = delta;
      if (selectedParamId === 'swingarmAngle')    ovr.swingarmAngleDelta  = delta;
      if (selectedParamId === 'swingarmLength')   ovr.swingarmLengthDelta = delta;
      if (selectedParamId === 'frontSprocket')    ovr.frontSprocketDelta  = Math.round(delta);
      if (selectedParamId === 'rearSprocket')     ovr.rearSprocketDelta   = Math.round(delta);
      const m = computeAllMetrics(gp, chain, cog, ovr);
      return {
        x:  parseFloat(delta.toFixed(2)),
        as: isFinite(m.as.antiSquatPercent) ? parseFloat(m.as.antiSquatPercent.toFixed(2)) : null,
        R:  isFinite(m.R) ? parseFloat((m.R * 100).toFixed(2)) : null,
      };
    });
  }, [selectedParamId, paramDef, gp, chain, cog]);

  // ── Display values ────────────────────────────────────────────────────────────
  const asBase  = isFinite(baseline.as.antiSquatPercent) ? baseline.as.antiSquatPercent : 0;
  const asMod   = isFinite(modified.as.antiSquatPercent) ? modified.as.antiSquatPercent : asBase;
  const asDelta = asMod - asBase;

  const condMod = squatCondition(modified.squat?.staticPoint.squatRatio ?? NaN);

  const leanSweep = useMemo(
    () => computeLeanSweep(modified.as.antiSquatPercent, modified.WB, modified.Y_cg),
    [modified.as.antiSquatPercent, modified.WB, modified.Y_cg],
  );
  const leanPoint = leanSweep.find(p => p.lean_deg === leanDeg) ?? leanSweep[0];

  const jackupColor = !leanPoint ? C.muted
    : leanPoint.jackup_risk === 'None' ? C.green
    : leanPoint.jackup_risk === 'Low'  ? C.blue
    : leanPoint.jackup_risk === 'Moderate' ? C.orange : C.danger;

  const causeEffect = CAUSE_EFFECT[selectedParamId];

  const currentBaseValue: Record<string, number> = {
    rearAxleHeight: gp.rearAxleHeight,
    wheelbase:      gp.wheelbase,
    cogHeight:      cog.Y_cg,
    cspHeight:      gp.swingarmPivotHeight + chain.sprocketCenterY,
    cspPositionX:   gp.swingarmPivotX + chain.sprocketCenterX,
    swingarmAngle:  results.geometry.swingarmAngleDeg,
    swingarmLength: gp.swingarmLength,
    frontSprocket:  chain.frontSprocket,
    rearSprocket:   chain.rearSprocket,
  };

  const RTab = ({ id, label }: { id: typeof rightTab; label: string }) => (
    <button onClick={() => setRightTab(id)} style={{
      padding: '3px 10px', fontSize: 10, border: 'none', cursor: 'pointer', borderRadius: 3,
      background: rightTab === id ? C.cyan : '#21262d',
      color: rightTab === id ? '#000' : C.muted,
    }}>
      {label}
    </button>
  );

  const targetColor = baseline.target.inRange ? C.green
    : Math.abs(baseline.target.deviation) < 10 ? C.orange : C.danger;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 0 }}>

      {/* ── LEFT: metrics ── */}
      <div style={{
        width: '34%', minWidth: 260, overflowY: 'auto',
        padding: '14px 12px', borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 0,
      }}>

        {/* CVT notice */}
        {chain.isCVT && (
          <div style={{
            background: '#1c1a00', border: '1px solid #e3b341',
            borderRadius: 8, padding: '8px 12px', marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#e3b341', marginBottom: 2 }}>
              CVT — Chain IC Not Applicable
            </div>
            <div style={{ fontSize: 9, color: '#b8956a', lineHeight: 1.5 }}>
              Belt/CVT drive has no fixed chain line. Foale IC method cannot be computed.
            </div>
          </div>
        )}

        {/* AS% Gauge */}
        <div style={{
          background: 'var(--surface)', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 12px', marginBottom: 10,
        }}>
          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>
            Anti-Squat % (Foale Method)
          </div>
          <ASGauge value={asMod} baseline={asBase} />
          <div style={{ fontSize: 8, color: C.muted, marginTop: 6 }}>
            Δ = {Math.abs(asDelta) < 0.05 ? '—' : fmtDelta(asDelta, 1, '%')} from baseline
          </div>
        </div>

        {/* Squat Condition */}
        <div style={{
          background: 'var(--surface)', border: `2px solid ${condMod.color}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 10,
        }}>
          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 2 }}>
            Squat Condition
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: condMod.color, fontFamily: 'Consolas' }}>
            {chain.isCVT ? 'CVT — N/A' : condMod.label}
          </div>
          <div style={{ fontSize: 10, color: condMod.color, marginTop: 2, fontFamily: 'Consolas' }}>
            R = {isFinite(modified.R) ? modified.R.toFixed(4) : '—'}
            <span style={{ fontSize: 9, color: C.muted, marginLeft: 8 }}>
              baseline R = {isFinite(baseline.R) ? baseline.R.toFixed(4) : '—'}
            </span>
          </div>
        </div>

        <SectionHdr title="IC Position" />
        <KV label="IC x (from front axle)" value={fmt(modified.as.IC_x, 1)} unit="mm" />
        <KV label="IC y (height)"          value={fmt(modified.as.IC_y, 1)} unit="mm" />
        <KV label="Swingarm angle"         value={fmt(modified.swAngleDeg, 3)} unit="°" />
        <KV label="Chain force angle"      value={fmt(modified.chainAngle, 3)} unit="°" />
        <KV label="σ (squat line)"         value={fmt(modified.sigma, 2)} unit="°" />
        <KV label="τ (load-transfer)"      value={fmt(modified.tau, 2)} unit="°" />

        {/* IC Zone Check */}
        <SectionHdr title="IC Zone Check (§9.3)" />
        {(() => {
          const z = modified.icZone;
          if (!z) return <div style={{ fontSize: 9, color: C.muted }}>—</div>;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { label: 'Sport h_IC (55–70% h_CoG)', ok: z.sport_h_ok },
                { label: 'Sport x_IC (250–450 mm)',   ok: z.sport_x_ok },
                { label: 'Naked h_IC (45–60% h_CoG)', ok: z.naked_h_ok },
                { label: 'Naked x_IC (200–380 mm)',   ok: z.naked_x_ok },
              ].map(({ label, ok }) => (
                <div key={label} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? C.green : C.muted, display: 'inline-block' }} />
                  <span style={{ color: ok ? C.green : C.muted }}>{label}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Design Target */}
        <SectionHdr title="Design Target (§9.1)" />
        <div style={{ fontSize: 9, color: targetColor, marginBottom: 6, fontFamily: 'Consolas' }}>
          Best match: <strong>{baseline.target.category}</strong>
          {!baseline.target.inRange && ` (off by ${Math.abs(baseline.target.deviation).toFixed(1)}%)`}
        </div>
        {baseline.target.allTargets?.map(t => {
          const active = t.category === baseline.target.category;
          return (
            <div key={t.category} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '2px 4px',
              background: active ? `${targetColor}15` : 'transparent',
              borderRadius: 3, fontSize: 9,
            }}>
              <span style={{ color: active ? targetColor : C.muted }}>{t.category}</span>
              <span style={{ color: active ? targetColor : '#484f58', fontFamily: 'Consolas' }}>{t.targetMin}–{t.targetMax}%</span>
            </div>
          );
        })}

        {/* Lean / Corner Exit */}
        <SectionHdr title="Corner Exit — AS% at Lean (§7.1)" />
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>
          AS%_eff = AS%_upright / cos(φ)
        </div>
        <input type="range" min={0} max={55} step={5} value={leanDeg}
          onChange={e => setLeanDeg(+e.target.value)}
          style={{ width: '100%', accentColor: C.cyan, marginBottom: 4 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
          <span style={{ color: C.muted }}>Lean angle φ = {leanDeg}°</span>
          {leanPoint && (
            <span style={{ fontFamily: 'Consolas', fontWeight: 700, color: jackupColor }}>
              {fmt(leanPoint.AS_effective_pct, 1)}% eff
            </span>
          )}
        </div>
        {leanPoint && (
          <div style={{
            fontSize: 10, fontWeight: 700, color: jackupColor,
            background: `${jackupColor}15`, borderRadius: 4, padding: '3px 7px',
            border: `1px solid ${jackupColor}40`,
          }}>
            {leanPoint.jackup_risk === 'None'     && 'No jack-up risk'}
            {leanPoint.jackup_risk === 'Low'      && 'Low jackup risk'}
            {leanPoint.jackup_risk === 'Moderate' && 'Moderate jackup risk — monitor'}
            {leanPoint.jackup_risk === 'High'     && 'HIGH jackup risk — rear rises under power at this lean'}
          </div>
        )}
        {chain.isCVT && (
          <div style={{ fontSize: 9, color: C.muted, marginTop: 6 }}>
            CVT: chain-based AS% not applicable — only swingarm geometry contribution shown.
          </div>
        )}

      </div>

      {/* ── RIGHT: playground ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── Parameter Selector ── */}
        <div>
          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>
            Select Parameter to Explore
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {PARAMS.map(p => (
              <button key={p.id} onClick={() => { setSelectedParamId(p.id); setParamDelta(0); }}
                style={{
                  padding: '4px 10px', fontSize: 10, border: 'none', cursor: 'pointer', borderRadius: 4,
                  background: selectedParamId === p.id ? C.cyan : '#21262d',
                  color: selectedParamId === p.id ? '#000' : C.muted,
                  fontWeight: selectedParamId === p.id ? 700 : 400,
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Slider ── */}
        <div style={{
          background: 'var(--surface)', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.primary }}>
              {paramDef.label}
              <span style={{ fontSize: 9, color: C.muted, marginLeft: 6 }}>{paramDef.pdfSection}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 9, color: C.muted }}>
                base: {fmt(currentBaseValue[selectedParamId], 1)}{paramDef.unit}
              </span>
              <span style={{ fontSize: 12, fontFamily: 'Consolas', fontWeight: 700, color: C.cyan }}>
                Δ {fmtDelta(paramDelta, paramDef.step < 1 ? 1 : 0, paramDef.unit)}
              </span>
            </div>
          </div>
          <input type="range"
            min={paramDef.min} max={paramDef.max} step={paramDef.step} value={paramDelta}
            onChange={e => setParamDelta(+e.target.value)}
            style={{ width: '100%', accentColor: C.cyan, marginBottom: 4 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
            <span>{paramDef.min}{paramDef.unit}</span>
            <button onClick={() => setParamDelta(0)} style={{
              fontSize: 9, background: 'none', border: `1px solid ${C.border}`,
              borderRadius: 3, color: C.muted, cursor: 'pointer', padding: '0 6px',
            }}>Reset Δ</button>
            <span>{paramDef.max}{paramDef.unit}</span>
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
            {paramDef.description}
          </div>
        </div>

        {/* ── Before / After comparison table ── */}
        <div style={{ background: 'var(--surface)', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
            padding: '5px 6px', borderBottom: `1px solid ${C.border}`,
            fontSize: 9, color: C.muted, fontWeight: 700,
          }}>
            <span>Metric</span>
            <span style={{ textAlign: 'right' }}>Baseline</span>
            <span style={{ textAlign: 'right' }}>Modified</span>
            <span style={{ textAlign: 'right' }}>Delta</span>
          </div>
          <CmpRow label="AS% (Foale)" baseline={baseline.as.antiSquatPercent} modified={modified.as.antiSquatPercent} unit="%" />
          <CmpRow label="Squat ratio R" baseline={baseline.R} modified={modified.R} dp={3} positiveGood={false} />
          <CmpRow label="σ (squat line angle)" baseline={baseline.sigma} modified={modified.sigma} unit="°" dp={2} />
          <CmpRow label="τ (load-transfer angle)" baseline={baseline.tau} modified={modified.tau} unit="°" dp={2} positiveGood={false} />
          <CmpRow label="IC height" baseline={baseline.as.IC_y} modified={modified.as.IC_y} unit="mm" />
          <CmpRow label="IC position x" baseline={baseline.as.IC_x} modified={modified.as.IC_x} unit="mm" dp={0} />
          <CmpRow label="Swingarm angle" baseline={baseline.swAngleDeg} modified={modified.swAngleDeg} unit="°" dp={3} />
          <CmpRow label="Chain force angle" baseline={baseline.chainAngle} modified={modified.chainAngle} unit="°" dp={3} />
          <CmpRow label="Swingarm-only AS%" baseline={baseline.as.asSwingarmOnly} modified={modified.as.asSwingarmOnly} unit="%" />
          <CmpRow label="Chain contribution" baseline={baseline.as.chainContribution} modified={modified.as.chainContribution} unit="%" />
          <CmpRow label="Wheelbase" baseline={baseline.WB} modified={modified.WB} unit="mm" dp={0} />
          <CmpRow label="AS% at 30° lean" baseline={baseline.AS_at_30} modified={modified.AS_at_30} unit="%" positiveGood={false} />
        </div>

        {/* ── Right tabs ── */}
        <div style={{ display: 'flex', gap: 5 }}>
          <RTab id="sweep"   label="AS% Sweep Chart" />
          <RTab id="diagram" label="Geometry Diagram" />
          <RTab id="lean"    label="Lean Analysis" />
        </div>

        {rightTab === 'sweep' && (
          <SweepChartAS
            paramDef={paramDef}
            currentDelta={paramDelta}
            baselineAS={asBase}
            sweepData={sweepData}
          />
        )}

        {rightTab === 'diagram' && modified.squat && (
          <div>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>
              Diagram updates live with slider — shows IC position for current delta.
            </div>
            <PhysicsGeometryDiagram
              analysis={modified.squat}
              frontWheelRadius={gp.frontWheelDia / 2}
              headAngle_deg={gp.headAngle}
              forkOffset_mm={gp.forkOffset}
            />
          </div>
        )}
        {rightTab === 'diagram' && !modified.squat && (
          <div style={{ padding: 20, color: C.warn, fontSize: 11 }}>
            ⚠ Geometry diagram unavailable — check parameters.
          </div>
        )}

        {rightTab === 'lean' && (
          <LeanChart
            AS_upright={modified.as.antiSquatPercent}
            WB={modified.WB}
            Y_cg={modified.Y_cg}
          />
        )}

        {/* ── Cause→Effect chain ── */}
        {causeEffect && (
          <div style={{
            background: '#0d1117', border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, marginBottom: 8 }}>
              {causeEffect.title}
            </div>
            {causeEffect.chain.map((step, i) => {
              const isMain = !step.startsWith('  ') && !step.startsWith('→ ');
              const indent  = (step.match(/^(\s+)/) ?? [''])[0].length;
              return (
                <div key={i} style={{
                  fontSize: 9.5, lineHeight: 1.6,
                  paddingLeft: indent * 5 + 4,
                  color: isMain ? C.primary : indent > 4 ? C.muted : '#8b949e',
                  fontFamily: isMain ? 'inherit' : 'Consolas, monospace',
                  fontWeight: isMain ? 600 : 400,
                }}>
                  {step}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Equations reference ── */}
        <div style={{
          background: '#0d1117', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Key Equations (Foale / Cossalter)
          </div>
          {[
            { eq: 'IC',       formula: 'intersection(swingarm line, chain force line)' },
            { eq: 'σ',        formula: 'atan2(IC_y − Pr_y, IC_x − Pr_x)' },
            { eq: 'τ',        formula: 'atan2(Y_cg, X_cg − WB)' },
            { eq: 'R',        formula: 'tan(τ) / tan(σ)   [Cossalter Ch.5]' },
            { eq: 'AS%',      formula: '(h_at_front_axle_vertical / Y_cg) × 100   [Foale Ch.11]' },
            { eq: 'AS%_eff',  formula: 'AS%_upright / cos(φ)   [§7.1]' },
            { eq: 'θ_chain',  formula: 'θ_geom + arcsin((r_rear − r_drive) / D)   [external tangent]' },
            { eq: 'ΔW',       formula: 'M × a_g × g × h_CoG / L   [load transfer §1.3]' },
          ].map(({ eq, formula }) => (
            <div key={eq} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr',
              fontSize: 9, fontFamily: 'Consolas, monospace',
              padding: '2px 0', borderBottom: `1px solid ${C.border}20`,
            }}>
              <span style={{ color: C.cyan, fontWeight: 700 }}>{eq}</span>
              <span style={{ color: '#8b949e' }}>{formula}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
