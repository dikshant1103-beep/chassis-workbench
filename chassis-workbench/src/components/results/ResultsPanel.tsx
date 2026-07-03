
import { useStore } from '../../store/useStore';
import { ComputeAllResult } from '../../engine/types';

type Status = 'ok' | 'warn' | 'bad' | '';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/* Range bar component — shows where value falls in its valid range */
function RangeBar({ value, lo, hi, optLo, optHi }: {
  value: number; lo: number; hi: number; optLo?: number; optHi?: number;
}) {
  const pct = clamp((value - lo) / (hi - lo) * 100, 0, 100);
  const optLoPct = optLo != null ? clamp((optLo - lo) / (hi - lo) * 100, 0, 100) : null;
  const optHiPct = optHi != null ? clamp((optHi - lo) / (hi - lo) * 100, 0, 100) : null;
  const inOpt = optLo != null && optHi != null && value >= optLo && value <= optHi;
  const color = inOpt ? 'var(--accent2)' : (pct < 5 || pct > 95) ? 'var(--danger)' : 'var(--warn)';
  return (
    <div className="range-bar">
      {/* Optimal zone highlight */}
      {optLoPct != null && optHiPct != null && (
        <div style={{
          position: 'absolute', left: `${optLoPct}%`, width: `${optHiPct - optLoPct}%`,
          height: '100%', background: 'rgba(63,185,80,0.15)', borderRadius: 2,
        }} />
      )}
      <div className="range-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Card({ label, value, unit, status = '', lo, hi, optLo, optHi, numVal, badge }: {
  label: string; value: string; unit?: string; status?: Status;
  lo?: number; hi?: number; optLo?: number; optHi?: number; numVal?: number;
  badge?: { text: string; color: string };
}) {
  return (
    <div className={`result-card ${status}`}>
      <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {badge && (
          <span style={{
            fontSize: 8, padding: '1px 4px', borderRadius: 2, lineHeight: 1.4,
            background: badge.color + '22', color: badge.color,
            border: `1px solid ${badge.color}55`, flexShrink: 0,
          }}>
            {badge.text}
          </span>
        )}
      </div>
      <div className={`value ${status}`}>
        {value}
        {unit && <span className="unit-tag">{unit}</span>}
      </div>
      {lo != null && hi != null && numVal != null && (
        <RangeBar value={numVal} lo={lo} hi={hi} optLo={optLo} optHi={optHi} />
      )}
    </div>
  );
}

function trailStatus(t: number): Status {
  if (t >= 80 && t <= 120) return 'ok';
  if (t >= 60 && t <= 150) return 'warn';
  return 'bad';
}
function freqStatus(f: number): Status {
  if (f >= 0.9 && f <= 1.4) return 'ok';
  if (f >= 0.7 && f <= 1.8) return 'warn';
  return 'bad';
}
function asStatus(as: number): Status {
  if (as >= 60 && as <= 120) return 'ok';
  if (as >= 30 && as <= 140) return 'warn';
  return 'bad';
}
function angleStatus(deg: number, lo: number, hi: number): Status {
  return deg >= lo && deg <= hi ? 'ok' : 'warn';
}

function ratioStatus(sprung: number, unsprung: number): Status {
  const r = sprung / (unsprung || 1);
  if (r >= 5) return 'ok';
  if (r >= 3) return 'warn';
  return 'bad';
}

