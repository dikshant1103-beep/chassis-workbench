/**
 * femSolver.ts — 2D Plane-Frame Euler-Bernoulli Beam FEM Solver
 *
 * Solves a simplified 5-element motorcycle frame model for stress analysis.
 * All units: mm, N, N/mm²
 */

import {
  FEMSectionParams,
  FEMNodeResult,
  FEMElementResult,
  FEMResults,
  GeometryParams,
  ErgoParams,
  CoGResults,
  DynamicsResults,
} from './types';

// ─────────────────────────────────────────────
// MATERIAL DATABASE
// ─────────────────────────────────────────────

const MATERIALS: Record<string, { E: number; G: number; sigma_yield: number }> = {
  steel:    { E: 200000, G: 77000,  sigma_yield: 355 },
  aluminum: { E: 70000,  G: 26000,  sigma_yield: 270 },
  cfrp:     { E: 70000,  G: 5000,   sigma_yield: 600 },
  titanium: { E: 110000, G: 41000,  sigma_yield: 880 },
};

// ─────────────────────────────────────────────
// CROSS SECTION HELPERS
// ─────────────────────────────────────────────

function tubeSection(OD: number, t: number) {
  const ID = OD - 2 * t;
  const A = Math.PI * (OD * OD - ID * ID) / 4;
  const I = Math.PI * (OD * OD * OD * OD - ID * ID * ID * ID) / 64;
  const c_fiber = OD / 2;
  return { A, I, c_fiber };
}

// ─────────────────────────────────────────────
// 6×6 LOCAL STIFFNESS MATRIX
// ─────────────────────────────────────────────

function localStiffness(E: number, A: number, I: number, L: number): number[][] {
  const EAL  = E * A / L;
  const EI12 = 12 * E * I / (L * L * L);
  const EI6  = 6  * E * I / (L * L);
  const EI4  = 4  * E * I / L;
  const EI2  = 2  * E * I / L;

  return [
    [ EAL,   0,     0,    -EAL,   0,     0    ],
    [ 0,     EI12,  EI6,   0,    -EI12,  EI6  ],
    [ 0,     EI6,   EI4,   0,    -EI6,   EI2  ],
    [-EAL,   0,     0,     EAL,   0,     0    ],
    [ 0,    -EI12, -EI6,   0,     EI12, -EI6  ],
    [ 0,     EI6,   EI2,   0,    -EI6,   EI4  ],
  ];
}

// ─────────────────────────────────────────────
// TRANSFORMATION MATRIX (6×6)
// ─────────────────────────────────────────────

function transformMatrix(x1: number, y1: number, x2: number, y2: number): number[][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L  = Math.sqrt(dx * dx + dy * dy);
  if (L < 1e-10) throw new Error('Zero-length element in FEM mesh');
  const c = dx / L;
  const s = dy / L;
  return [
    [ c,  s, 0,  0,  0, 0],
    [-s,  c, 0,  0,  0, 0],
    [ 0,  0, 1,  0,  0, 0],
    [ 0,  0, 0,  c,  s, 0],
    [ 0,  0, 0, -s,  c, 0],
    [ 0,  0, 0,  0,  0, 1],
  ];
}

// ─────────────────────────────────────────────
// MATRIX OPERATIONS (pure loops, no library)
// ─────────────────────────────────────────────

function mat6x6mul(A: number[][], B: number[][]): number[][] {
  const C: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++)
      for (let k = 0; k < 6; k++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function mat6x6transpose(A: number[][]): number[][] {
  const T: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++)
      T[i][j] = A[j][i];
  return T;
}

/** Assemble 6×6 element matrix into N×N global matrix at given DOF indices */
function assemble(K: number[][], Ke: number[][], dofs: number[]) {
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++)
      K[dofs[i]][dofs[j]] += Ke[i][j];
}

// ─────────────────────────────────────────────
// GAUSSIAN ELIMINATION WITH PARTIAL PIVOTING
// ─────────────────────────────────────────────

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Augmented matrix
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find max pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    // Swap rows
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12)
      throw new Error('Singular stiffness matrix — check boundary conditions');

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++)
        M[row][j] -= factor * M[col][j];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++)
      x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ─────────────────────────────────────────────
// STRESS COLOUR
// ─────────────────────────────────────────────

function stressColor(SF: number): string {
  if (SF >= 5)   return '#3fb950';
  if (SF >= 3)   return '#7ee787';
  if (SF >= 2)   return '#e3b341';
  if (SF >= 1.5) return '#f0883e';
  return '#f85149';
}

// ─────────────────────────────────────────────
// MAIN SOLVER
// ─────────────────────────────────────────────

export const DEFAULT_FEM_SECTION: FEMSectionParams = {
  forkOD: 43, forkWall: 3,
  frameOD: 32, frameWall: 2.5,
  swingarmOD: 38, swingarmWall: 3,
  forkMaterial: 'aluminum',
  frameMaterial: 'steel',
  swingarmMaterial: 'aluminum',
};

