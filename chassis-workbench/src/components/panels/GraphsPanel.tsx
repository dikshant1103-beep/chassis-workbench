import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { ComputeAllInput, ComputeAllResult } from '../../engine/types';
import { computeAll } from '../../engine/computeAll';
import SweepChart from '../charts/SweepChart';
import WeightBar from '../charts/WeightBar';

// ─── utilities ────────────────────────────────────────────
function linspace(a: number, b: number, n = 42): number[] {
  return Array.from({ length: n }, (_, i) => a + (i / (n - 1)) * (b - a));
}

function sweep(
  base: ComputeAllInput,
  modify: (inp: ComputeAllInput, v: number) => ComputeAllInput,
  values: number[],
  extract: (r: ComputeAllResult) => number,
): { x: number; y: number }[] {
  return values.flatMap(v => {
    try {
      const r = computeAll(modify(base, v));
      return [{ x: +v.toFixed(3), y: +extract(r).toFixed(3) }];
    } catch {
      return [];
    }
  });
}

// Shallow-clone helpers
const setGeo  = (inp: ComputeAllInput, patch: Partial<ComputeAllInput['geometry']>): ComputeAllInput =>
  ({ ...inp, geometry: { ...inp.geometry, ...patch } });
const setSusp = (inp: ComputeAllInput, patch: Partial<ComputeAllInput['suspension']>): ComputeAllInput =>
  ({ ...inp, suspension: { ...inp.suspension, ...patch } });
const setChain = (inp: ComputeAllInput, patch: Partial<ComputeAllInput['chain']>): ComputeAllInput =>
  ({ ...inp, chain: { ...inp.chain, ...patch } });
const setErgo = (inp: ComputeAllInput, patch: Partial<ComputeAllInput['ergo']>): ComputeAllInput =>
  ({ ...inp, ergo: { ...inp.ergo, ...patch } });
const setDyn  = (inp: ComputeAllInput, patch: Partial<ComputeAllInput['dynamics']>): ComputeAllInput =>
  ({ ...inp, dynamics: { ...inp.dynamics, ...patch } });

