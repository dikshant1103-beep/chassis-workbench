import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';

const DFLT = {
  frontSectionWidth: 120, frontAspectRatio: 70, frontRimDiameter: 17,
  frontTireStiffness: 180,
  rearSectionWidth: 190, rearAspectRatio: 55, rearRimDiameter: 17,
  rearTireStiffness: 200,
  speedKmh: 0,
};

export default function TirePanel() {
  const tire = useStore(s => s.input.tire);
  const set  = useStore(s => s.setTire);
  const res  = useStore(s => s.results.tire);

  const t = tire ?? DFLT;

  const cpFSt = getStatus(res.frontContactPatchLength, 80, 180, 100, 145);
  const cpRSt = getStatus(res.rearContactPatchLength,  100, 220, 130, 180);

  return (
    <>
      <Section icon="○" title="Front Tyre" status={cpFSt}
        summary={`${t.frontSectionWidth}/${t.frontAspectRatio}R${t.frontRimDiameter}`}>
        <ResultBar items={[
          { label: 'Free Radius',    val: `${res.frontFreeRadius.toFixed(1)} mm` },
          { label: 'Loaded Radius',  val: `${res.frontLoadedRadius.toFixed(1)} mm` },
          { label: 'Deflection',     val: `${res.frontDeflection.toFixed(2)} mm` },
          { label: 'Contact Patch',  val: `${res.frontContactPatchLength.toFixed(1)} mm`, status: cpFSt },
        ]} />
        <PanelRow label="Section Width"
          desc="Front tyre section width (ISO code first number)"
          value={t.frontSectionWidth} min={80} max={160} step={5} unit="mm"
          onChange={v => set({ frontSectionWidth: v })}
          optMin={100} optMax={130} />
        <PanelRow label="Aspect Ratio"
          desc="Sidewall height as % of section width"
          value={t.frontAspectRatio} min={30} max={90} step={5} unit="%"
          onChange={v => set({ frontAspectRatio: v })}
          optMin={55} optMax={80} />
        <PanelRow label="Rim Diameter"
          desc="Rim diameter (inches)"
          value={t.frontRimDiameter} min={14} max={21} step={1} unit="in"
          onChange={v => set({ frontRimDiameter: v })} />
        <PanelRow label="Tyre Stiffness"
          desc="Vertical spring rate. Road tyre: 150–220 N/mm"
          value={t.frontTireStiffness} min={80} max={400} step={5} unit="N/mm"
          onChange={v => set({ frontTireStiffness: v })}
          optMin={150} optMax={220} />
      </Section>

      <Section icon="○" title="Rear Tyre" status={cpRSt}
        summary={`${t.rearSectionWidth}/${t.rearAspectRatio}R${t.rearRimDiameter}`}>
        <ResultBar items={[
          { label: 'Free Radius',   val: `${res.rearFreeRadius.toFixed(1)} mm` },
          { label: 'Loaded Radius', val: `${res.rearLoadedRadius.toFixed(1)} mm` },
          { label: 'Deflection',    val: `${res.rearDeflection.toFixed(2)} mm` },
          { label: 'Contact Patch', val: `${res.rearContactPatchLength.toFixed(1)} mm`, status: cpRSt },
        ]} />
        <PanelRow label="Section Width"
          value={t.rearSectionWidth} min={120} max={240} step={5} unit="mm"
          onChange={v => set({ rearSectionWidth: v })}
          optMin={160} optMax={200} />
        <PanelRow label="Aspect Ratio"
          value={t.rearAspectRatio} min={30} max={90} step={5} unit="%"
          onChange={v => set({ rearAspectRatio: v })}
          optMin={45} optMax={65} />
        <PanelRow label="Rim Diameter"
          value={t.rearRimDiameter} min={14} max={21} step={1} unit="in"
          onChange={v => set({ rearRimDiameter: v })} />
        <PanelRow label="Tyre Stiffness"
          value={t.rearTireStiffness} min={80} max={400} step={5} unit="N/mm"
          onChange={v => set({ rearTireStiffness: v })}
          optMin={160} optMax={240} />
      </Section>

      <Section icon="⟳" title="Dynamic Growth" defaultOpen={false}
        summary={`@ ${t.speedKmh} km/h`}>
        <ResultBar items={[
          { label: 'Dynamic Radius F',    val: `${res.frontDynamicRadius.toFixed(1)} mm` },
          { label: 'Dynamic Radius R',    val: `${res.rearDynamicRadius.toFixed(1)} mm` },
          { label: 'Combined Rate F',     val: `${res.frontCombinedRate.toFixed(1)} N/mm` },
          { label: 'Combined Rate R',     val: `${res.rearCombinedRate.toFixed(1)} N/mm` },
          { label: 'Nat Freq F (w/tyre)', val: `${res.frontNatFreqCorrected.toFixed(2)} Hz` },
          { label: 'Nat Freq R (w/tyre)', val: `${res.rearNatFreqCorrected.toFixed(2)} Hz` },
        ]} />
        <PanelRow label="Speed"
          desc="Speed for dynamic radius growth (centrifugal expansion)"
          value={t.speedKmh} min={0} max={300} step={10} unit="km/h"
          onChange={v => set({ speedKmh: v })} />
        <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          R_dyn = R_free × (1 + k·V²), k = 2×10⁻⁶ [Cossalter Eq 2.4]<br />
          Combined rate: 1/k_comb = 1/k_susp + 1/k_tyre (series springs)
        </div>
      </Section>
    </>
  );
}
