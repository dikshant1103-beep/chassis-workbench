/**
 * SuspensionDesignStudio — container for the "Suspension Design Studio" tab (v2).
 *
 * FULLY ISOLATED: owns local React state, NEVER writes back to the global store.
 *
 * SMART-FOLLOW: subscribes to the selected bike (familyName). When the bike
 * changes it auto-reseeds IF the user hasn't edited anything; if there are local
 * edits it shows a "bike changed — re-seed?" chip so edits aren't silently wiped.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  StudioInput, StudioVehicle, FrontSuspension, RearSuspension, StudioTargets,
  BikeCategory, DamperType,
} from '../../engine/studio/types';
import { computeStudio } from '../../engine/studio/computeStudio';
import { defaultStudioInput } from '../../engine/studio/knowledgeModel';
import { calibrateLinkage } from '../../engine/studio/linkage';

import VehicleDataSection from './VehicleDataSection';
import FrontSuspensionSection from './FrontSuspensionSection';
import RearSuspensionSection from './RearSuspensionSection';
import RideTargetsSection from './RideTargetsSection';
import ResultsSection from './ResultsSection';
import AngleOptimizerSection from './AngleOptimizerSection';
import SuspensionDiagram from './SuspensionDiagram';
import StudioGraphs from './StudioGraphs';

const DEG = Math.PI / 180;

function detectCategory(name: string): BikeCategory {
  const n = (name || '').toLowerCase();
  if (/super\s?moto/.test(n)) return 'supermoto';
  if (/enduro|off.?road|dirt|mx/.test(n)) return 'enduro';
  if (/adv|adventure/.test(n)) return 'adv';
  if (/cruiser/.test(n)) return 'cruiser';
  if (/tour/.test(n)) return 'touring';
  if (/scooter|urban|cvt/.test(n)) return 'scooter';
  if (/naked|roadster|standard/.test(n)) return 'naked';
  return 'sport';
}

/** Build a Studio input from the currently selected bike (read-only snapshot). */
function seedFromBike(): StudioInput {
  const st = useStore.getState();
  const inp = st.input;
  const res = st.results;
  const category = detectCategory(st.familyName);
  const base = defaultStudioInput(category);

  try {
    const comps = inp.massComponents ?? [];
    const total = comps.reduce((s, c) => s + c.mass, 0);
    const rider = comps.filter(c => /rider/i.test(c.label)).reduce((s, c) => s + c.mass, 0);
    const pass = comps.filter(c => /passenger/i.test(c.label)).reduce((s, c) => s + c.mass, 0);
    if (total > 0) {
      base.vehicle.vehicleMass = Math.round(Math.max(1, total - rider - pass));
      if (rider > 0) base.vehicle.riderMass = Math.round(rider);
      if (pass > 0) base.vehicle.passengerMass = Math.round(pass);
    }
    base.vehicle.unsprungFront = inp.suspension?.unsprungFront ?? base.vehicle.unsprungFront;
    base.vehicle.unsprungRear = inp.suspension?.unsprungRear ?? base.vehicle.unsprungRear;
    if (res?.cog?.frontPercent) base.vehicle.frontWeightPct = +res.cog.frontPercent.toFixed(1);

    const g = inp.geometry;
    if (g) {
      base.vehicle.wheelbase = g.wheelbase ?? base.vehicle.wheelbase;
      base.vehicle.frontWheelDia = g.frontWheelDia ?? base.vehicle.frontWheelDia;
      base.vehicle.rearWheelDia = g.rearWheelDia ?? base.vehicle.rearWheelDia;

      const L = g.swingarmLength || base.rear.swingarmLength;
      const dy = (g.rearAxleHeight ?? 320) - (g.swingarmPivotHeight ?? 380);
      base.rear.swingarmLength = L;
      base.rear.swingarmAngleDeg = +(Math.asin(Math.max(-1, Math.min(1, dy / L))) / DEG).toFixed(1);
      // Re-place pivot + shock hardpoints in the full-bike frame for this wheelbase.
      const Rr = base.vehicle.rearWheelDia / 2;
      const pivot = { x: Math.round(base.vehicle.wheelbase - L * Math.cos(base.rear.swingarmAngleDeg * DEG)), y: Math.round((g.swingarmPivotHeight ?? Rr + 70)) };
      base.rear.swingarmPivot = pivot;
      base.rear.lowerShockMount = { x: Math.round(pivot.x + 0.38 * L * Math.cos(base.rear.swingarmAngleDeg * DEG)), y: Math.round(pivot.y + 0.38 * L * Math.sin(base.rear.swingarmAngleDeg * DEG) + 30) };
      base.rear.upperShockMount = { x: Math.round(pivot.x + L * 0.12), y: Math.round(pivot.y + 350) };
      // Re-calibrate the linkage to the seeded swingarm geometry (a fixed rocker
      // offset would otherwise produce a degenerate four-bar).
      if (base.rear.type === 'monoshock-linkage') base.rear.linkage = calibrateLinkage(base.rear, 0.32);

      if (g.headAngle) base.front.rakeDeg = g.headAngle;
      if (g.forkLength) base.front.forkLength = g.forkLength;
    }
    if (inp.suspension?.shockTravel) base.rear.shockStroke = inp.suspension.shockTravel;
    if (inp.suspension?.springRateFront) base.front.forkSpringRate = inp.suspension.springRateFront;
    // Seed drivetrain sprockets + fork offset from the real bike (chain/IC/trail).
    if (inp.chain && !inp.chain.isCVT) {
      base.drivetrain.frontSprocket = inp.chain.frontSprocket ?? base.drivetrain.frontSprocket;
      base.drivetrain.rearSprocket = inp.chain.rearSprocket ?? base.drivetrain.rearSprocket;
      base.drivetrain.isChainDrive = true;
    } else if (inp.chain?.isCVT) {
      base.drivetrain.isChainDrive = false;
    }
    if (inp.geometry?.forkOffset) base.front.forkOffset = inp.geometry.forkOffset;
  } catch {
    /* fall back to category defaults */
  }
  return base;
}