// ─── component ────────────────────────────────────────────
export default function GraphsPanel() {
  const input = useStore(s => s.input);

  // All sweep data — memoised per full input reference
  const geo = useMemo(() => ({
    trailVsAngle: sweep(input,
      (b, v) => setGeo(b, { headAngle: v }), linspace(15, 40),
      r => r.geometry.trail),
    trailVsOffset: sweep(input,
      (b, v) => setGeo(b, { forkOffset: v }), linspace(0, 100),
      r => r.geometry.trail),
    mechTrailVsAngle: sweep(input,
      (b, v) => setGeo(b, { headAngle: v }), linspace(15, 40),
      r => r.geometry.mechanicalTrail),
    wheelbaseVsTrail: sweep(input,
      (b, v) => setGeo(b, { wheelbase: v }), linspace(1200, 1800),
      r => r.geometry.trail),
  }), [input]);

  const susp = useMemo(() => ({
    freqVsKFront: sweep(input,
      (b, v) => setSusp(b, { springRateFront: v }), linspace(2, 30),
      r => r.suspension.natFreqFront),
    freqVsKRear: sweep(input,
      (b, v) => setSusp(b, { springRateRear: v }), linspace(20, 200),
      r => r.suspension.natFreqRear),
    wrVsMRFront: sweep(input,
      (b, v) => setSusp(b, { motionRatioFront: v }), linspace(0.5, 1.0),
      r => r.suspension.wheelRateFront),
    wrVsMRRear: sweep(input,
      (b, v) => setSusp(b, { motionRatioRear: v }), linspace(0.4, 0.9),
      r => r.suspension.wheelRateRear),
    sagPctVsTravelF: sweep(input,
      (b, v) => setSusp(b, { forkTravel: v }), linspace(50, 300),
      r => r.suspension.sagPercentFront),
    sagPctVsTravelR: sweep(input,
      (b, v) => setSusp(b, { shockTravel: v }), linspace(30, 150),
      r => r.suspension.sagPercentRear),
  }), [input]);

  const as = useMemo(() => ({
    asVsRearSprocket: sweep(input,
      (b, v) => setChain(b, { rearSprocket: Math.round(v) }), linspace(28, 70, 43),
      r => r.antiSquat.antiSquatPercent),
    asVsPivotHeight: sweep(input,
      (b, v) => setGeo(b, { swingarmPivotHeight: v }), linspace(200, 500),
      r => r.antiSquat.antiSquatPercent),
    asVsSwingarmLen: sweep(input,
      (b, v) => setGeo(b, { swingarmLength: v }), linspace(350, 800),
      r => r.antiSquat.antiSquatPercent),
    chainContribVsAngle: sweep(input,
      (b, v) => setChain(b, { chainForceAngle: v }), linspace(-10, 15),
      r => r.antiSquat.chainContribution),
  }), [input]);

  const ergo = useMemo(() => ({
    kneeVsPegY: sweep(input,
      (b, v) => setErgo(b, { footpegY: v }), linspace(100, 600),
      r => r.ergonomics.kneeAngleDeg),
    hipVsSeatY: sweep(input,
      (b, v) => setErgo(b, { seatY: v }), linspace(600, 1000),
      r => r.ergonomics.hipAngleDeg),
    leanVsBarY: sweep(input,
      (b, v) => setErgo(b, { handlebarY: v }), linspace(700, 1300),
      r => r.ergonomics.forwardLeanDeg),
    kneeVsPegX: sweep(input,
      (b, v) => setErgo(b, { footpegX: v }), linspace(400, 1300),
      r => r.ergonomics.kneeAngleDeg),
  }), [input]);

  const dyn = useMemo(() => ({
    frontPctVsBrake: sweep(input,
      (b, v) => setDyn(b, { brakingDecel: v }), linspace(0.1, 1.2),
      r => r.dynamics.frontPercentBraking),
    frontPctVsAccel: sweep(input,
      (b, v) => setDyn(b, { accelG: v }), linspace(0.05, 1.0),
      r => r.dynamics.frontPercentAccel),
    bankVsSpeed: sweep(input,
      (b, v) => setDyn(b, { cornerSpeed: v }), linspace(5, 60),
      r => r.dynamics.bankAngleDeg),
    bankVsRadius: sweep(input,
      (b, v) => setDyn(b, { cornerRadius: v }), linspace(5, 200),
      r => r.dynamics.bankAngleDeg),
  }), [input]);

  const g  = input.geometry;
  const s  = input.suspension;
  const c  = input.chain;
  const e  = input.ergo;
  const d  = input.dynamics;

  return (
    <div className="graphs-area">

      {/* ── Geometry ── */}
      <div className="charts-section-title">Geometry — Sensitivity</div>
      <div className="charts-grid">
        <SweepChart
          title="Trail vs Head Angle"
          data={geo.trailVsAngle}
          xLabel="Head Angle" xUnit="°"
          yLabel="Trail" yUnit="mm"
          currentX={g.headAngle}
          okMin={80} okMax={120} warnMin={60} warnMax={150}
        />
        <SweepChart
          title="Trail vs Fork Offset"
          data={geo.trailVsOffset}
          xLabel="Fork Offset" xUnit="mm"
          yLabel="Trail" yUnit="mm"
          currentX={g.forkOffset}
          okMin={80} okMax={120} warnMin={60} warnMax={150}
        />
        <SweepChart
          title="Mechanical Trail vs Head Angle"
          data={geo.mechTrailVsAngle}
          xLabel="Head Angle" xUnit="°"
          yLabel="Mech. Trail" yUnit="mm"
          currentX={g.headAngle}
        />
        <SweepChart
          title="Trail vs Wheelbase"
          data={geo.wheelbaseVsTrail}
          xLabel="Wheelbase" xUnit="mm"
          yLabel="Trail" yUnit="mm"
          currentX={g.wheelbase}
          okMin={80} okMax={120}
        />
      </div>

      {/* ── CoG / Mass ── */}
      <div className="charts-section-title">Centre of Gravity</div>
      <div className="charts-grid">
        <WeightBar />
      </div>

      {/* ── Suspension ── */}
      <div className="charts-section-title">Suspension — Sensitivity</div>
      <div className="charts-grid">
        <SweepChart
          title="Nat. Freq. Front vs Spring Rate"
          data={susp.freqVsKFront}
          xLabel="k Front" xUnit="N/mm"
          yLabel="Freq" yUnit="Hz"
          currentX={s.springRateFront}
          okMin={0.9} okMax={1.4} warnMin={0.7} warnMax={1.8}
        />
        <SweepChart
          title="Nat. Freq. Rear vs Spring Rate"
          data={susp.freqVsKRear}
          xLabel="k Rear" xUnit="N/mm"
          yLabel="Freq" yUnit="Hz"
          currentX={s.springRateRear}
          okMin={0.9} okMax={1.4} warnMin={0.7} warnMax={1.8}
        />
        <SweepChart
          title="Wheel Rate vs Motion Ratio Front"
          data={susp.wrVsMRFront}
          xLabel="MR Front" xUnit=""
          yLabel="WR" yUnit="N/mm"
          currentX={s.motionRatioFront}
        />
        <SweepChart
          title="Wheel Rate vs Motion Ratio Rear"
          data={susp.wrVsMRRear}
          xLabel="MR Rear" xUnit=""
          yLabel="WR" yUnit="N/mm"
          currentX={s.motionRatioRear}
        />
        <SweepChart
          title="Front Sag% vs Fork Travel"
          data={susp.sagPctVsTravelF}
          xLabel="Fork Travel" xUnit="mm"
          yLabel="Sag%" yUnit="%"
          currentX={s.forkTravel}
          okMin={22} okMax={30} warnMin={18} warnMax={38}
        />
        <SweepChart
          title="Rear Sag% vs Shock Travel"
          data={susp.sagPctVsTravelR}
          xLabel="Shock Travel" xUnit="mm"
          yLabel="Sag%" yUnit="%"
          currentX={s.shockTravel}
          okMin={22} okMax={30} warnMin={18} warnMax={38}
        />
      </div>

      {/* ── Anti-Squat ── */}
      <div className="charts-section-title">Anti-Squat / Chain — Sensitivity</div>
      <div className="charts-grid">
        <SweepChart
          title="Anti-Squat % vs Rear Sprocket"
          data={as.asVsRearSprocket}
          xLabel="Rear Sprocket" xUnit="T"
          yLabel="AS%" yUnit="%"
          currentX={c.rearSprocket}
          okMin={60} okMax={120} warnMin={30} warnMax={140}
        />
        <SweepChart
          title="Anti-Squat % vs Pivot Height"
          data={as.asVsPivotHeight}
          xLabel="Pivot Height" xUnit="mm"
          yLabel="AS%" yUnit="%"
          currentX={g.swingarmPivotHeight}
          okMin={60} okMax={120} warnMin={30} warnMax={140}
        />
        <SweepChart
          title="Anti-Squat % vs Swingarm Length"
          data={as.asVsSwingarmLen}
          xLabel="Swingarm Len." xUnit="mm"
          yLabel="AS%" yUnit="%"
          currentX={g.swingarmLength}
          okMin={60} okMax={120}
        />
        <SweepChart
          title="Chain Contribution vs Chain Angle"
          data={as.chainContribVsAngle}
          xLabel="Chain Angle" xUnit="°"
          yLabel="Chain Contrib." yUnit="%"
          currentX={c.chainForceAngle}
        />
      </div>

      {/* ── Ergonomics ── */}
      <div className="charts-section-title">Ergonomics — Sensitivity</div>
      <div className="charts-grid">
        <SweepChart
          title="Knee Angle vs Footpeg Y"
          data={ergo.kneeVsPegY}
          xLabel="Footpeg Y" xUnit="mm"
          yLabel="Knee Angle" yUnit="°"
          currentX={e.footpegY}
          okMin={90} okMax={150} warnMin={70} warnMax={165}
        />
        <SweepChart
          title="Knee Angle vs Footpeg X"
          data={ergo.kneeVsPegX}
          xLabel="Footpeg X" xUnit="mm"
          yLabel="Knee Angle" yUnit="°"
          currentX={e.footpegX}
          okMin={90} okMax={150}
        />
        <SweepChart
          title="Hip Angle vs Seat Height"
          data={ergo.hipVsSeatY}
          xLabel="Seat Y" xUnit="mm"
          yLabel="Hip Angle" yUnit="°"
          currentX={e.seatY}
          okMin={30} okMax={90} warnMin={20} warnMax={100}
        />
        <SweepChart
          title="Forward Lean vs Handlebar Height"
          data={ergo.leanVsBarY}
          xLabel="Handlebar Y" xUnit="mm"
          yLabel="Lean Angle" yUnit="°"
          currentX={e.handlebarY}
        />
      </div>

      {/* ── Dynamics ── */}
      <div className="charts-section-title">Dynamics — Sensitivity</div>
      <div className="charts-grid">
        <SweepChart
          title="Front Load % vs Braking Decel"
          data={dyn.frontPctVsBrake}
          xLabel="Decel" xUnit="g"
          yLabel="Front%" yUnit="%"
          currentX={d.brakingDecel}
          okMin={55} okMax={80}
        />
        <SweepChart
          title="Front Load % vs Acceleration"
          data={dyn.frontPctVsAccel}
          xLabel="Accel" xUnit="g"
          yLabel="Front%" yUnit="%"
          currentX={d.accelG}
        />
        <SweepChart
          title="Bank Angle vs Corner Speed"
          data={dyn.bankVsSpeed}
          xLabel="Speed" xUnit="m/s"
          yLabel="Bank Angle" yUnit="°"
          currentX={d.cornerSpeed}
          okMin={0} okMax={45} warnMin={0} warnMax={55}
        />
        <SweepChart
          title="Bank Angle vs Corner Radius"
          data={dyn.bankVsRadius}
          xLabel="Radius" xUnit="m"
          yLabel="Bank Angle" yUnit="°"
          currentX={d.cornerRadius}
        />
      </div>

    </div>
  );
}
