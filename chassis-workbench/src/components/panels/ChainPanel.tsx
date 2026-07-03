import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

export default function ChainPanel() {
  const chain = useStore(s => s.input.chain);
  const set   = useStore(s => s.setChain);
  const as    = useStore(s => s.results.antiSquat);

  const ratio    = chain.rearSprocket / chain.frontSprocket;
  const asSt     = getStatus(as.antiSquatPercent, 40, 150, 65, 110);
  const chainSt  = getStatus(as.chainContribution, 5, 60, 10, 40);

  return (
    <>
      <Section icon="⚙" title="Sprockets" status={asSt}
        summary={`${ratio.toFixed(3)}:1 · AS ${as.antiSquatPercent.toFixed(0)}%`}>
        <ResultBar items={[
          { label: 'Gear Ratio', val: `${ratio.toFixed(3)}:1` },
          { label: 'Anti-Squat', val: `${as.antiSquatPercent.toFixed(1)}%`, status: asSt },
          { label: 'Chain Contrib', val: `${as.chainContribution.toFixed(1)}%`, status: chainSt },
          { label: 'Anti-Dive', val: `${as.antiDivePercent.toFixed(1)}%` },
        ]} />
        <PanelRow label="Front Sprocket"
          desc="Engine countershaft sprocket tooth count"
          value={chain.frontSprocket} min={10} max={25} step={1} unit="T"
          onChange={v => set({ frontSprocket: v })}
          optMin={14} optMax={18} />
        <PanelRow label="Rear Sprocket"
          desc="Higher tooth count = more torque, lower top speed"
          value={chain.rearSprocket} min={28} max={70} step={1} unit="T"
          onChange={v => set({ rearSprocket: v })}
          optMin={38} optMax={50} />

        {/* Ratio gauge */}
        <div style={{ padding: '8px 0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>
            <span>Short (2.2)</span>
            <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>Ratio: {ratio.toFixed(3)}</span>
            <span>Tall (4.0)</span>
          </div>
          <div style={{ height: 5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(0, Math.min(100, (ratio - 2.2) / (4.0 - 2.2) * 100))}%`,
              height: '100%', background: 'var(--warn)', borderRadius: 3, transition: 'width 0.2s',
            }} />
          </div>
        </div>
      </Section>

      <Section icon="⊕" title="Countershaft Position"
        summary={`IC (${as.IC_x.toFixed(0)}, ${as.IC_y.toFixed(0)}) mm`}>
        <ResultBar items={[
          { label: 'IC x', val: `${as.IC_x.toFixed(0)} mm` },
          { label: 'IC y', val: `${as.IC_y.toFixed(0)} mm` },
        ]} />
        <PanelRow label="Countershaft X (from SA pivot)"
          desc="Negative = forward of swingarm pivot"
          value={chain.sprocketCenterX} min={-200} max={50} step={5} unit="mm"
          onChange={v => set({ sprocketCenterX: v })} />
        <PanelRow label="Countershaft Y (from SA pivot)"
          desc="Height offset from swingarm pivot"
          value={chain.sprocketCenterY} min={0} max={150} step={5} unit="mm"
          onChange={v => set({ sprocketCenterY: v })} />
      </Section>

      <Section icon="/" title="Chain Geometry" defaultOpen={false}>
        <PanelRow label="Chain Force Angle"
          desc="Angle of chain pull relative to swingarm axis. Affects anti-squat contribution"
          value={chain.chainForceAngle} min={-10} max={15} step={0.5} unit="°"
          onChange={v => set({ chainForceAngle: v })}
          optMin={0} optMax={8} />
      </Section>

      {/* Anti-squat gauge */}
      <div style={{ padding: '8px 4px 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>
          <span>Pro-squat (0%)</span>
          <span style={{ color: asSt === 'ok' ? 'var(--accent2)' : asSt === 'warn' ? 'var(--warn)' : 'var(--danger)', fontWeight: 700 }}>
            Anti-Squat {as.antiSquatPercent.toFixed(0)}%
          </span>
          <span>Over-rise (150%)</span>
        </div>
        <div style={{ height: 7, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
          {/* optimal zone */}
          <div style={{ position: 'absolute', left: `${65/150*100}%`, width: `${(110-65)/150*100}%`, top: 0, bottom: 0, background: 'rgba(63,185,80,0.18)', pointerEvents: 'none' }} />
          <div style={{
            width: `${Math.max(0, Math.min(100, as.antiSquatPercent / 150 * 100))}%`,
            height: '100%',
            background: asSt === 'ok' ? 'var(--accent2)' : asSt === 'warn' ? 'var(--warn)' : 'var(--danger)',
            borderRadius: 3, transition: 'width 0.3s',
          }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>Optimal 65–110%</div>
      </div>
    </>
  );
}