export default function ResultsPanel() {
  const results: ComputeAllResult = useStore(s => s.results);
  const error     = useStore(s => s.error);
  const susp      = useStore(s => s.input.suspension);
  const massComps = useStore(s => s.input.massComponents);

  if (error) return <div style={{ color: 'var(--danger)', padding: 8, fontSize: 11 }}>Error: {error}</div>;

  const { geometry: geo, cog, suspension, antiSquat, ergonomics, dynamics } = results;

  const linkedFront = massComps.some(c => c.unsprungSide === 'front');
  const linkedRear  = massComps.some(c => c.unsprungSide === 'rear');

  const ratioF    = suspension.sprungMassFront / (susp.unsprungFront || 1);
  const ratioR    = suspension.sprungMassRear  / (susp.unsprungRear  || 1);
  const ratioFSt  = ratioStatus(suspension.sprungMassFront, susp.unsprungFront);
  const ratioRSt  = ratioStatus(suspension.sprungMassRear,  susp.unsprungRear);

  return (
    <>
      <div className="results-section-title">Geometry</div>
      <div className="results-grid">
        <Card label="Trail"             value={geo.trail.toFixed(1)}               unit="mm" status={trailStatus(geo.trail)}
          numVal={geo.trail} lo={40} hi={180} optLo={80} optHi={120} />
        <Card label="Mech. Trail"       value={geo.mechanicalTrail.toFixed(1)}      unit="mm"
          numVal={geo.mechanicalTrail} lo={40} hi={200} optLo={90} optHi={130} />
        <Card label="SA Angle (CW+)"     value={(-geo.swingarmAngleDeg).toFixed(2)} unit="°"
          numVal={-geo.swingarmAngleDeg} lo={-5} hi={15} optLo={2} optHi={8} />
        <Card label="Steer Offset GND" value={geo.steeringOffsetGround.toFixed(1)} unit="mm" />
      </div>

      <div className="results-section-title">Centre of Gravity</div>
      <div className="results-grid">
        <Card label="CoG X"    value={cog.X_cg.toFixed(1)}         unit="mm" />
        <Card label="CoG Y"    value={cog.Y_cg.toFixed(1)}         unit="mm"
          numVal={cog.Y_cg} lo={400} hi={900} optLo={550} optHi={750} />
        <Card label="Front %"  value={cog.frontPercent.toFixed(1)} unit="%"
          status={cog.frontPercent >= 48 && cog.frontPercent <= 55 ? 'ok' : 'warn'}
          numVal={cog.frontPercent} lo={35} hi={65} optLo={46} optHi={55} />
        <Card label="Rear %"   value={cog.rearPercent.toFixed(1)}  unit="%" />
        <Card label="Mass"     value={cog.totalMass.toFixed(1)}    unit="kg" />
        <Card label="R Front"  value={cog.R_front.toFixed(0)}      unit="N" />
        <Card label="R Rear"   value={cog.R_rear.toFixed(0)}       unit="N" />
      </div>

      <div className="results-section-title">Suspension</div>

      {/* Link status banner */}
      {(linkedFront || linkedRear) && (
        <div style={{
          margin: '0 0 6px', padding: '5px 8px', borderRadius: 4,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--accent2)', fontWeight: 'bold' }}>Mass → Suspension link</span>
          {linkedFront && (
            <span style={{ marginLeft: 8 }}>
              <span style={{ color: 'var(--cyan)' }}>F</span> {susp.unsprungFront.toFixed(1)} kg
            </span>
          )}
          {linkedRear && (
            <span style={{ marginLeft: 6 }}>
              <span style={{ color: 'var(--warn)' }}>R</span> {susp.unsprungRear.toFixed(1)} kg
            </span>
          )}
          <span style={{ marginLeft: 6, opacity: 0.6 }}>— unsprung driven by Mass tab tags</span>
        </div>
      )}

      <div className="results-grid">
        <Card label="WR Front" value={suspension.wheelRateFront.toFixed(2)} unit="N/mm"
          numVal={suspension.wheelRateFront} lo={3} hi={25} optLo={7} optHi={15} />
        <Card label="WR Rear"  value={suspension.wheelRateRear.toFixed(2)}  unit="N/mm"
          numVal={suspension.wheelRateRear} lo={10} hi={80} optLo={25} optHi={55} />
        <Card label="Freq Front" value={suspension.natFreqFront.toFixed(3)} unit="Hz" status={freqStatus(suspension.natFreqFront)}
          numVal={suspension.natFreqFront} lo={0.5} hi={2.2} optLo={0.9} optHi={1.4} />
        <Card label="Freq Rear"  value={suspension.natFreqRear.toFixed(3)}  unit="Hz" status={freqStatus(suspension.natFreqRear)}
          numVal={suspension.natFreqRear} lo={1.0} hi={4.5} optLo={1.5} optHi={3.0} />
        <Card label="Sag% Front" value={suspension.sagPercentFront.toFixed(1)} unit="%" status={suspension.sagPercentFront >= 22 && suspension.sagPercentFront <= 30 ? 'ok' : 'warn'}
          numVal={suspension.sagPercentFront} lo={10} hi={45} optLo={22} optHi={30} />
        <Card label="Sag% Rear"  value={suspension.sagPercentRear.toFixed(1)}  unit="%" status={suspension.sagPercentRear >= 22 && suspension.sagPercentRear <= 30 ? 'ok' : 'warn'}
          numVal={suspension.sagPercentRear} lo={10} hi={45} optLo={22} optHi={30} />
        <Card label="Sprung Total"   value={suspension.sprungMass.toFixed(1)}      unit="kg" />
        <Card label="Sprung Front"   value={suspension.sprungMassFront.toFixed(1)} unit="kg" />
        <Card label="Sprung Rear"    value={suspension.sprungMassRear.toFixed(1)}  unit="kg" />
        <Card label="Load Δ at 0.8g" value={suspension.loadTransfer08g.toFixed(0)} unit="N" />
        <Card label="Unsprung F" value={susp.unsprungFront.toFixed(1)} unit="kg"
          badge={linkedFront ? { text: 'LINKED', color: 'var(--cyan)' } : undefined} />
        <Card label="Unsprung R" value={susp.unsprungRear.toFixed(1)} unit="kg"
          badge={linkedRear  ? { text: 'LINKED', color: 'var(--warn)' } : undefined} />
        <Card label="Ratio F (S:U)" value={ratioF.toFixed(1)} unit=":1" status={ratioFSt}
          numVal={ratioF} lo={2} hi={12} optLo={5} optHi={10} />
        <Card label="Ratio R (S:U)" value={ratioR.toFixed(1)} unit=":1" status={ratioRSt}
          numVal={ratioR} lo={2} hi={12} optLo={5} optHi={10} />
        <Card label="Hop Freq F" value={suspension.unsprungFreqFront.toFixed(1)} unit="Hz"
          numVal={suspension.unsprungFreqFront} lo={6} hi={22} optLo={10} optHi={15} />
        <Card label="Hop Freq R" value={suspension.unsprungFreqRear.toFixed(1)} unit="Hz"
          numVal={suspension.unsprungFreqRear} lo={6} hi={22} optLo={10} optHi={15} />
      </div>

      <div className="results-section-title">Anti-Squat / Anti-Dive</div>
      <div className="results-grid">
        <Card label="Gear Ratio"   value={antiSquat.gearRatio.toFixed(3)} />
        <Card label="Anti-Squat"   value={antiSquat.antiSquatPercent.toFixed(1)}  unit="%" status={asStatus(antiSquat.antiSquatPercent)}
          numVal={antiSquat.antiSquatPercent} lo={0} hi={200} optLo={80} optHi={120} />
        <Card label="Chain Contrib" value={antiSquat.chainContribution.toFixed(1)} unit="%" />
        <Card label="Anti-Dive"    value={antiSquat.antiDivePercent.toFixed(1)}   unit="%"
          numVal={antiSquat.antiDivePercent} lo={0} hi={80} optLo={15} optHi={50} />
        <Card label="IC x"         value={antiSquat.IC_x.toFixed(0)}              unit="mm" />
        <Card label="IC y"         value={antiSquat.IC_y.toFixed(0)}              unit="mm" />
      </div>

      <div className="results-section-title">Ergonomics</div>
      <div className="results-grid">
        <Card label="Knee Angle"   value={ergonomics.kneeAngleDeg.toFixed(1)}   unit="°" status={angleStatus(ergonomics.kneeAngleDeg, 90, 150)}
          numVal={ergonomics.kneeAngleDeg} lo={60} hi={180} optLo={90} optHi={130} />
        <Card label="Hip Angle"    value={ergonomics.hipAngleDeg.toFixed(1)}    unit="°" status={angleStatus(ergonomics.hipAngleDeg, 30, 90)}
          numVal={ergonomics.hipAngleDeg} lo={10} hi={130} optLo={40} optHi={90} />
        <Card label="Forward Lean" value={ergonomics.forwardLeanDeg.toFixed(1)} unit="°"
          numVal={ergonomics.forwardLeanDeg} lo={-20} hi={60} optLo={5} optHi={35} />
        <Card label="Seat–Handle"  value={ergonomics.d_SH.toFixed(0)}           unit="mm" />
        <Card label="Seat–Peg"     value={ergonomics.d_SP.toFixed(0)}           unit="mm" />
      </div>

      <div className="results-section-title">Dynamics</div>
      <div className="results-grid">
        <Card label="Front% Braking" value={dynamics.frontPercentBraking.toFixed(1)}  unit="%" />
        <Card label="Front% Accel"   value={dynamics.frontPercentAccel.toFixed(1)}    unit="%" />
        <Card label="Bank Angle"     value={dynamics.bankAngleDeg.toFixed(1)}         unit="°" />
        <Card label="Lateral Force"  value={dynamics.lateralForce.toFixed(0)}         unit="N" />
        <Card label="ΔW Brake"       value={dynamics.deltaW_brake.toFixed(0)}         unit="N" />
        <Card label="ΔW Accel"       value={dynamics.deltaW_accel.toFixed(0)}         unit="N" />
      </div>

      <div className="results-section-title">Stability Limits</div>
      <div className="results-grid">
        <Card label="Wheelie"   value={results.stability.a_wheelie_g.toFixed(2)}  unit="g" />
        <Card label="Stoppie"   value={results.stability.a_stoppie_g.toFixed(2)}  unit="g" />
        <Card label="Lean Lim"  value={results.stability.leanLimitDeg.toFixed(1)} unit="°" />
        <Card label="R_min"     value={(results.stability.R_turn_min_mm / 1000).toFixed(2)} unit="m" />
        <Card label="Grade Max" value={results.stability.gradeMaxDeg.toFixed(1)}  unit="°" />
      </div>
    </>
  );
}
