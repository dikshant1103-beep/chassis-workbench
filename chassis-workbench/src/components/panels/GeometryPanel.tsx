import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

export default function GeometryPanel() {
  const g   = useStore(s => s.input.geometry);
  const set = useStore(s => s.setGeometry);
  const res = useStore(s => s.results.geometry);

  const trailSt  = getStatus(res.trail, 60, 140, 80, 120);
  const mechSt   = getStatus(res.mechanicalTrail, 50, 110, 70, 100);
  const saSt     = getStatus(res.swingarmAngleDeg, -15, 5, -8, -2);

  return (
    <>
      <Section icon="◈" title="Steering Geometry" status={trailSt}
        summary={`Trail ${res.trail.toFixed(0)} mm`}>
        <ResultBar items={[
          { label: 'Trail', val: `${res.trail.toFixed(1)} mm`, status: trailSt },
          { label: 'Mech Trail', val: `${res.mechanicalTrail.toFixed(1)} mm`, status: mechSt },
          { label: 'Offset Gnd', val: `${res.steeringOffsetGround.toFixed(1)} mm` },
        ]} />
        <PanelRow label="Head Angle (Rake)"
          desc="Steering axis tilt from vertical. More rake = stable, less = agile"
          value={g.headAngle} min={15} max={40} step={0.1} unit="°"
          onChange={v => set({ headAngle: v })}
          optMin={23} optMax={28}
          status={getStatus(g.headAngle, 15, 40, 23, 28)}
          statusText={g.headAngle < 23 ? 'Steep' : g.headAngle > 28 ? 'Relaxed' : 'Optimal'} />
        <PanelRow label="Fork Offset (Triple Clamp)"
          desc="Distance from steering axis to wheel centre. Reduces effective trail"
          value={g.forkOffset} min={0} max={100} step={1} unit="mm"
          onChange={v => set({ forkOffset: v })}
          optMin={25} optMax={50} />
        <PanelRow label="Fork Length"
          desc="Axle to lower triple clamp, determines front axle height"
          value={g.forkLength} min={400} max={1000} step={5} unit="mm"
          onChange={v => set({ forkLength: v })} />
        <PanelRow label="Steering Offset"
          desc="Fine-tuning offset along steering axis"
          value={g.steeringOffset} min={-50} max={50} step={1} unit="mm"
          onChange={v => set({ steeringOffset: v })} />
      </Section>

      <Section icon="○" title="Wheel Dimensions" defaultOpen>
        <PanelRow label="Wheelbase"
          desc="Front to rear axle distance — primary handling character"
          value={g.wheelbase} min={1200} max={1800} step={5} unit="mm"
          onChange={v => set({ wheelbase: v })}
          optMin={1380} optMax={1480} />
        <PanelRow label="Front Wheel Diameter"
          value={g.frontWheelDia} min={500} max={750} step={5} unit="mm"
          onChange={v => set({ frontWheelDia: v })} />
        <PanelRow label="Rear Wheel Diameter"
          value={g.rearWheelDia} min={500} max={750} step={5} unit="mm"
          onChange={v => set({ rearWheelDia: v })} />
        <PanelRow label="Front Axle Height"
          value={g.frontAxleHeight} min={200} max={500} step={5} unit="mm"
          onChange={v => set({ frontAxleHeight: v })} />
        <PanelRow label="Rear Axle Height"
          value={g.rearAxleHeight} min={200} max={500} step={5} unit="mm"
          onChange={v => set({ rearAxleHeight: v })} />
      </Section>

      <Section icon="⟶" title="Swingarm" status={saSt}
        summary={`${(-res.swingarmAngleDeg).toFixed(2)}°`}>
        <ResultBar items={[
          { label: 'SA Angle (CW+)', val: `${(-res.swingarmAngleDeg).toFixed(2)}°`, status: saSt },
        ]} />
        <PanelRow label="Swingarm Length"
          desc="Pivot to rear axle. Longer = better anti-squat, smoother"
          value={g.swingarmLength} min={350} max={800} step={5} unit="mm"
          onChange={v => set({ swingarmLength: v })}
          optMin={420} optMax={580} />
        <PanelRow label="Pivot Height"
          desc="Swingarm pivot above ground"
          value={g.swingarmPivotHeight} min={200} max={500} step={5} unit="mm"
          onChange={v => set({ swingarmPivotHeight: v })} />
        <PanelRow label="Pivot X (from front axle)"
          value={g.swingarmPivotX} min={600} max={1200} step={5} unit="mm"
          onChange={v => set({ swingarmPivotX: v })} />
      </Section>

      <Section icon="□" title="Frame Hardpoints" defaultOpen={false}>
        <PanelRow label="Seat Height"
          value={g.seatHeight} min={600} max={1000} step={5} unit="mm"
          onChange={v => set({ seatHeight: v })} />
        <PanelRow label="Ground Clearance"
          desc="Min clearance — affects banking limit"
          value={g.groundClearance} min={50} max={350} step={5} unit="mm"
          onChange={v => set({ groundClearance: v })}
          optMin={120} optMax={200} />
      </Section>
    </>
  );
}
