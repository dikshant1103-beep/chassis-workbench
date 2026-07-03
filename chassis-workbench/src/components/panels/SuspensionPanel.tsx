import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Section, PanelRow, ResultBar, getStatus } from './PanelShared';
import type { UnsprungComponentsFront, UnsprungComponentsRear } from '../../engine/types';

/** Read-only row shown when a Suspension unsprung field is driven by Mass tab tags */
function LinkedMassRow({ label, value, source, color }: {
  label: string; value: number; source: string; color: string;
}) {
  return (
    <div style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 14, color, fontWeight: 600 }}>{value.toFixed(1)} kg</span>
      </div>
      <div style={{ fontSize: 9, color, opacity: 0.8, marginTop: 2 }}>
        Linked: {source}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
        Remove tags in Mass tab to restore manual slider
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sumFront(c: UnsprungComponentsFront) {
  return c.wheelRim + c.tyre + c.brakeDisc + c.brakeCaliper + c.lowerForkLegs;
}
function sumRear(c: UnsprungComponentsRear) {
  return c.wheelRim + c.tyre + c.brakeDisc + c.brakeCaliper + c.swingarmHalf + c.chainPartial;
}

function defaultFrontComps(total: number): UnsprungComponentsFront {
  const rim  = +(total * 0.321).toFixed(1);
  const tyre = +(total * 0.286).toFixed(1);
  const disc = +(total * 0.107).toFixed(1);
  const cal  = +(total * 0.107).toFixed(1);
  return { wheelRim: rim, tyre, brakeDisc: disc, brakeCaliper: cal,
           lowerForkLegs: +(total - rim - tyre - disc - cal).toFixed(1) };
}
function defaultRearComps(total: number): UnsprungComponentsRear {
  const rim   = +(total * 0.25).toFixed(1);
  const tyre  = +(total * 0.25).toFixed(1);
  const disc  = +(total * 0.05).toFixed(1);
  const cal   = +(total * 0.04).toFixed(1);
  const swing = +(total * 0.275).toFixed(1);
  return { wheelRim: rim, tyre, brakeDisc: disc, brakeCaliper: cal, swingarmHalf: swing,
           chainPartial: +(total - rim - tyre - disc - cal - swing).toFixed(1) };
}

