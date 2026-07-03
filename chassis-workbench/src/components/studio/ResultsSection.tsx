/** ResultsSection — Studio Section 5: front + rear results with sources. */
import React from 'react';
import { StudioResults, StudioMetric, Axle } from '../../engine/studio/types';
import { MetricRow, StudioCard, SourceBadge } from './studioShared';
import { triggerDownload } from '../../utils/exportUtils';

// group keys are the suffix-free base; axle suffix (F/R) is appended per column
const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Loads', keys: ['staticLoad', 'dynLoad'] },
  { title: 'Ratios & Rates', keys: ['mr', 'suspRatio', 'prog', 'wheelRate', 'effRate'] },
  { title: 'Frequency & Damping', keys: ['rideFreq', 'natFreq', 'dampRatio', 'critDamp', 'optDamp'] },
  { title: 'Sag', keys: ['staticSag', 'staticSagPct', 'riderSag', 'freeSagPct'] },
  { title: 'Travel & Packaging', keys: ['wheelTravel', 'shockTravel', 'springComp', 'coilBind', 'solidLen', 'maxDefl', 'packaging'] },
  { title: 'Forces & Stress', keys: ['shockForce', 'wheelForce', 'springForce', 'springStress', 'sf'] },
];

function Column({ axle, metrics }: { axle: Axle; metrics: StudioMetric[] }) {
  const byKey = new Map(metrics.filter(m => m.axle === axle).map(m => [m.key, m]));
  const A = axle === 'front' ? 'F' : 'R';
  const accent = axle === 'front' ? 'var(--cyan)' : 'var(--accent2)';
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: accent,
        padding: '4px 2px', textTransform: 'uppercase',
        borderBottom: `2px solid ${accent}`, marginBottom: 6,
      }}>
        {axle === 'front' ? '◣ Front' : '◢ Rear'}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {GROUPS.map(group => (
          <div key={group.title}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-muted)', padding: '1px 6px', textTransform: 'uppercase' }}>
              {group.title}
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {group.keys.map(k => {
                const m = byKey.get(k + A);
                return m ? <MetricRow key={k} m={m} /> : null;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultsSection({ results }: { results: StudioResults }) {
  function exportCSV() {
    const rows = [['axle', 'key', 'label', 'value', 'unit', 'source', 'cite', 'target_min', 'target_max', 'status']];
    for (const m of results.metrics) {
      rows.push([
        m.axle ?? '', m.key, m.label, String(m.value), m.unit, m.source, m.cite,
        m.target ? String(m.target[0]) : '', m.target ? String(m.target[1]) : '', m.status ?? '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    triggerDownload(csv, 'suspension-studio-results.csv', 'text/csv');
  }
  function exportJSON() {
    triggerDownload(JSON.stringify(results.metrics, null, 2), 'suspension-studio-results.json', 'application/json');
  }

  return (
    <StudioCard title="5 · Results — Front & Rear" accent="var(--cyan)" right={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={exportCSV} style={btn}>↓ CSV</button>
        <button onClick={exportJSON} style={btn}>↓ JSON</button>
      </div>
    }>
      {results.warnings.length > 0 && (
        <div style={{
          marginBottom: 8, padding: '6px 8px', borderRadius: 6, fontSize: 10,
          background: 'var(--warn)12', border: '1px solid var(--warn)55', color: 'var(--warn)',
        }}>
          {results.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Column axle="front" metrics={results.metrics} />
        <Column axle="rear" metrics={results.metrics} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>SOURCES:</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
          <SourceBadge source="book" /> Race Tech Suspension Bible
        </span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
          <SourceBadge source="derived" /> Derived (Foale / Cossalter)
        </span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
          <SourceBadge source="supplemented" /> Supplemented (ME practice)
        </span>
      </div>
    </StudioCard>
  );
}

const btn: React.CSSProperties = {
  fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)',
};
