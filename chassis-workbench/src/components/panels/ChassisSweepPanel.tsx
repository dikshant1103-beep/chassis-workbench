/**
 * ChassisSweepPanel.tsx — Suspension Travel Sweep tab
 *
 * Shows MR(u), WR(u), AS%(u) and Trail(u) curves over the full rear
 * suspension travel range.  Uses the engine/sweep.ts pure functions.
 *
 * Layout: left = shock mount geometry inputs + formula audit status
 *         right = four charts (SweepChart)
 */

import { useMemo } from 'react';
import { useStore, DEFAULT_SWEEP_PARAMS } from '../../store/useStore';
import { computeSweep } from '../../engine/sweep';
import { computeDynamicsSweep } from '../../engine/dynamicsSweep';
import type { SweepPoint } from '../../engine/types';
import { Section, PanelRow, ResultBar, SelectRow, getStatus } from './PanelShared';
import SweepChart from '../charts/SweepChart';
import { triggerDownload, sweepToCSV, dynamicsSweepToCSV } from '../../utils/exportUtils';

const DEFAULT_FOURBAR = DEFAULT_SWEEP_PARAMS.fourBar!;

export default function ChassisSweepPanel() {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);
  const setSweep = useStore(s => s.setSweep);
  const sp      = input.sweep ?? DEFAULT_SWEEP_PARAMS;
  const fb      = sp.fourBar ?? DEFAULT_FOURBAR;

  // ── Compute sweep ─────────────────────────────────────────────────────────
  // Auto-inject motionRatioOverride from suspension so MR is always correct
  // regardless of shock geometry defaults. User can set to 0 to use geometry path.
  const spWithOverride = useMemo(() => ({
    ...sp,
    motionRatioOverride: (sp.motionRatioOverride && sp.motionRatioOverride > 0)
      ? sp.motionRatioOverride
      : input.suspension.motionRatioRear,
  }), [sp, input.suspension.motionRatioRear]);

  const sweep = useMemo(() => {
    try {
      return computeSweep(
        input.geometry,
        input.suspension,
        input.chain,
        spWithOverride,
        results.cog.Y_cg,
        1, // 1 mm step
      );
    } catch {
      return null;
    }
  }, [input.geometry, input.suspension, input.chain, spWithOverride, results.cog.Y_cg]);

  // ── Chart data — suspension sweep ─────────────────────────────────────────
  const mrData  = sweep?.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.motionRatio }))    ?? [];
  const wrData  = sweep?.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.wheelRate_Nmm }))  ?? [];
  const asData  = sweep?.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.antiSquatPct }))   ?? [];
  const trData  = sweep?.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.trail_mm }))       ?? [];
  const saData  = sweep?.points.map((p: SweepPoint) => ({ x: p.travel_mm, y: p.swingarmAngleDeg })) ?? [];

  // ── Dynamics sweep (weight transfer vs decel/accel) ───────────────────────
  const dynSweep = useMemo(() => {
    try {
      return computeDynamicsSweep(
        input.geometry,
        input.suspension,
        results.cog.X_cg,
        results.cog.Y_cg,
        results.cog.totalMass,
      );
    } catch {
      return null;
    }
  }, [input.geometry, input.suspension, results.cog]);

  const wtBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.weightTransfer_N })) ?? [];
  const rfBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.R_front_N }))        ?? [];
  const rrBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.R_rear_N }))         ?? [];
  const adBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.antiDivePct }))      ?? [];
  const fkBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.forkCompression_mm })) ?? [];
  const reBrakeData  = dynSweep?.braking.map(p => ({ x: p.decel_g,  y: p.rearExtension_mm })) ?? [];
  const wtAccelData  = dynSweep?.accel.map(p   => ({ x: p.accel_g,  y: p.weightTransfer_N })) ?? [];
  const wmAccelData  = dynSweep?.accel.map(p   => ({ x: p.accel_g,  y: p.wheelieMarginPct })) ?? [];

  // ── Static-position summary cards ────────────────────────────────────────
  const st = sweep?.static;
  const mrSt = st ? getStatus(st.motionRatio, 0.4, 0.95, 0.55, 0.80) : null;
  const wrSt = st ? getStatus(st.wheelRate_Nmm, 5, 150, 15, 80) : null;
  const asSt = st ? getStatus(st.antiSquatPct, 20, 150, 60, 110) : null;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left input panel ── */}
      <div className="left-panel">
        <div className="panel-body">

          <Section icon="⟳" title="Shock Mount Geometry" defaultOpen>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
              Defines where the rear shock attaches to the swingarm and
              frame.  These positions determine the motion ratio curve.
            </div>

            <SelectRow
              label="Linkage Type"
              value={sp.linkageType}
              options={[
                { val: 'direct', label: 'Direct Monoshock' },
                { val: 'fourbar', label: '4-Bar (Pro-Link / Uni-Trak)' },
              ]}
              onChange={v => setSweep({ linkageType: v as 'direct' | 'fourbar' })}
            />

            <PanelRow
              label="Shock Arm Length"
              desc="Distance from swingarm pivot to shock mount on swingarm (mm)"
              value={sp.shockArmLength} min={40} max={300} step={5} unit="mm"
              onChange={v => setSweep({ shockArmLength: v })}
              optMin={80} optMax={180}
            />
            <PanelRow
              label="Shock Arm Angle"
              desc="Angle of shock arm relative to swingarm axis (°). 90° = perpendicular to swingarm."
              value={sp.shockArmAngle} min={30} max={150} step={1} unit="°"
              onChange={v => setSweep({ shockArmAngle: v })}
              optMin={70} optMax={100}
            />
          </Section>

          {/* 4-bar rocker geometry — only shown when fourbar linkage is selected */}
          {sp.linkageType === 'fourbar' && (
            <Section icon="◇" title="4-Bar Rocker Geometry" defaultOpen>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
                Rocker arm pivots at a frame-fixed point (R).  A pushrod
                connects the swingarm pickup (S) to the rocker tip (Q).
                The shock then runs from Q to the top mount.
              </div>
              <PanelRow
                label="Rocker Pivot X"
                desc="Distance from front axle to rocker pivot in frame (mm)"
                value={fb.rockerPivotX} min={400} max={1100} step={5} unit="mm"
                onChange={v => setSweep({ fourBar: { ...fb, rockerPivotX: v } })}
              />
              <PanelRow
                label="Rocker Pivot Y"
                desc="Height from ground to rocker pivot (mm)"
                value={fb.rockerPivotY} min={150} max={600} step={5} unit="mm"
                onChange={v => setSweep({ fourBar: { ...fb, rockerPivotY: v } })}
              />
              <PanelRow
                label="Rocker Length"
                desc="Length of rocker arm from pivot to tip (mm)"
                value={fb.rockerLength} min={30} max={200} step={5} unit="mm"
                onChange={v => setSweep({ fourBar: { ...fb, rockerLength: v } })}
                optMin={60} optMax={120}
              />
              <PanelRow
                label="Pushrod Length"
                desc="Length of pushrod from swingarm pickup to rocker tip (mm). Must be ≤ ‖R−S‖ + rocker length."
                value={fb.pushrodLength} min={50} max={400} step={5} unit="mm"
                onChange={v => setSweep({ fourBar: { ...fb, pushrodLength: v } })}
                optMin={80} optMax={220}
              />
              <PanelRow
                label="Rocker Angle (static)"
                desc="Initial rocker arm angle from horizontal (°). Used as NR warm-start."
                value={fb.rockerAngleStatic} min={-180} max={180} step={1} unit="°"
                onChange={v => setSweep({ fourBar: { ...fb, rockerAngleStatic: v } })}
              />
            </Section>
          )}

          <Section icon="▲" title="Shock Top Mount" defaultOpen>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>
              Frame-fixed top attachment of the rear shock.
            </div>
            <PanelRow
              label="Top Mount X"
              desc="Distance from front axle to shock top mount (mm)"
              value={sp.shockTopX} min={400} max={1200} step={10} unit="mm"
              onChange={v => setSweep({ shockTopX: v })}
            />
            <PanelRow
              label="Top Mount Height"
              desc="Height from ground to shock top mount (mm)"
              value={sp.shockTopY} min={150} max={700} step={10} unit="mm"
              onChange={v => setSweep({ shockTopY: v })}
            />
          </Section>

          {/* Static summary */}
          {st && (
            <Section icon="≡" title="Static Position Values">
              <ResultBar items={[
                { label: 'MR (static)',    val: `${st.motionRatio.toFixed(3)}`,       status: mrSt },
                { label: 'WR (static)',    val: `${st.wheelRate_Nmm.toFixed(1)} N/mm`, status: wrSt },
                { label: 'AS% (static)',   val: `${st.antiSquatPct.toFixed(1)}%`,      status: asSt },
                { label: 'Trail (static)', val: `${st.trail_mm.toFixed(1)} mm` },
                { label: 'SA angle',       val: `${st.swingarmAngleDeg.toFixed(2)}°` },
              ]} />
            </Section>
          )}

          {/* Export */}
          {sweep && (
            <Section icon="↓" title="Export" defaultOpen={false}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn-sm" onClick={() => triggerDownload(sweepToCSV(sweep.points), 'suspension-sweep.csv')}>
                  Download Suspension Sweep CSV
                </button>
                {dynSweep && (
                  <button className="btn-sm" onClick={() => triggerDownload(dynamicsSweepToCSV(dynSweep), 'dynamics-sweep.csv')}>
                    Download Dynamics Sweep CSV
                  </button>
                )}
                <button className="btn-sm" onClick={() => window.print()}>
                  Print Report
                </button>
              </div>
            </Section>
          )}

          {/* Formula audit badge */}
          <Section icon="✓" title="Formula Audit" defaultOpen={false}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              <div style={{ color: 'var(--accent2)' }}>✓ Trail — (R_f·sinα − f)/cosα  [Foale Eq 2.1]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ MR — dx_wheel/dx_shock  [central diff]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ WR — k·MR²  [Öhlins / Foale Ch.6]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ AS% — IC graphical method  [Foale Ch.11]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ AS swingarm-only — −tan(θ)·WB/Y_cg  [corrected]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ Lateral force — m·V²/R  [corrected; was m·a·Y/track]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ 4-bar linkage solver — NR loop closure [Phase 2]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ Weight transfer — m·a·Y_cg/WB  [Foale Eq 6.12 — Phase 3]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ Anti-dive % — tan(α)·(F_brake/W)·100  [Foale Eq 8.11 — Phase 3]</div>
              <div style={{ color: 'var(--accent2)' }}>✓ Validation — 6 real bikes ±5mm tolerance  [Phase 6]</div>
            </div>
          </Section>

        </div>
      </div>

      {/* ── Right chart panel ── */}
      <div className="right-panel" style={{ overflowY: 'auto', padding: '12px 8px' }}>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          maxWidth: 900,
        }}>

          <SweepChart
            title="Motion Ratio vs Travel"
            data={mrData}
            xLabel="Wheel Travel" xUnit="mm"
            yLabel="MR" yUnit=""
            okMin={0.55} okMax={0.80}
            currentX={0}
          />

          <SweepChart
            title="Wheel Rate vs Travel"
            data={wrData}
            xLabel="Wheel Travel" xUnit="mm"
            yLabel="Wheel Rate" yUnit="N/mm"
            okMin={15} okMax={80}
            currentX={0}
          />

          <SweepChart
            title="Anti-Squat % vs Travel"
            data={asData}
            xLabel="Wheel Travel" xUnit="mm"
            yLabel="Anti-Squat" yUnit="%"
            okMin={60} okMax={110}
            warnMin={30} warnMax={140}
            currentX={0}
          />

          <SweepChart
            title="Trail vs Fork Dive"
            data={trData}
            xLabel="Fork Compression" xUnit="mm"
            yLabel="Trail" yUnit="mm"
            okMin={80} okMax={120}
            warnMin={60} warnMax={140}
            currentX={0}
          />

          <SweepChart
            title="Swingarm Angle vs Travel"
            data={saData}
            xLabel="Wheel Travel" xUnit="mm"
            yLabel="SA Angle" yUnit="°"
            currentX={0}
          />

          {/* Rising-rate assertion box */}
          {sweep && (() => {
            const mrs = sweep.points.map((p: SweepPoint) => p.motionRatio);
            const dMR = mrs.slice(1).map((v: number, i: number) => v - mrs[i]);
            const isRising = dMR.every((d: number) => d <= 0.001);
            const isFalling = dMR.every((d: number) => d >= -0.001);
            const label = isRising ? 'Rising-rate ✓' : isFalling ? 'Falling-rate' : 'Progressive';
            const col = isRising ? 'var(--accent2)' : isFalling ? 'var(--warn)' : 'var(--cyan)';
            return (
              <div style={{
                background: 'var(--surface)',
                border: `1px solid ${col}`,
                borderRadius: 6,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                justifyContent: 'center',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Linkage Character
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: 'Consolas, monospace' }}>
                  {label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  MR range: {Math.min(...mrs).toFixed(3)} → {Math.max(...mrs).toFixed(3)}<br />
                  WR range: {Math.min(...sweep.points.map((p: SweepPoint) => p.wheelRate_Nmm)).toFixed(1)} →{' '}
                  {Math.max(...sweep.points.map((p: SweepPoint) => p.wheelRate_Nmm)).toFixed(1)} N/mm
                </div>
              </div>
            );
          })()}

        </div>

        {/* No sweep data fallback */}
        {!sweep && (
          <div style={{ padding: 24, color: 'var(--warn)', fontSize: 12 }}>
            ⚠ Sweep computation failed — check shock mount geometry parameters.
            Ensure the shock arm length and top mount position are consistent with
            the rear axle and swingarm pivot heights.
          </div>
        )}

        {/* ── Phase 3: Dynamics Sweep section ────────────────────────────── */}
        {dynSweep && (
          <>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: 1.5, marginTop: 18, marginBottom: 8, paddingLeft: 2,
            }}>
              — Dynamics Sweep (Phase 3) —
            </div>

            {/* Static load summary */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '10px 14px', marginBottom: 10,
              display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Static: <strong style={{ color: 'var(--text)' }}>{dynSweep.totalWeight_N.toFixed(0)} N</strong> total
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Front: <strong style={{ color: 'var(--accent)' }}>{dynSweep.staticFrontPct.toFixed(1)}%</strong>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Rear: <strong style={{ color: 'var(--accent2)' }}>{dynSweep.staticRearPct.toFixed(1)}%</strong>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Y_cg: <strong style={{ color: 'var(--text)' }}>{dynSweep.Y_cg_mm.toFixed(0)} mm</strong>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 900 }}>

              <SweepChart
                title="Weight Transfer vs Deceleration"
                data={wtBrakeData}
                xLabel="Deceleration" xUnit="g"
                yLabel="Weight Transfer" yUnit="N"
                currentX={0}
              />

              <SweepChart
                title="Axle Loads vs Deceleration"
                data={rfBrakeData}
                data2={rrBrakeData}
                xLabel="Deceleration" xUnit="g"
                yLabel="Load" yUnit="N"
                currentX={0}
                label2="Rear"
              />

              <SweepChart
                title="Anti-Dive % vs Deceleration"
                data={adBrakeData}
                xLabel="Deceleration" xUnit="g"
                yLabel="Anti-Dive" yUnit="%"
                okMin={20} okMax={60}
                warnMin={5} warnMax={90}
                currentX={0}
              />

              <SweepChart
                title="Fork Compression vs Deceleration"
                data={fkBrakeData}
                xLabel="Deceleration" xUnit="g"
                yLabel="Fork Compression" yUnit="mm"
                okMin={0} okMax={50}
                currentX={0}
              />

              <SweepChart
                title="Rear Shock Extension vs Braking"
                data={reBrakeData}
                xLabel="Deceleration" xUnit="g"
                yLabel="Rear Extension" yUnit="mm"
                currentX={0}
              />

              <SweepChart
                title="Wheelie Margin vs Acceleration"
                data={wmAccelData}
                xLabel="Acceleration" xUnit="g"
                yLabel="Front Load (% static)" yUnit="%"
                okMin={30} okMax={100}
                warnMin={10} warnMax={100}
                currentX={0}
              />

              <SweepChart
                title="Weight Transfer vs Acceleration"
                data={wtAccelData}
                xLabel="Acceleration" xUnit="g"
                yLabel="Weight Transfer" yUnit="N"
                currentX={0}
              />

            </div>
          </>
        )}

      </div>
    </div>
  );
}
