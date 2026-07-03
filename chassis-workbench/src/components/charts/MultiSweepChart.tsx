/**
 * MultiSweepChart.tsx — Overlay chart for Comparison Mode
 *
 * Renders up to 4 sweep series on shared axes.
 * Each series: { data: {x,y}[], label, color }
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea, Legend,
} from 'recharts';

export interface SweepSeries {
  data: { x: number; y: number }[];
  label: string;
  color: string;
}

interface MultiSweepChartProps {
  title: string;
  series: SweepSeries[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  okMin?: number;
  okMax?: number;
}

const TOOLTIP_STYLE = {
  background: '#161b22', border: '1px solid #30363d',
  color: '#e6edf3', fontSize: 10, fontFamily: 'Consolas, monospace',
};

/** Merge all series into one array indexed by x for recharts. */
function mergeSeries(series: SweepSeries[]): Record<string, number>[] {
  if (series.length === 0) return [];
  // Build a map of all x values → row
  const xMap = new Map<number, Record<string, number>>();
  series.forEach((s, si) => {
    s.data.forEach(pt => {
      const key = parseFloat(pt.x.toFixed(3));
      const row = xMap.get(key) ?? { x: key };
      row[`y${si}`] = pt.y;
      xMap.set(key, row);
    });
  });
  return Array.from(xMap.values()).sort((a, b) => a.x - b.x);
}

export default function MultiSweepChart({
  title, series, xLabel, yLabel, xUnit = '', yUnit = '', okMin, okMax,
}: MultiSweepChartProps) {
  const merged = mergeSeries(series);

  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={merged} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#8b949e', fontSize: 9 }}
            label={{ value: xUnit ? `${xLabel} (${xUnit})` : xLabel, position: 'insideBottom', offset: -12, fill: '#8b949e', fontSize: 9 }}
          />
          <YAxis
            tick={{ fill: '#8b949e', fontSize: 9 }}
            width={40}
            label={{ value: yUnit || yLabel, angle: -90, position: 'insideLeft', offset: 10, fill: '#8b949e', fontSize: 9 }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(l) => `${xLabel}: ${Number(l).toFixed(2)} ${xUnit}`}
            formatter={(v, name) => {
              const idx = Number(String(name).replace('y', ''));
              const s = series[idx];
              return [`${(v as number).toFixed(2)} ${yUnit}`, s?.label ?? name];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 9, color: '#8b949e', paddingTop: 4 }}
            formatter={(value) => {
              const idx = Number(String(value).replace('y', ''));
              return series[idx]?.label ?? value;
            }}
          />
          {okMin !== undefined && okMax !== undefined && (
            <ReferenceArea y1={okMin} y2={okMax} fill="#3fb950" fillOpacity={0.07} />
          )}
          {series.map((s, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`y${i}`}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              name={`y${i}`}
              activeDot={{ r: 3, fill: s.color }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
