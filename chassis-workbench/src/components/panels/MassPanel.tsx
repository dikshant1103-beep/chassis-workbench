import { useStore } from '../../store/useStore';
import { MassComponent } from '../../engine/types';
import { ResultBar, getStatus } from './PanelShared';

const MASS_COLORS: Record<string, string> = {
  'Rider':   'var(--accent)',
  'Engine':  'var(--warn)',
  'Pillion': 'var(--purple)',
  'Luggage': 'var(--cyan)',
};

function getColor(label: string) {
  for (const key of Object.keys(MASS_COLORS)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return MASS_COLORS[key];
  }
  return 'var(--muted)';
}

// Tag button styling
function tagStyle(active: boolean, activeColor: string) {
  return {
    fontSize: 9, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
    border: `1px solid ${active ? activeColor : 'var(--border)'}`,
    background: active ? activeColor + '22' : 'var(--surface2)',
    color: active ? activeColor : 'var(--text-muted)',
    transition: 'all 0.15s',
    lineHeight: '14px',
  } as React.CSSProperties;
}

export default function MassPanel() {
  const components = useStore(s => s.input.massComponents);
  const susp       = useStore(s => s.input.suspension);
  const results    = useStore(s => s.results);
  const update     = useStore(s => s.updateMassComponent);
  const setAll     = useStore(s => s.setMassComponents);

  const totalMass = components.reduce((s, c) => s + c.mass, 0);
  const cog       = results.cog;
  const fpSt      = getStatus(cog.frontPercent, 30, 70, 42, 58);

  // Linked unsprung totals (live from suspension, written by store sync)
  const linkedFront = components.some(c => c.unsprungSide === 'front');
  const linkedRear  = components.some(c => c.unsprungSide === 'rear');

  function addComponent() {
    setAll([...components, { mass: 10, x: 500, y: 300, label: 'New Part' }]);
  }

  function removeComponent(i: number) {
    setAll(components.filter((_, idx) => idx !== i));
  }

  function field(i: number, key: keyof MassComponent, val: string) {
    const parsed = key === 'label' ? val : parseFloat(val) || 0;
    update(i, { [key]: parsed } as Partial<MassComponent>);
  }

  function toggleTag(i: number, side: 'front' | 'rear') {
    const current = components[i].unsprungSide;
    update(i, { unsprungSide: current === side ? null : side });
  }

  return (
    <>
      {/* ── Summary row ── */}
      <div style={{ padding: '8px 0 4px' }}>
        <ResultBar items={[
          { label: 'Total Mass', val: `${totalMass.toFixed(1)} kg` },
          { label: 'CoG X', val: `${cog.X_cg.toFixed(0)} mm` },
          { label: 'CoG Y', val: `${cog.Y_cg.toFixed(0)} mm` },
          { label: 'F/R Split', val: `${cog.frontPercent.toFixed(0)}/${cog.rearPercent.toFixed(0)}%`, status: fpSt },
        ]} />

        {/* Weight distribution bar */}
        <div style={{ margin: '8px 0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>
            <span>FRONT {cog.frontPercent.toFixed(1)}% · {cog.R_front.toFixed(0)} N</span>
            <span>REAR {cog.rearPercent.toFixed(1)}% · {cog.R_rear.toFixed(0)} N</span>
          </div>
          <div style={{ height: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
            <div style={{
              width: `${cog.frontPercent}%`,
              background: fpSt === 'ok' ? 'var(--accent2)' : fpSt === 'warn' ? 'var(--warn)' : 'var(--danger)',
              borderRadius: '3px 0 0 3px', transition: 'width 0.3s ease',
            }} />
            <div style={{ flex: 1, background: 'var(--surface3)', borderRadius: '0 3px 3px 0' }} />
          </div>
          <div style={{ position: 'relative', height: 4, marginTop: 1 }}>
            <div style={{ position: 'absolute', left: '42%', right: '42%', height: 2, background: 'var(--accent2)', opacity: 0.35, borderRadius: 1 }} />
            <div style={{ position: 'absolute', left: '42%', top: -1, width: 1, height: 6, background: 'var(--accent2)', opacity: 0.6 }} />
            <div style={{ position: 'absolute', left: '58%', top: -1, width: 1, height: 6, background: 'var(--accent2)', opacity: 0.6 }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>Optimal 42–58% front</div>
        </div>
      </div>

      {/* ── Unsprung link status ── */}
      {(linkedFront || linkedRear) && (
        <div style={{ margin: '4px 0 8px', padding: '6px 8px', borderRadius: 4,
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <span style={{ color: 'var(--accent2)', fontWeight: 'bold' }}>Suspension link active</span>
          {linkedFront && (
            <span style={{ marginLeft: 8 }}>
              <span style={{ color: 'var(--cyan)' }}>Front</span>
              {' '}{susp.unsprungFront.toFixed(1)} kg
              {' ← '}
              {components.filter(c => c.unsprungSide === 'front').map(c => c.label).join(' + ')}
            </span>
          )}
          {linkedRear && (
            <span style={{ marginLeft: 8 }}>
              <span style={{ color: 'var(--warn)' }}>Rear</span>
              {' '}{susp.unsprungRear.toFixed(1)} kg
              {' ← '}
              {components.filter(c => c.unsprungSide === 'rear').map(c => c.label).join(' + ')}
            </span>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        Components — {components.length} items
      </div>

      {/* ── Component cards ── */}
      {components.map((c, i) => {
        const color    = getColor(c.label);
        const massPct  = totalMass > 0 ? (c.mass / totalMass) * 100 : 0;
        const isF      = c.unsprungSide === 'front';
        const isR      = c.unsprungSide === 'rear';
        return (
          <div key={i} className="mass-card" style={{
            borderLeft: `3px solid ${isF ? 'var(--cyan)' : isR ? 'var(--warn)' : color}`,
          }}>
            <div className="mass-card-hdr">
              <div className="mass-card-dot" style={{ background: color }} />
              <input
                className="mass-card-label"
                value={c.label}
                onChange={e => field(i, 'label', e.target.value)}
                title="Click to rename"
              />
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>{massPct.toFixed(0)}%</span>
              <button className="mass-card-del" onClick={() => removeComponent(i)} title="Remove">×</button>
            </div>

            {/* Mass bar */}
            <div style={{ margin: '4px 0', height: 3, background: 'var(--surface3)', borderRadius: 2 }}>
              <div style={{ width: `${massPct}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.7, transition: 'width 0.2s' }} />
            </div>

            <div className="mass-card-fields">
              <div className="mass-field">
                <label>Mass</label>
                <input type="number" min={0} max={500} step={0.5} value={c.mass}
                  onChange={e => field(i, 'mass', e.target.value)} />
                <span className="mass-unit">kg</span>
              </div>
              <div className="mass-field">
                <label>X</label>
                <input type="number" min={0} max={2000} step={5} value={c.x}
                  onChange={e => field(i, 'x', e.target.value)} />
                <span className="mass-unit">mm</span>
              </div>
              <div className="mass-field">
                <label>Y</label>
                <input type="number" min={0} max={1200} step={5} value={c.y}
                  onChange={e => field(i, 'y', e.target.value)} />
                <span className="mass-unit">mm</span>
              </div>
            </div>

            {/* Unsprung tag row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5,
                          paddingTop: 5, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>Unsprung:</span>
              <button style={tagStyle(isF, 'var(--cyan)')}
                onClick={() => toggleTag(i, 'front')}>
                Front
              </button>
              <button style={tagStyle(isR, 'var(--warn)')}
                onClick={() => toggleTag(i, 'rear')}>
                Rear
              </button>
              {(isF || isR) && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  → {c.mass.toFixed(1)} kg linked
                </span>
              )}
            </div>
          </div>
        );
      })}

      <button className="mass-add-btn" onClick={addComponent}>+ Add Component</button>

      {/* ── Unsprung tagging guide ── */}
      {!linkedFront && !linkedRear && (
        <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 4,
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Tag components as <span style={{ color: 'var(--cyan)' }}>Front</span> or{' '}
          <span style={{ color: 'var(--warn)' }}>Rear</span> unsprung to link them to the
          Suspension tab — their mass sum will auto-update unsprungFront / unsprungRear,
          keeping ride frequency and wheel-hop calculations in sync.
        </div>
      )}
    </>
  );
}
