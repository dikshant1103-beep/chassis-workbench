import React, { useState } from 'react';

// ── Status helpers ─────────────────────────────────────────────────────────
export type Status = 'ok' | 'warn' | 'bad' | null;

export function getStatus(value: number, lo: number, hi: number, optLo?: number, optHi?: number): Status {
  if (optLo != null && optHi != null) {
    if (value >= optLo && value <= optHi) return 'ok';
    if (value >= lo && value <= hi) return 'warn';
    return 'bad';
  }
  if (value >= lo && value <= hi) return 'ok';
  return 'bad';
}

export function statusColor(s: Status): string {
  if (s === 'ok')   return 'var(--accent2)';
  if (s === 'warn') return 'var(--warn)';
  if (s === 'bad')  return 'var(--danger)';
  return 'var(--border2)';
}

// ── Result callout bar ─────────────────────────────────────────────────────
export function ResultBar({ items }: { items: { label: string; val: string; status?: Status }[] }) {
  return (
    <div className="panel-result-bar">
      {items.map((it, i) => (
        <div key={i} className="panel-result-item">
          <span className="panel-result-label">{it.label}</span>
          <span className={`panel-result-val${it.status ? ' ' + it.status : ''}`}>{it.val}</span>
        </div>
      ))}
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────
export function Section({
  icon, title, status = null, summary, children, defaultOpen = true,
}: {
  icon?: string; title: string; status?: Status; summary?: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dot = statusColor(status);

  return (
    <div className="adv-section">
      <button className="adv-section-hdr" onClick={() => setOpen(o => !o)}>
        <span className="adv-section-dot" style={{ background: dot, boxShadow: status ? `0 0 5px ${dot}` : 'none' }} />
        {icon && <span className="adv-section-icon">{icon}</span>}
        <span className="adv-section-name">{title}</span>
        {summary && <span className="adv-section-summary">{summary}</span>}
        <span className="adv-section-chevron" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
      </button>
      {open && <div className="adv-section-body">{children}</div>}
    </div>
  );
}

// ── Advanced slider row ────────────────────────────────────────────────────
export function PanelRow({
  label, desc, value, min, max, step, unit, onChange,
  status = null, statusText, optMin, optMax,
}: {
  label: string; desc?: string;
  value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
  status?: Status; statusText?: string;
  optMin?: number; optMax?: number;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  function nudge(dir: number) {
    const raw = parseFloat((value + dir * step).toFixed(10));
    onChange(Math.max(min, Math.min(max, raw)));
  }

  const sliderColor = status === 'ok'   ? 'var(--accent2)' :
                      status === 'warn'  ? 'var(--warn)'    :
                      status === 'bad'   ? 'var(--danger)'  : 'var(--accent)';

  return (
    <div className="adv-row">
      <div className="adv-row-top">
        <span className="adv-row-label">{label}</span>
        {statusText && status && (
          <span className="adv-row-badge" style={{
            color: statusColor(status),
            borderColor: statusColor(status) + '55',
            background: statusColor(status) + '12',
          }}>{statusText}</span>
        )}
      </div>
      {desc && <div className="adv-row-desc">{desc}</div>}
      <div className="adv-row-ctrl">
        <div className="adv-slider-wrap">
          {optMin != null && optMax != null && (
            <div className="adv-opt-zone" style={{
              left: `${Math.max(0, ((optMin - min) / (max - min)) * 100)}%`,
              width: `${Math.max(0, ((optMax - optMin) / (max - min)) * 100)}%`,
            }} />
          )}
          <input
            type="range" min={min} max={max} step={step} value={value}
            style={{
              background: `linear-gradient(90deg, ${sliderColor} 0%, ${sliderColor} ${pct}%, var(--border2) ${pct}%, var(--border2) 100%)`,
            }}
            onChange={e => onChange(parseFloat(e.target.value))}
          />
        </div>
        <div className="adv-num-row">
          <button className="adv-nudge" onClick={() => nudge(-1)} title={`−${step}`}>−</button>
          <input
            type="number" className="adv-num" min={min} max={max} step={step} value={value}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
          />
          <button className="adv-nudge" onClick={() => nudge(+1)} title={`+${step}`}>+</button>
        </div>
        <span className="adv-unit">{unit}</span>
      </div>
    </div>
  );
}

// ── Select row ─────────────────────────────────────────────────────────────
export function SelectRow({ label, value, options, onChange }: {
  label: string; value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="adv-row">
      <div className="adv-row-top">
        <span className="adv-row-label">{label}</span>
      </div>
      <div className="adv-select-row">
        {options.map(o => (
          <button
            key={o.val}
            className={`adv-chip${value === o.val ? ' active' : ''}`}
            onClick={() => onChange(o.val)}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}
