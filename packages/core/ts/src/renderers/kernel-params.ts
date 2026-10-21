/**
 * W71 (D71-5): kernel parameters shared by the Canvas2D density grid and the WebGPU splat pass
 * (spec §3 "Per-element density normalisation"). A particle's splat weight at distance r is
 * `mass · (1 − r²/R²)² / (π·R²/3)` for r < R. The kernel integrates to `mass`, so a filled
 * interior with `mass = areaPerParticle` reads density 1 and the 0.5 threshold lands on the
 * rect edge for every element. Pure: no DOM, no GPU.
 *
 * W77 (D77-1, amends D71-5's cap of 8 px): the radius stays 2.3 × the particle spacing up to 16 px,
 * so on a page with a large observed area (spacing 5.4–5.7 px on the landing page) the kernel
 * reaches 12.5–13 px instead of 8 px (1.45 × spacing), and a nudged neighbour's rest layout no
 * longer shows holes. The acceptance scene (R 7.09 px) does not change.
 */
export const KERNEL_RADIUS_CAP_PX = 16;
export const KERNEL_RADIUS_PER_SPACING = 2.3;
export const DENSITY_THRESHOLD = 0.5;
/** Half-width of the smoothstep that anti-aliases the silhouette edge (density units). */
export const EDGE_SOFTNESS = 0.1;

/** `min(16, 2.3 · spacing)` in CSS px; a non-finite or non-positive spacing gets the cap. */
export function kernelRadiusPx(spacingPx: number): number {
  if (!(Number.isFinite(spacingPx) && spacingPx > 0)) return KERNEL_RADIUS_CAP_PX;
  return Math.min(KERNEL_RADIUS_CAP_PX, KERNEL_RADIUS_PER_SPACING * spacingPx);
}

/** Splat weight at distance `r` (CSS px); 0 for r ≥ R, a bad radius, a non-finite r or a non-positive mass. */
export function kernelWeight(r: number, radiusPx: number, mass: number): number {
  if (!(Number.isFinite(radiusPx) && radiusPx > 0) || !(Number.isFinite(mass) && mass > 0) || !Number.isFinite(r)) return 0;
  const r2 = radiusPx * radiusPx;
  const q = 1 - (r * r) / r2;
  if (!(q > 0)) return 0;
  return (mass * q * q) / ((Math.PI * r2) / 3);
}
