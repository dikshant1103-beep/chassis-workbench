/**
 * PhysicsGeometryDiagram.tsx — Full Physics Geometry Diagram (shared)
 *
 * Renders a complete interactive motorcycle chassis diagram showing:
 *   1. Swingarm line (blue)         — extended in both directions
 *   2. Chain force line (orange)    — external tangent direction, extended
 *   3. Instant Centre / Point A     — intersection of swingarm + chain force lines
 *   4. Anti-squat line (blue dash)  — from rear contact patch Pr through IC
 *   5. Load-transfer line (red)     — from Pr through CoG
 *   6. Fork tubes (blue)            — steering geometry
 *   7. Fork axis extension (green)  — used for anti-dive % geometry
 *
 * COORDINATE SYSTEM (inside this component):
 *   Origin = swingarm pivot (0, 0)
 *   +X forward (toward front wheel)  → LEFT on screen
 *   +Y upward                        → UP on screen
 *
 * Input analysis uses OLD coords (origin = front contact patch, +X rearward).
 * tp() converts old → pivot-centred physics.
 *
 * Zoom: mouse wheel.  Pan: pointer drag.
 */

import { useRef, useState, useCallback } from 'react';
import { computeSquatAnalysis } from '../../engine/antiSquatAnalysis';

const RAD = Math.PI / 180;

interface Props {
  /** Output of computeSquatAnalysis() — drives ALL geometry */
  analysis: ReturnType<typeof computeSquatAnalysis>;
  /** Front wheel radius (mm) */
  frontWheelRadius: number;
  /** Head (rake) angle from vertical (degrees) */
  headAngle_deg: number;
  /** Fork offset / trail offset (mm) */
  forkOffset_mm: number;
  /** If provided, annotate the anti-dive % on the diagram */
  adPercent?: number;
}

