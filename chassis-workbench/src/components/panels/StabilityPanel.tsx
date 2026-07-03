import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

const DFLT = { footpegLateralOffset: 350, frictionCoeff: 0.8, steeringLockAngle: 35 };

export default function StabilityPanel() {
  const stab = useStore(s => s.input.stability);
  const set  = useStore(s => s.setStability);
  const res  = useStore(s => s.results.stability);

  const s = stab ?? DFLT;

  const wheelieSt = getStatus(res.a_wheelie_g, 0.8, 2.5, 1.0, 1.6);
  const stoppieSt = getStatus(res.a_stoppie_g, 0.8, 2.5, 1.0, 1.6);
  const leanSt    = getStatus(res.leanLimitDeg, 38, 65, 44, 56);
  const siSt      = getStatus(res.stabilityIndex, 0.05, 0.5, 0.08, 0.20);

  return (
    <>
      <Section icon="△" title="Wheelie / Stoppie" status={wheelieSt}
        summary={`Wheelie ${res.a_wheelie_g.toFixed(2)}g · Stoppie ${res.a_stoppie_g.toFixed(2)}g`}>
        <ResultBar items={[
          { label: 'Wheelie Threshold', val: `${res.a_wheelie_g.toFixed(2)} g`, status: wheelieSt },
          { label: 'Wheelie (m/s²)',    val: `${res.a_wheelie_ms2.toFixed(1)} m/s²` },
          { label: 'Stoppie Threshold', val: `${res.a_stoppie_g.toFixed(2)} g`, status: stoppieSt },
          { label: 'Stoppie (m/s²)',    val: `${res.a_stoppie_ms2.toFixed(1)} m/s²` },
        ]} />
        <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          a_wheelie = g·(WB − X_cg) / Y_cg  ·  a_stoppie = g·X_cg / Y_cg [Foale Ch.5]<br />
          Adjust CoG position in Geometry/Mass tabs to change thresholds.
        </div>
      </Section>

      <Section icon="◎" title="Lean & Turning" status={leanSt}
        summary={`Lean ${res.leanLimitDeg.toFixed(1)}° · R_turn ${(res.R_turn_min_mm / 1000).toFixed(1)} m`}>
        <ResultBar items={[
          { label: 'Lean Limit',       val: `${res.leanLimitDeg.toFixed(1)}°`, status: leanSt },
          { label: 'Min Turn Radius',  val: `${(res.R_turn_min_mm / 1000).toFixed(2)} m` },
          { label: 'Turning Circle Ø', val: `${(res.D_turn_circle_mm / 1000).toFixed(2)} m` },
          { label: 'Max Grade',        val: `${res.gradeMaxDeg.toFixed(1)}°` },
          { label: 'Max Grade %',      val: `${res.gradeMaxPercent.toFixed(1)} %` },
        ]} />
        <PanelRow label="Footpeg Offset"
          desc="Lateral distance centreline → footpeg tip (half-width). Sets lean clearance."
          value={s.footpegLateralOffset} min={200} max={500} step={5} unit="mm"
          onChange={v => set({ footpegLateralOffset: v })}
          optMin={300} optMax={400} />
        <PanelRow label="Friction Coeff μ"
          desc="Tyre-road friction: 0.8 dry tarmac · 0.5 wet · 1.0 slick"
          value={s.frictionCoeff} min={0.3} max={1.2} step={0.05} unit=""
          onChange={v => set({ frictionCoeff: v })}
          optMin={0.75} optMax={0.95} />
        <PanelRow label="Steering Lock"
          desc="Max steering angle for minimum turning radius"
          value={s.steeringLockAngle} min={15} max={55} step={1} unit="°"
          onChange={v => set({ steeringLockAngle: v })}
          optMin={30} optMax={42} />
      </Section>

      <Section icon="⊕" title="Handling Indices" status={siSt} defaultOpen={false}
        summary={`SI ${res.stabilityIndex.toFixed(3)} · AI ${res.agilityIndex.toFixed(4)}`}>
        <ResultBar items={[
          { label: 'Stability Index (SI)',   val: res.stabilityIndex.toFixed(4),
            status: res.stabilityIndex >= 0.08 ? 'ok' : 'warn' },
          { label: 'Agility Index (AI)',     val: res.agilityIndex.toFixed(5),
            status: res.agilityIndex < 0.15 ? 'ok' : 'warn' },
          { label: 'Wobble Sensitivity',     val: res.wobbleSensitivity.toFixed(2),
            status: res.wobbleSensitivity < 15 ? 'ok' : 'warn' },
          { label: 'Pitch Sensitivity',      val: `${res.pitchSensitivity.toFixed(4)} %/mm` },
          { label: 'Rear Squat (accel)',     val: `${res.rearSquatMm.toFixed(1)} mm` },
          { label: 'Fork Dive (brake)',      val: `${res.forkDiveMm.toFixed(1)} mm` },
        ]} />
        <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          SI = trail × WB / 10⁶  ·  AI = I_yaw / (M × WB²)<br />
          Wobble Sens = 10⁶ / (trail × WB)  ·  Pitch Sens = X_cg / WB² [Cossalter §G5/G8]
        </div>
      </Section>
    </>
  );
}
