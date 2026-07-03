import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  computeSensitivity, SensGroup, SensKPI, SensParam, SensCell,
} from '../../engine/sensitivity';
import { runSensitivity, BackendSensResult } from '../../api/backendClient';

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Map elasticity → RGBA string. Green = positive, red = negative. */
function elColor(e: number, maxE: number): string {
  const norm = Math.min(Math.abs(e) / (maxE || 1), 1);
  const alpha = 0.08 + norm * 0.82;   // 0.08 at zero (visible tint), 0.9 at max
  if (Math.abs(e) < 0.02) return `rgba(128,128,128,0.06)`;
  return e > 0
    ? `rgba(63, 185, 80, ${alpha.toFixed(2)})`    // green
    : `rgba(248, 81, 73, ${alpha.toFixed(2)})`;   // red
}

function elTextColor(e: number): string {
  if (Math.abs(e) < 0.02) return 'var(--text-muted)';
  return e > 0 ? 'var(--accent2)' : 'var(--danger)';
}

// ── Heatmap cell ─────────────────────────────────────────────────────────────

function Cell({
  cell, maxE, selected, onClick,
}: {
  cell: SensCell; maxE: number; selected: boolean; onClick: () => void;
}) {
  const { elasticity } = cell;
  const bg  = elColor(elasticity, maxE);
  const col = elTextColor(elasticity);
  const txt = Math.abs(elasticity) < 0.01 ? '·'
    : Math.abs(elasticity) > 9.9 ? (elasticity > 0 ? '>>>' : '<<<')
    : elasticity.toFixed(2);
  return (
    <td
      onClick={onClick}
      title={`Elasticity: ${elasticity.toFixed(3)}\nRaw: ${cell.rawDeriv.toFixed(4)}`}
      style={{
        background: bg,
        color: col,
        fontFamily: 'monospace',
        fontSize: 9,
        textAlign: 'center',
        padding: '4px 2px',
        cursor: 'pointer',
        border: selected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
        minWidth: 42,
        userSelect: 'none',
        transition: 'background 0.2s',
      }}
    >
      {txt}
    </td>
  );
}

// ── Sorted bar chart for selected KPI ────────────────────────────────────────

