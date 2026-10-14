/** @vitest-environment node */
/**
 * W64: the real FluidCore through FluidBridge (initSync pattern from
 * ffi-integration.test.ts). Needs `npm run build:wasm` first (D4).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FluidBridge } from "../src/fluid-bridge";
import {
  DYNAMIC_FIELDS,
  Dyn,
  El,
  ELEMENT_STRIDE,
  FLAG_PARKED,
  St,
  STATE_STRIDE,
  Stat,
  STATIC_FIELDS,
} from "../src/fluid-layout";
import type { FluidBackend, FluidCoreCtor, FluidCoreLike } from "../src/wasm-loader";

const N = 8000;
const LAYOUT: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [406, 260, 140, 48, 24],
  [570, 260, 140, 48, 24],
  [734, 260, 140, 48, 24],
  [480, 340, 320, 180, 16],
];

let backend: FluidBackend;
const live: FluidCoreLike[] = [];

beforeAll(async () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const bytes = readFileSync(resolve(dir, "../../../../pkg/liquiddom_bg.wasm"));
  const mod = await import("../../../../pkg/liquiddom.js");
  const exports = mod.initSync({ module: bytes });
  backend = {
    memory: exports.memory,
    FluidCore: (mod as unknown as { FluidCore: FluidCoreCtor }).FluidCore,
  };
});

afterEach(() => {
  for (const core of live.splice(0)) core.free();
});

function acceptance(): { core: FluidCoreLike; bridge: FluidBridge } {
  const core = new backend.FluidCore(N, 32, 1280, 800, 76_057, 180, 1);
  live.push(core);
  const bridge = new FluidBridge(backend, core);
  const v = bridge.elementView();
  LAYOUT.forEach(([x, y, w, h, r], id) => v.set([x, y, w, h, r, 0, 0, 0, NaN, NaN], id * ELEMENT_STRIDE));
  return { core, bridge };
}

describe("W64 FluidCore FFI (real wasm)", () => {
  it("given_real_fluid_core_when_bridging_then_strides_equal_ts_layout_constants", () => {
    const { core } = acceptance();
    expect(core.element_stride()).toBe(ELEMENT_STRIDE);
    expect(core.state_stride()).toBe(STATE_STRIDE);
    expect(core.dynamic_fields()).toBe(DYNAMIC_FIELDS);
    expect(core.static_fields()).toBe(STATIC_FIELDS);
    expect(() => new FluidBridge(backend, core)).not.toThrow();
  });

  it("given_view_pointers_when_lengths_computed_then_within_wasm_memory_and_match_capacities", () => {
    const { core, bridge } = acceptance();
    expect(core.particle_capacity()).toBe(N);
    expect(core.element_capacity()).toBe(32);
    const bytes = backend.memory.buffer.byteLength;
    const ranges: Array<[number, number]> = [
      [core.elements_ptr(), 32 * ELEMENT_STRIDE],
      [core.dynamic_ptr(), N * DYNAMIC_FIELDS],
      [core.static_ptr(), N * STATIC_FIELDS],
      [core.state_ptr(), 32 * STATE_STRIDE],
    ];
    for (const [ptr, len] of ranges) {
      expect(ptr).toBeGreaterThan(0);
      expect(ptr % 4).toBe(0);
      expect(ptr + len * 4).toBeLessThanOrEqual(bytes);
    }
    expect(bridge.dynamicView().length).toBe(N * DYNAMIC_FIELDS);
    expect(bridge.dynamicByteRange().byteLength).toBe(N * 7 * 4);
  });

  it("given_elements_written_via_bridge_when_redistribute_then_static_homes_match_and_generation_bumps", () => {
    const { core, bridge } = acceptance();
    expect(core.generation()).toBe(0);
    expect(core.active_particles()).toBe(0);
    core.redistribute();
    expect(bridge.syncGeneration()).toBe(true);
    expect(bridge.generation).toBe(1);
    expect(core.active_particles()).toBe(N);
    const st = bridge.staticView();
    const counts = [0, 0, 0, 0];
    let bad = 0;
    for (let i = 0; i < N; i++) {
      const h = st[Stat.HOME * N + i];
      const u = st[Stat.REST_U * N + i];
      const v = st[Stat.REST_V * N + i];
      if (!(Number.isInteger(h) && h >= 0 && h < 4 && u >= 0 && u <= 1 && v >= 0 && v <= 1)) bad += 1;
      else counts[h] += 1;
    }
    expect(bad).toBe(0);
    const areas = LAYOUT.map(([, , w, h, r]) => w * h - (4 - Math.PI) * r * r);
    const total = areas.reduce((a, b) => a + b, 0);
    counts.forEach((n, id) => expect(Math.abs(n - (N * areas[id]) / total)).toBeLessThan(1.001));
  });

  it("given_tick_when_reading_dynamic_view_then_positions_inside_element_rects", () => {
    const { core, bridge } = acceptance();
    core.redistribute();
    bridge.syncGeneration();
    expect(core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).toBe(1);
    const d = bridge.dynamicView();
    const st = bridge.staticView();
    let outside = 0;
    let notIdentity = 0;
    for (let i = 0; i < N; i++) {
      const [x0, y0, w, h] = LAYOUT[st[Stat.HOME * N + i]];
      const x = d[Dyn.X * N + i];
      const y = d[Dyn.Y * N + i];
      if (x < x0 - 1e-3 || x > x0 + w + 1e-3 || y < y0 - 1e-3 || y > y0 + h + 1e-3) outside += 1;
      const f = [d[Dyn.F00 * N + i], d[Dyn.F01 * N + i], d[Dyn.F10 * N + i], d[Dyn.F11 * N + i], d[Dyn.FLAGS * N + i]];
      if (f.join() !== "1,0,0,1,0") notIdentity += 1;
    }
    expect(outside).toBe(0);
    expect(notIdentity).toBe(0);
    const s = bridge.stateView();
    for (let id = 0; id < 4; id++) expect(s[id * STATE_STRIDE + St.REST_ALPHA]).toBe(1);
  });

  it("given_reduced_motion_when_tick_then_rest_alpha_is_1_for_active_elements", () => {
    const { core, bridge } = acceptance();
    core.redistribute();
    bridge.syncGeneration();
    core.set_reduced_motion(true);
    bridge.elementView()[3 * ELEMENT_STRIDE + El.Y] = 390; // move the card 50 px down
    expect(core.tick(0.001, 0, 0, 0, 0, false, 0, 0)).toBe(0);
    const s = bridge.stateView();
    for (let id = 0; id < 4; id++) expect(s[id * STATE_STRIDE + St.REST_ALPHA]).toBe(1);
    expect(s[4 * STATE_STRIDE + St.REST_ALPHA]).toBe(0);
    const d = bridge.dynamicView();
    const st = bridge.staticView();
    let off = 0;
    for (let i = 0; i < N; i++) {
      if (st[Stat.HOME * N + i] !== 3) continue;
      const y = d[Dyn.Y * N + i];
      if (y < 390 || y > 570) off += 1;
    }
    expect(off).toBe(0);
  });

  // W80 (D80-1): the scalar call through the real WASM export.
  it("given_the_real_core_when_scroll_shift_runs_before_a_zero_step_tick_then_every_homed_particle_moves_by_minus_the_delta_in_the_dynamic_view", () => {
    const { core, bridge } = acceptance();
    core.redistribute();
    bridge.syncGeneration();
    expect(core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).toBe(1);
    const st = bridge.staticView();
    const before = bridge.dynamicView().slice();
    const v = bridge.elementView();
    for (let id = 0; id < 4; id++) v[id * ELEMENT_STRIDE + El.Y] -= 30; // the page scrolled 30 px down
    core.scroll_shift(0, 30, 0, 0);
    expect(core.tick(0.001, 0, 0, 0, 0, false, 0, 0), "a 0-step tick only writes the dynamic view").toBe(0);
    const d = bridge.dynamicView();
    let worst = 0;
    for (let i = 0; i < N; i++) {
      if (!(st[Stat.HOME * N + i] >= 0)) continue;
      worst = Math.max(worst, Math.abs(d[Dyn.X * N + i] - before[Dyn.X * N + i]), Math.abs(d[Dyn.Y * N + i] - (before[Dyn.Y * N + i] - 30)));
    }
    expect(worst, "every homed particle moved by (0, −30) px").toBeLessThan(0.01);
    const s = bridge.stateView();
    for (let id = 0; id < 4; id++) expect(s[id * STATE_STRIDE + St.REST_ALPHA], `element ${id} still at rest`).toBe(1);
  });

  // W81 (D81-1, D81-2): parking and resize_world through the real WASM exports.
  it("given_the_real_core_with_a_card_below_the_world_when_ticked_then_its_particles_carry_flag_parked_and_resize_world_unparks_it_at_rest_with_the_view_pointers_unchanged", () => {
    const { core, bridge } = acceptance();
    bridge.elementView().set([480, 2400, 320, 160, 16, 0, 0, 0, NaN, NaN], 4 * ELEMENT_STRIDE);
    core.redistribute();
    bridge.syncGeneration();
    expect(core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).toBe(1);
    const census = (): { mine: number; flagged: number; others: number } => {
      const st = bridge.staticView();
      const d = bridge.dynamicView();
      let mine = 0;
      let flagged = 0;
      let others = 0;
      for (let i = 0; i < N; i++) {
        const parked = (d[Dyn.FLAGS * N + i] & FLAG_PARKED) !== 0;
        if (st[Stat.HOME * N + i] === 4) {
          mine += 1;
          if (parked) flagged += 1;
        } else if (parked) others += 1;
      }
      return { mine, flagged, others };
    };
    const before = census();
    expect(before.mine, "the far card keeps its share of the budget").toBeGreaterThan(1000);
    expect(before.flagged, "every one of its particles is parked").toBe(before.mine);
    expect(before.others).toBe(0);
    const ptrs = [core.elements_ptr(), core.dynamic_ptr(), core.static_ptr(), core.state_ptr()];
    expect(core.resize_world(1280, 800), "the same world: no reallocation").toBe(false);
    expect(core.resize_world(1280, 2600)).toBe(true);
    expect([core.elements_ptr(), core.dynamic_ptr(), core.static_ptr(), core.state_ptr()], "the views' pointers stay").toEqual(ptrs);
    expect(core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).toBe(1);
    expect(census().flagged, "unparked once the card overlaps the grown world").toBe(0);
    expect(bridge.stateView()[4 * STATE_STRIDE + St.REST_ALPHA], "re-entered at rest").toBe(1);
  });
});
