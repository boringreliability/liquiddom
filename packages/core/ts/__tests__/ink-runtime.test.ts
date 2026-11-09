/**
 * @vitest-environment jsdom
 * W89 in the runtime (D89-5, D89-6, D89-10; Review Focus 1, 6): under Canvas2D the atlas is built
 * once two elements move and `liquid-text` follows the renderer's mixing report; every fail-safe
 * path takes it off, and a repaint without ink or atlas text (or WebGPU liquid text) runs where no
 * frame follows: a stop, and reduced motion on a paused instance. The test backend pins particles to
 * their rects, so two overlapping buttons mix wherever they overlap.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { AWAY_CLASS, TEXT_CLASS } from "../src/stylesheet";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { RenderFrame } from "../src/renderers/frame";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { installFakeGpu, type FakeGpu } from "./_fake-gpu";
import { fakeAtlasCanvas, installRangeRects, oneLinePerNode, type FakeAtlasFactory, type FakeAtlasOptions } from "./_fake-atlas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend } from "./_facade-helpers";
import type { TestFluidCore } from "./_fluid-test-backend";

let fake2d: FakeCanvasHandle;
let gpu: FakeGpu;
let restoreRects: () => void;
let error: MockInstance<typeof console.error>;
const live: FluidRuntime[] = [];

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  gpu = installFakeGpu();
  restoreRects = installRangeRects(
    oneLinePerNode((node) => {
      const r = (node.parentElement as HTMLElement).getBoundingClientRect();
      return { left: r.left + 20, top: r.top + 12 };
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
  a: HTMLElement;
  b: HTMLElement;
  ids: [number, number];
}

/** A button at (x, 200), 140 × 48, white 16 px text (none when `text` is empty). */
function button(text: string, x: number): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = text;
  Object.assign(b.style, { fontStyle: "normal", fontWeight: "600", fontSize: "16px", fontFamily: "Arial", color: "rgb(255, 255, 255)" });
  mockRect(b, x, 200, 140, 48);
  document.body.appendChild(b);
  return b;
}

/** Two observed buttons overlapping by 80 px (x 100–240 and 160–300), at rest after one frame. */
async function setup(renderer: "canvas2d" | "webgpu", texts: [string, string] = ["Splash", "Merge"], atlasOpts: FakeAtlasOptions = {}): Promise<Setup> {
  const sb = spyBackend();
  const clock = createManualClock();
  const atlas = fakeAtlasCanvas(atlasOpts);
  const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer, textAtlasCanvas: atlas.create });
  live.push(rt);
  const [a, b] = [button(texts[0], 100), button(texts[1], 160)];
  const ids: [number, number] = [rt.observe(a), rt.observe(b)];
  await microtask();
  clock.advance(1);
  await flush();
  return { rt, core: sb.cores[0] as unknown as TestFluidCore, clock, atlas, a, b, ids };
}

const held = (el: HTMLElement): boolean => el.classList.contains(TEXT_CLASS);

/** Both elements move (restAlpha 0.4) until both hold liquid-text, at most `max` frames; returns the frames run. */
function mixUntilHeld(s: Setup, max = 6): number {
  s.core.forceRestAlpha(s.ids[0], 0.4);
  s.core.forceRestAlpha(s.ids[1], 0.4);
  for (let f = 1; f <= max; f++) {
    s.clock.advance(1);
    if (held(s.a) && held(s.b)) return f;
  }
  return -1;
}

/** Records every frame render() is called with from now on. */
function captureRenders(proto: { render(frame: RenderFrame): void }): RenderFrame[] {
  const out: RenderFrame[] = [];
  const original = proto.render;
  vi.spyOn(proto, "render").mockImplementation(function (this: unknown, frame: RenderFrame) {
    return out.push(frame), original.call(this, frame);
  });
  return out;
}

/** drawImage calls of any atlas page (the fake atlas canvases) on any 2d context. */
function atlasDraws(s: Setup): number {
  const pages = new Set<unknown>(s.atlas.canvases);
  return fake2d.contexts.reduce((n, c) => n + c.ops("drawImage").filter((d) => pages.has(d.args[0])).length, 0);
}

const textPasses = (): number => gpu.calls.passes.filter((p) => p.attachments.some((a) => a.view.texture.label === "liquiddom T1")).length;

type Listener = (e: { matches: boolean }) => void;

