/**
 * Shared JS `FluidBackend` for jsdom tests (plan resolution A6): a
 * `FluidCoreLike` over a fake `memory` whose buffer can be replaced (to test
 * view rebinding). It does no physics: every tick and redistribute pins the
 * particles to their targets, like the reduced-motion path. It records every
 * call in `calls`. Adapter tests import it by relative path:
 *   packages/react/__tests__/… → "../../core/ts/__tests__/_fluid-test-backend"
 *   packages/vue/__tests__/…   → "../../core/ts/__tests__/_fluid-test-backend"
 */
import {
  DYNAMIC_FIELDS,
  Dyn,
  El,
  ELEMENT_STRIDE,
  HOME_NONE,
  homeRect,
  roundedRectArea,
  St,
  STATE_STRIDE,
  Stat,
  STATIC_FIELDS,
} from "../src/fluid-layout";
import type { FluidBackend, FluidCoreLike } from "../src/wasm-loader";

export interface TestBackendOptions {
  /** Override what the fake core reports, to test the stride check. */
  strides?: { element?: number; state?: number; dynamic?: number; static?: number };
  /** Override `max_area_px2()` (default `particles · cell² / 2`). */
  maxAreaPx2?: number;
  /** Called with every recorded call name, e.g. "tick" or "set_reduced_motion:true". */
  onCall?: (name: string) => void;
}

export interface TestFluidCore extends FluidCoreLike {
  readonly ctorArgs: readonly number[];
  readonly freed: boolean;
  readonly reducedMotion: boolean;
}

export interface TestBackend extends FluidBackend {
  readonly memory: { buffer: ArrayBuffer };
  readonly calls: string[];
  readonly cores: TestFluidCore[];
  /** Replaces `memory.buffer` with a larger copy (detaching the old one where supported). */
  grow(extraBytes: number): void;
}

const FIXED_DT_S = 1 / 60;

function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const exact = weights.map((w) => (w > 0 ? (total * w) / sum : 0));
  const out = exact.map((e) => Math.floor(e));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ rem: e - out[i], i }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) {
    out[order[k].i] += 1;
  }
  return out;
}

