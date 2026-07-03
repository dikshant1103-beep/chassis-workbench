import { useStore } from '../../store/useStore';

export default function WeightBar() {
  const cog = useStore(s => s.results.cog);
  const front = cog.frontPercent;
  const rear  = cog.rearPercent;

  const status = front >= 48 && front <= 55 ? '#3fb950' : front >= 40 && front <= 62 ? '#d29922' : '#f85149';

  return (
    <div className="chart-card">
      <div className="chart-title">Weight Distribution</div>
      <div style={{ margin: '10px 0 6px', fontSize: 11, color: '#e6edf3', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: '#1f6feb' }}>Front: {front.toFixed(1)}%</span>
        <span style={{ color: '#d29922' }}>Total: {cog.totalMass.toFixed(1)} kg</span>
        <span style={{ color: '#3fb950' }}>Rear: {rear.toFixed(1)}%</span>
      </div>
      <div style={{ height: 28, display: 'flex', borderRadius: 3, overflow: 'hidden', border: '1px solid #30363d' }}>
        <div style={{ width: `${front}%`, background: '#1f6feb', opacity: 0.7, transition: 'width 0.15s' }} />
        <div style={{ width: `${rear}%`, background: '#3fb950', opacity: 0.7, transition: 'width 0.15s' }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#8b949e', textAlign: 'center' }}>
        Ideal 48–55% front &nbsp;|&nbsp;
        <span style={{ color: status }}>
          {front >= 48 && front <= 55 ? 'OK' : front >= 40 && front <= 62 ? 'MARGINAL' : 'OUT OF RANGE'}
        </span>
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: '#8b949e' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>R Front (static)</span><span style={{ color: '#e6edf3' }}>{cog.R_front.toFixed(0)} N</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>R Rear (static)</span><span style={{ color: '#e6edf3' }}>{cog.R_rear.toFixed(0)} N</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CoG Position</span>
          <span style={{ color: '#e6edf3' }}>X={cog.X_cg.toFixed(0)} mm &nbsp; Y={cog.Y_cg.toFixed(0)} mm</span>
        </div>
      </div>
    </div>
  );
}
