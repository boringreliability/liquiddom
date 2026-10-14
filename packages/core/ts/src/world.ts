/**
 * W81 (D81-2, D81-3): the world the fluid grid covers, in CSS px of buffer space. The core gets
 * it once in its constructor (frozen 7 args, D64-4) and grows it with `resize_world` (D81-2). Rust
 * clamps every extent to [WORLD_MIN_PX, WORLD_MAX_PX] (`src/fluid/grid.rs`); `clampWorld` mirrors
 * that, so the runtime's copy equals the core's world.
 * - Body mode (B2): `max(screen, inner)` per axis.
 * - Container mode (D81-3): the container's client box, its visible window, which is buffer space
 *   since W80 (the canvas is translated onto it). The scroll range is no longer part of the world,
 *   so content scrolled far away parks (D81-1) instead of being simulated.
 */
export const WORLD_MIN_PX = 64;
export const WORLD_MAX_PX = 8192;
/** Rust's fallback for a non-finite or non-positive extent (`DEFAULT_WORLD_W_PX`, `DEFAULT_WORLD_H_PX`). */
const DEFAULT_WORLD: WorldSize = { w: 1280, h: 800 };
/**
 * D81-2: an axis that outgrew the world grows to at least this many times its current extent, so a
 * window dragged wider reallocates a few times, not on every resize event.
 */
export const WORLD_GROWTH = 1.25;
/** D81-2: the one console.info per reallocation; the new world follows as "W×H px.". */
export const WORLD_RESIZE_INFO = "[liquiddom] the viewport outgrew the liquid's world; the grid grew to";

export interface WorldSize {
  readonly w: number;
  readonly h: number;
}

/** B2 / D81-3: body mode `max(screen, inner)` per axis; container mode the container's client box. At least 1 px. */
export function measureWorld(container?: HTMLElement): WorldSize {
  if (container) {
    return { w: Math.max(container.clientWidth, 1), h: Math.max(container.clientHeight, 1) };
  }
  const sw = typeof screen !== "undefined" ? screen.width || 0 : 0;
  const sh = typeof screen !== "undefined" ? screen.height || 0 : 0;
  return { w: Math.max(sw, window.innerWidth || 0, 1), h: Math.max(sh, window.innerHeight || 0, 1) };
}

/** Rust's `world_extent` per axis: a positive finite extent clamped to [64, 8192], else 1280 × 800. */
export function clampWorld(s: WorldSize): WorldSize {
  const c = (v: number, fallback: number): number =>
    Number.isFinite(v) && v > 0 ? Math.min(WORLD_MAX_PX, Math.max(WORLD_MIN_PX, v)) : fallback;
  return { w: c(s.w, DEFAULT_WORLD.w), h: c(s.h, DEFAULT_WORLD.h) };
}

/**
 * D81-2: the world to grow to when `need` (clamped like Rust) outgrows `current` on an axis, else
 * null. Each outgrown axis grows to max(need, ⌈current × WORLD_GROWTH⌉), capped at WORLD_MAX_PX;
 * the other axis stays. Never shrinks.
 */
export function grownWorld(current: WorldSize, need: WorldSize): WorldSize | null {
  const n = clampWorld(need);
  const grow = (now: number, want: number): number =>
    want > now ? Math.min(WORLD_MAX_PX, Math.max(want, Math.ceil(now * WORLD_GROWTH))) : now;
  const next = { w: grow(current.w, n.w), h: grow(current.h, n.h) };
  return next.w === current.w && next.h === current.h ? null : next;
}
