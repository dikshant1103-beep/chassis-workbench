/** FrontSuspensionSection — Studio Section 2: front architecture + spring. */
import { Section, PanelRow, SelectRow } from '../panels/PanelShared';
import { NumField } from './studioShared';
import { FrontSuspension, FrontSuspType, CoilSpring, Point2 } from '../../engine/studio/types';
import { FRONT_TYPES } from '../../engine/studio/knowledgeModel';

export default function FrontSuspensionSection({ front, onChange }: {
  front: FrontSuspension;
  onChange: (patch: Partial<FrontSuspension>) => void;
}) {
  const isFork = front.type === 'telescopic' || front.type === 'usd';
  const note = FRONT_TYPES.find(x => x.val === front.type)?.note ?? '';
  const sp = (p: Partial<CoilSpring>) => onChange({ spring: { ...front.spring, ...p } });
  const pt = (p: Point2, patch: Partial<Point2>): Point2 => ({ ...p, ...patch });

  return (
    <Section icon="◣" title="2 · Front Suspension" summary={front.type}>
      <SelectRow label="Architecture" value={front.type}
        options={FRONT_TYPES.map(x => ({ val: x.val, label: x.label }))}
        onChange={v => onChange({ type: v as FrontSuspType })} />
      <div style={{ fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 6px', lineHeight: 1.4 }}>{note}</div>

      <PanelRow label="Wheel travel" value={front.travel} min={50} max={350} step={1} unit="mm"
        onChange={v => onChange({ travel: v })} />

      {isFork ? (
        <>
          <PanelRow label="Rake (steering axis)" value={front.rakeDeg} min={20} max={35} step={0.5} unit="°"
            onChange={v => onChange({ rakeDeg: v })} />
          <PanelRow label="Fork length" value={front.forkLength} min={400} max={1000} step={5} unit="mm"
            onChange={v => onChange({ forkLength: v })} />
          <PanelRow label="Fork spring rate (2-leg comb.)" value={front.forkSpringRate} min={3} max={14} step={0.1} unit="N/mm"
            onChange={v => onChange({ forkSpringRate: v })} />
          <PanelRow label="Fork preload" value={front.spring.preload} min={0} max={30} step={0.5} unit="mm"
            onChange={v => sp({ preload: v })} />
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 4px', letterSpacing: 0.4 }}>
            LINK GEOMETRY — mm (frame side view). Drag in the diagram too.
          </div>
          <PanelRow label="Arm length" value={front.linkArmLength} min={80} max={300} step={1} unit="mm"
            onChange={v => onChange({ linkArmLength: v })} />
          <PanelRow label="Arm angle" value={front.linkArmAngleDeg} min={-45} max={20} step={0.5} unit="°"
            onChange={v => onChange({ linkArmAngleDeg: v })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumField label="Pivot x" value={front.linkPivot.x} onChange={v => onChange({ linkPivot: pt(front.linkPivot, { x: v }) })} />
            <NumField label="Pivot y" value={front.linkPivot.y} onChange={v => onChange({ linkPivot: pt(front.linkPivot, { y: v }) })} />
            <NumField label="Lower mount x" value={front.linkLowerMount.x} onChange={v => onChange({ linkLowerMount: pt(front.linkLowerMount, { x: v }) })} />
            <NumField label="Lower mount y" value={front.linkLowerMount.y} onChange={v => onChange({ linkLowerMount: pt(front.linkLowerMount, { y: v }) })} />
            <NumField label="Upper mount x" value={front.linkUpperMount.x} onChange={v => onChange({ linkUpperMount: pt(front.linkUpperMount, { x: v }) })} />
            <NumField label="Upper mount y" value={front.linkUpperMount.y} onChange={v => onChange({ linkUpperMount: pt(front.linkUpperMount, { y: v }) })} />
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0 4px', letterSpacing: 0.4 }}>
        {isFork ? 'FORK INTERNAL SPRING (stress / coil-bind)' : 'LINK COIL SPRING (rate · stress · coil-bind)'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumField label="Wire Ø d" unit="mm" step={0.1} value={front.spring.wireDia} onChange={v => sp({ wireDia: v })} />
        <NumField label="Mean coil Ø D" unit="mm" step={0.5} value={front.spring.meanCoilDia} onChange={v => sp({ meanCoilDia: v })} />
        <NumField label="Active coils N" step={0.5} value={front.spring.activeCoils} onChange={v => sp({ activeCoils: v })} />
        <NumField label="Free length" unit="mm" value={front.spring.freeLength} onChange={v => sp({ freeLength: v })} />
      </div>
    </Section>
  );
}