/** Reduced-motion media query stub (text-runtime.test.ts pattern); install before setup(). */
function stubReducedMotionMedia(): { fire(matches: boolean): void; restore(): void } {
  const listeners = new Set<Listener>();
  const add = (_t: string, cb: Listener) => listeners.add(cb);
  const del = (_t: string, cb: Listener) => listeners.delete(cb);
  const rm = { matches: false, media: "(prefers-reduced-motion: reduce)", onchange: null, addEventListener: add, removeEventListener: del, addListener: (cb: Listener) => listeners.add(cb), removeListener: (cb: Listener) => listeners.delete(cb), dispatchEvent: () => true };
  const other = { ...rm, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const original = window.matchMedia;
  const value = vi.fn((q: string) => (q.includes("prefers-reduced-motion") ? rm : { ...other, media: q }));
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value });
  return {
    fire(matches) {
      rm.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
    restore: () => Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original }),
  };
}

describe("W89 runtime: Canvas2D atlas and liquid-text while two liquids mix (D89-5, D89-6)", () => {
  it("given_canvas2d_and_two_overlapping_text_elements_moving_when_frames_run_then_one_atlas_page_is_built_and_read_once_and_each_frame_holds_liquid_text_exactly_on_the_elements_whose_atlas_text_it_drew", async () => {
    const s = await setup("canvas2d");
    expect(s.atlas.canvases, "at rest: no atlas").toHaveLength(0);
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.core.forceRestAlpha(s.ids[1], 0.4);
    const frames: Array<{ drawn: number; held: number }> = [];
    for (let f = 0; f < 6; f++) {
      const before = atlasDraws(s);
      s.clock.advance(1);
      frames.push({ drawn: atlasDraws(s) - before, held: Number(held(s.a)) + Number(held(s.b)) });
    }
    expect(frames.map((f) => f.drawn), "the class follows this frame's atlas draws (no gap, no double)").toEqual(frames.map((f) => f.held));
    expect(frames.at(-1), "both mix within 6 frames (prewarm, build, entry, draw)").toEqual({ drawn: 2, held: 2 });
    expect(s.atlas.canvases, "one page").toHaveLength(1);
    expect(s.atlas.canvases[0]!.ctx!.imageReads, "its pixels read once").toHaveLength(1);
    s.core.forceRestAlpha(s.ids[0], null);
    s.core.forceRestAlpha(s.ids[1], null);
    const before = atlasDraws(s);
    s.clock.advance(1);
    expect([held(s.a), held(s.b), atlasDraws(s) - before], "at rest the DOM text is back in that frame and no atlas text is drawn").toEqual([false, false, 0]);
    expect(error).not.toHaveBeenCalled();
  });

  it("given_canvas2d_and_two_text_less_elements_moving_together_when_frames_run_then_no_atlas_page_and_no_class", async () => {
    const s = await setup("canvas2d", ["", ""]);
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.core.forceRestAlpha(s.ids[1], 0.4);
    s.clock.advance(6);
    expect(s.atlas.canvases, "no text, no atlas (D89-5)").toHaveLength(0);
    expect([held(s.a), held(s.b)]).toEqual([false, false]);
  });

  it("given_canvas2d_and_no_OffscreenCanvas_when_two_text_elements_mix_then_no_atlas_page_no_class_and_todays_look_D89_5", async () => {
    const s = await setup("canvas2d", ["Splash", "Merge"], { canvas: "null" });
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.core.forceRestAlpha(s.ids[1], 0.4);
    s.clock.advance(6);
    expect(s.atlas.canvases, "the factory returned null").toHaveLength(0);
    expect([held(s.a), held(s.b)], "the DOM text stays (and its halo)").toEqual([false, false]);
    expect(error).not.toHaveBeenCalled();
  });

  it("given_canvas2d_liquid_text_held_when_unobserve_runs_paused_or_running_then_the_class_goes_at_once_and_one_repaint_leaves_out_that_elements_atlas_text_and_destroy_clears_the_rest_review_focus_1", async () => {
    for (const paused of [true, false]) {
      const s = await setup("canvas2d");
      expect(mixUntilHeld(s), "precondition").toBeGreaterThan(0);
      if (paused) s.rt.pause();
      const renders = captureRenders(FluidCanvas2DRenderer.prototype);
      const before = atlasDraws(s);
      s.rt.unobserve(s.a);
      expect(held(s.a), "unobserve").toBe(false);
      expect(renders.map((f) => f.textOff), `paused ${paused}: one repaint without A's text`).toEqual([s.ids[0]]);
      expect([held(s.b), atlasDraws(s) - before], "B keeps its class and its atlas text").toEqual([true, 1]);
      vi.mocked(FluidCanvas2DRenderer.prototype.render).mockRestore();
      s.rt.destroy();
      expect(held(s.b), "destroy").toBe(false);
    }
  });

  it("given_webgpu_liquid_text_held_when_unobserve_runs_then_the_class_goes_and_one_repaint_leaves_out_that_elements_liquid_text_review_focus_1", async () => {
    const s = await setup("webgpu");
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.clock.advance(1);
    expect(held(s.a), "precondition").toBe(true);
    s.rt.pause();
    const renders = captureRenders(WebGPURenderer.prototype);
    s.rt.unobserve(s.a);
    expect(held(s.a)).toBe(false);
    expect(renders.map((f) => f.textOff), "one repaint without A's liquid text").toEqual([s.ids[0]]);
  });

  it("given_canvas2d_liquid_text_held_when_a_frame_throws_then_the_class_goes_and_the_stop_repaint_draws_no_ink_and_no_atlas_text_review_focus_1", async () => {
    const s = await setup("canvas2d");
    expect(mixUntilHeld(s), "precondition").toBeGreaterThan(0);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    const drawn = atlasDraws(s);
    vi.spyOn(s.core, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    s.clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect([held(s.a), held(s.b)]).toEqual([false, false]);
    expect(renders.map((f) => f.suppressText), "one repaint without text").toEqual([true]);
    expect(atlasDraws(s), "the repaint draws no atlas text").toBe(drawn);
  });

  it("given_canvas2d_liquid_text_held_and_the_loop_paused_when_reduced_motion_switches_on_then_the_class_goes_at_once_and_one_repaint_draws_no_atlas_text_D89_10", async () => {
    const media = stubReducedMotionMedia();
    try {
      const s = await setup("canvas2d");
      expect(mixUntilHeld(s), "precondition").toBeGreaterThan(0);
      s.rt.pause();
      const renders = captureRenders(FluidCanvas2DRenderer.prototype);
      const drawn = atlasDraws(s);
      media.fire(true);
      expect([held(s.a), held(s.b)]).toEqual([false, false]);
      expect(renders.map((f) => f.reducedMotion), "one render-only repaint under reduced motion").toEqual([true]);
      expect(atlasDraws(s), "no atlas text left on the canvas (Review Focus 6)").toBe(drawn);
    } finally {
      media.restore();
    }
  });

  it("given_webgpu_liquid_text_held_and_the_loop_paused_when_reduced_motion_switches_on_then_one_repaint_runs_no_text_pass_D89_10", async () => {
    const media = stubReducedMotionMedia();
    try {
      const s = await setup("webgpu");
      s.core.forceRestAlpha(s.ids[0], 0.4);
      s.clock.advance(1);
      expect(held(s.a), "precondition: WebGPU liquid text").toBe(true);
      s.rt.pause();
      const renders = captureRenders(WebGPURenderer.prototype);
      const passes = textPasses();
      media.fire(true);
      expect(held(s.a)).toBe(false);
      expect(renders.map((f) => f.reducedMotion), "one repaint").toEqual([true]);
      expect(textPasses(), "the repaint draws no liquid text").toBe(passes);
    } finally {
      media.restore();
    }
  });

  it("given_webgpu_liquid_text_held_when_a_frame_throws_then_the_stop_repaint_runs_no_text_pass_review_focus_1", async () => {
    const s = await setup("webgpu");
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.clock.advance(1);
    expect(held(s.a), "precondition").toBe(true);
    const renders = captureRenders(WebGPURenderer.prototype);
    const passes = textPasses();
    vi.spyOn(s.core, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    s.clock.advance(1);
    expect(held(s.a)).toBe(false);
    expect(renders.map((f) => f.suppressText), "one repaint without text").toEqual([true]);
    expect(textPasses(), "no liquid text on the stopped canvas").toBe(passes);
  });

  it("given_webgpu_and_two_mixing_text_elements_when_the_device_is_lost_then_the_class_goes_at_once_and_returns_under_canvas2d_once_it_draws_their_text_D89_5", async () => {
    const s = await setup("webgpu");
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.core.forceRestAlpha(s.ids[1], 0.4);
    s.clock.advance(1);
    expect([held(s.a), held(s.b)], "precondition: WebGPU liquid text").toEqual([true, true]);
    gpu.loseDevice("gpu reset");
    await vi.waitFor(() => expect(s.rt.activeRenderer).toBe("canvas2d"));
    expect([held(s.a), held(s.b)], "cleared in the loss handler").toEqual([false, false]);
    await flush();
    let f = 0;
    while (f < 8 && !(held(s.a) && held(s.b))) {
      s.clock.advance(1);
      f += 1;
    }
    expect([held(s.a), held(s.b)], `Canvas2D draws their atlas text and holds the class (${f} frames)`).toEqual([true, true]);
  });
});

// ---- W89 final review (M1, M2) ----

/** Records the renderer instance and the frame of every render() from now on. */
function captureRendersWithThis<T>(proto: { render(frame: RenderFrame): void }): Array<{ r: T; frame: RenderFrame }> {
  const out: Array<{ r: T; frame: RenderFrame }> = [];
  const original = proto.render;
  vi.spyOn(proto, "render").mockImplementation(function (this: T, frame: RenderFrame) {
    return out.push({ r: this, frame }), original.call(this, frame);
  });
  return out;
}

/** jsdom has no pointer capture: the drag tracker's stand-ins (drag-runtime.test.ts pattern). */
function capturable(el: HTMLElement): void {
  let id: number | null = null;
  Object.assign(el, {
    setPointerCapture: (p: number) => {
      id = p;
    },
    releasePointerCapture: (p: number) => {
      if (id === p) id = null;
    },
    hasPointerCapture: (p: number) => id === p,
  });
}

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;

/** A mouse press at (x, y) on `el`, then one move by (dx, dy): a live drag. */
function press(el: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: x, clientY: y }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: x + dx, clientY: y + dy }));
}

