import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

export default function ErgoPanel() {
  const ergo = useStore(s => s.input.ergo);
  const set  = useStore(s => s.setErgo);
  const res  = useStore(s => s.results.ergonomics);

  const kneeSt  = getStatus(res.kneeAngleDeg,    90, 160, 105, 145);
  const hipSt   = getStatus(res.hipAngleDeg,     80, 140, 90, 120);
  const leanSt  = getStatus(res.forwardLeanDeg,  0,  70,  10, 45);

  const style = leanSt === 'ok' ? 'Sporty' : res.forwardLeanDeg < 10 ? 'Upright' : 'Aggressive';

  return (
    <>
      {/* ── Rider triangle summary ── */}
      <div style={{ padding: '8px 0 4px' }}>
        <ResultBar items={[
          { label: 'Knee Angle', val: `${res.kneeAngleDeg.toFixed(1)}°`, status: kneeSt },
          { label: 'Hip Angle', val: `${res.hipAngleDeg.toFixed(1)}°`, status: hipSt },
          { label: 'Forward Lean', val: `${res.forwardLeanDeg.toFixed(1)}°`, status: leanSt },
          { label: 'S–H Dist', val: `${res.d_SH.toFixed(0)} mm` },
        ]} />
        <div style={{ textAlign: 'center', fontSize: 10, color: leanSt === 'ok' ? 'var(--accent2)' : 'var(--muted)', marginTop: 5, letterSpacing: 0.5 }}>
          Riding Position: <b>{style}</b>
        </div>
        {/* Lean angle visual bar */}
        <div style={{ margin: '6px 0 2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>
            <span>Upright (0°)</span>
            <span>Lean: {res.forwardLeanDeg.toFixed(0)}°</span>
            <span>Racer (70°)</span>
          </div>
          <div style={{ height: 5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${10/70*100}%`, width: `${(45-10)/70*100}%`, top: 0, bottom: 0, background: 'rgba(63,185,80,0.18)' }} />
            <div style={{
              width: `${Math.min(100, res.forwardLeanDeg / 70 * 100)}%`,
              height: '100%', background: leanSt === 'ok' ? 'var(--accent2)' : leanSt === 'warn' ? 'var(--warn)' : 'var(--accent)',
              transition: 'width 0.3s', borderRadius: 3,
            }} />
          </div>
        </div>
      </div>

      <Section icon="⊙" title="Handlebar Position" status={leanSt}
        summary={`Lean ${res.forwardLeanDeg.toFixed(0)}°`}>
        <PanelRow label="Handlebar X (from front axle)"
          desc="Forward position — farther = more aggressive reach"
          value={ergo.handlebarX} min={100} max={800} step={5} unit="mm"
          onChange={v => set({ handlebarX: v })} />
        <PanelRow label="Handlebar Y (from ground)"
          desc="Height — higher = more upright posture"
          value={ergo.handlebarY} min={700} max={1300} step={5} unit="mm"
          onChange={v => set({ handlebarY: v })} />
      </Section>

      <Section icon="◯" title="Seat Position" status={hipSt}
        summary={`Hip ${res.hipAngleDeg.toFixed(0)}°`}>
        <PanelRow label="Seat X (from front axle)"
          value={ergo.seatX} min={400} max={1200} step={5} unit="mm"
          onChange={v => set({ seatX: v })} />
        <PanelRow label="Seat Y (from ground)"
          value={ergo.seatY} min={600} max={1000} step={5} unit="mm"
          onChange={v => set({ seatY: v })} />
      </Section>

      <Section icon="⊓" title="Footpeg Position" status={kneeSt}
        summary={`Knee ${res.kneeAngleDeg.toFixed(0)}°`}>
        <PanelRow label="Footpeg X (from front axle)"
          desc="Further back = more knee bend (sporty). Forward = cruiser"
          value={ergo.footpegX} min={400} max={1300} step={5} unit="mm"
          onChange={v => set({ footpegX: v })}
          optMin={600} optMax={900} />
        <PanelRow label="Footpeg Y (from ground)"
          desc="Higher footpegs give more ground clearance for banking"
          value={ergo.footpegY} min={100} max={600} step={5} unit="mm"
          onChange={v => set({ footpegY: v })}
          optMin={200} optMax={400} />
      </Section>
    </>
  );
}