function ratioStatus(sprung: number, unsprung: number) {
  const r = sprung / (unsprung || 1);
  if (r >= 5) return 'ok'   as const;
  if (r >= 3) return 'warn' as const;
  return 'bad' as const;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function SuspensionPanel() {
  const susp         = useStore(s => s.input.suspension);
  const set          = useStore(s => s.setSuspension);
  const res          = useStore(s => s.results.suspension);
  const massComps    = useStore(s => s.input.massComponents);
  const [showBdF, setShowBdF] = useState(false);
  const [showBdR, setShowBdR] = useState(false);

  // Link state — driven by Mass tab unsprungSide tags
  const linkedFront     = massComps.some(c => c.unsprungSide === 'front');
  const linkedRear      = massComps.some(c => c.unsprungSide === 'rear');
  const linkedFrontSrc  = massComps
    .filter(c => c.unsprungSide === 'front')
    .map(c => `${c.label} (${c.mass.toFixed(1)} kg)`)
    .join(' + ');
  const linkedRearSrc   = massComps
    .filter(c => c.unsprungSide === 'rear')
    .map(c => `${c.label} (${c.mass.toFixed(1)} kg)`)
    .join(' + ');

  const nfFSt = getStatus(res.natFreqFront, 0.5, 3.0, 0.8, 1.4);
  const nfRSt = getStatus(res.natFreqRear,  0.8, 3.5, 1.0, 1.6);
  const sagFS = getStatus(res.sagPercentFront, 20, 40, 25, 35);
  const sagRS = getStatus(res.sagPercentRear,  25, 45, 28, 38);

  const compsF = susp.unsprungComponentsFront ?? defaultFrontComps(susp.unsprungFront);
  const compsR = susp.unsprungComponentsRear  ?? defaultRearComps(susp.unsprungRear);

  const rstF = ratioStatus(res.sprungMassFront, susp.unsprungFront);
  const rstR = ratioStatus(res.sprungMassRear,  susp.unsprungRear);

  function updateF(patch: Partial<UnsprungComponentsFront>) {
    const updated = { ...compsF, ...patch };
    set({ unsprungComponentsFront: updated, unsprungFront: +sumFront(updated).toFixed(1) });
  }
  function updateR(patch: Partial<UnsprungComponentsRear>) {
    const updated = { ...compsR, ...patch };
    set({ unsprungComponentsRear: updated, unsprungRear: +sumRear(updated).toFixed(1) });
  }

  const stColor = (st: 'ok' | 'warn' | 'bad') =>
    st === 'ok' ? 'var(--accent2)' : st === 'warn' ? 'var(--warn)' : 'var(--danger)';

  return (
    <>
      <Section icon="⚙" title="Spring Rates" status={nfFSt}
        summary={`F ${res.natFreqFront.toFixed(2)} Hz · R ${res.natFreqRear.toFixed(2)} Hz`}>
        <ResultBar items={[
          { label: 'Wheel Rate F', val: `${res.wheelRateFront.toFixed(2)} N/mm`, status: nfFSt },
          { label: 'Nat Freq F',   val: `${res.natFreqFront.toFixed(2)} Hz`,     status: nfFSt },
          { label: 'Wheel Rate R', val: `${res.wheelRateRear.toFixed(2)} N/mm`,  status: nfRSt },
          { label: 'Nat Freq R',   val: `${res.natFreqRear.toFixed(2)} Hz`,      status: nfRSt },
        ]} />
        <PanelRow label="Front Spring Rate"
          desc="At the spring. Wheel rate = spring rate × MR²"
          value={susp.springRateFront} min={2} max={30} step={0.5} unit="N/mm"
          onChange={v => set({ springRateFront: v })}
          optMin={6} optMax={18} />
        <PanelRow label="Rear Spring Rate"
          value={susp.springRateRear} min={20} max={200} step={1} unit="N/mm"
          onChange={v => set({ springRateRear: v })}
          optMin={60} optMax={120} />
      </Section>

      <Section icon="×" title="Motion Ratios" defaultOpen>
        <PanelRow label="Front MR"
          desc="Wheel travel / fork travel (telescopic fork ≈ 1.0)"
          value={susp.motionRatioFront} min={0.5} max={1.0} step={0.01} unit=""
          onChange={v => set({ motionRatioFront: v })}
          optMin={0.9} optMax={1.0} />
        <PanelRow label="Rear MR"
          desc="Wheel travel / shock travel (typical 0.55–0.75)"
          value={susp.motionRatioRear} min={0.4} max={0.9} step={0.01} unit=""
          onChange={v => set({ motionRatioRear: v })}
          optMin={0.55} optMax={0.75} />
      </Section>

      {/* ── Sprung / Unsprung Mass ───────────────────────────────────────────── */}
      <Section icon="⬡" title="Unsprung Mass">

        {/* Front unsprung — slider when manual, locked display when linked from Mass tab */}
        {linkedFront ? (
          <LinkedMassRow
            label="Front Unsprung"
            value={susp.unsprungFront}
            source={linkedFrontSrc}
            color="var(--cyan)"
          />
        ) : (
          <PanelRow label="Front Unsprung"
            desc="Wheel + tyre + brake + lower fork leg"
            value={susp.unsprungFront} min={5} max={30} step={0.5} unit="kg"
            onChange={v => set({ unsprungFront: v })} />
        )}

        {/* Rear unsprung */}
        {linkedRear ? (
          <LinkedMassRow
            label="Rear Unsprung"
            value={susp.unsprungRear}
            source={linkedRearSrc}
            color="var(--warn)"
          />
        ) : (
          <PanelRow label="Rear Unsprung"
            desc="Wheel + tyre + brake + swingarm (partial)"
            value={susp.unsprungRear} min={8} max={40} step={0.5} unit="kg"
            onChange={v => set({ unsprungRear: v })} />
        )}

        {/* Per-axle sprung mass breakdown */}
        <ResultBar items={[
          { label: 'Total Sprung', val: `${res.sprungMass.toFixed(1)} kg` },
          { label: 'Sprung F',     val: `${res.sprungMassFront.toFixed(1)} kg` },
          { label: 'Sprung R',     val: `${res.sprungMassRear.toFixed(1)} kg` },
          { label: 'Load Xfer @0.8g', val: `${res.loadTransfer08g.toFixed(0)} N` },
        ]} />

        {/* Sprung:Unsprung ratio visualisation */}
        {([
          { side: 'F', sprung: res.sprungMassFront, unsprung: susp.unsprungFront, rst: rstF },
          { side: 'R', sprung: res.sprungMassRear,  unsprung: susp.unsprungRear,  rst: rstR },
        ] as const).map(({ side, sprung, unsprung, rst }) => {
          const total = sprung + unsprung;
          const uPct  = total > 0 ? (unsprung / total) * 100 : 0;
          const ratio = (sprung / (unsprung || 1)).toFixed(1);
          const col   = stColor(rst);
          const label = rst === 'ok' ? 'excellent' : rst === 'warn' ? 'marginal' : 'heavy';
          return (
            <div key={side} style={{ margin: '6px 0 4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
                            color: 'var(--text-muted)', marginBottom: 2 }}>
                <span>{side === 'F' ? 'FRONT' : 'REAR'} · Sprung {sprung.toFixed(1)} kg</span>
                <span style={{ color: col }}>
                  Unsprung {unsprung.toFixed(1)} kg · {ratio}:1
                </span>
              </div>
              <div style={{ height: 6, display: 'flex', borderRadius: 3, overflow: 'hidden',
                            border: '1px solid var(--border)' }}>
                <div style={{ flex: sprung, background: 'var(--accent)', opacity: 0.4,
                              borderRadius: '2px 0 0 2px' }} />
                <div style={{ flex: unsprung, background: col, minWidth: 4,
                              borderRadius: '0 2px 2px 0' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
                            color: 'var(--text-muted)', marginTop: 1 }}>
                <span>Sprung {(100 - uPct).toFixed(0)}% · Unsprung {uPct.toFixed(0)}%</span>
                <span>
                  <span style={{ color: col }}>{label}</span>
                  {' · target ≥ 5:1'}
                </span>
              </div>
            </div>
          );
        })}

        {/* Breakdown toggle buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="btn-sm" style={{ flex: 1, opacity: showBdF ? 1 : 0.65 }}
            onClick={() => setShowBdF(v => !v)}>
            {showBdF ? '▲' : '▼'} Front Breakdown
          </button>
          <button className="btn-sm" style={{ flex: 1, opacity: showBdR ? 1 : 0.65 }}
            onClick={() => setShowBdR(v => !v)}>
            {showBdR ? '▲' : '▼'} Rear Breakdown
          </button>
        </div>

        {/* Front sub-component breakdown */}
        {showBdF && (
          <div style={{ marginTop: 6, paddingLeft: 10,
                        borderLeft: `2px solid ${stColor(rstF)}` }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '3px 0 6px',
                          textTransform: 'uppercase', letterSpacing: 1 }}>
              Front Unsprung — sub-components (sum → main slider)
            </div>
            <PanelRow label="Wheel Rim + Hub"
              value={compsF.wheelRim} min={1} max={12} step={0.1} unit="kg"
              onChange={v => updateF({ wheelRim: v })} />
            <PanelRow label="Front Tyre"
              value={compsF.tyre} min={1} max={10} step={0.1} unit="kg"
              onChange={v => updateF({ tyre: v })} />
            <PanelRow label="Brake Disc"
              value={compsF.brakeDisc} min={0.3} max={4} step={0.1} unit="kg"
              onChange={v => updateF({ brakeDisc: v })} />
            <PanelRow label="Brake Caliper"
              value={compsF.brakeCaliper} min={0.3} max={4} step={0.1} unit="kg"
              onChange={v => updateF({ brakeCaliper: v })} />
            <PanelRow label="Lower Fork Legs"
              desc="Tubes below axle clamps + front axle"
              value={compsF.lowerForkLegs} min={0.5} max={8} step={0.1} unit="kg"
              onChange={v => updateF({ lowerForkLegs: v })} />
            <ResultBar items={[
              { label: 'Sum', val: `${sumFront(compsF).toFixed(1)} kg`,
                status: Math.abs(sumFront(compsF) - susp.unsprungFront) < 0.15 ? 'ok' : 'warn' },
            ]} />
          </div>
        )}

        {/* Rear sub-component breakdown */}
        {showBdR && (
          <div style={{ marginTop: 6, paddingLeft: 10,
                        borderLeft: `2px solid ${stColor(rstR)}` }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '3px 0 6px',
                          textTransform: 'uppercase', letterSpacing: 1 }}>
              Rear Unsprung — sub-components (sum → main slider)
            </div>
            <PanelRow label="Wheel Rim + Hub"
              value={compsR.wheelRim} min={1} max={14} step={0.1} unit="kg"
              onChange={v => updateR({ wheelRim: v })} />
            <PanelRow label="Rear Tyre"
              value={compsR.tyre} min={1} max={12} step={0.1} unit="kg"
              onChange={v => updateR({ tyre: v })} />
            <PanelRow label="Brake Disc"
              value={compsR.brakeDisc} min={0.2} max={3} step={0.1} unit="kg"
              onChange={v => updateR({ brakeDisc: v })} />
            <PanelRow label="Brake Caliper"
              value={compsR.brakeCaliper} min={0.2} max={3} step={0.1} unit="kg"
              onChange={v => updateR({ brakeCaliper: v })} />
            <PanelRow label="Swingarm (rear half)"
              desc="~50% of swingarm mass — portion beyond pivot midpoint"
              value={compsR.swingarmHalf} min={1} max={12} step={0.1} unit="kg"
              onChange={v => updateR({ swingarmHalf: v })} />
            <PanelRow label="Chain (between sprockets)"
              desc="Chain section between sprockets — ~25% of total chain mass"
              value={compsR.chainPartial} min={0.5} max={6} step={0.1} unit="kg"
              onChange={v => updateR({ chainPartial: v })} />
            <ResultBar items={[
              { label: 'Sum', val: `${sumRear(compsR).toFixed(1)} kg`,
                status: Math.abs(sumRear(compsR) - susp.unsprungRear) < 0.15 ? 'ok' : 'warn' },
            ]} />
          </div>
        )}
      </Section>

      <Section icon="↕" title="Sag & Preload" status={sagFS}>
        <ResultBar items={[
          { label: 'Sag % Front', val: `${res.sagPercentFront.toFixed(1)}%`, status: sagFS },
          { label: 'Sag % Rear',  val: `${res.sagPercentRear.toFixed(1)}%`,  status: sagRS },
        ]} />
        <PanelRow label="Front Sag"
          desc="Static sag = spring pre-compression under bike+rider weight"
          value={susp.sagFront} min={5} max={80} step={1} unit="mm"
          onChange={v => set({ sagFront: v })}
          optMin={25} optMax={40} />
        <PanelRow label="Rear Sag"
          value={susp.sagRear} min={5} max={80} step={1} unit="mm"
          onChange={v => set({ sagRear: v })}
          optMin={28} optMax={38} />
        <PanelRow label="Front Preload"
          value={susp.preloadFront} min={0} max={30} step={1} unit="mm"
          onChange={v => set({ preloadFront: v })} />
        <PanelRow label="Rear Preload"
          value={susp.preloadRear} min={0} max={40} step={1} unit="mm"
          onChange={v => set({ preloadRear: v })} />
      </Section>

      <Section icon="≈" title="Damping (clicks)" defaultOpen={false}>
        <PanelRow label="Compression Damping"
          desc="Resistance to fork/shock compression. More clicks = stiffer"
          value={susp.compDamping} min={0} max={30} step={1} unit="clk"
          onChange={v => set({ compDamping: v })} />
        <PanelRow label="Rebound Damping"
          desc="Resistance to extension after compression"
          value={susp.rebDamping} min={0} max={30} step={1} unit="clk"
          onChange={v => set({ rebDamping: v })} />
      </Section>

      {/* ── Damping Physics (Cossalter Ch.5) ─────────────────────────────── */}
      <Section icon="∿" title="Damping Ratio (Cossalter Ch.5)" defaultOpen={false}
        summary={`ζ_f ${res.dampingRatioFront.toFixed(2)} · ζ_r ${res.dampingRatioRear.toFixed(2)}`}>

        <ResultBar items={[
          { label: 'ζ front', val: res.dampingRatioFront.toFixed(3),
            status: res.dampingRatioFront > 0.5 && res.dampingRatioFront < 0.85 ? 'ok' : 'warn' },
          { label: 'ζ rear',  val: res.dampingRatioRear.toFixed(3),
            status: res.dampingRatioRear  > 0.5 && res.dampingRatioRear  < 0.85 ? 'ok' : 'warn' },
          { label: 'c_opt F', val: `${res.optimalDampingFront.toFixed(1)} N·s/mm` },
          { label: 'c_opt R', val: `${res.optimalDampingRear.toFixed(1)} N·s/mm` },
        ]} />
        <ResultBar items={[
          { label: 'Wheel-hop F', val: `${res.unsprungFreqFront.toFixed(1)} Hz`,
            status: res.unsprungFreqFront > 8 && res.unsprungFreqFront < 18 ? 'ok' : 'warn' },
          { label: 'Wheel-hop R', val: `${res.unsprungFreqRear.toFixed(1)} Hz`,
            status: res.unsprungFreqRear  > 8 && res.unsprungFreqRear  < 18 ? 'ok' : 'warn' },
          { label: 'c_crit F', val: `${(res.criticalDampingFront / 1000).toFixed(1)} N·s/mm` },
          { label: 'c_crit R', val: `${(res.criticalDampingRear  / 1000).toFixed(1)} N·s/mm` },
        ]} />

        <PanelRow label="Damping Coeff Front"
          desc="Actual front compression damping (N·s/mm). Optimal ζ = 0.65 → see c_opt F above"
          value={susp.dampingCoeffFront ?? 10} min={0} max={60} step={0.5} unit="N·s/mm"
          onChange={v => set({ dampingCoeffFront: v })}
          optMin={res.optimalDampingFront * 0.8} optMax={res.optimalDampingFront * 1.2} />
        <PanelRow label="Damping Coeff Rear"
          desc="Actual rear compression damping (N·s/mm). Optimal ζ = 0.65 → see c_opt R above"
          value={susp.dampingCoeffRear ?? 15} min={0} max={80} step={0.5} unit="N·s/mm"
          onChange={v => set({ dampingCoeffRear: v })}
          optMin={res.optimalDampingRear * 0.8} optMax={res.optimalDampingRear * 1.2} />

        <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Target: ζ = 0.65 (road-sport) · 0.55–0.70 (circuit) · 0.70–0.80 (road comfort)<br />
          Wheel-hop (unsprung resonance) target: 10–15 Hz. Cossalter Ch.5 Eq 5.18.
        </div>
      </Section>

      <Section icon="↔" title="Travel" defaultOpen={false}>
        <PanelRow label="Fork Travel"
          value={susp.forkTravel} min={50} max={300} step={5} unit="mm"
          onChange={v => set({ forkTravel: v })}
          optMin={100} optMax={200} />
        <PanelRow label="Shock Travel"
          value={susp.shockTravel} min={30} max={150} step={2} unit="mm"
          onChange={v => set({ shockTravel: v })} />
      </Section>
    </>
  );
}
