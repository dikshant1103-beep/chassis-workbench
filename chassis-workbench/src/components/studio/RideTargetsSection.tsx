/** RideTargetsSection — Studio Section 4: ride goal → target bands. */
import { Section, SelectRow } from '../panels/PanelShared';
import { StudioTargets, RideTarget } from '../../engine/studio/types';
import {
  SAG_PERCENT_TARGET, RIDE_FREQ_FRONT, rearFreqBand, DAMPING_RATIO_TARGET,
} from '../../engine/studio/knowledgeModel';

const TARGETS: { val: RideTarget; label: string }[] = [
  { val: 'comfort', label: 'Comfort' }, { val: 'handling', label: 'Handling' },
  { val: 'sport', label: 'Sport' }, { val: 'touring', label: 'Touring' },
  { val: 'offroad', label: 'Off-road' },
];

function Band({ label, lo, hi, unit }: { label: string; lo: number; hi: number; unit: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'monospace', color: 'var(--accent2)' }}>{lo}–{hi} {unit}</span>
    </div>
  );
}

export default function RideTargetsSection({ targets, onChange }: {
  targets: StudioTargets;
  onChange: (patch: Partial<StudioTargets>) => void;
}) {
  const rt = targets.rideTarget;
  const fr = rearFreqBand(rt);
  return (
    <Section icon="◎" title="4 · Ride Targets" summary={rt}>
      <SelectRow label="Ride target" value={rt}
        options={TARGETS.map(t => ({ val: t.val, label: t.label }))}
        onChange={v => onChange({ rideTarget: v as RideTarget })} />
      <div style={{
        marginTop: 6, padding: 8, borderRadius: 6, background: 'var(--surface2)',
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.4, marginBottom: 4 }}>
          TARGET BANDS FOR "{rt.toUpperCase()}"
        </div>
        <Band label="Static sag" lo={SAG_PERCENT_TARGET[rt].min} hi={SAG_PERCENT_TARGET[rt].max} unit="%" />
        <Band label="Ride freq — front" lo={RIDE_FREQ_FRONT[rt].min} hi={RIDE_FREQ_FRONT[rt].max} unit="Hz" />
        <Band label="Ride freq — rear (≈+15%)" lo={fr.min} hi={fr.max} unit="Hz" />
        <Band label="Damping ratio ζ" lo={DAMPING_RATIO_TARGET[rt].min} hi={DAMPING_RATIO_TARGET[rt].max} unit="" />
      </div>
    </Section>
  );
}
