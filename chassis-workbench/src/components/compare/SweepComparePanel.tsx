/**
 * SweepComparePanel.tsx — Multi-Config Sweep Comparison (Phase 4)
 *
 * Save up to 4 named bike configs and overlay their suspension sweep
 * curves (MR, WR, AS%, Trail) on shared axes.
 *
 * State: savedConfigs in Zustand store (persisted to localStorage)
 */

import { useMemo, useState } from 'react';
import { useStore, SavedConfig } from '../../store/useStore';
import { computeSweep } from '../../engine/sweep';
import { DEFAULT_SWEEP_PARAMS } from '../../store/useStore';
import { FAMILIES } from '../../data/families';
import MultiSweepChart, { SweepSeries } from '../charts/MultiSweepChart';
import type { SweepPoint } from '../../engine/types';

const SERIES_COLORS = ['#1f6feb', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#ffa657', '#ff7b72'];
const MAX_CONFIGS = 8;

// ── Config row ────────────────────────────────────────────────────────────────

function ConfigRow({
  config,
  checked,
  color,
  onToggle,
  onRemove,
  onRename,
  onLoad,
}: {
  config: SavedConfig;
  checked: boolean;
  color: string;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onLoad: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(config.name);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', background: 'var(--surface)',
      border: `1px solid ${checked ? color : 'var(--border)'}`,
      borderRadius: 6, marginBottom: 6,
    }}>
      {/* Color indicator + checkbox */}
      <div
        onClick={onToggle}
        style={{
          width: 14, height: 14, borderRadius: 3,
          background: checked ? color : 'transparent',
          border: `2px solid ${color}`,
          cursor: 'pointer', flexShrink: 0,
        }}
      />

      {/* Name / edit */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onRename(draft); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onRename(draft); setEditing(false); } }}
            style={{
              width: '100%', background: 'var(--bg)', border: '1px solid var(--accent)',
              color: 'var(--text)', fontSize: 11, borderRadius: 3, padding: '2px 4px',
            }}
          />
        ) : (
          <div
            onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: checked ? color : 'var(--text)', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title="Click to rename"
          >
            {config.name}
          </div>
        )}
        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {new Date(config.savedAt).toLocaleString()}
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={onLoad}
        style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer' }}
        title="Load this config into the workbench"
      >
        Load
      </button>
      <button
        onClick={onRemove}
        style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #f85149', borderRadius: 3, color: '#f85149', cursor: 'pointer' }}
        title="Delete this saved config"
      >
        ✕
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SweepComparePanel() {
  const savedConfigs      = useStore(s => s.savedConfigs);
  const saveCurrentConfig = useStore(s => s.saveCurrentConfig);
  const removeSavedConfig = useStore(s => s.removeSavedConfig);
  const renameSavedConfig = useStore(s => s.renameSavedConfig);
  const addToSweep        = useStore(s => s.addToSweep);
  const customBikes       = useStore(s => s.customBikes);

  const [configName, setConfigName] = useState('');
  const [libraryPick, setLibraryPick] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set(savedConfigs.map(c => c.id)));

  // Build combined library options: presets + custom bikes
  const libraryOptions = [
    ...FAMILIES.map(f => ({ value: `preset::${f.name}`, label: `[Preset] ${f.name}`, input: f.input })),
    ...customBikes.map(b => ({ value: `custom::${b.id}`, label: `[Custom] ${b.name}`, input: b.input })),
  ];

  function handleAddFromLibrary() {
    const opt = libraryOptions.find(o => o.value === libraryPick);
    if (!opt || savedConfigs.length >= MAX_CONFIGS) return;
    const label = opt.label.replace(/^\[.*?\] /, '');
    addToSweep(opt.input, label);
    setLibraryPick('');
  }

  // Load a saved config into the workbench (we proxy via JSON trick)
  const loadConfig = (cfg: SavedConfig) => {
    // Temporarily hijack loadFamily — we just set the store input directly
    // Since we can't call setInput, we save then reload
    localStorage.setItem('mcw_session', JSON.stringify({ input: cfg.input, familyName: cfg.name }));
    window.location.reload();
  };

  const toggleChecked = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_CONFIGS) next.add(id);
      return next;
    });
  };

  // Build sweep data for each checked config
  const seriesByConfig = useMemo(() => {
    const result: Record<string, { mr: SweepSeries; wr: SweepSeries; as: SweepSeries; trail: SweepSeries }> = {};

    savedConfigs.forEach((cfg, idx) => {
      if (!checked.has(cfg.id)) return;
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const sp = cfg.input.sweep ?? DEFAULT_SWEEP_PARAMS;
      const Y_cg = (() => {
        try {
          const { computeAll } = require('../../engine/computeAll');
          return computeAll(cfg.input).cog.Y_cg;
        } catch { return 550; }
      })();
      try {
        const sweep = computeSweep(
          cfg.input.geometry,
          cfg.input.suspension,
          cfg.input.chain,
          sp,
          Y_cg,
          1,
        );
        result[cfg.id] = {
          mr:    { data: sweep.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.motionRatio })),    label: cfg.name, color },
          wr:    { data: sweep.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.wheelRate_Nmm })),  label: cfg.name, color },
          as:    { data: sweep.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.antiSquatPct })),   label: cfg.name, color },
          trail: { data: sweep.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.trail_mm })),       label: cfg.name, color },
        };
      } catch { /* skip bad config */ }
    });

    return result;
  }, [savedConfigs, checked]);

  // Also include current config if explicitly added
  const allSeries = Object.values(seriesByConfig);
  const mrSeries    = allSeries.map(s => s.mr);
  const wrSeries    = allSeries.map(s => s.wr);
  const asSeries    = allSeries.map(s => s.as);
  const trailSeries = allSeries.map(s => s.trail);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: config list ── */}
      <div className="left-panel">
        <div className="panel-body">

          {/* Add from Library (presets + custom bikes) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Add from Library
            </div>
            <select
              value={libraryPick}
              onChange={e => setLibraryPick(e.target.value)}
              style={{
                width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 11, borderRadius: 4, padding: '4px 6px',
                boxSizing: 'border-box', marginBottom: 5,
              }}
            >
              <option value="">— pick a preset or custom bike —</option>
              <optgroup label="Presets">
                {FAMILIES.map(f => <option key={f.name} value={`preset::${f.name}`}>{f.name}</option>)}
              </optgroup>
              {customBikes.length > 0 && (
                <optgroup label="Custom Bikes">
                  {customBikes.map(b => <option key={b.id} value={`custom::${b.id}`}>{b.name}</option>)}
                </optgroup>
              )}
            </select>
            <button
              onClick={handleAddFromLibrary}
              disabled={!libraryPick || savedConfigs.length >= MAX_CONFIGS}
              style={{
                width: '100%', padding: '5px 0',
                background: libraryPick ? 'var(--accent2)' : 'var(--surface2)',
                border: 'none', borderRadius: 4,
                color: libraryPick ? '#fff' : 'var(--text-muted)',
                fontSize: 11, cursor: libraryPick ? 'pointer' : 'default', fontWeight: 600,
              }}
            >
              Add to Sweep
            </button>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />

          {/* Save current workbench state */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
              Save current workbench config (max {MAX_CONFIGS}).
            </div>
            <input
              placeholder="Config name (e.g. R1 standard)"
              value={configName}
              onChange={e => setConfigName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && configName.trim()) {
                  saveCurrentConfig(configName.trim());
                  setChecked(prev => new Set([...prev, `${Date.now() - 1}`]));
                  setConfigName('');
                }
              }}
              style={{
                width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 11, borderRadius: 4, padding: '4px 8px', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => {
                if (!configName.trim()) return;
                saveCurrentConfig(configName.trim());
                setConfigName('');
              }}
              disabled={!configName.trim() || savedConfigs.length >= MAX_CONFIGS}
              style={{
                marginTop: 6, width: '100%', padding: '5px 0',
                background: 'var(--accent)', border: 'none', borderRadius: 4,
                color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}
            >
              Save Current Config
            </button>
            {savedConfigs.length >= MAX_CONFIGS && (
              <div style={{ fontSize: 9, color: 'var(--warn)', marginTop: 4 }}>
                Max {MAX_CONFIGS} configs. Remove one to add another.
              </div>
            )}
          </div>

          {/* Config list */}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Saved Configs
          </div>

          {savedConfigs.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>
              No configs saved yet.<br />Save the current workbench state above.
            </div>
          )}

          {savedConfigs.map((cfg, idx) => (
            <ConfigRow
              key={cfg.id}
              config={cfg}
              checked={checked.has(cfg.id)}
              color={SERIES_COLORS[idx % SERIES_COLORS.length]}
              onToggle={() => toggleChecked(cfg.id)}
              onRemove={() => {
                removeSavedConfig(cfg.id);
                setChecked(prev => { const n = new Set(prev); n.delete(cfg.id); return n; });
              }}
              onRename={name => renameSavedConfig(cfg.id, name)}
              onLoad={() => loadConfig(cfg)}
            />
          ))}

          {/* Legend */}
          <div style={{ marginTop: 16, fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <div>■ Click color box to toggle overlay</div>
            <div>■ Click name to rename</div>
            <div>■ Load restores the full workbench state</div>
            <div style={{ marginTop: 6, color: '#484f58' }}>
              Sweep: MR · WR · AS% · Trail vs wheel travel
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: overlay charts ── */}
      <div className="right-panel" style={{ overflowY: 'auto', padding: '12px 8px' }}>

        {allSeries.length === 0 ? (
          <div style={{ padding: 32, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⇔</div>
            Save 2+ configs and check their boxes to overlay suspension sweeps here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 900 }}>
            <MultiSweepChart
              title="Motion Ratio vs Wheel Travel"
              series={mrSeries}
              xLabel="Wheel Travel" xUnit="mm"
              yLabel="MR" yUnit=""
              okMin={0.55} okMax={0.80}
            />
            <MultiSweepChart
              title="Wheel Rate vs Wheel Travel"
              series={wrSeries}
              xLabel="Wheel Travel" xUnit="mm"
              yLabel="WR" yUnit="N/mm"
              okMin={15} okMax={80}
            />
            <MultiSweepChart
              title="Anti-Squat % vs Wheel Travel"
              series={asSeries}
              xLabel="Wheel Travel" xUnit="mm"
              yLabel="AS%" yUnit="%"
              okMin={60} okMax={110}
            />
            <MultiSweepChart
              title="Trail vs Fork Dive"
              series={trailSeries}
              xLabel="Fork Compression" xUnit="mm"
              yLabel="Trail" yUnit="mm"
              okMin={80} okMax={120}
            />
          </div>
        )}
      </div>
    </div>
  );
}
