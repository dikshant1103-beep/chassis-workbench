import { useStore } from '../../store/useStore';

function KV({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', borderBottom: '1px solid #21262d',
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: color ?? 'var(--text-primary)', fontWeight: 600 }}>
        {value}
        {unit && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

export default function InertiaPanel() {
  const res        = useStore(s => s.results.inertia);
  const cog        = useStore(s => s.results.cog);
  const components = useStore(s => s.input.massComponents);

  const totalMass = components.reduce((sum, c) => sum + c.mass, 0);
  const maxI      = Math.max(res.I_pitch, res.I_roll, res.I_yaw, 1e-9);

  function iColor(I: number) {
    const r = I / maxI;
    if (r > 0.8) return '#f85149';
    if (r > 0.5) return '#d29922';
    return '#3fb950';
  }

  const axes = [
    {
      key: 'pitch', icon: '↕', label: 'Pitch  I_yy', sub: 'About lateral Y-axis',
      I: res.I_pitch, k: res.k_pitch,
      desc: 'Nose-up / nose-down. Governs acceleration squat and braking dive.',
    },
    {
      key: 'roll', icon: '↔', label: 'Roll  I_xx', sub: 'About longitudinal X-axis',
      I: res.I_roll, k: res.k_roll,
      desc: 'Side-to-side lean. Governs cornering agility and lean-in speed.',
    },
    {
      key: 'yaw', icon: '↺', label: 'Yaw  I_zz', sub: 'About vertical Z-axis',
      I: res.I_yaw, k: res.k_yaw,
      desc: 'Direction change / weave mode. Lower yaw inertia = more agile.',
    },
  ];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18, color: 'var(--accent2)' }}>↺</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Moments of Inertia</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Point-mass approx — Cossalter Ch. 1</div>
        </div>
      </div>

      {/* CoG summary */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
        <KV label="Total Mass"        value={totalMass.toFixed(1)} unit="kg" />
        <KV label="CoG Height"        value={cog.Y_cg.toFixed(1)} unit="mm" />
        <KV label="CoG X (from front)" value={cog.X_cg.toFixed(1)} unit="mm" />
      </div>

      {/* Axis cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {axes.map(({ key, icon, label, sub, I, k, desc }) => (
          <div key={key} style={{
            background: 'var(--surface)', border: `1px solid var(--border)`,
            borderRadius: 8, padding: '12px 14px',
            borderTop: `3px solid ${iColor(I)}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Consolas, monospace' }}>{label}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{sub}</div>
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Consolas, monospace', color: iColor(I), marginBottom: 2 }}>
              {I.toFixed(2)}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>kg·m²</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
              k = <span style={{ color: 'var(--text-primary)', fontFamily: 'Consolas, monospace' }}>{(k * 1000).toFixed(1)} mm</span>
            </div>
            <div style={{ fontSize: 9, color: '#484f58', lineHeight: 1.4 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Relative magnitude</div>
        {axes.map(({ key, label, I }) => {
          const pct = (I / maxI) * 100;
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'Consolas, monospace' }}>{label.split('  ')[1]}</span>
                <span style={{ color: iColor(I), fontFamily: 'Consolas, monospace', fontWeight: 600 }}>{I.toFixed(3)} kg·m²</span>
              </div>
              <div style={{ background: '#21262d', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: iColor(I), borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Physics note */}
      <div style={{ fontSize: 9, color: '#484f58', lineHeight: 1.7, padding: '0 2px' }}>
        I_pitch = Σ mᵢ[(xᵢ−X̄)² + (yᵢ−Ȳ)²] / 10⁶  ·  I_roll = Σ mᵢ[(yᵢ−Ȳ)² + (zᵢ−Z̄)²] / 10⁶<br />
        I_yaw  = Σ mᵢ[(xᵢ−X̄)² + (zᵢ−Z̄)²] / 10⁶  ·  zᵢ = 0 (symmetric about centreline)<br />
        Radius of gyration k = √(I / M_total). Edit mass components in the Mass tab.
      </div>
    </div>
  );
}
