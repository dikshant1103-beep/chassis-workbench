import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useMemo, useState, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useTheme } from '../../store/useTheme';
import type { Visibility } from '../../store/useStore';

// ── CAD Model type ──────────────────────────────────────────────────────────
type CADModel = {
  id: string; name: string;
  geometry?: THREE.BufferGeometry;
  posX: number; posY: number; posZ: number;
  scale: number; opacity: number; color: string; visible: boolean;
};

/* ═══════════════════════════════════════════════════════
   PRIMITIVE HELPERS
   ═══════════════════════════════════════════════════════ */

function Tube({
  from, to, radius = 12, color = '#8b949e', opacity = 1,
}: {
  from: [number, number, number]; to: [number, number, number];
  radius?: number; color?: string; opacity?: number;
}) {
  const [mid, quat, len] = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const length = dir.length();
    const midPt: [number, number, number] = [
      (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2,
    ];
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir.normalize(),
    );
    return [midPt, [q.x, q.y, q.z, q.w] as [number, number, number, number], length];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...from, ...to]);

  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[radius, radius, len, 10]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={0.5} metalness={0.4} />
    </mesh>
  );
}

function Dot({ pos, radius = 20, color = '#ffffff', emissive = '#000000' }: {
  pos: [number, number, number]; radius?: number; color?: string; emissive?: string;
}) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.4} roughness={0.3} metalness={0.5} />
    </mesh>
  );
}

function WheelRing({ cx, cy, cz = 0, radius, tubeR = 62, color = '#8b949e' }: {
  cx: number; cy: number; cz?: number; radius: number; tubeR?: number; color?: string;
}) {
  return (
    <mesh position={[cx, cy, cz]}>
      <torusGeometry args={[radius, tubeR, 18, 72]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.5} />
    </mesh>
  );
}

function Axle({ x, y, halfSpan, color = '#555e6a' }: {
  x: number; y: number; halfSpan: number; color?: string;
}) {
  return <Tube from={[x, y, -halfSpan]} to={[x, y, halfSpan]} radius={18} color={color} />;
}

function Label3D({ pos, text, sub, color = '#8b949e', dx = 30, dy = 0 }: {
  pos: [number, number, number]; text: string; sub?: string;
  color?: string; dx?: number; dy?: number;
}) {
  return (
    <Html position={pos} style={{ pointerEvents: 'none', transform: `translate(${dx}px,${dy}px)` }}>
      <div style={{
        fontFamily: 'Consolas,monospace', fontSize: 10, color,
        whiteSpace: 'nowrap', lineHeight: 1.4, userSelect: 'none',
        textShadow: '0 0 4px rgba(0,0,0,0.9)',
      }}>
        <div style={{ fontWeight: 700, letterSpacing: '0.5px' }}>{text}</div>
        {sub && <div style={{ fontSize: 9, opacity: 0.75 }}>{sub}</div>}
      </div>
    </Html>
  );
}

/**
 * SpringCoil — 3D helix spring using TubeGeometry + CatmullRomCurve3.
 * Gram-Schmidt orthonormalisation ensures a valid frame for any axis direction.
 */
function SpringCoil({
  from, to, coils = 8, wireR = 6, helixR = 22, color = '#c8a800',
}: {
  from: [number, number, number]; to: [number, number, number];
  coils?: number; wireR?: number; helixR?: number; color?: string;
}) {
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a);
    const len = axis.length();
    if (len < 1e-6) return new THREE.BufferGeometry();
    axis.normalize();

    // Gram-Schmidt: find a vector not parallel to axis, then orthogonalise
    let ref = new THREE.Vector3(1, 0, 0);
    if (Math.abs(axis.dot(ref)) > 0.9) ref = new THREE.Vector3(0, 1, 0);
    const u = ref.clone().sub(axis.clone().multiplyScalar(axis.dot(ref))).normalize();
    const v = axis.clone().cross(u).normalize();

    const segs = coils * 24;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ang = t * coils * Math.PI * 2;
      const ctr = a.clone().addScaledVector(axis, len * t);
      pts.push(
        ctr.clone()
          .addScaledVector(u, helixR * Math.cos(ang))
          .addScaledVector(v, helixR * Math.sin(ang)),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(curve, segs, wireR, 8, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...from, ...to, coils, wireR, helixR]);

  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} metalness={0.8} roughness={0.2} />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════
   VISIBILITY PANEL (HTML overlay, outside Canvas)
   ═══════════════════════════════════════════════════════ */

const VIS_GROUPS: { label: string; keys: (keyof Visibility)[] }[] = [
  { label: 'Front End',  keys: ['frontWheel', 'frontForkTubes', 'frontForkSprings', 'headTube', 'steeringAxis'] },
  { label: 'Rear End',   keys: ['rearWheel', 'swingarm', 'rearShock', 'rearShockSpring'] },
  { label: 'Chassis',   keys: ['frameRails', 'seatTube', 'engineBlock'] },
  { label: 'Rider',     keys: ['ergoControls', 'ergoTriangle'] },
  { label: 'Analysis',  keys: ['cogMarker', 'massComponents', 'instantCentre', 'labels'] },
  { label: '2D Overlays', keys: ['chainSystem', 'forceLine', 'trailGeometry', 'antiSquatLine'] },
];

