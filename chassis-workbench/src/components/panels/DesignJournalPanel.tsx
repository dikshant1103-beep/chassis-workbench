/**
 * DesignJournalPanel.tsx — R5: Iteration History / Design Journal
 *
 * Timeline of named snapshots (input + KPIs). Supports:
 *  • Load snapshot back into the workbench
 *  • Side-by-side KPI + parameter diff between any two snapshots
 *  • Inline rename + annotation
 *  • Export single snapshot or all as JSON
 *  • max 20 entries, localStorage-persisted
 */
import { useState, useRef, useEffect } from 'react';
import { useStore, DesignSnapshot } from '../../store/useStore';

const SNAPSHOT_MAX = 20;

// ── KPI display config ────────────────────────────────────────────────────────

const KPI_DEFS: { key: keyof DesignSnapshot['kpis']; label: string; unit: string; decimals: number; goodDir: 1 | -1 | 0 }[] = [
  { key: 'trail',      label: 'Trail',     unit: 'mm',   decimals: 1, goodDir: 0 },
  { key: 'frontPct',   label: 'Front%',    unit: '%',    decimals: 1, goodDir: 0 },
  { key: 'natFreqF',   label: 'Freq F',    unit: 'Hz',   decimals: 2, goodDir: 0 },
  { key: 'natFreqR',   label: 'Freq R',    unit: 'Hz',   decimals: 2, goodDir: 0 },
  { key: 'antiSquat',  label: 'AS%',       unit: '%',    decimals: 0, goodDir: 0 },
  { key: 'wheelRateF', label: 'WR F',      unit: 'N/mm', decimals: 1, goodDir: 0 },
  { key: 'wheelRateR', label: 'WR R',      unit: 'N/mm', decimals: 1, goodDir: 0 },
  { key: 'sagF',       label: 'Sag% F',    unit: '%',    decimals: 1, goodDir: 0 },
  { key: 'sagR',       label: 'Sag% R',    unit: '%',    decimals: 1, goodDir: 0 },
];

// ── Param display config (what to show in diffs) ──────────────────────────────

interface ParamDef {
  label: string; unit: string; decimals: number;
  get: (s: DesignSnapshot) => number;
}

