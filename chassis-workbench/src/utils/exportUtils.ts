/**
 * exportUtils.ts — CSV export and print helpers for sweep data
 */

import type { SweepPoint } from '../engine/types';
import type { DynamicsSweepResult } from '../engine/dynamicsSweep';
import type { SquatPoint } from '../engine/antiSquatAnalysis';
import type { LoadCaseResult } from '../engine/structural/loadCases';

/** Trigger a browser file download. */
export function triggerDownload(content: string, filename: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert suspension sweep points to CSV string. */
export function sweepToCSV(points: SweepPoint[]): string {
  const header = [
    'travel_mm', 'swingarmAngle_deg', 'shockLength_mm', 'shockCompression_mm',
    'motionRatio', 'wheelRate_Nmm', 'antiSquat_pct', 'trail_mm',
  ].join(',');
  const rows = points.map(p =>
    [
      p.travel_mm.toFixed(2),
      p.swingarmAngleDeg.toFixed(4),
      p.shockLength_mm.toFixed(3),
      p.shockCompression_mm.toFixed(3),
      p.motionRatio.toFixed(5),
      p.wheelRate_Nmm.toFixed(3),
      p.antiSquatPct.toFixed(3),
      p.trail_mm.toFixed(3),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/** Convert dynamics sweep to CSV — two sections (braking + accel). */
export function dynamicsSweepToCSV(result: DynamicsSweepResult): string {
  const bHeader = 'decel_g,decel_ms2,weightTransfer_N,R_front_N,R_rear_N,frontPct,rearPct,antiDivePct,forkCompression_mm,rearExtension_mm';
  const bRows   = result.braking.map(p =>
    [
      p.decel_g.toFixed(3), p.decel_ms2.toFixed(3),
      p.weightTransfer_N.toFixed(1), p.R_front_N.toFixed(1), p.R_rear_N.toFixed(1),
      p.frontPct.toFixed(2), p.rearPct.toFixed(2),
      p.antiDivePct.toFixed(3), p.forkCompression_mm.toFixed(3), p.rearExtension_mm.toFixed(3),
    ].join(',')
  );

  const aHeader = 'accel_g,accel_ms2,weightTransfer_N,R_front_N,R_rear_N,frontPct,rearPct,wheelieMarginPct';
  const aRows   = result.accel.map(p =>
    [
      p.accel_g.toFixed(3), p.accel_ms2.toFixed(3),
      p.weightTransfer_N.toFixed(1), p.R_front_N.toFixed(1), p.R_rear_N.toFixed(1),
      p.frontPct.toFixed(2), p.rearPct.toFixed(2),
      p.wheelieMarginPct.toFixed(2),
    ].join(',')
  );

  return [
    '# BRAKING SWEEP', bHeader, ...bRows,
    '', '# ACCELERATION SWEEP', aHeader, ...aRows,
  ].join('\n');
}

/** Convert anti-squat sweep to CSV. */
export function squatSweepToCSV(sweep: SquatPoint[]): string {
  const header = 'yc_mm,swingarmAngle_deg,chainAngle_deg,sigma_deg,tau_deg,squatRatio,antiSquatPct';
  const rows   = sweep.map(p =>
    [
      p.yc.toFixed(2),
      p.swingarmAngleDeg.toFixed(4),
      p.chainAngleGeomDeg.toFixed(4),
      isFinite(p.sigma) ? p.sigma.toFixed(4) : 'NaN',
      isFinite(p.tau)   ? p.tau.toFixed(4)   : 'NaN',
      isFinite(p.squatRatio)  ? p.squatRatio.toFixed(5)  : 'NaN',
      isFinite(p.antiSquatPct) ? p.antiSquatPct.toFixed(3) : 'NaN',
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * CAE spec sheet — flatten load cases to one row per (case × attachment point).
 * This is the deliverable for the ANSYS/SolidWorks team: interface loads as FEM
 * boundary conditions. Forces in N, moments in N·m, vehicle frame (x fwd, y right, z up).
 */
export function loadCaseSpecToCSV(results: LoadCaseResult[], meta?: Record<string, string>): string {
  const lines: string[] = [];
  if (meta) for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v}`);
  lines.push('# Forces N, moments N·m, vehicle frame (x fwd, y right, z up)');
  const header = [
    'case_id', 'case_label', 'kind', 'feasible', 'limited_by',
    'attachment', 'Fx_N', 'Fy_N', 'Fz_N', 'resultant_N', 'moment_Nm',
    'confidence', 'provenance', 'note',
  ].join(',');
  const rows: string[] = [];
  for (const r of results) {
    for (const a of r.attachments) {
      rows.push([
        r.def.id, `"${r.def.label}"`, r.def.kind, r.feasible ? 'yes' : 'no',
        r.limitedBy ? `"${r.limitedBy}"` : '',
        a.label, a.Fx.toFixed(1), a.Fy.toFixed(1), a.Fz.toFixed(1),
        a.resultantF.toFixed(1), a.moment.toFixed(2),
        a.confidence, r.provenance, a.note ? `"${a.note}"` : '',
      ].join(','));
    }
  }
  return [...lines, header, ...rows].join('\n');
}

/** Full structured JSON spec (cases + attachments + provenance). */
export function loadCaseSpecToJSON(results: LoadCaseResult[], meta?: Record<string, string>): string {
  return JSON.stringify({
    schema: 'chassis-workbench/load-case-spec/v1',
    units: { force: 'N', moment: 'N·m', frame: 'vehicle x-fwd y-right z-up' },
    generated: new Date().toISOString(),
    meta: meta ?? {},
    cases: results,
  }, null, 2);
}