const VIS_LABELS: Record<keyof Visibility, string> = {
  frontWheel: 'Front Wheel', rearWheel: 'Rear Wheel',
  frontForkTubes: 'Fork Tubes', frontForkSprings: 'Fork Springs',
  headTube: 'Head Tube', steeringAxis: 'Steering Axis',
  frameRails: 'Frame Rails', seatTube: 'Seat Tube',
  swingarm: 'Swingarm', rearShock: 'Rear Shock', rearShockSpring: 'Rear Spring',
  engineBlock: 'Engine Block',
  riderMassPoints: 'Rider Mass', bikeSilhouette: 'Silhouette',
  cogMarker: 'CoG Marker', ergoTriangle: 'Ergo Triangle', ergoControls: 'Controls',
  massComponents: 'Mass Dots', instantCentre: 'Instant Centre', labels: 'All Labels',
  chainSystem: 'Chain & Sprockets', forceLine: 'Force Line', trailGeometry: 'Trail Geometry',
  antiSquatLine: 'AS Load Line', loadTransferLine: 'Load Transfer',
  wheelbaseLine: 'Wheelbase', pivotAxleLine: 'Pivot→Axle', swingarmExtension: 'SA Extension',
  forkAxisLine: 'Fork Axis', handlebarForkLine: 'HBar→Fork',
  massLabels: 'Mass Labels', coordLabels: 'Coordinates', angleLabels: 'Angles',
  dimensionLabels: 'Dimensions', forceVectors: 'Force Vectors', coordAxes: 'Coord Axes',
  advancedKinematics: 'Adv. Kinematics',
  akRakeLine: 'AK Rake', akForkOffset: 'AK Fork Offset', akNormalTrail: 'AK Normal Trail',
  akRearRadius: 'AK Rear Radius', akCogCross: 'AK CoG Cross', akSquatLine: 'AK Squat Line',
  akPivotLine: 'AK Pivot Line',
};

