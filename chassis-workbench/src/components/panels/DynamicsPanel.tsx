import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';
import { computeDynamicsSweep } from '../../engine/dynamicsSweep';
import SweepChart from '../charts/SweepChart';

export default function DynamicsPanel() {
  const dyn    = useStore(s => s.input.dynamics);
  const set    = useStore(s => s.setDynamics);
  const res    = useStore(s => s.results.dynamics);
  const stab   = useStore(s => s.results.stability);
  const geom   = useStore(s => s.input.geometry);
  const susp   = useStore(s => s.input.suspension);
  const cog    = useStore(s => s.results.cog);
  const aero   = useStore(s => s.input.aero);
  const aeroR  = useStore(s => s.results.aero);
  const setAero = useStore(s => s.setAero);

  const DEFAULT_AERO = { Cx: 0.38, Cz: -0.05, frontalArea: 0.35, pressureCentreX: 750,
    referenceSpeedKmh: 200, maxSpeedKmh: 300, enginePower_kW: 150, drivetrainEta: 0.88 };
  const ap = aero ?? DEFAULT_AERO;

  const bankSt  = getStatus(res.bankAngleDeg, 20, 58, 35, 52);
  const frontBS = getStatus(res.frontPercentBraking, 55, 80, 60, 75);

  // ── Dynamics sweep (live, updates with sliders) ───────────────────────────
  const dynSweep = useMemo(() => {
    try {
      return computeDynamicsSweep(geom, susp, cog.X_cg, cog.Y_cg, cog.totalMass, {
        decelMaxG: Math.max(dyn.brakingDecel + 0.1, 1.2),
        accelMaxG: Math.max(dyn.accelG + 0.1, 1.0),
        dG: 0.05,
      });
    } catch { return null; }
  }, [geom, susp, cog, dyn.brakingDecel, dyn.accelG]);

  const rfBrakeData = dynSweep?.braking.map(p => ({ x: p.decel_g, y: p.R_front_N })) ?? [];
  const rrBrakeData = dynSweep?.braking.map(p => ({ x: p.decel_g, y: p.R_rear_N  })) ?? [];
  const adBrakeData = dynSweep?.braking.map(p => ({ x: p.decel_g, y: p.antiDivePct })) ?? [];
  const fkBrakeData = dynSweep?.braking.map(p => ({ x: p.decel_g, y: p.forkCompression_mm })) ?? [];
  const wmAccelData = dynSweep?.accel.map(p   => ({ x: p.accel_g, y: p.wheelieMarginPct }))   ?? [];

  return (
    <>
      <Section icon="⊗" title="Braking" status={frontBS}
        summary={`${res.frontPercentBraking.toFixed(0)}% front · ΔW ${res.deltaW_brake.toFixed(0)} N`}>
        <ResultBar items={[
          { label: 'Front Load %', val: `${res.frontPercentBraking.toFixed(1)}%`, status: frontBS },
          { label: 'ΔW Brake', val: `${res.deltaW_brake.toFixed(0)} N` },
          { label: 'Stoppie g', val: stab ? `${stab.a_stoppie_g.toFixed(2)} g` : '—' },
        ]} />
        <PanelRow label="Braking Deceleration"
          desc="Peak deceleration. 1.0 g = hard ABS-level stop"
          value={dyn.brakingDecel} min={0.1} max={1.2} step={0.05} unit="g"
          onChange={v => set({ brakingDecel: v })}
          optMin={0.7} optMax={1.0} />
      </Section>

      <Section icon="⊕" title="Acceleration"
        summary={`Rear ${res.frontPercentAccel.toFixed(0)}→${(100-res.frontPercentAccel).toFixed(0)}% · ΔW ${res.deltaW_accel.toFixed(0)} N`}>
        <ResultBar items={[
          { label: 'Rear Load %', val: `${(100-res.frontPercentAccel).toFixed(1)}%` },
          { label: 'ΔW Accel', val: `${res.deltaW_accel.toFixed(0)} N` },
          { label: 'Wheelie g', val: stab ? `${stab.a_wheelie_g.toFixed(2)} g` : '—' },
        ]} />
        <PanelRow label="Acceleration"
          desc="Peak acceleration force. 0.3–0.5 g typical road, >0.7 g superbike"
          value={dyn.accelG} min={0.05} max={1.0} step={0.05} unit="g"
          onChange={v => set({ accelG: v })}
          optMin={0.2} optMax={0.6} />
      </Section>

      <Section icon="↺" title="Cornering" status={bankSt}
        summary={`Bank ${res.bankAngleDeg.toFixed(1)}° · Lat ${res.lateralForce.toFixed(0)} N`}>
        <ResultBar items={[
          { label: 'Bank Angle', val: `${res.bankAngleDeg.toFixed(1)}°`, status: bankSt },
          { label: 'Lateral Force', val: `${res.lateralForce.toFixed(0)} N` },
          { label: 'Lean Limit', val: stab ? `${stab.leanLimitDeg.toFixed(0)}°` : '—' },
          { label: 'Min Turn R', val: stab ? `${(stab.R_turn_min_mm/1000).toFixed(1)} m` : '—' },
        ]} />
        <PanelRow label="Corner Speed"
          desc="Entry / mid-corner speed for load transfer calculation"
          value={dyn.cornerSpeed} min={5} max={60} step={1} unit="m/s"
          onChange={v => set({ cornerSpeed: v })} />
        <PanelRow label="Corner Radius"
          desc="Arc radius of the bend being analysed"
          value={dyn.cornerRadius} min={5} max={300} step={5} unit="m"
          onChange={v => set({ cornerRadius: v })} />
        <PanelRow label="Track Width"
          desc="Tyre contact patch lateral spread (affects roll moment arm)"
          value={dyn.trackWidth} min={50} max={200} step={10} unit="mm"
          onChange={v => set({ trackWidth: v })} />

        {/* Bank angle gauge */}
        <div style={{ padding: '6px 0 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>
            <span>Upright (0°)</span>
            <span style={{ color: bankSt === 'ok' ? 'var(--accent2)' : 'var(--warn)', fontWeight: 700 }}>
              {res.bankAngleDeg.toFixed(1)}° lean
            </span>
            <span>Limit (58°)</span>
          </div>
          <div style={{ height: 7, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${35/58*100}%`, width: `${(52-35)/58*100}%`, top: 0, bottom: 0, background: 'rgba(63,185,80,0.18)' }} />
            <div style={{
              width: `${Math.min(100, res.bankAngleDeg / 58 * 100)}%`,
              height: '100%',
              background: bankSt === 'ok' ? 'var(--accent2)' : bankSt === 'warn' ? 'var(--warn)' : 'var(--danger)',
              transition: 'width 0.3s', borderRadius: 3,
            }} />
          </div>
        </div>
      </Section>

      {/* ── Load Transfer Curves ── */}
      {dynSweep && (
        <Section icon="~" title="Load Transfer Curves" defaultOpen={false}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
            Sweeps 0 g → max across braking / accel.
            Dashed line = current slider value.
          </div>
          <SweepChart
            title="Axle Loads vs Decel"
            data={rfBrakeData} data2={rrBrakeData} label2="Rear"
            xLabel="Decel" xUnit="g" yLabel="Load" yUnit="N"
            currentX={dyn.brakingDecel}
          />
          <SweepChart
            title="Anti-Dive % vs Decel"
            data={adBrakeData}
            xLabel="Decel" xUnit="g" yLabel="AD" yUnit="%"
            okMin={20} okMax={60} currentX={dyn.brakingDecel}
          />
          <SweepChart
            title="Fork Compression vs Decel"
            data={fkBrakeData}
            xLabel="Decel" xUnit="g" yLabel="Fork" yUnit="mm"
            currentX={dyn.brakingDecel}
          />
          <SweepChart
            title="Wheelie Margin vs Accel"
            data={wmAccelData}
            xLabel="Accel" xUnit="g" yLabel="Front load %" yUnit="%"
            okMin={30} okMax={100} warnMin={10} warnMax={100}
            currentX={dyn.accelG}
          />
        </Section>
      )}

      {/* ── Aerodynamics ────────────────────────────────────────────────── */}
      <Section icon="⟩" title="Aerodynamics" defaultOpen={false}
        summary={`Drag ${aeroR.dragAtRef.toFixed(0)} N · V_max ${aeroR.topSpeed_kmh.toFixed(0)} km/h`}>

        <ResultBar items={[
          { label: 'Drag @ ref', val: `${aeroR.dragAtRef.toFixed(0)} N` },
          { label: 'Lift @ ref', val: `${aeroR.liftAtRef.toFixed(0)} N` },
          { label: 'Drag power', val: `${(aeroR.powerAtRef_W / 1000).toFixed(1)} kW` },
          { label: 'Top speed', val: `${aeroR.topSpeed_kmh.toFixed(0)} km/h` },
        ]} />
        <ResultBar items={[
          { label: 'Pitch moment', val: `${aeroR.pitchMoment_Nm.toFixed(0)} N·m` },
          { label: 'ΔW front (aero)', val: `${aeroR.deltaWFrontAtRef_N.toFixed(0)} N` },
          { label: 'Drag @100', val: `${aeroR.drag100kmh_N.toFixed(0)} N` },
          { label: 'Dyn pressure', val: `${aeroR.dynamicPressureRef.toFixed(0)} Pa` },
        ]} />

        <PanelRow label="Drag Coeff Cx"
          desc="Aerodynamic drag coefficient. Faired sport ≈ 0.35, naked ≈ 0.55"
          value={ap.Cx} min={0.15} max={0.90} step={0.01} unit=""
          onChange={v => setAero({ Cx: v })}
          optMin={0.30} optMax={0.45} />
        <PanelRow label="Lift Coeff Cz"
          desc="Positive = upward lift, negative = downforce. Racing faring ≈ −0.1"
          value={ap.Cz} min={-0.30} max={0.30} step={0.01} unit=""
          onChange={v => setAero({ Cz: v })} />
        <PanelRow label="Frontal Area"
          desc="Projected frontal area (m²). Sport ≈ 0.33, naked ≈ 0.50"
          value={ap.frontalArea} min={0.20} max={0.80} step={0.01} unit="m²"
          onChange={v => setAero({ frontalArea: v })}
          optMin={0.30} optMax={0.45} />
        <PanelRow label="Pressure Centre X"
          desc="Aerodynamic pressure centre from front axle (mm)"
          value={ap.pressureCentreX} min={400} max={1200} step={10} unit="mm"
          onChange={v => setAero({ pressureCentreX: v })} />
        <PanelRow label="Reference Speed"
          desc="Speed for single-point aero output"
          value={ap.referenceSpeedKmh} min={50} max={350} step={10} unit="km/h"
          onChange={v => setAero({ referenceSpeedKmh: v })} />
        <PanelRow label="Engine Power"
          desc="Peak power for top speed prediction"
          value={ap.enginePower_kW} min={20} max={300} step={5} unit="kW"
          onChange={v => setAero({ enginePower_kW: v })} />
        <PanelRow label="Drivetrain η"
          desc="Drivetrain efficiency (chain loss ≈ 10–12%)"
          value={ap.drivetrainEta} min={0.75} max={0.98} step={0.01} unit=""
          onChange={v => setAero({ drivetrainEta: v })}
          optMin={0.85} optMax={0.93} />

        <SweepChart
          title="Drag & Lift Force vs Speed"
          data={aeroR.speedSweep.map(p => ({ x: p.speedKmh, y: p.dragN }))}
          data2={aeroR.speedSweep.map(p => ({ x: p.speedKmh, y: Math.abs(p.liftN) }))}
          label2={ap.Cz < 0 ? '|Downforce|' : 'Lift'}
          xLabel="Speed" xUnit="km/h" yLabel="Force" yUnit="N"
          currentX={ap.referenceSpeedKmh}
        />
        <SweepChart
          title="Drag Power vs Speed"
          data={aeroR.speedSweep.map(p => ({ x: p.speedKmh, y: p.powerW / 1000 }))}
          xLabel="Speed" xUnit="km/h" yLabel="Power" yUnit="kW"
          currentX={ap.referenceSpeedKmh}
        />
      </Section>
    </>
  );
}
