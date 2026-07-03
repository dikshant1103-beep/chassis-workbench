/**
 * inertia.ts — Moments of Inertia Module
 *
 * Module 9: Pitch, roll, and yaw moments of inertia from mass components.
 * Uses point-mass approximation (Cossalter Ch. 1 Eq. 1.x).
 *
 * UNIT CONVENTIONS:
 *   Positions : mm (converted to m by dividing by 1000 before squaring)
 *   Mass      : kg
 *   Inertia   : kg·m²
 */

import { MassComponent, InertiaResults } from './types';

/**
 * Compute pitch (I_yy), roll (I_xx), and yaw (I_zz) moments of inertia
 * about the combined CoG, using point-mass approximation.
 *
 * I_pitch = Σ m_i × [(x_i−X_cg)² + (y_i−Y_cg)²] / 10⁶  [kg·m²]
 * I_roll  = Σ m_i × [(y_i−Y_cg)² + (z_i−Z_cg)²] / 10⁶
 * I_yaw   = Σ m_i × [(x_i−X_cg)² + (z_i−Z_cg)²] / 10⁶
 *
 * z_i defaults to 0 (symmetric about centreline) if not provided.
 * Division by 10⁶ converts mm² → m².
 */
export function computeInertia(
  components: MassComponent[],
  X_cg: number,
  Y_cg: number,
): InertiaResults {
  const Z_cg = 0; // lateral CoG at centreline (symmetric motorcycle)

  let I_pitch = 0;
  let I_roll  = 0;
  let I_yaw   = 0;
  let totalMass = 0;

  for (const c of components) {
    const z = c.z ?? 0;
    const dx = (c.x - X_cg) / 1000; // mm → m
    const dy = (c.y - Y_cg) / 1000;
    const dz = (z - Z_cg) / 1000;

    I_pitch += c.mass * (dx * dx + dy * dy);
    I_roll  += c.mass * (dy * dy + dz * dz);
    I_yaw   += c.mass * (dx * dx + dz * dz);
    totalMass += c.mass;
  }

  if (totalMass < 1e-9) {
    return { I_pitch: 0, I_roll: 0, I_yaw: 0, k_pitch: 0, k_roll: 0, k_yaw: 0 };
  }

  return {
    I_pitch,
    I_roll,
    I_yaw,
    k_pitch: Math.sqrt(I_pitch / totalMass),
    k_roll:  Math.sqrt(I_roll  / totalMass),
    k_yaw:   Math.sqrt(I_yaw   / totalMass),
  };
}
