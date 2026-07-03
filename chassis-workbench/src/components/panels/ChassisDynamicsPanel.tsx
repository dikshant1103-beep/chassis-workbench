/**
 * ChassisDynamicsPanel.tsx — Cossalter 2014 Chassis Dynamics Tab
 *
 * Left : live numerical results (fork, 2DOF, steering, roll, spin, capsize)
 * Right: 4 sweep charts — wheel spin, roll vs speed, steering sweep, 2DOF modes
 *
 * Physics sources: Cossalter, Lot, Massaro (2014) §1.1–1.5
 * See roadmap for excluded formulas (Pacejka, Azman MBD, etc.)
 */

import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import {
  computeChassisDynamics,
  computeForkEquivStiffness,
  compute2DOFModes,
  steeringAngleSweep,
  wheelSpinSweep,
  rollVsSpeedSweep,
  ChassisDynamicsInput,
} from '../../engine/chassisDynamics';
import { Section, PanelRow } from './PanelShared';
import SweepChart from '../charts/SweepChart';

// ─── KV result row ────────────────────────────────────────────────────────────

function KV({ label, value, unit = '', color, sub }: {
  label: string; value: string; unit?: string; color?: string; sub?: string;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', borderBottom: '1px solid #21262d',
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        {label}
        {sub && <span style={{ fontSize: 8, color: '#484f58', marginLeft: 4 }}>{sub}</span>}
      </span>
      <span style={{
        fontSize: 11, fontFamily: 'Consolas, monospace',
        color: color ?? 'var(--text-primary)', fontWeight: 600,
      }}>
        {value}
        {unit && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function fmt(v: number, dp = 2): string {
  if (!isFinite(v) || isNaN(v)) return '—';
  return v.toFixed(dp);
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function ChassisDynamicsPanel() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);

  const gp   = input.geometry;
  const susp = input.suspension;
  const dyn  = input.dynamics;

  // ── Local panel inputs ───────────────────────────────────────────────────
  const [steerAngle_deg, setSteerAngle] = useState(10);   // δ (handlebar)
  const [speedKmh,       setSpeedKmh]   = useState(100);  // V
  const [cornerRadius_m, setCornerRadius] = useState(dyn.cornerRadius > 0 ? dyn.cornerRadius : 50);

  const speed_ms = speedKmh / 3.6;

  // ── Derive inputs from store ─────────────────────────────────────────────

  // CoG height in metres
  const cogHeight_m = results.cog.Y_cg / 1000;

  // Total mass
  const totalMass_kg = results.cog.totalMass;

  // Roll angle at current speed + corner radius (from existing dynamics)
  const rollAngle_deg = results.dynamics.bankAngleDeg;

  // Fork spring rate along fork axis (N/mm):
  // springRateFront is wheel rate (spring_L × MR²); we need spring_L = k_wheel / MR²
  // Actually: motionRatioFront is defined as MR = wheel_travel / spring_travel
  // and wheelRateFront = springRateFront × MR²  ← store uses naming springRateFront = spring rate
  // We want k_L (along fork axis) = springRateFront (already in N/mm along fork axis for tele forks)
  const k_L = susp.springRateFront;        // N/mm along fork axis
  const c_L = susp.dampingCoeffFront;       // N·s/mm along fork axis

  // Front tyre stiffness
  const tireParams = input.tire;
  const k_T_front = tireParams?.frontTireStiffness ?? 180;  // N/mm default

  // Sprung mass front (kg)
  const m_s_front = results.suspension.sprungMassFront;
  // Unsprung front (kg)
  const m_u_front = susp.unsprungFront;

  // Front wheel radius (m)
  const frontWheelRadius_m = gp.frontWheelDia / 2 / 1000;
  // Rear wheel radius (m)
  const rearWheelRadius_m  = gp.rearWheelDia / 2 / 1000;

  // Front tyre section height (m): sectionWidth (mm) × aspectRatio / 100
  const frontSectionH_m = tireParams
    ? (tireParams.frontSectionWidth * tireParams.frontAspectRatio / 100) / 1000
    : 0.085;  // 120/70 default ≈ 0.084 m

  // Roll inertia
  const I_roll_kgm2 = results.inertia.I_roll;

  const dynInput: ChassisDynamicsInput = {
    headAngle_deg: gp.headAngle,
    wheelbase_mm:  gp.wheelbase,
    forkSpringRate_Nmm: k_L,
    forkDamping_Nsmm:   c_L,
    frontTireStiffness_Nmm: k_T_front,
    sprungMassFront_kg: m_s_front,
    unsprungFront_kg:   m_u_front,
    cogHeight_m,
    totalMass_kg,
    I_roll_kgm2,
    frontWheelRadius_m,
    rearWheelRadius_m,
    tyreSectionH_m:  frontSectionH_m,
    steerAngle_deg,
    rollAngle_deg,
    speed_ms,
    cornerRadius_m,
  };

  const cd = useMemo(
    () => computeChassisDynamics(dynInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      gp.headAngle, gp.wheelbase, gp.frontWheelDia,
      k_L, c_L, k_T_front,
      m_s_front, m_u_front,
      cogHeight_m, totalMass_kg, I_roll_kgm2,
      frontSectionH_m,
      steerAngle_deg, rollAngle_deg, speed_ms, cornerRadius_m,
    ],
  );

  // ── Chart data ────────────────────────────────────────────────────────────

  const spinData = useMemo(
    () => wheelSpinSweep(frontWheelRadius_m, [0, 300], 61),
    [frontWheelRadius_m],
  );

  const rollData = useMemo(
    () => rollVsSpeedSweep(cornerRadius_m, cogHeight_m, frontSectionH_m, [20, 200], 61),
    [cornerRadius_m, cogHeight_m, frontSectionH_m],
  );
  const rollData2 = rollData.map(p => ({ x: p.x, y: p.y2 }));
  const rollData1 = rollData.map(p => ({ x: p.x, y: p.y }));

  const steerSweepFlat = useMemo(
    () => steeringAngleSweep(gp.headAngle, 0, [0, 30], 61),
    [gp.headAngle],
  );
  const steerSweepRoll = useMemo(
    () => steeringAngleSweep(gp.headAngle, rollAngle_deg, [0, 30], 61),
    [gp.headAngle, rollAngle_deg],
  );

  // 2DOF vs k_z sweep: show how mode freqs change with spring rate
  const modeSweepData = useMemo(() => {
    const k_z = computeForkEquivStiffness(k_L, gp.headAngle);
    const pts1: Array<{ x: number; y: number }> = [];
    const pts2: Array<{ x: number; y: number }> = [];
    for (let k = 10; k <= 80; k += 1) {
      const { bounce_Hz, hop_Hz } = compute2DOFModes(k_z, k, m_s_front, m_u_front);
      if (isFinite(bounce_Hz)) pts1.push({ x: k, y: +bounce_Hz.toFixed(3) });
      if (isFinite(hop_Hz))    pts2.push({ x: k, y: +hop_Hz.toFixed(2) });
    }
    return { bounce: pts1, hop: pts2 };
  }, [k_L, gp.headAngle, k_T_front, m_s_front, m_u_front]);

  // ── Condition helpers ─────────────────────────────────────────────────────
  const bounceColor = cd.frontBounce_Hz >= 0.8 && cd.frontBounce_Hz <= 2.0
    ? 'var(--accent2)' : cd.frontBounce_Hz > 2.0 ? 'var(--warn)' : 'var(--text-primary)';
  const hopColor = cd.frontHop_Hz >= 8 && cd.frontHop_Hz <= 20
    ? 'var(--accent2)' : 'var(--warn)';
  const capsizeColor = cd.bodyCapsizeTC_s > 0.3 && cd.bodyCapsizeTC_s < 3
    ? 'var(--accent2)' : 'var(--warn)';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: controls + live results ── */}
      <div className="left-panel">
        <div className="panel-body">

          {/* Header badge */}
          <div style={{
            background: 'var(--surface)', border: '2px solid var(--cyan)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 10,
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 }}>
              Chassis Dynamics — Cossalter 2014 §1.1–1.5
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)', fontFamily: 'Consolas, monospace' }}>
              Fork τ = {fmt(cd.forkVelocityRatio, 3)} &nbsp;|&nbsp; f₀₁ = {fmt(cd.frontBounce_Hz, 2)} Hz
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
              ε = {fmt(gp.headAngle, 1)}°  wheelbase = {fmt(gp.wheelbase, 0)} mm
            </div>
          </div>

          {/* ── Panel inputs ── */}
          <Section icon="🎛" title="Panel Inputs" defaultOpen>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
              These inputs affect steering kinematics and roll charts.
              All other inputs are read from the bike parameters automatically.
            </div>
            <PanelRow
              label="Handlebar steer angle δ"
              desc="Input steer angle at the handlebar. Kinematic Δ is the resulting wheel steer."
              value={steerAngle_deg} min={0} max={30} step={0.5} unit="°"
              onChange={v => setSteerAngle(v)}
              optMin={5} optMax={20}
            />
            <PanelRow
              label="Speed V"
              desc="Forward speed for wheel spin frequency and current-position markers."
              value={speedKmh} min={0} max={300} step={5} unit="km/h"
              onChange={v => setSpeedKmh(v)}
              optMin={60} optMax={220}
            />
            <PanelRow
              label="Corner radius R_c"
              desc="Radius of curvature for roll equilibrium sweep."
              value={cornerRadius_m} min={5} max={500} step={5} unit="m"
              onChange={v => setCornerRadius(v)}
              optMin={20} optMax={200}
            />
          </Section>

          {/* ── Fork Equivalent Model ── */}
          <Section icon="⊘" title="Fork Equivalent Model — Coss Eq 1.43–1.44" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              Maps inclined fork to equivalent vertical spring/damper.
            </div>
            <KV label="Fork velocity ratio τ" value={fmt(cd.forkVelocityRatio, 4)}
              sub="1/cos(ε)  [Eq 1.43]" />
            <KV label="Equiv vertical stiffness k_z" value={fmt(cd.forkEquivStiffness_Nmm, 2)}
              unit="N/mm" sub="k_L/cos²(ε)  [Eq 1.44]" />
            <KV label="Equiv vertical damping c_z" value={fmt(cd.forkEquivDamping_Nsmm, 3)}
              unit="N·s/mm" sub="c_L/cos²(ε)  [Eq 1.44]" />
            <KV label="Combined spring+tyre rate k'" value={fmt(cd.combinedRate_Nmm, 2)}
              unit="N/mm" sub="k_z·k_T/(k_z+k_T)  [Eq 1.47]" />
          </Section>

          {/* ── 2-DOF Vibration Modes ── */}
          <Section icon="〜" title="2-DOF In-Plane Modes — Coss Eq 1.48–1.49" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              Half-vehicle model: sprung mass m_s = {fmt(m_s_front, 1)} kg,
              unsprung m_u = {fmt(m_u_front, 1)} kg.
              Formula uses corrected a₁ = k_z(m_s+m_u) + k_T·m_s (typo in print).
            </div>
            <KV label="Bounce mode f₀₁" value={fmt(cd.frontBounce_Hz, 3)}
              unit="Hz" color={bounceColor} sub="target 1.0–2.0 Hz" />
            <KV label="Wheel hop f₀₂" value={fmt(cd.frontHop_Hz, 2)}
              unit="Hz" color={hopColor} sub="target 10–20 Hz" />
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
              Input: k_L = {fmt(k_L, 1)} N/mm,  k_T = {fmt(k_T_front, 0)} N/mm,  k_z = {fmt(cd.forkEquivStiffness_Nmm, 1)} N/mm
            </div>
          </Section>

          {/* ── Steering Kinematics ── */}
          <Section icon="↩" title="Steering Kinematics — Coss Eq 1.2–1.3" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              At δ = {fmt(steerAngle_deg, 1)}°, φ = {fmt(rollAngle_deg, 1)}° (from dynamics)
            </div>
            <KV label="Kinematic wheel steer Δ" value={fmt(cd.kinematicSteer_deg, 3)}
              unit="°" sub="arctan(cos(ε)/cos(φ)·tan(δ))" />
            <KV label="Turning radius R_c" value={
              isFinite(cd.turningRadius_m) ? fmt(cd.turningRadius_m, 1) : '∞'}
              unit="m" sub="1/C  [Eq 1.3]" />
            <KV label="Steer amplification Δ/δ" value={
              Math.abs(steerAngle_deg) > 0.1
                ? fmt(cd.kinematicSteer_deg / steerAngle_deg, 4)
                : '—'} />
          </Section>

          {/* ── Roll Equilibrium ── */}
          <Section icon="⟳" title="Roll Equilibrium — Coss Eq 1.75–1.76" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              At V = {fmt(speedKmh, 0)} km/h, R_c = {fmt(cornerRadius_m, 0)} m
            </div>
            <KV label="Basic roll φ₀" value={fmt(cd.rollBasic_deg, 2)}
              unit="°" sub="arctan(V²/gR)  [Eq 1.75]" />
            <KV label="Tyre section correction Δφ" value={fmt(cd.rollCorrection_deg, 3)}
              unit="°" sub="arcsin(t·sin(φ₀)/(h−t))  [Eq 1.76]" />
            <KV label="Total roll φ_total" value={fmt(cd.rollTotal_deg, 2)}
              unit="°" color="var(--cyan)" />
            <KV label="CoG height h" value={fmt(cogHeight_m * 1000, 0)}
              unit="mm" />
            <KV label="Tyre section height t" value={fmt(frontSectionH_m * 1000, 1)}
              unit="mm" />
          </Section>

          {/* ── Wheel Spin ── */}
          <Section icon="◎" title="Wheel Spin — Coss Eq 1.74" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              At V = {fmt(speedKmh, 0)} km/h
            </div>
            <KV label="Front spin freq f_w" value={fmt(cd.frontSpinFreq_Hz, 2)}
              unit="Hz" sub="V/(2πR_f)" />
            <KV label="Rear spin freq f_w" value={fmt(cd.rearSpinFreq_Hz, 2)}
              unit="Hz" sub="V/(2πR_r)" />
            <KV label="Front wheel radius R_f" value={fmt(frontWheelRadius_m * 1000, 1)}
              unit="mm" />
          </Section>

          {/* ── Body Capsize ── */}
          <Section icon="⊿" title="Body Capsize — Coss Eq 1.84" defaultOpen>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, lineHeight: 1.5 }}>
              τ_bc = √((I_x + Mh²) / (Mgh)) — time to fall from upright if no correction
            </div>
            <KV label="Capsize time const τ_bc" value={fmt(cd.bodyCapsizeTC_s, 3)}
              unit="s" color={capsizeColor}
              sub="target 0.5–2.5 s (rideable)" />
            <KV label="I_roll" value={fmt(I_roll_kgm2, 3)} unit="kg·m²" />
            <KV label="Total mass M" value={fmt(totalMass_kg, 1)} unit="kg" />
          </Section>

        </div>
      </div>

      {/* ── Right: charts ── */}
      <div className="right-panel" style={{
        overflowY: 'auto', padding: '12px 10px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>

        <div style={{
          fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: 1.2, marginBottom: 2,
        }}>
          Chassis Dynamics Charts — all update live with parameter changes
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

          {/* Wheel spin vs speed */}
          <SweepChart
            title="Wheel Spin Frequency vs Speed  [Eq 1.74]"
            data={spinData}
            xLabel="Speed" xUnit="km/h"
            yLabel="f_w" yUnit="Hz"
            currentX={speedKmh}
            okMin={0} okMax={40}
            warnMin={0} warnMax={80}
          />

          {/* Roll angle vs speed */}
          <SweepChart
            title={`Roll Angle vs Speed  (R_c = ${fmt(cornerRadius_m, 0)} m)  [Eq 1.75–1.76]`}
            data={rollData1}
            data2={rollData2}
            label2="Total (with tyre section)"
            xLabel="Speed" xUnit="km/h"
            yLabel="Roll φ" yUnit="°"
            currentX={speedKmh}
            okMin={0} okMax={50}
            warnMin={0} warnMax={60}
          />

          {/* Steering angle sweep */}
          <SweepChart
            title="Kinematic Steer Δ vs Handlebar δ  [Eq 1.2]"
            data={steerSweepFlat}
            data2={steerSweepRoll}
            label2={`φ = ${fmt(rollAngle_deg, 1)}°`}
            xLabel="Handlebar steer δ" xUnit="°"
            yLabel="Wheel steer Δ" yUnit="°"
            currentX={steerAngle_deg}
          />

          {/* 2-DOF bounce mode vs tyre stiffness */}
          <SweepChart
            title="2-DOF Modes vs Tyre Stiffness k_T  [Eq 1.48–1.49]"
            data={modeSweepData.bounce}
            data2={modeSweepData.hop}
            label2="Wheel hop f₀₂"
            xLabel="Tyre stiffness k_T" xUnit="N/mm"
            yLabel="Freq" yUnit="Hz"
            currentX={k_T_front}
            okMin={0.8} okMax={2.0}
          />

        </div>

        {/* Reference box */}
        <div style={{
          background: '#0d1117', border: '1px solid #21262d',
          borderRadius: 6, padding: '10px 14px',
          fontSize: 9, color: '#484f58', lineHeight: 1.8,
        }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Sources: </span>
          Cossalter, Lot, Massaro (2014) <em>Motorcycle Dynamics</em> §1.1–1.5 &nbsp;|&nbsp;
          Eq 1.2 Kinematic steer &nbsp;|&nbsp; Eq 1.3 Curvature &nbsp;|&nbsp;
          Eq 1.43 Fork velocity ratio &nbsp;|&nbsp; Eq 1.44 Equiv spring/damper &nbsp;|&nbsp;
          Eq 1.47 Combined rate &nbsp;|&nbsp; Eq 1.48–1.49 2-DOF modes (corrected formula) &nbsp;|&nbsp;
          Eq 1.74 Wheel spin &nbsp;|&nbsp; Eq 1.75–1.76 Roll equilibrium &nbsp;|&nbsp;
          Eq 1.84 Capsize time constant
          <br />
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Excluded (future sprints): </span>
          Pacejka Fy/Fx (Phase 12), Whipple eigenvalue (Phase 8), Engine/tyre-slip dynamics,
          Azman virtual work (Phase 13 MBD)
        </div>

      </div>
    </div>
  );
}
