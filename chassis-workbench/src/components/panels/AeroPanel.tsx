import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { Section, PanelRow } from './PanelShared';
import SweepChart from '../charts/SweepChart';

const DEFAULT_AERO = {
  Cx: 0.38, Cz: -0.05, frontalArea: 0.35, pressureCentreX: 750,
  referenceSpeedKmh: 200, maxSpeedKmh: 300, enginePower_kW: 150, drivetrainEta: 0.88,
  airDensity: 1.225,
};

function KV({ label, value, unit = '', sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color?: string;
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
      <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: color ?? 'var(--text-primary)', fontWeight: 600 }}>
        {value}
        {unit && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

export default function AeroPanel() {
  const inputAero = useStore(s => s.input.aero);
  const setAero   = useStore(s => s.setAero);
  const res       = useStore(s => s.results.aero);
  const aero      = inputAero ?? DEFAULT_AERO;

  const dragData  = useMemo(() => res.speedSweep.map(pt => ({ x: pt.speedKmh, y: pt.dragN })),           [res.speedSweep]);
  const liftData  = useMemo(() => res.speedSweep.map(pt => ({ x: pt.speedKmh, y: pt.liftN })),           [res.speedSweep]);
  const powerData = useMemo(() => res.speedSweep.map(pt => ({ x: pt.speedKmh, y: pt.powerW / 1000 })),   [res.speedSweep]);
  const loadData  = useMemo(() => res.speedSweep.map(pt => ({ x: pt.speedKmh, y: pt.deltaWFrontN })),    [res.speedSweep]);

  const topColor  = res.topSpeed_kmh > 250 ? '#3fb950' : res.topSpeed_kmh > 180 ? '#d29922' : '#f85149';
  const dragColor = res.dragAtRef < 200 ? '#3fb950' : res.dragAtRef < 350 ? '#d29922' : '#f85149';
  const liftColor = res.liftAtRef <= 0 ? '#3fb950' : '#d29922';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: inputs ─────────────────────────────────────────────── */}
      <div className="left-panel" style={{
        width: 240, minWidth: 200, maxWidth: 290, flexShrink: 0,
        overflowY: 'auto', borderRight: '1px solid var(--border)',
      }}>
        <Section icon="⊳" title="Aero Coefficients" defaultOpen
          summary={`Cx ${aero.Cx.toFixed(2)} · Cz ${aero.Cz.toFixed(2)}`}>
          <PanelRow label="Drag Coeff Cx"
            desc="0.33–0.40 faired · 0.50–0.65 naked · 0.80+ scooter upright"
            value={aero.Cx} min={0.15} max={1.0} step={0.01} unit=""
            onChange={v => setAero({ Cx: v })}
            optMin={0.30} optMax={0.45} />
          <PanelRow label="Lift Coeff Cz"
            desc="Negative = downforce. Racing fairing: −0.05 to −0.15"
            value={aero.Cz} min={-0.5} max={0.5} step={0.01} unit=""
            onChange={v => setAero({ Cz: v })}
            optMin={-0.15} optMax={0.05} />
          <PanelRow label="Frontal Area"
            desc="Sport: ~0.33 m² · Naked: ~0.50 m² · ADV: ~0.65 m²"
            value={aero.frontalArea} min={0.15} max={1.0} step={0.01} unit="m²"
            onChange={v => setAero({ frontalArea: v })}
            optMin={0.30} optMax={0.55} />
          <PanelRow label="Pressure Centre X"
            desc="From front axle (mm). Forward of CoG → nose-down moment"
            value={aero.pressureCentreX} min={300} max={1200} step={10} unit="mm"
            onChange={v => setAero({ pressureCentreX: v })} />
        </Section>

        <Section icon="⚡" title="Engine & Speed" defaultOpen={false}>
          <PanelRow label="Engine Power"
            desc="Peak shaft power for top speed prediction"
            value={aero.enginePower_kW} min={5} max={300} step={5} unit="kW"
            onChange={v => setAero({ enginePower_kW: v })} />
          <PanelRow label="Drivetrain η"
            desc="Power delivery efficiency (0.85–0.92 typical)"
            value={aero.drivetrainEta} min={0.70} max={0.98} step={0.01} unit=""
            onChange={v => setAero({ drivetrainEta: v })}
            optMin={0.85} optMax={0.92} />
          <PanelRow label="Reference Speed"
            desc="Speed used for single-point KPI output"
            value={aero.referenceSpeedKmh} min={50} max={350} step={10} unit="km/h"
            onChange={v => setAero({ referenceSpeedKmh: v })} />
          <PanelRow label="Max Chart Speed"
            desc="Upper limit of speed sweep charts"
            value={aero.maxSpeedKmh} min={100} max={400} step={10} unit="km/h"
            onChange={v => setAero({ maxSpeedKmh: v })} />
        </Section>
      </div>

      {/* ── Centre: KPIs ─────────────────────────────────────────────── */}
      <div style={{
        width: 195, minWidth: 175, flexShrink: 0, overflowY: 'auto',
        borderRight: '1px solid var(--border)', padding: '12px 10px',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          @ {aero.referenceSpeedKmh} km/h
        </div>
        <KV label="Drag Force"    value={res.dragAtRef.toFixed(1)}            unit="N"    color={dragColor} />
        <KV label="Lift Force"    value={res.liftAtRef.toFixed(1)}            unit="N"    color={liftColor} />
        <KV label="Drag Power"    value={(res.powerAtRef_W / 1000).toFixed(2)} unit="kW" />
        <KV label="Pitch Moment"  value={res.pitchMoment_Nm.toFixed(1)}       unit="N·m" />
        <KV label="ΔW Front"      value={res.deltaWFrontAtRef_N.toFixed(1)}   unit="N"   sub="aero load xfer" />
        <KV label="Dyn Pressure"  value={res.dynamicPressureRef.toFixed(0)}   unit="Pa" />

        <div style={{ margin: '10px 0 6px', height: 1, background: '#30363d' }} />

        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          Predictions
        </div>
        <KV label="Top Speed"       value={res.topSpeed_kmh.toFixed(1)}  unit="km/h" color={topColor} />
        <KV label="Top Speed"       value={res.topSpeed_ms.toFixed(2)}   unit="m/s" />
        <KV label="Drag @ 100 km/h" value={res.drag100kmh_N.toFixed(1)} unit="N" />

        <div style={{ margin: '10px 0 6px', height: 1, background: '#30363d' }} />
        <div style={{ fontSize: 9, color: '#484f58', lineHeight: 1.6 }}>
          ρ = {aero.airDensity ?? '1.225'} kg/m³<br />
          V_max = ∛(2Pη / ρCxA)<br />
          [Cossalter Ch. 4 / 8]
        </div>
      </div>

      {/* ── Right: charts ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <SweepChart
            title="Drag Force vs Speed"
            data={dragData}
            xLabel="Speed" yLabel="Drag" xUnit="km/h" yUnit="N"
            currentX={aero.referenceSpeedKmh}
          />
          <SweepChart
            title="Lift Force vs Speed"
            data={liftData}
            xLabel="Speed" yLabel="Lift" xUnit="km/h" yUnit="N"
            currentX={aero.referenceSpeedKmh}
          />
          <SweepChart
            title="Drag Power vs Speed"
            data={powerData}
            xLabel="Speed" yLabel="Power" xUnit="km/h" yUnit="kW"
            currentX={aero.referenceSpeedKmh}
          />
          <SweepChart
            title="Front Aero Load Transfer vs Speed"
            data={loadData}
            xLabel="Speed" yLabel="ΔW Front" xUnit="km/h" yUnit="N"
            currentX={aero.referenceSpeedKmh}
          />
        </div>
        <div style={{ fontSize: 9, color: '#484f58', lineHeight: 1.7, padding: '2px 2px 0' }}>
          F_D = ½ρCxAV²  ·  F_L = ½ρCzAV²  ·  P = F_D·V  ·  M_aero = F_L·(x_cp − X_cg)  ·  ΔW_front = M_aero / WB
        </div>
      </div>
    </div>
  );
}