function KpiWaterfall({
  kpi, params, cells, kpiIdx, baselineKPI, baselineParam,
}: {
  kpi: SensKPI; params: SensParam[];
  cells: SensCell[][]; kpiIdx: number;
  baselineKPI: number[]; baselineParam: number[];
}) {
  const entries = params.map((p, pi) => ({
    label: p.label, unit: p.unit,
    paramVal: baselineParam[pi],
    elasticity: cells[pi][kpiIdx].elasticity,
    rawDeriv:   cells[pi][kpiIdx].rawDeriv,
  })).sort((a, b) => Math.abs(b.elasticity) - Math.abs(a.elasticity));

  const maxAbs = Math.max(...entries.map(e => Math.abs(e.elasticity)), 0.01);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
        letterSpacing: 1, marginBottom: 4 }}>
        {kpi.label} ({kpi.unit}) — parameter influence
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
        Baseline: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
          {baselineKPI[kpiIdx].toFixed(2)} {kpi.unit}
        </span>
        <br />Elasticity = % change in KPI per 1% change in param
      </div>
      {entries.map((e, i) => {
        const w   = Math.abs(e.elasticity) / maxAbs * 100;
        const col = e.elasticity > 0 ? 'var(--accent2)' : 'var(--danger)';
        const sign = e.elasticity > 0 ? '+' : '';
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>
              <span>{e.label}</span>
              <span style={{ color: col, fontFamily: 'monospace' }}>
                {sign}{e.elasticity.toFixed(3)}
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--surface2)',
              borderRadius: 3, overflow: 'hidden', marginBottom: 1 }}>
              <div style={{
                height: '100%', width: `${w}%`,
                background: col, borderRadius: 3,
                opacity: Math.max(0.2, Math.abs(e.elasticity) / maxAbs),
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<SensGroup, string> = {
  Geometry:   'var(--accent)',
  Suspension: 'var(--cyan)',
  Chain:      'var(--warn)',
};

/** Normalise backend BackendSensResult into the same shape as TS SensitivityResult */
function normaliseBackend(b: BackendSensResult): ReturnType<typeof computeSensitivity> {
  return {
    params:       b.params as unknown as SensParam[],
    kpis:         b.kpis   as unknown as SensKPI[],
    cells:        b.cells.map(row => row.map(c => ({
                    elasticity: c.elasticity,
                    rawDeriv:   c.raw_deriv,
                  } as SensCell))),
    baselineKPI:   b.baseline_kpi,
    baselineParam: b.baseline_param,
    perturbPct:    b.perturb_pct,
    computeMs:     b.compute_ms,
  };
}

export default function SensitivityPanel() {
  const input        = useStore(s => s.input);
  const backendStatus = useStore(s => s.backendStatus);

  const [perturbPct, setPerturbPct]   = useState(2);
  const [activeGroups, setActiveGroups] = useState<Set<SensGroup>>(
    new Set(['Geometry', 'Suspension', 'Chain']),
  );
  const [selectedKpiIdx, setSelectedKpiIdx] = useState(0);
  const [hoveredCell, setHoveredCell]       = useState<{ pi: number; ki: number } | null>(null);
  const [backendResult, setBackendResult]   = useState<ReturnType<typeof computeSensitivity> | null>(null);
  const [computing, setComputing]           = useState(false);
  const [backendError, setBackendError]     = useState<string | null>(null);

  function toggleGroup(g: SensGroup) {
    setActiveGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) { if (next.size > 1) next.delete(g); }
      else next.add(g);
      return next;
    });
  }

  async function handleBackendCompute() {
    setComputing(true); setBackendError(null);
    try {
      const raw = await runSensitivity(input, perturbPct, [...activeGroups]);
      setBackendResult(normaliseBackend(raw));
    } catch (e) {
      setBackendError(String(e));
    } finally {
      setComputing(false);
    }
  }

  const tsSens = useMemo(() => {
    return computeSensitivity(input, perturbPct, activeGroups);
  }, [input, perturbPct, activeGroups]);

  // Use backend result if available, else TS
  const sens = backendResult ?? tsSens;
  const usingBackend = backendResult !== null;

  // Max |elasticity| across entire matrix (for colour scaling)
  const maxE = useMemo(() => {
    let m = 0.01;
    sens.cells.forEach(row => row.forEach(c => { if (Math.abs(c.elasticity) > m) m = Math.abs(c.elasticity); }));
    return Math.min(m, 5);   // cap at 5 so outliers don't wash out the rest
  }, [sens]);

  // Group separator row indices
  const groups: SensGroup[] = ['Geometry', 'Suspension', 'Chain'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Controls bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <span style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase',
          letterSpacing: 1 }}>Sensitivity Heatmap</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Perturb ±</span>
          <input type="range" min={0.5} max={10} step={0.5} value={perturbPct}
            onChange={e => setPerturbPct(parseFloat(e.target.value))}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'monospace', width: 28 }}>
            {perturbPct}%
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {groups.map(g => (
            <button key={g} onClick={() => toggleGroup(g)} style={{
              fontSize: 9, padding: '3px 9px', borderRadius: 3, cursor: 'pointer',
              border: `1px solid ${activeGroups.has(g) ? GROUP_COLORS[g] : 'var(--border)'}`,
              background: activeGroups.has(g) ? GROUP_COLORS[g] + '22' : 'var(--surface2)',
              color: activeGroups.has(g) ? GROUP_COLORS[g] : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>
              {g}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Backend compute button */}
          {backendStatus === 'synced' && (
            <button onClick={handleBackendCompute} disabled={computing} style={{
              fontSize: 9, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${usingBackend ? 'var(--cyan)' : 'var(--border)'}`,
              background: usingBackend ? 'var(--cyan)22' : 'var(--surface2)',
              color: usingBackend ? 'var(--cyan)' : 'var(--text-muted)',
              opacity: computing ? 0.6 : 1,
            }}>
              {computing ? '⟳ Running…' : usingBackend ? '⚡ Backend (rerun)' : '⚡ Run with Backend'}
            </button>
          )}
          {usingBackend && (
            <span style={{ fontSize: 8, color: 'var(--cyan)', padding: '2px 6px',
              background: 'var(--cyan)15', borderRadius: 3, border: '1px solid var(--cyan)44' }}>
              Full DAG model
            </span>
          )}
          {!usingBackend && (
            <span style={{ fontSize: 8, color: 'var(--text-muted)', padding: '2px 6px',
              background: 'var(--surface2)', borderRadius: 3 }}>
              TypeScript engine
            </span>
          )}
          {backendError && (
            <span style={{ fontSize: 8, color: 'var(--danger)' }} title={backendError}>
              ⚠ backend error
            </span>
          )}
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {sens.params.length} × {sens.kpis.length}
            <span style={{ marginLeft: 6, color: 'var(--accent2)' }}>
              {sens.computeMs.toFixed(0)}ms
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 9, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--accent2)' }}>■</span>+
            <span style={{ color: 'var(--danger)' }}>■</span>−
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Heatmap */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '12px 16px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 9 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9,
                  color: 'var(--text-muted)', fontWeight: 400, minWidth: 110,
                  borderBottom: '1px solid var(--border)' }}>
                  Param ↓ / KPI →
                </th>
                {sens.kpis.map((k, ki) => (
                  <th key={k.id}
                    onClick={() => setSelectedKpiIdx(ki)}
                    style={{
                      padding: '4px 6px', fontSize: 9, cursor: 'pointer',
                      color: ki === selectedKpiIdx ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: ki === selectedKpiIdx ? 700 : 400,
                      borderBottom: ki === selectedKpiIdx
                        ? '2px solid var(--accent)'
                        : '1px solid var(--border)',
                      whiteSpace: 'nowrap', textAlign: 'center',
                      background: ki === selectedKpiIdx ? 'var(--accent)11' : 'transparent',
                    }}>
                    {k.label}<br />
                    <span style={{ fontSize: 8, opacity: 0.6 }}>
                      {sens.baselineKPI[ki].toFixed(1)}{k.unit}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.filter(g => activeGroups.has(g)).map(group => {
                const groupParams = sens.params
                  .map((p, pi) => ({ p, pi }))
                  .filter(({ p }) => p.group === group);
                if (!groupParams.length) return null;
                return [
                  // Group header row
                  <tr key={`grp-${group}`}>
                    <td colSpan={sens.kpis.length + 1} style={{
                      padding: '6px 8px 3px',
                      fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: 1, color: GROUP_COLORS[group],
                      borderTop: '1px solid var(--border)',
                    }}>
                      {group}
                    </td>
                  </tr>,
                  // Param rows
                  ...groupParams.map(({ p, pi }) => (
                    <tr key={p.id}
                      style={{ background: hoveredCell?.pi === pi ? 'var(--surface2)' : 'transparent' }}
                      onMouseEnter={() => setHoveredCell({ pi, ki: selectedKpiIdx })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      <td style={{
                        padding: '3px 8px', fontSize: 9, whiteSpace: 'nowrap',
                        color: 'var(--text-primary)', borderRight: '1px solid var(--border)',
                      }}>
                        <span style={{ color: GROUP_COLORS[group], marginRight: 4 }}>·</span>
                        {p.label}
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                          ({sens.baselineParam[pi].toFixed(1)}{p.unit})
                        </span>
                      </td>
                      {sens.kpis.map((_, ki) => (
                        <Cell key={ki}
                          cell={sens.cells[pi][ki]}
                          maxE={maxE}
                          selected={ki === selectedKpiIdx}
                          onClick={() => setSelectedKpiIdx(ki)}
                        />
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>

          {/* Legend */}
          <div style={{ marginTop: 16, display: 'flex', gap: 24, fontSize: 9,
            color: 'var(--text-muted)', alignItems: 'center' }}>
            <span>Elasticity E = (ΔK/K) / (ΔP/P)</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <div style={{ width: 60, height: 10, borderRadius: 2,
                background: 'linear-gradient(to right, rgba(248,81,73,0.9), rgba(128,128,128,0.08), rgba(63,185,80,0.9))' }} />
              <span>−{maxE.toFixed(1)} → 0 → +{maxE.toFixed(1)}</span>
            </div>
            <span>· = |E| &lt; 0.02 (negligible)</span>
          </div>
        </div>

        {/* Right: KPI waterfall */}
        <div style={{
          width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)',
          overflowY: 'auto', padding: '14px 14px',
        }}>
          {sens.params.length > 0 && (
            <KpiWaterfall
              kpi={sens.kpis[selectedKpiIdx]}
              params={sens.params}
              cells={sens.cells}
              kpiIdx={selectedKpiIdx}
              baselineKPI={sens.baselineKPI}
              baselineParam={sens.baselineParam}
            />
          )}

          {/* Hovered cell tooltip */}
          {hoveredCell && (
            <div style={{
              marginTop: 20, padding: '10px 12px', borderRadius: 6,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              fontSize: 9, lineHeight: 1.8,
            }}>
              <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
                {sens.params[hoveredCell.pi]?.label} → {sens.kpis[hoveredCell.ki]?.label}
              </div>
              {(() => {
                const c = sens.cells[hoveredCell.pi]?.[hoveredCell.ki];
                const p = sens.params[hoveredCell.pi];
                const k = sens.kpis[hoveredCell.ki];
                if (!c || !p || !k) return null;
                const col = elTextColor(c.elasticity);
                return (
                  <>
                    <div>E = <span style={{ color: col, fontFamily: 'monospace' }}>
                      {c.elasticity.toFixed(4)}
                    </span></div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      +1% {p.label} → <span style={{ color: col }}>
                        {c.elasticity > 0 ? '+' : ''}{c.elasticity.toFixed(2)}%
                      </span> {k.label}
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                      ∂{k.label}/∂{p.label} = {c.rawDeriv.toFixed(4)} {k.unit}/{p.unit}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Interpretation guide */}
          <div style={{
            marginTop: 20, padding: '8px 10px', borderRadius: 6,
            background: 'var(--surface)', border: '1px solid var(--border)',
            fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7,
          }}>
            <div style={{ color: 'var(--accent)', marginBottom: 4, fontWeight: 600 }}>
              How to read
            </div>
            <div>E = +1: 1% ↑ param → 1% ↑ KPI</div>
            <div>E = −2: 1% ↑ param → 2% ↓ KPI</div>
            <div style={{ marginTop: 6 }}>High |E| = tight tolerance needed.</div>
            <div>Low |E| = that dimension can be loose — save cost.</div>
            <div style={{ marginTop: 6, color: 'var(--accent2)' }}>
              Click a KPI column header to see its waterfall.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
