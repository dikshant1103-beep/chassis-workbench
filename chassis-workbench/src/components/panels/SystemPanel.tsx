/**
 * SystemPanel.tsx — Unified System Parameters + 2D Diagram + Compare + Graphs
 *
 * Layout: three resizable columns
 *   Left  (params)  — all 12 parameter groups, collapsible, scrollable
 *   Center (viz)    — live ChassisViz2D + position mode load display
 *   Right  (results) — tabbed: Results | Compare | Graphs
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { ComputeAllResult } from '../../engine/types';
import ChassisViz2D from '../visualization/ChassisViz2D';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { computeAll } from '../../engine/computeAll';

// ── Coupling map ──────────────────────────────────────────────────────────────
const COUPLING: Record<string, string[]> = {
  headAngle:           ['trail', 'mechanicalTrail', 'steeringOffGnd'],
  forkOffset:          ['trail', 'mechanicalTrail', 'steeringOffGnd'],
  swingarmLength:      ['wheelbaseOut', 'swingarmAngle', 'frontPct', 'rearPct', 'fLoad', 'rLoad', 'antiSquat', 'icX', 'icY'],
  swingarmPivotHeight: ['swingarmAngle', 'antiSquat', 'icX', 'icY', 'wheelbaseOut', 'frontPct', 'rearPct'],
  swingarmPivotX:      ['wheelbaseOut', 'frontPct', 'rearPct', 'fLoad', 'rLoad'],
  wheelbase:           ['frontPct', 'rearPct', 'fLoad', 'rLoad'],
  frontWheelDia:       ['trail', 'mechanicalTrail'],
  rearWheelDia:        ['swingarmAngle', 'wheelbaseOut', 'frontPct', 'rearPct', 'antiSquat'],
  frontSprocket:       ['antiSquat', 'gearRatio', 'icX', 'icY', 'chainAngle'],
  rearSprocket:        ['antiSquat', 'gearRatio', 'icX', 'icY', 'chainAngle'],
  sprocketCenterX:     ['antiSquat', 'icX', 'icY', 'chainAngle'],
  sprocketCenterY:     ['antiSquat', 'icX', 'icY', 'chainAngle'],
  springRateFront:     ['natFreqF', 'wheelRateF', 'dampRatioF'],
  springRateRear:      ['natFreqR', 'wheelRateR', 'dampRatioR'],
  dampingCoeffFront:   ['dampRatioF'],
  dampingCoeffRear:    ['dampRatioR'],
  forkTravel:          ['natFreqF'],
  shockTravel:         ['natFreqR'],
  motionRatioFront:    ['natFreqF', 'wheelRateF'],
  motionRatioRear:     ['natFreqR', 'wheelRateR'],
};

// ── Compact slider ────────────────────────────────────────────────────────────
interface CSliderProps {
  id: string; label: string; value: number; min: number; max: number;
  step: number; unit: string; decimals?: number;
  onChange: (v: number) => void;
  onEnter: (id: string) => void; onLeave: () => void; active: boolean;
}
function CSlider({ id, label, value, min, max, step, unit, decimals = 0, onChange, onEnter, onLeave, active }: CSliderProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '105px 1fr 62px', alignItems: 'center', gap: 4, padding: '2px 3px', borderRadius: 3, background: active ? 'rgba(56,139,253,0.07)' : 'transparent', transition: 'background 0.12s' }}
      onMouseEnter={() => onEnter(id)} onMouseLeave={onLeave}>
      <span style={{ fontSize: 9, color: active ? '#c9d1d9' : '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: active ? '#58a6ff' : '#388bfd', cursor: 'pointer' }} />
      <span style={{ fontSize: 9.5, color: active ? '#58a6ff' : '#6e7681', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
        {value.toFixed(decimals)}{unit}
      </span>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
interface RCardProps {
  id: string; label: string; value: string; unit?: string;
  status?: 'good' | 'warn' | 'bad' | null; lit: boolean; flash: boolean;
}
function RCard({ label, value, unit, status, lit, flash }: RCardProps) {
  const sc = status === 'good' ? '#3fb950' : status === 'warn' ? '#d29922' : status === 'bad' ? '#f85149' : undefined;
  return (
    <div style={{ background: lit ? 'rgba(56,139,253,0.09)' : flash ? 'rgba(63,185,80,0.07)' : '#161b22', border: `1px solid ${lit ? '#388bfd' : flash ? '#3fb950' : '#21262d'}`, borderRadius: 4, padding: '4px 7px', minWidth: 0, transition: 'all 0.15s', boxShadow: lit ? '0 0 8px rgba(56,139,253,0.22)' : 'none' }}>
      <div style={{ fontSize: 7.5, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: lit ? '#79c0ff' : '#e6edf3', fontFamily: 'monospace' }}>{value}</span>
        {unit && <span style={{ fontSize: 8, color: '#6e7681', flexShrink: 0 }}>{unit}</span>}
        {sc && <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc, marginLeft: 2, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

// ── Read-only data row ────────────────────────────────────────────────────────
function DataRow({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px', borderRadius: 3, background: highlight ? 'rgba(56,139,253,0.06)' : 'transparent', marginBottom: 1 }}>
      <span style={{ fontSize: 8.5, color: '#8b949e' }}>{label}</span>
      <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#c9d1d9', fontWeight: 600 }}>{value}{unit ? <span style={{ color: '#6e7681', fontSize: 8 }}> {unit}</span> : null}</span>
    </div>
  );
}

// ── Section header (collapsible) ──────────────────────────────────────────────
function SH({ icon, title, color = '#58a6ff', open, onToggle }: { icon: string; title: string; color?: string; open: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 3px', cursor: 'pointer', borderBottom: `1px solid ${color}30`, marginBottom: open ? 3 : 0, userSelect: 'none' }}>
      <span style={{ color, fontSize: 10 }}>{icon}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>{title}</span>
      <span style={{ fontSize: 8, color: '#484f58' }}>{open ? '▲' : '▼'}</span>
    </div>
  );
}

function RG({ title, color = '#58a6ff' }: { title: string; color?: string }) {
  return (
    <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '6px 0 3px', borderBottom: `1px solid ${color}25`, marginBottom: 4, marginTop: 6 }}>{title}</div>
  );
}

// ── Position mode ─────────────────────────────────────────────────────────────
type PositionMode = 'static' | 'accel' | 'brake' | 'corner';
type RightTab = 'results' | 'effects' | 'compare' | 'graphs';
type GraphType = 'antiSquat_vs_axle' | 'natFreq_vs_spring' | 'load_vs_accel' | 'frontPct_vs_WB';

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function SystemPanel() {
  const geo    = useStore(s => s.input.geometry);
  const susp   = useStore(s => s.input.suspension);
  const chain  = useStore(s => s.input.chain);
  const masses = useStore(s => s.input.massComponents);
  const res    = useStore(s => s.results);
  const input  = useStore(s => s.input);

  const setGeo   = useStore(s => s.setGeometry);
  const setSusp  = useStore(s => s.setSuspension);
  const setChain = useStore(s => s.setChain);
  const updateMC = useStore(s => s.updateMassComponent);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [hovered,     setHovered]     = useState<string | null>(null);
  const [flashIds,    setFlashIds]    = useState<Set<string>>(new Set());
  const [rightTab,    setRightTab]    = useState<RightTab>('results');
  const [posMode,     setPosMode]     = useState<PositionMode>('static');
  const [graphType,   setGraphType]   = useState<GraphType>('antiSquat_vs_axle');
  const [baseline,    setBaseline]    = useState<ComputeAllResult | null>(null);
  const [openSects,   setOpenSects]   = useState<Record<string, boolean>>({
    steering: true, swingarm: true, wheels: false, suspension: true,
    chain: true, mass: false, spring: false, shock: false,
  });

  const toggleSect = (k: string) => setOpenSects(p => ({ ...p, [k]: !p[k] }));

  // ── Flash detection ───────────────────────────────────────────────────────
  const prevSnap = useRef<Record<string, number>>({});
  useEffect(() => {
    const snap: Record<string, number> = {
      trail: res.geometry.trail, mechanicalTrail: res.geometry.mechanicalTrail,
      swingarmAngle: res.geometry.swingarmAngleDeg,
      frontPct: res.cog.frontPercent, rearPct: res.cog.rearPercent,
      X_cg: res.cog.X_cg, Y_cg: res.cog.Y_cg,
      fLoad: res.cog.R_front, rLoad: res.cog.R_rear,
      antiSquat: res.antiSquat.antiSquatPercent,
      icX: res.antiSquat.IC_x, icY: res.antiSquat.IC_y,
      natFreqF: res.suspension.natFreqFront, natFreqR: res.suspension.natFreqRear,
      wheelRateF: res.suspension.wheelRateFront, wheelRateR: res.suspension.wheelRateRear,
      dampRatioF: res.suspension.dampingRatioFront, dampRatioR: res.suspension.dampingRatioRear,
    };
    const changed = new Set<string>(
      Object.entries(snap).filter(([k, v]) => k in prevSnap.current && prevSnap.current[k] !== v).map(([k]) => k)
    );
    prevSnap.current = snap;
    if (changed.size > 0) {
      setFlashIds(changed);
      const t = setTimeout(() => setFlashIds(new Set()), 650);
      return () => clearTimeout(t);
    }
  }, [
    res.geometry.trail, res.geometry.mechanicalTrail, res.geometry.swingarmAngleDeg,
    res.cog.frontPercent, res.cog.rearPercent, res.cog.X_cg, res.cog.Y_cg,
    res.cog.R_front, res.cog.R_rear, res.antiSquat.antiSquatPercent,
    res.antiSquat.IC_x, res.antiSquat.IC_y, res.suspension.natFreqFront,
    res.suspension.natFreqRear, res.suspension.wheelRateFront,
    res.suspension.wheelRateRear, res.suspension.dampingRatioFront,
    res.suspension.dampingRatioRear,
  ]);

  const lit = (id: string) => hovered ? (COUPLING[hovered] ?? []).includes(id) : false;
  const fl  = (id: string) => flashIds.has(id);

  // ── Full Motorcycle Dynamics (Foale / Cossalter formulas) ────────────────
  const { X_cg, Y_cg, R_front, R_rear, totalMass } = res.cog;
  const WB     = geo.wheelbase;
  const G      = 9.81;
  const M      = totalMass;
  const h_m    = Y_cg  / 1000;   // CoG height, metres
  const WB_m   = WB    / 1000;   // wheelbase, metres

  // Anti-squat / anti-dive from physics engine
  const AS_pct = res.antiSquat.antiSquatPercent;  // 0–150 %
  const AD_pct = isFinite(res.antiSquat.antiDivePercent) ? res.antiSquat.antiDivePercent : 0;
  const kF     = res.suspension.wheelRateFront;   // N/mm
  const kR     = res.suspension.wheelRateRear;    // N/mm

  // ── Static ──────────────────────────────────────────────────────────────
  // Eq 6.5/6.6  R_f = W*(WB-X_cg)/WB,  R_r = W*X_cg/WB
  // (already in res.cog)

  // ── 1g Longitudinal load transfer (Foale §3) ────────────────────────────
  // ΔW = M × a_g × g × h_cog / WB
  const dW_accel = M * 1.0 * G * h_m / WB_m;   // N  (1g accel → rear)
  const dW_brake = M * 1.0 * G * h_m / WB_m;   // N  (1g brake → front)

  // ── Rear squat under 1g accel ────────────────────────────────────────────
  // Anti-squat reduces actual suspension travel; tire load transfer unchanged.
  // squat_mm = (1 − AS%/100) × ΔW_rear / k_wheel_rear
  const squat_mm = kR > 0 ? (1 - AS_pct / 100) * dW_accel / kR : 0;

  // ── Fork dive under 1g braking ───────────────────────────────────────────
  // Anti-dive reduces actual fork compression; tire load transfer unchanged.
  // dive_mm = (1 − AD%/100) × ΔW_front / k_wheel_front
  const dive_mm = kF > 0 ? (1 - AD_pct / 100) * dW_brake / kF : 0;

  // ── Pitch angle under braking (chassis rotates forward) ─────────────────
  // θ_pitch ≈ arctan(dive_mm / WB_mm)  (small-angle, deg)
  const pitch_deg = WB > 0 ? Math.atan(dive_mm / WB) * (180 / Math.PI) : 0;

  // ── Effective CoG X shift due to pitch ──────────────────────────────────
  // When chassis pitches forward by θ, CoG moves Δx = h × sin(θ) forward
  const dx_cog_brake = Y_cg * Math.sin(pitch_deg * Math.PI / 180); // mm

  // ── 0.8g Cornering — Foale §4 ───────────────────────────────────────────
  // Steady-state lean: tan(φ) = a_lat  →  φ = atan(a_lat)
  const a_lat       = 0.8;
  const lean_deg    = Math.atan(a_lat) * (180 / Math.PI); // ≈ 38.7°
  // In the lean plane: effective CoG height = h × cos(φ)
  const cosPhi      = Math.cos(lean_deg * Math.PI / 180);
  const h_eff_m     = h_m * cosPhi;
  // Front/rear static loads unchanged; combine with cornering radius
  const v_kmh       = 80;  // reference speed for cornering
  const v_ms        = v_kmh / 3.6;
  const turn_R_m    = v_ms * v_ms / (a_lat * G);          // turning radius [m]
  // Lateral load transfer left→right across tyre track (approx 860mm track)
  const track_m     = 0.86;
  const dW_lat      = M * a_lat * G * h_eff_m / track_m;  // N per side
  const R_outer_N   = (M * G) / 2 + dW_lat;
  const R_inner_N   = (M * G) / 2 - dW_lat;
  // Combined brake+corner (0.4g longitudinal + 0.8g lateral — 0.89g vector)
  const dW_comb_long = M * 0.4 * G * h_eff_m / WB_m;
  const R_f_corner   = R_front + dW_comb_long;  // slight extra front load in corner
  const R_r_corner   = R_rear  - dW_comb_long;

  // ── Wheelie / Stoppie — read from engine (already uses Foale Eq 10.6) ────

  // ── Mode Loads table ─────────────────────────────────────────────────────
  type ModeData = {
    front: number; rear: number; label: string; color: string;
    dive: number; squat: number; pitch: number; lean: number; info: string;
  };
  const modeLoads: Record<PositionMode, ModeData> = {
    static: {
      front: R_front, rear: R_rear,
      label: 'Static (0g)', color: '#3fb950',
      dive: 0, squat: 0, pitch: 0, lean: 0,
      info: `CoG: X=${X_cg.toFixed(0)}mm  Y=${Y_cg.toFixed(0)}mm`,
    },
    accel: {
      front: R_front - dW_accel, rear: R_rear + dW_accel,
      label: '1g Acceleration', color: '#ffa657',
      dive: 0, squat: Math.max(squat_mm, 0), pitch: 0, lean: 0,
      info: `ΔW=${(dW_accel/G).toFixed(0)}kgf→rear  Squat ${Math.max(squat_mm,0).toFixed(0)}mm  AS=${AS_pct.toFixed(0)}%`,
    },
    brake: {
      front: R_front + dW_brake, rear: R_rear - dW_brake,
      label: '1g Braking', color: '#f85149',
      dive: Math.max(dive_mm, 0), squat: 0, pitch: pitch_deg, lean: 0,
      info: `ΔW=${(dW_brake/G).toFixed(0)}kgf→front  Dive ${Math.max(dive_mm,0).toFixed(0)}mm  AD=${AD_pct.toFixed(0)}%  Pitch ${pitch_deg.toFixed(1)}°`,
    },
    corner: {
      front: R_f_corner, rear: R_r_corner,
      label: '0.8g Corner', color: '#d2a8ff',
      dive: 0, squat: 0, pitch: 0, lean: lean_deg,
      info: `Lean ${lean_deg.toFixed(1)}°  R=${turn_R_m.toFixed(0)}m@${v_kmh}kmh  Outer ${(R_outer_N/G).toFixed(0)}kgf  Inner ${(R_inner_N/G).toFixed(0)}kgf`,
    },
  };
  const ml = modeLoads[posMode];
  const totalLoad = Math.max(ml.front + ml.rear, 1);
  const frontPctMode = (ml.front / totalLoad) * 100;
  const rearPctMode  = 100 - frontPctMode;

  // ════════════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE PHYSICS EFFECTS — all 10 groups (Foale / Cossalter / SAE)
  // ════════════════════════════════════════════════════════════════════════════

  // ── G1: Geometry Effects ─────────────────────────────────────────────────
  // Swingarm pivot-to-axle direct distance (= swingarm length, verification)
  const g1_pivotAxleDist = Math.sqrt(
    Math.pow(WB - geo.swingarmPivotX, 2) + Math.pow(geo.rearAxleHeight - geo.swingarmPivotHeight, 2)
  );
  const g1_sa_angle_cw   = -res.geometry.swingarmAngleDeg;  // CW positive (display convention)
  const g1_chainCC       = res.kinematics.positions[res.kinematics.staticIndex]?.chainCentreDistance ?? 0;
  const g1_chainAngle    = res.antiSquat.chainForceAngleAuto;
  const g1_rearAxlePos   = WB;  // from front axle
  // Swingarm horizontal reach: L_sa × cos(θ_sa)
  const g1_horizReach    = geo.swingarmLength * Math.cos(g1_sa_angle_cw * Math.PI / 180);
  // Fork trail — already in results
  const g1_trail         = res.geometry.trail;

  // ── G2: Mass & Load Distribution ─────────────────────────────────────────
  // CoG as % of wheelbase (from rear — shows how rear-biased the bike is)
  const g2_cog_from_rear_pct  = X_cg / WB * 100;
  const g2_ideal_front_pct    = 48;
  const g2_balance_error_pct  = res.cog.frontPercent - g2_ideal_front_pct;

  // ── G3: Weight Transfer Behavior ─────────────────────────────────────────
  // Pitch sensitivity = d(front%) / d(WB)  [%/mm WB change]
  // d/dWB [ (WB-X_cg)/WB × 100 ] = X_cg / WB² × 100
  const g3_pitch_sensitivity  = X_cg / (WB * WB) * 100;   // %/mm
  // h/WB ratio — governs all longitudinal load transfer
  const g3_hWB_ratio          = Y_cg / WB;
  // Load transfer per g = M × g × h/WB  [kgf/g]
  const g3_dW_per_g_kgf       = M * G * g3_hWB_ratio / G; // = M × h/WB [kg equivalent]
  // Brake bias (% of ΔW carried by front relative to rear)
  const g3_front_lift_margin  = res.stability.a_wheelie_g;
  const g3_rear_lift_margin   = res.stability.a_stoppie_g;
  // Pitch inertia influence: higher I_pitch → slower pitch transient
  const g3_pitch_inertia      = res.inertia.I_pitch;

  // ── G4: Anti-Squat / Drive Dynamics ─────────────────────────────────────
  const g4_AS_pct             = res.antiSquat.antiSquatPercent;
  const g4_chain_contrib      = res.antiSquat.chainContribution;
  const g4_IC_x               = res.antiSquat.IC_x;   // old coords: from front axle rearward
  const g4_IC_y               = res.antiSquat.IC_y;   // from ground
  // IC height as fraction of CoG height (>1 means IC above CoG — anti-lift)
  const g4_IC_hRatio          = Y_cg > 0 ? g4_IC_y / Y_cg : 0;
  // Squat / extension under throttle
  const g4_squat_mm_1g        = squat_mm;  // already computed
  const g4_drive_mode         = g4_AS_pct >= 100 ? 'Extension' : g4_AS_pct >= 80 ? 'Mild squat' : 'Squat';
  // Squat Ratio R (Cossalter): R = tan(τ)/tan(σ) where τ=chain angle, σ=swingarm angle
  const g4_squat_ratio        = g4_AS_pct / 100;

  // ── G5: Traction & Acceleration ─────────────────────────────────────────
  const g5_mu_dry             = 1.0;   // dry asphalt tire μ (Pacejka peak)
  const g5_mu_wet             = 0.55;  // wet road typical
  // Max acceleration before rear slip (traction-limited)
  const g5_a_traction_dry_g   = g5_mu_dry  * R_rear / (M * G);   // [g]
  const g5_a_traction_wet_g   = g5_mu_wet  * R_rear / (M * G);
  // What actually limits acceleration?
  const g5_a_limit_g          = Math.min(g5_a_traction_dry_g, res.stability.a_wheelie_g);
  const g5_limited_by         = res.stability.a_wheelie_g < g5_a_traction_dry_g ? 'Wheelie' : 'Traction';
  // Traction margin: how much room before wheelie vs traction-limited
  const g5_traction_margin    = (g5_a_traction_dry_g - res.stability.a_wheelie_g) / g5_a_traction_dry_g * 100;
  // Available rear traction [N] at static load
  const g5_avail_traction_N   = g5_mu_dry * R_rear;
  // Power delivery stability = rear load as % of total (higher = more stable)
  const g5_power_stability    = res.cog.rearPercent;

  // ── G6: Handling & Stability ─────────────────────────────────────────────
  const g6_I_yaw              = res.inertia.I_yaw;
  const g6_I_pitch            = res.inertia.I_pitch;
  const g6_I_roll             = res.inertia.I_roll;
  // Agility index = I_yaw / (M × WB²) — normalized yaw inertia (lower = more agile)
  const g6_agility_idx        = g6_I_yaw / (M * WB_m * WB_m);
  // Straight-line stability index = trail × WB/1000 (Foale heuristic)
  const g6_stability_idx      = res.geometry.trail * WB / 1000;   // mm²/1000
  // High-speed wobble sensitivity ∝ 1/(trail × wheelbase)
  const g6_wobble_sens        = 1000000 / (res.geometry.trail * WB);  // arbitrary scale
  // Turn-in response: inversely prop. to I_yaw — normalised against sport bike baseline
  const g6_turnin_idx         = 30 / Math.max(g6_I_yaw, 0.1);  // sport ~1.0, touring < 1.0
  // Chassis rigidity proxy: higher wheelbase = more flex potential

  // ── G7: Cornering ────────────────────────────────────────────────────────
  // Corner ENTRY: how much rear still loaded when braking 1g (before modeLoads is defined above)
  const g7_entry_rear_pct     = (R_rear - dW_brake) / (M * G) * 100;  // rear load at 1g brake as % of weight
  const g7_lat_sensitivity    = (dW_lat / (M * G)) * 100;
  const g7_exit_traction_idx  = g4_AS_pct / 100;
  const g7_min_R_m            = res.stability.R_turn_min_mm / 1000;
  const g7_combined_g         = Math.sqrt(0.4 * 0.4 + a_lat * a_lat);

  // ── G8: Suspension Interaction ───────────────────────────────────────────
  const rearWheelTravelFull   = susp.shockTravel * susp.motionRatioRear;
  const frontWheelTravelFull  = susp.forkTravel  * susp.motionRatioFront;
  // Squat / dive as % of available travel
  const g8_squat_pct          = rearWheelTravelFull > 0 ? (Math.max(squat_mm, 0) / rearWheelTravelFull) * 100 : 0;
  const g8_dive_pct           = frontWheelTravelFull > 0 ? (Math.max(dive_mm,  0) / frontWheelTravelFull) * 100 : 0;
  // Shock leverage ratio = wheel travel / shock stroke (= motionRatio)
  const g8_shock_leverage_r   = susp.motionRatioRear;
  const g8_shock_leverage_f   = susp.motionRatioFront;
  // Natural frequencies
  const g8_natFreqF           = res.suspension.natFreqFront;
  const g8_natFreqR           = res.suspension.natFreqRear;
  // Frequency difference (ideal: rear slightly lower than front for stability)
  const g8_freq_diff          = g8_natFreqF - g8_natFreqR;
  // Spring load at static sag
  const g8_sag_rear_mm        = rearWheelTravelFull * (res.suspension.sagPercentRear / 100);
  const g8_sag_front_mm       = frontWheelTravelFull * (res.suspension.sagPercentFront / 100);

  // ── G9: Packaging / Design Constraints ───────────────────────────────────
  // Chain length estimate: 2 × C-C / pitch (in links, 520 pitch = 15.875mm)
  const CHAIN_PITCH_MM        = 15.875;
  const g9_chain_links_est    = g1_chainCC > 0 ? Math.round(g1_chainCC * 2 / CHAIN_PITCH_MM) : 0;
  // Frame rear span = distance from swingarm pivot to rear axle (horizontal)
  const g9_frame_rear_span    = WB - geo.swingarmPivotX;
  // Swingarm overhang: how far rear axle extends past pivot vertically
  const g9_sa_overhang_v      = geo.rearAxleHeight - geo.swingarmPivotHeight;
  // Rear axle to seat
  // Chain line offset from swingarm axis [mm]
  const g9_chain_clearance    = chain.sprocketCenterY;   // vertical offset
  // Ground clearance check: pivot height must exceed min clearance
  const g9_clearance_ok       = geo.swingarmPivotHeight > 200;

  // ── G10: Secondary Dynamics ──────────────────────────────────────────────
  // Pitch inertia (already in inertia engine)
  const g10_I_pitch           = res.inertia.I_pitch;
  const g10_I_yaw             = res.inertia.I_yaw;
  const g10_I_roll            = res.inertia.I_roll;
  // h/WB ratio: governs load transfer sensitivity (Foale fundamental parameter)
  const g10_hWB               = Y_cg / WB;
  // Dynamic load sensitivity index = h/WB × (front% × rear%) / 100
  // This peaks at 50/50 distribution — shows how "sensitive" the bike is to accel inputs
  const g10_load_sens_idx     = g10_hWB * (res.cog.frontPercent * res.cog.rearPercent) / 100;
  // Gyroscopic stabilisation (proportional to wheel inertia × spin rate)
  // At 100km/h: ω = v / r_rear  [rad/s]
  const v_100_ms              = 100 / 3.6;
  const r_rear_m2             = geo.rearWheelDia / 2000;
  const g10_gyro_omega        = v_100_ms / r_rear_m2;  // wheel spin [rad/s]
  // Roll inertia drives weave frequency
  const g10_weave_proxy       = g10_I_roll / (M * r_rear_m2 * r_rear_m2);

  // ── Sweep data for graphs ─────────────────────────────────────────────────
  const NPTS = 18;

  const antiSquatSweep = useMemo(() => {
    const base_H_ra = geo.rearAxleHeight;
    return Array.from({ length: NPTS }, (_, i) => {
      const H_ra = base_H_ra - 25 + (50 * i / (NPTS - 1));
      try {
        const r = computeAll({ ...input, geometry: { ...geo, rearAxleHeight: H_ra, rearWheelDia: H_ra * 2 } });
        return { x: parseFloat(H_ra.toFixed(0)), as: parseFloat(r.antiSquat.antiSquatPercent.toFixed(1)) };
      } catch { return null; }
    }).filter(Boolean) as { x: number; as: number }[];
  }, [input, geo, geo.rearAxleHeight]);

  const natFreqSweep = useMemo(() => {
    const baseF = susp.springRateFront, baseR = susp.springRateRear;
    return Array.from({ length: NPTS }, (_, i) => {
      const scale = 0.3 + (1.7 * i / (NPTS - 1));
      try {
        const r = computeAll({ ...input, suspension: { ...susp, springRateFront: baseF * scale, springRateRear: baseR * scale } });
        return { x: parseFloat((baseF * scale).toFixed(1)), freqF: parseFloat(r.suspension.natFreqFront.toFixed(3)), freqR: parseFloat(r.suspension.natFreqRear.toFixed(3)) };
      } catch { return null; }
    }).filter(Boolean) as { x: number; freqF: number; freqR: number }[];
  }, [input, susp, susp.springRateFront, susp.springRateRear]);

  const loadAccelSweep = useMemo(() => {
    // dW_per_g = M * g * h_cog / WB  (N per g of longitudinal accel)
    const dWpg = M * G * h_m / WB_m;
    return Array.from({ length: NPTS }, (_, i) => {
      const a = 1.5 * i / (NPTS - 1);
      const frontN = R_front - dWpg * a;
      const rearN  = R_rear  + dWpg * a;
      const tot = Math.max(frontN + rearN, 1);
      return { x: parseFloat(a.toFixed(2)), frontPct: parseFloat((frontN / tot * 100).toFixed(1)), rearPct: parseFloat((rearN / tot * 100).toFixed(1)) };
    });
  }, [R_front, R_rear, M, G, h_m, WB_m]);

  const wbSweep = useMemo(() => {
    const baseWB = geo.wheelbase;
    return Array.from({ length: NPTS }, (_, i) => {
      const wb = baseWB - 60 + (120 * i / (NPTS - 1));
      try {
        const r = computeAll({ ...input, geometry: { ...geo, wheelbase: wb } });
        return { x: parseFloat(wb.toFixed(0)), frontPct: parseFloat(r.cog.frontPercent.toFixed(1)), rearPct: parseFloat(r.cog.rearPercent.toFixed(1)) };
      } catch { return null; }
    }).filter(Boolean) as { x: number; frontPct: number; rearPct: number }[];
  }, [input, geo, geo.wheelbase]);

  const totalMassKg = masses.reduce((s, m) => s + m.mass, 0);
  const saAngle = -res.geometry.swingarmAngleDeg;
  const frontWheelTravel = susp.forkTravel * susp.motionRatioFront;
  const rearWheelTravel  = susp.shockTravel * susp.motionRatioRear;
  const cogXpct = WB > 0 ? (X_cg / WB * 100) : 0;

  // ── Compare rows ──────────────────────────────────────────────────────────
  const compareRows: Array<{ label: string; cur: string; base: string | null; delta: string | null; good: boolean | null }> = [
    { label: 'Trail',      cur: `${res.geometry.trail.toFixed(1)} mm`,      base: baseline ? `${baseline.geometry.trail.toFixed(1)} mm` : null,      delta: baseline ? `${(res.geometry.trail - baseline.geometry.trail).toFixed(1)} mm` : null,      good: baseline ? Math.abs(res.geometry.trail - 100) < Math.abs(baseline.geometry.trail - 100) : null },
    { label: 'SA Angle',   cur: `${saAngle.toFixed(2)}°`,                   base: baseline ? `${(-baseline.geometry.swingarmAngleDeg).toFixed(2)}°` : null,   delta: baseline ? `${(saAngle - (-baseline.geometry.swingarmAngleDeg)).toFixed(2)}°` : null,        good: null },
    { label: 'Wheelbase',  cur: `${geo.wheelbase.toFixed(0)} mm`,           base: baseline ? `${(baseline.kinematics.positions[baseline.kinematics.staticIndex]?.wheelbase ?? 0).toFixed(0)} mm` : null,  delta: baseline ? `${(geo.wheelbase - (baseline.kinematics.positions[baseline.kinematics.staticIndex]?.wheelbase ?? geo.wheelbase)).toFixed(0)} mm` : null,  good: null },
    { label: 'CoG X',      cur: `${X_cg.toFixed(0)} mm`,                   base: baseline ? `${baseline.cog.X_cg.toFixed(0)} mm` : null,             delta: baseline ? `${(X_cg - baseline.cog.X_cg).toFixed(0)} mm` : null,             good: null },
    { label: 'CoG Y',      cur: `${Y_cg.toFixed(0)} mm`,                   base: baseline ? `${baseline.cog.Y_cg.toFixed(0)} mm` : null,             delta: baseline ? `${(Y_cg - baseline.cog.Y_cg).toFixed(0)} mm` : null,             good: null },
    { label: 'Front %',    cur: `${res.cog.frontPercent.toFixed(1)} %`,     base: baseline ? `${baseline.cog.frontPercent.toFixed(1)} %` : null,      delta: baseline ? `${(res.cog.frontPercent - baseline.cog.frontPercent).toFixed(1)} %` : null,      good: baseline ? Math.abs(res.cog.frontPercent - 50) < Math.abs(baseline.cog.frontPercent - 50) : null },
    { label: 'Anti-Squat', cur: `${res.antiSquat.antiSquatPercent.toFixed(1)} %`, base: baseline ? `${baseline.antiSquat.antiSquatPercent.toFixed(1)} %` : null, delta: baseline ? `${(res.antiSquat.antiSquatPercent - baseline.antiSquat.antiSquatPercent).toFixed(1)} %` : null, good: baseline ? Math.abs(res.antiSquat.antiSquatPercent - 95) < Math.abs(baseline.antiSquat.antiSquatPercent - 95) : null },
    { label: 'Nat Freq F', cur: `${res.suspension.natFreqFront.toFixed(2)} Hz`,  base: baseline ? `${baseline.suspension.natFreqFront.toFixed(2)} Hz` : null,  delta: baseline ? `${(res.suspension.natFreqFront - baseline.suspension.natFreqFront).toFixed(2)} Hz` : null,  good: baseline ? Math.abs(res.suspension.natFreqFront - 1.1) < Math.abs(baseline.suspension.natFreqFront - 1.1) : null },
    { label: 'Nat Freq R', cur: `${res.suspension.natFreqRear.toFixed(2)} Hz`,   base: baseline ? `${baseline.suspension.natFreqRear.toFixed(2)} Hz` : null,   delta: baseline ? `${(res.suspension.natFreqRear - baseline.suspension.natFreqRear).toFixed(2)} Hz` : null,   good: baseline ? Math.abs(res.suspension.natFreqRear - 1.0) < Math.abs(baseline.suspension.natFreqRear - 1.0) : null },
    { label: 'Wheel Rate F', cur: `${res.suspension.wheelRateFront.toFixed(1)} N/mm`, base: baseline ? `${baseline.suspension.wheelRateFront.toFixed(1)} N/mm` : null, delta: baseline ? `${(res.suspension.wheelRateFront - baseline.suspension.wheelRateFront).toFixed(1)} N/mm` : null, good: null },
    { label: 'Wheel Rate R', cur: `${res.suspension.wheelRateRear.toFixed(1)} N/mm`,  base: baseline ? `${baseline.suspension.wheelRateRear.toFixed(1)} N/mm` : null,  delta: baseline ? `${(res.suspension.wheelRateRear - baseline.suspension.wheelRateRear).toFixed(1)} N/mm` : null,  good: null },
    { label: 'Damping F',  cur: `${res.suspension.dampingRatioFront.toFixed(2)}`,    base: baseline ? `${baseline.suspension.dampingRatioFront.toFixed(2)}` : null,    delta: baseline ? `${(res.suspension.dampingRatioFront - baseline.suspension.dampingRatioFront).toFixed(2)}` : null,    good: baseline ? Math.abs(res.suspension.dampingRatioFront - 0.7) < Math.abs(baseline.suspension.dampingRatioFront - 0.7) : null },
    { label: 'Wheelie g',  cur: `${res.stability.a_wheelie_g.toFixed(2)} g`,         base: baseline ? `${baseline.stability.a_wheelie_g.toFixed(2)} g` : null,         delta: baseline ? `${(res.stability.a_wheelie_g - baseline.stability.a_wheelie_g).toFixed(2)} g` : null,         good: baseline ? res.stability.a_wheelie_g > baseline.stability.a_wheelie_g : null },
    { label: 'Stoppie g',  cur: `${res.stability.a_stoppie_g.toFixed(2)} g`,         base: baseline ? `${baseline.stability.a_stoppie_g.toFixed(2)} g` : null,         delta: baseline ? `${(res.stability.a_stoppie_g - baseline.stability.a_stoppie_g).toFixed(2)} g` : null,         good: baseline ? res.stability.a_stoppie_g > baseline.stability.a_stoppie_g : null },
  ];

  const chartColors = { front: '#58a6ff', rear: '#3fb950', as: '#ffa657', freqF: '#58a6ff', freqR: '#3fb950' };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT COLUMN — ALL INPUT PARAMETERS
         ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ width: 270, minWidth: 230, maxWidth: 300, flexShrink: 0, overflowY: 'auto', padding: '10px 10px', borderRight: '1px solid #21262d' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', marginBottom: 8, letterSpacing: '0.06em' }}>
          ALL PARAMETERS
          {hovered && <span style={{ fontSize: 8, color: '#388bfd', marginLeft: 6, fontWeight: 400 }}>← coupled results lit →</span>}
        </div>

        {/* §1 Steering Geometry */}
        <SH icon="△" title="1. Steering Geometry" color="#58a6ff" open={openSects.steering} onToggle={() => toggleSect('steering')} />
        {openSects.steering && (
          <>
            <CSlider id="headAngle" label="Rake (Head Angle)" value={geo.headAngle} min={15} max={40} step={0.1} unit="°" decimals={1} onChange={v => setGeo({ headAngle: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'headAngle'} />
            <CSlider id="forkOffset" label="Fork Offset" value={geo.forkOffset} min={0} max={100} step={1} unit="mm" onChange={v => setGeo({ forkOffset: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'forkOffset'} />
            <CSlider id="forkLength" label="Fork Length" value={geo.forkLength} min={400} max={1000} step={5} unit="mm" onChange={v => setGeo({ forkLength: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'forkLength'} />
            <DataRow label="Trail (derived)" value={res.geometry.trail.toFixed(1)} unit="mm" highlight />
            <DataRow label="Mech. Trail" value={res.geometry.mechanicalTrail.toFixed(1)} unit="mm" />
            <DataRow label="Seat Height" value={geo.seatHeight.toFixed(0)} unit="mm" />
            <DataRow label="Ground Clearance" value={geo.groundClearance.toFixed(0)} unit="mm" />
          </>
        )}

        {/* §2 Swingarm & Wheelbase */}
        <SH icon="⟶" title="2. Swingarm & Wheelbase" color="#3fb950" open={openSects.swingarm} onToggle={() => toggleSect('swingarm')} />
        {openSects.swingarm && (
          <>
            <div style={{ fontSize: 7.5, color: '#3fb950', padding: '3px 5px', borderLeft: '2px solid #3fb95070', background: 'rgba(63,185,80,0.06)', borderRadius: '0 3px 3px 0', marginBottom: 4, lineHeight: 1.5 }}>
              <strong>Frame-coupled:</strong> Swingarm length → WB changes → all mass positions scale proportionally → CoG X moves in diagram.<br />
              Pivot height → all mass Y positions shift → CoG Y updates.
            </div>
            <CSlider id="swingarmLength" label="Swingarm Length" value={geo.swingarmLength} min={350} max={800} step={5} unit="mm" onChange={v => setGeo({ swingarmLength: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'swingarmLength'} />
            <CSlider id="swingarmPivotHeight" label="Pivot Height" value={geo.swingarmPivotHeight} min={200} max={500} step={5} unit="mm" onChange={v => setGeo({ swingarmPivotHeight: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'swingarmPivotHeight'} />
            <CSlider id="swingarmPivotX" label="Pivot X (from FA)" value={geo.swingarmPivotX} min={600} max={1200} step={5} unit="mm" onChange={v => setGeo({ swingarmPivotX: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'swingarmPivotX'} />
            <CSlider id="wheelbase" label="Wheelbase" value={geo.wheelbase} min={1200} max={1800} step={5} unit="mm" onChange={v => setGeo({ wheelbase: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'wheelbase'} />
            <DataRow label="SA Angle (CW+, derived)" value={saAngle.toFixed(2)} unit="°" highlight />
          </>
        )}

        {/* §3 Wheel Dimensions */}
        <SH icon="○" title="3. Wheel & Axle" color="#d2a8ff" open={openSects.wheels} onToggle={() => toggleSect('wheels')} />
        {openSects.wheels && (
          <>
            <CSlider id="frontWheelDia" label="Front Wheel Dia" value={geo.frontWheelDia} min={500} max={750} step={5} unit="mm" onChange={v => setGeo({ frontWheelDia: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'frontWheelDia'} />
            <CSlider id="rearWheelDia" label="Rear Wheel Dia" value={geo.rearWheelDia} min={500} max={750} step={5} unit="mm" onChange={v => setGeo({ rearWheelDia: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'rearWheelDia'} />
            <DataRow label="Front Tyre Radius" value={res.geometry.frontWheelRadius.toFixed(0)} unit="mm" highlight />
            <DataRow label="Rear Tyre Radius" value={res.geometry.rearWheelRadius.toFixed(0)} unit="mm" highlight />
            <DataRow label="Front Axle Height" value={geo.frontAxleHeight.toFixed(0)} unit="mm" />
            <DataRow label="Rear Axle Height" value={geo.rearAxleHeight.toFixed(0)} unit="mm" />
          </>
        )}

        {/* §4 Travel & Suspension Motion */}
        <SH icon="≈" title="4. Travel & Suspension" color="#ffa657" open={openSects.suspension} onToggle={() => toggleSect('suspension')} />
        {openSects.suspension && (
          <>
            <CSlider id="forkTravel" label="Fork Travel" value={susp.forkTravel} min={50} max={350} step={5} unit="mm" onChange={v => setSusp({ forkTravel: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'forkTravel'} />
            <CSlider id="shockTravel" label="Shock Travel" value={susp.shockTravel} min={50} max={350} step={5} unit="mm" onChange={v => setSusp({ shockTravel: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'shockTravel'} />
            <CSlider id="motionRatioFront" label="Motion Ratio F" value={susp.motionRatioFront} min={0.5} max={1.0} step={0.01} unit="" decimals={2} onChange={v => setSusp({ motionRatioFront: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'motionRatioFront'} />
            <CSlider id="motionRatioRear" label="Motion Ratio R" value={susp.motionRatioRear} min={0.3} max={1.0} step={0.01} unit="" decimals={2} onChange={v => setSusp({ motionRatioRear: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'motionRatioRear'} />
            <DataRow label="Front Wheel Travel" value={frontWheelTravel.toFixed(0)} unit="mm" highlight />
            <DataRow label="Rear Wheel Travel" value={rearWheelTravel.toFixed(0)} unit="mm" highlight />
          </>
        )}

        {/* §5 Spring & Force */}
        <SH icon="⋈" title="5. Spring & Force" color="#79c0ff" open={openSects.spring ?? true} onToggle={() => toggleSect('spring')} />
        {(openSects.spring ?? true) && (
          <>
            <CSlider id="springRateFront" label="Front Spring Rate" value={susp.springRateFront} min={1} max={50} step={0.5} unit="N/mm" decimals={1} onChange={v => setSusp({ springRateFront: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'springRateFront'} />
            <CSlider id="springRateRear" label="Rear Spring Rate" value={susp.springRateRear} min={1} max={120} step={1} unit="N/mm" onChange={v => setSusp({ springRateRear: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'springRateRear'} />
            <DataRow label="Front Wheel Rate" value={res.suspension.wheelRateFront.toFixed(1)} unit="N/mm" highlight />
            <DataRow label="Rear Wheel Rate" value={res.suspension.wheelRateRear.toFixed(1)} unit="N/mm" highlight />
            <DataRow label="Front Force (static)" value={(res.cog.R_front / G).toFixed(0)} unit="kgf" />
            <DataRow label="Rear Force (static)" value={(res.cog.R_rear / G).toFixed(0)} unit="kgf" />
          </>
        )}

        {/* §6 Mass & CoG */}
        <SH icon="⊙" title="6. Mass & CoG" color="#d2a8ff" open={openSects.mass} onToggle={() => toggleSect('mass')} />
        {openSects.mass && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, padding: '4px 7px' }}>
                <div style={{ fontSize: 7.5, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>Total Mass</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' }}>{totalMassKg.toFixed(1)} <span style={{ fontSize: 8, color: '#6e7681' }}>kg</span></div>
              </div>
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, padding: '4px 7px' }}>
                <div style={{ fontSize: 7.5, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>CoG X %WB</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#d2a8ff', fontFamily: 'monospace' }}>{cogXpct.toFixed(1)} <span style={{ fontSize: 8, color: '#6e7681' }}>%</span></div>
              </div>
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, padding: '4px 7px' }}>
                <div style={{ fontSize: 7.5, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>CoG X from FA</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' }}>{X_cg.toFixed(0)} <span style={{ fontSize: 8, color: '#6e7681' }}>mm</span></div>
              </div>
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, padding: '4px 7px' }}>
                <div style={{ fontSize: 7.5, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>CoG Y from Ground</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' }}>{Y_cg.toFixed(0)} <span style={{ fontSize: 8, color: '#6e7681' }}>mm</span></div>
              </div>
            </div>

            {/* CoG visualiser bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: 7.5, color: '#58a6ff', width: 18, textAlign: 'right' }}>{res.cog.frontPercent.toFixed(0)}%</span>
              <div style={{ flex: 1, height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, width: `${100 - res.cog.frontPercent}%`, height: '100%', background: '#3fb95060', borderRight: '2px solid #3fb950' }} />
                <div style={{ position: 'absolute', left: `${100 - res.cog.frontPercent - 1}%`, width: '3px', height: '100%', background: '#d2a8ff', borderRadius: 2 }} title="CoG position" />
              </div>
              <span style={{ fontSize: 7.5, color: '#3fb950', width: 18 }}>{res.cog.rearPercent.toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: '#484f58', marginBottom: 6, padding: '0 2px' }}>
              <span>← Front axle</span><span>CoG ↑</span><span>Rear axle →</span>
            </div>

            {/* Per-component sliders — adjust height (y) from ground */}
            <div style={{ fontSize: 7.5, color: '#8b949e', marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Component Heights (drag → CoG moves)</div>
            {masses.map((m, i) => (
              <div key={i} style={{ marginBottom: 2 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 45px 45px', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 8, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  <input type="range" min={0} max={1200} step={5} value={m.y}
                    onChange={e => updateMC(i, { y: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: '#d2a8ff', cursor: 'pointer' }} />
                  <span style={{ fontSize: 8, color: '#d2a8ff', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>Y:{m.y.toFixed(0)}</span>
                  <span style={{ fontSize: 8, color: '#6e7681', textAlign: 'right', fontFamily: 'monospace' }}>{m.mass.toFixed(1)}kg</span>
                </div>
              </div>
            ))}
            {/* X position sliders for key masses */}
            <div style={{ fontSize: 7.5, color: '#8b949e', margin: '6px 0 3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Component X (from front axle)</div>
            {masses.map((m, i) => (
              <div key={i} style={{ marginBottom: 2 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 45px', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 8, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  <input type="range" min={0} max={geo.wheelbase} step={5} value={m.x}
                    onChange={e => updateMC(i, { x: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: '#79c0ff', cursor: 'pointer' }} />
                  <span style={{ fontSize: 8, color: '#79c0ff', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>X:{m.x.toFixed(0)}</span>
                </div>
              </div>
            ))}
            <DataRow label="Front Bias" value={res.cog.frontPercent.toFixed(1)} unit="%" />
            <DataRow label="Rear Bias" value={res.cog.rearPercent.toFixed(1)} unit="%" />
            <DataRow label="Squat Ratio R (Cossalter)" value={isFinite(res.antiSquat.antiSquatPercent) ? (res.antiSquat.antiSquatPercent / 100).toFixed(3) : '—'} />
          </>
        )}

        {/* §7 Chain & Sprockets */}
        <SH icon="⚙" title="7. Chain & Sprockets" color="#d29922" open={openSects.chain} onToggle={() => toggleSect('chain')} />
        {openSects.chain && (
          <>
            {chain.isCVT && <div style={{ fontSize: 7.5, color: '#d29922', marginBottom: 3, padding: '1px 4px', background: 'rgba(210,153,34,0.08)', borderRadius: 3 }}>CVT — chain IC N/A</div>}
            <CSlider id="frontSprocket" label="Front Sprocket" value={chain.frontSprocket} min={9} max={25} step={1} unit="T" onChange={v => setChain({ frontSprocket: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'frontSprocket'} />
            <CSlider id="rearSprocket" label="Rear Sprocket" value={chain.rearSprocket} min={28} max={70} step={1} unit="T" onChange={v => setChain({ rearSprocket: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'rearSprocket'} />
            <CSlider id="sprocketCenterX" label="CS X (from pivot)" value={chain.sprocketCenterX} min={-250} max={50} step={5} unit="mm" onChange={v => setChain({ sprocketCenterX: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'sprocketCenterX'} />
            <CSlider id="sprocketCenterY" label="CS Y (from pivot)" value={chain.sprocketCenterY} min={0} max={150} step={5} unit="mm" onChange={v => setChain({ sprocketCenterY: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'sprocketCenterY'} />
            <DataRow label="Overall Gear Ratio" value={res.antiSquat.gearRatio.toFixed(2)} unit=":1" highlight />
            <DataRow label="Chain C-C Distance" value={(res.kinematics.positions[res.kinematics.staticIndex]?.chainCentreDistance ?? 0).toFixed(0)} unit="mm" />
          </>
        )}

        {/* §8 Damper Settings */}
        <SH icon="⟰" title="8. Damper Settings" color="#8b949e" open={openSects.shock} onToggle={() => toggleSect('shock')} />
        {openSects.shock && (
          <>
            <CSlider id="dampingCoeffFront" label="Damping Coeff F" value={susp.dampingCoeffFront} min={0.1} max={5} step={0.05} unit="N·s/mm" decimals={2} onChange={v => setSusp({ dampingCoeffFront: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'dampingCoeffFront'} />
            <CSlider id="dampingCoeffRear" label="Damping Coeff R" value={susp.dampingCoeffRear} min={0.1} max={10} step={0.1} unit="N·s/mm" decimals={1} onChange={v => setSusp({ dampingCoeffRear: v })} onEnter={setHovered} onLeave={() => setHovered(null)} active={hovered === 'dampingCoeffRear'} />
            <DataRow label="Crit. Damping F" value={res.suspension.criticalDampingFront.toFixed(1)} unit="N·s/mm" />
            <DataRow label="Crit. Damping R" value={res.suspension.criticalDampingRear.toFixed(1)} unit="N·s/mm" />
            <DataRow label="Damping Ratio F" value={res.suspension.dampingRatioFront.toFixed(3)} highlight />
            <DataRow label="Damping Ratio R" value={res.suspension.dampingRatioRear.toFixed(3)} highlight />
            <DataRow label="Sag % F" value={res.suspension.sagPercentFront.toFixed(0)} unit="%" />
            <DataRow label="Sag % R" value={res.suspension.sagPercentRear.toFixed(0)} unit="%" />
            <DataRow label="Opt Damping F" value={res.suspension.optimalDampingFront.toFixed(2)} unit="N·s/mm" />
            <DataRow label="Opt Damping R" value={res.suspension.optimalDampingRear.toFixed(2)} unit="N·s/mm" />
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CENTER COLUMN — LIVE 2D DIAGRAM + POSITION MODE
         ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #21262d' }}>

        {/* Position Mode selector */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0, padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #21262d', flexWrap: 'wrap', rowGap: 4 }}>
          <span style={{ fontSize: 8.5, color: '#8b949e', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 8 }}>Position:</span>
          {(['static', 'accel', 'brake', 'corner'] as PositionMode[]).map(m => (
            <button key={m} onClick={() => setPosMode(m)} style={{ padding: '2px 9px', fontSize: 8.5, fontWeight: 600, borderRadius: 4, border: `1px solid ${posMode === m ? modeLoads[m].color : '#30363d'}`, background: posMode === m ? `${modeLoads[m].color}22` : 'transparent', color: posMode === m ? modeLoads[m].color : '#8b949e', cursor: 'pointer', marginRight: 4, letterSpacing: '0.05em', textTransform: 'capitalize' }}>
              {m === 'static' ? 'Static' : m === 'accel' ? '1g Accel' : m === 'brake' ? '1g Brake' : '0.8g Corner'}
            </button>
          ))}
          {/* Load bar + dynamic info */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, color: '#58a6ff', fontFamily: 'monospace', fontWeight: 700 }}>F {frontPctMode.toFixed(1)}%</span>
            <div style={{ width: 90, height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(frontPctMode, 100)}%`, height: '100%', background: ml.color, borderRadius: 3, transition: 'width 0.25s' }} />
            </div>
            <span style={{ fontSize: 8, color: '#3fb950', fontFamily: 'monospace', fontWeight: 700 }}>{rearPctMode.toFixed(1)}% R</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 7.5, color: '#6e7681', fontFamily: 'monospace' }}>
              F:{(ml.front/G).toFixed(0)} R:{(ml.rear/G).toFixed(0)} kgf
            </span>
            {ml.dive > 0   && <span style={{ fontSize: 7.5, color: '#f85149', fontFamily: 'monospace' }}>↓{ml.dive.toFixed(0)}mm dive</span>}
            {ml.squat > 0  && <span style={{ fontSize: 7.5, color: '#ffa657', fontFamily: 'monospace' }}>↓{ml.squat.toFixed(0)}mm squat</span>}
            {ml.lean  > 0  && <span style={{ fontSize: 7.5, color: '#d2a8ff', fontFamily: 'monospace' }}>⟵{ml.lean.toFixed(1)}° lean</span>}
            {ml.pitch > 0  && <span style={{ fontSize: 7.5, color: '#f85149', fontFamily: 'monospace' }}>↺{ml.pitch.toFixed(2)}° pitch</span>}
          </div>
        </div>

        {/* 2D Diagram */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <ChassisViz2D />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT COLUMN — RESULTS / COMPARE / GRAPHS
         ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ width: 300, minWidth: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Sub-tab bar */}
        <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #21262d', background: '#161b22' }}>
          {(['results', 'effects', 'compare', 'graphs'] as RightTab[]).map(t => (
            <button key={t} onClick={() => setRightTab(t)} style={{ flex: 1, padding: '6px 0', fontSize: 8, fontWeight: 700, border: 'none', cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase', background: rightTab === t ? '#0d1117' : 'transparent', color: rightTab === t ? '#58a6ff' : '#6e7681', borderBottom: rightTab === t ? '2px solid #58a6ff' : '2px solid transparent', transition: 'all 0.15s' }}>
              {t === 'results' ? 'Results' : t === 'effects' ? 'Effects' : t === 'compare' ? 'Compare' : 'Graphs'}
            </button>
          ))}
        </div>

        {/* ── Results Tab ────────────────────────────────────────────── */}
        {rightTab === 'results' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            <RG title="Steering" color="#58a6ff" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="trail" label="Static Trail" value={res.geometry.trail.toFixed(1)} unit="mm" status={res.geometry.trail>=80&&res.geometry.trail<=120?'good':res.geometry.trail>=60?'warn':'bad'} lit={lit('trail')} flash={fl('trail')} />
              <RCard id="mechanicalTrail" label="Mech. Trail" value={res.geometry.mechanicalTrail.toFixed(1)} unit="mm" status={null} lit={lit('mechanicalTrail')} flash={fl('mechanicalTrail')} />
              <RCard id="steeringOffGnd" label="Steering Offset" value={res.geometry.steeringOffsetGround.toFixed(1)} unit="mm" status={null} lit={lit('steeringOffGnd')} flash={fl('steeringOffGnd')} />
              <RCard id="antiDive" label="Anti-Dive %" value={isFinite(res.antiSquat.antiDivePercent)?res.antiSquat.antiDivePercent.toFixed(1):'—'} unit="%" status={null} lit={false} flash={false} />
            </div>
            <RG title="Swingarm & WB" color="#3fb950" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="swingarmAngle" label="SA Angle (CW+)" value={saAngle.toFixed(2)} unit="°" status={saAngle>=1&&saAngle<=8?'good':saAngle>=0?'warn':'bad'} lit={lit('swingarmAngle')} flash={fl('swingarmAngle')} />
              <RCard id="wheelbaseOut" label="Wheelbase" value={geo.wheelbase.toFixed(0)} unit="mm" status={geo.wheelbase>=1380&&geo.wheelbase<=1480?'good':'warn'} lit={lit('wheelbaseOut')} flash={fl('wheelbaseOut')} />
            </div>
            <RG title="CoG / Load" color="#d2a8ff" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="X_cg" label="CoG X" value={X_cg.toFixed(0)} unit="mm" status={null} lit={lit('X_cg')} flash={fl('X_cg')} />
              <RCard id="Y_cg" label="CoG Y" value={Y_cg.toFixed(0)} unit="mm" status={res.cog.Y_cg>=480&&res.cog.Y_cg<=720?'good':'warn'} lit={lit('Y_cg')} flash={fl('Y_cg')} />
              <RCard id="frontPct" label="Front %" value={res.cog.frontPercent.toFixed(1)} unit="%" status={res.cog.frontPercent>=42&&res.cog.frontPercent<=58?'good':'warn'} lit={lit('frontPct')} flash={fl('frontPct')} />
              <RCard id="rearPct" label="Rear %" value={res.cog.rearPercent.toFixed(1)} unit="%" status={res.cog.rearPercent>=42&&res.cog.rearPercent<=58?'good':'warn'} lit={lit('rearPct')} flash={fl('rearPct')} />
              <RCard id="fLoad" label="Front Axle" value={(res.cog.R_front/G).toFixed(0)} unit="kgf" status={null} lit={lit('fLoad')} flash={fl('fLoad')} />
              <RCard id="rLoad" label="Rear Axle" value={(res.cog.R_rear/G).toFixed(0)} unit="kgf" status={null} lit={lit('rLoad')} flash={fl('rLoad')} />
            </div>
            <RG title="Anti-Squat" color="#ffa657" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="antiSquat" label="Anti-Squat %" value={res.antiSquat.antiSquatPercent.toFixed(1)} unit="%" status={res.antiSquat.antiSquatPercent>=80&&res.antiSquat.antiSquatPercent<=110?'good':res.antiSquat.antiSquatPercent>=60?'warn':'bad'} lit={lit('antiSquat')} flash={fl('antiSquat')} />
              <RCard id="gearRatio" label="Gear Ratio" value={res.antiSquat.gearRatio.toFixed(2)} unit=":1" status={null} lit={lit('gearRatio')} flash={false} />
              <RCard id="icX" label="IC x" value={isFinite(res.antiSquat.IC_x)?res.antiSquat.IC_x.toFixed(0):'∞'} unit="mm" status={null} lit={lit('icX')} flash={false} />
              <RCard id="icY" label="IC y" value={isFinite(res.antiSquat.IC_y)?res.antiSquat.IC_y.toFixed(0):'∞'} unit="mm" status={null} lit={lit('icY')} flash={false} />
              <RCard id="chainAngle" label="Chain Angle" value={isFinite(res.antiSquat.chainForceAngleAuto)?res.antiSquat.chainForceAngleAuto.toFixed(1):'—'} unit="°" status={null} lit={lit('chainAngle')} flash={false} />
              <RCard id="asSwingarm" label="SA Contribution" value={res.antiSquat.asSwingarmOnly.toFixed(1)} unit="%" status={null} lit={lit('antiSquat')} flash={false} />
            </div>
            <RG title="Suspension" color="#79c0ff" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="natFreqF" label="Nat Freq F" value={res.suspension.natFreqFront.toFixed(2)} unit="Hz" status={res.suspension.natFreqFront>=0.8&&res.suspension.natFreqFront<=1.5?'good':'warn'} lit={lit('natFreqF')} flash={fl('natFreqF')} />
              <RCard id="natFreqR" label="Nat Freq R" value={res.suspension.natFreqRear.toFixed(2)} unit="Hz" status={res.suspension.natFreqRear>=0.8&&res.suspension.natFreqRear<=1.5?'good':'warn'} lit={lit('natFreqR')} flash={fl('natFreqR')} />
              <RCard id="wheelRateF" label="Wheel Rate F" value={res.suspension.wheelRateFront.toFixed(1)} unit="N/mm" status={null} lit={lit('wheelRateF')} flash={false} />
              <RCard id="wheelRateR" label="Wheel Rate R" value={res.suspension.wheelRateRear.toFixed(1)} unit="N/mm" status={null} lit={lit('wheelRateR')} flash={false} />
              <RCard id="dampRatioF" label="Damp Ratio F" value={res.suspension.dampingRatioFront.toFixed(2)} unit="" status={res.suspension.dampingRatioFront>=0.55&&res.suspension.dampingRatioFront<=0.9?'good':'warn'} lit={lit('dampRatioF')} flash={false} />
              <RCard id="dampRatioR" label="Damp Ratio R" value={res.suspension.dampingRatioRear.toFixed(2)} unit="" status={res.suspension.dampingRatioRear>=0.55&&res.suspension.dampingRatioRear<=0.9?'good':'warn'} lit={lit('dampRatioR')} flash={false} />
            </div>
            <RG title="Stability Limits" color="#f85149" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <RCard id="wheelieG" label="Wheelie" value={res.stability.a_wheelie_g.toFixed(2)} unit="g" status={res.stability.a_wheelie_g>=0.9?'good':'warn'} lit={false} flash={false} />
              <RCard id="stoppieG" label="Stoppie" value={res.stability.a_stoppie_g.toFixed(2)} unit="g" status={res.stability.a_stoppie_g>=0.9?'good':'warn'} lit={false} flash={false} />
              <RCard id="leanLim" label="Lean Limit" value={res.stability.leanLimitDeg.toFixed(1)} unit="°" status={res.stability.leanLimitDeg>=40?'good':'warn'} lit={false} flash={false} />
              <RCard id="sagPctF" label="Sag % F" value={res.suspension.sagPercentFront.toFixed(0)} unit="%" status={res.suspension.sagPercentFront>=25&&res.suspension.sagPercentFront<=35?'good':'warn'} lit={false} flash={false} />
            </div>

            <RG title="Dynamic Suspension Travel" color="#ffa657" />
            <div style={{ padding: '6px 8px', background: '#161b22', border: '1px solid #21262d', borderRadius: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 7.5, color: ml.color, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ml.label}</div>
              <div style={{ fontSize: 7.5, color: '#8b949e', marginBottom: 5, lineHeight: 1.5 }}>{ml.info}</div>
              {/* 1g Accel squat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 7.5, color: '#ffa657', width: 65, flexShrink: 0 }}>1g Accel</span>
                <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3 }}>
                  <div style={{ width: `${Math.min((Math.max(squat_mm,0)/Math.max(susp.shockTravel,1))*100, 100)}%`, height: '100%', background: '#ffa657', borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
                <span style={{ fontSize: 8, color: '#ffa657', width: 32, fontFamily: 'monospace', textAlign: 'right', flexShrink: 0 }}>{Math.max(squat_mm,0).toFixed(0)}mm</span>
                <span style={{ fontSize: 7, color: AS_pct>=90&&AS_pct<=110?'#3fb950':'#d29922', width: 38, textAlign: 'right', flexShrink: 0 }}>AS {AS_pct.toFixed(0)}%</span>
              </div>
              {/* 1g Brake dive */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 7.5, color: '#f85149', width: 65, flexShrink: 0 }}>1g Brake</span>
                <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3 }}>
                  <div style={{ width: `${Math.min((Math.max(dive_mm,0)/Math.max(susp.forkTravel,1))*100, 100)}%`, height: '100%', background: '#f85149', borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
                <span style={{ fontSize: 8, color: '#f85149', width: 32, fontFamily: 'monospace', textAlign: 'right', flexShrink: 0 }}>{Math.max(dive_mm,0).toFixed(0)}mm</span>
                <span style={{ fontSize: 7, color: AD_pct>=20&&AD_pct<=50?'#3fb950':'#d29922', width: 38, textAlign: 'right', flexShrink: 0 }}>AD {AD_pct.toFixed(0)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, color: '#8b949e', marginTop: 2 }}>
                <span>Brake pitch angle</span>
                <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{pitch_deg.toFixed(2)}°</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, color: '#8b949e', marginTop: 2 }}>
                <span>CoG forward shift (pitch)</span>
                <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{dx_cog_brake.toFixed(1)} mm</span>
              </div>
            </div>

            <RG title="All Scenarios — Axle Load (kgf)" color="#ffa657" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 3, marginBottom: 6 }}>
              {(['static','accel','brake','corner'] as PositionMode[]).map(m => {
                const md = modeLoads[m];
                const tot = Math.max(md.front + md.rear, 1);
                const fp  = md.front / tot * 100;
                return (
                  <div key={m} style={{ background: '#161b22', border: `1px solid ${m === posMode ? md.color : '#21262d'}`, borderRadius: 5, padding: '4px 5px', cursor: 'pointer', transition: 'border-color 0.15s' }} onClick={() => setPosMode(m)}>
                    <div style={{ fontSize: 6.5, color: md.color, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{md.label.replace(' Acceleration','').replace(' Braking','').replace('g Corner','g Cor')}</div>
                    <div style={{ height: 4, background: '#21262d', borderRadius: 2, marginBottom: 2 }}>
                      <div style={{ width: `${fp}%`, height: '100%', background: md.color, borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#58a6ff' }}>F:{(md.front/G).toFixed(0)}</div>
                    <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#3fb950' }}>R:{(md.rear/G).toFixed(0)}</div>
                  </div>
                );
              })}
            </div>

            <RG title="0.8g Cornering Physics" color="#d2a8ff" />
            <div style={{ padding: '6px 8px', background: '#161b22', border: '1px solid #21262d', borderRadius: 6, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
                <div><div style={{ fontSize: 7, color: '#484f58', textTransform: 'uppercase', marginBottom: 1 }}>Lean Angle</div>
                     <div style={{ fontSize: 13, fontWeight: 700, color: '#d2a8ff', fontFamily: 'monospace' }}>{lean_deg.toFixed(1)}<span style={{ fontSize: 8, color: '#6e7681' }}>°</span></div></div>
                <div><div style={{ fontSize: 7, color: '#484f58', textTransform: 'uppercase', marginBottom: 1 }}>Turn Radius @80kmh</div>
                     <div style={{ fontSize: 13, fontWeight: 700, color: '#d2a8ff', fontFamily: 'monospace' }}>{turn_R_m.toFixed(0)}<span style={{ fontSize: 8, color: '#6e7681' }}>m</span></div></div>
                <div><div style={{ fontSize: 7, color: '#484f58', textTransform: 'uppercase', marginBottom: 1 }}>Outer Side Load</div>
                     <div style={{ fontSize: 13, fontWeight: 700, color: '#f85149', fontFamily: 'monospace' }}>{(R_outer_N/G).toFixed(0)}<span style={{ fontSize: 8, color: '#6e7681' }}>kgf</span></div></div>
                <div><div style={{ fontSize: 7, color: '#484f58', textTransform: 'uppercase', marginBottom: 1 }}>Inner Side Load</div>
                     <div style={{ fontSize: 13, fontWeight: 700, color: '#79c0ff', fontFamily: 'monospace' }}>{(R_inner_N/G).toFixed(0)}<span style={{ fontSize: 8, color: '#6e7681' }}>kgf</span></div></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, color: '#8b949e', marginBottom: 2 }}>
                <span>Eff. CoG height (leaned)</span>
                <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{(h_eff_m*1000).toFixed(0)} mm</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, color: '#8b949e' }}>
                <span>Chassis lean limit</span>
                <span style={{ fontFamily: 'monospace', color: res.stability.leanLimitDeg >= lean_deg ? '#3fb950' : '#f85149' }}>
                  {res.stability.leanLimitDeg.toFixed(1)}° {res.stability.leanLimitDeg >= lean_deg ? '✓ OK' : '✗ OVER'}
                </span>
              </div>
            </div>

            {/* Physics reference */}
            <div style={{ padding: '5px 7px', background: '#0d1117', border: '1px solid #21262d30', borderRadius: 4, fontSize: 6.5, color: '#484f58', lineHeight: 1.7 }}>
              <div style={{ color: '#6e7681', fontWeight: 700, marginBottom: 1 }}>Formulas (Foale / Cossalter):</div>
              <div>ΔW = M·a·g·h<sub>cog</sub>/WB — longitudinal transfer</div>
              <div>Squat = (1−AS%)·ΔW/k<sub>rear</sub> — anti-squat reduces travel</div>
              <div>Dive = (1−AD%)·ΔW/k<sub>front</sub> — anti-dive reduces dive</div>
              <div>Lean φ = arctan(a<sub>lat</sub>) — steady-state</div>
              <div>Lat ΔW = M·a<sub>lat</sub>·g·h<sub>lean</sub>/track</div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            EFFECTS TAB — 10 Physics Groups, all downstream effects
           ══════════════════════════════════════════════════════════════════ */}
        {rightTab === 'effects' && (() => {
          // Compact metric row
          const ER = ({ label, value, unit = '', status = null, formula = '' }: { label: string; value: string; unit?: string; status?: 'good' | 'warn' | 'bad' | null; formula?: string }) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5px 4px', borderRadius: 2, marginBottom: 1 }}>
              <span style={{ fontSize: 7.5, color: '#8b949e', flex: 1 }} title={formula}>{label}</span>
              <span style={{ fontSize: 8.5, fontFamily: 'monospace', fontWeight: 700, color: status === 'good' ? '#3fb950' : status === 'bad' ? '#f85149' : status === 'warn' ? '#d29922' : '#c9d1d9', marginLeft: 4 }}>{value}</span>
              {unit && <span style={{ fontSize: 7, color: '#484f58', marginLeft: 2, width: 22, textAlign: 'right', flexShrink: 0 }}>{unit}</span>}
            </div>
          );
          // Group header
          const EG = ({ n, title, color }: { n: string; title: string; color: string }) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 4px 3px', borderBottom: `1px solid ${color}40`, marginBottom: 3, marginTop: 6 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color, background: `${color}20`, borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>{n}</span>
              <span style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</span>
            </div>
          );
          return (
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              <div style={{ fontSize: 7.5, color: '#58a6ff', fontWeight: 700, marginBottom: 6, padding: '3px 6px', background: 'rgba(56,139,253,0.08)', borderRadius: 4 }}>
                All values live-update. Hover formula tooltip for equation. Formula sources: Foale 2006, Cossalter 2014.
              </div>

              {/* ── G1: Geometry ─────────────────────────────────────── */}
              <EG n="G1" title="Geometry Effects" color="#58a6ff" />
              <ER label="Wheelbase" value={WB.toFixed(0)} unit="mm" status={WB>=1300&&WB<=1600?'good':'warn'} formula="WB = X_sp + √(L_sa² − (H_ra − H_sp)²)" />
              <ER label="SA Angle (CW+)" value={g1_sa_angle_cw.toFixed(2)} unit="°" status={g1_sa_angle_cw>=1&&g1_sa_angle_cw<=8?'good':g1_sa_angle_cw>0?'warn':'bad'} formula="θ = atan2(H_ra − H_sp, WB − X_sp)" />
              <ER label="Pivot-Axle Distance" value={g1_pivotAxleDist.toFixed(1)} unit="mm" formula="D = √((WB−X_sp)²+(H_ra−H_sp)²)  [= swingarm length]" />
              <ER label="Rear Axle Position" value={g1_rearAxlePos.toFixed(0)} unit="mm FA" formula="from front axle = wheelbase" />
              <ER label="Swingarm Horiz. Reach" value={g1_horizReach.toFixed(1)} unit="mm" formula="L_sa × cos(θ_sa)" />
              <ER label="Chain C-C Distance" value={g1_chainCC.toFixed(0)} unit="mm" formula="from kinematics engine (static position)" />
              <ER label="Chain Force Angle" value={isFinite(g1_chainAngle)?g1_chainAngle.toFixed(1):'—'} unit="°" formula="θ_chain = atan((r_rear−r_drive)/D) + swingarm angle" />
              <ER label="Static Trail" value={g1_trail.toFixed(1)} unit="mm" status={g1_trail>=80&&g1_trail<=120?'good':g1_trail>=60?'warn':'bad'} formula="T = (R_f·cos ε − fork_offset) / sin ε" />

              {/* ── G2: Mass & Load ────────────────────────────────────── */}
              <EG n="G2" title="Mass & Load Distribution" color="#3fb950" />
              <ER label="CoG X from front axle" value={X_cg.toFixed(0)} unit="mm" formula="X_cg = Σ(m_i·x_i)/Σm_i" />
              <ER label="CoG height" value={Y_cg.toFixed(0)} unit="mm" formula="Y_cg = Σ(m_i·y_i)/Σm_i" />
              <ER label="CoG / WB (from rear)" value={g2_cog_from_rear_pct.toFixed(1)} unit="%" formula="X_cg / WB × 100" />
              <ER label="Front axle load %" value={res.cog.frontPercent.toFixed(1)} unit="%" status={res.cog.frontPercent>=44&&res.cog.frontPercent<=56?'good':'warn'} formula="(WB − X_cg) / WB × 100" />
              <ER label="Rear axle load %" value={res.cog.rearPercent.toFixed(1)} unit="%" status={res.cog.rearPercent>=44&&res.cog.rearPercent<=56?'good':'warn'} formula="X_cg / WB × 100" />
              <ER label="Front load" value={(R_front/G).toFixed(0)} unit="kgf" formula="W × (WB−X_cg) / WB" />
              <ER label="Rear load" value={(R_rear/G).toFixed(0)} unit="kgf" formula="W × X_cg / WB" />
              <ER label="Distribution error from 48%" value={g2_balance_error_pct.toFixed(1)} unit="%" status={Math.abs(g2_balance_error_pct)<=6?'good':'warn'} formula="|front% − 48%|" />

              {/* ── G3: Weight Transfer ────────────────────────────────── */}
              <EG n="G3" title="Weight Transfer Behavior" color="#ffa657" />
              <ER label="h/WB ratio" value={g3_hWB_ratio.toFixed(4)} formula="Y_cg / WB — governs ALL longitudinal load transfer" status={g3_hWB_ratio>=0.35&&g3_hWB_ratio<=0.5?'good':'warn'} />
              <ER label="ΔW per g (equiv mass)" value={g3_dW_per_g_kgf.toFixed(1)} unit="kg/g" formula="M × h_cog / WB  [kilograms transferred per g]" />
              <ER label="ΔW 1g accel (N)" value={dW_accel.toFixed(0)} unit="N" formula="M × 1g × g × h_cog / WB" />
              <ER label="ΔW 1g brake (N)" value={dW_brake.toFixed(0)} unit="N" formula="M × 1g × g × h_cog / WB" />
              <ER label="Pitch sensitivity" value={(g3_pitch_sensitivity * 100).toFixed(3)} unit="%/100mm" formula="d(front%) / d(WB) = X_cg / WB²  [% change per 100mm WB change]" />
              <ER label="Wheelie threshold" value={g3_front_lift_margin.toFixed(3)} unit="g" status={g3_front_lift_margin>=1.0?'good':'warn'} formula="a_wh = R_front/(Mg) × WB/h_cog  [Foale Eq 10.6]" />
              <ER label="Stoppie threshold" value={g3_rear_lift_margin.toFixed(3)} unit="g" status={g3_rear_lift_margin>=1.0?'good':'warn'} formula="a_st = R_rear/(Mg) × WB/h_cog" />
              <ER label="Pitch inertia I_pitch" value={g3_pitch_inertia.toFixed(2)} unit="kg·m²" formula="Σ m_i [(x_i−X_cg)² + (y_i−Y_cg)²]  [Cossalter §2.3]" />

              {/* ── G4: Anti-Squat / Drive ─────────────────────────────── */}
              <EG n="G4" title="Anti-Squat / Drive Dynamics" color="#d2a8ff" />
              <ER label="Anti-Squat %" value={isFinite(g4_AS_pct)?g4_AS_pct.toFixed(1):'—'} unit="%" status={g4_AS_pct>=80&&g4_AS_pct<=110?'good':g4_AS_pct>=60?'warn':'bad'} formula="AS% = h_IC / h_CoG × 100  [Foale §8]" />
              <ER label="Squat Ratio R (Cossalter)" value={g4_squat_ratio.toFixed(3)} formula="R = tan(τ)/tan(σ)  τ=chain angle, σ=swingarm angle" />
              <ER label="Chain contribution" value={isFinite(g4_chain_contrib)?g4_chain_contrib.toFixed(1):'—'} unit="%" formula="chain pull × lever arm component" />
              <ER label="IC x (from front axle)" value={isFinite(g4_IC_x)?g4_IC_x.toFixed(0):'∞'} unit="mm" formula="intersection of swingarm axis and chain force line" />
              <ER label="IC y (from ground)" value={isFinite(g4_IC_y)?g4_IC_y.toFixed(0):'∞'} unit="mm" />
              <ER label="IC height / CoG height" value={isFinite(g4_IC_hRatio)?g4_IC_hRatio.toFixed(3):'—'} status={g4_IC_hRatio>=0.8&&g4_IC_hRatio<=1.1?'good':'warn'} formula="IC_y / Y_cg — ratio determines squat/extension" />
              <ER label="Drive mode" value={g4_drive_mode} formula="AS%>100: extension under throttle; <100: squat" status={g4_drive_mode==='Mild squat'?'good':'warn'} />
              <ER label="Rear squat at 1g" value={Math.max(g4_squat_mm_1g,0).toFixed(0)} unit="mm" formula="(1 − AS%/100) × ΔW_accel / k_wheel_rear" status={Math.max(g4_squat_mm_1g,0)<=15?'good':'warn'} />
              <ER label="Squat as % of travel" value={g8_squat_pct.toFixed(0)} unit="%" status={g8_squat_pct<=20?'good':g8_squat_pct<=35?'warn':'bad'} />

              {/* ── G5: Traction & Acceleration ────────────────────────── */}
              <EG n="G5" title="Traction & Acceleration" color="#3fb950" />
              <ER label="Static rear load" value={(R_rear/G).toFixed(0)} unit="kgf" formula="W × X_cg / WB" />
              <ER label="Max accel (dry μ=1.0)" value={g5_a_traction_dry_g.toFixed(3)} unit="g" formula="μ × R_rear / (M×g)" />
              <ER label="Max accel (wet μ=0.55)" value={g5_a_traction_wet_g.toFixed(3)} unit="g" />
              <ER label="Wheelie threshold" value={res.stability.a_wheelie_g.toFixed(3)} unit="g" status={res.stability.a_wheelie_g>=1.0?'good':'warn'} />
              <ER label="Effective accel limit" value={g5_a_limit_g.toFixed(3)} unit="g" status={g5_a_limit_g>=1.0?'good':'warn'} formula="min(traction limit, wheelie threshold)" />
              <ER label="Limiting factor" value={g5_limited_by} status={g5_limited_by==='Traction'?'good':'warn'} formula="wheelie-limited → shorter WB or lower CoG helps" />
              <ER label="Traction margin" value={g5_traction_margin.toFixed(1)} unit="%" status={g5_traction_margin>15?'good':g5_traction_margin>0?'warn':'bad'} formula="(a_traction − a_wheelie) / a_traction × 100" />
              <ER label="Available traction (N)" value={g5_avail_traction_N.toFixed(0)} unit="N" formula="μ × R_rear  [dry]" />
              <ER label="Power delivery stability" value={g5_power_stability.toFixed(1)} unit="% R" status={g5_power_stability>=45&&g5_power_stability<=58?'good':'warn'} formula="rear axle load % — higher = more stable under power" />

              {/* ── G6: Handling & Stability ───────────────────────────── */}
              <EG n="G6" title="Handling & Stability" color="#79c0ff" />
              <ER label="Yaw inertia I_yaw" value={g6_I_yaw.toFixed(3)} unit="kg·m²" formula="Σ m_i (x_i² + z_i²)  [about vertical axis]" />
              <ER label="Pitch inertia I_pitch" value={g6_I_pitch.toFixed(3)} unit="kg·m²" formula="Σ m_i [(x_i−X_cg)²+(y_i−Y_cg)²]" />
              <ER label="Roll inertia I_roll" value={g6_I_roll.toFixed(3)} unit="kg·m²" formula="Σ m_i (y_i² + z_i²)  [about longitudinal axis]" />
              <ER label="Agility index" value={g6_agility_idx.toFixed(4)} formula="I_yaw / (M × WB²) — lower = more agile turn-in" status={g6_agility_idx<=0.25?'good':'warn'} />
              <ER label="Stability index" value={g6_stability_idx.toFixed(0)} formula="trail × WB/1000 — higher = more straight-line stable" status={g6_stability_idx>=100?'good':'warn'} />
              <ER label="Turn-in index" value={g6_turnin_idx.toFixed(3)} formula="30 / I_yaw — normalised; sport ≈ 1.0" status={g6_turnin_idx>=0.5&&g6_turnin_idx<=2?'good':'warn'} />
              <ER label="Wobble sensitivity" value={g6_wobble_sens.toFixed(4)} formula="∝ 1/(trail × WB) — lower = more stable at speed" status={g6_wobble_sens<=0.0008?'good':'warn'} />
              <ER label="Lean limit" value={res.stability.leanLimitDeg.toFixed(1)} unit="°" status={res.stability.leanLimitDeg>=38?'good':'warn'} />

              {/* ── G7: Cornering ──────────────────────────────────────── */}
              <EG n="G7" title="Cornering (Indirect Effects)" color="#d2a8ff" />
              <ER label="0.8g lean angle" value={lean_deg.toFixed(2)} unit="°" formula="φ = arctan(a_lat)  [steady-state]" />
              <ER label="Turn radius @80kmh" value={turn_R_m.toFixed(1)} unit="m" formula="r = v² / (a_lat × g)" />
              <ER label="Corner ENTRY: rear load @1g brake" value={g7_entry_rear_pct.toFixed(1)} unit="%" status={g7_entry_rear_pct>=8?'good':'bad'} formula="R_rear_brake / (M×g) × 100 — rear lock risk if <8%" />
              <ER label="Mid-corner lateral ΔW" value={(dW_lat/G).toFixed(0)} unit="kgf" formula="M × a_lat × g × h_lean / track" />
              <ER label="Lateral sensitivity" value={g7_lat_sensitivity.toFixed(1)} unit="%" formula="dW_lat / (M×g/2) × 100 per 0.8g" status={g7_lat_sensitivity<=80?'good':'warn'} />
              <ER label="Corner EXIT anti-squat" value={g7_exit_traction_idx.toFixed(3)} formula="AS% / 100 — index; >1.0 = extension, promotes traction" status={g7_exit_traction_idx>=0.8&&g7_exit_traction_idx<=1.15?'good':'warn'} />
              <ER label="Combined brake+corner" value={g7_combined_g.toFixed(3)} unit="g" formula="√(0.4² + 0.8²) = 0.894g resultant" />
              <ER label="Min turn radius" value={g7_min_R_m.toFixed(1)} unit="m" formula="from stability engine (friction-limited)" />

              {/* ── G8: Suspension Interaction ─────────────────────────── */}
              <EG n="G8" title="Suspension Interaction" color="#ffa657" />
              <ER label="Rear shock leverage (MR)" value={g8_shock_leverage_r.toFixed(3)} formula="wheel travel / shock stroke = motion ratio" status={g8_shock_leverage_r>=0.5&&g8_shock_leverage_r<=0.85?'good':'warn'} />
              <ER label="Front motion ratio" value={g8_shock_leverage_f.toFixed(3)} />
              <ER label="Rear wheel travel" value={rearWheelTravelFull.toFixed(0)} unit="mm" formula="shockTravel × motionRatio" />
              <ER label="Front wheel travel" value={frontWheelTravelFull.toFixed(0)} unit="mm" />
              <ER label="Rear squat 1g (mm)" value={Math.max(g4_squat_mm_1g,0).toFixed(0)} unit="mm" status={Math.max(g4_squat_mm_1g,0)<=20?'good':'warn'} formula="(1−AS%)×ΔW_accel / k_wheel_rear" />
              <ER label="Squat % of travel" value={g8_squat_pct.toFixed(0)} unit="%" status={g8_squat_pct<=25?'good':g8_squat_pct<=40?'warn':'bad'} />
              <ER label="Fork dive 1g (mm)" value={Math.max(dive_mm,0).toFixed(0)} unit="mm" status={Math.max(dive_mm,0)<=30?'good':'warn'} formula="(1−AD%)×ΔW_brake / k_wheel_front" />
              <ER label="Dive % of travel" value={g8_dive_pct.toFixed(0)} unit="%" status={g8_dive_pct<=25?'good':g8_dive_pct<=40?'warn':'bad'} />
              <ER label="Rear nat. freq" value={g8_natFreqR.toFixed(3)} unit="Hz" status={g8_natFreqR>=0.8&&g8_natFreqR<=1.3?'good':'warn'} formula="f = (1/2π)√(k_wheel / m_sprung)" />
              <ER label="Front nat. freq" value={g8_natFreqF.toFixed(3)} unit="Hz" status={g8_natFreqF>=0.9&&g8_natFreqF<=1.5?'good':'warn'} />
              <ER label="f_front − f_rear" value={g8_freq_diff.toFixed(3)} unit="Hz" status={g8_freq_diff>=0&&g8_freq_diff<=0.3?'good':'warn'} formula="ideal: front slightly higher than rear (anti-pitch)" />
              <ER label="Rear sag" value={g8_sag_rear_mm.toFixed(0)} unit="mm" status={res.suspension.sagPercentRear>=20&&res.suspension.sagPercentRear<=35?'good':'warn'} formula="rear_travel × sag%" />
              <ER label="Front sag" value={g8_sag_front_mm.toFixed(0)} unit="mm" status={res.suspension.sagPercentFront>=20&&res.suspension.sagPercentFront<=35?'good':'warn'} />

              {/* ── G9: Packaging / Design ─────────────────────────────── */}
              <EG n="G9" title="Packaging / Design Constraints" color="#d29922" />
              <ER label="Chain C-C distance" value={g1_chainCC.toFixed(0)} unit="mm" />
              <ER label="Chain links (est.)" value={g9_chain_links_est.toFixed(0)} unit="links" formula="2 × C-C / 15.875 (520 pitch)" />
              <ER label="Swingarm horizontal" value={g1_horizReach.toFixed(0)} unit="mm" formula="L_sa × cos(θ_sa)" />
              <ER label="Rear axle below pivot" value={g9_sa_overhang_v.toFixed(0)} unit="mm" formula="H_ra − H_sp (negative = axle below pivot)" />
              <ER label="Frame rear span" value={g9_frame_rear_span.toFixed(0)} unit="mm" formula="WB − X_sp (pivot to rear axle horizontal)" />
              <ER label="Pivot from front axle" value={geo.swingarmPivotX.toFixed(0)} unit="mm" />
              <ER label="Chain vertical clearance" value={g9_chain_clearance.toFixed(0)} unit="mm" formula="sprocket centre Y from pivot" />
              <ER label="Clearance adequate" value={g9_clearance_ok ? 'Yes' : 'Low!'} status={g9_clearance_ok ? 'good' : 'bad'} />

              {/* ── G10: Secondary Dynamics ────────────────────────────── */}
              <EG n="G10" title="Secondary Dynamics" color="#8b949e" />
              <ER label="Pitch inertia" value={g10_I_pitch.toFixed(3)} unit="kg·m²" formula="Σ m_i[(x_i−X_cg)²+(y_i−Y_cg)²]" />
              <ER label="Yaw inertia" value={g10_I_yaw.toFixed(3)} unit="kg·m²" />
              <ER label="Roll inertia" value={g10_I_roll.toFixed(3)} unit="kg·m²" />
              <ER label="h/WB load sensitivity" value={g10_hWB.toFixed(4)} status={g10_hWB>=0.35&&g10_hWB<=0.5?'good':'warn'} formula="Y_cg / WB — fundamental transfer ratio" />
              <ER label="Dynamic load index" value={g10_load_sens_idx.toFixed(4)} formula="h/WB × (F%×R%)/100 — peaks at 50/50 distribution" status={g10_load_sens_idx>=0.08&&g10_load_sens_idx<=0.13?'good':'warn'} />
              <ER label="Wheel spin @100kmh" value={g10_gyro_omega.toFixed(1)} unit="rad/s" formula="v / r_rear — gyroscopic stabilisation proportional" />
              <ER label="Weave proxy" value={g10_weave_proxy.toFixed(2)} formula="I_roll / (M × r_rear²) — lower = more stable weave mode" status={g10_weave_proxy<=3?'good':'warn'} />

              {/* Bottom note */}
              <div style={{ marginTop: 8, padding: '5px 7px', background: '#161b22', border: '1px solid #21262d30', borderRadius: 4, fontSize: 6.5, color: '#484f58', lineHeight: 1.7 }}>
                All results auto-update when any slider changes. Hover each row for the governing equation.
                Colour: <span style={{ color: '#3fb950' }}>green</span>=in target range · <span style={{ color: '#f85149' }}>red</span>=outside range · white=informational.
                Sources: Foale "Motorcycle Handling and Chassis Design" 2006, Cossalter "Motorcycle Dynamics" 2014, SAE J1168.
              </div>
            </div>
          );
        })()}

        {/* ── Compare Tab ────────────────────────────────────────────── */}
        {rightTab === 'compare' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
              <button onClick={() => setBaseline(res)} style={{ flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 700, background: '#388bfd', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', letterSpacing: '0.05em' }}>
                SAVE BASELINE
              </button>
              {baseline && (
                <button onClick={() => setBaseline(null)} style={{ padding: '5px 10px', fontSize: 9, fontWeight: 600, background: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 5, cursor: 'pointer' }}>
                  Clear
                </button>
              )}
            </div>
            {!baseline && (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#484f58', fontSize: 9, lineHeight: 1.8 }}>
                Click "Save Baseline" to snapshot the current state.<br />
                Then modify parameters and see how every metric changed.
              </div>
            )}
            {baseline && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 54px', gap: 2, marginBottom: 6 }}>
                  <span style={{ fontSize: 7.5, color: '#484f58', fontWeight: 700, padding: '2px 0', textTransform: 'uppercase' }}>Parameter</span>
                  <span style={{ fontSize: 7.5, color: '#484f58', fontWeight: 700, padding: '2px 0', textAlign: 'center', textTransform: 'uppercase' }}>Baseline</span>
                  <span style={{ fontSize: 7.5, color: '#484f58', fontWeight: 700, padding: '2px 0', textAlign: 'center', textTransform: 'uppercase' }}>Current</span>
                  <span style={{ fontSize: 7.5, color: '#484f58', fontWeight: 700, padding: '2px 0', textAlign: 'center', textTransform: 'uppercase' }}>Δ</span>
                </div>
                {compareRows.map((row, i) => {
                  const hasChange = row.delta && row.delta !== '0.0 mm' && row.delta !== '0.00°' && row.delta !== '0 mm' && row.delta !== '0.0 %' && row.delta !== '0.00 Hz' && row.delta !== '0.0 N/mm' && row.delta !== '0.00' && row.delta !== '0.00 g';
                  const deltaColor = !hasChange ? '#6e7681' : row.good === true ? '#3fb950' : row.good === false ? '#f85149' : '#d29922';
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 54px', gap: 2, padding: '2px 0', borderBottom: '1px solid #21262d20', alignItems: 'center' }}>
                      <span style={{ fontSize: 8, color: '#8b949e' }}>{row.label}</span>
                      <span style={{ fontSize: 8, color: '#6e7681', textAlign: 'center', fontFamily: 'monospace' }}>{row.base ?? '—'}</span>
                      <span style={{ fontSize: 8.5, color: '#c9d1d9', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>{row.cur}</span>
                      <span style={{ fontSize: 8.5, color: deltaColor, textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{row.delta ?? '—'}</span>
                    </div>
                  );
                })}
                <div style={{ marginTop: 10, padding: '5px 8px', background: '#161b22', borderRadius: 4, fontSize: 7.5, color: '#6e7681', lineHeight: 1.6 }}>
                  Δ color: <span style={{ color: '#3fb950' }}>green</span> = improved · <span style={{ color: '#f85149' }}>red</span> = worsened · <span style={{ color: '#d29922' }}>amber</span> = changed (neutral)
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Graphs Tab ─────────────────────────────────────────────── */}
        {rightTab === 'graphs' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            {/* Graph type selector */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: '#8b949e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Graph Type</div>
              {([
                ['antiSquat_vs_axle',  'Anti-Squat % vs Axle Height'],
                ['natFreq_vs_spring',  'Nat. Freq vs Spring Rate'],
                ['load_vs_accel',      'Load Distribution vs Accel'],
                ['frontPct_vs_WB',     'Front % vs Wheelbase'],
              ] as [GraphType, string][]).map(([g, label]) => (
                <button key={g} onClick={() => setGraphType(g)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', marginBottom: 2, fontSize: 8.5, fontWeight: graphType === g ? 700 : 400, background: graphType === g ? 'rgba(56,139,253,0.12)' : 'transparent', border: `1px solid ${graphType === g ? '#388bfd' : '#21262d'}`, borderRadius: 4, color: graphType === g ? '#58a6ff' : '#8b949e', cursor: 'pointer' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div style={{ height: 200, marginBottom: 6 }}>
              <ResponsiveContainer width="100%" height="100%">
                {graphType === 'antiSquat_vs_axle' ? (
                  <LineChart data={antiSquatSweep} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="x" tick={{ fontSize: 7, fill: '#8b949e' }} label={{ value: 'Rear Axle H (mm)', position: 'insideBottom', fontSize: 7, fill: '#8b949e', offset: -2 }} />
                    <YAxis tick={{ fontSize: 7, fill: '#8b949e' }} />
                    <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 9 }} />
                    <Line type="monotone" dataKey="as" stroke={chartColors.as} strokeWidth={2} dot={false} name="AS %" />
                  </LineChart>
                ) : graphType === 'natFreq_vs_spring' ? (
                  <LineChart data={natFreqSweep} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="x" tick={{ fontSize: 7, fill: '#8b949e' }} label={{ value: 'Spring Rate (N/mm)', position: 'insideBottom', fontSize: 7, fill: '#8b949e', offset: -2 }} />
                    <YAxis tick={{ fontSize: 7, fill: '#8b949e' }} />
                    <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 9 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 8 }} />
                    <Line type="monotone" dataKey="freqF" stroke={chartColors.freqF} strokeWidth={2} dot={false} name="Front Hz" />
                    <Line type="monotone" dataKey="freqR" stroke={chartColors.freqR} strokeWidth={2} dot={false} name="Rear Hz" />
                  </LineChart>
                ) : graphType === 'load_vs_accel' ? (
                  <LineChart data={loadAccelSweep} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="x" tick={{ fontSize: 7, fill: '#8b949e' }} label={{ value: 'Acceleration (g)', position: 'insideBottom', fontSize: 7, fill: '#8b949e', offset: -2 }} />
                    <YAxis tick={{ fontSize: 7, fill: '#8b949e' }} domain={[30, 70]} />
                    <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 9 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 8 }} />
                    <Line type="monotone" dataKey="frontPct" stroke={chartColors.front} strokeWidth={2} dot={false} name="Front %" />
                    <Line type="monotone" dataKey="rearPct" stroke={chartColors.rear} strokeWidth={2} dot={false} name="Rear %" />
                  </LineChart>
                ) : (
                  <LineChart data={wbSweep} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="x" tick={{ fontSize: 7, fill: '#8b949e' }} label={{ value: 'Wheelbase (mm)', position: 'insideBottom', fontSize: 7, fill: '#8b949e', offset: -2 }} />
                    <YAxis tick={{ fontSize: 7, fill: '#8b949e' }} domain={[30, 70]} />
                    <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontSize: 9 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 8 }} />
                    <Line type="monotone" dataKey="frontPct" stroke={chartColors.front} strokeWidth={2} dot={false} name="Front %" />
                    <Line type="monotone" dataKey="rearPct" stroke={chartColors.rear} strokeWidth={2} dot={false} name="Rear %" />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Quick description */}
            <div style={{ padding: '6px 8px', background: '#161b22', border: '1px solid #21262d', borderRadius: 4, fontSize: 7.5, color: '#8b949e', lineHeight: 1.6 }}>
              {graphType === 'antiSquat_vs_axle' && 'Sweeps rear axle height ±25mm from current. Shows how swingarm angle and chain geometry drive AS%. Vertical shifts affect IC position.'}
              {graphType === 'natFreq_vs_spring' && 'Scales spring rates from 30% to 200% of current value. Front and rear natural frequencies track independently based on sprung mass distribution.'}
              {graphType === 'load_vs_accel' && 'Load transfer from 0g to 1.5g acceleration. Transfer = M × a × h_CoG / WB. Rear bias increases with higher CoG or shorter wheelbase.'}
              {graphType === 'frontPct_vs_WB' && 'Wheelbase swept ±60mm from current. CoG absolute position stays fixed — longer WB shifts weight forward. Pivot X follows (coupled).'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
