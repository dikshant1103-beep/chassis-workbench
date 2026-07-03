import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useTheme } from '../../store/useTheme';

// ── Tube helper ──────────────────────────────────────────────────────────────
function Tube({ from, to, radius = 12, color = '#8b949e', opacity = 1 }: {
  from: [number,number,number]; to: [number,number,number];
  radius?: number; color?: string; opacity?: number;
}) {
  const [mid, quat, len] = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const length = dir.length();
    const midPt: [number,number,number] = [(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());
    return [midPt, [q.x,q.y,q.z,q.w] as [number,number,number,number], length];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...from, ...to]);
  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[radius,radius,len,10]} />
      <meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} roughness={0.4} metalness={0.5} />
    </mesh>
  );
}

// ── Dot helper ───────────────────────────────────────────────────────────────
function Dot({ pos, radius=16, color='#fff' }: { pos:[number,number,number]; radius?:number; color?:string }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[radius,12,12]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.5} />
    </mesh>
  );
}

// ── Label3D helper ────────────────────────────────────────────────────────────
function Label3D({ pos, text, sub, color='#8b949e', dx=20, dy=0 }: {
  pos:[number,number,number]; text:string; sub?:string; color?:string; dx?:number; dy?:number;
}) {
  return (
    <Html position={pos} style={{ pointerEvents:'none', transform:`translate(${dx}px,${dy}px)` }}>
      <div style={{ fontFamily:'Consolas,monospace', fontSize:9, color, whiteSpace:'nowrap', textShadow:'0 0 4px rgba(0,0,0,0.9)' }}>
        <div style={{ fontWeight:700 }}>{text}</div>
        {sub && <div style={{ opacity:0.8 }}>{sub}</div>}
      </div>
    </Html>
  );
}

