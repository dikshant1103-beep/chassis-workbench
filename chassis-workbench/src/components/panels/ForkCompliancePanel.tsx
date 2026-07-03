import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

const DFLT = { forkBendingStiffness: 45, forkTorsionalStiffness: 450, steeringHeadStiffness: 800 };

export default function ForkCompliancePanel() {
  const fork = useStore(s => s.input.forkCompliance);
  const set  = useStore(s => s.setForkCompliance);
  const res  = useStore(s => s.results.forkCompliance);

  const f = fork ?? DFLT;

  const flexSt = getStatus(res.steerFlexAngle, 0, 1.5, 0, 0.5);
  const deflSt = getStatus(res.forkDeflection, 0, 6, 0, 2.5);
  const trailSt = getStatus(res.trailEffective, 60, 140, 80, 110);

  return (
    <>
      <Section icon="⌥" title="Fork Stiffness" status={flexSt}
        summary={`Δtrail ${res.deltaTrail.toFixed(1)} mm · flex ${res.steerFlexAngle.toFixed(3)}°`}>
        <ResultBar items={[
          { label: 'Fork Deflection',  val: `${res.forkDeflection.toFixed(2)} mm`, status: deflSt },
          { label: 'Effective Trail',  val: `${res.trailEffective.toFixed(1)} mm`, status: trailSt },
          { label: 'Trail Change (Δ)', val: `${res.deltaTrail.toFixed(1)} mm` },
          { label: 'Steer Flex Angle', val: `${res.steerFlexAngle.toFixed(3)}°`, status: flexSt },
        ]} />
        <PanelRow label="Fork Bending Stiffness"
          desc="Lateral stiffness at axle (N/mm). Sport: 40–60 · MX: 25–40"
          value={f.forkBendingStiffness} min={10} max={120} step={1} unit="N/mm"
          onChange={v => set({ forkBendingStiffness: v })}
          optMin={35} optMax={65} />
        <PanelRow label="Torsional Stiffness"
          desc="Fork twist resistance (N·m/deg). Higher = sharper steering feel"
          value={f.forkTorsionalStiffness} min={100} max={1500} step={10} unit="N·m/°"
          onChange={v => set({ forkTorsionalStiffness: v })}
          optMin={350} optMax={650} />
        <PanelRow label="Steering Head Stiffness"
          desc="Frame compliance at head tube (N·m/deg)"
          value={f.steeringHeadStiffness} min={200} max={3000} step={50} unit="N·m/°"
          onChange={v => set({ steeringHeadStiffness: v })}
          optMin={600} optMax={1500} />
      </Section>

      <Section icon="⚡" title="Braking Analysis">
        <ResultBar items={[
          { label: 'Front Brake Force',  val: `${res.brakingForceFront.toFixed(0)} N` },
          { label: 'Steering Torque',    val: `${res.steeringTorqueNm.toFixed(1)} N·m` },
        ]} />

        {res.isDangerous ? (
          <div style={{
            margin: '8px 0 4px', padding: '7px 10px', borderRadius: 5,
            background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.40)',
            fontSize: 10, color: '#f85149', lineHeight: 1.5,
          }}>
            ✕ Steer flex {res.steerFlexAngle.toFixed(2)}° — <strong>potentially dangerous</strong> (&gt;1.5°) [Cossalter Ch.6]
          </div>
        ) : res.isPerceptible ? (
          <div style={{
            margin: '8px 0 4px', padding: '7px 10px', borderRadius: 5,
            background: 'rgba(210,153,34,0.12)', border: '1px solid rgba(210,153,34,0.35)',
            fontSize: 10, color: '#d29922', lineHeight: 1.5,
          }}>
            ⚠ Steer flex {res.steerFlexAngle.toFixed(2)}° — perceptible by rider (&gt;0.5°)
          </div>
        ) : (
          <div style={{
            margin: '8px 0 4px', padding: '7px 10px', borderRadius: 5,
            background: 'rgba(63,185,80,0.10)', border: '1px solid rgba(63,185,80,0.30)',
            fontSize: 10, color: '#3fb950', lineHeight: 1.5,
          }}>
            ✓ Steer flex {res.steerFlexAngle.toFixed(3)}° — within acceptable limits (&lt;0.5°)
          </div>
        )}

        <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Computed at 0.8g decel · 70% front brake share · 5° reference steer angle<br />
          δ_fork = F_brake / k_bend · Δtrail = −δ_fork·cos(α) · M_SAT = R_f·(trail/1000)·sin(δ)<br />
          [Cossalter Ch.6 · Foale Ch.7]
        </div>
      </Section>
    </>
  );
}
