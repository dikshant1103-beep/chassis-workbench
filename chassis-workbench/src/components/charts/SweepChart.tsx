import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';

interface SweepChartProps {
  title: string;
  data: { x: number; y: number }[];
  data2?: { x: number; y: number }[];
  label2?: string;
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  currentX?: number;
  okMin?: number;
  okMax?: number;
  warnMin?: number;
  warnMax?: number;
}

const TOOLTIP_STYLE = {
  background: '#161b22', border: '1px solid #30363d',
  color: '#e6edf3', fontSize: 10, fontFamily: 'Consolas, monospace',
};

const TOOLTIP_STYLE_LG = {
  background: '#161b22', border: '1px solid #30363d',
  color: '#e6edf3', fontSize: 12, fontFamily: 'Consolas, monospace',
};

// ─── Shared chart content (small or large) ────────────────────────────────────

function ChartContent({
  merged, data2, xLabel, yLabel, xUnit, yUnit, label2,
  currentX, okMin, okMax, warnMin, warnMax, large,
}: {
  merged: { x: number; y: number; y2?: number }[];
  data2?: { x: number; y: number }[];
  xLabel: string; yLabel: string; xUnit: string; yUnit: string;
  label2?: string; currentX?: number;
  okMin?: number; okMax?: number; warnMin?: number; warnMax?: number;
  large: boolean;
}) {
  const fs = large ? 11 : 9;
  const tip = large ? TOOLTIP_STYLE_LG : TOOLTIP_STYLE;
  return (
    <LineChart data={merged} margin={{ top: 8, right: 12, bottom: 24, left: 12 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
      <XAxis
        dataKey="x"
        type="number"
        domain={['dataMin', 'dataMax']}
        tick={{ fill: '#8b949e', fontSize: fs }}
        label={{ value: xUnit ? `${xLabel} (${xUnit})` : xLabel, position: 'insideBottom', offset: -12, fill: '#8b949e', fontSize: fs }}
      />
      <YAxis
        tick={{ fill: '#8b949e', fontSize: fs }}
        width={large ? 44 : 36}
        label={{ value: yUnit || yLabel, angle: -90, position: 'insideLeft', offset: large ? 10 : 8, fill: '#8b949e', fontSize: fs }}
      />
      <Tooltip
        contentStyle={tip}
        formatter={(v) => [`${(v as number).toFixed(2)} ${yUnit}`, yLabel]}
        labelFormatter={(l) => `${xLabel}: ${Number(l).toFixed(2)} ${xUnit}`}
      />
      {okMin !== undefined && okMax !== undefined && (
        <ReferenceArea y1={okMin} y2={okMax} fill="#3fb950" fillOpacity={0.08} />
      )}
      {warnMin !== undefined && okMin !== undefined && (
        <ReferenceArea y1={warnMin} y2={okMin} fill="#d29922" fillOpacity={0.06} />
      )}
      {warnMax !== undefined && okMax !== undefined && (
        <ReferenceArea y1={okMax} y2={warnMax} fill="#d29922" fillOpacity={0.06} />
      )}
      {currentX !== undefined && (
        <ReferenceLine x={currentX} stroke="#d29922" strokeDasharray="4 2" strokeWidth={1.5} />
      )}
      <Line
        type="monotone" dataKey="y" stroke="#1f6feb" strokeWidth={large ? 2.5 : 2}
        dot={false} name={yLabel} activeDot={{ r: large ? 4 : 3, fill: '#1f6feb' }}
      />
      {data2 && (
        <Line
          type="monotone" dataKey="y2" stroke="#3fb950" strokeWidth={large ? 2.5 : 2}
          dot={false} name={label2 ?? 'Series 2'} activeDot={{ r: large ? 4 : 3, fill: '#3fb950' }}
        />
      )}
    </LineChart>
  );
}

// ─── Fullscreen modal (portal) ────────────────────────────────────────────────

function ChartModal({
  title, merged, data2, label2, xLabel, yLabel, xUnit, yUnit,
  currentX, okMin, okMax, warnMin, warnMax, onClose,
}: SweepChartProps & { merged: { x: number; y: number; y2?: number }[]; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
          width: '82vw', height: '70vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid #21262d',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', fontFamily: 'Consolas, monospace' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #30363d', borderRadius: 6,
              color: '#8b949e', cursor: 'pointer', padding: '4px 10px', fontSize: 12,
            }}
          >
            ✕  Close
          </button>
        </div>
        {/* Chart */}
        <div style={{ flex: 1, padding: '12px 8px 8px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ChartContent
              merged={merged} data2={data2} xLabel={xLabel} yLabel={yLabel}
              xUnit={xUnit ?? ''} yUnit={yUnit ?? ''} label2={label2}
              currentX={currentX} okMin={okMin} okMax={okMax}
              warnMin={warnMin} warnMax={warnMax} large
            />
          </ResponsiveContainer>
        </div>
        <div style={{ padding: '4px 16px 10px', fontSize: 9, color: '#484f58', fontFamily: 'Consolas, monospace' }}>
          Click backdrop or press Escape to close
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SweepChart({
  title, data, data2, label2, xLabel, yLabel, xUnit = '', yUnit = '',
  currentX, okMin, okMax, warnMin, warnMax,
}: SweepChartProps) {
  const [open, setOpen] = useState(false);

  const merged = data2
    ? data.map((pt, i) => ({ ...pt, y2: data2[i]?.y }))
    : data;

  return (
    <>
      <div className="chart-card" style={{ position: 'relative' }}>
        {/* Expand button */}
        <button
          onClick={() => setOpen(true)}
          title="Expand chart"
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 2,
            background: '#21262d', border: '1px solid #30363d', borderRadius: 5,
            color: '#8b949e', cursor: 'pointer', padding: '1px 6px', fontSize: 10,
            lineHeight: '16px',
          }}
        >
          ⤢
        </button>

        <div className="chart-title" style={{ paddingRight: 24 }}>{title}</div>

        <ResponsiveContainer width="100%" height={160}>
          <ChartContent
            merged={merged} data2={data2} xLabel={xLabel} yLabel={yLabel}
            xUnit={xUnit} yUnit={yUnit} label2={label2}
            currentX={currentX} okMin={okMin} okMax={okMax}
            warnMin={warnMin} warnMax={warnMax} large={false}
          />
        </ResponsiveContainer>
      </div>

      {open && (
        <ChartModal
          title={title} data={data} data2={data2} label2={label2}
          xLabel={xLabel} yLabel={yLabel} xUnit={xUnit} yUnit={yUnit}
          currentX={currentX} okMin={okMin} okMax={okMax}
          warnMin={warnMin} warnMax={warnMax}
          merged={merged} onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