// ── Force arrow ───────────────────────────────────────────────────────────────
function ForceArrow({ pos, force, color='#f85149' }: { pos:[number,number,number]; force:number; color?:string }) {
  const scale = Math.min(Math.max(Math.abs(force)/500, 30), 150);
  return (
    <group position={pos}>
      <mesh position={[0, -scale/2, 0]}>
        <cylinderGeometry args={[4,4,scale,8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, -scale-20, 0]}>
        <coneGeometry args={[12,30,8]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

// ── Inner scene ───────────────────────────────────────────────────────────────
function FEMSceneInner() {
  const fem     = useStore(s => s.results.fem);
  const geo     = useStore(s => s.input.geometry);
  const results = useStore(s => s.results);
  const { theme } = useTheme();
  const dk = theme === 'dark';

  const WB  = geo.wheelbase;
  const R_f = geo.frontWheelDia / 2;
  const R_r = geo.rearWheelDia  / 2;

  const DEFORM_SCALE = 500;
  const camTarget: [number,number,number] = [WB*0.45, R_r+300, 0];

  if (!fem.solved || fem.nodes.length === 0) {
    return (
      <>
        <ambientLight intensity={0.6} />
        <Html center>
          <div style={{ color:'#f85149', fontFamily:'Consolas,monospace', fontSize:14 }}>
            FEM solve failed: {fem.error}
          </div>
        </Html>
        <OrbitControls target={camTarget} />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={dk ? 0.4 : 0.7} />
      <directionalLight position={[-500,2000,1500]} intensity={dk ? 0.9 : 1.1} />
      <directionalLight position={[WB+500,1500,-1500]} intensity={0.4} />

      <Grid args={[5000,5000]} position={[WB/2,0,0]}
        cellSize={100} cellThickness={0.4} cellColor={dk?'#1e2530':'#c8d0da'}
        sectionSize={500} sectionThickness={0.8} sectionColor={dk?'#2a3344':'#b0bac4'}
        fadeDistance={6000} infiniteGrid />

      {/* Wheels (muted) */}
      <mesh position={[0, R_f, 0]}>
        <torusGeometry args={[R_f-62,62,16,64]} />
        <meshStandardMaterial color="#444c56" roughness={0.8} />
      </mesh>
      <mesh position={[WB, geo.rearAxleHeight, 0]}>
        <torusGeometry args={[R_r-62,62,16,64]} />
        <meshStandardMaterial color="#444c56" roughness={0.8} />
      </mesh>

      {/* FEM elements — colored by stress */}
      {fem.elements.map(el => {
        const n1 = fem.nodes[el.node1];
        const n2 = fem.nodes[el.node2];
        if (!n1 || !n2) return null;
        const from: [number,number,number] = [n1.x, n1.y, 0];
        const to:   [number,number,number] = [n2.x, n2.y, 0];
        const mid: [number,number,number]  = [(n1.x+n2.x)/2, (n1.y+n2.y)/2, 0];
        return (
          <group key={el.id}>
            <Tube from={from} to={to} radius={20} color={el.stressColor} />
            <Label3D pos={mid}
              text={el.label}
              sub={`\u03c3=${el.combinedStress.toFixed(0)} MPa \u00b7 SF=${el.safetyFactor<100?el.safetyFactor.toFixed(1):'—'}`}
              color={el.stressColor} dx={10} />
          </group>
        );
      })}

      {/* Deformed shape (magnified) */}
      {fem.elements.map(el => {
        const n1 = fem.nodes[el.node1];
        const n2 = fem.nodes[el.node2];
        if (!n1 || !n2) return null;
        const from: [number,number,number] = [n1.x + n1.dx*DEFORM_SCALE, n1.y + n1.dy*DEFORM_SCALE, 10];
        const to:   [number,number,number] = [n2.x + n2.dx*DEFORM_SCALE, n2.y + n2.dy*DEFORM_SCALE, 10];
        return <Tube key={`def-${el.id}`} from={from} to={to} radius={5} color="#58a6ff" opacity={0.4} />;
      })}

      {/* Nodes */}
      {fem.nodes.map(n => {
        const disp = Math.sqrt(n.dx*n.dx + n.dy*n.dy);
        return (
          <group key={n.id}>
            <Dot pos={[n.x, n.y, 0]} radius={18} color="#ffffff" />
            <Label3D
              pos={[n.x, n.y, 0]}
              text={`N${n.id}`}
              sub={`\u03b4=${disp.toFixed(4)}mm`}
              color="#c9d1d9" dx={20} dy={-10}
            />
          </group>
        );
      })}

      {/* Force arrows */}
      {fem.nodes[4] && (
        <ForceArrow
          pos={[fem.nodes[4].x, fem.nodes[4].y + 20, 0]}
          force={results.cog.totalWeight}
          color="#f85149"
        />
      )}
      {fem.nodes[0] && (
        <ForceArrow
          pos={[fem.nodes[0].x, fem.nodes[0].y - 20, 0]}
          force={-results.cog.R_front}
          color="#3fb950"
        />
      )}
      {fem.nodes[5] && (
        <ForceArrow
          pos={[fem.nodes[5].x, fem.nodes[5].y - 20, 0]}
          force={-results.cog.R_rear}
          color="#3fb950"
        />
      )}

      <OrbitControls target={camTarget} enableDamping dampingFactor={0.08} minDistance={400} maxDistance={8000} />
      <GizmoHelper alignment="bottom-left" margin={[60,60]}>
        <GizmoViewport axisColors={['#f85149','#3fb950','#1f6feb']} labelColor="#e6edf3" />
      </GizmoHelper>
    </>
  );
}

// ── Exported canvas wrapper ───────────────────────────────────────────────────
export default function FEMScene() {
  const geo = useStore(s => s.input.geometry);
  const { theme } = useTheme();
  const R_f = geo.frontWheelDia / 2;
  const WB  = geo.wheelbase;
  const bg  = theme === 'dark' ? '#0a0f15' : '#dde5ef';

  return (
    <div style={{ width:'100%', height:'100%', background:bg, position:'relative' }}>
      <Canvas
        camera={{ position:[WB*0.25, R_f+700, 2600], fov:42, near:10, far:20000 }}
        shadows gl={{ antialias:true, alpha:false }} style={{ background:bg }}
      >
        <FEMSceneInner />
      </Canvas>
      {/* Stress legend */}
      <div style={{
        position:'absolute', top:8, right:8,
        fontFamily:'Consolas,monospace', fontSize:10,
        background:'rgba(13,17,23,0.85)', border:'1px solid #30363d',
        borderRadius:6, padding:'8px 12px', lineHeight:1.8,
      }}>
        <div style={{ color:'#8b949e', fontWeight:700, marginBottom:4 }}>SAFETY FACTOR</div>
        {([
          ['#3fb950','SF \u2265 5  Safe'],
          ['#7ee787','SF 3\u20135  Good'],
          ['#e3b341','SF 2\u20133  Marginal'],
          ['#f0883e','SF 1.5\u20132  Warning'],
          ['#f85149','SF < 1.5  CRITICAL'],
        ] as [string,string][]).map(([c,t]) => (
          <div key={t} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:10, height:10, background:c, borderRadius:2 }} />
            <span style={{ color:'#c9d1d9' }}>{t}</span>
          </div>
        ))}
        <div style={{ marginTop:6, color:'#58a6ff', fontSize:9 }}>Blue = deformed \u00d7500</div>
      </div>
    </div>
  );
}
