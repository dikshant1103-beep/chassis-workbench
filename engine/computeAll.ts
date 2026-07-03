/**
 * computeAll.ts — Master Physics Computation Function
 *
 * This is the single entry point that the UI / state management layer
 * calls. It orchestrates all six physics modules in dependency order
 * and returns a single ComputeAllResult object.
 *
 * DATA FLOW (matches spec Section 2.2):
 *   ComputeAllInput → geometry → cog → suspension → antiSquat
 *                                                 → ergonomics
 *                                                 → dynamics
 *                                  → ComputeAllResult
 *
 * DEPENDENCY ORDER (critical — later modules use earlier results):
 *   1. geometry  — derives R_f, trail, swingarm angle
 *   2. cog       — derives X_cg, Y_cg, R_front, W  (needs wheelbase)
 *   3. suspension — needs X_cg, Y_cg, totalMass, WB
 *   4. antiSquat  — needs swingarmAngle, X_sp, H_sp, Y_cg, R_front, W
 *   5. ergonomics — independent (only needs ergo contact point params)
 *   6. dynamics   — needs Y_cg, totalMass, R_front, W, WB
 *
 * This function has NO SIDE EFFECTS. Given the same input it always
 * returns the same output — fully deterministic and cacheable.
 *
 * Spec reference: Section 17, Step 9.
 */

import { ComputeAllInput, ComputeAllResult } from './types';
import { computeGeometry } from './geometry';
import { computeCoG } from './cog';
import { computeSuspension } from './suspension';
import { computeAntiSquat } from './antiSquat';
import { computeErgonomics } from './ergonomics';
import { computeDynamics } from './dynamics';

/**
 * Master computation function — calls all physics modules and returns
 * the complete results object.
 *
 * @param input  ComputeAllInput containing all six parameter groups
 *               plus the mass component array
 * @returns      ComputeAllResult with all six result groups
 */
export function computeAll(input: ComputeAllInput): ComputeAllResult {
  const { geometry: gp, massComponents, suspension: sp,
    chain, ergo, dynamics: dp } = input;

  // ── Step 1: Geometry ─────────────────────────────────────────────
  const geometry = computeGeometry(gp);

  // ── Step 2: CoG ──────────────────────────────────────────────────
  // CoG requires wheelbase and swingarm pivot position from geometry params
  const cog = computeCoG(
    massComponents,
    gp.wheelbase,
    gp.swingarmPivotX,
    gp.swingarmPivotHeight,
  );

  // ── Step 3: Suspension ───────────────────────────────────────────
  // Suspension needs CoG position and total mass
  const suspension = computeSuspension(
    sp,
    cog.totalMass,
    cog.X_cg,
    cog.Y_cg,
    gp.wheelbase,
  );

  // ── Step 4: Anti-Squat ───────────────────────────────────────────
  // Anti-squat needs swingarm angle (from geometry), pivot coords,
  // CoG height, static axle loads (from CoG)
  const antiSquat = computeAntiSquat(
    chain,
    gp.swingarmPivotX,
    gp.swingarmPivotHeight,
    geometry.swingarmAngleRad,
    gp.swingarmLength,
    gp.wheelbase,
    cog.Y_cg,
    gp.headAngle,
    cog.R_front,
    cog.totalWeight,
  );

  // ── Step 5: Ergonomics ───────────────────────────────────────────
  // Ergonomics is fully independent of other modules
  const ergonomics = computeErgonomics(ergo);

  // ── Step 6: Dynamics ─────────────────────────────────────────────
  // Dynamics needs CoG height, total mass, axle loads, wheelbase
  const dynamics = computeDynamics(
    dp,
    cog.totalMass,
    cog.Y_cg,
    gp.wheelbase,
    cog.R_front,
    cog.totalWeight,
  );

  return { geometry, cog, suspension, antiSquat, ergonomics, dynamics };
}
