/**
 * @vitest-environment jsdom
 * W74 (D74-5, D74-6, Review Focus 1): the runtime builds the atlas under WebGPU, sets liquid-text
 * after render() only while the renderer draws that element's text, and removes it on every
 * fail-safe path — rest, Canvas2D, a lost device, reduced motion switched on, unobserve, destroy,
 * an atlas failure, a failed frame, an element without text.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createFluidRuntime, TEXT_ATLAS_WARNING, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { TEXT_CLASS } from "../src/stylesheet";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { installFakeGpu, type FakeGpu } from "./_fake-gpu";
import { fakeAtlasCanvas, installRangeRects, oneLinePerNode, type FakeAtlasFactory } from "./_fake-atlas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend } from "./_facade-helpers";
import type { TestFluidCore } from "./_fluid-test-backend";

let fake2d: FakeCanvasHandle;
let gpu: FakeGpu;
let restoreRects: () => void;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
const live: FluidRuntime[] = [];

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D(); // first, so the gpu fake wraps it
  setupFacadeTestEnv();
  gpu = installFakeGpu();
  restoreRects = installRangeRects(
    oneLinePerNode((node) => {
      const r = (node.parentElement as HTMLElement).getBoundingClientRect();
      return { left: r.left + 20, top: r.top + 12 };
    }),
  );
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  restoreRects();
  gpu.restore();
  fake2d.restore();
  vi.restoreAllMocks();
});

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const microtask = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

interface Setup {
  rt: FluidRuntime;
  core: TestFluidCore;
  clock: ManualClock;
  atlas: FakeAtlasFactory;
}

async function setup(o: { renderer?: "webgpu" | "canvas2d"; atlas?: FakeAtlasFactory } = {}): Promise<Setup> {
  const sb = spyBackend();
  const clock = createManualClock();
  const atlas = o.atlas ?? fakeAtlasCanvas();
  const rt = await createFluidRuntime({
    particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: o.renderer ?? "webgpu", textAtlasCanvas: atlas.create,
  });
  live.push(rt);
  return { rt, core: sb.cores[0] as unknown as TestFluidCore, clock, atlas };
}

function button(text = "Splash", x = 100): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = text;
  Object.assign(b.style, { fontStyle: "normal", fontWeight: "600", fontSize: "16px", fontFamily: "Arial", color: "rgb(255, 255, 255)" });
  mockRect(b, x, 200, 140, 48);
  document.body.appendChild(b);
  return b;
}

/** Observes, lets the batched redistribute run and draws one frame (everything at rest). */
async function observed(s: Setup, el: HTMLElement): Promise<number> {
  const id = s.rt.observe(el);
  await microtask();
  s.clock.advance(1);
  await flush(); // W74 review: the atlas upload is ready once its error scope resolves
  return id;
}

const textPasses = (): number => gpu.calls.passes.filter((p) => p.attachments.some((a) => a.view.texture.label === "liquiddom T1")).length;

type Listener = (e: { matches: boolean }) => void;

/** Reduced-motion media query stub (reduced-motion-input.test.ts pattern). */
function stubReducedMotionMedia(initial: boolean): { fire(matches: boolean): void; restore(): void } {
  const listeners = new Set<Listener>();
  const rm = {
    matches: initial,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  const other = { ...rm, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((q: string) => (q.includes("prefers-reduced-motion") ? rm : { ...other, media: q })),
  });
  return {
    fire(matches: boolean) {
      rm.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
    restore() {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original });
    },
  };
}