describe("W89 final review: repaints that leave the canvas consistent (M1, M2)", () => {
  it("given_canvas2d_paused_right_after_another_pair_started_or_stopped_mixing_when_unobserve_repaints_then_every_remaining_element_holds_liquid_text_exactly_when_that_repaint_drew_its_atlas_text_M1", async () => {
    for (let k = 1; k <= 4; k++) {
      const sb = spyBackend();
      const clock = createManualClock();
      const atlas = fakeAtlasCanvas();
      const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: "canvas2d", textAtlasCanvas: atlas.create });
      live.push(rt);
      const els = [button("Splash", 100), button("Merge", 160), button("Swirl", 420), button("Drift", 480)];
      const ids = els.map((el) => rt.observe(el));
      await microtask();
      clock.advance(1);
      await flush();
      const core = sb.cores[0] as unknown as TestFluidCore;
      core.forceRestAlpha(ids[0]!, 0.4);
      core.forceRestAlpha(ids[1]!, 0.4);
      for (let f = 0; f < 8 && !(held(els[0]!) && held(els[1]!)); f++) clock.advance(1);
      expect([held(els[0]!), held(els[1]!)], "precondition: A and B mix").toEqual([true, true]);
      // The second pair starts to mix k frames before the pause: its report turns on in one of them.
      core.forceRestAlpha(ids[2]!, 0.4);
      core.forceRestAlpha(ids[3]!, 0.4);
      clock.advance(k);
      rt.pause();
      const renders = captureRendersWithThis<FluidCanvas2DRenderer>(FluidCanvas2DRenderer.prototype);
      rt.unobserve(els[0]!);
      expect(renders.map((x) => x.frame.textOff), `k ${k}: one repaint`).toEqual([ids[0]]);
      const r = renders[0]!.r;
      for (const i of [1, 2, 3]) {
        expect(held(els[i]!), `k ${k}, element ${i}: the class follows what the paused canvas shows (no double, no gap)`).toBe(r.textMixing(ids[i]!));
      }
      vi.mocked(FluidCanvas2DRenderer.prototype.render).mockRestore();
      rt.destroy();
      resetDom();
    }
    expect(error).not.toHaveBeenCalled();
  });

  /** A text pill (A) dragged into a text-less blob (B): ink from A, but no liquid-text hold anywhere. */
  async function draggedIntoBlob(): Promise<Setup> {
    const s = await setup("canvas2d", ["Splash", ""]);
    capturable(s.a);
    press(s.a, 170, 224, 30, 0);
    s.core.forceRestAlpha(s.ids[0], 0.4);
    s.core.forceRestAlpha(s.ids[1], 0.4);
    s.clock.advance(6);
    expect([s.a.classList.contains(AWAY_CLASS), held(s.a), held(s.b)], "precondition: A away, no liquid-text").toEqual([true, false, false]);
    expect(s.atlas.canvases.length, "precondition: the atlas exists, so A's ink is splatted").toBeGreaterThan(0);
    return s;
  }

  it("given_canvas2d_ink_from_a_dragged_element_and_no_liquid_text_hold_when_reduced_motion_switches_on_while_paused_then_one_repaint_takes_the_ink_off_M2", async () => {
    const media = stubReducedMotionMedia();
    try {
      const s = await draggedIntoBlob();
      s.rt.pause();
      const renders = captureRenders(FluidCanvas2DRenderer.prototype);
      media.fire(true);
      expect(s.a.classList.contains(AWAY_CLASS)).toBe(false);
      expect(renders.map((f) => f.reducedMotion), "one repaint without ink (Review Focus 6)").toEqual([true]);
    } finally {
      media.restore();
    }
  });

  it("given_canvas2d_ink_from_a_dragged_element_and_no_liquid_text_hold_when_a_frame_throws_then_the_stop_repaint_draws_no_ink_M2", async () => {
    const s = await draggedIntoBlob();
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    vi.spyOn(s.core, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    s.clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(renders.map((f) => f.suppressText), "one repaint without ink or text").toEqual([true]);
  });
});