export default function SuspensionDesignStudio() {
  const familyName = useStore(s => s.familyName);  // re-renders on bike change
  const [input, setInput] = useState<StudioInput>(seedFromBike);
  const [dirty, setDirty] = useState(false);
  const [pendingBike, setPendingBike] = useState<string | null>(null);
  const seededFamily = useRef(familyName);

  // Smart-follow: react to bike changes.
  useEffect(() => {
    if (familyName === seededFamily.current) return;
    if (!dirty) {
      setInput(seedFromBike());
      seededFamily.current = familyName;
      setPendingBike(null);
    } else {
      setPendingBike(familyName);  // offer a re-seed chip; keep user edits
    }
  }, [familyName, dirty]);

  const results = useMemo(() => computeStudio(input), [input]);

  const mark = () => setDirty(true);
  const patchVehicle = (p: Partial<StudioVehicle>) => { mark(); setInput(s => ({ ...s, vehicle: { ...s.vehicle, ...p } })); };
  const patchFront = (p: Partial<FrontSuspension>) => { mark(); setInput(s => ({ ...s, front: { ...s.front, ...p } })); };
  const patchRear = (p: Partial<RearSuspension>) => {
    mark();
    setInput(s => {
      const rear = { ...s.rear, ...p };
      // If swingarm/shock-mount geometry changed on a linkage bike (and the patch
      // isn't directly editing the linkage), re-solve a valid rising-rate four-bar.
      const geomKeys = ['swingarmPivot', 'swingarmLength', 'swingarmAngleDeg', 'lowerShockMount', 'upperShockMount', 'type'];
      const touchedGeom = Object.keys(p).some(k => geomKeys.includes(k));
      if (rear.type === 'monoshock-linkage' && touchedGeom && p.linkage === undefined) {
        rear.linkage = calibrateLinkage(rear, 0.32);
      } else if (rear.type !== 'monoshock-linkage') {
        rear.linkage = null;
      }
      return { ...s, rear };
    });
  };
  const patchTargets = (p: Partial<StudioTargets>) => { mark(); setInput(s => ({ ...s, targets: { ...s.targets, ...p } })); };
  const setDamper = (d: DamperType) => patchRear({ damperType: d });

  const reseed = () => { setInput(seedFromBike()); seededFamily.current = useStore.getState().familyName; setDirty(false); setPendingBike(null); };
  const loadDefaults = () => { setInput(defaultStudioInput(input.vehicle.category)); setDirty(true); };

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', width: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Left: inputs */}
      <div style={{ width: 380, flexShrink: 0, minHeight: 0, overflowY: 'auto', borderRight: '1px solid var(--border)', padding: 10 }}>
        {pendingBike && (
          <div style={{
            marginBottom: 8, padding: '6px 8px', borderRadius: 6, fontSize: 10,
            background: 'var(--cyan)15', border: '1px solid var(--cyan)66', color: 'var(--cyan)',
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
          }}>
            <span>Bike changed to "{pendingBike}". Re-seed Studio? (your edits will be replaced)</span>
            <button onClick={reseed} style={{ ...hdrBtn, flex: 'none', color: 'var(--cyan)', borderColor: 'var(--cyan)66' }}>Re-seed</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1 }}>
            Bike: <b style={{ color: 'var(--text-primary)' }}>{familyName}</b>{dirty ? ' · edited' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={reseed} style={hdrBtn} title="Re-seed inputs from the currently selected bike">↺ From bike</button>
          <button onClick={loadDefaults} style={hdrBtn} title="Load defaults for the selected category">⤓ {input.vehicle.category}</button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <VehicleDataSection vehicle={input.vehicle} onChange={patchVehicle} />
          <FrontSuspensionSection front={input.front} onChange={patchFront} />
          <RearSuspensionSection rear={input.rear} damperType={input.rear.damperType} onChange={patchRear} onDamper={setDamper} />
          <RideTargetsSection targets={input.targets} onChange={patchTargets} />
        </div>
      </div>

      {/* Right: diagram + optimizer + results + graphs (scrolls independently) */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', padding: 12, display: 'grid', gap: 12, gridAutoRows: 'min-content' }}>
        <div style={{
          border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
            Visualization — full bike side view
          </div>
          <SuspensionDiagram input={input} results={results} onFront={patchFront} onRear={patchRear} />
          <KpiStrip raw={results.raw} />
        </div>
        <AngleOptimizerSection input={input} />
        <ResultsSection results={results} />
        <StudioGraphs curves={results.curves} />
      </div>
    </div>
  );
}

const hdrBtn: React.CSSProperties = {
  fontSize: 10, padding: '4px 9px', borderRadius: 4, cursor: 'pointer', flex: 1,
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)',
};

// Headline metrics under the diagram — front vs rear at a glance.
function KpiStrip({ raw }: { raw: Record<string, number> }) {
  const fmt = (v: number, dp = 1) => (isFinite(v) ? v.toFixed(dp) : '—');
  const cell = (label: string, fv: string, rv: string) => (
    <div style={{ flex: 1, minWidth: 92, padding: '5px 8px', borderRight: '1px solid var(--border)' }}>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
        <span style={{ color: 'var(--cyan)' }}>{fv}</span>
        <span style={{ color: 'var(--text-muted)' }}> / </span>
        <span style={{ color: 'var(--accent2)' }}>{rv}</span>
      </div>
    </div>
  );
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span style={{ color: 'var(--cyan)' }}>■ front</span> / <span style={{ color: 'var(--accent2)' }}>■ rear</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--surface2)' }}>
        {cell('Motion ratio', fmt(raw.frontMR, 2), fmt(raw.rearMR, 2))}
        {cell('Wheel rate N/mm', fmt(raw.frontWheelRate), fmt(raw.rearWheelRate))}
        {cell('Ride freq Hz', fmt(raw.frontRideFreq, 2), fmt(raw.rearRideFreq, 2))}
        {cell('Static sag %', fmt(raw.frontSagPct, 0), fmt(raw.rearSagPct, 0))}
        {cell('Safety factor', fmt(raw.frontSF, 2), fmt(raw.rearSF, 2))}
        {cell('Rising rate', fmt(raw.frontProgression, 2), fmt(raw.rearProgression, 2))}
      </div>
    </div>
  );
}