export default function PhysicsGeometryDiagram({
  analysis, frontWheelRadius, headAngle_deg, forkOffset_mm, adPercent,
}: Props) {
  const { staticPoint: st, swingarmPivot: spOld, rearAxleStatic: raOld, cog: cogOld } = analysis;

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  const SVG_W = 820, SVG_H = 360;
  const svgRef   = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SVG_W, h: SVG_H });
  const panning  = useRef(false);
  const panStart = useRef({ mx: 0, my: 0, vbx: 0, vby: 0 });

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fac = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    setVb(v => {
      const cx = v.x + (e.clientX - rect.left) / rect.width  * v.w;
      const cy = v.y + (e.clientY - rect.top)  / rect.height * v.h;
      return { x: cx - (cx - v.x) * fac, y: cy - (cy - v.y) * fac, w: v.w * fac, h: v.h * fac };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    panning.current = true;
    panStart.current = { mx: e.clientX, my: e.clientY, vbx: vb.x, vby: vb.y };
    svgRef.current?.setPointerCapture(e.pointerId);
  }, [vb.x, vb.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!panning.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (e.clientX - panStart.current.mx) / rect.width  * vb.w;
    const dy = (e.clientY - panStart.current.my) / rect.height * vb.h;
    setVb(v => ({ ...v, x: panStart.current.vbx - dx, y: panStart.current.vby - dy }));
  }, [vb.w, vb.h]);

  const onPointerUp   = useCallback(() => { panning.current = false; }, []);
  const resetView     = useCallback(() => setVb({ x: 0, y: 0, w: SVG_W, h: SVG_H }), []);
  const zoomIn        = useCallback(() => setVb(v => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    return { x: cx - v.w * 0.5 / 1.25, y: cy - v.h * 0.5 / 1.25, w: v.w / 1.25, h: v.h / 1.25 };
  }), []);
  const zoomOut       = useCallback(() => setVb(v => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    return { x: cx - v.w * 0.5 * 1.25, y: cy - v.h * 0.5 * 1.25, w: v.w * 1.25, h: v.h * 1.25 };
  }), []);

  const btnSt: React.CSSProperties = {
    background: '#21262d', border: '1px solid #30363d', borderRadius: 5,
    color: '#8b949e', cursor: 'pointer', padding: '2px 8px', fontSize: 13, lineHeight: '18px', userSelect: 'none',
  };

  // ── Coordinate transform: OLD → pivot-centred physics ──────────────────────
  const X_sp = spOld[0], H_sp = spOld[1];
  function tp(ox: number, oy: number): [number, number] { return [X_sp - ox, oy - H_sp]; }

  // ── Key points in physics frame ────────────────────────────────────────────
  const PIVOT:        [number,number] = [0, 0];
  const REAR_AXLE     = tp(raOld[0], raOld[1]);
  const FRONT_AXLE:   [number,number] = [X_sp, frontWheelRadius - H_sp];
  const FRONT_CONTACT: [number,number] = [X_sp, -H_sp];         // front contact patch
  const REAR_CONTACT  = tp(st.rearContactPatch[0], st.rearContactPatch[1]);
  const COG           = tp(cogOld[0], cogOld[1]);
  const DS            = tp(st.driveSprocket[0], st.driveSprocket[1]);
  const GROUND_Y      = -H_sp;
  const R_r = raOld[1];   // rear wheel radius (= rear axle height on flat ground)
  const R_f = frontWheelRadius;

  // ── Chain tangent (external tangent top run) ───────────────────────────────
  const r_dr = st.driveSprocketRadius, r_rr = st.rearSprocketRadius;
  const cDx = DS[0] - REAR_AXLE[0], cDy = DS[1] - REAR_AXLE[1];
  const cD  = Math.sqrt(cDx * cDx + cDy * cDy) || 1;
  const baseAngle = Math.atan2(cDy, cDx);
  const sinAlpha  = Math.max(-1, Math.min(1, (r_rr - r_dr) / cD));
  const tangAngle = baseAngle + Math.asin(sinAlpha);
  const tn_x = -Math.sin(tangAngle), tn_y = Math.cos(tangAngle);

  const CHAIN_TOP_DS: [number,number] = [DS[0]        + tn_x * r_dr, DS[1]        + tn_y * r_dr];
  const CHAIN_TOP_RS: [number,number] = [REAR_AXLE[0] + tn_x * r_rr, REAR_AXLE[1] + tn_y * r_rr];
  const CHAIN_BOT_DS: [number,number] = [DS[0]        - tn_x * r_dr, DS[1]        - tn_y * r_dr];
  const CHAIN_BOT_RS: [number,number] = [REAR_AXLE[0] - tn_x * r_rr, REAR_AXLE[1] - tn_y * r_rr];

  // ── IC / Point A ──────────────────────────────────────────────────────────
  const IC: [number,number] | null = st.pointA ? tp(st.pointA[0], st.pointA[1]) : null;

  // ── IC validation ─────────────────────────────────────────────────────────
  let icValid = false, icErrMsg = '';
  if (IC) {
    const cross    = IC[0] * REAR_AXLE[1] - IC[1] * REAR_AXLE[0];
    const sa_len   = Math.sqrt(REAR_AXLE[0]**2 + REAR_AXLE[1]**2) || 1;
    const distLine = Math.abs(cross) / sa_len;
    icValid  = distLine < 5;
    if (!icValid) icErrMsg = `⚠ IC off SA axis ${distLine.toFixed(1)} mm`;
  }

  // ── Fork / steering geometry ──────────────────────────────────────────────
  const A    = headAngle_deg * RAD;
  const sinA = Math.sin(A), cosA = Math.cos(A);

  // Head tube attachment point (where fork axis crosses fork-offset plane)
  // FA = front axle in physics frame; HT = FA − forkOffset·(cosA, sinA)
  const HT: [number,number] = [
    FRONT_AXLE[0] - forkOffset_mm * cosA,
    FRONT_AXLE[1] - forkOffset_mm * sinA,
  ];

  // Steering axis extends upward from HT in direction (−sinA, cosA)
  const SA_TOP: [number,number] = [HT[0] - sinA * 400, HT[1] + cosA * 400];

  // Fork axis extension downward — direction (sinA, −cosA), extends past ground
  // Ground intercept (y = GROUND_Y):  HT[1] − cosA·t = GROUND_Y  →  t = (HT[1] − GROUND_Y)/cosA
  const t_gnd  = cosA > 1e-9 ? (HT[1] - GROUND_Y) / cosA : 0;
  const FORK_GND: [number,number] = [HT[0] + sinA * t_gnd, GROUND_Y];

  // Fork axis intercept at rear axle vertical (x = REAR_AXLE[0])
  // Line: x = HT[0] + sinA·t, y = HT[1] − cosA·t  (t > 0 going downward)
  const t_ra = sinA > 1e-9 ? (REAR_AXLE[0] - HT[0]) / sinA : 0;
  const FORK_AT_RA_Y = HT[1] - cosA * t_ra;

  // Load-transfer height at rear axle vertical (for AD% annotation)
  const lt_dx = COG[0] - REAR_CONTACT[0];
  const lt_dy = COG[1] - REAR_CONTACT[1];
  const t_lt  = lt_dx !== 0 ? (REAR_AXLE[0] - REAR_CONTACT[0]) / lt_dx : 0;
  const LT_AT_RA_Y = REAR_CONTACT[1] + t_lt * lt_dy;

  // Head tube body (lower segment of steering axis, 80mm)
  const HT_BOT: [number,number] = [HT[0] + sinA * 30, HT[1] - cosA * 30];
  const HT_TOP: [number,number] = [HT[0] - sinA * 80, HT[1] + cosA * 80];

  // Fork tube endpoints (two tubes, ±5mm offset perpendicular to axis)
  const FORK_LOWER = t_gnd; // distance from HT down to ground
  const TUBE_OFFSETS = [-5, 5];
  const forkTubes = TUBE_OFFSETS.map(off => ({
    top: [HT[0] - sinA * 60 + cosA * off, HT[1] + cosA * 60 + sinA * off] as [number,number],
    bot: [FRONT_AXLE[0] + cosA * off, FRONT_AXLE[1] + sinA * off] as [number,number],
    // lower extension to ground
    ext: [HT[0] + sinA * (FORK_LOWER + 10) + cosA * off, GROUND_Y + sinA * off] as [number,number],
  }));

  // ── Debug angles ───────────────────────────────────────────────────────────
  const sa_angle_deg  = Math.atan2(REAR_AXLE[1], REAR_AXLE[0]) * 180 / Math.PI;
  const cf_angle_deg  = tangAngle * 180 / Math.PI;
  const sigma_vis_deg = IC ? Math.atan2(IC[1] - REAR_CONTACT[1], IC[0] - REAR_CONTACT[0]) * 180 / Math.PI : NaN;
  const tau_vis_deg   = Math.atan2(COG[1] - REAR_CONTACT[1], COG[0] - REAR_CONTACT[0]) * 180 / Math.PI;

  // ── Auto viewport bounds ───────────────────────────────────────────────────
  // IC is valid/in-view when it lies roughly within the wheelbase (with margin).
  // Old check used FRONT_CONTACT[0] which put the range far from where the IC actually is.
  const icInView = IC && isFinite(IC[0]) && isFinite(IC[1]) &&
    IC[0] > REAR_AXLE[0] - 400 && IC[0] < FRONT_AXLE[0] + 400;
  const pts: [number,number][] = [
    PIVOT, REAR_AXLE, FRONT_AXLE, FRONT_CONTACT, REAR_CONTACT, COG, DS,
    CHAIN_TOP_DS, CHAIN_TOP_RS, SA_TOP,
    ...(icInView && IC ? [IC] : []),
  ];
  const pxArr = pts.map(p => p[0]), pyArr = pts.map(p => p[1]);
  const pad = 120;
  const pxMin = Math.min(...pxArr) - pad, pxMax = Math.max(...pxArr) + pad;
  const pyMin = Math.min(...pyArr, GROUND_Y) - 60, pyMax = Math.max(...pyArr) + pad;
  const sc = Math.min(SVG_W / (pxMax - pxMin), SVG_H / (pyMax - pyMin)) * 0.86;
  // Flip X so front wheel (positive physics-X) renders on the LEFT, rear on the RIGHT
  const ox = SVG_W / 2 + ((pxMin + pxMax) / 2) * sc;
  const oy = SVG_H / 2 + ((pyMin + pyMax) / 2) * sc;

  function sx(px: number) { return -px * sc + ox; }
  function sy(py: number) { return -py * sc + oy; }

  function extLine(p1: [number,number], p2: [number,number], fBack = 0.1, fFwd = 0.5): [[number,number],[number,number]] {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    return [[p1[0] - dx * fBack, p1[1] - dy * fBack], [p2[0] + dx * fFwd, p2[1] + dy * fFwd]];
  }

  const saExt  = extLine(PIVOT, REAR_AXLE, 0.05, 0.15);
  const sqExt  = IC ? extLine(REAR_CONTACT, IC, 0.05, 1.4) : null;
  const ltExt  = extLine(REAR_CONTACT, COG, 0.05, 1.1);
  const dsr_px = Math.max(r_dr * sc, 5), rsr_px = Math.max(r_rr * sc, 8);

  const fmt1 = (v: number) => isFinite(v) ? v.toFixed(1) : '—';
  const fmt2 = (v: number) => isFinite(v) ? v.toFixed(2) : '—';

  return (
    <div style={{ position: 'relative' }}>
      {/* Controls */}
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', gap: 4 }}>
        <button style={btnSt} onClick={zoomIn}>＋</button>
        <button style={btnSt} onClick={zoomOut}>－</button>
        <button style={btnSt} onClick={resetView}>⟲</button>
      </div>
      <div style={{ fontSize: 8, color: '#484f58', position: 'absolute', bottom: 6, right: 6 }}>
        scroll to zoom · drag to pan
      </div>

      <svg ref={svgRef} width="100%"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ background: '#0d1117', borderRadius: 8, border: '1px solid #21262d', cursor: 'grab', display: 'block' }}
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      >
        <defs>
          <marker id="pgd-sq"  markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#79c0ff" /></marker>
          <marker id="pgd-lt"  markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#f85149" /></marker>
          <marker id="pgd-cf"  markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#ff9933" /></marker>
          <marker id="pgd-fk"  markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#3fb950" /></marker>
        </defs>

        {/* ── Ground ── */}
        <line x1={0} y1={sy(GROUND_Y)} x2={SVG_W} y2={sy(GROUND_Y)} stroke="#30363d" strokeWidth="1.5" />
        <line x1={0} y1={sy(GROUND_Y) + 1} x2={SVG_W} y2={sy(GROUND_Y) + 1} stroke="#21262d" strokeWidth="4" />

        {/* ── Coord axis ── */}
        <g transform={`translate(${sx(0)},${sy(0)})`}>
          {/* +X forward → LEFT on screen after the X-flip */}
          <line x1={0} y1={0} x2={-28} y2={0} stroke="#484f58" strokeWidth="1" markerEnd="url(#pgd-sq)" />
          <line x1={0} y1={0} x2={0}   y2={-22} stroke="#484f58" strokeWidth="1" />
          <text x={-65} y={4}  fill="#484f58" fontSize={7} fontFamily="Consolas,monospace">+X fwd</text>
          <text x={3}   y={-24} fill="#484f58" fontSize={7} fontFamily="Consolas,monospace">+Y up</text>
        </g>

        {/* ── Rear axle vertical reference (for AD% annotation) ── */}
        <line x1={sx(REAR_AXLE[0])} y1={sy(GROUND_Y - 20)}
              x2={sx(REAR_AXLE[0])} y2={sy(Math.max(FORK_AT_RA_Y, LT_AT_RA_Y) + 80)}
          stroke="#21262d" strokeWidth="1" strokeDasharray="3,3" />
        <text x={sx(REAR_AXLE[0]) + 4} y={sy(GROUND_Y) + 12}
          fill="#484f58" fontSize={7} fontFamily="Consolas,monospace">RA vertical</text>

        {/* ── Wheels ── */}
        <circle cx={sx(FRONT_AXLE[0])} cy={sy(FRONT_AXLE[1])} r={R_f * sc} fill="none" stroke="#21262d" strokeWidth="10" />
        <circle cx={sx(FRONT_AXLE[0])} cy={sy(FRONT_AXLE[1])} r={R_f * sc} fill="none" stroke="#484f58" strokeWidth="1.5" />
        <circle cx={sx(REAR_AXLE[0])}  cy={sy(REAR_AXLE[1])}  r={R_r * sc} fill="none" stroke="#484f58" strokeWidth="1.5" />

        {/* ── Rear sprocket → contact patch ── */}
        <line x1={sx(REAR_AXLE[0])} y1={sy(REAR_AXLE[1])} x2={sx(REAR_CONTACT[0])} y2={sy(REAR_CONTACT[1])}
          stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4 3" opacity={0.7} />

        {/* ════════════════════════════════════════════════════════════════
            LINE 1: SWINGARM AXIS (ghost extension behind + in front)
            ════════════════════════════════════════════════════════════════ */}
        <line x1={sx(saExt[0][0])} y1={sy(saExt[0][1])} x2={sx(saExt[1][0])} y2={sy(saExt[1][1])}
          stroke="#1a3a5c" strokeWidth="1" strokeDasharray="5 4" />

        {/* ════════════════════════════════════════════════════════════════
            LINE 2: CHAIN FORCE LINE (external tangent direction, extended)
            Anchored at CHAIN_BOT_DS / CHAIN_BOT_RS — the upper-run tangent
            contact points — NOT through the sprocket centres.
            ════════════════════════════════════════════════════════════════ */}
        <line
          x1={sx(CHAIN_BOT_DS[0] - Math.cos(tangAngle) * 300)} y1={sy(CHAIN_BOT_DS[1] - Math.sin(tangAngle) * 300)}
          x2={sx(CHAIN_BOT_RS[0] + Math.cos(tangAngle) * 400)} y2={sy(CHAIN_BOT_RS[1] + Math.sin(tangAngle) * 400)}
          stroke="#ff9933" strokeWidth="1.8" strokeDasharray="10 4" markerEnd="url(#pgd-cf)" />

        {/* ════════════════════════════════════════════════════════════════
            LINE 4: ANTI-SQUAT LINE (Pr → IC, extended to front axle)
            ════════════════════════════════════════════════════════════════ */}
        {sqExt && (
          <line x1={sx(sqExt[0][0])} y1={sy(sqExt[0][1])} x2={sx(sqExt[1][0])} y2={sy(sqExt[1][1])}
            stroke="#79c0ff" strokeWidth="1.8" strokeDasharray="8 4" markerEnd="url(#pgd-sq)" />
        )}

        {/* ── Load-transfer line (Pr → CoG, extended) ── */}
        <line x1={sx(ltExt[0][0])} y1={sy(ltExt[0][1])} x2={sx(ltExt[1][0])} y2={sy(ltExt[1][1])}
          stroke="#f85149" strokeWidth="1.5" strokeDasharray="6 3" markerEnd="url(#pgd-lt)" />

        {/* ════════════════════════════════════════════════════════════════
            SWINGARM (solid)
            ════════════════════════════════════════════════════════════════ */}
        <line x1={sx(PIVOT[0])} y1={sy(PIVOT[1])} x2={sx(REAR_AXLE[0])} y2={sy(REAR_AXLE[1])}
          stroke="#58a6ff" strokeWidth="3.5" />

        {/* CHAIN_BOT = physical tension/drive run (top of chain).
            cd_nx points downward in physics → BOT tangent points land ABOVE sprocket centres.
            This is the line used for IC construction. */}
        <line x1={sx(CHAIN_BOT_DS[0])} y1={sy(CHAIN_BOT_DS[1])} x2={sx(CHAIN_BOT_RS[0])} y2={sy(CHAIN_BOT_RS[1])}
          stroke="#3fb950" strokeWidth="2.5" />
        <text
          x={(sx(CHAIN_BOT_DS[0]) + sx(CHAIN_BOT_RS[0])) / 2}
          y={(sy(CHAIN_BOT_DS[1]) + sy(CHAIN_BOT_RS[1])) / 2 - 6}
          fill="#3fb950" fontSize={7} textAnchor="middle" fontFamily="Consolas,monospace">
          CHAIN FORCE LINE
        </text>
        {/* CHAIN_TOP = physical slack/return run — same weight as tension run */}
        <line x1={sx(CHAIN_TOP_DS[0])} y1={sy(CHAIN_TOP_DS[1])} x2={sx(CHAIN_TOP_RS[0])} y2={sy(CHAIN_TOP_RS[1])}
          stroke="#3fb950" strokeWidth="2.5" />

        {/* ── Drive sprocket (countershaft) ── */}
        <circle cx={sx(DS[0])} cy={sy(DS[1])} r={dsr_px} fill="#0d2a1a" stroke="#3fb950" strokeWidth="2" />
        <circle cx={sx(DS[0])} cy={sy(DS[1])} r={Math.max(dsr_px * 0.35, 2)} fill="#3fb950" />
        <text x={sx(DS[0])} y={sy(DS[1]) - dsr_px - 4}
          fill="#3fb950" fontSize={7} textAnchor="middle" fontFamily="Consolas,monospace">
          {r_dr > 0 ? `⌀${Math.round(r_dr * 2)} mm` : ''}
        </text>

        {/* ── Rear sprocket ── */}
        <circle cx={sx(REAR_AXLE[0])} cy={sy(REAR_AXLE[1])} r={rsr_px} fill="#0d2a1a" stroke="#3fb950" strokeWidth="2" />
        <circle cx={sx(REAR_AXLE[0])} cy={sy(REAR_AXLE[1])} r={Math.max(rsr_px * 0.35, 2)} fill="#3fb950" />

        {/* ════════════════════════════════════════════════════════════════
            FORK GEOMETRY
            ════════════════════════════════════════════════════════════════ */}

        {/* Fork axis extension (green) — from HT downward past ground */}
        <line x1={sx(HT[0] - sinA * 60)} y1={sy(HT[1] + cosA * 60)}
              x2={sx(FORK_GND[0])}         y2={sy(FORK_GND[1])}
          stroke="#3fb950" strokeWidth="1.5" strokeDasharray="8 3" markerEnd="url(#pgd-fk)" />

        {/* Fork tubes (two parallel lines) */}
        {forkTubes.map((tube, i) => (
          <line key={i}
            x1={sx(tube.top[0])} y1={sy(tube.top[1])}
            x2={sx(tube.bot[0])} y2={sy(tube.bot[1])}
            stroke="#58a6ff" strokeWidth="2.2" strokeLinecap="round" />
        ))}

        {/* Head tube (thicker segment along steering axis) */}
        <line x1={sx(HT_BOT[0])} y1={sy(HT_BOT[1])} x2={sx(HT_TOP[0])} y2={sy(HT_TOP[1])}
          stroke="#58a6ff" strokeWidth="5" strokeLinecap="round" />

        {/* Steering axis extension (thin, ghost) */}
        <line x1={sx(HT_BOT[0] + sinA * 20)} y1={sy(HT_BOT[1] - cosA * 20)}
              x2={sx(SA_TOP[0])} y2={sy(SA_TOP[1])}
          stroke="#1a3a5c" strokeWidth="1" strokeDasharray="4 3" />

        {/* ── Fork axis intercept at rear axle vertical (AD% geometry) ── */}
        {isFinite(FORK_AT_RA_Y) && FORK_AT_RA_Y > GROUND_Y - 20 && FORK_AT_RA_Y < (cogOld[1] + 400) && (
          <>
            <line x1={sx(REAR_AXLE[0]) - 6} y1={sy(FORK_AT_RA_Y)}
                  x2={sx(REAR_AXLE[0]) + 6} y2={sy(FORK_AT_RA_Y)}
              stroke="#3fb950" strokeWidth="2" />
            <line x1={sx(REAR_AXLE[0])} y1={sy(GROUND_Y)}
                  x2={sx(REAR_AXLE[0])} y2={sy(FORK_AT_RA_Y)}
              stroke="#3fb950" strokeWidth="0.8" strokeDasharray="2,2" opacity={0.5} />
            <text x={sx(REAR_AXLE[0]) + 8} y={sy(FORK_AT_RA_Y) - 3}
              fill="#3fb950" fontSize={8} fontFamily="Consolas,monospace">
              {`h_fork=${FORK_AT_RA_Y.toFixed(0)}`}
            </text>
          </>
        )}
        {isFinite(LT_AT_RA_Y) && LT_AT_RA_Y > GROUND_Y && (
          <>
            <line x1={sx(REAR_AXLE[0]) - 6} y1={sy(LT_AT_RA_Y)}
                  x2={sx(REAR_AXLE[0]) + 6} y2={sy(LT_AT_RA_Y)}
              stroke="#f85149" strokeWidth="2" />
            <text x={sx(REAR_AXLE[0]) + 8} y={sy(LT_AT_RA_Y) + 11}
              fill="#f85149" fontSize={8} fontFamily="Consolas,monospace">
              {`h_LT=${LT_AT_RA_Y.toFixed(0)}`}
            </text>
          </>
        )}

        {/* AD% annotation box */}
        {adPercent !== undefined && (
          <g transform={`translate(${sx(REAR_AXLE[0]) + 16}, ${sy((FORK_AT_RA_Y + LT_AT_RA_Y) / 2) - 14})`}>
            <rect x={0} y={0} width={78} height={28} fill="#0d1117" rx={3} stroke="#3fb950" strokeWidth="1" opacity={0.9} />
            <text x={39} y={12} fill="#484f58" fontSize={7} textAnchor="middle" fontFamily="Consolas,monospace">AD%</text>
            <text x={39} y={24} fontSize={12} fontWeight={700} textAnchor="middle"
              fill={adPercent > 30 ? '#3fb950' : adPercent > 15 ? '#e3b341' : '#6e7681'}
              fontFamily="Consolas,monospace">{adPercent.toFixed(1)}%</text>
          </g>
        )}

        {/* ── SA Pivot ── */}
        <circle cx={sx(0)} cy={sy(0)} r={7} fill="#58a6ff" stroke="#0d1117" strokeWidth="1.5" />
        <text x={sx(0) + 10} y={sy(0) + 4} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">SA pivot</text>

        {/* ── Rear axle dot ── */}
        <circle cx={sx(REAR_AXLE[0])} cy={sy(REAR_AXLE[1])} r={4} fill="#58a6ff" />

        {/* ── Rear contact patch Pr ── */}
        <circle cx={sx(REAR_CONTACT[0])} cy={sy(REAR_CONTACT[1])} r={5} fill="#e3b341" stroke="#f0e68c" strokeWidth="1" />
        <text x={sx(REAR_CONTACT[0]) + 10} y={sy(REAR_CONTACT[1]) - 6}
          fill="#e3b341" fontSize={10} fontFamily="Consolas,monospace" fontWeight="bold">Pr</text>

        {/* ── Front axle dot ── */}
        <circle cx={sx(FRONT_AXLE[0])} cy={sy(FRONT_AXLE[1])} r={3} fill="#6e7681" />

        {/* ── CoG ── */}
        <line x1={sx(COG[0]) - 10} y1={sy(COG[1])} x2={sx(COG[0]) + 10} y2={sy(COG[1])} stroke="#f85149" strokeWidth="2" />
        <line x1={sx(COG[0])} y1={sy(COG[1]) - 10} x2={sx(COG[0])} y2={sy(COG[1]) + 10} stroke="#f85149" strokeWidth="2" />
        <circle cx={sx(COG[0])} cy={sy(COG[1])} r={4} fill="#f85149" fillOpacity={0.4} />
        <text x={sx(COG[0]) + 12} y={sy(COG[1]) - 6}
          fill="#f85149" fontSize={9} fontFamily="Consolas,monospace" fontWeight="bold">CG</text>

        {/* ════════════════════════════════════════════════════════════════
            LINE 3: INSTANT CENTRE / POINT A
            ════════════════════════════════════════════════════════════════ */}
        {IC && (
          <>
            <circle cx={sx(IC[0])} cy={sy(IC[1])} r={11}
              fill="#e3b341" fillOpacity={icValid ? 0.25 : 0.1}
              stroke={icValid ? "#e3b341" : "#f85149"} strokeWidth="2.5" />
            <circle cx={sx(IC[0])} cy={sy(IC[1])} r={3} fill="#e3b341" />
            <text x={sx(IC[0]) + 14} y={sy(IC[1]) + 4}
              fill={icValid ? "#e3b341" : "#f85149"} fontSize={10}
              fontFamily="Consolas,monospace" fontWeight="bold">IC / A</text>
            {!icValid && (
              <text x={sx(IC[0]) + 14} y={sy(IC[1]) + 16}
                fill="#f85149" fontSize={7} fontFamily="Consolas,monospace">{icErrMsg}</text>
            )}
          </>
        )}

        {/* ── σ and τ labels near Pr (right of rear contact after X-flip) ── */}
        {!isNaN(sigma_vis_deg) && (
          <text x={sx(REAR_CONTACT[0]) + 8} y={sy(REAR_CONTACT[1]) - 24}
            fill="#79c0ff" fontSize={10} fontFamily="Consolas,monospace">
            σ = {fmt2(sigma_vis_deg)}°
          </text>
        )}
        <text x={sx(REAR_CONTACT[0]) + 8} y={sy(REAR_CONTACT[1]) - 10}
          fill="#f85149" fontSize={10} fontFamily="Consolas,monospace">
          τ = {fmt2(tau_vis_deg)}°
        </text>

        {/* ── Debug info panel ── */}
        <g transform={`translate(${SVG_W - 234}, 8)`}>
          <rect x={0} y={0} width={226} height={152} fill="#0d1117" rx={5} stroke="#21262d" strokeWidth="1" opacity={0.95} />
          <text x={8} y={16} fill="#484f58" fontSize={7} fontFamily="Consolas,monospace" fontWeight="bold">LIVE — pivot frame (pivot = 0,0)</text>
          <text x={8} y={30}  fill="#8b949e" fontSize={7} fontFamily="Consolas,monospace">{`SA angle:   ${fmt2(sa_angle_deg)}° from +X`}</text>
          <text x={8} y={42}  fill="#ff9933" fontSize={7} fontFamily="Consolas,monospace">{`CF angle:   ${fmt2(cf_angle_deg)}° (ext. tangent)`}</text>
          <text x={8} y={54}  fill="#8b949e" fontSize={7} fontFamily="Consolas,monospace">{`DS pos:     (${DS[0].toFixed(0)}, ${DS[1].toFixed(0)}) mm`}</text>
          <text x={8} y={66}  fill="#8b949e" fontSize={7} fontFamily="Consolas,monospace">{`RA pos:     (${REAR_AXLE[0].toFixed(0)}, ${REAR_AXLE[1].toFixed(0)}) mm`}</text>
          <text x={8} y={78}  fill={IC ? "#e3b341" : "#f85149"} fontSize={7} fontFamily="Consolas,monospace">
            {IC ? `IC pos:     (${IC[0].toFixed(0)}, ${IC[1].toFixed(0)}) mm` : 'IC pos:     NONE (parallel)'}
          </text>
          <text x={8} y={90}  fill="#8b949e" fontSize={7} fontFamily="Consolas,monospace">{`CG pos:     (${COG[0].toFixed(0)}, ${COG[1].toFixed(0)}) mm`}</text>
          <text x={8} y={102} fill="#79c0ff" fontSize={7} fontFamily="Consolas,monospace">{`σ (vis):    ${isNaN(sigma_vis_deg) ? '—' : fmt2(sigma_vis_deg)}°`}</text>
          <text x={8} y={114} fill="#f85149" fontSize={7} fontFamily="Consolas,monospace">{`τ (vis):    ${fmt2(tau_vis_deg)}°`}</text>
          <text x={8} y={126} fill="#3fb950"  fontSize={7} fontFamily="Consolas,monospace">{`Rake:       ${fmt1(headAngle_deg)}°  offset: ${fmt1(forkOffset_mm)} mm`}</text>
          <text x={8} y={138} fill={icValid ? "#3fb950" : "#f85149"} fontSize={7} fontFamily="Consolas,monospace">
            {IC ? (icValid ? 'IC valid ✓  (on SA axis)' : icErrMsg) : ''}
          </text>
          {adPercent !== undefined && (
            <text x={8} y={150} fill="#3fb950" fontSize={7} fontFamily="Consolas,monospace">{`AD%:        ${fmt1(adPercent)}%`}</text>
          )}
        </g>

        {/* ── Legend ── */}
        <g transform="translate(8,8)">
          <rect x={0} y={0} width={200} height={151} fill="#0d1117" rx={5} stroke="#21262d" strokeWidth="1" opacity={0.95} />
          <line x1={8} y1={16} x2={24} y2={16} stroke="#58a6ff" strokeWidth="3.5" />
          <text x={28} y={19} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Swingarm</text>
          <line x1={8} y1={29} x2={24} y2={29} stroke="#3fb950" strokeWidth="2.5" />
          <text x={28} y={32} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Chain force line (tension)</text>
          <line x1={8} y1={42} x2={24} y2={42} stroke="#3fb950" strokeWidth="1.5" strokeOpacity="0.7" />
          <text x={28} y={45} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Chain return (slack side)</text>
          <line x1={8} y1={55} x2={24} y2={55} stroke="#ff9933" strokeWidth="1.8" strokeDasharray="5 2" />
          <text x={28} y={58} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Chain force line →IC</text>
          <line x1={8} y1={68} x2={24} y2={68} stroke="#79c0ff" strokeWidth="1.8" strokeDasharray="6 3" />
          <text x={28} y={71} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Anti-squat line Pr→IC (σ)</text>
          <line x1={8} y1={81} x2={24} y2={81} stroke="#f85149" strokeWidth="1.5" strokeDasharray="4 2" />
          <text x={28} y={84} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Load-transfer line (τ)</text>
          <line x1={8} y1={94} x2={24} y2={94} stroke="#3fb950" strokeWidth="1.5" strokeDasharray="6 2" />
          <text x={28} y={97} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Fork axis (AD%)</text>
          <circle cx={14} cy={108} r={4} fill="#e3b341" />
          <text x={28} y={111} fill="#e3b341" fontSize={8} fontFamily="Consolas,monospace">IC / Point A</text>
          <circle cx={14} cy={123} r={4} fill="#e3b341" />
          <text x={28} y={126} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Pr = rear contact patch</text>
          <line x1={8} y1={137} x2={24} y2={137} stroke="#b8956a" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={28} y={140} fill="#8b949e" fontSize={8} fontFamily="Consolas,monospace">Rear axle → Pr</text>
        </g>
      </svg>
    </div>
  );
}
