/**
 * SuspensionDiagram — CAD-style kinematics viewer (v3) for the Suspension Design
 * Studio. PURE VISUALIZATION: every position/length/angle is derived from the
 * existing calculated geometry (Studio input + engine kinematics in formulas.ts)
 * or read read-only from the main store for context overlays. It changes NO
 * physics, calculations, state, or APIs.
 *
 * Features: realistic semi-transparent bike/scooter silhouette; engineering-
 * styled suspension members (swingarm, shock, spring, reservoir, fork tubes,
 * linkage rocker + dog-bone, pivot bearings); live dimensions; scaled force
 * vectors; axle wheel-path; travel animation; motion-ratio HUD; selectable
 * overlays; hover inspector; PNG / SVG / technical-drawing export.
 *
 * Frame: origin = front-wheel ground contact, +x rearward, +y up (mm).
 */
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import {
  StudioInput, StudioResults, FrontSuspension, RearSuspension, Point2,
} from '../../engine/studio/types';
import { motionRatioAtTravel, shockAngleFromVertical } from '../../engine/studio/formulas';
import { linkageStateAtTravel, linkageMotionRatioAtTravel } from '../../engine/studio/linkage';

const DEG = Math.PI / 180;
const VIEW_W = 1040, VIEW_H = 520;
const DISPLAY_H = 440;

// ── Kinematic helpers (pure; mirror engine internal geometry, change nothing) ──
function armAngleAtTravel(pivot: Point2, L: number, angle0Deg: number, u: number): number {
  const y0 = pivot.y + L * Math.sin(angle0Deg * DEG);
  const s = (y0 + u - pivot.y) / L;
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}
function rotateAbout(p: Point2, pivot: Point2, dAngleDeg: number): Point2 {
  const dx = p.x - pivot.x, dy = p.y - pivot.y;
  const c = Math.cos(dAngleDeg * DEG), s = Math.sin(dAngleDeg * DEG);
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}
function add(a: Point2, b: Point2): Point2 { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a: Point2, b: Point2): Point2 { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a: Point2, k: number): Point2 { return { x: a.x * k, y: a.y * k }; }
function len(a: Point2): number { return Math.hypot(a.x, a.y); }
function unit(a: Point2): Point2 { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }

interface RearState { angleDeg: number; axle: Point2; lower: Point2; shockLen: number; }
function rearStateAt(r: RearSuspension, u: number): RearState {
  const angle = armAngleAtTravel(r.swingarmPivot, r.swingarmLength, r.swingarmAngleDeg, u);
  const axle = {
    x: r.swingarmPivot.x + r.swingarmLength * Math.cos(angle * DEG),
    y: r.swingarmPivot.y + r.swingarmLength * Math.sin(angle * DEG),
  };
  const lower = rotateAbout(r.lowerShockMount, r.swingarmPivot, angle - r.swingarmAngleDeg);
  return { angleDeg: angle, axle, lower, shockLen: len(sub(lower, r.upperShockMount)) };
}
interface FrontState { axle: Point2; crown: Point2; lower: Point2; isFork: boolean; }
function frontStateAt(f: FrontSuspension, Rf: number, uf: number): FrontState {
  const isFork = f.type === 'telescopic' || f.type === 'usd';
  if (isFork) {
    const axle0: Point2 = { x: 0, y: Rf };
    const dirCrown = unit({ x: Math.sin(f.rakeDeg * DEG), y: Math.cos(f.rakeDeg * DEG) });
    const crown = add(axle0, mul(dirCrown, f.forkLength));
    const axle = add(axle0, mul(dirCrown, uf)); // compression slides axle toward crown
    return { axle, crown, lower: axle, isFork };
  }
  const angle = armAngleAtTravel(f.linkPivot, f.linkArmLength, f.linkArmAngleDeg, uf);
  const axle = {
    x: f.linkPivot.x + f.linkArmLength * Math.cos(angle * DEG),
    y: f.linkPivot.y + f.linkArmLength * Math.sin(angle * DEG),
  };
  const lower = rotateAbout(f.linkLowerMount, f.linkPivot, angle - f.linkArmAngleDeg);
  return { axle, crown: f.linkUpperMount, lower, isFork };
}

// ── Palettes ──────────────────────────────────────────────────────────────────
type Pal = typeof SCREEN_PAL;
const SCREEN_PAL = {
  bg: 'var(--surface2)', ground: '#484f58', grid: '#30363d',
  silhouette: '#58a6ff', silhouetteFill: 'rgba(88,166,255,0.07)',
  tank: 'rgba(88,166,255,0.10)', engine: 'rgba(110,118,129,0.35)',
  alu1: '#c9d1d9', alu2: '#6e7681', forkOuter: '#58a6ff', forkInner: '#a5d6ff',
  spring: '#f0883e', shockBody: '#3a4250', reservoir: '#8b949e',
  linkage: '#e3b341', bearing: '#ffa657', wheelRim: '#c9d1d9', wheelHub: '#8b949e',
  tyre: '#0d1117', label: '#8b949e', dim: '#7ee787', force: '#ff7b72',
  path: '#d2a8ff', cg: '#ff7b72', ic: '#d2a8ff', chain: '#a5d6ff', text: '#c9d1d9',
};
const DRAW_PAL: Pal = {
  bg: '#ffffff', ground: '#000000', grid: '#dddddd',
  silhouette: '#222222', silhouetteFill: 'rgba(0,0,0,0.04)',
  tank: 'rgba(0,0,0,0.05)', engine: 'rgba(0,0,0,0.10)',
  alu1: '#444444', alu2: '#888888', forkOuter: '#000000', forkInner: '#555555',
  spring: '#000000', shockBody: '#333333', reservoir: '#666666',
  linkage: '#000000', bearing: '#000000', wheelRim: '#000000', wheelHub: '#444444',
  tyre: '#ffffff', label: '#000000', dim: '#000000', force: '#000000',
  path: '#000000', cg: '#000000', ic: '#000000', chain: '#444444', text: '#000000',
};

