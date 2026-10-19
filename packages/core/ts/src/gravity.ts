/**
 * W83 (D83-1, D83-3 … D83-5): the gravity the runtime hands to `tick(…, gx, gy)`, in px/s² in CSS
 * axes (x right, y down). Rust high-passes it (`src/fluid/gravity.rs`), so only changes act.
 *
 * - `none`: (0, 0).
 * - `fixed`: `normalize(vector) · strength`; a zero vector (or strength 0) is no gravity (D83-3).
 * - `orientation`: the device's gravity projected onto the screen (`deviceorientation` β, γ) and
 *   rotated by `screen.orientation.angle` (D83-5). The device direction is held until a reading
 *   turns it by more than `ORIENTATION_DEAD_BAND_DEG`, so a phone at rest is bit-quiet. The
 *   listener exists only while the source is `orientation` and goes with `destroy()`.
 *
 * `sample()` also says when the core's low-pass must be seeded first (`seed_gravity`, D83-4):
 * at `create()`, after a source switch, on the first orientation reading and when reduced motion
 * ends. Under reduced motion the gravity is (0, 0).
 */
import type { ResolvedGravity } from "./options";

/** D83-5: a reading moves the held device direction only when it turns it by more than this. */
export const ORIENTATION_DEAD_BAND_DEG = 2;

/** One frame's gravity (px/s²) and whether the core's low-pass is seeded with it first. */
export interface GravitySample {
  readonly gx: number;
  readonly gy: number;
  readonly seed: boolean;
}

/** D83-3: `normalize(vector) · strength`; a zero vector or strength 0 is no gravity. */
export function fixedGravity(vector: readonly [number, number], strength: number): [number, number] {
  void vector;
  void strength; // W83.1 red stub: W83.3 normalises and scales
  return [0, 0];
}

/** D83-5: the unit gravity direction in the device frame for `deviceorientation` β, γ (degrees). */
export function deviceDirection(beta: number, gamma: number): [number, number, number] {
  void beta;
  void gamma; // W83.1 red stub
  return [0, 0, 1];
}

/** D83-5: the screen-plane gravity (CSS axes) of a device direction, rotated by the screen angle (degrees). */
export function screenGravity(dir: readonly [number, number, number], angleDeg: number, strength: number): [number, number] {
  void dir;
  void angleDeg;
  void strength; // W83.1 red stub
  return [0, 0];
}

/** D83-5: `screenGravity(deviceDirection(β, γ), angle, strength)`. */
export function orientationGravity(beta: number, gamma: number, angleDeg: number, strength: number): [number, number] {
  return screenGravity(deviceDirection(beta, gamma), angleDeg, strength);
}

/** `screen.orientation.angle`, else the legacy `window.orientation`, else 0 (non-finite values skipped). */
export function screenAngle(win: Window): number {
  void win; // W83.1 red stub
  return 0;
}

/** The runtime's gravity source: one per instance, on the instance's window. */
export class GravityInput {
  constructor(win: Window, gravity: Readonly<ResolvedGravity>) {
    void win;
    void gravity; // W83.1 red stub: W83.3 holds the source and the orientation listener
  }

  /** A setGravity() change (validated by the facade). A different source seeds the next frame. */
  set(gravity: Readonly<ResolvedGravity>): void {
    void gravity; // W83.1 red stub
  }

  /** This frame's gravity; (0, 0) under reduced motion. */
  sample(reducedMotion: boolean): GravitySample {
    void reducedMotion; // W83.1 red stub
    return { gx: 0, gy: 0, seed: false };
  }

  /** Removes the orientation listener. Idempotent. */
  destroy(): void {}
}