function VisibilityPanel() {
  const [open, setOpen] = useState(false);
  const visibility = useStore(s => s.visibility);
  const setVisibility = useStore(s => s.setVisibility);
  const { theme } = useTheme();
  const dk = theme === 'dark';

  const panelStyle: React.CSSProperties = {
    position: 'absolute', top: 8, left: 8, zIndex: 10,
    fontFamily: 'Consolas, monospace', fontSize: 11,
    color: dk ? '#c9d1d9' : '#24292f',
  };

  const btnStyle: React.CSSProperties = {
    background: dk ? '#161b22' : '#f6f8fa',
    border: `1px solid ${dk ? '#30363d' : '#d0d7de'}`,
    color: dk ? '#c9d1d9' : '#24292f',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
    fontSize: 11, fontFamily: 'Consolas, monospace',
  };

  const cardStyle: React.CSSProperties = {
    marginTop: 4, background: dk ? '#0d1117cc' : '#ffffffcc',
    border: `1px solid ${dk ? '#30363d' : '#d0d7de'}`,
    borderRadius: 8, padding: '10px 14px',
    backdropFilter: 'blur(6px)',
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px',
    minWidth: 260,
  };

  const groupTitleStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.8px',
    color: dk ? '#58a6ff' : '#0969da',
    textTransform: 'uppercase', marginTop: 6, marginBottom: 2,
    gridColumn: '1 / -1',
  };

  const checkRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '1px 0', cursor: 'pointer', userSelect: 'none',
  };

  const allVisible = Object.values(visibility).every(Boolean);

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button style={btnStyle} onClick={() => setOpen(o => !o)}>
          {open ? '▲' : '▼'} Components
        </button>
        {open && (
          <button
            style={{ ...btnStyle, fontSize: 10 }}
            onClick={() => {
              const v: Partial<Visibility> = {};
              (Object.keys(visibility) as (keyof Visibility)[]).forEach(k => { v[k] = !allVisible; });
              setVisibility(v);
            }}
          >
            {allVisible ? 'Hide All' : 'Show All'}
          </button>
        )}
      </div>

      {open && (
        <div style={cardStyle}>
          {VIS_GROUPS.map(g => (
            <div key={g.label} style={{ gridColumn: '1 / -1' }}>
              <div style={groupTitleStyle}>{g.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
                {g.keys.map(k => (
                  <label key={k} style={checkRowStyle}>
                    <input
                      type="checkbox"
                      checked={visibility[k]}
                      onChange={e => setVisibility({ [k]: e.target.checked })}
                      style={{ accentColor: '#1f6feb', cursor: 'pointer' }}
                    />
                    {VIS_LABELS[k]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN CHASSIS SCENE
   ═══════════════════════════════════════════════════════ */

function ChassisScene({ vis, cadModels }: { vis: Visibility; cadModels: CADModel[] }) {
  const input   = useStore(s => s.input);
  const results = useStore(s => s.results);
  const { theme } = useTheme();
  const dk = theme === 'dark';
  const { geometry: geo, suspension, ergo, massComponents } = input;

  const R_f   = geo.frontWheelDia / 2;
  const R_r   = geo.rearWheelDia  / 2;
  const WB    = geo.wheelbase;
  const alpha = (geo.headAngle * Math.PI) / 180;

  // Head tube geometry
  const ht_bx = geo.forkOffset * Math.cos(alpha);
  const ht_by = R_f + geo.forkOffset * Math.sin(alpha);
  const HT_HALF = 110;
  const headTop: [number, number, number] = [ht_bx - Math.sin(alpha) * HT_HALF * 1.3, ht_by + Math.cos(alpha) * HT_HALF * 1.3, 0];
  const headBot: [number, number, number] = [ht_bx + Math.sin(alpha) * HT_HALF * 0.6, ht_by - Math.cos(alpha) * HT_HALF * 0.6, 0];

  // Lateral spreads
  const FORK_Z = 90;
  const SA_Z   = 75;
  const RAIL_Z = 50;

  // Steering axis
  const SA_EXT = 320;
  const steeringAxisTop: [number, number, number] = [ht_bx - Math.sin(alpha) * SA_EXT * 0.35, ht_by + Math.cos(alpha) * SA_EXT * 0.35, 0];
  const steeringAxisBot: [number, number, number] = [ht_bx + Math.sin(alpha) * SA_EXT * 0.65, ht_by - Math.cos(alpha) * SA_EXT * 0.65, 0];

  // Frame rails
  const headBaseL: [number, number, number] = [ht_bx, ht_by, -RAIL_Z];
  const headBaseR: [number, number, number] = [ht_bx, ht_by,  RAIL_Z];
  const pivL: [number, number, number] = [geo.swingarmPivotX, geo.swingarmPivotHeight, -RAIL_Z];
  const pivR: [number, number, number] = [geo.swingarmPivotX, geo.swingarmPivotHeight,  RAIL_Z];

  // Seat tube
  const seatTubeTop: [number, number, number] = [geo.swingarmPivotX - 80, geo.swingarmPivotHeight + 340, 0];
  const swingarmPiv: [number, number, number] = [geo.swingarmPivotX, geo.swingarmPivotHeight, 0];

  // CoG, ergo
  const cogPos:  [number, number, number] = [results.cog.X_cg, results.cog.Y_cg, 0];
  const hbPos:   [number, number, number] = [ergo.handlebarX, ergo.handlebarY, 0];
  const seatPos: [number, number, number] = [ergo.seatX, ergo.seatY, 0];
  const pegPos:  [number, number, number] = [ergo.footpegX, ergo.footpegY, 0];
  const HB_HALF = 380;
  const hbL: [number, number, number] = [ergo.handlebarX, ergo.handlebarY, -HB_HALF];
  const hbR: [number, number, number] = [ergo.handlebarX, ergo.handlebarY,  HB_HALF];
  const hbCenter: [number, number, number] = [ergo.handlebarX, ergo.handlebarY + 50, 0];
  const PEG_HALF = 320;
  const pegL: [number, number, number] = [ergo.footpegX, ergo.footpegY, -PEG_HALF];
  const pegR: [number, number, number] = [ergo.footpegX, ergo.footpegY,  PEG_HALF];

  // Swingarm cross-brace midpoint
  const saBracePos: [number, number, number] = [
    (geo.swingarmPivotX + WB) / 2,
    (geo.swingarmPivotHeight + geo.rearAxleHeight) / 2, 0,
  ];

  // Camera target
  const camTarget: [number, number, number] = [WB * 0.45, R_r + 300, 0];

  // Fork spring positions — spring coil in upper 50% of fork, between head area and midpoint
  const forkMidFrac = 0.5;
  const forkSpringTopL: [number, number, number] = [ht_bx, ht_by, -FORK_Z];
  const forkSpringBotL: [number, number, number] = [
    ht_bx + (0 - ht_bx) * forkMidFrac, ht_by + (R_f - ht_by) * forkMidFrac, -FORK_Z,
  ];
  const forkSpringTopR: [number, number, number] = [ht_bx, ht_by,  FORK_Z];
  const forkSpringBotR: [number, number, number] = [
    ht_bx + (0 - ht_bx) * forkMidFrac, ht_by + (R_f - ht_by) * forkMidFrac,  FORK_Z,
  ];

  // Rear shock positions
  const shockBot: [number, number, number] = [
    geo.swingarmPivotX + geo.swingarmLength * 0.35,
    geo.swingarmPivotHeight + (geo.rearAxleHeight - geo.swingarmPivotHeight) * 0.35 - 10, 0,
  ];
  const shockTop: [number, number, number] = [
    shockBot[0] - 60, shockBot[1] + suspension.shockTravel * 0.8 + 120, 0,
  ];

  // Theme colours
  const LC = {
    wheel:    dk ? '#9aa5b1' : '#57606a',
    fork:     dk ? '#58a6ff' : '#0969da',
    frame:    dk ? '#8b949e' : '#57606a',
    swingarm: dk ? '#e3b341' : '#9a6700',
    ergo:     dk ? '#56d364' : '#1a7f37',
    cog:      dk ? '#ff7b72' : '#cf222e',
    mass:     dk ? '#79c0ff' : '#0969da',
    ic:       dk ? '#e3b341' : '#9a6700',
    muted:    dk ? '#8b949e' : '#6e7781',
  };

  // Engine position
  const engComp = massComponents.find(c => c.label.toLowerCase().includes('engine'));
  const ex = engComp ? engComp.x : geo.swingarmPivotX - 70;
  const ey = engComp ? engComp.y : geo.swingarmPivotHeight + 80;

  // Instant centre
  const IC_abs_x = results.antiSquat.IC_x + geo.swingarmPivotX;
  const IC_abs_y = results.antiSquat.IC_y + geo.swingarmPivotHeight;
  const icValid = IC_abs_x >= -1000 && IC_abs_x <= 4000;

  return (
    <>
      {/* ── Lights ─────────────────────────────────── */}
      <ambientLight intensity={dk ? 0.35 : 0.7} />
      <directionalLight position={[-500, 2000, 1500]} intensity={dk ? 0.9 : 1.1} castShadow />
      <directionalLight position={[WB + 500, 1500, -1500]} intensity={dk ? 0.4 : 0.5} color={dk ? '#aaddff' : '#fffff0'} />
      <pointLight position={[WB / 2, 800, 800]} intensity={dk ? 0.5 : 0.3} color="#ffffff" />

      {/* ── Ground grid ────────────────────────────── */}
      <Grid
        args={[5000, 5000]} position={[WB / 2, 0, 0]}
        cellSize={100} cellThickness={0.4}
        cellColor={dk ? '#1e2530' : '#c8d0da'}
        sectionSize={500} sectionThickness={0.8}
        sectionColor={dk ? '#2a3344' : '#b0bac4'}
        fadeDistance={6000} infiniteGrid
      />

      {/* ══ FRONT WHEEL ══════════════════════════════ */}
      {vis.frontWheel && <>
        <WheelRing cx={0} cy={R_f} cz={0}   radius={R_f - 62} tubeR={62} color="#6e7681" />
        <WheelRing cx={0} cy={R_f} cz={-50} radius={R_f - 62} tubeR={8}  color="#555e6a" />
        <WheelRing cx={0} cy={R_f} cz={ 50} radius={R_f - 62} tubeR={8}  color="#555e6a" />
        <Dot pos={[0, R_f, 0]} radius={28} color="#444c56" />
        <Axle x={0} y={R_f} halfSpan={FORK_Z + 10} color="#30363d" />
      </>}

      {/* ══ REAR WHEEL ═══════════════════════════════ */}
      {vis.rearWheel && <>
        <WheelRing cx={WB} cy={geo.rearAxleHeight} cz={0}   radius={R_r - 62} tubeR={62} color="#6e7681" />
        <WheelRing cx={WB} cy={geo.rearAxleHeight} cz={-55} radius={R_r - 62} tubeR={8}  color="#555e6a" />
        <WheelRing cx={WB} cy={geo.rearAxleHeight} cz={ 55} radius={R_r - 62} tubeR={8}  color="#555e6a" />
        <Dot pos={[WB, geo.rearAxleHeight, 0]} radius={28} color="#444c56" />
        <Axle x={WB} y={geo.rearAxleHeight} halfSpan={SA_Z + 10} color="#30363d" />
      </>}

      {/* ══ FRONT FORK TUBES ═════════════════════════ */}
      {vis.frontForkTubes && <>
        {/* Outer tube: head area → 55% down */}
        <Tube from={[ht_bx, ht_by, -FORK_Z]} to={forkSpringBotL} radius={20} color="#1f6feb" />
        <Tube from={[ht_bx, ht_by,  FORK_Z]} to={forkSpringBotR} radius={20} color="#1f6feb" />
        {/* Inner stanchion (chrome): lower portion → axle */}
        <Tube from={forkSpringBotL} to={[0, R_f, -FORK_Z]} radius={16} color="#9aa5b1" />
        <Tube from={forkSpringBotR} to={[0, R_f,  FORK_Z]} radius={16} color="#9aa5b1" />
        {/* Fork bridge cross-brace */}
        <Tube
          from={[ht_bx * 0.4, ht_by * 0.4 + R_f * 0.6, -FORK_Z]}
          to={  [ht_bx * 0.4, ht_by * 0.4 + R_f * 0.6,  FORK_Z]}
          radius={10} color="#1f4fa0"
        />
        {vis.labels && <Label3D
          pos={[ht_bx / 2, (ht_by + R_f) / 2, FORK_Z + 20]}
          text="FRONT FORK" sub={`offset ${geo.forkOffset} mm`}
          color={LC.fork} dx={10}
        />}
      </>}

      {/* ══ FORK SPRINGS ═════════════════════════════ */}
      {vis.frontForkSprings && <>
        <SpringCoil
          from={forkSpringTopL} to={forkSpringBotL}
          coils={7} wireR={5} helixR={14} color="#d29922"
        />
        <SpringCoil
          from={forkSpringTopR} to={forkSpringBotR}
          coils={7} wireR={5} helixR={14} color="#d29922"
        />
        {vis.labels && <Label3D
          pos={[ht_bx * 0.6, (ht_by + forkSpringBotL[1]) / 2, FORK_Z + 20]}
          text="FORK SPRING"
          sub={`${(suspension.springRateFront).toFixed(1)} N/mm`}
          color="#d29922" dx={10}
        />}
      </>}

      {/* ══ HEAD TUBE ════════════════════════════════ */}
      {vis.headTube && <>
        <Tube from={headBot} to={headTop} radius={28} color="#1f6feb" />
        {vis.labels && <Label3D
          pos={headTop} text="HEAD TUBE"
          sub={`${geo.headAngle}° rake · trail ${results.geometry.trail.toFixed(1)} mm`}
          color={LC.fork} dx={12} dy={-14}
        />}
      </>}

      {/* ══ STEERING AXIS ════════════════════════════ */}
      {vis.steeringAxis && (
        <Tube from={steeringAxisTop} to={steeringAxisBot} radius={2} color="#1f6feb" opacity={0.25} />
      )}

      {/* ══ FRAME RAILS ══════════════════════════════ */}
      {vis.frameRails && <>
        <Tube from={headBaseL} to={pivL} radius={15} color="#444c56" />
        <Tube from={headBaseR} to={pivR} radius={15} color="#444c56" />
        <Tube
          from={[(ht_bx + geo.swingarmPivotX) / 2, (ht_by + geo.swingarmPivotHeight) / 2, -RAIL_Z]}
          to={  [(ht_bx + geo.swingarmPivotX) / 2, (ht_by + geo.swingarmPivotHeight) / 2,  RAIL_Z]}
          radius={10} color="#2d3340"
        />
        {vis.labels && <Label3D
          pos={[(ht_bx + geo.swingarmPivotX) / 2, (ht_by + geo.swingarmPivotHeight) / 2 + 60, RAIL_Z + 20]}
          text="FRAME RAILS" color={LC.frame} dx={8}
        />}
      </>}

      {/* ══ SEAT TUBE ════════════════════════════════ */}
      {vis.seatTube && (
        <Tube from={seatTubeTop} to={swingarmPiv} radius={13} color="#383f4a" />
      )}

      {/* ══ SWINGARM ══════════════════════════════════ */}
      {vis.swingarm && <>
        <Tube from={[geo.swingarmPivotX, geo.swingarmPivotHeight, -SA_Z]} to={[WB, geo.rearAxleHeight, -SA_Z]} radius={16} color="#d29922" />
        <Tube from={[geo.swingarmPivotX, geo.swingarmPivotHeight,  SA_Z]} to={[WB, geo.rearAxleHeight,  SA_Z]} radius={16} color="#d29922" />
        <Tube from={[saBracePos[0], saBracePos[1], -SA_Z]} to={[saBracePos[0], saBracePos[1], SA_Z]} radius={10} color="#b07d18" />
        <Tube
          from={[geo.swingarmPivotX, geo.swingarmPivotHeight, -SA_Z - 10]}
          to={  [geo.swingarmPivotX, geo.swingarmPivotHeight,  SA_Z + 10]}
          radius={24} color="#d29922"
        />
        {vis.labels && <>
          <Label3D
            pos={[(geo.swingarmPivotX + WB) / 2, (geo.swingarmPivotHeight + geo.rearAxleHeight) / 2, SA_Z + 20]}
            text="SWINGARM" sub={`length ${geo.swingarmLength} mm`}
            color={LC.swingarm} dx={8}
          />
          <Label3D pos={swingarmPiv} text="SA PIVOT" sub={`H ${geo.swingarmPivotHeight} mm`} color={LC.swingarm} dx={-90} dy={-22} />
        </>}
      </>}

      {/* ══ REAR SHOCK BODY ══════════════════════════ */}
      {vis.rearShock && <>
        {/* Shock body — outer reservoir */}
        <Tube from={shockBot} to={[shockBot[0], shockBot[1] + 60, 0]} radius={18} color="#6e7681" />
        {/* Shock shaft */}
        <Tube from={[shockBot[0], shockBot[1] + 60, 0]} to={shockTop} radius={10} color="#8b949e" />
        {vis.labels && <Label3D
          pos={[geo.swingarmPivotX + geo.swingarmLength * 0.35, geo.swingarmPivotHeight + suspension.shockTravel * 0.4 + 170, 20]}
          text="REAR SHOCK" sub={`travel ${suspension.shockTravel} mm`}
          color={LC.frame} dx={12}
        />}
      </>}

      {/* ══ REAR SHOCK SPRING ════════════════════════ */}
      {vis.rearShockSpring && <>
        <SpringCoil
          from={shockBot}
          to={shockTop}
          coils={6} wireR={7} helixR={28} color="#d29922"
        />
        {vis.labels && <Label3D
          pos={[shockBot[0] + 40, (shockBot[1] + shockTop[1]) / 2, 20]}
          text="REAR SPRING"
          sub={`${suspension.springRateRear.toFixed(0)} N/mm`}
          color="#d29922" dx={8}
        />}
      </>}

      {/* ══ ENGINE BLOCK ══════════════════════════════ */}
      {vis.engineBlock && <>
        <mesh position={[ex, ey, 0]}>
          <boxGeometry args={[260, 210, 260]} />
          <meshStandardMaterial color="#1c2128" roughness={0.7} metalness={0.6} />
        </mesh>
        {vis.labels && <Label3D pos={[ex, ey + 140, 0]} text="ENGINE" color={LC.muted} dx={12} />}
      </>}

      {/* ══ MASS COMPONENT DOTS ════════════════════════ */}
      {vis.massComponents && massComponents.map((c, i) => (
        <group key={i}>
          <Dot pos={[c.x, c.y, 0]} radius={Math.max(8, Math.sqrt(c.mass) * 4)} color="#1f6feb" emissive="#0d3a8c" />
          {vis.labels && <Label3D
            pos={[c.x, c.y + Math.sqrt(c.mass) * 4 + 10, 0]}
            text={c.label} sub={`${c.mass} kg`}
            color={LC.mass} dx={i % 2 === 0 ? 8 : -60} dy={-10}
          />}
        </group>
      ))}

      {/* ══ CoG MARKER ════════════════════════════════ */}
      {vis.cogMarker && <>
        <Dot pos={cogPos} radius={30} color="#f85149" emissive="#8b0000" />
        <Tube from={[cogPos[0] - 90, cogPos[1], 0]} to={[cogPos[0] + 90, cogPos[1], 0]} radius={4} color="#f85149" />
        <Tube from={[cogPos[0], cogPos[1] - 90, 0]} to={[cogPos[0], cogPos[1] + 90, 0]} radius={4} color="#f85149" />
        <Tube from={[cogPos[0], cogPos[1], -90]}     to={[cogPos[0], cogPos[1], 90]}     radius={4} color="#f85149" />
        <Tube from={cogPos} to={[cogPos[0], 0, 0]} radius={2} color="#f85149" opacity={0.3} />
        {vis.labels && <Label3D
          pos={cogPos} text="CENTRE OF GRAVITY"
          sub={`(${results.cog.X_cg.toFixed(0)}, ${results.cog.Y_cg.toFixed(0)}) mm  ·  ${results.cog.frontPercent.toFixed(1)}% F`}
          color={LC.cog} dx={36} dy={-20}
        />}
      </>}

      {/* ══ HANDLEBAR & FOOTPEGS ════════════════════════ */}
      {vis.ergoControls && <>
        <Tube from={hbL} to={hbR} radius={12} color="#586069" />
        <Tube from={hbL} to={[hbL[0] - 30, hbL[1] - 40, hbL[2]]} radius={11} color="#444c56" />
        <Tube from={hbR} to={[hbR[0] - 30, hbR[1] - 40, hbR[2]]} radius={11} color="#444c56" />
        <Tube from={hbCenter} to={headTop} radius={10} color="#383f4a" />
        <Dot pos={hbL} radius={16} color="#444c56" />
        <Dot pos={hbR} radius={16} color="#444c56" />
        <mesh position={seatPos}>
          <boxGeometry args={[260, 28, 200]} />
          <meshStandardMaterial color="#2d2d2d" roughness={0.9} />
        </mesh>
        <Tube from={pegL} to={[pegL[0], pegL[1], pegL[2] - 30]} radius={8} color="#586069" />
        <Tube from={pegR} to={[pegR[0], pegR[1], pegR[2] + 30]} radius={8} color="#586069" />
        <Dot pos={pegL} radius={14} color="#3fb950" />
        <Dot pos={pegR} radius={14} color="#3fb950" />
        <Tube from={pegL} to={[pegL[0] + 30, pegL[1] - 20, 0]} radius={8} color="#2d3340" />
        <Tube from={pegR} to={[pegR[0] + 30, pegR[1] - 20, 0]} radius={8} color="#2d3340" />
        {vis.labels && <>
          <Label3D pos={hbR} text="HANDLEBAR"
            sub={`knee ${results.ergonomics.kneeAngleDeg.toFixed(0)}° · hip ${results.ergonomics.hipAngleDeg.toFixed(0)}°`}
            color={LC.ergo} dx={12}
          />
          <Label3D pos={seatPos} text="SEAT" sub={`H ${geo.seatHeight} mm`} color={LC.ergo} dx={12} dy={-22} />
          <Label3D pos={pegL} text="FOOTPEG L" color={LC.ergo} dx={-90} />
          <Label3D pos={pegR} text="FOOTPEG R" color={LC.ergo} dx={12}  />
        </>}
      </>}

      {/* ══ ERGO TRIANGLE ═════════════════════════════ */}
      {vis.ergoTriangle && <>
        <Tube from={hbPos}   to={seatPos} radius={3} color="#3fb950" opacity={0.45} />
        <Tube from={seatPos} to={pegPos}  radius={3} color="#3fb950" opacity={0.45} />
        <Tube from={pegPos}  to={hbPos}   radius={3} color="#3fb950" opacity={0.45} />
      </>}

      {/* ══ INSTANT CENTRE ════════════════════════════ */}
      {vis.instantCentre && icValid && <>
        <Dot pos={[IC_abs_x, IC_abs_y, 0]} radius={18} color="#d29922" emissive="#7a5000" />
        <Tube from={[IC_abs_x, IC_abs_y, 0]} to={[WB, 0, 0]} radius={2} color="#d29922" opacity={0.3} />
        {vis.labels && <Label3D
          pos={[IC_abs_x, IC_abs_y, 0]} text="INSTANT CENTRE"
          sub={`AS ${results.antiSquat.antiSquatPercent.toFixed(1)}%`}
          color={LC.ic} dx={12} dy={-22}
        />}
      </>}

      {/* ══ WHEEL LABELS ══════════════════════════════ */}
      {vis.labels && vis.frontWheel && <Label3D
        pos={[0, R_f * 2 + 40, 0]} text="FRONT WHEEL" sub={`\u00d8${geo.frontWheelDia} mm`}
        color={LC.wheel} dx={-60}
      />}
      {vis.labels && vis.rearWheel && <Label3D
        pos={[WB, R_r * 2 + 40, 0]} text="REAR WHEEL" sub={`\u00d8${geo.rearWheelDia} mm`}
        color={LC.wheel} dx={10}
      />}
      {vis.labels && <Label3D
        pos={[WB / 2, -60, 0]} text={`WHEELBASE  ${WB} mm`}
        color={LC.muted} dx={-60}
      />}

      {/* ══ CAD MODELS ════════════════════════════════ */}
      {cadModels.filter(m => m.visible && m.geometry).map(m => (
        <mesh key={m.id} position={[m.posX, m.posY, m.posZ]} scale={[m.scale, m.scale, m.scale]}
          geometry={m.geometry}>
          <meshStandardMaterial color={m.color} transparent opacity={m.opacity} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}

      {/* ── CAMERA CONTROLS ────────────────────────── */}
      <OrbitControls target={camTarget} enableDamping dampingFactor={0.08} minDistance={400} maxDistance={8000} />
      <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
        <GizmoViewport axisColors={['#f85149', '#3fb950', '#1f6feb']} labelColor="#e6edf3" />
      </GizmoHelper>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   EXPORTED CANVAS WRAPPER
   ═══════════════════════════════════════════════════════ */

// ── CAD Import Panel ──────────────────────────────────────────────────────────
function CADImportPanel({ cadModels, setCadModels, onFileLoad }: {
  cadModels: CADModel[];
  setCadModels: React.Dispatch<React.SetStateAction<CADModel[]>>;
  onFileLoad: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme } = useTheme();
  const dk = theme === 'dark';

  const btnStyle: React.CSSProperties = {
    background: dk ? '#161b22' : '#f6f8fa',
    border: `1px solid ${dk ? '#30363d' : '#d0d7de'}`,
    color: dk ? '#c9d1d9' : '#24292f',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
    fontSize: 11, fontFamily: 'Consolas, monospace',
  };

  const panelStyle: React.CSSProperties = {
    position: 'absolute', top: 44, left: 8, zIndex: 10,
    fontFamily: 'Consolas, monospace', fontSize: 11,
    color: dk ? '#c9d1d9' : '#24292f',
  };

  const cardStyle: React.CSSProperties = {
    marginTop: 4,
    background: dk ? '#0d1117cc' : '#ffffffcc',
    border: `1px solid ${dk ? '#30363d' : '#d0d7de'}`,
    borderRadius: 8, padding: '10px 14px',
    backdropFilter: 'blur(6px)',
    minWidth: 260, maxWidth: 320,
  };

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${dragOver ? '#58a6ff' : (dk ? '#30363d' : '#d0d7de')}`,
    borderRadius: 6, padding: '12px 8px',
    textAlign: 'center', cursor: 'pointer',
    background: dragOver ? (dk ? '#1f3a5f44' : '#dbeafe44') : 'transparent',
    color: dk ? '#8b949e' : '#6e7781',
    fontSize: 10, marginBottom: 8,
    transition: 'all 0.15s',
  };

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(onFileLoad);
  }

  return (
    <div style={panelStyle}>
      <button style={btnStyle} onClick={() => setOpen(o => !o)}>
        {open ? '▲' : '▼'} CAD Import
      </button>

      {open && (
        <div style={cardStyle}>
          <div
            style={dropZoneStyle}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            Drop STL / OBJ / GLTF / GLB here<br />or click to browse
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".stl,.obj,.gltf,.glb"
            multiple
            style={{ display: 'none' }}
            onChange={e => { Array.from(e.target.files ?? []).forEach(onFileLoad); e.target.value = ''; }}
          />

          {cadModels.length === 0 && (
            <div style={{ color: dk ? '#8b949e' : '#6e7781', fontSize: 10 }}>No models loaded</div>
          )}

          {cadModels.map(m => (
            <div key={m.id} style={{ marginBottom: 8, borderBottom: `1px solid ${dk ? '#21262d' : '#d8dee4'}`, paddingBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <input type="checkbox" checked={m.visible}
                  onChange={e => setCadModels(p => p.map(x => x.id === m.id ? { ...x, visible: e.target.checked } : x))}
                  style={{ accentColor: '#1f6feb' }}
                />
                <span style={{ flex: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={m.name}>{m.name}</span>
                <button
                  onClick={() => setCadModels(p => p.filter(x => x.id !== m.id))}
                  style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: '#f85149', borderColor: '#f85149' }}
                >✕</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                <span style={{ color: dk ? '#8b949e' : '#6e7781' }}>Scale</span>
                <input type="number" min={0.001} max={100} step={0.01} value={m.scale.toFixed(3)}
                  onChange={e => setCadModels(p => p.map(x => x.id === m.id ? { ...x, scale: parseFloat(e.target.value) || 1 } : x))}
                  style={{ width: 60, background: 'var(--surface,#161b22)', color: 'var(--text,#c9d1d9)', border: '1px solid var(--border,#30363d)', borderRadius: 3, padding: '1px 4px', fontSize: 10 }}
                />
                <span style={{ color: dk ? '#8b949e' : '#6e7781', marginLeft: 4 }}>Opacity</span>
                <input type="range" min={0.05} max={1} step={0.05} value={m.opacity}
                  onChange={e => setCadModels(p => p.map(x => x.id === m.id ? { ...x, opacity: parseFloat(e.target.value) } : x))}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Chassis3D() {
  const geo = useStore(s => s.input.geometry);
  const vis = useStore(s => s.visibility);
  const { theme } = useTheme();
  const WB  = geo.wheelbase;
  const R_f = geo.frontWheelDia / 2;
  const bg  = theme === 'dark' ? '#0a0f15' : '#dde5ef';

  const [cadModels, setCadModels] = useState<CADModel[]>([]);

  const handleCADFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const name = file.name;
    const autoScaleTo = 400;

    if (ext === 'stl') {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const buf = await file.arrayBuffer();
      const geometry = new STLLoader().parse(buf);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const sz = new THREE.Vector3();
      geometry.boundingBox!.getSize(sz);
      const s = autoScaleTo / Math.max(sz.x, sz.y, sz.z, 1);
      setCadModels(p => [...p, { id, name, geometry, posX: geo.wheelbase/2, posY: 400, posZ: 0, scale: s, opacity: 0.75, color: '#58a6ff', visible: true }]);
    } else if (ext === 'obj') {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const text = await file.text();
      const obj = new OBJLoader().parse(text);
      const box = new THREE.Box3().setFromObject(obj);
      const sz = new THREE.Vector3(); box.getSize(sz);
      const s = autoScaleTo / Math.max(sz.x, sz.y, sz.z, 1);
      // OBJ: extract first geometry from the group
      let geom: THREE.BufferGeometry | undefined;
      obj.traverse(child => { if (!geom && (child as THREE.Mesh).isMesh) geom = (child as THREE.Mesh).geometry as THREE.BufferGeometry; });
      setCadModels(p => [...p, { id, name, geometry: geom, posX: geo.wheelbase/2, posY: 400, posZ: 0, scale: s, opacity: 0.75, color: '#58a6ff', visible: true }]);
    } else if (ext === 'gltf' || ext === 'glb') {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const buf = await file.arrayBuffer();
      new GLTFLoader().parse(buf, '', gltf => {
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const sz = new THREE.Vector3(); box.getSize(sz);
        const s = autoScaleTo / Math.max(sz.x, sz.y, sz.z, 1);
        let geom: THREE.BufferGeometry | undefined;
        obj.traverse(child => { if (!geom && (child as THREE.Mesh).isMesh) geom = (child as THREE.Mesh).geometry as THREE.BufferGeometry; });
        setCadModels(p => [...p, { id, name, geometry: geom, posX: geo.wheelbase/2, posY: 400, posZ: 0, scale: s, opacity: 0.75, color: '#58a6ff', visible: true }]);
      }, console.error);
    }
  }, [geo.wheelbase]);

  return (
    <div className="canvas-3d" style={{ width: '100%', height: '100%', background: bg, position: 'relative' }}>
      <Canvas
        camera={{ position: [WB * 0.25, R_f + 700, 2600], fov: 42, near: 10, far: 20000 }}
        shadows gl={{ antialias: true, alpha: false }} style={{ background: bg }}
      >
        <ChassisScene vis={vis} cadModels={cadModels} />
      </Canvas>
      {/* Visibility panel overlay */}
      <VisibilityPanel />
      {/* CAD import panel */}
      <CADImportPanel cadModels={cadModels} setCadModels={setCadModels} onFileLoad={handleCADFile} />
      {/* Corner hint */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        fontFamily: 'Consolas,monospace', fontSize: 10, color: '#444c56',
        pointerEvents: 'none', lineHeight: 1.6,
      }}>
        Left-drag: rotate · Right-drag: pan · Scroll: zoom
      </div>
    </div>
  );
}