// ── Overlays ──────────────────────────────────────────────────────────────────
type OverlayKey = 'chassis' | 'suspension' | 'linkage' | 'forces' | 'wheelpath'
  | 'dimensions' | 'chain' | 'cg' | 'ic' | 'packaging';
const OVERLAY_LABELS: { key: OverlayKey; label: string }[] = [
  { key: 'chassis', label: 'Chassis' }, { key: 'suspension', label: 'Suspension' },
  { key: 'linkage', label: 'Linkage' }, { key: 'forces', label: 'Force vectors' },
  { key: 'wheelpath', label: 'Wheel path' }, { key: 'dimensions', label: 'Dimensions' },
  { key: 'chain', label: 'Chain line' }, { key: 'cg', label: 'Center of Gravity' },
  { key: 'ic', label: 'Instant Center' }, { key: 'packaging', label: 'Packaging' },
];

type Handle = 'saPivot' | 'saAxle' | 'rLower' | 'rUpper' | 'fPivot' | 'fAxle' | 'fLower' | 'fUpper';
interface Hover { name: string; rows: [string, string][]; x: number; y: number; }

export default function SuspensionDiagram({ input, results, onFront, onRear }: {
  input: StudioInput;
  results: StudioResults;
  onFront: (p: Partial<FrontSuspension>) => void;
  onRear: (p: Partial<RearSuspension>) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [travel, setTravel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const dirRef = useRef(1);
  const [ov, setOv] = useState<Record<OverlayKey, boolean>>({
    chassis: true, suspension: true, linkage: true, forces: false, wheelpath: true,
    dimensions: true, chain: false, cg: false, ic: false, packaging: false,
  });

  // Read-only store data for context overlays (trail, rake, CoG, IC, chain).
  const sResults = useStore(s => s.results);

  const v = input.vehicle, f = input.front, r = input.rear;
  const Rf = v.frontWheelDia / 2, Rr = v.rearWheelDia / 2;
  const isFork = f.type === 'telescopic' || f.type === 'usd';
  const isScooter = v.category === 'scooter' || r.type === 'unit-swing' || !isFork;
  const PAL = drawing ? DRAW_PAL : SCREEN_PAL;

  const maxTravel = r.wheelTravel;
  const u = travel;                                   // rear bump travel (mm)
  const uf = (travel / Math.max(1, maxTravel)) * f.travel; // proportional front

  // ── States (static + animated) ──
  const rear0 = useMemo(() => rearStateAt(r, 0), [r]);
  const rearU = useMemo(() => rearStateAt(r, u), [r, u]);
  const front0 = useMemo(() => frontStateAt(f, Rf, 0), [f, Rf]);
  const frontU = useMemo(() => frontStateAt(f, Rf, uf), [f, Rf, uf]);

  // Linkage-aware shock geometry: for monoshock-linkage the shock bottom is the
  // ROCKER TIP (Q) and a pushrod runs from the swingarm point S to Q. For all
  // other rear types the shock bottom is the swingarm-fixed lower mount.
  const hasLinkage = r.type === 'monoshock-linkage' && !!r.linkage;
  const linkU = hasLinkage ? linkageStateAtTravel(r, r.linkage!, u) : null;
  const link0 = hasLinkage ? linkageStateAtTravel(r, r.linkage!, 0) : null;
  const shockBottomU = linkU ? linkU.rockerTip : rearU.lower;     // shock lower end
  const pushrodFromU = linkU ? linkU.pushrodFrom : rearU.lower;   // S on swingarm
  const shockLenU = linkU ? linkU.shockLen : rearU.shockLen;
  const shockLen0 = link0 ? link0.shockLen : rear0.shockLen;

  const MRu = hasLinkage
    ? linkageMotionRatioAtTravel(r, r.linkage!, u)
    : motionRatioAtTravel(r.swingarmPivot, r.swingarmLength, r.swingarmAngleDeg, r.lowerShockMount, r.upperShockMount, u);
  const MR0 = hasLinkage
    ? linkageMotionRatioAtTravel(r, r.linkage!, 0)
    : motionRatioAtTravel(r.swingarmPivot, r.swingarmLength, r.swingarmAngleDeg, r.lowerShockMount, r.upperShockMount, 0);
  const shockAngle = shockAngleFromVertical(r.swingarmPivot, r.swingarmLength, r.swingarmAngleDeg, shockBottomU, r.upperShockMount, 0);
  const shockComp = shockLen0 - shockLenU;

  const frontAxle0 = front0.axle, rAxle0 = rear0.axle;
  const wb = Math.max(50, rAxle0.x - frontAxle0.x);

  // ── Animation loop ──
  useEffect(() => {
    if (!playing) return;
    let raf = 0; let last = performance.now();
    const speed = maxTravel / 1.4; // full travel in ~1.4s
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setTravel(prev => {
        let next = prev + dirRef.current * speed * dt;
        if (next >= maxTravel) { next = maxTravel; dirRef.current = -1; }
        else if (next <= 0) { next = 0; dirRef.current = 1; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxTravel]);

  // ── Bodywork anchors (static chassis) ──
  const headTop = front0.crown;
  const bodyTop = Math.max(Rf, Rr) + (isScooter ? 0.22 : 0.30) * wb;
  const pivot = r.swingarmPivot;
  const engineC: Point2 = { x: pivot.x - 0.13 * wb, y: Math.max(Rf, Rr) + 0.05 * wb };

  // ── Overlay points — prefer the STUDIO's own geometry (tracks edits),
  //    fall back to the main store only when the Studio value is unavailable. ──
  const raw = results.raw;
  const cg: Point2 | null = isFinite(raw.X_cg) && isFinite(raw.Y_cg)
    ? { x: raw.X_cg, y: raw.Y_cg }
    : (sResults?.cog ? { x: sResults.cog.X_cg, y: sResults.cog.Y_cg } : null);
  const ic: Point2 | null = isFinite(raw.icX) && isFinite(raw.icY)
    ? { x: raw.icX, y: raw.icY }
    : (sResults?.antiSquat && !sResults.antiSquat.isCVT && isFinite(sResults.antiSquat.IC_x)
        ? { x: sResults.antiSquat.IC_x, y: sResults.antiSquat.IC_y } : null);
  const asPct = isFinite(raw.antiSquatPct) ? raw.antiSquatPct : sResults?.antiSquat?.antiSquatPercent;
  // chain sprocket: Studio drivetrain (tracks pivot edits), anchored to pivot.
  const csSprocket: Point2 | null = raw.isChainDrive
    ? { x: pivot.x + input.drivetrain.countershaftOffset.x, y: pivot.y + input.drivetrain.countershaftOffset.y } : null;
  const trailMm = isFinite(raw.trail) ? raw.trail : sResults?.geometry?.trail;

  // ── Auto-fit transform ──
  const allPts: Point2[] = [
    { x: frontAxle0.x - Rf, y: 0 }, { x: rAxle0.x + Rr, y: 0 }, headTop,
    r.upperShockMount, f.linkUpperMount, { x: 0, y: bodyTop * 1.05 },
    ...(ov.cg && cg ? [cg] : []), ...(ov.ic && ic ? [{ x: ic.x, y: Math.max(0, ic.y) }] : []),
  ];
  const xMin = Math.min(...allPts.map(p => p.x)) - 50, xMax = Math.max(...allPts.map(p => p.x)) + 50;
  const yMin = -40, yMax = Math.max(...allPts.map(p => p.y)) + 40;
  const PADX = 30;
  const scale = Math.min((VIEW_W - 2 * PADX) / (xMax - xMin), (VIEW_H - 2 * PADX) / (yMax - yMin));
  const ox = PADX + (VIEW_W - 2 * PADX - (xMax - xMin) * scale) / 2;
  const sx = useCallback((x: number) => ox + (x - xMin) * scale, [ox, xMin, scale]);
  const sy = useCallback((y: number) => VIEW_H - (PADX + (y - yMin) * scale), [yMin, scale]);
  const wx = (px: number) => (px - ox) / scale + xMin;
  const wy = (py: number) => (VIEW_H - py - PADX) / scale + yMin;
  const SP = (p: Point2) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;

  // ── Drag ──
  function clientToWorld(e: React.PointerEvent): Point2 {
    const svg = svgRef.current!; const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(wx(p.x)), y: Math.round(wy(p.y)) };
  }
  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const w = clientToWorld(e);
    switch (drag) {
      case 'saPivot': onRear({ swingarmPivot: w }); break;
      case 'rLower': onRear({ lowerShockMount: w }); break;
      case 'rUpper': onRear({ upperShockMount: w }); break;
      case 'saAxle': { const d = sub(w, r.swingarmPivot); onRear({ swingarmLength: Math.max(150, Math.round(len(d))), swingarmAngleDeg: +(Math.atan2(d.y, d.x) / DEG).toFixed(1) }); break; }
      case 'fPivot': onFront({ linkPivot: w }); break;
      case 'fLower': onFront({ linkLowerMount: w }); break;
      case 'fUpper': onFront({ linkUpperMount: w }); break;
      case 'fAxle': { const d = sub(w, f.linkPivot); onFront({ linkArmLength: Math.max(80, Math.round(len(d))), linkArmAngleDeg: +(Math.atan2(d.y, d.x) / DEG).toFixed(1) }); break; }
    }
  }

  // ── Force magnitudes (from Studio results) → scaled arrows ──
  const m = (key: string) => results.metrics.find(x => x.key === key)?.value ?? 0;
  const forces = useMemo(() => {
    const wheelLoad = m('staticLoadR');
    const dynLoad = m('dynLoadR');
    const shockForce = m('shockForceR');
    const springForce = m('springForceR');
    const chainPull = results.raw.chainTension || 0; // REAL: T = F·R_wheel/r_sprocket
    const weightXfer = Math.abs(dynLoad - wheelLoad);
    const maxF = Math.max(wheelLoad, shockForce, springForce, chainPull, weightXfer, 1);
    return { wheelLoad, dynLoad, shockForce, springForce, chainPull, weightXfer, maxF };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);
  const fScale = 95 / Math.max(1, forces.maxF); // px per N (relative)

  // ── Export ──
  function serializeSVG(): string {
    const svg = svgRef.current!; const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }
  function download(href: string, name: string) {
    const a = document.createElement('a'); a.href = href; a.download = name; a.click();
  }
  function exportSVG() {
    const blob = new Blob([serializeSVG()], { type: 'image/svg+xml' });
    download(URL.createObjectURL(blob), 'suspension-diagram.svg');
  }
  function exportPNG() {
    const svgStr = serializeSVG();
    const img = new Image();
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
    img.onload = () => {
      const SCALE = 2;
      const canvas = document.createElement('canvas');
      canvas.width = VIEW_W * SCALE; canvas.height = VIEW_H * SCALE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = drawing ? '#fff' : '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      download(canvas.toDataURL('image/png'), 'suspension-diagram.png');
    };
    img.src = url;
  }

  // ── Small render helpers ──
  const enter = (h: Omit<Hover, 'x' | 'y'>) => (e: React.PointerEvent) =>
    setHover({ ...h, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  const leave = () => setHover(null);

  function springCoil(a: Point2, b: Point2, amp = 6, n = 11): string {
    const A = { x: sx(a.x), y: sy(a.y) }, B = { x: sx(b.x), y: sy(b.y) };
    const d = sub(B, A), L = len(d) || 1, perp = { x: -d.y / L, y: d.x / L };
    let path = `M${A.x},${A.y}`;
    const lead = 0.18;
    path += ` L${(A.x + d.x * lead).toFixed(1)},${(A.y + d.y * lead).toFixed(1)}`;
    for (let i = 1; i < n; i++) {
      const t = lead + (1 - 2 * lead) * (i / n);
      const c = { x: A.x + d.x * t, y: A.y + d.y * t }, s = i % 2 ? amp : -amp;
      path += ` L${(c.x + perp.x * s).toFixed(1)},${(c.y + perp.y * s).toFixed(1)}`;
    }
    return path + ` L${(A.x + d.x * (1 - lead)).toFixed(1)},${(A.y + d.y * (1 - lead)).toFixed(1)} L${B.x},${B.y}`;
  }

  // thick machined member with rounded ends
  const member = (a: Point2, b: Point2, w: number, fill: string, key?: string) => {
    const A = { x: sx(a.x), y: sy(a.y) }, B = { x: sx(b.x), y: sy(b.y) };
    const d = sub(B, A), L = len(d) || 1, perp = { x: -d.y / L * w, y: d.x / L * w };
    const pts = [add(A, perp), add(B, perp), sub(B, perp), sub(A, perp)].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return <g key={key}>
      <polygon points={pts} fill={fill} stroke={PAL.alu2} strokeWidth={0.8} strokeLinejoin="round" filter="url(#sd-shadow)" />
      <circle cx={A.x} cy={A.y} r={w} fill={fill} stroke={PAL.alu2} strokeWidth={0.8} />
      <circle cx={B.x} cy={B.y} r={w} fill={fill} stroke={PAL.alu2} strokeWidth={0.8} />
    </g>;
  };

  const bearing = (p: Point2, label?: string) => (
    <g>
      <circle cx={sx(p.x)} cy={sy(p.y)} r={5.5} fill={PAL.bg} stroke={PAL.bearing} strokeWidth={2} />
      <circle cx={sx(p.x)} cy={sy(p.y)} r={2} fill={PAL.bearing} />
      {label && ov.dimensions && <text x={sx(p.x)} y={sy(p.y) - 9} textAnchor="middle" style={{ fontSize: 8, fill: PAL.label, fontFamily: 'monospace' }}>{label}</text>}
    </g>
  );

  const wheel = (c: Point2, R: number, label: string) => {
    const cr = R * scale, X = sx(c.x), Y = sy(c.y);
    return (
      <g onPointerEnter={enter({ name: `${label} wheel`, rows: [['Ø', `${(R * 2).toFixed(0)} mm`], ['centre', `${c.x.toFixed(0)}, ${c.y.toFixed(0)}`]] })} onPointerLeave={leave}>
        <circle cx={X} cy={Y} r={cr} fill={PAL.tyre} stroke={PAL.wheelRim} strokeWidth={cr * 0.14} />
        <circle cx={X} cy={Y} r={cr * 0.60} fill="none" stroke={PAL.wheelHub} strokeWidth={2.2} />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * 60) * DEG;
          return <line key={i} x1={X} y1={Y} x2={X + Math.cos(a) * cr * 0.58} y2={Y + Math.sin(a) * cr * 0.58} stroke={PAL.wheelHub} strokeWidth={1.6} strokeLinecap="round" />;
        })}
        <circle cx={X} cy={Y} r={cr * 0.10} fill={PAL.wheelRim} />
      </g>
    );
  };

  // arrow (force / dimension)
  const arrow = (from: Point2, to: Point2, color: string, width = 2, label?: string) => {
    const A = { x: sx(from.x), y: sy(from.y) }, B = { x: sx(to.x), y: sy(to.y) };
    const d = unit(sub(B, A)); const ah = 8;
    const left = { x: B.x - d.x * ah - d.y * ah * 0.5, y: B.y - d.y * ah + d.x * ah * 0.5 };
    const right = { x: B.x - d.x * ah + d.y * ah * 0.5, y: B.y - d.y * ah - d.x * ah * 0.5 };
    return <g>
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${B.x},${B.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
      {label && <text x={B.x + d.x * 6} y={B.y + d.y * 6} style={{ fontSize: 8.5, fill: color, fontFamily: 'monospace' }}>{label}</text>}
    </g>;
  };

  // dimension line with ticks
  const dim = (a: Point2, b: Point2, label: string, offset = 18, color = PAL.dim) => {
    const A = { x: sx(a.x), y: sy(a.y) }, B = { x: sx(b.x), y: sy(b.y) };
    const d = unit(sub(B, A)); const perp = { x: -d.y, y: d.x };
    const A2 = add(A, mul(perp, offset)), B2 = add(B, mul(perp, offset));
    const mid = mul(add(A2, B2), 0.5);
    const ang = Math.atan2(B2.y - A2.y, B2.x - A2.x) / DEG;
    return <g>
      <line x1={A.x} y1={A.y} x2={A2.x} y2={A2.y} stroke={color} strokeWidth={0.6} opacity={0.6} />
      <line x1={B.x} y1={B.y} x2={B2.x} y2={B2.y} stroke={color} strokeWidth={0.6} opacity={0.6} />
      <line x1={A2.x} y1={A2.y} x2={B2.x} y2={B2.y} stroke={color} strokeWidth={1} />
      {[A2, B2].map((p, i) => <line key={i} x1={p.x - perp.x * 3} y1={p.y - perp.y * 3} x2={p.x + perp.x * 3} y2={p.y + perp.y * 3} stroke={color} strokeWidth={1} />)}
      <text x={mid.x} y={mid.y - 2} textAnchor="middle" transform={`rotate(${Math.abs(ang) > 90 ? ang + 180 : ang} ${mid.x} ${mid.y})`} style={{ fontSize: 8.5, fill: color, fontFamily: 'monospace' }}>{label}</text>
    </g>;
  };

  const label = (p: Point2, text: string, dx = 9, dy = -8, color = PAL.label) =>
    <text x={sx(p.x) + dx} y={sy(p.y) + dy} style={{ fontSize: 8.5, fill: color, fontFamily: 'monospace' }}>{text}</text>;

  const handle = (id: Handle, p: Point2, color: string) => (
    <g style={{ cursor: travel === 0 ? 'grab' : 'not-allowed' }}
      onPointerDown={(e) => { if (travel !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(id); }}>
      <circle cx={sx(p.x)} cy={sy(p.y)} r={6.5} fill={color} stroke={PAL.bg} strokeWidth={2} opacity={travel === 0 ? 1 : 0.4} />
    </g>
  );

  // ── Silhouette path (static chassis) ──
  const silhouette = useMemo(() => {
    const P = (x: number, y: number) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    const C = (x1: number, y1: number, x2: number, y2: number) => `Q${sx(x1).toFixed(1)},${sy(y1).toFixed(1)} ${sx(x2).toFixed(1)},${sy(y2).toFixed(1)}`;
    if (isScooter) {
      // step-through scooter body
      const fl = 0.18 * wb; // leg shield
      return `M${P(headTop.x - 0.02 * wb, headTop.y)} `
        + `${C(headTop.x + fl, bodyTop * 0.9, 0.30 * wb, bodyTop * 0.55)} `       // leg shield down
        + `L${P(0.30 * wb, Math.max(Rf, Rr) + 0.04 * wb)} `                        // floorboard front
        + `L${P(0.58 * wb, Math.max(Rf, Rr) + 0.04 * wb)} `                        // floorboard
        + `${C(0.70 * wb, Math.max(Rf, Rr) + 0.10 * wb, 0.72 * wb, bodyTop * 0.95)} ` // body up
        + `${C(0.85 * wb, bodyTop, 0.96 * wb, bodyTop * 0.86)} `                   // seat/tail
        + `L${P(0.96 * wb, Rr * 1.2)} `                                           // tail down
        + `${C(0.78 * wb, Rr * 0.9, 0.62 * wb, Rr * 0.95)} `                       // under-seat
        + `L${P(0.40 * wb, Rr * 0.9)} `                                           // belly
        + `${C(0.18 * wb, Rr * 0.85, headTop.x - 0.02 * wb, headTop.y)} Z`;        // back to head
    }
    // motorcycle: tank + seat + tail + belly
    return `M${P(headTop.x, headTop.y)} `
      + `${C(0.30 * wb, bodyTop * 1.02, 0.46 * wb, bodyTop)} `                     // tank
      + `${C(0.58 * wb, bodyTop * 1.0, 0.66 * wb, bodyTop * 0.97)} `               // tank→seat
      + `L${P(0.90 * wb, bodyTop * 0.86)} `                                       // seat
      + `L${P(0.96 * wb, bodyTop * 0.80)} `                                       // tail tip
      + `L${P(0.93 * wb, bodyTop * 0.72)} `                                       // tail down
      + `${C(0.70 * wb, bodyTop * 0.70, 0.62 * wb, Rr + 0.12 * wb)} `             // under seat
      + `L${P(pivot.x + 0.04 * wb, pivot.y + 0.05 * wb)} `                        // to pivot
      + `${C(engineC.x, engineC.y - 0.10 * wb, engineC.x - 0.10 * wb, Math.max(Rf, Rr) * 0.85)} ` // engine belly
      + `${C(0.18 * wb, Rr * 0.8, headTop.x * 0.5, headTop.y * 0.55)} `           // down tube
      + `Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScooter, wb, headTop, bodyTop, Rf, Rr, pivot, engineC, sx, sy]);

  // chain line tangents (drive sprocket → rear sprocket), from Studio drivetrain
  const chainGeom = useMemo(() => {
    if (!csSprocket) return null;
    const dtv = input.drivetrain;
    const rDrive = (dtv.frontSprocket * dtv.chainPitch) / (2 * Math.PI);
    const rRear = (dtv.rearSprocket * dtv.chainPitch) / (2 * Math.PI);
    return { cs: csSprocket, rear: rearU.axle, rDrive, rRear };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csSprocket, input.drivetrain, rearU.axle]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <button onClick={() => setPlaying(p => !p)} style={tbBtn(playing)}>{playing ? '❚❚ Pause' : '▶ Animate'}</button>
        <button onClick={() => { setPlaying(false); setTravel(0); }} style={tbBtn(false)}>⟲ Reset</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>travel</span>
          <input type="range" min={0} max={maxTravel} step={0.5} value={travel}
            onChange={e => { setPlaying(false); setTravel(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)', width: 52 }}>{travel.toFixed(0)}/{maxTravel} mm</span>
        </div>
        <button onClick={() => setDrawing(d => !d)} style={tbBtn(drawing)} title="Technical drawing mode">⊞ Drawing</button>
        <button onClick={exportPNG} style={tbBtn(false)}>↓ PNG</button>
        <button onClick={exportSVG} style={tbBtn(false)}>↓ SVG</button>
      </div>

      {/* Overlay toggles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {OVERLAY_LABELS.map(o => (
          <button key={o.key} onClick={() => setOv(s => ({ ...s, [o.key]: !s[o.key] }))} style={chip(ov[o.key])}>
            {ov[o.key] ? '☑' : '☐'} {o.label}
          </button>
        ))}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height={DISPLAY_H}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', background: PAL.bg, borderRadius: 8, touchAction: 'none' }}
        onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => { setDrag(null); leave(); }}>
        <defs>
          <linearGradient id="sd-alu" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PAL.alu1} /><stop offset="100%" stopColor={PAL.alu2} />
          </linearGradient>
          <linearGradient id="sd-fork" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={PAL.forkInner} /><stop offset="100%" stopColor={PAL.forkOuter} />
          </linearGradient>
          <filter id="sd-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity={drawing ? 0 : 0.35} />
          </filter>
        </defs>

        {/* ground + grid */}
        <line x1={sx(xMin)} y1={sy(0)} x2={sx(xMax)} y2={sy(0)} stroke={PAL.ground} strokeWidth={2} />
        {Array.from({ length: 48 }).map((_, i) => { const gx = sx(xMin) + i * 24; return gx < sx(xMax) ? <line key={i} x1={gx} y1={sy(0)} x2={gx - 6} y2={sy(0) + 6} stroke={PAL.ground} strokeWidth={0.7} /> : null; })}

        {/* ── CHASSIS silhouette ── */}
        {ov.chassis && <>
          <path d={silhouette} fill={PAL.silhouetteFill} stroke={PAL.silhouette} strokeWidth={1.4} strokeLinejoin="round" opacity={0.85} filter="url(#sd-shadow)" />
          {/* engine block */}
          <rect x={sx(engineC.x) - 0.12 * wb * scale} y={sy(engineC.y + 0.10 * wb)} width={0.24 * wb * scale} height={0.20 * wb * scale} rx={9}
            fill={PAL.engine} stroke={PAL.alu2} strokeWidth={1}
            onPointerEnter={enter({ name: 'Engine block', rows: [['centre', `${engineC.x.toFixed(0)}, ${engineC.y.toFixed(0)} mm`]] })} onPointerLeave={leave} />
          {/* triple clamp (fork) */}
          {isFork && <g onPointerEnter={enter({ name: 'Triple clamp', rows: [['rake', `${f.rakeDeg}°`]] })} onPointerLeave={leave}>
            <rect x={sx(headTop.x) - 9} y={sy(headTop.y) - 5} width={18} height={10} rx={3}
              transform={`rotate(${-f.rakeDeg} ${sx(headTop.x)} ${sy(headTop.y)})`} fill="url(#sd-alu)" stroke={PAL.alu2} />
          </g>}
        </>}

        {/* ── WHEEL PATH ── */}
        {ov.wheelpath && <>
          <polyline points={Array.from({ length: 25 }).map((_, i) => SP(rearStateAt(r, (i / 24) * maxTravel).axle)).join(' ')}
            fill="none" stroke={PAL.path} strokeWidth={2} strokeDasharray="1 4" strokeLinecap="round" opacity={0.9} />
          <polyline points={Array.from({ length: 13 }).map((_, i) => SP(frontStateAt(f, Rf, (i / 12) * f.travel).axle)).join(' ')}
            fill="none" stroke={PAL.path} strokeWidth={1.5} strokeDasharray="1 4" opacity={0.6} />
        </>}

        {/* ── SUSPENSION ── */}
        {ov.suspension && <>
          {/* FRONT */}
          {frontU.isFork ? (
            <g onPointerEnter={enter({ name: f.type === 'usd' ? 'USD fork' : 'Telescopic fork', rows: [['length', `${f.forkLength} mm`], ['rake', `${f.rakeDeg}°`], ['travel', `${f.travel} mm`], ['MR', '1.00'], ['compression', `${uf.toFixed(0)} mm`]] })} onPointerLeave={leave}>
              {/* outer tube (crown→mid) */}
              {member(headTop, add(headTop, mul(unit(sub(frontU.axle, headTop)), len(sub(frontU.axle, headTop)) * 0.55)), f.type === 'usd' ? 6 : 4.5, 'url(#sd-fork)')}
              {/* inner tube (mid→axle) */}
              {member(add(headTop, mul(unit(sub(frontU.axle, headTop)), len(sub(frontU.axle, headTop)) * 0.5)), frontU.axle, f.type === 'usd' ? 4 : 3, PAL.forkInner)}
            </g>
          ) : (
            <g onPointerEnter={enter({ name: `${f.type} link`, rows: [['arm', `${f.linkArmLength} mm`], ['MR', front0.isFork ? '1.00' : MR0.toFixed(3)], ['travel', `${f.travel} mm`]] })} onPointerLeave={leave}>
              {member(f.linkPivot, frontU.axle, 4.5, 'url(#sd-alu)')}
              {member(frontU.lower, f.linkUpperMount, 3, PAL.shockBody)}
              <path d={springCoil(frontU.lower, f.linkUpperMount)} fill="none" stroke={PAL.spring} strokeWidth={2.2} />
            </g>
          )}
          {/* REAR swingarm (machined aluminium) */}
          <g onPointerEnter={enter({ name: 'Swingarm', rows: [['length', `${r.swingarmLength} mm`], ['angle', `${rearU.angleDeg.toFixed(1)}°`], ['MR', MRu.toFixed(3)], ['leverage', (1 / Math.max(0.01, MRu)).toFixed(2)]] })} onPointerLeave={leave}>
            {member(pivot, rearU.axle, 7, 'url(#sd-alu)')}
          </g>
          {/* REAR shock: body + spring + reservoir (bottom = rocker tip if linkage) */}
          <g onPointerEnter={enter({ name: 'Rear shock', rows: [['length', `${shockLenU.toFixed(0)} mm`], ['angle', `${shockAngle.toFixed(1)}°`], ['stroke', `${r.shockStroke} mm`], ['compression', `${shockComp.toFixed(0)} mm`], ['MR', MRu.toFixed(3)]] })} onPointerLeave={leave}>
            {member(shockBottomU, r.upperShockMount, 4.5, PAL.shockBody)}
            <path d={springCoil(shockBottomU, r.upperShockMount)} fill="none" stroke={PAL.spring} strokeWidth={2.4} />
            {/* reservoir near top mount */}
            {(() => { const dirv = unit(sub(shockBottomU, r.upperShockMount)); const perp = { x: -dirv.y, y: dirv.x }; const base = add(r.upperShockMount, mul(dirv, 18 / scale)); const res = add(base, mul(perp, 26 / scale)); return member(base, res, 4, PAL.reservoir); })()}
            {r.type === 'twin-shock' && label(r.upperShockMount, '×2', 8, 12, PAL.spring)}
          </g>
          {/* bearings */}
          {bearing(pivot)}
        </>}

        {/* ── LINKAGE (real 4-bar: rocker + pushrod) ── */}
        {ov.linkage && hasLinkage && ov.suspension && r.linkage && <g onPointerEnter={enter({ name: 'Linkage (rocker + pushrod)', rows: [['rocker', `${r.linkage.rockerLength.toFixed(0)} mm`], ['pushrod', `${r.linkage.pushrodLength.toFixed(0)} mm`], ['MR(0)', MR0.toFixed(3)], ['rising rate', (MRu / Math.max(0.01, MR0)).toFixed(2) + '×']] })} onPointerLeave={leave}>
          {/* pushrod (dog-bone): swingarm attach S → rocker tip Q */}
          {member(pushrodFromU, shockBottomU, 2.5, PAL.linkage)}
          {/* rocker plate: pivot → tip Q */}
          {member(r.linkage.rockerPivot, shockBottomU, 3, PAL.linkage)}
          {bearing(r.linkage.rockerPivot)}
        </g>}

        {/* ── WHEELS (over suspension) ── */}
        {ov.suspension && <>{wheel(frontU.axle, Rf, 'front')}{wheel(rearU.axle, Rr, 'rear')}</>}

        {/* ── CHAIN LINE ── */}
        {ov.chain && chainGeom && <g>
          <circle cx={sx(chainGeom.cs.x)} cy={sy(chainGeom.cs.y)} r={chainGeom.rDrive * scale} fill="none" stroke={PAL.chain} strokeWidth={1.2} />
          <line x1={sx(chainGeom.cs.x)} y1={sy(chainGeom.cs.y - chainGeom.rDrive)} x2={sx(chainGeom.rear.x)} y2={sy(chainGeom.rear.y - chainGeom.rRear)} stroke={PAL.chain} strokeWidth={1.6} />
          <line x1={sx(chainGeom.cs.x)} y1={sy(chainGeom.cs.y + chainGeom.rDrive)} x2={sx(chainGeom.rear.x)} y2={sy(chainGeom.rear.y + chainGeom.rRear)} stroke={PAL.chain} strokeWidth={1} opacity={0.5} />
          {label(chainGeom.cs, 'chain line', 6, -6, PAL.chain)}
        </g>}

        {/* ── FORCE VECTORS ── */}
        {ov.forces && <g>
          {/* wheel load (down) + ground reaction (up) at rear contact */}
          {arrow({ x: rearU.axle.x, y: 0 }, { x: rearU.axle.x, y: -forces.wheelLoad * fScale / scale }, PAL.force, 2.5, `W ${forces.wheelLoad.toFixed(0)}N`)}
          {arrow({ x: rearU.axle.x - 18 / scale, y: 0 }, { x: rearU.axle.x - 18 / scale, y: forces.wheelLoad * fScale / scale }, PAL.dim, 2, 'N')}
          {/* spring/shock force along shock axis */}
          {(() => { const d = unit(sub(r.upperShockMount, rearU.lower)); const tip = add(rearU.lower, mul(d, forces.shockForce * fScale / scale)); return arrow(rearU.lower, tip, PAL.spring, 2.5, `Fs ${forces.shockForce.toFixed(0)}N`); })()}
          {/* weight transfer at CG */}
          {cg && arrow(cg, add(cg, { x: forces.weightXfer * fScale / scale, y: 0 }), '#ffa657', 2, `ΔW ${forces.weightXfer.toFixed(0)}N`)}
          {/* chain pull */}
          {chainGeom && (() => { const d = unit(sub(chainGeom.cs, chainGeom.rear)); const tip = add(chainGeom.rear, mul(d, forces.chainPull * fScale / scale)); return arrow(chainGeom.rear, tip, PAL.chain, 2, 'chain'); })()}
        </g>}

        {/* ── INSTANT CENTER / CG ── */}
        {ov.ic && ic && <g>
          <line x1={sx(rearU.axle.x)} y1={sy(0)} x2={sx(ic.x)} y2={sy(ic.y)} stroke={PAL.ic} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          <circle cx={sx(ic.x)} cy={sy(ic.y)} r={4} fill="none" stroke={PAL.ic} strokeWidth={2} />
          <line x1={sx(ic.x) - 7} y1={sy(ic.y)} x2={sx(ic.x) + 7} y2={sy(ic.y)} stroke={PAL.ic} strokeWidth={1} />
          <line x1={sx(ic.x)} y1={sy(ic.y) - 7} x2={sx(ic.x)} y2={sy(ic.y) + 7} stroke={PAL.ic} strokeWidth={1} />
          {label(ic, `IC ${asPct !== undefined && isFinite(asPct) ? asPct.toFixed(0) + '% AS' : ''}`, 9, -6, PAL.ic)}
        </g>}
        {ov.cg && cg && <g onPointerEnter={enter({ name: 'Centre of gravity', rows: [['x', `${cg.x.toFixed(0)} mm`], ['height', `${cg.y.toFixed(0)} mm`], ['front', `${input.vehicle.frontWeightPct.toFixed(0)}%`]] })} onPointerLeave={leave}>
          <circle cx={sx(cg.x)} cy={sy(cg.y)} r={8} fill="none" stroke={PAL.cg} strokeWidth={1.6} />
          <path d={`M${sx(cg.x) - 8},${sy(cg.y)} A8 8 0 0 1 ${sx(cg.x)},${sy(cg.y) - 8} L${sx(cg.x)},${sy(cg.y)} Z`} fill={PAL.cg} opacity={0.8} />
          <path d={`M${sx(cg.x) + 8},${sy(cg.y)} A8 8 0 0 1 ${sx(cg.x)},${sy(cg.y) + 8} L${sx(cg.x)},${sy(cg.y)} Z`} fill={PAL.cg} opacity={0.8} />
          {label(cg, 'CG', 11, -6, PAL.cg)}
        </g>}

        {/* ── PACKAGING ── */}
        {ov.packaging && <g>
          {(() => { const usable = (results.metrics.find(x => x.key === 'coilBindR')?.value ?? 0); const col = usable < 0 ? PAL.force : PAL.dim; return <>
            <circle cx={sx(rearU.lower.x)} cy={sy(rearU.lower.y)} r={Math.max(8, r.shockStroke * 0.25 * scale)} fill="none" stroke={col} strokeWidth={1} strokeDasharray="3 3" />
            {label(rearU.lower, `clr ${usable.toFixed(0)}mm`, 8, 14, col)}
          </>; })()}
        </g>}

        {/* ── DIMENSIONS ── */}
        {ov.dimensions && <g>
          {dim({ x: frontAxle0.x, y: 0 }, { x: rAxle0.x, y: 0 }, `WB ${v.wheelbase} mm`, 30)}
          {dim(pivot, rearU.axle, `SA ${r.swingarmLength} mm`, 16)}
          {dim(rearU.lower, r.upperShockMount, `shock ${rearU.shockLen.toFixed(0)} mm · ${shockAngle.toFixed(0)}°`, -16)}
          {isFork && dim(frontU.axle, headTop, `fork ${f.forkLength} · rake ${f.rakeDeg}°`, -16)}
          {trailMm !== undefined && dim({ x: frontAxle0.x, y: 0 }, { x: frontAxle0.x + trailMm, y: 0 }, `trail ${trailMm.toFixed(0)}`, 44, PAL.ic)}
          {/* travel + stroke readout near rear axle */}
          {arrow({ x: rAxle0.x + Rr + 14 / scale, y: rAxle0.y }, { x: rAxle0.x + Rr + 14 / scale, y: rAxle0.y + maxTravel }, PAL.dim, 1.4, `travel ${maxTravel}mm`)}
        </g>}

        {/* ── LABELS for points ── */}
        {ov.suspension && <g>
          {label(pivot, 'SA pivot', 9, -9, PAL.label)}
          {label(rearU.axle, 'rear axle', 10, 4, PAL.label)}
          {label(rearU.lower, 'shock ↓', -42, 4, PAL.label)}
          {label(r.upperShockMount, 'shock ↑', 9, -6, PAL.label)}
          {r.linkage && ov.linkage && label(r.linkage.rockerPivot, 'linkage pivot', -10, -10, PAL.linkage)}
          {label(frontU.axle, 'front axle', -6, 16, PAL.label)}
          {isFork && label(headTop, 'fork crown', 10, -4, PAL.label)}
        </g>}

        {/* ── DRAG HANDLES (only at travel 0) ── */}
        {ov.suspension && <>
          {handle('saPivot', pivot, PAL.bearing)}
          {handle('saAxle', rAxle0, PAL.alu1)}
          {handle('rLower', r.lowerShockMount, PAL.spring)}
          {handle('rUpper', r.upperShockMount, PAL.shockBody)}
          {!isFork && <>
            {handle('fPivot', f.linkPivot, PAL.bearing)}
            {handle('fAxle', frontAxle0, PAL.forkOuter)}
            {handle('fLower', f.linkLowerMount, PAL.spring)}
            {handle('fUpper', f.linkUpperMount, PAL.shockBody)}
          </>}
        </>}
      </svg>

      {/* Motion-ratio HUD */}
      <div style={{ position: 'absolute', top: 78, left: 8, fontSize: 10, fontFamily: 'monospace', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', display: 'grid', gap: 1, pointerEvents: 'none' }}>
        <div>Motion ratio <b style={{ color: 'var(--accent2)' }}>{isFinite(MRu) ? MRu.toFixed(3) : '—'}</b></div>
        <div>Leverage <b style={{ color: 'var(--cyan)' }}>{isFinite(MRu) ? (1 / Math.max(0.01, MRu)).toFixed(2) : '—'}</b></div>
        <div>Shock comp <b style={{ color: 'var(--spring, #f0883e)' }}>{shockComp.toFixed(0)}</b> mm</div>
        <div>Wheel travel <b style={{ color: 'var(--text-primary)' }}>{u.toFixed(0)}</b> mm</div>
      </div>

      {/* Hover inspector */}
      {hover && (
        <div style={{ position: 'absolute', left: Math.min(hover.x + 14, 720), top: hover.y + 90, fontSize: 10, fontFamily: 'monospace', background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 9px', pointerEvents: 'none', zIndex: 10, minWidth: 130 }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 2 }}>{hover.name}</div>
          {hover.rows.map(([k, val], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={{ color: 'var(--text-primary)' }}>{val}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
        Drag hardpoints at travel 0 · scrub/animate travel to see kinematics · hover components for details · overlays + export above.
      </div>
    </div>
  );
}

function tbBtn(active: boolean): React.CSSProperties {
  return { fontSize: 10, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? 'var(--accent)' : 'var(--surface2)', color: active ? '#fff' : 'var(--text-muted)',
    border: '1px solid var(--border)' };
}
function chip(active: boolean): React.CSSProperties {
  return { fontSize: 9, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? 'var(--accent2)22' : 'var(--surface2)', color: active ? 'var(--accent2)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--accent2)66' : 'var(--border)'}` };
}
