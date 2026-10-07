/**
 * W71 (D71-5): kernel parameters shared by the Canvas2D density grid and the WebGPU splat pass
 * (spec §3 "Per-element density normalisation"). A particle's splat weight at distance r is
 * `mass · (1 − r²/R²)² / (π·R²/3)` for r < R. The kernel integrates to `mass`, so a filled
 * interior with `mass = areaPerParticle` reads density 1 and the 0.5 threshold lands on the
 * rect edge for every element. Pure: no DOM, no GPU.
 */
export const KERNEL_RADIUS_CAP_PX = 8;
export const KERNEL_RADIUS_PER_SPACING = 2.3;
export const DENSITY_THRESHOLD = 0.5;
/** Half-width of the smoothstep that anti-aliases the silhouette edge (density units). */
export const EDGE_SOFTNESS = 0.1;

/** `min(8, 2.3 · spacing)` in CSS px; a non-finite or non-positive spacing gets the cap. */
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
