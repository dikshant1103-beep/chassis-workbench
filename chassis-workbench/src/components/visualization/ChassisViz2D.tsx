/**
 * ChassisViz2D.tsx — Engineering-Grade 2D Chassis Visualisation
 *
 * COORDINATE SYSTEM (Physics / World Space):
 *   Origin  : Swingarm pivot (0, 0)
 *   +X      : Forward (toward front of motorcycle)
 *   +Y      : Upward (away from ground)
 *   Units   : millimetres
 *
 * All geometry is computed from the physics engine results — NOTHING is
 * hardcoded. Steering axis, chain force line, trail, IC are all derived
 * from the actual parameter values.
 *
 * Viewport: supports zoom (mouse-wheel) and pan (drag), centered on cursor.
 *
 * References:
 *   Foale (2006) Ch.2 — Steering geometry
 *   Cossalter (2014) §1.1–1.5 — Kinematics and chain geometry
 */

import React, {
  useRef, useState, useCallback, useEffect, useMemo,
} from 'react';
import { useStore } from '../../store/useStore';
import { useTheme } from '../../store/useTheme';
import { detectCategory, getProfile } from './bikeProfiles';

const D2R = Math.PI / 180;
const CHAIN_PITCH = 15.875; // mm — 520 chain

// ─── Viewport state ───────────────────────────────────────────────────────────

interface Viewport {
  /** pixels per mm */
  scale: number;
  /** screen position of physics origin (0,0) = swingarm pivot */
  ox: number;
  oy: number;
}

// ─── Physics-coordinate helpers ───────────────────────────────────────────────

/**
 * Convert a point from OLD coordinate system
 * (origin = front contact patch, +X rearward, +Y up)
 * to PHYSICS coordinate system
 * (origin = swingarm pivot, +X forward, +Y up)
 */
function oldToPhys(
  old_x: number, old_y: number,
  X_sp: number, H_sp: number,
): [number, number] {
  return [X_sp - old_x, old_y - H_sp];
}

function physToOld(
  phys_x: number, phys_y: number,
  X_sp: number, H_sp: number,
): [number, number] {
  return [X_sp - phys_x, phys_y + H_sp];
}

// ─── Toggle panel ─────────────────────────────────────────────────────────────

type ToggleGroup = {
  label: string;
  items: Array<{ key: string; label: string; defaultOn?: boolean; sub?: boolean }>;
};

const TOGGLE_GROUPS: ToggleGroup[] = [
  {
    label: 'COMPONENTS',
    items: [
      { key: 'frontWheel',      label: 'Front Wheel' },
      { key: 'rearWheel',       label: 'Rear Wheel' },
      { key: 'frontForkTubes',  label: 'Fork Tubes' },
      { key: 'headTube',        label: 'Head Tube' },
      { key: 'frameRails',      label: 'Frame' },
      { key: 'swingarm',        label: 'Swingarm' },
      { key: 'engineBlock',     label: 'Engine' },
      { key: 'bikeSilhouette',  label: 'Silhouette' },
      { key: 'massComponents',  label: 'Mass Points' },
    ],
  },
  {
    label: 'GEOMETRY',
    items: [
      { key: 'steeringAxis',    label: 'Steering Axis' },
      { key: 'trailGeometry',   label: 'Trail Line' },
      { key: 'forkAxisLine',    label: 'Fork Axis' },
      { key: 'chainSystem',     label: 'Chain' },
      { key: 'forceLine',       label: 'Chain Force' },
      { key: 'antiSquatLine',   label: 'Anti-Squat' },
      { key: 'loadTransferLine',label: 'Load Transfer' },
      { key: 'wheelbaseLine',   label: 'Wheelbase' },
      { key: 'swingarmExtension', label: 'SA Extension' },
      { key: 'handlebarForkLine', label: 'HBar→Fork' },
    ],
  },
  {
    label: 'ANALYSIS',
    items: [
      { key: 'cogMarker',           label: 'CoG' },
      { key: 'instantCentre',       label: 'IC (anti-squat)' },
      { key: 'ergoTriangle',        label: 'Ergo Triangle' },
      { key: 'ergoControls',        label: 'Ergo Drag Pts' },
      { key: 'forceVectors',        label: 'Force Vectors' },
    ],
  },
  {
    label: 'KINEMATICS',
    items: [
      { key: 'advancedKinematics',  label: 'Adv. Kinematics' },
      { key: 'akRakeLine',    label: 'Rake Line',     sub: true },
      { key: 'akForkOffset',  label: 'Fork Offset',   sub: true },
      { key: 'akNormalTrail', label: 'Normal Trail',  sub: true },
      { key: 'akRearRadius',  label: 'Rear Radius',   sub: true },
      { key: 'akCogCross',    label: 'CoG Cross',     sub: true },
      { key: 'akSquatLine',   label: 'Squat Line',    sub: true },
      { key: 'akPivotLine',   label: 'Pivot Line',    sub: true },
    ],
  },
  {
    label: 'LABELS',
    items: [
      { key: 'labels',          label: 'All Labels' },
      { key: 'dimensionLabels', label: 'Dimensions' },
      { key: 'angleLabels',     label: 'Angles' },
      { key: 'coordLabels',     label: 'Coordinates' },
      { key: 'massLabels',      label: 'Mass Values' },
      { key: 'coordAxes',       label: 'Coord Axes' },
    ],
  },
];

