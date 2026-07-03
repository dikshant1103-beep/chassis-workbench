/** StudioGraphs — 8 engineering plots, overlaying front + rear (Recharts). */
import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { StudioCurves } from '../../engine/studio/types';
import { StudioCard, fmt } from './studioShared';

interface Plot { title: string; yKey: string; yUnit: string; }

const SWEEP_PLOTS: Plot[] = [
  { title: 'Wheel vs Shock Travel', yKey: 'shockTravel', yUnit: 'mm' },
  { title: 'Motion Ratio Curve', yKey: 'motionRatio', yUnit: '–' },
  { title: 'Spring Compression', yKey: 'springCompression', yUnit: 'mm' },
  { title: 'Wheel Rate', yKey: 'wheelRate', yUnit: 'N/mm' },
  { title: 'Ride Frequency', yKey: 'rideFrequency', yUnit: 'Hz' },
  { title: 'Stress Distribution', yKey: 'springStress', yUnit: 'N/mm²' },
  { title: 'Shock Force', yKey: 'shockForce', yUnit: 'N' },
];

function MergedChart({ title, yUnit, data }: { title: string; yUnit: string; data: any[] }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--surface)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
        {title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({yUnit})</span>
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 2, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" />
            <XAxis dataKey="x" tick={{ fontSize: 8, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)' }} width={40} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 10 }}
              formatter={(v: any, n: any) => [`${fmt(Number(v))} ${yUnit}`, String(n)]}
              labelFormatter={(l: any) => `${fmt(Number(l))} mm`}
            />
            <Line type="monotone" dataKey="front" stroke="var(--cyan)" dot={false} strokeWidth={2} name="front" />
            <Line type="monotone" dataKey="rear" stroke="var(--accent2)" dot={false} strokeWidth={2} name="rear" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function StudioGraphs({ curves }: { curves: StudioCurves }) {
  // Merge front/rear sweep rows by index (both sampled 0..travel in 31 steps).
  const merged = useMemo(() => SWEEP_PLOTS.map(p => {
    const n = Math.max(curves.front.sweep.length, curves.rear.sweep.length);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const fr = curves.front.sweep[i], re = curves.rear.sweep[i];
      rows.push({
        x: re ? re.wheelTravel : fr ? fr.wheelTravel : i,
        front: fr ? (fr as any)[p.yKey] : null,
        rear: re ? (re as any)[p.yKey] : null,
      });
    }
    return { plot: p, rows };
  }), [curves]);

  // Force vs deflection uses its own x axis.
  const fd = useMemo(() => {
    const n = Math.max(curves.front.forceDeflection.length, curves.rear.forceDeflection.length);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const fr = curves.front.forceDeflection[i], re = curves.rear.forceDeflection[i];
      rows.push({ x: re ? re.deflection : fr ? fr.deflection : i, front: fr ? fr.force : null, rear: re ? re.force : null });
    }
    return rows;
  }, [curves]);

  return (
    <StudioCard title="Engineering Graphs — Front (cyan) vs Rear (green)" accent="var(--accent2)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
        <MergedChart title="Force vs Deflection" yUnit="N" data={fd} />
        {merged.map(m => (
          <MergedChart key={m.plot.title} title={m.plot.title} yUnit={m.plot.yUnit} data={m.rows} />
        ))}
      </div>
    </StudioCard>
  );
}