export function createTestBackend(opts: TestBackendOptions = {}): TestBackend {
  const calls: string[] = [];
  const cores: TestFluidCore[] = [];
  const memory = { buffer: new ArrayBuffer(1 << 16) };
  let top = 8; // 0 stays the null pointer
  const record = (name: string): void => {
    calls.push(name);
    opts.onCall?.(name);
  };
  const replaceBuffer = (bytes: number): void => {
    const old = memory.buffer as ArrayBuffer & { transfer?: (n: number) => ArrayBuffer };
    if (typeof old.transfer === "function") {
      memory.buffer = old.transfer(bytes);
      return;
    }
    const next = new ArrayBuffer(bytes);
    new Uint8Array(next).set(new Uint8Array(old));
    memory.buffer = next;
  };
  const alloc = (bytes: number): number => {
    const ptr = top;
    top = Math.ceil((top + bytes) / 8) * 8;
    if (top > memory.buffer.byteLength) replaceBuffer(Math.max(top, memory.buffer.byteLength * 2));
    return ptr;
  };
  const f32 = (ptr: number, len: number): Float32Array => new Float32Array(memory.buffer, ptr, len);

  class TestCore implements TestFluidCore {
    readonly ctorArgs: readonly number[];
    freed = false;
    reducedMotion = false;
    private readonly n: number;
    private readonly m: number;
    private readonly cell: number;
    private readonly elPtr: number;
    private readonly dynPtr: number;
    private readonly statPtr: number;
    private readonly statePtr: number;
    private gen = 0;
    private active = 0;
    private acc = 0;

    constructor(
      particles: number,
      maxElements: number,
      worldWPx: number,
      worldHPx: number,
      areaHintPx2: number,
      maxElementHPx: number,
      seed: number,
    ) {
      this.ctorArgs = [particles, maxElements, worldWPx, worldHPx, areaHintPx2, maxElementHPx, seed];
      this.n = particles;
      this.m = maxElements;
      this.cell =
        Number.isFinite(areaHintPx2) && areaHintPx2 > 0
          ? Math.min(8, Math.max(4, Math.sqrt((4 * areaHintPx2) / particles)))
          : 8;
      this.elPtr = alloc(maxElements * ELEMENT_STRIDE * 4);
      this.dynPtr = alloc(particles * DYNAMIC_FIELDS * 4);
      this.statPtr = alloc(particles * STATIC_FIELDS * 4);
      this.statePtr = alloc(maxElements * STATE_STRIDE * 4);
      f32(this.statPtr, particles).fill(HOME_NONE); // Stat.HOME is the first field
      const d = f32(this.dynPtr, particles * DYNAMIC_FIELDS);
      d.fill(1, Dyn.F00 * particles, (Dyn.F00 + 1) * particles);
      d.fill(1, Dyn.F11 * particles, (Dyn.F11 + 1) * particles);
      const s = f32(this.statePtr, maxElements * STATE_STRIDE);
      for (let id = 0; id < maxElements; id++) s[id * STATE_STRIDE + St.S] = 1;
      record(`new:${particles}:${maxElements}`);
      cores.push(this);
    }

    elements_ptr(): number {
      return this.elPtr;
    }
    dynamic_ptr(): number {
      return this.dynPtr;
    }
    static_ptr(): number {
      return this.statPtr;
    }
    state_ptr(): number {
      return this.statePtr;
    }
    particle_capacity(): number {
      return this.n;
    }
    element_capacity(): number {
      return this.m;
    }
    active_particles(): number {
      return this.active;
    }
    cell_px(): number {
      return this.cell;
    }
    max_area_px2(): number {
      return opts.maxAreaPx2 ?? (this.n * this.cell * this.cell) / 2;
    }
    element_stride(): number {
      return opts.strides?.element ?? ELEMENT_STRIDE;
    }
    state_stride(): number {
      return opts.strides?.state ?? STATE_STRIDE;
    }
    dynamic_fields(): number {
      return opts.strides?.dynamic ?? DYNAMIC_FIELDS;
    }
    static_fields(): number {
      return opts.strides?.static ?? STATIC_FIELDS;
    }
    generation(): number {
      return this.gen;
    }

    tick(rawDtS: number): number {
      record("tick");
      if (Number.isFinite(rawDtS) && rawDtS > 0) this.acc += Math.min(rawDtS, 0.1);
      let steps = 0;
      while (this.acc + 1e-6 >= FIXED_DT_S) {
        if (steps === 3) {
          this.acc = 0;
          break;
        }
        this.acc -= FIXED_DT_S;
        steps += 1;
      }
      if (this.acc < 0) this.acc = 0;
      this.pin();
      return this.reducedMotion ? 0 : steps;
    }

    splash(id: number): void {
      record(`splash:${id}`);
    }
    shake(): void {
      record("shake");
    }
    set_material(viscosity: number, cohesion: number, recovery: number): void {
      record(`set_material:${viscosity}:${cohesion}:${recovery}`);
    }
    set_reduced_motion(on: boolean): void {
      this.reducedMotion = on;
      record(`set_reduced_motion:${on}`);
    }
    free(): void {
      this.freed = true;
      record("free");
    }

    redistribute(): void {
      record("redistribute");
      const el = f32(this.elPtr, this.m * ELEMENT_STRIDE);
      const weights: number[] = [];
      for (let id = 0; id < this.m; id++) {
        const o = id * ELEMENT_STRIDE;
        weights.push(
          homeRect(el, id, false) ? roundedRectArea(el[o + El.W], el[o + El.H], el[o + El.RADIUS]) : 0,
        );
      }
      const counts = apportion(weights, this.n);
      const st = f32(this.statPtr, this.n * STATIC_FIELDS);
      let i = 0;
      for (let id = 0; id < this.m; id++) {
        const c = counts[id];
        const o = id * ELEMENT_STRIDE;
        const cols = Math.max(1, Math.ceil(Math.sqrt((c * el[o + El.W]) / Math.max(el[o + El.H], 1e-6))));
        const rows = Math.max(1, Math.ceil(c / cols));
        for (let k = 0; k < c; k++, i++) {
          st[Stat.HOME * this.n + i] = id;
          st[Stat.REST_U * this.n + i] = ((k % cols) + 0.5) / cols;
          st[Stat.REST_V * this.n + i] = (Math.floor(k / cols) + 0.5) / rows;
        }
      }
      for (; i < this.n; i++) st[Stat.HOME * this.n + i] = HOME_NONE;
      this.active = counts.reduce((a, b) => a + b, 0);
      this.gen += 1;
      this.pin();
    }

    private pin(): void {
      const el = f32(this.elPtr, this.m * ELEMENT_STRIDE);
      const st = f32(this.statPtr, this.n * STATIC_FIELDS);
      const d = f32(this.dynPtr, this.n * DYNAMIC_FIELDS);
      const s = f32(this.statePtr, this.m * STATE_STRIDE);
      for (let i = 0; i < this.n; i++) {
        const home = st[Stat.HOME * this.n + i];
        if (!(home >= 0)) continue;
        const r = homeRect(el, home, this.reducedMotion);
        if (!r) continue;
        d[Dyn.X * this.n + i] = r.x + st[Stat.REST_U * this.n + i] * r.w;
        d[Dyn.Y * this.n + i] = r.y + st[Stat.REST_V * this.n + i] * r.h;
      }
      for (let id = 0; id < this.m; id++) {
        const o = id * STATE_STRIDE;
        s[o + St.S] = 1;
        s[o + St.MAX_DEV] = 0;
        s[o + St.REST_ALPHA] = homeRect(el, id, false) ? 1 : 0;
        s[o + St.RESERVED] = 0;
      }
    }
  }

  return {
    memory,
    FluidCore: TestCore,
    calls,
    cores,
    grow: (extraBytes) => replaceBuffer(memory.buffer.byteLength + extraBytes),
  };
}
