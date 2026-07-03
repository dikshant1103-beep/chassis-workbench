/** RearSuspensionSection — Studio Section 3: rear architecture + spring. */
import { Section, PanelRow, SelectRow } from '../panels/PanelShared';
import { NumField } from './studioShared';
import { RearSuspension, RearSuspType, DamperType, CoilSpring, Point2 } from '../../engine/studio/types';
import { REAR_TYPES } from '../../engine/studio/knowledgeModel';

const DAMPERS: { val: DamperType; label: string }[] = [
  { val: 'twin-tube', label: 'Twin-tube' }, { val: 'monotube', label: 'Monotube' },
  { val: 'piggyback-reservoir', label: 'Piggyback' }, { val: 'emulsion', label: 'Emulsion' },
];

export default function RearSuspensionSection({ rear, damperType, onChange, onDamper }: {
  rear: RearSuspension;
  damperType: DamperType;
  onChange: (patch: Partial<RearSuspension>) => void;
  onDamper: (d: DamperType) => void;
}) {
  const note = REAR_TYPES.find(x => x.val === rear.type)?.note ?? '';
  const sp = (p: Partial<CoilSpring>) => onChange({ spring: { ...rear.spring, ...p } });
  const pt = (p: Point2, patch: Partial<Point2>): Point2 => ({ ...p, ...patch });

  return (
    <Section icon="◢" title="3 · Rear Suspension" summary={rear.type}>
      <SelectRow label="Architecture" value={rear.type}
        options={REAR_TYPES.map(x => ({ val: x.val, label: x.label }))}
        onChange={v => onChange({ type: v as RearSuspType })} />
      <div style={{ fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 6px', lineHeight: 1.4 }}>{note}</div>

      <SelectRow label="Damper type" value={damperType}
        options={DAMPERS.map(d => ({ val: d.val, label: d.label }))}
        onChange={v => onDamper(v as DamperType)} />

      <PanelRow label="Swingarm length" value={rear.swingarmLength} min={250} max={800} step={1} unit="mm"
        onChange={v => onChange({ swingarmLength: v })} />
      <PanelRow label="Swingarm angle" value={rear.swingarmAngleDeg} min={-25} max={20} step={0.5} unit="°"
        desc="From horizontal (− = axle below pivot)"
        onChange={v => onChange({ swingarmAngleDeg: v })} />
      <PanelRow label="Wheel travel" value={rear.wheelTravel} min={50} max={350} step={1} unit="mm"
        onChange={v => onChange({ wheelTravel: v })} />
      <PanelRow label="Shock stroke" value={rear.shockStroke} min={30} max={140} step={1} unit="mm"
        onChange={v => onChange({ shockStroke: v })} />

      <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0 4px', letterSpacing: 0.4 }}>
        SHOCK HARDPOINTS — mm (frame side view). Drag in the diagram too.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumField label="Pivot x" value={rear.swingarmPivot.x} onChange={v => onChange({ swingarmPivot: pt(rear.swingarmPivot, { x: v }) })} />
        <NumField label="Pivot y" value={rear.swingarmPivot.y} onChange={v => onChange({ swingarmPivot: pt(rear.swingarmPivot, { y: v }) })} />
        <NumField label="Lower mount x" value={rear.lowerShockMount.x} onChange={v => onChange({ lowerShockMount: pt(rear.lowerShockMount, { x: v }) })} />
        <NumField label="Lower mount y" value={rear.lowerShockMount.y} onChange={v => onChange({ lowerShockMount: pt(rear.lowerShockMount, { y: v }) })} />
        <NumField label="Upper mount x" value={rear.upperShockMount.x} onChange={v => onChange({ upperShockMount: pt(rear.upperShockMount, { x: v }) })} />
        <NumField label="Upper mount y" value={rear.upperShockMount.y} onChange={v => onChange({ upperShockMount: pt(rear.upperShockMount, { y: v }) })} />
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0 4px', letterSpacing: 0.4 }}>
        REAR COIL SPRING — rate (Book Ch2: k=G·d⁴/8ND³) · stress · coil-bind
      </div>
      <PanelRow label="Wire diameter (d)" value={rear.spring.wireDia} min={6} max={16} step={0.1} unit="mm"
        onChange={v => sp({ wireDia: v })} />
      <PanelRow label="Mean coil diameter (D)" value={rear.spring.meanCoilDia} min={30} max={80} step={0.5} unit="mm"
        onChange={v => sp({ meanCoilDia: v })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumField label="Active coils N" step={0.5} value={rear.spring.activeCoils} onChange={v => sp({ activeCoils: v })} />
        <NumField label="Free length" unit="mm" value={rear.spring.freeLength} onChange={v => sp({ freeLength: v })} />
        <NumField label="Preload" unit="mm" step={0.5} value={rear.spring.preload} onChange={v => sp({ preload: v })} />
      </div>
    </Section>
  );
}
