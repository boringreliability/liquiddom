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
const DEG = Math.PI / 180;
const COS_DEAD_BAND = Math.cos(ORIENTATION_DEAD_BAND_DEG * DEG);

/** One frame's gravity (px/s²) and whether the core's low-pass is seeded with it first. */
export interface GravitySample {
  readonly gx: number;
  readonly gy: number;
  readonly seed: boolean;
}

/** D83-3: `normalize(vector) · strength`; a zero vector or strength 0 is no gravity. */
export function fixedGravity(vector: readonly [number, number], strength: number): [number, number] {
  const len = Math.hypot(vector[0], vector[1]);
  if (!(len > 0) || !Number.isFinite(len) || !(strength > 0)) return [0, 0];
  // `+ 0` turns a -0 into 0, so a sign never leaks into the FFI or the tests.
  return [(vector[0] / len) * strength + 0, (vector[1] / len) * strength + 0];
}

/**
 * D83-5: the unit gravity direction in the device frame for `deviceorientation` β, γ (degrees,
 * W3C Z-X'-Y''): `(cos β · sin γ, sin β, cos β · cos γ)`. Its first two components are the
 * natural-orientation screen axes (x right, y down); a flat phone gives (0, 0, 1).
 */
export function deviceDirection(beta: number, gamma: number): [number, number, number] {
  const b = beta * DEG;
  const g = gamma * DEG;
  return [Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/**
 * D83-5: the screen-plane gravity (CSS axes) of a device direction, rotated by the screen angle θ
 * (degrees): `gx = s · (px · cos θ + py · sin θ)`, `gy = s · (−px · sin θ + py · cos θ)`. The
 * projection (not a normalised direction) gives a flat phone no gravity and damps the γ jitter
 * near β = ±90°.
 */
export function screenGravity(dir: readonly [number, number, number], angleDeg: number, strength: number): [number, number] {
  const t = angleDeg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const [px, py] = dir;
  return [strength * (px * c + py * s) + 0, strength * (-px * s + py * c) + 0];
}

/** D83-5: `screenGravity(deviceDirection(β, γ), angle, strength)`. */
export function orientationGravity(beta: number, gamma: number, angleDeg: number, strength: number): [number, number] {
  return screenGravity(deviceDirection(beta, gamma), angleDeg, strength);
}

/** `screen.orientation.angle`, else the legacy `window.orientation`, else 0 (non-finite values skipped). */
export function screenAngle(win: Window): number {
  const angle: unknown = (win as { screen?: { orientation?: { angle?: unknown } } }).screen?.orientation?.angle;
  if (typeof angle === "number" && Number.isFinite(angle)) return angle;
  const legacy: unknown = (win as { orientation?: unknown }).orientation;
  if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  return 0;
}

/** The runtime's gravity source: one per instance, on the instance's window. */
export class GravityInput {
  private gravity: ResolvedGravity;
  private fixed: [number, number];
  /** D83-5: the held device direction (null until the first reading of an orientation source). */
  private held: [number, number, number] | null = null;
  private listening = false;
  /** D83-4: create() seeds; so do a source switch and the first orientation reading. */
  private seedPending = true;
  /** The last sample ran under reduced motion: the first one with motion seeds. */
  private wasReduced = false;

  private readonly onOrientation = (e: Event): void => {
    const { beta, gamma } = e as DeviceOrientationEvent;
    if (typeof beta !== "number" || typeof gamma !== "number" || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    const d = deviceDirection(beta, gamma);
    if (this.held === null) {
      this.held = d;
      this.seedPending = true;
      return;
    }
    const [hx, hy, hz] = this.held;
    if (hx * d[0] + hy * d[1] + hz * d[2] < COS_DEAD_BAND) this.held = d;
  };

  constructor(
    private readonly win: Window,
    gravity: Readonly<ResolvedGravity>,
  ) {
    this.gravity = { source: gravity.source, vector: [gravity.vector[0], gravity.vector[1]], strength: gravity.strength };
    this.fixed = fixedGravity(this.gravity.vector, this.gravity.strength);
    this.listen(this.gravity.source === "orientation");
  }

  /** A setGravity() change (validated by the facade). A different source seeds the next frame. */
  set(gravity: Readonly<ResolvedGravity>): void {
    if (gravity.source !== this.gravity.source) {
      this.seedPending = true;
      this.held = null;
    }
    this.gravity = { source: gravity.source, vector: [gravity.vector[0], gravity.vector[1]], strength: gravity.strength };
    this.fixed = fixedGravity(this.gravity.vector, this.gravity.strength);
    this.listen(this.gravity.source === "orientation");
  }

  /** This frame's gravity; (0, 0) under reduced motion. */
  sample(reducedMotion: boolean): GravitySample {
    if (reducedMotion) {
      this.wasReduced = true;
      return { gx: 0, gy: 0, seed: false };
    }
    const [gx, gy] = this.current();
    const seed = this.seedPending || this.wasReduced;
    this.seedPending = false;
    this.wasReduced = false;
    return { gx, gy, seed };
  }

  /** Removes the orientation listener. Idempotent. */
  destroy(): void {
    this.listen(false);
  }

  private current(): [number, number] {
    if (this.gravity.source === "fixed") return this.fixed;
    if (this.gravity.source === "orientation" && this.held !== null) {
      return screenGravity(this.held, screenAngle(this.win), this.gravity.strength);
    }
    return [0, 0];
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) this.win.addEventListener("deviceorientation", this.onOrientation);
    else this.win.removeEventListener("deviceorientation", this.onOrientation);
  }
}