function TogglePanel({ onClose }: { onClose: () => void }) {
  const vis    = useStore(s => s.visibility);
  const setVis = useStore(s => s.setVisibility);

  return (
    <div style={{
      position: 'absolute', top: 40, left: 8, zIndex: 20,
      background: 'rgba(13,17,23,0.96)', border: '1px solid #30363d',
      borderRadius: 8, padding: '10px 12px', width: 190,
      boxShadow: '0 4px 24px #0008',
      maxHeight: 'calc(100% - 60px)', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: 1.2 }}>VISIBILITY</span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: 0,
        }}>✕</button>
      </div>
      {TOGGLE_GROUPS.map(grp => (
        <div key={grp.label} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8.5, color: '#484f58', letterSpacing: 1.5, marginBottom: 4, textTransform: 'uppercase' }}>
            {grp.label}
          </div>
          {grp.items.map(({ key, label, sub }) => {
            const on = (vis as any)[key] ?? false;
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                paddingLeft: sub ? 14 : 0,
                opacity: sub && !(vis as any)['advancedKinematics'] ? 0.35 : 1,
              }}>
                {sub && (
                  <span style={{ color: '#484f58', fontSize: 9, flexShrink: 0, marginLeft: -10 }}>└</span>
                )}
                <button
                  onClick={() => setVis({ [key]: !on } as any)}
                  style={{
                    width: sub ? 24 : 28, height: sub ? 12 : 14,
                    borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: on ? (sub ? '#388bfd' : 'var(--accent2, #3fb950)') : '#21262d',
                    position: 'relative', flexShrink: 0,
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: sub ? 1 : 2, left: on ? (sub ? 12 : 14) : 2,
                    width: sub ? 9 : 10, height: sub ? 9 : 10, borderRadius: '50%',
                    background: on ? '#fff' : '#666',
                    transition: 'left 0.15s',
                  }} />
                </button>
                <span style={{ fontSize: sub ? 9.5 : 10, color: on ? '#e6edf3' : '#8b949e', cursor: 'pointer' }}
                  onClick={() => setVis({ [key]: !on } as any)}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChassisViz2D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 500 });
  const { theme } = useTheme();
  const dk = theme === 'dark';

  // ── Store ──────────────────────────────────────────────────────────────────
  const input    = useStore(s => s.input);
  const results  = useStore(s => s.results);
  const vis      = useStore(s => s.visibility);
  const setErgo  = useStore(s => s.setErgo);
  const familyName = useStore(s => s.familyName ?? '');

  const geo   = input.geometry;
  const chain = input.chain;
  const ergo  = input.ergo;
  const mcs   = input.massComponents;

  // ── Bike profile ──────────────────────────────────────────────────────────
  const profile = useMemo(() => getProfile(detectCategory(familyName)), [familyName]);

  // ── Viewport (zoom + pan) — stored in ref to skip re-render on drag ───────
  const vpRef  = useRef<Viewport>({ scale: 0.42, ox: 0, oy: 0 });
  const [vpVersion, setVpVersion] = useState(0); // bump to force redraw
  const bumpVp = useCallback(() => setVpVersion(v => v + 1), []);

  // ── Pan state ──────────────────────────────────────────────────────────────
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false, lastX: 0, lastY: 0,
  });

  // ── Ergo drag state ────────────────────────────────────────────────────────
  const [draggingErgo, setDraggingErgo] = useState<
    'handlebar' | 'seat' | 'footpeg' | null
  >(null);

  // ── Toggle panel ───────────────────────────────────────────────────────────
  const [showToggle, setShowToggle] = useState(false);

  // ── Blueprint mode ─────────────────────────────────────────────────────────
  // When on: dark navy background, high-contrast line-art rendering,
  // 3-state suspension overlay (extended/current/compressed).
  const [blueprintMode, setBlueprintMode] = useState(false);

  // ── Resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const w = Math.max(width, 400);
      const h = Math.max(height, 300);
      setDims({ w, h });
      // Centre pivot on first mount / resize
      const vp = vpRef.current;
      if (vp.ox === 0 && vp.oy === 0) {
        // Place pivot at 45% from left (front wheel on left), 55% from top
        vp.ox = w * 0.45;
        vp.oy = h * 0.55;
        bumpVp();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpVp]);

  // ─── Physics coordinate transforms ──────────────────────────────────────
  // phys→screen  (X is MIRRORED: +X forward = LEFT on screen, rear = RIGHT)
  const S = useCallback((px: number, py: number): [number, number] => {
    const vp = vpRef.current;
    return [vp.ox - px * vp.scale, vp.oy - py * vp.scale];
  }, [vpVersion]); // eslint-disable-line

  // screen→phys
  const P = useCallback((sx: number, sy: number): [number, number] => {
    const vp = vpRef.current;
    return [(vp.ox - sx) / vp.scale, (vp.oy - sy) / vp.scale];
  }, [vpVersion]); // eslint-disable-line

  // ── Local sag state (visual pre-compression, does NOT write to store) ───────
  const [sagFront_mm, setSagFront] = useState(input.suspension.sagFront ?? 0);
  const [sagRear_mm,  setSagRear]  = useState(input.suspension.sagRear  ?? 0);

  // ── Key geometry in physics coords ─────────────────────────────────────────
  const X_sp = geo.swingarmPivotX;
  const H_sp = geo.swingarmPivotHeight;
  const WB   = geo.wheelbase;
  const R_f  = geo.frontWheelDia / 2;
  const R_r  = geo.rearWheelDia  / 2;
  const headAngle = geo.headAngle;   // α from vertical
  const forkOffset = geo.forkOffset; // f, mm

  // Pivot = (0, 0) in physics by definition
  const PIVOT: [number, number] = [0, 0];

  // ── GEOMETRIC CONSTRAINT: both tyres always touch Y = 0 (ground) ────────
  // Front axle height is ALWAYS the front wheel radius (ground contact).
  // Using R_f directly here overrides geo.frontAxleHeight — the store setter
  // (useStore.setGeometry) enforces frontAxleHeight = frontWheelDia/2 and
  // rearAxleHeight = rearWheelDia/2 whenever a wheel diameter changes, so
  // geo.rearAxleHeight below should always equal R_r on flat ground.
  // (see "Geometric Constraints" section in CLAUDE.md)

  // Front axle: old = (0, R_f) → phys = (X_sp, R_f − H_sp)
  // Force front axle onto ground: height = R_f regardless of stored value.
  const FA: [number, number] = [X_sp, R_f - H_sp];

  // Rear axle: old = (WB, H_ra) → phys = (X_sp − WB, H_ra − H_sp)
  // geo.rearAxleHeight is kept equal to R_r by the store's setGeometry.
  const RA: [number, number] = [X_sp - WB, geo.rearAxleHeight - H_sp];

  // Ground Y in physics
  const GROUND_Y = -H_sp;

  // Front contact patch
  const FC: [number, number] = [X_sp, GROUND_Y];

  // Rear contact patch
  const RC: [number, number] = [X_sp - WB, GROUND_Y];

  // ── Steering geometry ───────────────────────────────────────────────────
  // In physics (+X forward, +Y up):
  //   Steering axis tilts BACKWARD from vertical, angle α from vertical
  //   Direction upward along axis: (-sin α, cos α)
  //   Forward perpendicular to axis: (cos α, sin α)
  //   Front axle is displaced FORWARD from axis by forkOffset f
  //   → head_tube_point = FA − f*(cos α, sin α)
  const sinA = Math.sin(headAngle * D2R);
  const cosA = Math.cos(headAngle * D2R);

  const HT: [number, number] = [
    FA[0] - forkOffset * cosA,
    FA[1] - forkOffset * sinA,
  ];

  // Steering axis: passes through HT, direction (-sinA, cosA) going up-and-back
  // Extend upward by 500mm along axis (head tube top)
  const SA_TOP: [number, number] = [HT[0] - sinA * 500, HT[1] + cosA * 500];

  // Steering axis ground intersection:
  //   Y = GROUND_Y = HT[1] + t*cosA  → t = (GROUND_Y − HT[1])/cosA
  const t_gnd = (GROUND_Y - HT[1]) / cosA;
  const SA_GND: [number, number] = [HT[0] + (-sinA) * t_gnd, GROUND_Y];

  // Head tube top (extend 80mm along axis upward)
  const HT_TOP: [number, number] = [HT[0] - sinA * 80, HT[1] + cosA * 80];

  // ── Static sag — pre-compresses suspension (visual, ground-contact preserved) ─
  // Front sag: fork crown slides along the steering axis direction.
  // Rear sag effect on pivot height is available via sagRear_mm (used by UI sliders)
  // but pivot offset rendering is not yet implemented — front sag drives HT position only.
  const FA_sag_dx = sagFront_mm * Math.sin(headAngle * D2R);   // rearward in physics
  const FA_sag_dy = -sagFront_mm * Math.cos(headAngle * D2R);  // downward in physics

  // Sag-adjusted head-tube bottom (HT moves with fork crown)
  const HT_sag: [number, number] = [HT[0] + FA_sag_dx, HT[1] + FA_sag_dy];
  const HT_TOP_sag: [number, number] = [HT_TOP[0] + FA_sag_dx, HT_TOP[1] + FA_sag_dy];

  // ── Tyre sidewall heights (from class profile TireSpec) ──────────────────
  // sidewall_height = section_width × aspect_ratio / 100  (mm)
  // Example sport: front 120/70 → 84mm, rear 190/55 → 104.5mm
  //   → rear annulus is ~24% thicker than front — both MUST be visually distinct.
  const tireSidewall_f = profile.tireSpec.frontWidth * profile.tireSpec.frontAspect / 100;
  const tireSidewall_r = profile.tireSpec.rearWidth  * profile.tireSpec.rearAspect  / 100;
  // Clamp at 0.45× (not 0.55×) so wide-section tyres can show correct full sidewall depth
  const R_f_rim = Math.max(R_f - tireSidewall_f, R_f * 0.45);
  const R_r_rim = Math.max(R_r - tireSidewall_r, R_r * 0.45);

  // Head tube cylinder corners are computed in screen space inline at render
  // time using sHtSag / sHtTopSag — no physics-space corner points needed.
  const HT_TUBE_R = 22; // mm — typical head tube outer radius (used at render time via sc)

  // ── Chain geometry ─────────────────────────────────────────────────────
  // Drive sprocket: old = (X_sp + sprocketCenterX, H_sp + sprocketCenterY)
  //   phys = (-sprocketCenterX, sprocketCenterY)
  const DS: [number, number] = [-chain.sprocketCenterX, chain.sprocketCenterY];
  const RS: [number, number] = RA; // rear sprocket = rear axle

  const r_drive = (chain.frontSprocket * CHAIN_PITCH) / (2 * Math.PI);
  const r_rear  = (chain.rearSprocket  * CHAIN_PITCH) / (2 * Math.PI);

  // Center-to-center vector from DS to RS (in physics: RS is behind DS → negative X)
  const cd_dx = RS[0] - DS[0]; // typically negative (rear is behind)
  const cd_dy = RS[1] - DS[1];
  const cd_len = Math.sqrt(cd_dx * cd_dx + cd_dy * cd_dy) || 1;

  // Unit normal perpendicular to center-to-center line, rotated 90° CCW
  // (for top-run which goes above on a standard bike)
  const cd_nx = -cd_dy / cd_len;
  const cd_ny =  cd_dx / cd_len;

  // External tangent offset for TENSION (top/drive) chain run:
  //   α_offset = arcsin((r_rear − r_drive) / D)   (r_rear > r_drive → tension run tilts up)
  const sinOffset = Math.abs(r_rear - r_drive) / cd_len;
  const offsetAngle = Math.abs(sinOffset) <= 1 ? Math.asin(sinOffset) : Math.PI / 2;

  // Rotate the normal by offsetAngle toward the "heavier" side (rear sprocket side)
  // Tension-run tangent direction (from DS toward RS):
  const baseAngle = Math.atan2(cd_dy, cd_dx); // angle of DS→RS
  // Tangent is perpendicular to the line from DS center to tangent point on DS
  // For external tangent (tension/top), tangent angle = baseAngle + offsetAngle (approximately)
  const tangentAngle = baseAngle + (r_rear > r_drive ? offsetAngle : -offsetAngle);

  // Tension-run endpoints: offset each circle by r in the normal direction
  // NOTE: In physics coords (+X forward) the CCW normal from DS→RS points "above"
  //       the line of centres — this is the physical TENSION side during acceleration.
  const CT_nx = -Math.sin(tangentAngle); // normal to tangent direction
  const CT_ny =  Math.cos(tangentAngle);

  // CHAIN_TENSION: physical drive/tension side (top run during acceleration) — used for IC construction
  const CHAIN_TENSION_A: [number, number] = [DS[0] + CT_nx * r_drive, DS[1] + CT_ny * r_drive];
  const CHAIN_TENSION_B: [number, number] = [RS[0] + CT_nx * r_rear,  RS[1] + CT_ny * r_rear];

  // CHAIN_SLACK: physical return/slack side (bottom run) — cd_n normal points opposite side
  const CHAIN_SLACK_A: [number, number] = [DS[0] - cd_nx * r_drive, DS[1] - cd_ny * r_drive];
  const CHAIN_SLACK_B: [number, number] = [RS[0] - cd_nx * r_rear,  RS[1] - cd_ny * r_rear];

  // ── Anti-squat / IC ─────────────────────────────────────────────────────
  // IC is read directly from results.antiSquat, which is computed by
  // computeAntiSquatUnified in computeAll.ts.  IC_x/IC_y are in OLD coords
  // (origin = front contact patch, +X rearward) — convert to physics here.
  //
  // DO NOT re-derive the IC here. Any independent derivation risks diverging
  // from the engine on swingarm-angle method (atan2 vs asin) and on whether
  // chain.chainForceAngle is additive (it is NOT — the unified engine ignores
  // it and auto-computes the angle from sprocket geometry).
  //
  // Coordinate mapping: oldToPhys(IC_x_old, IC_y_old, X_sp, H_sp)
  //   → phys_x = X_sp − IC_x_old  (flips X axis: old +rearward → phys +forward)
  //   → phys_y = IC_y_old − H_sp  (shifts Y origin from ground to pivot)
  const IC_fromAnalysis: [number, number] = useMemo(() => {
    const { IC_x, IC_y } = results.antiSquat;
    if (!isFinite(IC_x) || !isFinite(IC_y)) return [9999, 9999];
    return oldToPhys(IC_x, IC_y, X_sp, H_sp);
  }, [results.antiSquat.IC_x, results.antiSquat.IC_y, X_sp, H_sp]);

  // ── CoG in physics ──────────────────────────────────────────────────────
  const COG: [number, number] = oldToPhys(
    results.cog.X_cg, results.cog.Y_cg, X_sp, H_sp,
  );

  // ── Advanced kinematics derived points ──────────────────────────────────
  //
  // NT_FOOT: foot of perpendicular from front contact patch (FC) to steering
  //   axis — the segment FC → NT_FOOT has length = mechanical trail.
  //   SA direction (upward): u_sa = (-sinA, cosA).
  //   t = dot(FC − HT, u_sa);  NT_FOOT = HT + t * u_sa
  const _t_nt = (FC[0] - HT[0]) * (-sinA) + (FC[1] - HT[1]) * cosA;
  const NT_FOOT: [number, number] = [
    HT[0] + (-sinA) * _t_nt,
    HT[1] +   cosA  * _t_nt,
  ];

  // COG_GND: CoG projected vertically straight down to ground
  const COG_GND: [number, number] = [COG[0], GROUND_Y];

  // SQUAT_INTERSECT: where the squat-force line (RC → IC, or RC → PIVOT for CVT)
  //   meets the CoG vertical plane (x = COG[0]).
  //   Chain drive: anchor = IC_fromAnalysis
  //   CVT / belt:  anchor = PIVOT (no chain IC defined)
  //
  //   Parametric line:  P(t) = RC + t * (anchor − RC)
  //   At x = COG[0]:    t = (COG[0] − RC[0]) / (anchor[0] − RC[0])
  //   intersect_y       = RC[1] + t * (anchor[1] − RC[1])
  //
  //   Visual AS%:  (intersect_height_above_ground / Y_cg) × 100
  const _squatAnchor: [number, number] = chain.isCVT ? PIVOT : IC_fromAnalysis;
  const _sq_dx = _squatAnchor[0] - RC[0];
  const _sq_dy = _squatAnchor[1] - RC[1];
  const _t_sq  = Math.abs(_sq_dx) > 0.001 ? (COG[0] - RC[0]) / _sq_dx : Infinity;
  const SQUAT_INTERSECT: [number, number] = isFinite(_t_sq)
    ? [COG[0], RC[1] + _t_sq * _sq_dy]
    : [COG[0], GROUND_Y];
  // Height of intersection above ground (RC[1] == GROUND_Y, so subtract it)
  const _sqIntersectH = SQUAT_INTERSECT[1] - GROUND_Y;   // mm above ground
  const _cogH         = results.cog.Y_cg;                  // mm above ground (old coords)
  const AS_kin_pct    = _cogH > 0 ? (_sqIntersectH / _cogH) * 100 : 0;

  // ── Load transfer line: RC → CoG (extended) ────────────────────────────
  const lt_dx = COG[0] - RC[0], lt_dy = COG[1] - RC[1];
  const lt_len = Math.sqrt(lt_dx * lt_dx + lt_dy * lt_dy) || 1;
  const LT_END: [number, number] = [
    COG[0] + (lt_dx / lt_len) * 400,
    COG[1] + (lt_dy / lt_len) * 400,
  ];

  // ── Ergo points in physics ──────────────────────────────────────────────
  const ERGO_H = oldToPhys(ergo.handlebarX, ergo.handlebarY, X_sp, H_sp);
  const ERGO_S = oldToPhys(ergo.seatX,      ergo.seatY,      X_sp, H_sp);
  const ERGO_P = oldToPhys(ergo.footpegX,   ergo.footpegY,   X_sp, H_sp);

  // ── Handlebar riser geometry in physics ─────────────────────────────────
  // The base is the UPPER TRIPLE CLAMP, NOT HT_TOP_sag.
  // HT_TOP_sag is the short head-tube cylinder (80mm from fork crown, near axle).
  // The upper triple clamp is at FA + forkLength × u_sa — the top of the fork stanchions.
  // For sport (forkLength 720mm, 24° rake): this gives ~960mm height, matching stored data.
  //
  // u_sa   = (-sinA, cosA)  — along steering axis, upward-and-rearward
  // u_perp = (cosA,  sinA)  — perpendicular to axis, forward-and-upward
  //
  // Sag: fork compresses by sagFront_mm → upper TC drops by (FA_sag_dx, FA_sag_dy)
  const riserH_mm = ergo.riserHeight_mm ?? 50;
  const hbReach   = ergo.handlebarReach_mm ?? 0;
  // Upper triple clamp (no sag)
  const UPPER_TC: [number, number] = [
    FA[0] + (-sinA) * geo.forkLength,
    FA[1] +   cosA  * geo.forkLength,
  ];
  // Sag-adjusted upper triple clamp
  const UPPER_TC_sag: [number, number] = [
    UPPER_TC[0] + FA_sag_dx,
    UPPER_TC[1] + FA_sag_dy,
  ];
  // Riser top: extend further along steering axis by riserHeight_mm
  const RISER_TOP: [number, number] = [
    UPPER_TC_sag[0] + (-sinA) * riserH_mm,
    UPPER_TC_sag[1] +   cosA  * riserH_mm,
  ];
  // Grip end: from riser top, perpendicular offset for reach
  const HB_GRIP: [number, number] = [
    RISER_TOP[0] + cosA * hbReach,
    RISER_TOP[1] + sinA * hbReach,
  ];

  // ── Theme colours ──────────────────────────────────────────────────────
  // Three palettes: dark UI, light UI, blueprint (always dark navy).
  // Blueprint mode takes precedence over dark/light toggle.
  const C = blueprintMode ? {
    // ── Blueprint palette — high-contrast line-art on deep navy ──────────
    bg:          '#070d1a',
    ground:      '#1c2a4a',
    groundFill:  '#070d1a',
    grid:        '#0d1627',
    wheel:       '#a5d6ff',
    hub:         '#58a6ff',
    fork:        '#58a6ff',
    forkTube:    '#79b8ff',
    tripleClamp: '#79b8ff',
    headTube:    '#58a6ff',
    steerAxis:   '#388bfd',
    frame:       '#79b8ff',
    swingarm:    '#e3b341',
    trail:       '#56d364',
    cog:         '#f85149',
    ic:          '#e3b341',
    chain:       '#f0883e',
    force:       '#ffa657',
    ltLine:      '#e3b341',
    asLine:      '#d2a8ff',
    ergo:        '#56d364',
    muted:       '#4d6a8a',
    label:       '#a5d6ff',
    labelBg:     'rgba(7,13,26,0.88)',
    axisX:       '#f85149',
    axisY:       '#56d364',
    pivot:       '#a5d6ff',
    silhouette:  'transparent',
    silStroke:   '#1c2a4a',
  } : {
    // ── Normal palette (dark / light) ────────────────────────────────────
    bg:          dk ? '#0a0f15' : '#eaf0f7',
    ground:      dk ? '#30363d' : '#b0bac4',
    groundFill:  dk ? '#0f1419' : '#d4dde6',
    grid:        dk ? '#161b22' : '#d0dae4',
    wheel:       dk ? '#8b949e' : '#57606a',
    hub:         dk ? '#6e7681' : '#8c959f',
    fork:        dk ? '#1f6feb' : '#0969da',
    forkTube:    dk ? '#4d94f5' : '#3b82cc',
    tripleClamp: dk ? '#79b8ff' : '#0550ae',
    headTube:    dk ? '#1f6feb' : '#0969da',
    steerAxis:   dk ? '#1f6feb' : '#0969da',
    frame:       dk ? '#4d5566' : '#8c959f',
    swingarm:    dk ? '#d29922' : '#9a6700',
    trail:       dk ? '#3fb950' : '#1a7f37',
    cog:         '#f85149',
    ic:          '#d29922',
    chain:       '#f85149',
    force:       '#ff6b6b',
    ltLine:      '#d29922',
    asLine:      '#a371f7',
    ergo:        '#3fb950',
    muted:       dk ? '#8b949e' : '#57606a',
    label:       dk ? '#e6edf3' : '#1f2328',
    labelBg:     dk ? 'rgba(13,17,23,0.8)' : 'rgba(255,255,255,0.85)',
    axisX:       '#e03131',
    axisY:       '#2f9e44',
    pivot:       dk ? '#f0f6fc' : '#1f2328',
    silhouette:  profile.accentColor + '18',
    silStroke:   profile.accentColor + '55',
  };
  const font = "Consolas,'Courier New',monospace";

  // ── Mouse / touch event handlers ────────────────────────────────────────

  const resetView = useCallback(() => {
    const vp = vpRef.current;
    vp.scale = 0.42;
    vp.ox = dims.w * 0.45;
    vp.oy = dims.h * 0.55;
    bumpVp();
  }, [dims, bumpVp]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const vp    = vpRef.current;
    const rect  = containerRef.current!.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(0.08, Math.min(8, vp.scale * factor));
    // Zoom centered on cursor
    vp.ox = mx - (mx - vp.ox) * (newScale / vp.scale);
    vp.oy = my - (my - vp.oy) * (newScale / vp.scale);
    vp.scale = newScale;
    bumpVp();
  }, [bumpVp]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Check if clicking on an ergo drag handle
    if (vis.ergoControls) {
      const rect = containerRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [px, py] = P(sx, sy);
      const HIT = 12 / vpRef.current.scale; // 12px hit radius in mm
      const check = (pt: [number, number], key: typeof draggingErgo) => {
        const dx = px - pt[0], dy = py - pt[1];
        if (Math.sqrt(dx * dx + dy * dy) < HIT) {
          setDraggingErgo(key);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return true;
        }
        return false;
      };
      if (check(ERGO_H, 'handlebar')) return;
      if (check(ERGO_S, 'seat'))      return;
      if (check(ERGO_P, 'footpeg'))   return;
    }
    // Start pan
    panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [P, vis.ergoControls, ERGO_H, ERGO_S, ERGO_P, draggingErgo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingErgo) {
      const rect = containerRef.current!.getBoundingClientRect();
      const [px, py] = P(e.clientX - rect.left, e.clientY - rect.top);
      const [ox, oy] = physToOld(px, py, X_sp, H_sp);
      if (draggingErgo === 'handlebar') setErgo({ handlebarX: Math.round(ox), handlebarY: Math.round(oy) });
      if (draggingErgo === 'seat')      setErgo({ seatX: Math.round(ox), seatY: Math.round(oy) });
      if (draggingErgo === 'footpeg')   setErgo({ footpegX: Math.round(ox), footpegY: Math.round(oy) });
      return;
    }
    if (!panRef.current.active) return;
    const dx = e.clientX - panRef.current.lastX;
    const dy = e.clientY - panRef.current.lastY;
    vpRef.current.ox += dx;
    vpRef.current.oy += dy;
    panRef.current.lastX = e.clientX;
    panRef.current.lastY = e.clientY;
    bumpVp();
  }, [draggingErgo, P, X_sp, H_sp, setErgo, bumpVp]);

  const onPointerUp = useCallback(() => {
    panRef.current.active = false;
    setDraggingErgo(null);
  }, []);

  // ─── Derived screen coordinates ──────────────────────────────────────────
  // HT_L1/R1/L2/R2 (cylinder corners) and PIVOT_sag are computed inline at
  // render time using sHtSag/sHtTopSag, so no screen-space versions needed here.
  const [sPivot, sFa, sRa, sHt, _sHtTop, sSaGnd, sSaTop,
    sFc, sRc, sCog, sIc, sDs, sRs,
    sChainTenA, sChainTenB, sChainSlkA, sChainSlkB,
    sErgoH, sErgoS, sErgoP, sLtEnd,
    sHtSag, sHtTopSag,
    sUpperTCSag, sRiserTop, sHbGrip,
    sNtFoot, sCogGnd, sSquatIntersect,
  ] = useMemo(() => [
    S(...PIVOT), S(...FA), S(...RA), S(...HT), S(...HT_TOP),
    S(...SA_GND), S(...SA_TOP),
    S(...FC), S(...RC),
    S(...COG), S(...IC_fromAnalysis), S(...DS), S(...RS),
    S(...CHAIN_TENSION_A), S(...CHAIN_TENSION_B), S(...CHAIN_SLACK_A), S(...CHAIN_SLACK_B),
    S(...ERGO_H), S(...ERGO_S), S(...ERGO_P), S(...LT_END),
    S(...HT_sag), S(...HT_TOP_sag),
    S(...UPPER_TC_sag), S(...RISER_TOP), S(...HB_GRIP),
    S(...NT_FOOT), S(...COG_GND), S(...SQUAT_INTERSECT),
  ], [S, vpVersion, // eslint-disable-line
    FA, RA, HT, HT_TOP, SA_GND, SA_TOP, FC, RC,
    COG, IC_fromAnalysis, DS, RS,
    CHAIN_TENSION_A, CHAIN_TENSION_B, CHAIN_SLACK_A, CHAIN_SLACK_B,
    ERGO_H, ERGO_S, ERGO_P, LT_END,
    HT_sag, HT_TOP_sag,
    UPPER_TC_sag, RISER_TOP, HB_GRIP,
    NT_FOOT, COG_GND, SQUAT_INTERSECT,
  ]);

  // ── Sync computed handlebar grip → ergo store ───────────────────────────
  // HB_GRIP is derived from riser geometry (steering-axis-coupled).
  // Syncing back ensures the Ergo engine and Ergo panel see the physically
  // correct grip location rather than a stale manually-entered value.
  useEffect(() => {
    const [hbX_old, hbY_old] = physToOld(HB_GRIP[0], HB_GRIP[1], X_sp, H_sp);
    setErgo({ handlebarX: Math.round(hbX_old), handlebarY: Math.round(hbY_old) });
  }, [HB_GRIP[0], HB_GRIP[1], X_sp, H_sp]); // eslint-disable-line

  const sc = vpRef.current.scale;
  const sRf = R_f * sc, sRr = R_r * sc;
  const sRfRim = R_f_rim * sc, sRrRim = R_r_rim * sc;  // rim radii
  const sDriveR = Math.max(r_drive * sc, 4), sRearR = Math.max(r_rear * sc, 4);

  // ─── Silhouette (bike type outline) ─────────────────────────────────────
  const silhouette = useMemo(() => {
    // Outline is normalised [0,1] in front→rear and 0→rideH
    // Map to physics: X = FA[0] + (FA[0]−RA[0])*(1−t) = FA[0] − (FA[0]−RA[0])*t
    // for t in [0,1] front→rear
    // Y = GROUND_Y + rideH * v   where rideH = seatHeight − H_sp (approx CoG height * 1.6)
    const rideH = Math.max(geo.seatHeight - H_sp, 400);
    return profile.outline.map(([t, v]) => {
      const px = FA[0] - (FA[0] - RA[0]) * t;
      const py = GROUND_Y + rideH * v;
      return S(px, py);
    });
  }, [profile, FA, RA, GROUND_Y, geo.seatHeight, H_sp, S, vpVersion]); // eslint-disable-line

  const silPath = useMemo(() => {
    if (silhouette.length < 2) return '';
    const [x0, y0] = silhouette[0];
    const pts = silhouette.slice(1).map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return `M${x0.toFixed(1)},${y0.toFixed(1)} ${pts} L${sRc[0].toFixed(1)},${sRc[1].toFixed(1)} L${sFc[0].toFixed(1)},${sFc[1].toFixed(1)} Z`;
  }, [silhouette, sRc, sFc]);

  // ─── Blueprint: 3-state suspension positions ─────────────────────────────
  // Reuses existing kinematic variables — no new physics, only different sag inputs.
  // Extended  (green  dashed): sag = 0  — full extension, spring at free length
  // Current   (solid  blue):  sag = sagFront_mm / sagRear_mm — slider value
  // Compressed(red    dashed): sag = 75% forkTravel / 60% shockTravel
  //
  // Ground contact law is preserved: both axles stay at Y=0.
  // Front:  fork crown translates along steering axis (same formula as main sag).
  // Rear:   swingarm pivot drops, axle stays on ground → swingarm angle steepens.
  const bpStates = useMemo(() => {
    if (!blueprintMode) return null;
    const fTravel = input.suspension.forkTravel;
    const rTravel = input.suspension.shockTravel;
    const saRad   = results.geometry.swingarmAngleRad;

    const state = (sagF: number, sagR: number) => {
      // Front fork: crown moves along steering axis by sagF mm
      const dxF = sagF * sinA, dyF = -sagF * cosA;
      const htS:  [number,number] = [HT[0]     + dxF, HT[1]     + dyF];
      const htTS: [number,number] = [HT_TOP[0] + dxF, HT_TOP[1] + dyF];
      // Rear: pivot drops, axle stays at geo.rearAxleHeight
      const pivDrop = sagR * Math.abs(Math.sin(saRad));
      const raPhy:  [number,number] = [X_sp - WB, geo.rearAxleHeight - (H_sp - pivDrop)];
      const pivOff: [number,number] = [0, -pivDrop];   // physics offset from origin
      return { htS, htTS, raPhy, pivOff };
    };

    return {
      ext: state(0, 0),
      cur: state(sagFront_mm, sagRear_mm),
      cmp: state(fTravel * 0.75, rTravel * 0.60),
    };
  }, [
    blueprintMode, HT, HT_TOP, sinA, cosA,
    sagFront_mm, sagRear_mm,
    geo.rearAxleHeight, H_sp, X_sp, WB,
    results.geometry.swingarmAngleRad,
    input.suspension.forkTravel, input.suspension.shockTravel,
  ]);

  // ─── Scale bar ────────────────────────────────────────────────────────
  const scaleBarMm = 200;
  const scaleBarPx = scaleBarMm * sc;

  const { w, h } = dims;

  // ─── Labels helper ────────────────────────────────────────────────────
  const showLabels = vis.labels;
  function Lbl({ x, y, text, anchor = 'start', dy = -6, color = C.muted, fontSize = 9 }: {
    x: number; y: number; text: string; anchor?: string;
    dy?: number; color?: string; fontSize?: number;
  }) {
    if (!showLabels) return null;
    return (
      <text x={x} y={y + dy} textAnchor={anchor as any}
        fill={color} fontSize={fontSize} fontFamily={font}
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {text}
      </text>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: C.bg, position: 'relative', overflow: 'hidden' }}
      onWheel={onWheel as any}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <svg
        ref={svgRef}
        width={w} height={h}
        style={{ display: 'block', cursor: draggingErgo ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <defs>
          {/* Arrow markers */}
          {[
            ['arr-green', C.trail],
            ['arr-grey',  C.muted],
            ['arr-red',   C.chain],
            ['arr-yellow',C.ic],
            ['arr-purple',C.asLine],
            ['arr-blue',  C.fork],
          ].map(([id, col]) => (
            <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill={col} />
            </marker>
          ))}
          {/* Grid pattern */}
          <pattern id="grid100" x="0" y="0" width={100 * sc} height={100 * sc} patternUnits="userSpaceOnUse"
            patternTransform={`translate(${vpRef.current.ox % (100 * sc)},${vpRef.current.oy % (100 * sc)})`}>
            <path d={`M ${100 * sc} 0 L 0 0 0 ${100 * sc}`} fill="none" stroke={C.grid} strokeWidth={0.4} />
          </pattern>
          <pattern id="grid500" x="0" y="0" width={500 * sc} height={500 * sc} patternUnits="userSpaceOnUse"
            patternTransform={`translate(${vpRef.current.ox % (500 * sc)},${vpRef.current.oy % (500 * sc)})`}>
            <path d={`M ${500 * sc} 0 L 0 0 0 ${500 * sc}`} fill="none" stroke={C.grid} strokeWidth={0.8} strokeOpacity={0.6} />
          </pattern>
        </defs>

        {/* ── Grid ── */}
        <rect width={w} height={h} fill="url(#grid100)" />
        <rect width={w} height={h} fill="url(#grid500)" />

        {/* ── Ground fill ── */}
        <rect x={0} y={sPivot[1] + H_sp * sc} width={w} height={h}
          fill={C.groundFill} opacity={0.4} />
        <line x1={0} y1={sPivot[1] + H_sp * sc} x2={w} y2={sPivot[1] + H_sp * sc}
          stroke={C.ground} strokeWidth={2} />
        {vis.labels && (
          <text x={8} y={sPivot[1] + H_sp * sc + 14} fill={C.muted} fontSize={9} fontFamily={font}>
            GROUND LEVEL
          </text>
        )}

        {/* ── Coordinate axes (pivot-centred) ── */}
        {vis.coordAxes && (() => {
          const axLen = 80;
          return (
            <g>
              {/* X-axis (forward = LEFT on screen after mirror) */}
              <line x1={sPivot[0]} y1={sPivot[1]} x2={sPivot[0] - axLen} y2={sPivot[1]}
                stroke={C.axisX} strokeWidth={1.5} markerEnd="url(#arr-red)" />
              <text x={sPivot[0] - axLen - 34} y={sPivot[1] + 4}
                fill={C.axisX} fontSize={9} fontFamily={font}>+X fwd</text>
              {/* Y-axis (up) */}
              <line x1={sPivot[0]} y1={sPivot[1]} x2={sPivot[0]} y2={sPivot[1] - axLen}
                stroke={C.axisY} strokeWidth={1.5} markerEnd="url(#arr-green)" />
              <text x={sPivot[0] + 4} y={sPivot[1] - axLen - 4}
                fill={C.axisY} fontSize={9} fontFamily={font}>+Y up</text>
              {/* Origin label */}
              <text x={sPivot[0] + 6} y={sPivot[1] + 14}
                fill={C.muted} fontSize={8} fontFamily={font}>PIVOT (0,0)</text>
            </g>
          );
        })()}

        {/* ── Wheelbase dimension line ── */}
        {vis.wheelbaseLine && (
          <g>
            <line x1={sFc[0]} y1={sFc[1] + 22} x2={sRc[0]} y2={sRc[1] + 22}
              stroke={C.muted} strokeWidth={1} markerEnd="url(#arr-grey)" />
            <line x1={sFc[0]} y1={sFc[1]} x2={sFc[0]} y2={sFc[1] + 25} stroke={C.muted} strokeWidth={0.7} />
            <line x1={sRc[0]} y1={sRc[1]} x2={sRc[0]} y2={sRc[1] + 25} stroke={C.muted} strokeWidth={0.7} />
            {vis.dimensionLabels && (
              <text x={(sFc[0] + sRc[0]) / 2} y={sFc[1] + 36}
                fill={C.muted} fontSize={10} fontFamily={font} textAnchor="middle">
                WB {WB} mm
              </text>
            )}
          </g>
        )}

        {/* ── Pivot-to-axle line (optional) ── */}
        {vis.pivotAxleLine && (
          <g>
            <line x1={sPivot[0]} y1={sPivot[1]} x2={sFa[0]} y2={sFa[1]}
              stroke={C.muted} strokeWidth={0.8} strokeDasharray="4 4" strokeOpacity={0.5} />
            <line x1={sPivot[0]} y1={sPivot[1]} x2={sRa[0]} y2={sRa[1]}
              stroke={C.muted} strokeWidth={0.8} strokeDasharray="4 4" strokeOpacity={0.5} />
          </g>
        )}

        {/* ── Bike silhouette outline (no fill — structural stroke only) ── */}
        {vis.bikeSilhouette && silPath && (
          <path d={silPath} fill="none" stroke={C.silStroke} strokeWidth={1.5} strokeOpacity={0.7} />
        )}

        {/* ── Front Wheel — with tyre profile (sidewall + rim) ── */}
        {vis.frontWheel && (
          <g>
            {/* Tyre sidewall fill (annulus between tread and rim) */}
            <circle cx={sFa[0]} cy={sFa[1]} r={sRf}
              fill={dk ? '#1a2330' : '#d8dde4'} stroke="none" />
            <circle cx={sFa[0]} cy={sFa[1]} r={sRfRim}
              fill={C.bg} stroke="none" />
            {/* Tread outer */}
            <circle cx={sFa[0]} cy={sFa[1]} r={sRf}
              fill="none" stroke={C.wheel} strokeWidth={2.5} />
            {/* Rim ring */}
            <circle cx={sFa[0]} cy={sFa[1]} r={sRfRim}
              fill="none" stroke={C.wheel} strokeWidth={1.5} strokeOpacity={0.7} />
            {/* Rim inner detail */}
            <circle cx={sFa[0]} cy={sFa[1]} r={sRfRim * 0.82}
              fill="none" stroke={C.wheel} strokeWidth={0.6} strokeOpacity={0.3} />
            {/* Spokes */}
            {[0, 30, 60, 90, 120, 150].map(a => (
              <line key={a}
                x1={sFa[0] + Math.cos(a*D2R)*sRfRim*0.82} y1={sFa[1] + Math.sin(a*D2R)*sRfRim*0.82}
                x2={sFa[0] - Math.cos(a*D2R)*sRfRim*0.82} y2={sFa[1] - Math.sin(a*D2R)*sRfRim*0.82}
                stroke={C.wheel} strokeWidth={0.7} strokeOpacity={0.2} />
            ))}
            <circle cx={sFa[0]} cy={sFa[1]} r={7} fill={C.hub} />
            <circle cx={sFa[0]} cy={sFa[1]} r={3} fill={C.bg} />
            {vis.labels && (
              <text x={sFa[0]} y={sFa[1] - sRf - 7}
                fill={C.muted} fontSize={9} fontFamily={font} textAnchor="middle">
                {profile.tireSpec.frontWidth}/{profile.tireSpec.frontAspect}
              </text>
            )}
          </g>
        )}

        {/* ── Rear Wheel — with tyre profile (sidewall + rim) ── */}
        {vis.rearWheel && (
          <g>
            {/* Tyre sidewall fill */}
            <circle cx={sRa[0]} cy={sRa[1]} r={sRr}
              fill={dk ? '#1a2330' : '#d8dde4'} stroke="none" />
            <circle cx={sRa[0]} cy={sRa[1]} r={sRrRim}
              fill={C.bg} stroke="none" />
            {/* Tread outer */}
            <circle cx={sRa[0]} cy={sRa[1]} r={sRr}
              fill="none" stroke={C.wheel} strokeWidth={3} />
            {/* Rim ring */}
            <circle cx={sRa[0]} cy={sRa[1]} r={sRrRim}
              fill="none" stroke={C.wheel} strokeWidth={1.5} strokeOpacity={0.7} />
            <circle cx={sRa[0]} cy={sRa[1]} r={sRrRim * 0.82}
              fill="none" stroke={C.wheel} strokeWidth={0.6} strokeOpacity={0.3} />
            {[0, 30, 60, 90, 120, 150].map(a => (
              <line key={a}
                x1={sRa[0] + Math.cos(a*D2R)*sRrRim*0.82} y1={sRa[1] + Math.sin(a*D2R)*sRrRim*0.82}
                x2={sRa[0] - Math.cos(a*D2R)*sRrRim*0.82} y2={sRa[1] - Math.sin(a*D2R)*sRrRim*0.82}
                stroke={C.wheel} strokeWidth={0.7} strokeOpacity={0.2} />
            ))}
            <circle cx={sRa[0]} cy={sRa[1]} r={7} fill={C.hub} />
            <circle cx={sRa[0]} cy={sRa[1]} r={3} fill={C.bg} />
            {vis.labels && (
              <text x={sRa[0]} y={sRa[1] - sRr - 7}
                fill={C.muted} fontSize={9} fontFamily={font} textAnchor="middle">
                {profile.tireSpec.rearWidth}/{profile.tireSpec.rearAspect}
              </text>
            )}
          </g>
        )}

        {/* ── Swingarm ── */}
        {vis.swingarm && (
          <g>
            <line x1={sPivot[0]} y1={sPivot[1]} x2={sRa[0]} y2={sRa[1]}
              stroke={C.swingarm} strokeWidth={3.5} strokeLinecap="round" />
            <circle cx={sPivot[0]} cy={sPivot[1]} r={7} fill={C.swingarm} />
            <circle cx={sPivot[0]} cy={sPivot[1]} r={3} fill={C.bg} />
            {vis.angleLabels && (() => {
              const angleDeg = -results.geometry.swingarmAngleDeg;
              const midX = (sPivot[0] + sRa[0]) / 2;
              const midY = (sPivot[1] + sRa[1]) / 2;
              return (
                <text x={midX} y={midY + 16} fill={C.swingarm} fontSize={9} fontFamily={font} textAnchor="middle">
                  SA {angleDeg.toFixed(1)}° (CW+)
                </text>
              );
            })()}
            {vis.labels && (
              <Lbl x={(sPivot[0]+sRa[0])/2} y={(sPivot[1]+sRa[1])/2}
                text="SWINGARM" color={C.swingarm} dy={-10} anchor="middle" />
            )}
          </g>
        )}

        {/* ── Swingarm extension (anti-squat analysis line) ── */}
        {vis.swingarmExtension && (() => {
          const extLen = 600;
          // Use screen-space direction (works regardless of X-mirror)
          const ddx = sRa[0] - sPivot[0];
          const ddy = sRa[1] - sPivot[1];
          const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const extPx = extLen * sc * 0.5;
          // Extend BEHIND pivot (opposite to RA direction)
          const ex1 = sPivot[0] - (ddx / dlen) * extPx;
          const ey1 = sPivot[1] - (ddy / dlen) * extPx;
          // Extend through rear axle
          const ex2 = sRa[0] + (ddx / dlen) * extPx;
          const ey2 = sRa[1] + (ddy / dlen) * extPx;
          return (
            <line x1={ex1} y1={ey1} x2={ex2} y2={ey2}
              stroke={C.swingarm} strokeWidth={0.8} strokeDasharray="8 5" strokeOpacity={0.5} />
          );
        })()}

        {/* ── Frame spine (pivot → head tube) ── */}
        {vis.frameRails && (
          <g>
            <line x1={sPivot[0]} y1={sPivot[1]} x2={sHt[0]} y2={sHt[1]}
              stroke={C.frame} strokeWidth={2} strokeDasharray="6 3" />
            {vis.labels && (
              <Lbl x={(sPivot[0]+sHt[0])/2} y={(sPivot[1]+sHt[1])/2}
                text="FRAME" color={C.frame} dy={-9} anchor="middle" />
            )}
          </g>
        )}

        {/* ── Fork tubes + Triple Clamps (wireframe) ── */}
        {/* Wireframe representation of the front steering assembly:
            ·  Fork centerline  = single solid line parallel to the steering axis,
                                  offset by forkOffset from it (runs upper-TC → front axle).
            ·  Lower triple clamp (fork crown) = bracket connecting SA to fork at axle height.
            ·  Upper triple clamp (top yoke)   = bracket connecting SA to fork at stanchion top.
            The steering axis itself is drawn as a dashed reference line in vis.steeringAxis.
            The handlebar line (upper-TC → riser → grip) is in vis.handlebarForkLine. */}
        {vis.frontForkTubes && (() => {
          // Fork-offset direction in screen space: sHtSag → sFa (SA → fork crown, perpendicular to SA)
          const odx = sFa[0] - sHtSag[0], ody = sFa[1] - sHtSag[1];
          const olen = Math.sqrt(odx*odx + ody*ody) || 1;
          const oux = odx / olen, ouy = ody / olen;
          const foLen = forkOffset * sc;

          // Lower triple clamp (fork crown): SA → fork at front-axle height
          const lcA = sHtSag;
          const lcB: [number, number] = [sHtSag[0] + oux * foLen, sHtSag[1] + ouy * foLen];

          // Upper triple clamp (top yoke): SA point at stanchion-top height → sUpperTCSag
          // SA point = UPPER_TC_sag minus forkOffset along u_perp = (cosA, sinA) in physics
          const saAtUTC = S(UPPER_TC_sag[0] - forkOffset * cosA, UPPER_TC_sag[1] - forkOffset * sinA);

          return (
            <g>
              {/* Fork tube centerline — single structural line, parallel to SA, offset by forkOffset */}
              <line x1={sUpperTCSag[0]} y1={sUpperTCSag[1]} x2={sFa[0]} y2={sFa[1]}
                stroke={C.forkTube} strokeWidth={1.5} strokeLinecap="round" />

              {/* Lower triple clamp (fork crown / lower yoke) */}
              <line x1={lcA[0]} y1={lcA[1]} x2={lcB[0]} y2={lcB[1]}
                stroke={C.tripleClamp} strokeWidth={3} strokeLinecap="round" />

              {/* Upper triple clamp (top yoke) */}
              <line x1={saAtUTC[0]} y1={saAtUTC[1]} x2={sUpperTCSag[0]} y2={sUpperTCSag[1]}
                stroke={C.tripleClamp} strokeWidth={3} strokeLinecap="round" />

              {/* Axle lug — small indicator circle at the fork/axle attachment point */}
              <circle cx={sFa[0]} cy={sFa[1]} r={5}
                fill="none" stroke={C.tripleClamp} strokeWidth={2} opacity={0.85} />

              {/* Fork-offset annotation */}
              {vis.dimensionLabels && (() => {
                const midX = (lcA[0] + lcB[0]) / 2, midY = (lcA[1] + lcB[1]) / 2;
                return (
                  <text x={midX} y={midY + 14}
                    fill={C.tripleClamp} fontSize={8} fontFamily={font} textAnchor="middle">
                    f={forkOffset}mm
                  </text>
                );
              })()}

              {vis.angleLabels && (
                <text x={sHt[0] + 14} y={sHt[1] + 4}
                  fill={C.forkTube} fontSize={10} fontFamily={font} fontWeight="bold">
                  {headAngle}°
                </text>
              )}
            </g>
          );
        })()}

        {/* ── Fork axis line (extension of steering axis through fork) ── */}
        {vis.forkAxisLine && (
          <line x1={sFa[0]} y1={sFa[1]} x2={sHt[0]} y2={sHt[1]}
            stroke={C.fork} strokeWidth={0.8} strokeDasharray="4 3" strokeOpacity={0.5} />
        )}

        {/* ── Head tube — 3D cylinder profile ── */}
        {/* In 2D side view a cylinder appears as two parallel edge lines + semi-circular end caps.
            Left edge: HT_L1 → HT_L2   Right edge: HT_R1 → HT_R2
            End-cap arcs rendered as SVG path arcs so they follow the axis angle. */}
        {vis.headTube && (() => {
          const rx = HT_TUBE_R * sc;  // screen-space radius
          // axis angle in screen space: from sHtSag → sHtTopSag
          const adx = sHtTopSag[0] - sHtSag[0], ady = sHtTopSag[1] - sHtSag[1];
          const alen = Math.sqrt(adx*adx + ady*ady) || 1;
          // Perpendicular in screen space
          const pnx = -ady/alen, pny = adx/alen;
          // 4 corner points of the cylinder rectangle
          const tl = [sHtTopSag[0] + pnx*rx, sHtTopSag[1] + pny*rx];
          const tr = [sHtTopSag[0] - pnx*rx, sHtTopSag[1] - pny*rx];
          const bl = [sHtSag[0]    + pnx*rx, sHtSag[1]    + pny*rx];
          const br = [sHtSag[0]    - pnx*rx, sHtSag[1]    - pny*rx];
          // Cylinder path: rectangle outline
          const cylPath = `M${bl[0].toFixed(1)},${bl[1].toFixed(1)}
            L${tl[0].toFixed(1)},${tl[1].toFixed(1)}
            L${tr[0].toFixed(1)},${tr[1].toFixed(1)}
            L${br[0].toFixed(1)},${br[1].toFixed(1)} Z`;
          // Highlight line: inner "shine" 30% from left edge
          const hlx1 = sHtSag[0]    + pnx*rx*0.3, hly1 = sHtSag[1]    + pny*rx*0.3;
          const hlx2 = sHtTopSag[0] + pnx*rx*0.3, hly2 = sHtTopSag[1] + pny*rx*0.3;
          return (
            <g>
              {/* Cylinder body fill */}
              <path d={cylPath}
                fill={C.headTube} fillOpacity={0.18}
                stroke={C.headTube} strokeWidth={1.5} />
              {/* Centre axis line (steering axis visual reference) */}
              <line x1={sHtSag[0]} y1={sHtSag[1]} x2={sHtTopSag[0]} y2={sHtTopSag[1]}
                stroke={C.headTube} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5} />
              {/* Specular highlight — mimics 3D lighting */}
              <line x1={hlx1} y1={hly1} x2={hlx2} y2={hly2}
                stroke="#fff" strokeWidth={1.2} strokeOpacity={0.18} strokeLinecap="round" />
              {vis.labels && (
                <text x={sHtTopSag[0] + 14} y={sHtTopSag[1]}
                  fill={C.headTube} fontSize={8.5} fontFamily={font}>HEAD TUBE</text>
              )}
            </g>
          );
        })()}

        {/* ── Steering axis ── */}
        {vis.steeringAxis && (
          <g>
            {/* Full steering axis dashed line from top to ground */}
            <line x1={sSaTop[0]} y1={sSaTop[1]} x2={sSaGnd[0]} y2={sSaGnd[1]}
              stroke={C.steerAxis} strokeWidth={1} strokeDasharray="8 4" strokeOpacity={0.7} />
            {/* Ground intersection dot */}
            <circle cx={sSaGnd[0]} cy={sSaGnd[1]} r={4}
              fill={C.trail} fillOpacity={0.9} />
            {vis.labels && (
              <text x={sSaTop[0] + 6} y={sSaTop[1]}
                fill={C.steerAxis} fontSize={9} fontFamily={font} opacity={0.75}>
                STEERING AXIS
              </text>
            )}
          </g>
        )}

        {/* ── Trail geometry ── */}
        {vis.trailGeometry && (
          <g>
            {/* Horizontal trail arrow at ground level, below contact patch */}
            <line x1={sSaGnd[0]} y1={sFc[1] + 18} x2={sFc[0]} y2={sFc[1] + 18}
              stroke={C.trail} strokeWidth={2} markerEnd="url(#arr-green)" />
            <line x1={sSaGnd[0]} y1={sFc[1]} x2={sSaGnd[0]} y2={sFc[1] + 21}
              stroke={C.trail} strokeWidth={1} />
            <line x1={sFc[0]} y1={sFc[1]} x2={sFc[0]} y2={sFc[1] + 21}
              stroke={C.trail} strokeWidth={1} />
            {/* Front contact marker */}
            <circle cx={sFc[0]} cy={sFc[1]} r={4} fill={C.trail} />
            {vis.dimensionLabels && (
              <text x={(sSaGnd[0] + sFc[0]) / 2} y={sFc[1] + 34}
                fill={C.trail} fontSize={11} fontFamily={font} textAnchor="middle" fontWeight="bold">
                TRAIL {results.geometry.trail.toFixed(1)} mm
              </text>
            )}
          </g>
        )}

        {/* ── Chain system (wireframe) ── */}
        {/* Sprockets: hollow stroked circles at exact pitch radii.
            Chain runs: thin solid tangent lines connecting sprocket rims.
            Swingarm pivot (PIVOT = origin) is a separate structural coordinate
            and is rendered in the swingarm section, NOT here.
            DS = countershaft/engine sprocket; RS = rear axle sprocket. */}
        {vis.chainSystem && (
          <g>
            {/* Drive sprocket — hollow wireframe circle, countershaft axle dot */}
            <circle cx={sDs[0]} cy={sDs[1]} r={sDriveR}
              fill="none" stroke={C.chain} strokeWidth={1.5} />
            <circle cx={sDs[0]} cy={sDs[1]} r={2.5} fill={C.chain} />
            {/* Rear sprocket — hollow wireframe circle */}
            <circle cx={sRs[0]} cy={sRs[1]} r={sRearR}
              fill="none" stroke={C.chain} strokeWidth={1.5} />
            <circle cx={sRs[0]} cy={sRs[1]} r={2.5} fill={C.chain} />
            {/* Tension run (top/drive side): true external tangent, thin solid line */}
            <line x1={sChainTenA[0]} y1={sChainTenA[1]} x2={sChainTenB[0]} y2={sChainTenB[1]}
              stroke={C.chain} strokeWidth={1.5} strokeLinecap="round" />
            {/* Slack run (return/bottom side): true external tangent, same weight */}
            <line x1={sChainSlkA[0]} y1={sChainSlkA[1]} x2={sChainSlkB[0]} y2={sChainSlkB[1]}
              stroke={C.chain} strokeWidth={1.5} strokeLinecap="round" />
            {vis.labels && (
              <>
                <text x={sDs[0]} y={sDs[1] - sDriveR - 5}
                  fill={C.chain} fontSize={8} fontFamily={font} textAnchor="middle">
                  {chain.frontSprocket}T
                </text>
                <text x={sRs[0] + sRearR + 5} y={sRs[1] + 3}
                  fill={C.chain} fontSize={8} fontFamily={font}>
                  {chain.rearSprocket}T
                </text>
                <text
                  x={(sChainTenA[0] + sChainTenB[0]) / 2}
                  y={(sChainTenA[1] + sChainTenB[1]) / 2 - 7}
                  fill={C.chain} fontSize={7.5} fontFamily={font} textAnchor="middle">
                  TENSION RUN
                </text>
              </>
            )}
          </g>
        )}

        {/* ── Chain force line (Foale IC construction line) ── */}
        {/* This line passes through the COUNTERSHAFT CENTER (DS) at chainForceAngleAuto.
            This is the Foale graphical method approximation: the IC is defined as the
            intersection of this line with the swingarm axis extension. Using the center
            (not the tangent point) is standard practice for this method; the exact
            external tangent (CHAIN_TENSION run) is shown separately for reference.
            Coordinate conversion: chainForceAngleAuto is in OLD coords (+X rearward).
            In PHYSICS coords (+X forward) the X component flips sign.
            physics direction = (−cos(φ), sin(φ))  where φ = chainForceAngleAuto */}
        {vis.forceLine && (() => {
          if (chain.isCVT || !isFinite(results.antiSquat.chainForceAngleAuto)) return null;
          const cfaRad = results.antiSquat.chainForceAngleAuto * D2R;
          // Direction in physics coords (from DS toward RA side):
          const ux_phys = -Math.cos(cfaRad);  // flip X: old+rearward → phys−forward
          const uy_phys =  Math.sin(cfaRad);  // Y unchanged
          // Anchor on the upper-run tangent contact point (CHAIN_SLACK_A in physics coords),
          // NOT on the sprocket centre — the line of action passes through this contact point.
          const extMm = 600;
          const P1 = S(CHAIN_SLACK_A[0] - ux_phys * extMm, CHAIN_SLACK_A[1] - uy_phys * extMm);
          const P2 = S(CHAIN_SLACK_A[0] + ux_phys * extMm, CHAIN_SLACK_A[1] + uy_phys * extMm);
          return (
            <g>
              <line x1={P1[0]} y1={P1[1]} x2={P2[0]} y2={P2[1]}
                stroke={C.force} strokeWidth={1.5} strokeDasharray="10 5"
                markerEnd="url(#arr-red)" opacity={0.8} />
              {vis.labels && (
                <text x={(P1[0]+sDs[0])/2} y={(P1[1]+sDs[1])/2 - 8}
                  fill={C.force} fontSize={8} fontFamily={font}>CHAIN FORCE (FOALE)</text>
              )}
            </g>
          );
        })()}

        {/* ── Anti-squat analysis line ── */}
        {vis.antiSquatLine && (() => {
          // Line from rear contact through IC, extended
          const icValid = Math.abs(IC_fromAnalysis[0]) < 5000 && Math.abs(IC_fromAnalysis[1]) < 5000;
          if (!icValid) return null;
          const dx = IC_fromAnalysis[0] - RC[0];
          const dy = IC_fromAnalysis[1] - RC[1];
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len, uy = dy / len;
          const P1 = S(RC[0] - ux * 200, RC[1] - uy * 200);
          const P2 = S(IC_fromAnalysis[0] + ux * 600, IC_fromAnalysis[1] + uy * 600);
          return (
            <line x1={P1[0]} y1={P1[1]} x2={P2[0]} y2={P2[1]}
              stroke={C.asLine} strokeWidth={1.2} strokeDasharray="8 5"
              markerEnd="url(#arr-purple)" opacity={0.75} />
          );
        })()}

        {/* ── Load transfer line: rear contact → CoG ── */}
        {vis.loadTransferLine && (
          <g>
            <line x1={sRc[0]} y1={sRc[1]} x2={sLtEnd[0]} y2={sLtEnd[1]}
              stroke={C.ltLine} strokeWidth={1.5} strokeDasharray="6 4"
              markerEnd="url(#arr-yellow)" opacity={0.8} />
            {vis.labels && (
              <text x={(sRc[0]+sCog[0])/2 + 6} y={(sRc[1]+sCog[1])/2}
                fill={C.ltLine} fontSize={8} fontFamily={font}>LOAD TRANSFER</text>
            )}
          </g>
        )}

        {/* ── Handlebar riser + grip polyline ── */}
        {/* Multi-segment polyline from upper triple clamp → riser top → grip end.
            Geometry is steering-axis-coupled: rotates automatically with rake.
            Base     = sHtTopSag  (upper triple clamp, after sag)
            Riser    = sRiserTop  (riserHeight_mm along steering axis u_sa)
            Grip end = sHbGrip    (handlebarReach_mm along u_perp from riser top)
            Bar type governs only the grip-end cross-section silhouette.         */}
        {vis.handlebarForkLine && (() => {
          const hbType = profile.handlebarType;
          // Riser and grip positions from physics-derived screen coords
          const [rx, ry] = sRiserTop;
          const [gx, gy] = sHbGrip;
          const barCol = C.fork;

          // ── Riser/stem polyline: (stem base →) upper triple clamp → riser top → grip ──
          // For standard/roadster bars the stem extends visibly below the upper TC;
          // add 120mm of fork stanchion below the clamp so the "line going down" reads clearly.
          const stemExtMm = hbType === 'standard' ? 120 : 0;
          const stemBase = stemExtMm > 0
            ? S(UPPER_TC_sag[0] + sinA * stemExtMm, UPPER_TC_sag[1] - cosA * stemExtMm)
            : sUpperTCSag;
          const riserLine = (
            <polyline
              points={`${stemBase[0].toFixed(1)},${stemBase[1].toFixed(1)} ${sUpperTCSag[0].toFixed(1)},${sUpperTCSag[1].toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)} ${gx.toFixed(1)},${gy.toFixed(1)}`}
              fill="none" stroke={barCol} strokeWidth={2.5} strokeLinecap="round"
              strokeLinejoin="miter"
            />
          );

          // ── Grip point in sagittal plane ─────────────────────────────────
          // In a strict 2D side-profile view the handlebar collapses to a single
          // point — the handgrip position on the Y-Z plane. No lateral width is
          // shown regardless of bar type; the polyline above already conveys the
          // stem/riser geometry. Physics coordinates (HB_GRIP) are unchanged.
          const barEl = (
            <>
              <circle cx={gx} cy={gy} r={9}
                fill={barCol} fillOpacity={0.15} stroke={barCol} strokeWidth={2} />
              <circle cx={gx} cy={gy} r={4} fill={barCol} />
            </>
          );

          return (
            <g>
              {riserLine}
              {barEl}
              {vis.labels && (
                <text x={gx + 14} y={gy + 4}
                  fill={barCol} fontSize={8.5} fontFamily={font}>
                  {hbType === 'clipOn'   ? 'CLIP-ONS'
                    : hbType === 'wide'    ? 'WIDE BAR'
                    : hbType === 'pullBack'? 'PULL-BACK'
                    : hbType === 'riser'   ? 'RISER BAR'
                    : hbType === 'caf'     ? 'CAF BAR'
                    : 'HANDLEBAR'}
                </text>
              )}
            </g>
          );
        })()}

        {/* ── Engine block (schematic) ── */}
        {vis.engineBlock && (() => {
          // Draw a simple rectangle centred on the mass centroid of engine components
          const eng = mcs.find(c => c.label.toLowerCase().includes('engine'));
          if (!eng) return null;
          const [ex, ey] = oldToPhys(eng.x, eng.y, X_sp, H_sp);
          const [sex, sey] = S(ex, ey);
          const engW = 120 * sc, engH = 90 * sc;
          return (
            <rect x={sex - engW/2} y={sey - engH/2} width={engW} height={engH}
              fill={C.frame} fillOpacity={0.1} stroke={C.frame} strokeWidth={1}
              strokeOpacity={0.4} rx={4} />
          );
        })()}

        {/* ── Mass component dots ── */}
        {vis.massComponents && mcs.map((c, i) => {
          const [px, py] = oldToPhys(c.x, c.y, X_sp, H_sp);
          const [sx, sy] = S(px, py);
          const r = Math.sqrt(c.mass) * 1.3;
          return (
            <g key={i}>
              <circle cx={sx} cy={sy} r={r * sc / 0.42}
                fill="#1f6feb" fillOpacity={0.18} stroke="#1f6feb" strokeWidth={0.8} />
              {vis.massLabels && (
                <>
                  <text x={sx} y={sy - r * sc / 0.42 - 3}
                    fill="#1f6feb" fontSize={8} fontFamily={font} textAnchor="middle">
                    {c.label}
                  </text>
                  <text x={sx} y={sy + r * sc / 0.42 + 11}
                    fill={C.muted} fontSize={7.5} fontFamily={font} textAnchor="middle">
                    {c.mass} kg
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* ── CoG crosshair + Weight Vector ── */}
        {/* Weight vector = downward arrow from CoG to ground, labelled Mg.
            Split at ground into front reaction R_front (at FC) and rear reaction R_rear (at RC)
            to visualise static equilibrium. */}
        {vis.cogMarker && (() => {
          const groundY  = sPivot[1] + H_sp * sc;   // ground line in screen px
          const totalW   = results.cog.totalWeight;   // N
          const frontN   = results.cog.R_front;       // N
          const rearN    = results.cog.R_rear;        // N

          // Arrow tip reaches the ground line; leave a small gap so it doesn't overlap ground
          const arrowTipY = groundY - 4;

          return (
            <g>
              {/* ── Weight vector: CoG → ground (thick downward arrow) ── */}
              <defs>
                <marker id="arr-cog" markerWidth="9" markerHeight="9" refX="5" refY="4.5" orient="auto">
                  <path d="M0,0 L9,4.5 L0,9 Z" fill={C.cog} />
                </marker>
              </defs>
              <line
                x1={sCog[0]} y1={sCog[1] + 12}
                x2={sCog[0]} y2={arrowTipY}
                stroke={C.cog} strokeWidth={2.5}
                markerEnd="url(#arr-cog)" />

              {/* Mg label mid-shaft */}
              {vis.labels && (
                <>
                  <rect
                    x={sCog[0] + 5}
                    y={(sCog[1] + groundY) / 2 - 20}
                    width={72} height={36}
                    fill={C.labelBg} rx={3} opacity={0.9} />
                  <text x={sCog[0] + 9} y={(sCog[1] + groundY) / 2 - 8}
                    fill={C.cog} fontSize={9} fontFamily={font} fontWeight="bold">
                    Mg = {totalW.toFixed(0)} N
                  </text>
                  <text x={sCog[0] + 9} y={(sCog[1] + groundY) / 2 + 4}
                    fill={C.muted} fontSize={7.5} fontFamily={font}>
                    F: {frontN.toFixed(0)} N
                  </text>
                  <text x={sCog[0] + 9} y={(sCog[1] + groundY) / 2 + 14}
                    fill={C.muted} fontSize={7.5} fontFamily={font}>
                    R: {rearN.toFixed(0)} N
                  </text>
                </>
              )}

              {/* Reaction force arrows from ground up at contact patches */}
              {vis.labels && (
                <>
                  {/* Front reaction */}
                  <line x1={sFc[0]} y1={groundY}
                        x2={sFc[0]} y2={groundY - Math.min(frontN / totalW * 60, 55)}
                    stroke={C.trail} strokeWidth={2} markerEnd="url(#arr-green)" strokeOpacity={0.75} />
                  <text x={sFc[0] - 4} y={groundY - Math.min(frontN / totalW * 60, 55) - 4}
                    fill={C.trail} fontSize={7.5} fontFamily={font} textAnchor="end">
                    {frontN.toFixed(0)}N
                  </text>
                  {/* Rear reaction */}
                  <line x1={sRc[0]} y1={groundY}
                        x2={sRc[0]} y2={groundY - Math.min(rearN / totalW * 60, 55)}
                    stroke={C.trail} strokeWidth={2} markerEnd="url(#arr-green)" strokeOpacity={0.75} />
                  <text x={sRc[0] + 4} y={groundY - Math.min(rearN / totalW * 60, 55) - 4}
                    fill={C.trail} fontSize={7.5} fontFamily={font}>
                    {rearN.toFixed(0)}N
                  </text>
                </>
              )}

              {/* CoG crosshair marker */}
              <circle cx={sCog[0]} cy={sCog[1]} r={10}
                fill="none" stroke={C.cog} strokeWidth={2} />
              <line x1={sCog[0]-14} y1={sCog[1]} x2={sCog[0]+14} y2={sCog[1]}
                stroke={C.cog} strokeWidth={1.5} />
              <line x1={sCog[0]} y1={sCog[1]-14} x2={sCog[0]} y2={sCog[1]+14}
                stroke={C.cog} strokeWidth={1.5} />
              {vis.labels && (
                <>
                  <text x={sCog[0]+14} y={sCog[1]-8}
                    fill={C.cog} fontSize={11} fontFamily={font} fontWeight="bold">
                    CoG
                  </text>
                  {vis.coordLabels && (
                    <text x={sCog[0]+14} y={sCog[1]+5}
                      fill={C.muted} fontSize={8} fontFamily={font}>
                      ({results.cog.X_cg.toFixed(0)},{results.cog.Y_cg.toFixed(0)}) mm
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })()}

        {/* ── Instant Centre + IC Construction Lines ── */}
        {/* The IC is the intersection of two lines (Foale graphical method):
            Line 1 — Swingarm axis:   extended line through PIVOT (0,0) and rear axle RA
            Line 2 — Chain force:     line through countershaft CENTER (DS) at chainForceAngleAuto
            IC_x/IC_y come from results.antiSquat (computeAntiSquatUnified output).
            Both construction lines pass exactly through sIc — crossing is unambiguous. */}
        {vis.instantCentre && (() => {
          const icValid = Math.abs(IC_fromAnalysis[0]) < 5000 && Math.abs(IC_fromAnalysis[1]) < 5000;
          if (!icValid) return null;
          const AS = results.antiSquat.antiSquatPercent;

          // ── Construction Line 1: Swingarm axis (PIVOT → RA → IC) ──
          // Direction in screen space (sPivot → sRa → sIc are collinear by construction)
          const sa1dx = sIc[0] - sPivot[0], sa1dy = sIc[1] - sPivot[1];
          const sa1len = Math.sqrt(sa1dx*sa1dx + sa1dy*sa1dy) || 1;
          const sa1ux = sa1dx/sa1len, sa1uy = sa1dy/sa1len;
          // Extend 400px beyond IC and 200px before pivot
          const cl1x1 = sPivot[0] - sa1ux*200, cl1y1 = sPivot[1] - sa1uy*200;
          const cl1x2 = sIc[0]    + sa1ux*400, cl1y2 = sIc[1]    + sa1uy*400;

          // ── Construction Line 2: Chain force line through upper tangent contact point ──
          // Anchored at CHAIN_SLACK_A (upper-run tangent on DS in physics coords),
          // matching computeAntiSquatUnified which now uses X_tan/H_tan not DS center.
          const cfaRad2 = results.antiSquat.chainForceAngleAuto * D2R;
          const cl2Ux = -Math.cos(cfaRad2);  // physics direction: flip X from old coords
          const cl2Uy =  Math.sin(cfaRad2);
          const cl2P1 = S(CHAIN_SLACK_A[0] - cl2Ux * 600, CHAIN_SLACK_A[1] - cl2Uy * 600);
          const cl2P2 = S(CHAIN_SLACK_A[0] + cl2Ux * 600, CHAIN_SLACK_A[1] + cl2Uy * 600);
          const [cl2x1, cl2y1] = cl2P1;
          const [cl2x2, cl2y2] = cl2P2;

          return (
            <g>
              {/* Construction line 1 — swingarm axis (thin dashed, swingarm colour) */}
              <line x1={cl1x1} y1={cl1y1} x2={cl1x2} y2={cl1y2}
                stroke={C.swingarm} strokeWidth={1} strokeDasharray="10 5" strokeOpacity={0.55} />

              {/* Construction line 2 — chain force direction (thin dashed, chain colour) */}
              <line x1={cl2x1} y1={cl2y1} x2={cl2x2} y2={cl2y2}
                stroke={C.force} strokeWidth={1} strokeDasharray="10 5" strokeOpacity={0.55} />

              {/* IC marker — sits exactly at the crossing of both lines */}
              <circle cx={sIc[0]} cy={sIc[1]} r={9}
                fill={C.ic} fillOpacity={0.15} stroke={C.ic} strokeWidth={2} />
              <line x1={sIc[0]-12} y1={sIc[1]} x2={sIc[0]+12} y2={sIc[1]}
                stroke={C.ic} strokeWidth={1.5} />
              <line x1={sIc[0]} y1={sIc[1]-12} x2={sIc[0]} y2={sIc[1]+12}
                stroke={C.ic} strokeWidth={1.5} />

              {vis.labels && (
                <text x={sIc[0]+13} y={sIc[1]-4}
                  fill={C.ic} fontSize={9} fontFamily={font} fontWeight="bold">
                  IC
                </text>
              )}
              {vis.labels && (
                <text x={sIc[0]+13} y={sIc[1]+8}
                  fill={C.ic} fontSize={8} fontFamily={font}>
                  AS={AS.toFixed(0)}%
                </text>
              )}
            </g>
          );
        })()}

        {/* ── Ergonomics triangle ── */}
        {vis.ergoTriangle && (
          <g>
            <polygon
              points={`${sErgoH[0]},${sErgoH[1]} ${sErgoS[0]},${sErgoS[1]} ${sErgoP[0]},${sErgoP[1]}`}
              fill={C.ergo} fillOpacity={0.08}
              stroke={C.ergo} strokeWidth={1.2} strokeDasharray="5 3" />
            {/* Vertex labels */}
            {vis.labels && [
              [sErgoH, 'HANDLEBAR', -10],
              [sErgoS, 'SEAT', -10],
              [sErgoP, 'FOOTPEG', 14],
            ].map(([pt, lbl, dy], i) => (
              <text key={i}
                x={(pt as [number,number])[0]} y={(pt as [number,number])[1] + (dy as number)}
                fill={C.ergo} fontSize={8.5} fontFamily={font} textAnchor="middle">
                {lbl as string}
              </text>
            ))}
            {/* Joint angle arcs */}
            {vis.angleLabels && (() => {
              const kneeA = results.ergonomics.kneeAngleDeg;
              const hipA  = results.ergonomics.hipAngleDeg;
              return (
                <>
                  <text x={sErgoP[0]+12} y={sErgoP[1]-4}
                    fill={C.ergo} fontSize={8} fontFamily={font}>
                    {kneeA.toFixed(0)}°
                  </text>
                  <text x={sErgoS[0]+12} y={sErgoS[1]+4}
                    fill={C.ergo} fontSize={8} fontFamily={font}>
                    {hipA.toFixed(0)}°
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* ── Ergo drag handles ── */}
        {vis.ergoControls && [
          [sErgoH, 'handlebar', '#4c6ef5'],
          [sErgoS, 'seat',      '#f76707'],
          [sErgoP, 'footpeg',   '#2f9e44'],
        ].map(([pt, key, col]) => (
          <g key={key as string} style={{ cursor: 'grab' }}>
            <circle
              cx={(pt as [number,number])[0]} cy={(pt as [number,number])[1]} r={8}
              fill={col as string} fillOpacity={0.85}
              stroke="#fff" strokeWidth={1.5} />
            <circle
              cx={(pt as [number,number])[0]} cy={(pt as [number,number])[1]} r={14}
              fill="transparent" stroke={col as string} strokeWidth={1} strokeOpacity={0.4} />
          </g>
        ))}

        {/* ── Pivot marker ── */}
        <circle cx={sPivot[0]} cy={sPivot[1]} r={8}
          fill={C.swingarm} stroke={C.bg} strokeWidth={2} />
        <circle cx={sPivot[0]} cy={sPivot[1]} r={3} fill={C.bg} />
        {vis.labels && (
          <text x={sPivot[0]+11} y={sPivot[1]+3}
            fill={C.swingarm} fontSize={9} fontFamily={font} fontWeight="bold">
            PIVOT
          </text>
        )}

        {/* ── Scale bar ── */}
        <g>
          <rect x={w-scaleBarPx-20} y={h-24} width={scaleBarPx} height={6}
            fill={C.muted} opacity={0.4} rx={2} />
          <text x={w-scaleBarPx/2-20} y={h-7}
            fill={C.muted} fontSize={9} fontFamily={font} textAnchor="middle">
            {scaleBarMm} mm
          </text>
        </g>

        {/* ── Bike type badge ── */}
        <text x={w/2} y={18}
          fill={C.muted} fontSize={10} fontFamily={font} textAnchor="middle" opacity={0.5}>
          {profile.label}  ·  AS={results.antiSquat.antiSquatPercent.toFixed(0)}%  ·
          Trail={results.geometry.trail.toFixed(0)} mm  ·
          WB={WB} mm  ·  α={headAngle}°
        </text>

        {/* ══════════════════════════════════════════════════════════════
             BLUEPRINT MODE — extra elements rendered on top of base view
             ══════════════════════════════════════════════════════════════ */}
        {blueprintMode && bpStates && (() => {
          // ── Helper: screen-project a physics point ─────────────────────
          const Sb = (px: number, py: number): [number,number] => S(px, py);

          // ── 3-state definitions ─────────────────────────────────────────
          const states = [
            { key: 'ext', data: bpStates.ext, stroke: '#56d364', dash: '10 5',  width: 1.5, label: 'EXTENDED'   },
            { key: 'cmp', data: bpStates.cmp, stroke: '#f85149', dash: '8 4',   width: 1.5, label: 'COMPRESSED' },
            { key: 'cur', data: bpStates.cur, stroke: '#58a6ff', dash: '',       width: 2.2, label: 'CURRENT'    },
          ] as const;

          // Fender arc helper — partial arc (upper ~200°) around a wheel
          const fenderArc = (cx: number, cy: number, r: number, col: string, dsh: string) => {
            const startDeg = -205, endDeg = 25; // spans the top of the wheel
            const toRad = (d: number) => d * D2R;
            const x1 = cx + r * Math.cos(toRad(startDeg));
            const y1 = cy + r * Math.sin(toRad(startDeg));
            const x2 = cx + r * Math.cos(toRad(endDeg));
            const y2 = cy + r * Math.sin(toRad(endDeg));
            return (
              <path
                d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${r.toFixed(1)},${r.toFixed(1)} 0 1,1 ${x2.toFixed(1)},${y2.toFixed(1)}`}
                fill="none" stroke={col} strokeWidth={2} strokeDasharray={dsh || undefined}
                strokeLinecap="round" />
            );
          };

          return (
            <g>
              {/* ── Chain guard silhouette ─────────────────────────────────
                  Elongated oval enclosing the full chain run.
                  Uses screen-space DS and RS positions (already computed). */}
              {vis.chainSystem && (() => {
                const cgCx = (sDs[0] + sRs[0]) / 2;
                const cgCy = (sDs[1] + sRs[1]) / 2;
                const chainVecX = sRs[0] - sDs[0], chainVecY = sRs[1] - sDs[1];
                const chainScreenLen = Math.sqrt(chainVecX*chainVecX + chainVecY*chainVecY);
                const cgAngleDeg = Math.atan2(chainVecY, chainVecX) * 180 / Math.PI;
                // Semi-axes: major = half-dist + larger sprocket radius + guard clearance
                const guardClear = 9 * sc;
                const rxG = chainScreenLen / 2 + Math.max(sDriveR, sRearR) + guardClear;
                const ryG = Math.max(sDriveR, sRearR) + guardClear * 0.6;
                return (
                  <g transform={`translate(${cgCx.toFixed(1)},${cgCy.toFixed(1)}) rotate(${cgAngleDeg.toFixed(2)})`}>
                    <ellipse cx={0} cy={0} rx={rxG} ry={ryG}
                      fill={C.chain} fillOpacity={0.06}
                      stroke={C.chain} strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55} />
                    {/* Inner channel line */}
                    <ellipse cx={0} cy={0} rx={rxG * 0.88} ry={ryG * 0.6}
                      fill="none" stroke={C.chain} strokeWidth={0.6} strokeOpacity={0.3} />
                    {vis.labels && (
                      <text x={0} y={ryG + 12} fill={C.chain} fontSize={7.5}
                        fontFamily={font} textAnchor="middle" transform={`rotate(-${cgAngleDeg.toFixed(2)})`}>
                        CHAIN GUARD
                      </text>
                    )}
                  </g>
                );
              })()}

              {/* ── Wheel fender arcs ──────────────────────────────────────
                  Partial arcs above each wheel showing mudguard profile.
                  Always rendered in the current-state colour. */}
              {vis.frontWheel && fenderArc(sFa[0], sFa[1], sRf + 8*sc, '#58a6ff', '6 3')}
              {vis.rearWheel  && fenderArc(sRa[0], sRa[1], sRr + 8*sc, '#58a6ff', '6 3')}

              {/* Wheel inner structural circles (depth detail) */}
              {vis.frontWheel && (
                <circle cx={sFa[0]} cy={sFa[1]} r={sRfRim * 0.55}
                  fill="none" stroke={C.wheel} strokeWidth={0.8} strokeOpacity={0.4} />
              )}
              {vis.rearWheel && (
                <circle cx={sRa[0]} cy={sRa[1]} r={sRrRim * 0.55}
                  fill="none" stroke={C.wheel} strokeWidth={0.8} strokeOpacity={0.4} />
              )}

              {/* ── 3-State suspension overlay ─────────────────────────────
                  For each state, draw fork and swingarm at that travel position.
                  Ground contact is preserved: rear axle always at groundY. */}
              {states.map(({ key, data, stroke, dash, width }) => {
                const sHtS  = Sb(...data.htS);
                const sHtTS = Sb(...data.htTS);
                const sRaS  = Sb(...data.raPhy);
                const sPivS = Sb(...data.pivOff);

                return (
                  <g key={key}>
                    {/* Fork tube at this state (single centre line) */}
                    {vis.frontForkTubes && (
                      <line x1={sHtTS[0]} y1={sHtTS[1]} x2={sFa[0]} y2={sFa[1]}
                        stroke={stroke} strokeWidth={width} strokeDasharray={dash || undefined}
                        strokeOpacity={key === 'cur' ? 0.9 : 0.65} strokeLinecap="round" />
                    )}
                    {/* Lower triple clamp at this state */}
                    {vis.frontForkTubes && (
                      <line x1={sHtS[0]} y1={sHtS[1]} x2={sFa[0]} y2={sFa[1]}
                        stroke={stroke} strokeWidth={width * 1.4} strokeDasharray={dash || undefined}
                        strokeOpacity={key === 'cur' ? 0.9 : 0.65} strokeLinecap="round" />
                    )}
                    {/* Swingarm at this state */}
                    {vis.swingarm && (
                      <line x1={sPivS[0]} y1={sPivS[1]} x2={sRaS[0]} y2={sRaS[1]}
                        stroke={stroke} strokeWidth={width} strokeDasharray={dash || undefined}
                        strokeOpacity={key === 'cur' ? 0.9 : 0.65} strokeLinecap="round" />
                    )}
                    {/* Pivot dot at this state */}
                    {vis.swingarm && key !== 'cur' && (
                      <circle cx={sPivS[0]} cy={sPivS[1]} r={4}
                        fill="none" stroke={stroke} strokeWidth={1.2} strokeOpacity={0.5} />
                    )}
                  </g>
                );
              })}

              {/* ── Blueprint legend ──────────────────────────────────────── */}
              {vis.labels && (() => {
                const lx = 14, ly = sPivot[1] + H_sp * sc + 22;
                return (
                  <g>
                    <rect x={lx - 6} y={ly - 12} width={132} height={52}
                      fill="rgba(7,13,26,0.82)" stroke="#1c2a4a" strokeWidth={1} rx={4} />
                    <text x={lx} y={ly} fill="#4d6a8a" fontSize={7.5} fontFamily={font}
                      fontWeight="700" letterSpacing={1.2}>SUSPENSION TRAVEL</text>
                    {([
                      ['#56d364', '10 5', 'Extended  (0mm sag)'],
                      ['#58a6ff', '',     `Current   (${sagFront_mm}mm front)`],
                      ['#f85149', '8 4',  `Compressed (${(input.suspension.forkTravel*0.75).toFixed(0)}mm)`],
                    ] as [string,string,string][]).map(([col, dsh, lbl], i) => {
                      const y = ly + 12 + i * 13;
                      return (
                        <g key={i}>
                          <line x1={lx} y1={y} x2={lx+22} y2={y}
                            stroke={col} strokeWidth={2} strokeDasharray={dsh || undefined} />
                          <text x={lx+28} y={y+4} fill={col} fontSize={7.5} fontFamily={font}>{lbl}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
            </g>
          );
        })()}

        {/* ══════════════════════════════════════════════════════════════
             ADVANCED KINEMATICS OVERLAY
             Front-end geometry (rake/offset/normal-trail) +
             rear anti-squat geometry (rear-radius / CoG-vertical / squat line).
             All elements are physics-derived — no screen-space approximations.
             Toggle: vis.advancedKinematics
             ══════════════════════════════════════════════════════════════ */}
        {vis.advancedKinematics && (() => {
          // ── colour palette for this overlay ──────────────────────────────
          const AK = {
            rake:        blueprintMode ? '#79b8ff' : C.steerAxis,             // steering axis / rake
            offset:      blueprintMode ? '#a5d6ff' : (dk ? '#00c8d4' : '#007b87'), // fork offset — cyan, distinct from structural triple-clamp
            normalTrail: blueprintMode ? '#56d364' : C.trail,                 // normal trail (mechanical trail)
            rearRadius:  C.muted,                                              // rear axle → ground vertical
            cogVert:     C.cog,                                                // CoG vertical plane
            cogHoriz:    C.cog,                                                // CoG horizontal height reference
            squatLine:   blueprintMode ? '#d2a8ff' : C.asLine,                // IC squat force line (purple)
            pivotLine:   blueprintMode ? '#e3b341' : (dk ? '#b07d1a' : '#7d5e0a'), // geometric pivot line (amber)
            intersect:   C.ic,                                                 // squat / CoG intersection marker
          };

          // ── validity guard ────────────────────────────────────────────────
          const icValid = !chain.isCVT &&
            Math.abs(IC_fromAnalysis[0]) < 8000 &&
            Math.abs(IC_fromAnalysis[1]) < 8000;
          const squatValid = isFinite(SQUAT_INTERSECT[0]) && isFinite(SQUAT_INTERSECT[1]);

          // ── right-angle marker helper ─────────────────────────────────────
          // Draws a small square at vertex (vx,vy) between directions d1 and d2 (unit vectors)
          function RightAngle(
            vx: number, vy: number,
            d1x: number, d1y: number,
            d2x: number, d2y: number,
            size: number, col: string,
          ) {
            const s = size;
            return (
              <path
                d={`M${(vx+d1x*s).toFixed(1)},${(vy+d1y*s).toFixed(1)}
                    L${(vx+d1x*s+d2x*s).toFixed(1)},${(vy+d1y*s+d2y*s).toFixed(1)}
                    L${(vx+d2x*s).toFixed(1)},${(vy+d2y*s).toFixed(1)}`}
                fill="none" stroke={col} strokeWidth={1} opacity={0.7}
              />
            );
          }

          // ── screen-space direction helpers ──────────────────────────────
          // Steering axis direction in screen space: sSaGnd → sSaTop
          const saDx = sSaTop[0] - sSaGnd[0], saDy = sSaTop[1] - sSaGnd[1];
          const saLen = Math.sqrt(saDx*saDx + saDy*saDy) || 1;
          const saUx = saDx / saLen, saUy = saDy / saLen;   // up along SA (screen)
          // Perpendicular to SA in screen space (toward front axle side = +X in screen)
          const saPerpX = -saUy, saPerpY = saUx;

          return (
            <g>
              {/* ═════════════════════════════════════════════════════════
                   FRONT-END GEOMETRY
                   ═════════════════════════════════════════════════════════ */}

              {/* ── Rake line + vertical reference + rake arc ── */}
              {vis.akRakeLine && (<>
              <line
                x1={sUpperTCSag[0]} y1={sUpperTCSag[1]}
                x2={sSaGnd[0]}      y2={sSaGnd[1]}
                stroke={AK.rake} strokeWidth={1.8} strokeLinecap="round"
                opacity={0.85}
              />
              {(() => {
                const saDxV = sUpperTCSag[0] - sSaGnd[0];
                const saDyV = sUpperTCSag[1] - sSaGnd[1];
                let saTopAtFaX = sFa[1];
                if (Math.abs(saDxV) > 0.5) {
                  const tSA = (sFa[0] - sSaGnd[0]) / saDxV;
                  saTopAtFaX = sSaGnd[1] + tSA * saDyV;
                }
                return (
                  <line
                    x1={sFa[0]} y1={saTopAtFaX}
                    x2={sFa[0]} y2={sFc[1]}
                    stroke={AK.rake} strokeWidth={1.2}
                    strokeDasharray="5 3" strokeOpacity={0.55}
                  />
                );
              })()}
              {(() => {
                const arcR = 30;
                const sadX = sSaGnd[0] - sSaTop[0];
                const sadY = sSaGnd[1] - sSaTop[1];
                const sadLen = Math.sqrt(sadX*sadX + sadY*sadY) || 1;
                const sadUx = sadX / sadLen, sadUy = sadY / sadLen;
                const pV: [number,number] = [sFa[0], sFa[1] + arcR];
                const pS: [number,number] = [sFa[0] + sadUx * arcR, sFa[1] + sadUy * arcR];
                const arcPath = `M${pV[0].toFixed(1)},${pV[1].toFixed(1)} A${arcR},${arcR} 0 0,1 ${pS[0].toFixed(1)},${pS[1].toFixed(1)}`;
                const labelX = (pV[0] + pS[0]) / 2 + 12;
                const labelY = (pV[1] + pS[1]) / 2 + 10;
                return (
                  <>
                    <path d={arcPath} fill="none" stroke={AK.rake} strokeWidth={1.2} opacity={0.75} />
                    {vis.angleLabels && (
                      <text x={labelX} y={labelY}
                        fill={AK.rake} fontSize={9} fontFamily={font} fontWeight="bold" opacity={0.9}>
                        α={headAngle}°
                      </text>
                    )}
                  </>
                );
              })()}
              </>)}

              {/* ── Fork offset perpendicular ── */}
              {vis.akForkOffset && (<>
              <line
                x1={sHtSag[0]} y1={sHtSag[1]}
                x2={sFa[0]}    y2={sFa[1]}
                stroke={AK.offset} strokeWidth={2} strokeLinecap="round"
                opacity={0.9}
              />
              {(() => {
                const oDx = sFa[0] - sHtSag[0], oDy = sFa[1] - sHtSag[1];
                const oLen = Math.sqrt(oDx*oDx + oDy*oDy) || 1;
                const oUx = oDx/oLen, oUy = oDy/oLen;
                return RightAngle(sHtSag[0], sHtSag[1], -saUx, -saUy, oUx, oUy, 8, AK.offset);
              })()}
              {vis.dimensionLabels && (() => {
                const midX = (sHtSag[0] + sFa[0]) / 2;
                const midY = (sHtSag[1] + sFa[1]) / 2;
                return (
                  <text x={midX + saPerpX*14} y={midY + saPerpY*14 + 4}
                    fill={AK.offset} fontSize={8.5} fontFamily={font} textAnchor="middle" fontWeight="bold">
                    f={forkOffset}mm
                  </text>
                );
              })()}
              </>)}

              {/* ── Normal trail ── */}
              {vis.akNormalTrail && (<>
              <line
                x1={sFc[0]}     y1={sFc[1]}
                x2={sNtFoot[0]} y2={sNtFoot[1]}
                stroke={AK.normalTrail} strokeWidth={2.2} strokeLinecap="round"
                opacity={0.9}
              />
              {(() => {
                const ntDx = sFc[0] - sNtFoot[0], ntDy = sFc[1] - sNtFoot[1];
                const ntLen = Math.sqrt(ntDx*ntDx + ntDy*ntDy) || 1;
                const ntUx = ntDx/ntLen, ntUy = ntDy/ntLen;
                return RightAngle(sNtFoot[0], sNtFoot[1], -saUx, -saUy, ntUx, ntUy, 8, AK.normalTrail);
              })()}
              <circle cx={sFc[0]} cy={sFc[1]} r={4} fill={AK.normalTrail} opacity={0.9} />
              {vis.dimensionLabels && (() => {
                const midX = (sFc[0] + sNtFoot[0]) / 2;
                const midY = (sFc[1] + sNtFoot[1]) / 2;
                return (
                  <text x={midX - saPerpX*16} y={midY - saPerpY*16 + 4}
                    fill={AK.normalTrail} fontSize={8.5} fontFamily={font} textAnchor="middle" fontWeight="bold">
                    nT={results.geometry.mechanicalTrail.toFixed(1)}mm
                  </text>
                );
              })()}
              </>)}

              {/* ═════════════════════════════════════════════════════════
                   REAR ANTI-SQUAT GEOMETRY
                   ═════════════════════════════════════════════════════════ */}

              {/* ── Rear radius line ── */}
              {vis.akRearRadius && (<>
              <line
                x1={sRa[0]} y1={sRa[1]}
                x2={sRc[0]} y2={sRc[1]}
                stroke={AK.rearRadius} strokeWidth={1.5}
                strokeDasharray="5 3" strokeOpacity={0.65}
              />
              <line x1={sRa[0] - 6} y1={sRa[1]} x2={sRa[0] + 6} y2={sRa[1]}
                stroke={AK.rearRadius} strokeWidth={1.2} strokeOpacity={0.7} />
              {vis.dimensionLabels && (
                <text x={sRa[0] + 9} y={sRa[1] + 4}
                  fill={AK.rearRadius} fontSize={7.5} fontFamily={font}>
                  R={R_r.toFixed(0)}mm
                </text>
              )}
              </>)}

              {/* ── CoG crosshair (vertical + horizontal) ── */}
              {vis.akCogCross && (<>
              <line
                x1={sCog[0]}    y1={sCog[1]}
                x2={sCogGnd[0]} y2={sCogGnd[1]}
                stroke={AK.cogVert} strokeWidth={1.5}
                strokeDasharray="8 4" strokeOpacity={0.7}
              />
              <circle cx={sCogGnd[0]} cy={sCogGnd[1]} r={3.5}
                fill={AK.cogVert} fillOpacity={0.8} />
              {vis.labels && (
                <text x={sCogGnd[0] - 4} y={sCogGnd[1] + 14}
                  fill={AK.cogVert} fontSize={7.5} fontFamily={font} textAnchor="middle">
                  CoG↓
                </text>
              )}
              <line
                x1={sCog[0]} y1={sCog[1]}
                x2={sSaGnd[0] - 40} y2={sCog[1]}
                stroke={AK.cogHoriz} strokeWidth={1.2}
                strokeDasharray="10 5" strokeOpacity={0.55}
              />
              <line x1={sSaGnd[0] - 5} y1={sCog[1]} x2={sSaGnd[0] + 5} y2={sCog[1]}
                stroke={AK.cogHoriz} strokeWidth={1.5} strokeOpacity={0.7} />
              {vis.labels && (
                <text x={sSaGnd[0] - 46} y={sCog[1] - 5}
                  fill={AK.cogHoriz} fontSize={7.5} fontFamily={font} textAnchor="end">
                  h_CoG={results.cog.Y_cg.toFixed(0)}mm
                </text>
              )}
              </>)}

              {/* ── Squat force line + intersection marker ── */}
              {vis.akSquatLine && (<>
              {/* For chain drive this is the Foale squat line through the IC.
                  For CVT/belt the IC is not defined; the line passes through
                  the swingarm pivot instead.
                  The line is extended from RC to SQUAT_INTERSECT (the point
                  where it crosses the CoG vertical plane). */}
              {squatValid && (icValid || chain.isCVT) && (() => {
                // Extend the line a little beyond the intersection for visual clarity
                const extDx = SQUAT_INTERSECT[0] - RC[0];
                const extDy = SQUAT_INTERSECT[1] - RC[1];
                const extLen = Math.sqrt(extDx*extDx + extDy*extDy) || 1;
                const extUx = extDx/extLen, extUy = extDy/extLen;
                const overPx = 40; // px past intersection
                const P1 = sRc;
                const P2: [number, number] = [
                  sSquatIntersect[0] + extUx * overPx,
                  sSquatIntersect[1] + extUy * overPx,
                ];
                return (
                  <>
                    <line x1={P1[0]} y1={P1[1]} x2={P2[0]} y2={P2[1]}
                      stroke={AK.squatLine} strokeWidth={2}
                      strokeDasharray="12 5" strokeLinecap="round"
                      opacity={0.85}
                    />
                    {vis.labels && (
                      <text
                        x={(P1[0] + sSquatIntersect[0]) / 2 - 10}
                        y={(P1[1] + sSquatIntersect[1]) / 2 - 10}
                        fill={AK.squatLine} fontSize={8} fontFamily={font}
                        textAnchor="middle"
                      >
                        {chain.isCVT ? 'SQUAT (shaft)' : 'SQUAT LINE'}
                      </text>
                    )}
                  </>
                );
              })()}

              {/* ── Intersection marker: squat line ∩ CoG vertical ── */}
              {squatValid && (icValid || chain.isCVT) && (() => {
                const ix = sSquatIntersect[0], iy = sSquatIntersect[1];
                // Color code: green if 80–110%, amber if outside
                const asOk = AS_kin_pct >= 80 && AS_kin_pct <= 110;
                const dotCol = asOk ? (dk ? '#3fb950' : '#1a7f37') : C.ic;
                return (
                  <>
                    {/* Diamond marker at intersection */}
                    <path
                      d={`M${ix},${iy-11} L${ix+8},${iy} L${ix},${iy+11} L${ix-8},${iy} Z`}
                      fill={dotCol} fillOpacity={0.25}
                      stroke={dotCol} strokeWidth={2}
                    />
                    {/* Horizontal dashed leader from CoG vertical to label */}
                    {vis.dimensionLabels && (
                      <>
                        {/* Height leader line from ground to intersection */}
                        <line
                          x1={ix + 16} y1={sCogGnd[1]}
                          x2={ix + 16} y2={iy}
                          stroke={dotCol} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.7}
                        />
                        <line x1={ix + 11} y1={iy} x2={ix + 21} y2={iy}
                          stroke={dotCol} strokeWidth={1} strokeOpacity={0.7} />
                        <line x1={ix + 11} y1={sCogGnd[1]} x2={ix + 21} y2={sCogGnd[1]}
                          stroke={dotCol} strokeWidth={1} strokeOpacity={0.7} />
                        {/* AS% label */}
                        <rect
                          x={ix + 24} y={iy - 12}
                          width={70} height={26}
                          fill={C.labelBg} rx={3} opacity={0.95}
                        />
                        <text x={ix + 28} y={iy + 1}
                          fill={dotCol} fontSize={11} fontFamily={font}
                          fontWeight="bold">
                          {AS_kin_pct.toFixed(0)}% AS
                        </text>
                        <text x={ix + 28} y={iy + 12}
                          fill={C.muted} fontSize={7.5} fontFamily={font}>
                          h={_sqIntersectH.toFixed(0)}mm
                        </text>
                      </>
                    )}
                  </>
                );
              })()}

              </>)}

              {/* ── Geometric pivot line ── */}
              {vis.akPivotLine && (() => {
                // Compute intersection of (sRc → sPivot extended) with CoG vertical
                // in screen space. The line goes: sRc → sPivot → beyond.
                const pvDx = sPivot[0] - sRc[0];
                const pvDy = sPivot[1] - sRc[1];
                // Avoid degenerate case (pivot directly above contact — shaft bikes)
                if (Math.abs(pvDx) < 0.5) return null;
                // t at CoG vertical (x = sCogGnd[0]):
                const t_pv = (sCogGnd[0] - sRc[0]) / pvDx;
                const pivIntX = sCogGnd[0];
                const pivIntY = sRc[1] + t_pv * pvDy;

                // Geometric AS%: intersection height / CoG height (both in screen px)
                const groundScrY = sRc[1];           // RC is at ground level
                const cogScrH    = groundScrY - sCog[1]; // CoG height in px (> 0)
                const intScrH    = groundScrY - pivIntY;  // intersection height in px
                const geoAS      = cogScrH > 0 ? (intScrH / cogScrH) * 100 : 0;
                const geoH_mm    = cogScrH > 0 ? (intScrH / cogScrH) * results.cog.Y_cg : 0;

                // Extend the line forward until it intersects the horizontal CoG line (y = sCog[1])
                // i.e. find t such that sRc[1] + t*pvDy = sCog[1]
                let P2ext: [number, number];
                if (Math.abs(pvDy) < 0.5) {
                  // Swingarm nearly horizontal — fall back to short unit extension
                  const lineLen = Math.sqrt(pvDx*pvDx + pvDy*pvDy) || 1;
                  const pvUx2 = pvDx/lineLen, pvUy2 = pvDy/lineLen;
                  P2ext = [sPivot[0] + pvUx2 * 40, sPivot[1] + pvUy2 * 40];
                } else {
                  const t_horiz = (sCog[1] - sRc[1]) / pvDy;
                  P2ext = [sRc[0] + t_horiz * pvDx, sCog[1]];
                }

                return (
                  <>
                    {/* Dashed line: sRc → sPivot (extended) */}
                    <line x1={sRc[0]} y1={sRc[1]} x2={P2ext[0]} y2={P2ext[1]}
                      stroke={AK.pivotLine} strokeWidth={1.5}
                      strokeDasharray="7 4" strokeLinecap="round"
                      opacity={0.75}
                    />
                    {/* Small circle at pivot on this line */}
                    <circle cx={sPivot[0]} cy={sPivot[1]} r={5}
                      fill="none" stroke={AK.pivotLine} strokeWidth={1.5} opacity={0.7} />
                    {vis.labels && (
                      <text
                        x={(sRc[0] + sPivot[0]) / 2 + 8}
                        y={(sRc[1] + sPivot[1]) / 2 - 8}
                        fill={AK.pivotLine} fontSize={7.5} fontFamily={font}
                        opacity={0.85}
                      >
                        GEO LINE
                      </text>
                    )}

                    {/* Intersection with CoG vertical — circle marker */}
                    {isFinite(pivIntX) && isFinite(pivIntY) && (
                      <>
                        <circle cx={pivIntX} cy={pivIntY} r={6}
                          fill={AK.pivotLine} fillOpacity={0.2}
                          stroke={AK.pivotLine} strokeWidth={1.8} opacity={0.8}
                        />
                        {vis.dimensionLabels && (
                          <>
                            {/* Height leader (on left side of CoG vertical to avoid clash with IC label) */}
                            <line
                              x1={pivIntX - 16} y1={groundScrY}
                              x2={pivIntX - 16} y2={pivIntY}
                              stroke={AK.pivotLine} strokeWidth={1}
                              strokeDasharray="4 3" strokeOpacity={0.65}
                            />
                            <line x1={pivIntX - 11} y1={pivIntY}    x2={pivIntX - 21} y2={pivIntY}
                              stroke={AK.pivotLine} strokeWidth={1} strokeOpacity={0.65} />
                            <line x1={pivIntX - 11} y1={groundScrY} x2={pivIntX - 21} y2={groundScrY}
                              stroke={AK.pivotLine} strokeWidth={1} strokeOpacity={0.65} />
                            {/* Label to the left of CoG vertical */}
                            <rect
                              x={pivIntX - 94} y={pivIntY - 12}
                              width={72} height={26}
                              fill={C.labelBg} rx={3} opacity={0.93}
                            />
                            <text x={pivIntX - 90} y={pivIntY + 1}
                              fill={AK.pivotLine} fontSize={11} fontFamily={font}
                              fontWeight="bold">
                              {geoAS.toFixed(0)}% GEO
                            </text>
                            <text x={pivIntX - 90} y={pivIntY + 12}
                              fill={C.muted} fontSize={7.5} fontFamily={font}>
                              h={geoH_mm.toFixed(0)}mm
                            </text>
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              })()}

            </g>
          );
        })()}

        {/* ── Tech Specs HUD ── */}
        {/* Live engineering specs overlay — top-right corner of the canvas */}
        {(() => {
          const trail    = results.geometry.trail;
          const rake     = headAngle;
          const saAngle  = -results.geometry.swingarmAngleDeg;
          const asIdx    = results.antiSquat.antiSquatPercent;
          const trailOk  = trail >= 80 && trail <= 120;
          const asOk     = asIdx >= 80 && asIdx <= 120;
          const hudX = w - 170;
          const hudY = 10;
          const rows: Array<[string, string, boolean|null]> = [
            ['Static Trail',    `${trail.toFixed(1)} mm`,         trailOk],
            ['Rake Angle',      `${rake.toFixed(1)}°`,            null],
            ['SA Angle (CW+)',   `${saAngle.toFixed(1)}°`,         null],
            ['Anti-Squat Index',`${asIdx.toFixed(0)} %`,          asOk],
          ];
          return (
            <g>
              <rect x={hudX - 8} y={hudY} width={168} height={rows.length * 20 + 22}
                fill={dk ? 'rgba(10,15,21,0.82)' : 'rgba(240,245,255,0.88)'}
                stroke={dk ? '#30363d' : '#b8c4d0'} strokeWidth={1} rx={6} />
              <text x={hudX} y={hudY + 14}
                fill={C.muted} fontSize={8.5} fontFamily={font}
                fontWeight="700" letterSpacing={1.2}>TECH SPECS</text>
              {rows.map(([label, value, ok], i) => {
                const ry = hudY + 26 + i * 20;
                const vCol = ok === null ? C.label
                  : ok ? (dk ? '#3fb950' : '#1a7f37')
                  : (dk ? '#f85149' : '#cf222e');
                return (
                  <g key={label}>
                    <text x={hudX} y={ry}
                      fill={C.muted} fontSize={8} fontFamily={font}>{label}</text>
                    <text x={hudX + 158} y={ry}
                      fill={vCol} fontSize={9} fontFamily={font}
                      textAnchor="end" fontWeight="bold">{value}</text>
                  </g>
                );
              })}
            </g>
          );
        })()}

      </svg>

      {/* ── UI Controls ── */}

      {/* Blueprint mode toggle */}
      <button
        onClick={() => setBlueprintMode(m => !m)}
        style={{
          position: 'absolute', top: 8, left: 68, zIndex: 25,
          background: blueprintMode ? '#388bfd' : 'rgba(13,17,23,0.85)',
          border: `1px solid ${blueprintMode ? '#58a6ff' : '#30363d'}`,
          borderRadius: 6,
          color: blueprintMode ? '#fff' : '#8b949e',
          fontSize: 10, padding: '4px 9px', cursor: 'pointer',
          fontFamily: font, letterSpacing: 0.5,
          boxShadow: blueprintMode ? '0 0 8px #388bfd55' : 'none',
        }}
        title="Toggle Blueprint view: high-contrast line-art + 3-state suspension overlay"
      >
        ⬡ BLUEPRINT
      </button>

      {/* Toggle layer button */}
      <button
        onClick={() => setShowToggle(s => !s)}
        style={{
          position: 'absolute', top: 8, left: 8, zIndex: 25,
          background: showToggle ? 'var(--accent2,#3fb950)' : 'rgba(13,17,23,0.85)',
          border: '1px solid #30363d', borderRadius: 6,
          color: showToggle ? '#fff' : '#8b949e',
          fontSize: 10, padding: '4px 9px', cursor: 'pointer',
          fontFamily: font, letterSpacing: 0.5,
        }}
      >
        ⊞ LAYERS
      </button>

      {/* Zoom / Reset controls */}
      <div style={{
        position: 'absolute', bottom: 38, right: 12, zIndex: 20,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {[
          { label: '+', action: () => { const vp = vpRef.current; vp.scale = Math.min(8, vp.scale * 1.2); bumpVp(); } },
          { label: '⌂', action: resetView },
          { label: '−', action: () => { const vp = vpRef.current; vp.scale = Math.max(0.08, vp.scale / 1.2); bumpVp(); } },
        ].map(({ label, action }) => (
          <button key={label} onClick={action} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid #30363d',
            background: 'rgba(13,17,23,0.85)', color: '#8b949e',
            fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: font,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Current scale indicator */}
      <div style={{
        position: 'absolute', bottom: 8, right: 12, zIndex: 20,
        fontSize: 8, color: C.muted, fontFamily: font,
        background: 'rgba(13,17,23,0.6)', padding: '2px 5px', borderRadius: 3,
      }}>
        {(vpRef.current.scale * 1000).toFixed(0)} px/m
      </div>

      {/* ── Static Sag sliders ── */}
      <div style={{
        position: 'absolute', bottom: 38, left: 8, zIndex: 20,
        background: dk ? 'rgba(10,15,21,0.88)' : 'rgba(240,245,255,0.92)',
        border: `1px solid ${dk ? '#30363d' : '#b8c4d0'}`,
        borderRadius: 7, padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 7,
        minWidth: 160,
      }}>
        <span style={{ fontSize: 8.5, color: C.muted, fontFamily: font, fontWeight: 700, letterSpacing: 1 }}>
          STATIC SAG
        </span>
        {([
          ['Front', sagFront_mm, setSagFront, input.suspension.forkTravel  ?? 120],
          ['Rear',  sagRear_mm,  setSagRear,  input.suspension.shockTravel ?? 130],
        ] as Array<[string, number, (v: number) => void, number]>).map(
          ([label, val, setter, maxTravel]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: C.label, fontFamily: font, width: 30 }}>{label}</span>
              <input
                type="range" min={0} max={Math.round(maxTravel * 0.4)} step={1}
                value={val}
                onChange={e => setter(Number(e.target.value))}
                style={{ width: 90, accentColor: 'var(--accent2,#3fb950)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 9, color: C.muted, fontFamily: font, width: 32, textAlign: 'right' }}>
                {val} mm
              </span>
            </div>
          )
        )}
      </div>

      {/* Toggle panel */}
      {showToggle && <TogglePanel onClose={() => setShowToggle(false)} />}
    </div>
  );
}