export function computeFEM(
  params: FEMSectionParams,
  geo: GeometryParams,
  ergo: ErgoParams,
  riderWeight: number,
  pillionWeight: number,
  luggageWeight: number,
  engineWeight: number,
  cogResults: CoGResults,
  dynResults: DynamicsResults,
): FEMResults {
  const EMPTY: FEMResults = {
    nodes: [], elements: [],
    maxDisplacement: 0, maxStress: 0,
    minSafetyFactor: 999, criticalElement: 'none',
    solved: false, error: 'Not solved yet',
  };

  try {
    // ── 1. DEFINE NODES ────────────────────────────────────────────
    const R_f   = geo.frontWheelDia / 2;
    const alpha = (geo.headAngle * Math.PI) / 180;
    const ht_bx = geo.forkOffset * Math.cos(alpha);
    const ht_by = R_f + geo.forkOffset * Math.sin(alpha);
    const HT_HALF = 110;
    const WB    = geo.wheelbase;
    const H_sp  = geo.swingarmPivotHeight;
    const X_sp  = geo.swingarmPivotX;
    const H_ra  = geo.rearAxleHeight;

    // Node coordinates (x, y) in mm
    const nodeCoords: [number, number][] = [
      // N0: front axle
      [0,     R_f],
      // N1: head tube bottom
      [ht_bx + Math.sin(alpha) * HT_HALF * 0.6,  ht_by - Math.cos(alpha) * HT_HALF * 0.6],
      // N2: head tube top
      [ht_bx - Math.sin(alpha) * HT_HALF * 1.3,  ht_by + Math.cos(alpha) * HT_HALF * 1.3],
      // N3: swingarm pivot
      [X_sp,  H_sp],
      // N4: seat
      [ergo.seatX, ergo.seatY],
      // N5: rear axle
      [WB,    H_ra],
    ];

    const NNODE = nodeCoords.length;      // 6
    const NDOF  = NNODE * 3;             // 18

    // ── 2. DEFINE ELEMENTS ──────────────────────────────────────────
    // [ node1, node2, OD, wall, material ]
    type ElemDef = { n1: number; n2: number; OD: number; wall: number; mat: string; label: string };
    const elemDefs: ElemDef[] = [
      { n1: 0, n2: 1, OD: params.forkOD,      wall: params.forkWall,      mat: params.forkMaterial,      label: 'Fork'       },
      { n1: 1, n2: 2, OD: params.frameOD,      wall: params.frameWall,     mat: params.frameMaterial,     label: 'Head Tube'  },
      { n1: 2, n2: 3, OD: params.frameOD,      wall: params.frameWall,     mat: params.frameMaterial,     label: 'Frame Rail' },
      { n1: 3, n2: 4, OD: params.frameOD,      wall: params.frameWall,     mat: params.frameMaterial,     label: 'Seat Tube'  },
      { n1: 3, n2: 5, OD: params.swingarmOD,   wall: params.swingarmWall,  mat: params.swingarmMaterial,  label: 'Swingarm'   },
    ];

    const NELEM = elemDefs.length;

    // ── 3. ASSEMBLE GLOBAL STIFFNESS ────────────────────────────────
    // Initialize K as n×n zero matrix
    const K: number[][] = Array.from({ length: NDOF }, () => new Array(NDOF).fill(0));

    // Also store T and k_local per element for post-processing
    const elemT:      number[][][] = [];
    const elemKlocal: number[][][] = [];
    const elemLengths: number[]    = [];

    for (const ed of elemDefs) {
      const [x1, y1] = nodeCoords[ed.n1];
      const [x2, y2] = nodeCoords[ed.n2];
      const dx = x2 - x1, dy = y2 - y1;
      const L  = Math.sqrt(dx * dx + dy * dy);
      elemLengths.push(L);

      const mat  = MATERIALS[ed.mat] ?? MATERIALS.steel;
      const sect = tubeSection(ed.OD, ed.wall);
      const kl   = localStiffness(mat.E, sect.A, sect.I, L);
      const T    = transformMatrix(x1, y1, x2, y2);
      const Tt   = mat6x6transpose(T);
      const Ke   = mat6x6mul(Tt, mat6x6mul(kl, T));  // T^T × k_local × T

      elemT.push(T);
      elemKlocal.push(kl);

      // DOF mapping: [3n1, 3n1+1, 3n1+2, 3n2, 3n2+1, 3n2+2]
      const dofs = [
        ed.n1 * 3, ed.n1 * 3 + 1, ed.n1 * 3 + 2,
        ed.n2 * 3, ed.n2 * 3 + 1, ed.n2 * 3 + 2,
      ];
      assemble(K, Ke, dofs);
    }

    // ── 4. FORCE VECTOR ────────────────────────────────────────────
    const F = new Array(NDOF).fill(0);

    // N4 (seat, node 4) — rider + pillion + luggage weight downward
    const seatForce = -(riderWeight + pillionWeight + luggageWeight) * 9.81;
    F[4 * 3 + 1] += seatForce;  // dof 13

    // N3 (swingarm pivot, node 3) — engine weight downward
    F[3 * 3 + 1] += -engineWeight * 9.81;  // dof 10

    // N2 (head tube top, node 2) — braking horizontal force
    F[2 * 3 + 0] += dynResults.deltaW_brake * 0.5;  // dof 6

    // N1 (head tube bottom, node 1) — partial front load downward
    F[1 * 3 + 1] += -cogResults.R_front * 0.15;  // dof 4

    // ── 5. BOUNDARY CONDITIONS ─────────────────────────────────────
    // N0 (front axle, node 0): fix u, v, θ — DOFs 0,1,2
    // N5 (rear axle, node 5): fix u, v, θ — DOFs 15,16,17
    const fixedDOFs = [0, 1, 2, 15, 16, 17];

    // Apply BC by large penalty (or zero-out rows/cols)
    // Use zero-row method: set row to identity, F to 0
    const K_mod = K.map(row => [...row]);
    const F_mod = [...F];

    for (const dof of fixedDOFs) {
      for (let j = 0; j < NDOF; j++) {
        K_mod[dof][j] = 0;
        K_mod[j][dof] = 0;
      }
      K_mod[dof][dof] = 1;
      F_mod[dof] = 0;
    }

    // ── 6. SOLVE ───────────────────────────────────────────────────
    let U: number[];
    try {
      U = gaussSolve(K_mod, F_mod);
    } catch (e) {
      return { ...EMPTY, error: `Solver error: ${e instanceof Error ? e.message : String(e)}` };
    }

    // ── 7. POST-PROCESS ────────────────────────────────────────────
    const nodeResults: FEMNodeResult[] = nodeCoords.map(([x, y], i) => ({
      id: i, x, y,
      dx: U[i * 3],
      dy: U[i * 3 + 1],
      dtheta: U[i * 3 + 2],
    }));

    const elemResults: FEMElementResult[] = [];

    for (let ei = 0; ei < NELEM; ei++) {
      const ed   = elemDefs[ei];
      const T    = elemT[ei];
      const kl   = elemKlocal[ei];
      const L    = elemLengths[ei];

      const mat  = MATERIALS[ed.mat] ?? MATERIALS.steel;
      const sect = tubeSection(ed.OD, ed.wall);

      // Extract global displacements for this element
      const dofs = [
        ed.n1 * 3, ed.n1 * 3 + 1, ed.n1 * 3 + 2,
        ed.n2 * 3, ed.n2 * 3 + 1, ed.n2 * 3 + 2,
      ];
      const u_elem = dofs.map(d => U[d]);

      // Transform to local: u_local = T × u_elem
      const u_local = new Array(6).fill(0);
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 6; j++)
          u_local[i] += T[i][j] * u_elem[j];

      // Local forces: f_local = k_local × u_local
      const f_local = new Array(6).fill(0);
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 6; j++)
          f_local[i] += kl[i][j] * u_local[j];

      const N    = f_local[0];        // axial force at node 1 (+ tension)
      const V1   = f_local[1];        // shear at node 1
      const M1   = f_local[2];        // moment at node 1
      const M2   = f_local[5];        // moment at node 2

      const M_max      = Math.max(Math.abs(M1), Math.abs(M2));
      const axialStress   = N / sect.A;
      const bendingStress = M_max * sect.c_fiber / sect.I;
      const combinedStress = Math.abs(axialStress) + bendingStress;
      const safetyFactor  = mat.sigma_yield / Math.max(combinedStress, 0.001);
      const color         = stressColor(safetyFactor);

      elemResults.push({
        id: ei,
        label: ed.label,
        node1: ed.n1,
        node2: ed.n2,
        axialForce: N,
        shearForce: V1,
        momentMax: M_max,
        axialStress,
        bendingStress,
        combinedStress,
        safetyFactor,
        stressColor: color,
        length: L,
      });
    }

    // ── 8. SUMMARY ────────────────────────────────────────────────
    const maxDisp = nodeResults.reduce((mx, n) => {
      const d = Math.sqrt(n.dx * n.dx + n.dy * n.dy);
      return Math.max(mx, d);
    }, 0);

    const maxStress     = elemResults.reduce((mx, e) => Math.max(mx, e.combinedStress), 0);
    const minSF         = elemResults.reduce((mn, e) => Math.min(mn, e.safetyFactor), 999);
    const critElem      = elemResults.find(e => e.safetyFactor === minSF);

    return {
      nodes: nodeResults,
      elements: elemResults,
      maxDisplacement: maxDisp,
      maxStress,
      minSafetyFactor: minSF,
      criticalElement: critElem?.label ?? 'none',
      solved: true,
    };
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
}
