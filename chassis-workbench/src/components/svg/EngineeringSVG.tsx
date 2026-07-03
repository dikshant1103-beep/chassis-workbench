import React from 'react';
import { useStore } from '../../store/useStore';
import type { VisibilityKey } from '../../store/useStore';
import { useTheme } from '../../store/useTheme';

// ── 2D overlay layer toggle bar ───────────────────────────────────────────────

const OVERLAY_TOGGLES: { key: VisibilityKey; label: string; color: string }[] = [
  { key: 'trailGeometry', label: 'Trail Geo', color: '#3fb950' },
  { key: 'chainSystem',   label: 'Chain',     color: '#f85149' },
  { key: 'forceLine',     label: 'Force',     color: '#f85149' },
  { key: 'antiSquatLine', label: 'AS Line',   color: '#d29922' },
  { key: 'instantCentre', label: 'IC',        color: '#d29922' },
  { key: 'cogMarker',     label: 'CoG',       color: '#f85149' },
];

function OverlayToggles() {
  const vis = useStore(s => s.visibility);
  const setVis = useStore(s => s.setVisibility);
  return (
    <div style={{
      position: 'absolute', top: 6, left: 6,
      display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260,
      pointerEvents: 'all',
    }}>
      {OVERLAY_TOGGLES.map(({ key, label, color }) => (
        <button
          key={key}
          onClick={() => setVis({ [key]: !vis[key] })}
          style={{
            padding: '2px 7px', fontSize: 9, borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${vis[key] ? color : '#444'}`,
            background: vis[key] ? `${color}22` : 'transparent',
            color: vis[key] ? color : '#666',
            fontFamily: 'Consolas, monospace',
            letterSpacing: 0.3,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const SCALE_BASE = 0.38;
const PAD_B = 55;
const PAD_R = 20;

export default function EngineeringSVG() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dims, setDims] = React.useState({ w: 800, h: 400 });
  const { theme } = useTheme();

  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(width, 400), h: Math.max(height, 220) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const input      = useStore(s => s.input);
  const results    = useStore(s => s.results);
  const vis        = useStore(s => s.visibility);
  const components = input.massComponents;

  const { w, h } = dims;
  const geo   = input.geometry;
  const chain = input.chain;
  const R_f   = geo.frontWheelDia / 2;
  const R_r   = geo.rearWheelDia  / 2;
  const WB    = geo.wheelbase;

  const trail    = results.geometry.trail;
  const xMin_mm  = -(trail + R_f * 0.2);
  const xMax_mm  = WB + R_r;
  const padL     = R_f * SCALE_BASE + 20;
  const availW   = w - padL - PAD_R;
  const scale    = Math.min(SCALE_BASE, availW / (xMax_mm - xMin_mm));
  const dynamicPadL = R_f * scale + 18;

  const X = (x: number) => dynamicPadL + x * scale;
  const Y = (y: number) => h - PAD_B - y * scale;

  const frontAxleX_mm = 0;
  const frontAxleY_mm = R_f;
  const rearAxleX_mm  = WB;
  const rearAxleY_mm  = geo.rearAxleHeight;

  const alpha  = (geo.headAngle * Math.PI) / 180;
  const ht_bx  = frontAxleX_mm + geo.forkOffset * Math.cos(alpha);
  const ht_by  = frontAxleY_mm + geo.forkOffset * Math.sin(alpha) - 10;
  const saLen  = 300;
  const sa_x1  = ht_bx - Math.sin(alpha) * saLen * 0.3;
  const sa_y1  = ht_by + Math.cos(alpha) * saLen * 0.3;
  const sa_x2  = ht_bx + Math.sin(alpha) * saLen * 0.7;
  const sa_y2  = ht_by - Math.cos(alpha) * saLen * 0.7;

  const groundContactX = frontAxleX_mm - trail;
  const pivX = geo.swingarmPivotX;
  const pivY = geo.swingarmPivotHeight;
  const cogX = results.cog.X_cg;
  const cogY = results.cog.Y_cg;
  const IC_x_abs = results.antiSquat.IC_x + pivX;
  const IC_y_abs = results.antiSquat.IC_y + pivY;
  const scaleBar = Math.round(200 * scale);

  // ── Chain/sprocket geometry (computed, not hardcoded) ─────────────────────
  // Standard 520 chain pitch = 15.875 mm → sprocket radius = teeth × pitch / (2π)
  const CHAIN_PITCH_MM = 15.875;
  const driveSprocketX  = pivX + chain.sprocketCenterX;
  const driveSprocketY  = pivY + chain.sprocketCenterY;
  const rearSprocketX   = rearAxleX_mm;
  const rearSprocketY   = rearAxleY_mm;
  const driveSprocketR  = (chain.frontSprocket * CHAIN_PITCH_MM) / (2 * Math.PI);
  const rearSprocketR   = (chain.rearSprocket  * CHAIN_PITCH_MM) / (2 * Math.PI);

  // Top chain run: tangent line between top of drive sprocket → top of rear sprocket
  // For simplicity: line from top-most tangent point of each sprocket
  // Exact tangent: perpendicular to the line joining centres, offset by radius
  const chainDx  = rearSprocketX - driveSprocketX;
  const chainDy  = rearSprocketY - driveSprocketY;
  const chainLen = Math.sqrt(chainDx * chainDx + chainDy * chainDy) || 1;
  // unit normal (perpendicular, pointing upward for top run)
  const nx = -chainDy / chainLen;
  const ny =  chainDx / chainLen;
  // Top chain run endpoints (tangent above each sprocket)
  const chainTopX1 = driveSprocketX + nx * driveSprocketR;
  const chainTopY1 = driveSprocketY + ny * driveSprocketR;
  const chainTopX2 = rearSprocketX  + nx * rearSprocketR;
  const chainTopY2 = rearSprocketY  + ny * rearSprocketR;
  // Bottom chain run (below)
  const chainBotX1 = driveSprocketX - nx * driveSprocketR;
  const chainBotY1 = driveSprocketY - ny * driveSprocketR;
  const chainBotX2 = rearSprocketX  - nx * rearSprocketR;
  const chainBotY2 = rearSprocketY  - ny * rearSprocketR;

  // ── Force line: from rear contact patch along chain top run direction ──────
  const rearContactX = rearAxleX_mm;
  const rearContactY = rearAxleY_mm - R_r; // ground level at rear tyre
  const chainAngleRad = Math.atan2(chainTopY2 - chainTopY1, chainTopX2 - chainTopX1);
  // Force line extends 600mm forward from rear contact in chain direction
  const forceLine_x2 = rearContactX + Math.cos(chainAngleRad) * (-600); // forward = negative X
  const forceLine_y2 = rearContactY + Math.sin(chainAngleRad) * (-600);

  // ── Steering axis projected to ground (for trail geometry) ────────────────
  // Steering axis: parametric x = ht_bx + t·sin(α), y = ht_by - t·cos(α)
  // At y=0: t = ht_by / cos(α)
  const steerGroundT = ht_by / Math.cos(alpha);
  const steerGroundX = ht_bx + Math.sin(alpha) * steerGroundT;  // should equal groundContactX + trail

  // ── Anti-squat line: rear contact → CoG (load transfer line) ─────────────
  const asLineExtend = 500; // mm extension past CoG
  const asDx = cogX - rearContactX;
  const asDy = cogY - rearContactY;
  const asLen2 = Math.sqrt(asDx * asDx + asDy * asDy) || 1;
  const asLine_x2 = cogX  + (asDx / asLen2) * asLineExtend;
  const asLine_y2 = cogY  + (asDy / asLen2) * asLineExtend;

  // ── Theme-aware colour map ───────────────────────────
  const dk = theme === 'dark';
  const C = {
    svgBg:     dk ? '#0a0f15' : '#eaf0f7',
    ground:    dk ? '#30363d' : '#b0bac4',
    wheel:     dk ? '#8b949e' : '#57606a',
    wheelHub:  dk ? '#8b949e' : '#57606a',
    fork:      dk ? '#1f6feb' : '#0969da',
    headTube:  dk ? '#1f6feb' : '#0969da',
    steerAxis: dk ? '#1f6feb' : '#0969da',
    frame:     dk ? '#4d5566' : '#8c959f',
    swingarm:  dk ? '#d29922' : '#9a6700',
    trail:     dk ? '#3fb950' : '#1a7f37',
    cog:       dk ? '#f85149' : '#cf222e',
    ic:        dk ? '#d29922' : '#9a6700',
    muted:     dk ? '#8b949e' : '#57606a',
    label:     dk ? '#e6edf3' : '#1f2328',
    massDot:   dk ? '#1f6feb' : '#0969da',
    ergo:      dk ? '#3fb950' : '#1a7f37',
    dim:       dk ? '#8b949e' : '#57606a',
    labelBg:   dk ? 'rgba(13,17,23,0.7)' : 'rgba(240,244,248,0.8)',
    // New overlay layers
    chainLine: '#f85149',   // red — chain line
    forceLine: '#f85149',   // dashed red — force line
    asLine:    '#d29922',   // dashed yellow — anti-squat LT line
    trailGeo:  dk ? '#3fb950' : '#1a7f37', // green — trail geometry
  };

  const font = "Consolas,monospace";

  // Helper — small label badge near a point
  function CompLabel({ x, y, text, dx = 6, dy = -10, anchor = 'start' }: {
    x: number; y: number; text: string;
    dx?: number; dy?: number; anchor?: string;
  }) {
    return (
      <text
        x={x + dx} y={y + dy}
        fill={C.muted} fontSize={9} textAnchor={anchor as any}
        fontFamily={font} letterSpacing="0.5"
        style={{ pointerEvents: 'none' }}
      >
        {text}
      </text>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: C.svgBg, position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        <defs>
          <marker id="arr-g" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill={C.trail} />
          </marker>
          <marker id="arr-m" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill={C.dim} />
          </marker>
          <marker id="arr-r" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill={C.chainLine} />
          </marker>
          <marker id="arr-y" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill={C.asLine} />
          </marker>
        </defs>

        {/* ── Ground ── */}
        <line x1={X(xMin_mm) - 10} y1={Y(0)} x2={w - 10} y2={Y(0)}
          stroke={C.ground} strokeWidth={1.5} />
        <text x={X(xMin_mm) - 8} y={Y(0) + 12} fill={C.muted} fontSize={9} fontFamily={font}>GROUND</text>

        {/* ── FRONT WHEEL ── */}
        <circle cx={X(frontAxleX_mm)} cy={Y(frontAxleY_mm)} r={R_f * scale}
          fill="none" stroke={C.wheel} strokeWidth={2} />
        {/* inner rim ring */}
        <circle cx={X(frontAxleX_mm)} cy={Y(frontAxleY_mm)} r={R_f * scale * 0.62}
          fill="none" stroke={C.wheel} strokeWidth={0.7} strokeOpacity={0.4} />
        <circle cx={X(frontAxleX_mm)} cy={Y(frontAxleY_mm)} r={5} fill={C.wheelHub} />
        <CompLabel
          x={X(frontAxleX_mm)} y={Y(frontAxleY_mm + R_f)}
          text="FRONT WHEEL" dx={-(R_f * scale * 0.5)} dy={-8} anchor="middle"
        />
        <CompLabel
          x={X(frontAxleX_mm) + R_f * scale + 6} y={Y(frontAxleY_mm)}
          text={`⌀${geo.frontWheelDia}mm`} dx={0} dy={4} anchor="start"
        />

        {/* ── REAR WHEEL ── */}
        <circle cx={X(rearAxleX_mm)} cy={Y(rearAxleY_mm)} r={R_r * scale}
          fill="none" stroke={C.wheel} strokeWidth={2} />
        <circle cx={X(rearAxleX_mm)} cy={Y(rearAxleY_mm)} r={R_r * scale * 0.62}
          fill="none" stroke={C.wheel} strokeWidth={0.7} strokeOpacity={0.4} />
        <circle cx={X(rearAxleX_mm)} cy={Y(rearAxleY_mm)} r={5} fill={C.wheelHub} />
        <CompLabel
          x={X(rearAxleX_mm)} y={Y(rearAxleY_mm + R_r)}
          text="REAR WHEEL" dx={R_r * scale * 0.3} dy={-8} anchor="middle"
        />
        <CompLabel
          x={X(rearAxleX_mm) + R_r * scale + 6} y={Y(rearAxleY_mm)}
          text={`⌀${geo.rearWheelDia}mm`} dx={0} dy={4} anchor="start"
        />

        {/* ── STEERING AXIS ── */}
        <line x1={X(sa_x1)} y1={Y(sa_y1)} x2={X(sa_x2)} y2={Y(sa_y2)}
          stroke={C.steerAxis} strokeWidth={1.2} strokeDasharray="7 3" />
        {/* steering axis label along the dashed line */}
        <text
          x={X(sa_x1) + 5} y={Y(sa_y1) - 4}
          fill={C.steerAxis} fontSize={9} fontFamily={font}
          transform={`rotate(${-geo.headAngle}, ${X(sa_x1) + 5}, ${Y(sa_y1) - 4})`}
          fillOpacity={0.75}
        >
          STEERING AXIS
        </text>

        {/* ── HEAD TUBE ── */}
        <line
          x1={X(ht_bx - 6)} y1={Y(ht_by - 35)}
          x2={X(ht_bx + 6)} y2={Y(ht_by + 35)}
          stroke={C.headTube} strokeWidth={4} strokeLinecap="round"
        />
        <CompLabel
          x={X(ht_bx + 6)} y={Y(ht_by + 35)}
          text="HEAD TUBE" dx={5} dy={0} anchor="start"
        />

        {/* ── FORK TUBES ── */}
        {/* Left fork (represented as the single 2D line from head to front axle) */}
        <line
          x1={X(ht_bx)} y1={Y(ht_by)}
          x2={X(frontAxleX_mm)} y2={Y(frontAxleY_mm)}
          stroke={C.fork} strokeWidth={2.5}
        />
        {(() => {
          const midFX = (ht_bx + frontAxleX_mm) / 2;
          const midFY = (ht_by + frontAxleY_mm) / 2;
          const angle = Math.atan2(Y(frontAxleY_mm) - Y(ht_by), X(frontAxleX_mm) - X(ht_bx)) * 180 / Math.PI;
          return (
            <text
              x={X(midFX) - 18} y={Y(midFY) - 10}
              fill={C.fork} fontSize={9} fontFamily={font}
              transform={`rotate(${angle}, ${X(midFX) - 18}, ${Y(midFY) - 10})`}
            >
              FRONT FORK
            </text>
          );
        })()}

        {/* ── FRAME SPINE ── */}
        <line
          x1={X(ht_bx)} y1={Y(ht_by)}
          x2={X(pivX)}  y2={Y(pivY)}
          stroke={C.frame} strokeWidth={1.5} strokeDasharray="5 3"
        />
        {(() => {
          const midX = (ht_bx + pivX) / 2;
          const midY = (ht_by + pivY) / 2;
          return (
            <CompLabel x={X(midX)} y={Y(midY)} text="FRAME" dx={0} dy={-8} anchor="middle" />
          );
        })()}

        {/* ── SWINGARM ── */}
        <line
          x1={X(pivX)} y1={Y(pivY)}
          x2={X(rearAxleX_mm)} y2={Y(rearAxleY_mm)}
          stroke={C.swingarm} strokeWidth={3}
        />
        <circle cx={X(pivX)} cy={Y(pivY)} r={5} fill={C.swingarm} />
        {(() => {
          const midX = (pivX + rearAxleX_mm) / 2;
          const midY = (pivY + rearAxleY_mm) / 2;
          const angle = Math.atan2(Y(rearAxleY_mm) - Y(pivY), X(rearAxleX_mm) - X(pivX)) * 180 / Math.PI;
          return (
            <text
              x={X(midX)} y={Y(midY) + 14}
              fill={C.swingarm} fontSize={9} fontFamily={font}
              transform={`rotate(${angle}, ${X(midX)}, ${Y(midY) + 14})`}
              textAnchor="middle"
            >
              SWINGARM
            </text>
          );
        })()}
        <CompLabel x={X(pivX)} y={Y(pivY)} text="PIVOT" dx={6} dy={-9} />

        {/* ══════════════════════════════════════════════════════════════════
            NEW OVERLAY LAYERS (additive — no existing elements changed)
            ══════════════════════════════════════════════════════════════════ */}

        {/* ── TRAIL GEOMETRY: steering axis projection to ground ── */}
        {vis.trailGeometry && (
          <>
            {/* Steering axis extended to ground */}
            <line
              x1={X(sa_x2)} y1={Y(sa_y2)}
              x2={X(steerGroundX)} y2={Y(0)}
              stroke={C.trailGeo} strokeWidth={1} strokeDasharray="5 3" strokeOpacity={0.6}
            />
            {/* Ground intersection marker */}
            <circle cx={X(steerGroundX)} cy={Y(0)} r={4}
              fill={C.trailGeo} fillOpacity={0.8} />
            {/* Horizontal trail line from steering-axis-ground to contact patch */}
            <line
              x1={X(steerGroundX)} y1={Y(0) + 8}
              x2={X(frontAxleX_mm)} y2={Y(0) + 8}
              stroke={C.trailGeo} strokeWidth={2} markerEnd="url(#arr-g)"
            />
            <text
              x={X((steerGroundX + frontAxleX_mm) / 2)} y={Y(0) + 22}
              fill={C.trailGeo} fontSize={10} textAnchor="middle" fontFamily={font} fontWeight="bold"
            >
              TRAIL {trail.toFixed(1)} mm
            </text>
            {/* Vertical drop from steering axis to ground marker */}
            <line
              x1={X(steerGroundX)} y1={Y(0)}
              x2={X(steerGroundX)} y2={Y(0) + 5}
              stroke={C.trailGeo} strokeWidth={1.5}
            />
          </>
        )}

        {/* ── CHAIN SYSTEM: sprockets + chain runs ── */}
        {vis.chainSystem && (
          <>
            {/* Drive sprocket (countershaft) circle */}
            <circle
              cx={X(driveSprocketX)} cy={Y(driveSprocketY)}
              r={Math.max(driveSprocketR * scale, 4)}
              fill="none" stroke={C.chainLine} strokeWidth={1.5} strokeOpacity={0.85}
            />
            <circle cx={X(driveSprocketX)} cy={Y(driveSprocketY)} r={3} fill={C.chainLine} />
            {/* Rear sprocket circle */}
            <circle
              cx={X(rearSprocketX)} cy={Y(rearSprocketY)}
              r={Math.max(rearSprocketR * scale, 4)}
              fill="none" stroke={C.chainLine} strokeWidth={1.5} strokeOpacity={0.85}
            />
            {/* Top chain run */}
            <line
              x1={X(chainTopX1)} y1={Y(chainTopY1)}
              x2={X(chainTopX2)} y2={Y(chainTopY2)}
              stroke={C.chainLine} strokeWidth={1.5} strokeOpacity={0.9}
            />
            {/* Bottom chain run */}
            <line
              x1={X(chainBotX1)} y1={Y(chainBotY1)}
              x2={X(chainBotX2)} y2={Y(chainBotY2)}
              stroke={C.chainLine} strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.5}
            />
            {/* Labels */}
            <text
              x={X(driveSprocketX) - 2} y={Y(driveSprocketY) - driveSprocketR * scale - 6}
              fill={C.chainLine} fontSize={8} textAnchor="middle" fontFamily={font}
            >
              {chain.frontSprocket}T
            </text>
            <text
              x={X(rearSprocketX) + rearSprocketR * scale + 5} y={Y(rearSprocketY) - 3}
              fill={C.chainLine} fontSize={8} textAnchor="start" fontFamily={font}
            >
              {chain.rearSprocket}T
            </text>
          </>
        )}

        {/* ── FORCE LINE: from rear contact patch along chain pull direction ── */}
        {vis.forceLine && (
          <>
            <line
              x1={X(rearContactX)} y1={Y(rearContactY)}
              x2={X(forceLine_x2)} y2={Y(forceLine_y2)}
              stroke={C.forceLine} strokeWidth={1.5} strokeDasharray="8 4"
              markerEnd="url(#arr-r)" strokeOpacity={0.85}
            />
            <text
              x={X((rearContactX + forceLine_x2) / 2) + 4}
              y={Y((rearContactY + forceLine_y2) / 2) - 6}
              fill={C.forceLine} fontSize={8} fontFamily={font} fillOpacity={0.85}
            >
              CHAIN FORCE
            </text>
          </>
        )}

        {/* ── ANTI-SQUAT LINE: rear contact → CoG → extended (load transfer) ── */}
        {vis.antiSquatLine && (
          <>
            <line
              x1={X(rearContactX)} y1={Y(rearContactY)}
              x2={X(asLine_x2)}    y2={Y(asLine_y2)}
              stroke={C.asLine} strokeWidth={1.2} strokeDasharray="6 3"
              markerEnd="url(#arr-y)" strokeOpacity={0.75}
            />
            <text
              x={X(rearContactX + asDx * 0.35) - 4}
              y={Y(rearContactY + asDy * 0.35) - 7}
              fill={C.asLine} fontSize={8} fontFamily={font} fillOpacity={0.85}
            >
              LOAD TRANSFER
            </text>
          </>
        )}

        {/* ══ END NEW OVERLAY LAYERS ══ */}

        {/* ── TRAIL ARROW (original — kept unchanged) ── */}
        <line
          x1={X(groundContactX)} y1={Y(0) + 14}
          x2={X(frontAxleX_mm)}  y2={Y(0) + 14}
          stroke={C.trail} strokeWidth={1.5} markerEnd="url(#arr-g)"
        />
        <text
          x={X((groundContactX + frontAxleX_mm) / 2)} y={Y(0) + 27}
          fill={C.trail} fontSize={11} textAnchor="middle" fontFamily={font}
        >
          trail {trail.toFixed(1)} mm
        </text>

        {/* ── WHEELBASE DIM ── */}
        <line
          x1={X(0)} y1={Y(0) - 20}
          x2={X(WB)} y2={Y(0) - 20}
          stroke={C.dim} strokeWidth={1} markerEnd="url(#arr-m)"
        />
        <text
          x={X(WB / 2)} y={Y(0) - 24}
          fill={C.dim} fontSize={10} textAnchor="middle" fontFamily={font}
        >
          WB {WB} mm
        </text>

        {/* ── MASS COMPONENT DOTS + LABELS ── */}
        {components.map((c, i) => {
          const r = Math.sqrt(c.mass) * 1.5;
          const cx = X(c.x);
          const cy = Y(c.y);
          // offset label alternately up/down to reduce overlap
          const labelDy = i % 2 === 0 ? -r - 5 : r + 12;
          return (
            <g key={i}>
              <circle
                cx={cx} cy={cy} r={r}
                fill={C.massDot} fillOpacity={0.2}
                stroke={C.massDot} strokeWidth={1}
              />
              <text
                x={cx} y={cy + labelDy}
                fill={C.massDot} fontSize={8.5} textAnchor="middle"
                fontFamily={font} fillOpacity={0.85}
              >
                {c.label}
              </text>
              <text
                x={cx} y={cy + labelDy + 10}
                fill={C.muted} fontSize={7.5} textAnchor="middle"
                fontFamily={font}
              >
                {c.mass} kg
              </text>
            </g>
          );
        })}

        {/* ── CoG CROSSHAIR ── */}
        <circle cx={X(cogX)} cy={Y(cogY)} r={9}
          fill="none" stroke={C.cog} strokeWidth={2} />
        <line
          x1={X(cogX) - 13} y1={Y(cogY)}
          x2={X(cogX) + 13} y2={Y(cogY)}
          stroke={C.cog} strokeWidth={1.5}
        />
        <line
          x1={X(cogX)} y1={Y(cogY) - 13}
          x2={X(cogX)} y2={Y(cogY) + 13}
          stroke={C.cog} strokeWidth={1.5}
        />
        <text x={X(cogX) + 13} y={Y(cogY) - 11} fill={C.cog} fontSize={10} fontFamily={font} fontWeight="bold">
          CoG
        </text>
        <text x={X(cogX) + 13} y={Y(cogY) + 2} fill={C.muted} fontSize={8} fontFamily={font}>
          ({cogX.toFixed(0)}, {cogY.toFixed(0)}) mm
        </text>

        {/* ── INSTANT CENTRE ── */}
        {IC_x_abs > -800 && IC_x_abs < 3500 && IC_y_abs > -300 && IC_y_abs < 2500 && (
          <>
            <circle cx={X(IC_x_abs)} cy={Y(IC_y_abs)} r={5}
              fill="none" stroke={C.ic} strokeWidth={1.5} />
            <text x={X(IC_x_abs) + 7} y={Y(IC_y_abs) - 2} fill={C.ic} fontSize={9} fontFamily={font}>
              INSTANT CENTRE
            </text>
            <line
              x1={X(IC_x_abs)} y1={Y(IC_y_abs)}
              x2={X(rearAxleX_mm)} y2={Y(0)}
              stroke={C.ic} strokeWidth={0.8} strokeDasharray="6 3" strokeOpacity={0.5}
            />
          </>
        )}

        {/* ── ERGONOMICS TRIANGLE ── */}
        {(() => {
          const e = input.ergo;
          return (
            <>
              <polygon
                points={`${X(e.handlebarX)},${Y(e.handlebarY)} ${X(e.seatX)},${Y(e.seatY)} ${X(e.footpegX)},${Y(e.footpegY)}`}
                fill={C.ergo} fillOpacity={0.07}
                stroke={C.ergo} strokeWidth={1} strokeDasharray="5 3"
              />
              {/* vertex labels */}
              <text x={X(e.handlebarX) - 4} y={Y(e.handlebarY) - 8} fill={C.ergo} fontSize={8.5} fontFamily={font} textAnchor="middle">HANDLEBAR</text>
              <text x={X(e.seatX)} y={Y(e.seatY) - 8} fill={C.ergo} fontSize={8.5} fontFamily={font} textAnchor="middle">SEAT</text>
              <text x={X(e.footpegX)} y={Y(e.footpegY) + 14} fill={C.ergo} fontSize={8.5} fontFamily={font} textAnchor="middle">FOOTPEG</text>
            </>
          );
        })()}

        {/* ── AXIS LABELS ── */}
        <text x={X(frontAxleX_mm) + R_f * scale + 6} y={Y(frontAxleY_mm) + 4}
          fill={C.muted} fontSize={9} fontFamily={font}>F.AXLE</text>
        <text x={X(rearAxleX_mm) + R_r * scale + 4} y={Y(rearAxleY_mm) + 4}
          fill={C.muted} fontSize={9} fontFamily={font}>R.AXLE</text>

        {/* ── SEAT HEIGHT ── */}
        <line
          x1={X(WB * 0.6)} y1={Y(0)}
          x2={X(WB * 0.6)} y2={Y(geo.seatHeight)}
          stroke={C.frame} strokeWidth={1} strokeDasharray="3 3"
        />
        <text
          x={X(WB * 0.6) + 4} y={Y(geo.seatHeight / 2)}
          fill={C.muted} fontSize={9} fontFamily={font}
        >
          {geo.seatHeight} mm seat
        </text>

        {/* ── HEAD ANGLE LABEL ── */}
        <text
          x={X(ht_bx) - 32} y={Y(ht_by) + 20}
          fill={C.headTube} fontSize={10} fontFamily={font} fontWeight="bold"
        >
          {geo.headAngle}°
        </text>

        {/* ── SCALE BAR ── */}
        <line x1={w - scaleBar - 14} y1={h - 12} x2={w - 14} y2={h - 12}
          stroke={C.muted} strokeWidth={1.5} />
        <line x1={w - scaleBar - 14} y1={h - 16} x2={w - scaleBar - 14} y2={h - 8}
          stroke={C.muted} strokeWidth={1} />
        <line x1={w - 14} y1={h - 16} x2={w - 14} y2={h - 8}
          stroke={C.muted} strokeWidth={1} />
        <text x={w - scaleBar / 2 - 14} y={h - 2}
          fill={C.muted} fontSize={9} textAnchor="middle" fontFamily={font}>200 mm</text>
      </svg>

      {/* ── 2D overlay toggle buttons (top-left corner) ── */}
      <OverlayToggles />
    </div>
  );
}