const PARAM_DEFS: ParamDef[] = [
  { label: 'Head Angle',    unit: '°',    decimals: 1, get: s => s.input.geometry.headAngle },
  { label: 'Fork Offset',   unit: 'mm',   decimals: 0, get: s => s.input.geometry.forkOffset },
  { label: 'Wheelbase',     unit: 'mm',   decimals: 0, get: s => s.input.geometry.wheelbase },
  { label: 'Swingarm Len',  unit: 'mm',   decimals: 0, get: s => s.input.geometry.swingarmLength },
  { label: 'Spring F',      unit: 'N/mm', decimals: 1, get: s => s.input.suspension.springRateFront },
  { label: 'Spring R',      unit: 'N/mm', decimals: 1, get: s => s.input.suspension.springRateRear },
  { label: 'MR Front',      unit: '',     decimals: 2, get: s => s.input.suspension.motionRatioFront },
  { label: 'MR Rear',       unit: '',     decimals: 2, get: s => s.input.suspension.motionRatioRear },
  { label: 'Front Sprocket',unit: 'T',    decimals: 0, get: s => s.input.chain.frontSprocket },
  { label: 'Rear Sprocket', unit: 'T',    decimals: 0, get: s => s.input.chain.rearSprocket },
  { label: 'Total Mass',    unit: 'kg',   decimals: 0, get: s => s.input.massComponents.reduce((a, c) => a + c.mass, 0) },
  { label: 'CoG Height',    unit: 'mm',   decimals: 0, get: s => s.input.massComponents.length > 0
      ? s.input.massComponents.reduce((a, c) => a + c.mass * c.y, 0) /
        Math.max(s.input.massComponents.reduce((a, c) => a + c.mass, 0), 0.001)
      : 0 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function fmtDelta(delta: number, decimals: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(decimals)}`;
}

function deltaColor(delta: number, goodDir: 1 | -1 | 0): string {
  if (goodDir === 0 || Math.abs(delta) < 0.001) return 'var(--text-muted)';
  const good = (goodDir === 1 && delta > 0) || (goodDir === -1 && delta < 0);
  return good ? 'var(--accent2)' : 'var(--danger)';
}

function exportSnap(snap: DesignSnapshot) {
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `snapshot_${snap.label.replace(/\W+/g, '_')}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function exportAll(snaps: DesignSnapshot[]) {
  const blob = new Blob([JSON.stringify(snaps, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'design_journal.json';
  a.click(); URL.revokeObjectURL(url);
}

// ── KPI pill ─────────────────────────────────────────────────────────────────

function KpiPill({ label, value, unit, decimals }: { label: string; value: number; unit: string; decimals: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 2,
      padding: '1px 6px', borderRadius: 3,
      background: 'var(--surface2)', border: '1px solid var(--border)',
      fontSize: 9,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>{' '}
      <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 600 }}>
        {isNaN(value) ? '—' : value.toFixed(decimals)}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{unit}</span>
    </span>
  );
}

// ── Snapshot card ─────────────────────────────────────────────────────────────

function SnapshotCard({
  snap, selected,
  onSelect, onLoad, onDelete, onRename,
}: {
  snap: DesignSnapshot;
  selected: 'A' | 'B' | null;
  onSelect: () => void;
  onLoad: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const borderColor = selected === 'A' ? 'var(--accent)' : selected === 'B' ? 'var(--cyan)' : 'var(--border)';
  const bg = selected ? (selected === 'A' ? 'var(--accent)0d' : 'var(--cyan)0d') : 'var(--surface)';

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
        background: bg, border: `1.5px solid ${borderColor}`,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
        {selected && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
            background: selected === 'A' ? 'var(--accent)' : 'var(--cyan)',
            color: '#fff', flexShrink: 0,
          }}>{selected}</span>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flex: 1, lineHeight: 1.3 }}>
          {snap.label}
        </span>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={onRename} title="Rename"
            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            ✏
          </button>
          <button onClick={onLoad} title="Load into workbench"
            style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--accent)22', border: '1px solid var(--accent)44', color: 'var(--accent)' }}>
            Load
          </button>
          <button onClick={onDelete} title="Delete"
            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
              background: 'var(--danger)11', border: '1px solid var(--danger)33', color: 'var(--danger)' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 8 }}>
        <span>{fmtTime(snap.timestamp)}</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ color: 'var(--accent)' }}>{snap.fromTab}</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span>{snap.familyName}</span>
      </div>

      {/* KPI pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <KpiPill label="Trail" value={snap.kpis.trail}    unit="mm"   decimals={1} />
        <KpiPill label="F%"    value={snap.kpis.frontPct} unit="%"    decimals={1} />
        <KpiPill label="fF"    value={snap.kpis.natFreqF} unit="Hz"   decimals={2} />
        <KpiPill label="AS%"   value={snap.kpis.antiSquat}unit="%"    decimals={0} />
        <KpiPill label="WR F"  value={snap.kpis.wheelRateF}unit="N/mm"decimals={1} />
      </div>

      {snap.note && (
        <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-muted)',
          fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
          {snap.note}
        </div>
      )}
    </div>
  );
}

// ── Detail view (single snapshot) ────────────────────────────────────────────

function DetailView({ snap }: { snap: DesignSnapshot }) {
  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {snap.label}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 12 }}>
        {fmtTime(snap.timestamp)} · {snap.fromTab} · {snap.familyName}
      </div>

      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        KPIs
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 14 }}>
        {KPI_DEFS.map(kd => (
          <div key={kd.key} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '3px 8px', borderRadius: 4, background: 'var(--surface2)',
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{kd.label}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {snap.kpis[kd.key].toFixed(kd.decimals)} {kd.unit}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Parameters
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {PARAM_DEFS.map(pd => (
          <div key={pd.label} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '3px 8px', borderRadius: 4, background: 'var(--surface2)',
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{pd.label}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {pd.get(snap).toFixed(pd.decimals)}{pd.unit && ` ${pd.unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Diff view (A vs B) ────────────────────────────────────────────────────────

function DiffView({ snapA, snapB }: { snapA: DesignSnapshot; snapB: DesignSnapshot }) {
  const HEAD = { fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', padding: '3px 6px',
                 textAlign: 'center' as const };
  const CELL = { fontSize: 9, fontFamily: 'monospace', padding: '3px 6px', textAlign: 'center' as const };
  const LABEL = { fontSize: 9, color: 'var(--text-muted)', padding: '3px 6px' };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, padding: '6px 10px', borderRadius: 5, background: 'var(--accent)11',
          border: '1px solid var(--accent)44', fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>
          A · {snapA.label}
          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 400, marginTop: 1 }}>
            {fmtTime(snapA.timestamp)}
          </div>
        </div>
        <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>⇒</div>
        <div style={{ flex: 1, padding: '6px 10px', borderRadius: 5, background: 'var(--cyan)11',
          border: '1px solid var(--cyan)44', fontSize: 10, fontWeight: 600, color: 'var(--cyan)' }}>
          B · {snapB.label}
          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 400, marginTop: 1 }}>
            {fmtTime(snapB.timestamp)}
          </div>
        </div>
      </div>

      {/* KPI diff table */}
      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        KPI Changes (A → B)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr style={{ background: 'var(--surface2)' }}>
            <th style={LABEL}>KPI</th>
            <th style={{ ...HEAD, color: 'var(--accent)' }}>A</th>
            <th style={{ ...HEAD, color: 'var(--cyan)' }}>B</th>
            <th style={HEAD}>Δ B−A</th>
          </tr>
        </thead>
        <tbody>
          {KPI_DEFS.map((kd, i) => {
            const vA = snapA.kpis[kd.key];
            const vB = snapB.kpis[kd.key];
            const delta = vB - vA;
            const hasChange = Math.abs(delta) > 0.0005;
            return (
              <tr key={kd.key} style={{ background: i % 2 ? 'var(--surface2)' : 'transparent' }}>
                <td style={LABEL}>{kd.label} <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>{kd.unit}</span></td>
                <td style={{ ...CELL, color: 'var(--accent)' }}>{vA.toFixed(kd.decimals)}</td>
                <td style={{ ...CELL, color: 'var(--cyan)' }}>{vB.toFixed(kd.decimals)}</td>
                <td style={{ ...CELL, color: hasChange ? deltaColor(delta, kd.goodDir) : 'var(--text-muted)', fontWeight: hasChange ? 600 : 400 }}>
                  {hasChange ? fmtDelta(delta, kd.decimals) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Param diff table (only show changed params) */}
      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        Parameter Changes (A → B)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface2)' }}>
            <th style={LABEL}>Parameter</th>
            <th style={{ ...HEAD, color: 'var(--accent)' }}>A</th>
            <th style={{ ...HEAD, color: 'var(--cyan)' }}>B</th>
            <th style={HEAD}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {PARAM_DEFS.map((pd, i) => {
            const vA = pd.get(snapA);
            const vB = pd.get(snapB);
            const delta = vB - vA;
            if (Math.abs(delta) < 0.0005) return null;
            return (
              <tr key={pd.label} style={{ background: i % 2 ? 'var(--surface2)' : 'transparent' }}>
                <td style={LABEL}>{pd.label}{pd.unit && <span style={{ color: 'var(--text-muted)', fontSize: 8 }}> {pd.unit}</span>}</td>
                <td style={{ ...CELL, color: 'var(--accent)' }}>{vA.toFixed(pd.decimals)}</td>
                <td style={{ ...CELL, color: 'var(--cyan)' }}>{vB.toFixed(pd.decimals)}</td>
                <td style={{ ...CELL, color: 'var(--text-primary)', fontWeight: 600 }}>{fmtDelta(delta, pd.decimals)}</td>
              </tr>
            );
          }).filter(Boolean)}
        </tbody>
      </table>
      {PARAM_DEFS.every(pd => Math.abs(pd.get(snapB) - pd.get(snapA)) < 0.0005) && (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
          No tracked parameter changes between these snapshots.
        </div>
      )}
    </div>
  );
}

// ── Rename modal (inline) ─────────────────────────────────────────────────────

function RenameForm({ snap, onSave, onCancel }: {
  snap: DesignSnapshot;
  onSave: (label: string, note: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(snap.label);
  const [note, setNote]   = useState(snap.note);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  return (
    <div style={{ padding: '10px 12px', background: 'var(--surface)',
      border: '1.5px solid var(--accent)', borderRadius: 6 }}>
      <input ref={inputRef} value={label} onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(label, note); if (e.key === 'Escape') onCancel(); }}
        style={{ width: '100%', fontSize: 11, padding: '3px 6px', background: 'var(--surface2)',
          border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, marginBottom: 5 }} />
      <textarea value={note} onChange={e => setNote(e.target.value)}
        placeholder="Optional annotation…"
        style={{ width: '100%', fontSize: 9, padding: '3px 6px', background: 'var(--surface2)',
          border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3,
          resize: 'vertical', minHeight: 36, fontFamily: 'inherit', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
        <button onClick={() => onSave(label, note)}
          style={{ fontSize: 9, padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
            background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600 }}>
          Save
        </button>
        <button onClick={onCancel}
          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
            background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function DesignJournalPanel() {
  const snapshots        = useStore(s => s.snapshots);
  const deleteSnapshot   = useStore(s => s.deleteSnapshot);
  const updateSnapshot   = useStore(s => s.updateSnapshot);
  const loadSnapshot     = useStore(s => s.loadSnapshot);

  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [renaming, setRenaming]   = useState<string | null>(null);

  // Snapshots newest-first
  const sorted = [...snapshots].reverse();

  const snapA = sorted.find(s => s.id === selectedA) ?? null;
  const snapB = sorted.find(s => s.id === selectedB) ?? null;

  function handleSelect(id: string) {
    if (selectedA === id) {
      setSelectedA(selectedB);
      setSelectedB(null);
    } else if (selectedB === id) {
      setSelectedB(null);
    } else if (!selectedA) {
      setSelectedA(id);
    } else if (!selectedB) {
      setSelectedB(id);
    } else {
      // Both full — replace B with new selection
      setSelectedB(id);
    }
  }

  function roleOf(id: string): 'A' | 'B' | null {
    if (selectedA === id) return 'A';
    if (selectedB === id) return 'B';
    return null;
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: timeline ── */}
      <div style={{
        width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--border)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Design Journal
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>
              {sorted.length}/{SNAPSHOT_MAX} snapshots · click to select · click 2 to compare
            </div>
          </div>
          {sorted.length > 0 && (
            <button onClick={() => exportAll(snapshots)}
              title="Export all snapshots as JSON"
              style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              ↓ All
            </button>
          )}
          {(selectedA || selectedB) && (
            <button onClick={() => { setSelectedA(null); setSelectedB(null); }}
              style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              Clear
            </button>
          )}
        </div>

        {/* Snapshot list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 10 }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>📋</div>
              No snapshots yet.<br/>
              Click <strong style={{ color: 'var(--accent)' }}>📸 Snapshot</strong> in the header<br/>
              to save the current design state.
            </div>
          ) : sorted.map(snap => (
            renaming === snap.id
              ? <RenameForm key={snap.id} snap={snap}
                  onSave={(label, note) => { updateSnapshot(snap.id, label, note); setRenaming(null); }}
                  onCancel={() => setRenaming(null)} />
              : <SnapshotCard key={snap.id} snap={snap}
                  selected={roleOf(snap.id)}
                  onSelect={() => handleSelect(snap.id)}
                  onLoad={() => loadSnapshot(snap.id)}
                  onDelete={() => {
                    if (selectedA === snap.id) setSelectedA(null);
                    if (selectedB === snap.id) setSelectedB(null);
                    deleteSnapshot(snap.id);
                  }}
                  onRename={() => setRenaming(snap.id)}
                />
          ))}
        </div>
      </div>

      {/* ── Right: detail / diff ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

        {/* Toolbar when snapshots are selected */}
        {(snapA || snapB) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {snapA && (
              <div style={{ padding: '4px 10px', borderRadius: 4,
                background: 'var(--accent)11', border: '1px solid var(--accent)44',
                fontSize: 9, color: 'var(--accent)' }}>
                A: {snapA.label}
              </div>
            )}
            {snapB && (
              <div style={{ padding: '4px 10px', borderRadius: 4,
                background: 'var(--cyan)11', border: '1px solid var(--cyan)44',
                fontSize: 9, color: 'var(--cyan)' }}>
                B: {snapB.label}
              </div>
            )}
            {snapA && !snapB && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                Click a second snapshot to compare
              </div>
            )}
            {snapA && (
              <button onClick={() => exportSnap(snapA)}
                style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer', marginLeft: 'auto',
                  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                ↓ Export A
              </button>
            )}
          </div>
        )}

        {/* Diff view */}
        {snapA && snapB && <DiffView snapA={snapA} snapB={snapB} />}

        {/* Single detail view */}
        {snapA && !snapB && <DetailView snap={snapA} />}

        {/* Empty state */}
        {!snapA && !snapB && (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: 36, opacity: 0.2 }}>📐</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Iteration History
            </div>
            <div style={{ fontSize: 10, textAlign: 'center', maxWidth: 380, lineHeight: 1.9 }}>
              Take snapshots as you iterate on the design.<br/>
              Select one snapshot to inspect its full KPI + parameter state.<br/>
              Select two to see a side-by-side diff of KPIs and changed parameters.
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 9 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, color: 'var(--accent)' }}>📸</div>
                <div>Snapshot button<br/>in header</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, color: 'var(--cyan)' }}>A / B</div>
                <div>Click cards<br/>to select</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, color: 'var(--accent2)' }}>Δ</div>
                <div>Diff view<br/>auto-appears</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