describe("W74 runtime: atlas and liquid-text (D74-5, D74-6)", () => {
  it("given_webgpu_and_a_moving_element_with_text_when_a_frame_runs_then_the_atlas_is_built_the_text_pass_runs_and_liquid_text_is_set", async () => {
    const s = await setup();
    const el = button();
    const id = await observed(s, el);
    expect(s.atlas.canvases).toHaveLength(1);
    expect(s.atlas.fills().map((f) => f.text)).toEqual(["Splash"]);
    expect(gpu.calls.externalCopies).toHaveLength(1);
    expect(el.classList.contains(TEXT_CLASS), "at rest the DOM text shows").toBe(false);
    expect(textPasses()).toBe(0);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    expect(textPasses()).toBe(1);
    expect(gpu.calls.externalCopies, "one upload per atlas version").toHaveLength(1);
    expect(gpu.calls.errors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("given_the_element_comes_to_rest_when_a_frame_runs_then_liquid_text_is_removed_in_the_frame_the_text_pass_stops", async () => {
    const s = await setup();
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    const drawn = textPasses();
    s.core.forceRestAlpha(id, null);
    s.clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    expect(textPasses(), "the frame that removes the class draws no atlas text").toBe(drawn);
  });

  it("given_canvas2d_when_elements_move_then_liquid_text_is_never_set_and_no_atlas_is_built", async () => {
    const s = await setup({ renderer: "canvas2d" });
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(3);
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    expect(s.atlas.canvases).toHaveLength(0);
    expect(gpu.calls.requestAdapter).toBe(0);
  });

  it("given_liquid_text_on_when_the_device_is_lost_then_every_class_is_removed_before_the_canvas2d_rebuild_settles_review_focus_1", async () => {
    const s = await setup();
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    // Hold the Canvas2D init pending (device-lost.test.ts pattern), so the assertion below runs
    // while the rebuild is provably still in flight.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const realInit = FluidCanvas2DRenderer.prototype.init;
    const init2d = vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockImplementation(async function (this: FluidCanvas2DRenderer, c: HTMLCanvasElement) {
      await gate;
      return realInit.call(this, c);
    });
    const render2d = vi.spyOn(FluidCanvas2DRenderer.prototype, "render");
    gpu.loseDevice("gpu reset");
    await vi.waitFor(() => expect(init2d).toHaveBeenCalledTimes(1));
    await flush();
    expect(s.rt.activeRenderer).toBe("canvas2d");
    expect(render2d, "precondition: the Canvas2D init is still pending").not.toHaveBeenCalled();
    expect(el.classList.contains(TEXT_CLASS), "cleared in the loss handler, while the Canvas2D init is unresolved").toBe(false);
    s.clock.advance(1); // a frame while the rebuild is in flight (no renderer)
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    release();
    await flush();
    s.clock.advance(2);
    expect(render2d, "the rebuild completed: Canvas2D draws").toHaveBeenCalled();
    expect(el.classList.contains(TEXT_CLASS), "Canvas2D never sets it").toBe(false);
    expect(warn).toHaveBeenCalledTimes(1); // the W72 device-lost warning only
    expect(error).not.toHaveBeenCalled();
  });

  it("given_liquid_text_on_when_the_canvas2d_rebuild_fails_then_the_class_is_removed_review_focus_1", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const s = await setup();
      const el = button();
      const id = await observed(s, el);
      s.core.forceRestAlpha(id, 0.4);
      s.clock.advance(1);
      expect(el.classList.contains(TEXT_CLASS)).toBe(true);
      vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockRejectedValue(new Error("2d gone"));
      gpu.loseDevice("gpu reset");
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      expect(String(error.mock.calls[0]![0])).toMatch(/Canvas2D rebuild after a lost WebGPU device failed/);
      await flush();
      expect(el.classList.contains(TEXT_CLASS), "the failed rebuild leaves no liquid-text").toBe(false);
      s.clock.advance(2); // the instance stopped: no frame brings it back
      expect(el.classList.contains(TEXT_CLASS)).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("given_liquid_text_on_when_reduced_motion_switches_on_then_the_class_is_removed_without_a_frame_review_focus_1", async () => {
    const media = stubReducedMotionMedia(false);
    try {
      const s = await setup();
      const el = button();
      const id = await observed(s, el);
      s.core.forceRestAlpha(id, 0.4);
      s.clock.advance(1);
      expect(el.classList.contains(TEXT_CLASS)).toBe(true);
      media.fire(true);
      expect(el.classList.contains(TEXT_CLASS), "removed at once, no frame needed").toBe(false);
      s.clock.advance(1);
      expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    } finally {
      media.restore();
    }
  });

  it("given_liquid_text_on_when_unobserve_or_destroy_then_the_class_is_removed_and_the_class_attribute_restored_review_focus_1", async () => {
    const s = await setup();
    const a = button("Splash", 100);
    const b = button("Split", 300);
    const ia = s.rt.observe(a);
    const ib = s.rt.observe(b);
    await microtask();
    s.clock.advance(1);
    await flush(); // W74 review: atlas upload confirmed
    s.core.forceRestAlpha(ia, 0.4);
    s.core.forceRestAlpha(ib, 0.4);
    s.clock.advance(1);
    expect([a, b].map((e) => e.classList.contains(TEXT_CLASS))).toEqual([true, true]);
    s.rt.unobserve(a);
    expect(a.getAttribute("class")).toBe("btn");
    s.rt.destroy();
    expect(b.getAttribute("class")).toBe("btn");
  });

  it("given_an_atlas_build_that_throws_when_frames_run_then_one_console_warn_no_class_and_the_liquid_keeps_rendering_review_focus_1", async () => {
    const s = await setup({ atlas: fakeAtlasCanvas({ throws: new Error("no fonts") }) });
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    const submits = gpu.calls.submits;
    s.clock.advance(3);
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    expect(gpu.calls.submits, "the liquid keeps rendering").toBe(submits + 3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe(TEXT_ATLAS_WARNING);
    s.rt.refresh(el); // the next rebuild fails again: still one warning per instance
    s.clock.advance(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("given_liquid_text_on_when_a_frame_throws_then_the_class_is_removed_review_focus_1", async () => {
    const s = await setup();
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    vi.spyOn(s.core, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    s.clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
  });

  it("given_an_element_without_text_when_it_moves_then_it_never_gets_liquid_text_review_focus_1", async () => {
    const s = await setup();
    const icon = document.createElement("div");
    icon.appendChild(document.createElement("span"));
    mockRect(icon, 100, 200, 48, 48);
    document.body.appendChild(icon);
    const id = await observed(s, icon);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(2);
    expect(icon.classList.contains(TEXT_CLASS)).toBe(false);
    expect(s.atlas.canvases).toHaveLength(0);
    expect(textPasses()).toBe(0);
  });
});

// W74 review (carry-over 2): the atlas follows the redistribution bump and the device limit.
describe("W74 review: atlas build timing and size cap", () => {
  const textInfoWrites = () => gpu.calls.writes.filter((w) => w.buffer.label === "liquiddom text info");

  it("given_a_second_element_observed_when_the_redistribution_bumps_the_generation_then_the_atlas_is_rebuilt_in_that_frame_and_the_text_records_match_its_rects", async () => {
    const s = await setup();
    const a = button("Splash", 100);
    const idA = await observed(s, a);
    expect(s.atlas.canvases).toHaveLength(1);
    const b = button("Split", 300);
    const idB = s.rt.observe(b);
    await microtask(); // the batched redistribute bumps the generation
    const writesBefore = textInfoWrites().length;
    s.clock.advance(1); // the one frame that sees the bump
    expect(s.atlas.canvases, "rebuilt with the paints, in the bump frame").toHaveLength(2);
    expect(s.atlas.fills().map((f) => f.text)).toEqual(["Splash", "Split"]);
    expect(gpu.calls.externalCopies, "the new page is uploaded in the same frame").toHaveLength(2);
    const writes = textInfoWrites();
    expect(writes.length).toBeGreaterThan(writesBefore);
    const info = writes.at(-1)!.values;
    // rest size = atlas rect / dpr = the element's border box (140 × 48 CSS px), valid = 1, for both slots
    for (const id of [idA, idB]) {
      expect(info.slice(id * 8 + 4, id * 8 + 7)).toEqual([140, 48, 1]);
    }
    expect(gpu.calls.errors).toEqual([]);
  });

  // W74 ward-review (I1): a rebuild while an element moves never blinks its text.
  it("given_liquid_text_on_when_the_atlas_is_rebuilt_mid_motion_then_the_class_stays_on_and_the_text_pass_runs_every_frame_until_and_after_the_new_page_is_confirmed", async () => {
    const s = await setup();
    const a = button("Splash", 100);
    const idA = await observed(s, a);
    s.core.forceRestAlpha(idA, 0.4);
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS)).toBe(true);
    const passes = textPasses();
    const b = button("Split", 300);
    s.rt.observe(b);
    await microtask(); // the batched redistribute bumps the generation
    s.core.forceRestAlpha(idA, 0.4);
    s.clock.advance(1); // the rebuild frame: a new atlas version, its upload not yet confirmed
    expect(s.atlas.canvases, "precondition: rebuilt").toHaveLength(2);
    expect(a.classList.contains(TEXT_CLASS), "the rebuild frame keeps the class").toBe(true);
    expect(textPasses(), "and draws the text").toBe(passes + 1);
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS), "still pending").toBe(true);
    expect(textPasses()).toBe(passes + 2);
    await flush(); // the new page is confirmed and swapped in
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS), "after the swap").toBe(true);
    expect(textPasses()).toBe(passes + 3);
    // W75 D75-1 A (approved-test change by Dennis 2026-10-10): refresh() invalidates a's own entry and
    // renews its owner, so the confirmed old page masks it until the re-read page is confirmed.
    s.rt.refresh(a);
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS), "D75-1 A: a refresh() masks a's stale glyphs, its DOM text shows").toBe(false);
    await flush();
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS), "back once the re-read page is confirmed").toBe(true);
    expect(gpu.calls.errors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  // W74 ward-review (I1 follow-up): a slot reused by another element never shows the old element's text.
  it("given_a_confirmed_page_for_A_in_slot_0_when_A_is_unobserved_and_B_takes_slot_0_then_B_gets_no_text_from_the_old_page_until_its_version_is_confirmed", async () => {
    const s = await setup();
    const a = button("Splash", 100);
    const idA = await observed(s, a);
    s.core.forceRestAlpha(idA, 0.4);
    s.clock.advance(1);
    expect(a.classList.contains(TEXT_CLASS)).toBe(true);
    const passes = textPasses();
    s.rt.unobserve(a);
    const b = button("Split", 100);
    const idB = s.rt.observe(b);
    expect(idB, "precondition: B reuses A's slot").toBe(idA);
    await microtask();
    s.core.forceRestAlpha(idB, 0.4);
    s.clock.advance(1); // a new version is pending; the drawn page still holds A's text in slot 0
    expect(s.atlas.canvases, "precondition: rebuilt").toHaveLength(2);
    expect(b.classList.contains(TEXT_CLASS), "B's DOM text stays: the old page is A's").toBe(false);
    expect(textPasses(), "no atlas text for slot 0 from the old page").toBe(passes);
    await flush(); // B's version is confirmed and swapped in
    s.clock.advance(1);
    expect(b.classList.contains(TEXT_CLASS), "B's own text once confirmed").toBe(true);
    expect(textPasses()).toBe(passes + 1);
    expect(gpu.calls.errors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("given_a_device_texture_limit_below_the_slot_size_when_built_then_the_atlas_is_capped_at_the_limit_and_the_element_keeps_its_dom_text", async () => {
    gpu.restore();
    gpu = installFakeGpu({ maxTextureDimension2D: 128 }); // a 140 px wide button + gutter does not fit
    const s = await setup();
    const el = button();
    const id = await observed(s, el);
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(s.atlas.canvases, "no page larger than the device can hold").toHaveLength(0);
    expect(gpu.calls.externalCopies).toHaveLength(0);
    expect(el.classList.contains(TEXT_CLASS)).toBe(false);
    expect(textPasses()).toBe(0);
  });
});

describe("W79: captureTextIds through the runtime (D79-1)", () => {
  it("given_webgpu_and_moving_text_when_captureTextIds_then_the_next_frame_copies_the_id_target_and_under_canvas2d_it_resolves_null", async () => {
    const s = await setup();
    const id = await observed(s, button());
    s.core.forceRestAlpha(id, 0.4);
    s.clock.advance(1);
    expect(textPasses(), "precondition: the text pass runs").toBe(1);
    const pending = s.rt.captureTextIds();
    s.clock.advance(1);
    const c = await pending;
    expect(c?.textPass).toBe(true);
    expect(gpu.calls.bufferCopies.map((b) => b.texture.label)).toEqual(["liquiddom T1id"]);
    const c2d = await setup({ renderer: "canvas2d" });
    expect(await c2d.rt.captureTextIds()).toBeNull();
    expect(gpu.calls.errors).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });
});
