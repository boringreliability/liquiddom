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

  // W82 (D82-5): set_viewport through the real WASM export; shake mirrors only near an edge.
  it("given_the_real_core_with_a_pill_40_px_from_the_right_edge_when_shaken_after_set_viewport_then_an_outward_shake_turns_inward_and_the_acceptance_elements_stay_bit_identical", () => {
    const PILL = 4;
    /** The acceptance layout plus a pill 40 px from the right edge, one shake and one frame. */
    const run = (seed: number, viewport: boolean): { d: Float32Array; st: Float32Array } => {
      const core = new backend.FluidCore(N, 32, 1280, 800, 76_057, 180, seed);
      live.push(core);
      const bridge = new FluidBridge(backend, core);
      const v = bridge.elementView();
      LAYOUT.forEach(([x, y, w, h, r], id) => v.set([x, y, w, h, r, 0, 0, 0, NaN, NaN], id * ELEMENT_STRIDE));
      v.set([1100, 600, 140, 48, 24, 0, 0, 0, NaN, NaN], PILL * ELEMENT_STRIDE);
      core.redistribute();
      bridge.syncGeneration();
      core.set_viewport(Number.NaN, -1); // sanitised to "unknown": no mirror, no throw
      if (viewport) core.set_viewport(1280, 800);
      core.shake(1);
      expect(core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).toBe(1);
      return { d: bridge.dynamicView().slice(), st: bridge.staticView().slice() };
    };
    const meanX = ({ d, st }: { d: Float32Array; st: Float32Array }): number => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (st[Stat.HOME * N + i] !== PILL) continue;
        sum += d[Dyn.X * N + i];
        n += 1;
      }
      return sum / Math.max(1, n);
    };
    let mirroredSeeds = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const plain = run(seed, false);
      const mirrored = run(seed, true);
      let others = 0;
      for (let i = 0; i < N; i++) {
        const h = plain.st[Stat.HOME * N + i];
        if (h === PILL || !(h >= 0)) continue;
        if (mirrored.d[Dyn.X * N + i] !== plain.d[Dyn.X * N + i] || mirrored.d[Dyn.Y * N + i] !== plain.d[Dyn.Y * N + i]) others += 1;
      }
      expect(others, `seed ${seed}: elements farther than 80 px from every edge are bit-identical`).toBe(0);
      const [p, m] = [meanX(plain), meanX(mirrored)];
      if (p !== m) {
        mirroredSeeds += 1;
        expect(m, `seed ${seed}: the outward shake turned inward`).toBeLessThan(p);
      }
    }
    expect(mirroredSeeds, "some of the 8 seeds shake the pill outward (right)").toBeGreaterThan(0);
  });

  // W83 (D83-1, D83-4): seed_gravity and tick's gx, gy through the real WASM export.
  it("given_the_real_core_when_a_constant_gravity_is_seeded_then_it_is_bit_identical_to_none_and_a_90_degree_tilt_moves_the_liquid_to_the_right", () => {
    const run = (seed: readonly [number, number] | null, g: (frame: number) => readonly [number, number]): Float32Array => {
      const { core, bridge } = acceptance();
      core.redistribute();
      bridge.syncGeneration();
      if (seed) core.seed_gravity(seed[0], seed[1]);
      for (let f = 0; f < 30; f++) {
        const [gx, gy] = g(f);
        expect(core.tick(1 / 60, 0, 0, 0, 0, false, gx, gy)).toBe(1);
      }
      return bridge.dynamicView().slice();
    };
    const meanX = (d: Float32Array): number => {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += d[Dyn.X * N + i];
      return sum / N;
    };
    const none = run(null, () => [0, 0]);
    const constant = run([0, 980], () => [0, 980]);
    let differ = 0;
    for (let i = 0; i < none.length; i++) if (!Object.is(none[i], constant[i])) differ += 1;
    expect(differ, "a constant gravity seeded at create moves nothing").toBe(0);
    const tilted = run([0, 980], (f) => (f < 5 ? [0, 980] : [980, 0]));
    expect(meanX(tilted) - meanX(none), "a 90° tilt to the right leans the liquid right").toBeGreaterThan(0.5);
  });

  // W85 (D85-4): set_area_hint through the real WASM export.
  it("given_the_real_core_built_without_a_hint_when_set_area_hint_runs_before_any_redistribute_then_the_cell_and_the_budget_equal_a_hinted_core_and_after_a_redistribute_it_returns_false", () => {
    const hinted = new backend.FluidCore(N, 32, 1280, 800, 76_057, 180, 1);
    const core = new backend.FluidCore(N, 32, 1280, 800, 0, 0, 1);
    live.push(hinted, core);
    expect(core.cell_px()).toBe(8);
    expect(core.set_area_hint(76_057, 180)).toBe(true);
    expect(core.cell_px()).toBe(hinted.cell_px());
    expect(core.max_area_px2()).toBe(hinted.max_area_px2());
    core.redistribute();
    expect(core.set_area_hint(1, 0)).toBe(false);
    expect(core.cell_px()).toBe(hinted.cell_px());
  });
});
