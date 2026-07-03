/**
 * RideQualityPanel.tsx — R7: ISO 2631 Ride Quality Index
 *
 * 2-DOF quarter-car model (sprung + unsprung) for front and rear axles.
 * Road excitation from ISO 8608 (classes A-E) propagated through the
 * suspension transfer function and weighted by ISO 2631-1 Wk filter to
 * yield weighted RMS acceleration a_w (m/s²) with comfort rating.
 *
 * Key output: a_w < 0.315 = "not uncomfortable", > 0.63 = "fairly uncomfortable".
 * Most actionable insight: if sprung-mass resonance falls at 4-8 Hz (Wk peak),
 * ride quality is poor — tune nat freq to < 3 Hz or > 8 Hz.
 */
import { useState, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area,
} from 'recharts';
import { useStore } from '../../store/useStore';

// ── Constants ─────────────────────────────────────────────────────────────────
const TWO_PI = 2 * Math.PI;

// ISO 2631-1 Wk frequency weighting (Table A.2) — vertical vibration, human seated
const WK_TABLE: [number, number][] = [
  [0.5, 0.156], [0.63, 0.196], [0.8, 0.245],
  [1.0, 0.315], [1.25, 0.394], [1.6, 0.500],
  [2.0, 0.630], [2.5, 0.800], [3.15, 0.990],
  [4.0, 1.000], [5.0, 0.908], [6.3, 0.769],
  [8.0, 0.638], [10.0, 0.512], [12.5, 0.409],
  [16.0, 0.323], [20.0, 0.228], [25.0, 0.161],
  [31.5, 0.113], [40.0, 0.080], [50.0, 0.056],
  [63.0, 0.040], [80.0, 0.028],
];

// ISO 8608 road roughness classes — Gd(n0) in m³/cycle at n0 = 0.1 cycle/m
const ROAD_CLASSES: Record<string, { Gd: number; label: string; color: string }> = {
  A: { Gd: 1e-6,   label: 'A — Very smooth (motorway)',    color: '#3fb950' },
  B: { Gd: 4e-6,   label: 'B — Good (city road)',          color: '#7ee787' },
  C: { Gd: 16e-6,  label: 'C — Average (rural road)',      color: '#e8b44a' },
  D: { Gd: 64e-6,  label: 'D — Poor (damaged road)',       color: '#ff8c42' },
  E: { Gd: 256e-6, label: 'E — Very poor (off-road)',      color: '#f85149' },
};

// ISO 2631-1 §A.1 comfort scale for vertical a_w (m/s²)
const COMFORT: { max: number; label: string; short: string; color: string }[] = [
  { max: 0.315, label: 'Not uncomfortable',       short: 'Comfortable',   color: '#3fb950' },
  { max: 0.630, label: 'A little uncomfortable',  short: 'A little',      color: '#7ee787' },
  { max: 1.000, label: 'Fairly uncomfortable',    short: 'Fairly',        color: '#e8b44a' },
  { max: 1.600, label: 'Uncomfortable',           short: 'Uncomfortable', color: '#ff8c42' },
  { max: 2.500, label: 'Very uncomfortable',      short: 'Very uncomf.',  color: '#f85149' },
  { max: Infinity, label: 'Extremely uncomfortable', short: 'Extreme',    color: '#8b0000' },
];

function comfortFor(aw: number) {
  return COMFORT.find(c => aw <= c.max) ?? COMFORT[COMFORT.length - 1];
}

// ── Physics helpers ───────────────────────────────────────────────────────────

/** ISO 2631-1 Wk weighting at frequency f (Hz) — log-linear interpolation. */
function wkAt(f: number): number {
  if (f <= WK_TABLE[0][0]) return WK_TABLE[0][1];
  const last = WK_TABLE[WK_TABLE.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 0; i < WK_TABLE.length - 1; i++) {
    const [f0, w0] = WK_TABLE[i], [f1, w1] = WK_TABLE[i + 1];
    if (f >= f0 && f <= f1) {
      const t = Math.log(f / f0) / Math.log(f1 / f0);
      return w0 + t * (w1 - w0);
    }
  }
  return 0;
}

