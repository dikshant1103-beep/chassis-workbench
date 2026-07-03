/**
 * stiffnessBenchmarks.ts — Published component stiffness benchmark bands.
 *
 * Source of truth: references/extractions/structural_constants.md (cited, tagged).
 * Frame torsional/lateral has NO reliable public benchmark (manufacturer-proprietary)
 * → not listed here; the StiffnessTargets engine DERIVES the frame target instead and
 * tags it 'estimated'. These component bands are what we CAN benchmark honestly.
 */

import type { BenchmarkBand } from '../engine/structural/stiffnessTargets';

export const COMPONENT_BENCHMARKS: BenchmarkBand[] = [
  { label: 'Swingarm lateral (at wheel)',     unit: 'N/mm',   min: 500,  max: 1500, tag: 'measured', src: 'Foale Ch.8' },
  { label: 'Swingarm torsional (at wheel)',   unit: 'Nm/deg', min: 1000, max: 3000, tag: 'measured', src: 'Foale Ch.8' },
  { label: 'Swingarm torsional (about pivot)',unit: 'kNm/rad',min: 10,   max: 20,   tag: 'lit',      src: 'Cossalter Ch.6-8' },
  { label: 'Swingarm camber',                 unit: 'kN/deg', min: 10,   max: 30,   tag: 'measured', src: 'Foale Ch.8' },
  { label: 'Fork stiffness (per leg)',        unit: 'N/mm',   min: 10,   max: 20,   tag: 'lit',      src: 'Cossalter Ch.5' },
  { label: 'Fork bending (flexible model)',   unit: 'kNm/rad',min: 25,   max: 75,   tag: 'lit',      src: 'Cossalter VB-14' },
  { label: 'Tyre vertical (Avon 170/60ZR17)', unit: 'N/mm',   min: 137,  max: 186,  tag: 'measured', src: 'Foale Ch.2' },
];

/** Modal anchors used by the frequency-separation route (Cossalter Ch.7). */
export const MODAL_ANCHORS = {
  wobbleHz: { min: 4, max: 10, typical: 7, tag: 'lit' as const, src: 'Cossalter Ch.7' },
  weaveHz:  { min: 0, max: 4,  typical: 3, tag: 'lit' as const, src: 'Cossalter Ch.7' },
  wheelHopHz: { min: 12, max: 18, typical: 15, tag: 'lit' as const, src: 'Cossalter Ch.5' },
  frameModeMarginOverWobble: 1.5,  // design rule (estimated)
};

/** Where a value sits within a benchmark band: <0 below, 0..1 in-band, >1 above. */
export function bandPosition(value: number, band: BenchmarkBand): number {
  if (band.max === band.min) return value >= band.max ? 1 : 0;
  return (value - band.min) / (band.max - band.min);
}
