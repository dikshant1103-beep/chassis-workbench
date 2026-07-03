/** AngleOptimizerSection — optimal shock mounting angle (front or rear) + rationale. */
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import { StudioInput, Axle } from '../../engine/studio/types';
import { optimizeShockAngle } from '../../engine/studio/angleOptimizer';
import { StudioCard, fmt } from './studioShared';

export default function AngleOptimizerSection({ input }: { input: StudioInput }) {
  const [axle, setAxle] = useState<Axle>('rear');
  const frontIsFork = input.front.type === 'telescopic' || input.front.type === 'usd';
  const effAxle: Axle = axle === 'front' && frontIsFork ? 'rear' : axle;
  const result = useMemo(() => optimizeShockAngle(input, effAxle), [input, effAxle]);
  const best = result.best;

  const data = result.samples.map(s => ({ angle: s.angleDeg, score: s.score, mr: s.motionRatio }));

  return (
    <StudioCard title="Angle Optimizer" accent="var(--accent2)" right={
      <div style={{ display: 'flex', gap: 4 }}>
        {(['front', 'rear'] as Axle[]).map(a => {
          const disabled = a === 'front' && frontIsFork;
          return (
            <button key={a} onClick={() => setAxle(a)} disabled={disabled}
              title={disabled ? 'Telescopic/USD fork has fixed MR=1 — no mounting angle to optimize' : ''}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
                background: effAxle === a ? 'var(--accent2)' : 'var(--surface)',
                color: effAxle === a ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)', textTransform: 'capitalize',
              }}>{a}</button>
          );
        })}
      </div>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
            RECOMMENDED ANGLE · {effAxle.toUpperCase()}
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--accent2)', lineHeight: 1.1, fontFamily: 'monospace' }}>
            {best ? `${best.angleDeg.toFixed(1)}°` : '—'}
          </div>
          {best && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'grid', gap: 1 }}>
              <div>MR <b style={{ color: 'var(--text-primary)' }}>{fmt(best.motionRatio)}</b></div>
              <div>Wheel rate <b style={{ color: 'var(--text-primary)' }}>{fmt(best.wheelRate)}</b> N/mm</div>
              <div>Ride freq <b style={{ color: 'var(--text-primary)' }}>{fmt(best.rideFrequency)}</b> Hz</div>
              <div>Rising rate <b style={{ color: 'var(--text-primary)' }}>{fmt(best.progression)}</b></div>
              <div>Usable travel <b style={{ color: 'var(--text-primary)' }}>{fmt(best.suspensionTravel)}</b> mm</div>
              <div>Safety factor <b style={{ color: 'var(--text-primary)' }}>{fmt(best.safetyFactor)}</b></div>
              <div>Packaging <b style={{ color: 'var(--text-primary)' }}>{fmt(best.packagingClearance)}</b> mm</div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>REASON</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, color: 'var(--text-primary)', display: 'grid', gap: 2 }}>
            {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <div style={{ height: 130, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" />
                <XAxis dataKey="angle" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} unit="°" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={[0, 1]} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 10 }}
                  formatter={(val: any, name: any) => [fmt(Number(val)), String(name)]}
                  labelFormatter={(l: any) => `${l}° from vertical`}
                />
                {best && <ReferenceLine x={best.angleDeg} stroke="var(--accent2)" strokeDasharray="3 3" />}
                <Line type="monotone" dataKey="score" stroke="var(--accent2)" dot={false} strokeWidth={2} name="score" />
                <Line type="monotone" dataKey="mr" stroke="var(--cyan)" dot={false} strokeWidth={1} name="MR" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </StudioCard>
  );
}
