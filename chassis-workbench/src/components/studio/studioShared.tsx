/**
 * studioShared.tsx — small UI primitives for the Suspension Design Studio.
 * Isolated to the Studio feature. Reuses existing CSS variables (CLAUDE.md §16).
 */
import React from 'react';
import { Provenance, StudioMetric } from '../../engine/studio/types';

// ── Provenance badge ──────────────────────────────────────────────────────────
const PROV: Record<Provenance, { label: string; color: string; title: string }> = {
  book:        { label: 'BOOK',  color: 'var(--accent2)', title: 'From Race Tech Suspension Bible' },
  derived:     { label: 'DERIV', color: 'var(--cyan)',    title: 'Derived (Foale/Cossalter vehicle dynamics)' },
  supplemented:{ label: 'SUPPL', color: 'var(--warn)',    title: 'Supplemented — accepted ME practice (not in book)' },
};

export function SourceBadge({ source, cite }: { source: Provenance; cite?: string }) {
  const p = PROV[source];
  return (
    <span
      title={`${p.title}${cite ? ` — ${cite}` : ''}`}
      style={{
        fontSize: 8, fontWeight: 700, letterSpacing: 0.5, padding: '1px 5px',
        borderRadius: 3, color: p.color, border: `1px solid ${p.color}55`,
        background: `${p.color}12`, fontFamily: 'var(--font, monospace)', whiteSpace: 'nowrap',
      }}
    >
      {p.label}
    </span>
  );
}

// ── Number formatting ─────────────────────────────────────────────────────────
export function fmt(v: number): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100)  return v.toFixed(0);
  if (a >= 10)   return v.toFixed(1);
  if (a >= 1)    return v.toFixed(2);
  return v.toFixed(3);
}

function statusColor(s?: 'ok' | 'warn' | 'na'): string {
  if (s === 'ok')   return 'var(--accent2)';
  if (s === 'warn') return 'var(--warn)';
  return 'var(--text-muted)';
}

// ── Single result row ─────────────────────────────────────────────────────────
export function MetricRow({ m }: { m: StudioMetric }) {
  const col = statusColor(m.status);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center',
      padding: '4px 8px', borderBottom: '1px solid var(--border)', fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: m.status === 'na' ? 'transparent' : col,
          border: m.status === 'na' ? '1px solid var(--border2)' : 'none',
        }} />
        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.label}
        </span>
      </div>
      <div style={{ textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        <span style={{ color: m.status && m.status !== 'na' ? col : 'var(--text-primary)', fontWeight: 600 }}>
          {fmt(m.value)}
        </span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 3, fontSize: 10 }}>{m.unit}</span>
        {m.target && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 9 }}>
            [{fmt(m.target[0])}–{fmt(m.target[1])}]
          </span>
        )}
      </div>
      <SourceBadge source={m.source} cite={m.cite} />
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
export function StudioCard({ title, accent, children, right }: {
  title: string; accent?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
          color: accent ?? 'var(--accent)',
        }}>{title}</span>
        {right}
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}

// ── Compact numeric field (for tight grids; complements PanelShared.PanelRow) ──
export function NumField({ label, value, unit, step = 1, min, max, onChange }: {
  label: string; value: number; unit?: string; step?: number;
  min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}{unit ? ` (${unit})` : ''}</span>
      <input
        type="number" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        style={{
          width: '100%', padding: '4px 6px', borderRadius: 4, fontSize: 11,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          color: 'var(--text-primary)', fontFamily: 'monospace',
        }}
      />
    </label>
  );
}