/**
 * ISO 8608 road displacement PSD at temporal frequency f (Hz)
 * for vehicle speed v_ms (m/s) and roughness coefficient Gd (m³/cycle).
 *   S_r(f) = Gd × n₀² × v / f²   [m²/Hz]
 * where n₀ = 0.1 cycle/m (ISO 8608 reference spatial frequency).
 */
function roadPSD(f: number, Gd: number, v_ms: number): number {
  return Gd * 0.01 * v_ms / (f * f);
}

/**
 * 2-DOF quarter-car transfer function magnitude |z̈_s / z_r| at ω (rad/s).
 * Units: s⁻²  (= (m/s²) per m of road displacement)
 *
 * EOMs:
 *   m_s·z̈_s + c(ż_s−ż_u) + k(z_s−z_u) = 0
 *   m_u·z̈_u − c(ż_s−ż_u) − k(z_s−z_u) + k_t(z_u−z_r) = 0
 *
 * → Z_s/Z_r = k_t(cs+k) / [(m_s s²+cs+k)(m_u s²+cs+k+k_t) − (cs+k)²]
 * → H_acc = s²·Z_s/Z_r  evaluated at s=jω
 */
function quarterCarAccelMag(
  ω: number, ms: number, mu: number,
  k: number, c: number, kt: number,
): number {
  const ω2 = ω * ω;
  const Kc_re = k, Kc_im = ω * c;                         // k + jωc
  const num_re = kt * Kc_re, num_im = kt * Kc_im;          // k_t(k+jωc)
  const A_re = k - ms * ω2, A_im = ω * c;                  // m_s s² + k + cs
  const B_re = k + kt - mu * ω2, B_im = ω * c;             // m_u s² + k+k_t + cs
  const AB_re = A_re * B_re - A_im * B_im;
  const AB_im = A_re * B_im + A_im * B_re;
  const C2_re = Kc_re * Kc_re - Kc_im * Kc_im;            // (k+jωc)²
  const C2_im = 2 * Kc_re * Kc_im;
  const den_re = AB_re - C2_re, den_im = AB_im - C2_im;
  const den2 = den_re * den_re + den_im * den_im;
  if (den2 < 1e-30) return 0;
  const Hd_re = (num_re * den_re + num_im * den_im) / den2;
  const Hd_im = (num_im * den_re - num_re * den_im) / den2;
  // H_acc = -ω²·H_disp  (s² at s=jω is -ω²)
  const Ha_re = -ω2 * Hd_re, Ha_im = -ω2 * Hd_im;
  return Math.sqrt(Ha_re * Ha_re + Ha_im * Ha_im);
}

/**
 * ISO 2631 weighted RMS acceleration a_w (m/s²).
 * Integrates Wk²(f) × |H_acc(f)|² × S_r(f) over 0.5–80 Hz (log-spaced).
 */
function computeAw(
  ms: number, mu: number, k: number, c: number, kt: number,
  Gd: number, v_ms: number,
  N = 300,
): number {
  const f1 = 0.5, f2 = 80;
  const lf1 = Math.log(f1), lf2 = Math.log(f2);
  let sum = 0;
  for (let i = 0; i < N - 1; i++) {
    const fa = Math.exp(lf1 + (i / (N - 1)) * (lf2 - lf1));
    const fb = Math.exp(lf1 + ((i + 1) / (N - 1)) * (lf2 - lf1));
    const fm = (fa + fb) / 2;
    const df = fb - fa;
    const H = quarterCarAccelMag(TWO_PI * fm, ms, mu, k, c, kt);
    const S = roadPSD(fm, Gd, v_ms);
    const W = wkAt(fm);
    sum += W * W * H * H * S * df;
  }
  return Math.sqrt(sum);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TFPayload { f: number; front: number; rear: number; wk: number }
interface SweepPayload { v: number; front: number; rear: number }

const TFTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: TFPayload }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 9 }}>
      <div style={{ color: 'var(--text-muted)' }}>{d.f.toFixed(2)} Hz</div>
      <div style={{ color: 'var(--accent)' }}>Front: {d.front.toFixed(3)}</div>
      <div style={{ color: 'var(--accent2)' }}>Rear: {d.rear.toFixed(3)}</div>
      <div style={{ color: 'var(--text-muted)' }}>Wk: {d.wk.toFixed(3)}</div>
    </div>
  );
};

const SweepTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: SweepPayload }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cf = comfortFor(d.front), cr = comfortFor(d.rear);
  return (
    <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 9 }}>
      <div style={{ color: 'var(--text-muted)' }}>{d.v} km/h</div>
      <div style={{ color: 'var(--accent)' }}>Front a_w: {d.front.toFixed(3)} m/s² — <span style={{ color: cf.color }}>{cf.short}</span></div>
      <div style={{ color: 'var(--accent2)' }}>Rear a_w: {d.rear.toFixed(3)} m/s² — <span style={{ color: cr.color }}>{cr.short}</span></div>
    </div>
  );
};

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, note }: { label: string; value: string; unit: string; note: string; noteColor: string }) {
  return (
    <div style={{
      flex: 1, padding: '8px 10px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 6, minWidth: 0,
    }}>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 700, lineHeight: 1.2 }}>
        {value} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 8, marginTop: 2, color: 'var(--text-muted)' }}>{note}</div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function RideQualityPanel() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);

  const [speedKmh, setSpeedKmh]         = useState(80);
  const [roadClass, setRoadClass]        = useState('C');
  const [tireNmm, setTireNmm]           = useState(150);  // N/mm tire stiffness
  const [overrideDamp, setOverrideDamp] = useState(false);
  const [zetaF, setZetaF]               = useState(0.30);
  const [zetaR, setZetaR]               = useState(0.30);
  const [chartTab, setChartTab]          = useState<'tf' | 'sweep'>('tf');

  // ── Suspension parameters ──────────────────────────────────────────────────
  const susp = results.suspension;
  const msF = Math.max(1, susp.sprungMassFront);
  const msR = Math.max(1, susp.sprungMassRear);
  const muF = Math.max(1, input.suspension.unsprungFront);
  const muR = Math.max(1, input.suspension.unsprungRear);
  const kF  = susp.wheelRateFront * 1000;   // N/mm → N/m
  const kR  = susp.wheelRateRear  * 1000;
  const kt  = tireNmm * 1000;               // N/mm → N/m

  const zF_eff = Math.max(0.05, overrideDamp ? zetaF : susp.dampingRatioFront);
  const zR_eff = Math.max(0.05, overrideDamp ? zetaR : susp.dampingRatioRear);
  const cF = zF_eff * susp.criticalDampingFront;
  const cR = zR_eff * susp.criticalDampingRear;

  const Gd   = ROAD_CLASSES[roadClass].Gd;
  const v_ms = speedKmh / 3.6;

  // ── a_w at current speed ───────────────────────────────────────────────────
  const awFront = useMemo(
    () => computeAw(msF, muF, kF, cF, kt, Gd, v_ms),
    [msF, muF, kF, cF, kt, Gd, v_ms],
  );
  const awRear = useMemo(
    () => computeAw(msR, muR, kR, cR, kt, Gd, v_ms),
    [msR, muR, kR, cR, kt, Gd, v_ms],
  );
  const cfF = comfortFor(awFront);
  const cfR = comfortFor(awRear);

  // ── Transfer function chart (0.5–25 Hz) ───────────────────────────────────
  const tfData = useMemo(() => {
    const N = 200;
    const raw: { f: number; front: number; rear: number; wk: number }[] = [];
    let maxH = 0;
    for (let i = 0; i < N; i++) {
      const f = 0.5 + (i / (N - 1)) * 24.5;  // 0.5–25 Hz linear
      const w = TWO_PI * f;
      const hf = quarterCarAccelMag(w, msF, muF, kF, cF, kt);
      const hr = quarterCarAccelMag(w, msR, muR, kR, cR, kt);
      maxH = Math.max(maxH, hf, hr);
      raw.push({ f: parseFloat(f.toFixed(2)), front: hf, rear: hr, wk: wkAt(f) });
    }
    return maxH > 0 ? raw.map(d => ({ ...d, front: d.front / maxH, rear: d.rear / maxH })) : raw;
  }, [msF, muF, kF, cF, msR, muR, kR, cR, kt]);

  // ── Speed sweep chart (10–155 km/h) ───────────────────────────────────────
  const sweepData = useMemo(() => {
    const speeds = Array.from({ length: 30 }, (_, i) => 10 + i * 5);
    return speeds.map(v_kmh => ({
      v: v_kmh,
      front: computeAw(msF, muF, kF, cF, kt, Gd, v_kmh / 3.6),
      rear:  computeAw(msR, muR, kR, cR, kt, Gd, v_kmh / 3.6),
    }));
  }, [msF, muF, kF, cF, msR, muR, kR, cR, kt, Gd]);

  const natFront = susp.natFreqFront;
  const natRear  = susp.natFreqRear;
  const hopFront = susp.unsprungFreqFront;
  const hopRear  = susp.unsprungFreqRear;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left config ── */}
      <div style={{
        width: 292, flexShrink: 0, borderRight: '1px solid var(--border)',
        overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 12,
      }}>

        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Ride Conditions
        </div>

        {/* Speed */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
            Vehicle Speed — {speedKmh} km/h ({(speedKmh / 3.6).toFixed(1)} m/s)
          </div>
          <input type="range" min={10} max={160} step={5} value={speedKmh}
            onChange={e => setSpeedKmh(+e.target.value)}
            style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)' }}>
            <span>10</span><span>80</span><span>160 km/h</span>
          </div>
        </div>

        {/* Road class */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5 }}>Road Class (ISO 8608)</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {Object.entries(ROAD_CLASSES).map(([cls, rc]) => (
              <button key={cls} onClick={() => setRoadClass(cls)}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 9, fontWeight: 700, borderRadius: 4,
                  cursor: 'pointer', border: `1px solid ${roadClass === cls ? rc.color : 'var(--border)'}`,
                  background: roadClass === cls ? rc.color + '22' : 'var(--surface2)',
                  color: roadClass === cls ? rc.color : 'var(--text-muted)',
                }}>
                {cls}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 3 }}>
            {ROAD_CLASSES[roadClass].label}
          </div>
        </div>

        {/* Tire stiffness */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
            Tyre Stiffness — {tireNmm} N/mm
            <span style={{ marginLeft: 6, fontSize: 8 }}>(road 120–180 / off-road 60–100)</span>
          </div>
          <input type="range" min={60} max={300} step={10} value={tireNmm}
            onChange={e => setTireNmm(+e.target.value)}
            style={{ width: '100%', accentColor: 'var(--accent)' }} />
        </div>

        {/* Damping override */}
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
            <input type="checkbox" checked={overrideDamp}
              onChange={e => setOverrideDamp(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }} />
            Override damping ratio (from Suspension tab)
          </label>

          {overrideDamp ? (
            <>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>
                Front ζ — {zetaF.toFixed(2)} {zetaF < 0.3 ? '(underdamped)' : zetaF > 0.65 ? '(overdamped)' : '(optimal zone)'}
              </div>
              <input type="range" min={0.05} max={1.0} step={0.05} value={zetaF}
                onChange={e => setZetaF(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent)', marginBottom: 8 }} />
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>
                Rear ζ — {zetaR.toFixed(2)}
              </div>
              <input type="range" min={0.05} max={1.0} step={0.05} value={zetaR}
                onChange={e => setZetaR(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent2)' }} />
            </>
          ) : (
            <div style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              Using actual damping from Suspension tab:<br />
              Front ζ = <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{susp.dampingRatioFront.toFixed(2)}</span><br />
              Rear ζ = <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{susp.dampingRatioRear.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Suspension parameters (read-only summary) */}
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Quarter-Car Basis
          </div>
          <table style={{ width: '100%', fontSize: 9, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                <th style={{ textAlign: 'left', padding: '2px 4px' }}>Parameter</th>
                <th style={{ textAlign: 'right', padding: '2px 4px' }}>Front</th>
                <th style={{ textAlign: 'right', padding: '2px 4px' }}>Rear</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Sprung mass', msF.toFixed(1), msR.toFixed(1), 'kg'],
                ['Unsprung mass', muF.toFixed(1), muR.toFixed(1), 'kg'],
                ['Wheel rate k', (kF / 1000).toFixed(1), (kR / 1000).toFixed(1), 'N/mm'],
                ['Damping c', (cF / 1000).toFixed(2), (cR / 1000).toFixed(2), 'N·s/mm'],
                ['Nat freq f_n', natFront.toFixed(2), natRear.toFixed(2), 'Hz'],
                ['Wheel-hop f_u', hopFront.toFixed(1), hopRear.toFixed(1), 'Hz'],
                ['Tyre k_t', (kt / 1000).toFixed(0), (kt / 1000).toFixed(0), 'N/mm'],
              ].map(([label, vf, vr, unit]) => (
                <tr key={label as string} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '3px 4px', color: 'var(--text-muted)' }}>{label}</td>
                  <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent)' }}>{vf}</td>
                  <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent2)' }}>{vr}</td>
                  <td style={{ padding: '3px 4px', color: 'var(--text-muted)', fontSize: 8 }}>{unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ISO 2631 comfort scale */}
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            ISO 2631 Comfort Scale
          </div>
          {COMFORT.map(c => (
            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                {c.max === Infinity ? '> 2.5' : `< ${c.max.toFixed(3)}`} m/s²
              </span>
              <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Wk filter peaks at 4–8 Hz: worst resonance zone for humans.
            Tune nat freq below 3 Hz or above 8 Hz to improve rating.
          </div>
        </div>
      </div>

      {/* ── Right results ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 8 }}>
          <KpiCard
            label="Front a_w (handlebar)"
            value={awFront.toFixed(3)}
            unit="m/s²"
            note={cfF.label}
            noteColor={cfF.color}
          />
          <KpiCard
            label="Rear a_w (seat — ISO primary)"
            value={awRear.toFixed(3)}
            unit="m/s²"
            note={cfR.label}
            noteColor={cfR.color}
          />
          <div style={{
            flex: 1, padding: '8px 10px', background: 'var(--surface)',
            border: `2px solid ${cfR.color}`, borderRadius: 6, minWidth: 0,
          }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>ISO Comfort Rating</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: cfR.color, lineHeight: 1.3, marginTop: 2 }}>
              {cfR.label}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
              {roadClass} road · {speedKmh} km/h
            </div>
          </div>
          <div style={{
            flex: 0.7, padding: '8px 10px', background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 6, minWidth: 0,
          }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Nat Freq</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 700 }}>
              {natFront.toFixed(2)} Hz
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Front body bounce</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent2)', fontWeight: 700 }}>
              {natRear.toFixed(2)} Hz
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Rear body bounce</div>
          </div>
        </div>

        {/* a_w gauge bar */}
        <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ display: 'flex', marginBottom: 4, fontSize: 8, color: 'var(--text-muted)' }}>
            <span style={{ flex: 1 }}>0</span>
            <span>0.315</span><span style={{ marginLeft: 40 }}>0.630</span>
            <span style={{ marginLeft: 36 }}>1.0</span><span style={{ marginLeft: 46 }}>1.6</span>
            <span style={{ marginLeft: 38 }}>2.5+ m/s²</span>
          </div>
          <div style={{ position: 'relative', height: 14, borderRadius: 4, overflow: 'hidden',
            background: 'linear-gradient(to right, #3fb950, #7ee787 20%, #e8b44a 40%, #ff8c42 60%, #f85149 80%, #8b000088)' }}>
            {/* Front marker */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: 2,
              left: `${Math.min(99, (awFront / 2.5) * 100)}%`,
              background: 'var(--accent)', boxShadow: '0 0 4px var(--accent)',
            }} />
            {/* Rear marker */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: 2,
              left: `${Math.min(99, (awRear / 2.5) * 100)}%`,
              background: 'var(--accent2)', boxShadow: '0 0 4px var(--accent2)',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 8, color: 'var(--text-muted)' }}>
            <span><span style={{ color: 'var(--accent)' }}>▌</span> Front handlebar</span>
            <span><span style={{ color: 'var(--accent2)' }}>▌</span> Rear seat (ISO primary)</span>
          </div>
        </div>

        {/* Chart tabs */}
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['tf', 'sweep'] as const).map(tab => (
              <button key={tab} onClick={() => setChartTab(tab)}
                style={{
                  fontSize: 9, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${chartTab === tab ? 'var(--accent)' : 'var(--border)'}`,
                  background: chartTab === tab ? 'var(--accent)18' : 'var(--surface2)',
                  color: chartTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: chartTab === tab ? 700 : 400,
                }}>
                {tab === 'tf' ? 'Transfer Function' : 'Speed Sweep'}
              </button>
            ))}
          </div>

          {/* Transfer function chart */}
          {chartTab === 'tf' && (
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
                Normalised suspension transmissibility |H_acc(f)| vs frequency (0.5–25 Hz).
                Dashed grey = ISO 2631 Wk weighting (shows which frequencies hurt comfort most).
                Mark sprung resonance and wheel-hop peaks.
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={tfData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="f" tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                      label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -2, fontSize: 8, fill: 'var(--text-muted)' }} />
                    <YAxis domain={[0, 1.05]} tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                      label={{ value: 'Relative response', angle: -90, position: 'insideLeft', offset: 10, fontSize: 8, fill: 'var(--text-muted)' }} />
                    <Tooltip content={<TFTooltip />} />

                    {/* Sprung resonance markers */}
                    {natFront > 0 && natFront <= 25 && (
                      <ReferenceLine x={parseFloat(natFront.toFixed(2))} stroke="var(--accent)" strokeDasharray="4 3" strokeOpacity={0.7}
                        label={{ value: `f_nF ${natFront.toFixed(1)}Hz`, position: 'top', fontSize: 7, fill: 'var(--accent)' }} />
                    )}
                    {natRear > 0 && natRear <= 25 && (
                      <ReferenceLine x={parseFloat(natRear.toFixed(2))} stroke="var(--accent2)" strokeDasharray="4 3" strokeOpacity={0.7}
                        label={{ value: `f_nR ${natRear.toFixed(1)}Hz`, position: 'top', fontSize: 7, fill: 'var(--accent2)' }} />
                    )}
                    {/* Wheel-hop markers */}
                    {hopFront > 0 && hopFront <= 25 && (
                      <ReferenceLine x={parseFloat(hopFront.toFixed(1))} stroke="var(--cyan)" strokeDasharray="2 4" strokeOpacity={0.5}
                        label={{ value: `hop_F ${hopFront.toFixed(0)}Hz`, position: 'top', fontSize: 7, fill: 'var(--cyan)' }} />
                    )}
                    {hopRear > 0 && hopRear <= 25 && (
                      <ReferenceLine x={parseFloat(hopRear.toFixed(1))} stroke="var(--purple)" strokeDasharray="2 4" strokeOpacity={0.5}
                        label={{ value: `hop_R ${hopRear.toFixed(0)}Hz`, position: 'top', fontSize: 7, fill: 'var(--purple)' }} />
                    )}
                    {/* Wk comfort zone (4-8 Hz peak) */}
                    <Area dataKey="wk" fill="#e8b44a" fillOpacity={0.08} stroke="none" />
                    <Line dataKey="wk" stroke="#e8b44a" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Wk weight" />
                    <Line dataKey="front" stroke="var(--accent)" strokeWidth={1.5} dot={false} name="Front" />
                    <Line dataKey="rear" stroke="var(--accent2)" strokeWidth={1.5} dot={false} name="Rear" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 4 }}>
                <span style={{ color: 'var(--accent)' }}>— Front</span>
                &nbsp;·&nbsp;
                <span style={{ color: 'var(--accent2)' }}>— Rear</span>
                &nbsp;·&nbsp;
                <span style={{ color: '#e8b44a' }}>- - Wk weighting (ISO 2631)</span>
                &nbsp;·&nbsp; Amber shading = 4–8 Hz human sensitivity peak. Avoid resonance here.
              </div>
            </div>
          )}

          {/* Speed sweep chart */}
          {chartTab === 'sweep' && (
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
                ISO 2631 weighted RMS a_w vs vehicle speed — {ROAD_CLASSES[roadClass].label}.
                Horizontal bands = ISO comfort thresholds.
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={sweepData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="v" tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                      label={{ value: 'Speed (km/h)', position: 'insideBottom', offset: -2, fontSize: 8, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 8, fill: 'var(--text-muted)' }} domain={[0, 'auto']}
                      label={{ value: 'a_w (m/s²)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 8, fill: 'var(--text-muted)' }} />
                    <Tooltip content={<SweepTooltip />} />

                    {/* ISO comfort band lines */}
                    <ReferenceLine y={0.315} stroke="#3fb950" strokeDasharray="3 3" strokeOpacity={0.7}
                      label={{ value: '0.315 not uncomf.', position: 'right', fontSize: 7, fill: '#3fb950' }} />
                    <ReferenceLine y={0.630} stroke="#e8b44a" strokeDasharray="3 3" strokeOpacity={0.7}
                      label={{ value: '0.63 fairly', position: 'right', fontSize: 7, fill: '#e8b44a' }} />
                    <ReferenceLine y={1.000} stroke="#ff8c42" strokeDasharray="3 3" strokeOpacity={0.7}
                      label={{ value: '1.0 uncomf.', position: 'right', fontSize: 7, fill: '#ff8c42' }} />
                    <ReferenceLine y={1.600} stroke="#f85149" strokeDasharray="3 3" strokeOpacity={0.7}
                      label={{ value: '1.6 very', position: 'right', fontSize: 7, fill: '#f85149' }} />

                    {/* Current speed marker */}
                    <ReferenceLine x={speedKmh} stroke="var(--text-muted)" strokeDasharray="4 2" strokeOpacity={0.5}
                      label={{ value: `${speedKmh}`, position: 'top', fontSize: 7, fill: 'var(--text-muted)' }} />

                    <Line dataKey="front" stroke="var(--accent)" strokeWidth={1.5} dot={false} name="Front a_w" />
                    <Line dataKey="rear"  stroke="var(--accent2)" strokeWidth={1.5} dot={false} name="Rear a_w" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 4 }}>
                <span style={{ color: 'var(--accent)' }}>— Front (handlebar)</span>
                &nbsp;·&nbsp;
                <span style={{ color: 'var(--accent2)' }}>— Rear (seat)</span>
                &nbsp;·&nbsp; Vertical mark = current speed setting.
              </div>
            </div>
          )}
        </div>

        {/* Design insights */}
        <div style={{
          padding: '10px 14px', borderRadius: 6, background: 'var(--surface)',
          border: '1px solid var(--border)', fontSize: 9, lineHeight: 1.9,
        }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>Design Insights</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Front nat freq vs Wk peak (4 Hz): </span>
              <span style={{ color: natFront < 4 ? '#3fb950' : natFront < 6 ? '#e8b44a' : '#f85149', fontFamily: 'monospace' }}>
                {natFront.toFixed(2)} Hz {natFront < 3 ? '✓ below sensitivity zone' : natFront < 5 ? '△ near peak zone' : '✗ in worst zone'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Rear nat freq: </span>
              <span style={{ color: natRear < 4 ? '#3fb950' : natRear < 6 ? '#e8b44a' : '#f85149', fontFamily: 'monospace' }}>
                {natRear.toFixed(2)} Hz {natRear < 3 ? '✓' : natRear < 5 ? '△' : '✗'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Front damping ratio ζ: </span>
              <span style={{ color: zF_eff >= 0.25 && zF_eff <= 0.65 ? '#3fb950' : '#e8b44a', fontFamily: 'monospace' }}>
                {zF_eff.toFixed(2)} {zF_eff < 0.25 ? '(underdamped — harsh)' : zF_eff > 0.65 ? '(overdamped — sluggish)' : '(good range 0.25–0.65)'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Rear damping ratio ζ: </span>
              <span style={{ color: zR_eff >= 0.25 && zR_eff <= 0.65 ? '#3fb950' : '#e8b44a', fontFamily: 'monospace' }}>
                {zR_eff.toFixed(2)} {zR_eff < 0.25 ? '(underdamped)' : zR_eff > 0.65 ? '(overdamped)' : '(good)'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Sprung/unsprung mass ratio F: </span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                {(msF / muF).toFixed(1)}× {msF / muF > 6 ? '✓' : '△ aim for > 6×'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Sprung/unsprung mass ratio R: </span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                {(msR / muR).toFixed(1)}× {msR / muR > 6 ? '✓' : '△ aim for > 6×'}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Physics: </strong>
            2-DOF quarter-car model. Road input PSD = ISO 8608 S_r(f) = Gd·n₀²·v/f².
            Output a_w = √(∫W_k²(f)·|H_acc(f)|²·S_r(f)df) integrated 0.5–80 Hz.
            Wk = ISO 2631-1 vertical weighting (peaks 4–8 Hz — human most sensitive here).
            Tune sprung resonance away from 4–8 Hz for best ride quality.
          </div>
        </div>
      </div>
    </div>
  );
}
