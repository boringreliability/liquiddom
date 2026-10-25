/**
 * @vitest-environment jsdom
 * W88 in the runtime (D88-1, D88-3, D88-7; Review Focus 1, 2, 3): the snapshot reaches the paints,
 * the toggle runs after render() and follows what the renderer drew, the W75 triggers and
 * `box-shadow` transitionend re-read the shadow, and every fail-safe path takes the class off without
 * a double shadow. jsdom ignores @layer and returns box-shadow as specified, so the author styles
 * add the unlayered emulation of `.liquid-shadow-away`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { ElementRegistry } from "../src/element-registry";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { RenderFrame } from "../src/renderers/frame";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { ELEMENT_CLASS, SHADOW_AWAY_CLASS } from "../src/stylesheet";
import { fakeAtlasCanvas } from "./_fake-atlas";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu } from "./_fake-gpu";
import { movingBackend, type MovingBackend } from "./_moving-backend";

let fake2d: FakeCanvasHandle;
let gpu: LifecycleGpu | null = null;
const live: FluidRuntime[] = [];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  gpu?.restore();
  gpu = null;
  fake2d.restore();
  vi.restoreAllMocks();
});

const DROP = { color: [0, 0, 0, 0.4], dx: 0, dy: 8, blur: 20, spread: 0, inset: false };
const INSET = { color: [255, 255, 255, 1], dx: 0, dy: 2, blur: 4, spread: 0, inset: true };
const GLOW = { color: [0, 255, 255, 1], dx: 0, dy: 0, blur: 12, spread: 0, inset: false };

/** Author styles plus the unlayered emulation of `.liquid-element` and `.liquid-shadow-away`. */
function authorStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = [
    ".btn { background-color: rgb(47, 111, 222); color: rgb(255, 255, 255); box-shadow: 0 8px 20px rgba(0,0,0,.4), inset 0 2px 4px rgb(255, 255, 255); }",
    ".btn.alt { box-shadow: 0 0 12px rgb(0, 255, 255); }",
    `.${ELEMENT_CLASS} { background-color: transparent !important; }`,
    `.${SHADOW_AWAY_CLASS} { box-shadow: none !important; }`,
  ].join("\n");
  document.head.appendChild(style);
  return style;
}

function button(x = 10): HTMLElement {
  const el = document.createElement("button");
  el.className = "btn";
  mockRect(el, x, 10, 140, 48);
  document.body.appendChild(el);
  return el;
}

async function start(renderer: "canvas2d" | "webgpu" = "canvas2d", moving: MovingBackend = movingBackend()): Promise<{ rt: FluidRuntime; clock: ManualClock; moving: MovingBackend }> {
  if (renderer === "webgpu") gpu = installFakeGpuLifecycle();
  const clock = createManualClock();
  const rt = await createFluidRuntime({
    particles: 256, maxElements: 4, seed: 1, testBackend: moving.backend, clock, renderer, textAtlasCanvas: fakeAtlasCanvas().create,
  });
  live.push(rt);
  return { rt, clock, moving };
}

/** Records every frame render() was called with, and the class state of `el` at that moment. */
function captureRenders(proto: { render(frame: RenderFrame): void }, el?: () => HTMLElement | undefined): Array<{ frame: RenderFrame; held: boolean }> {
  const out: Array<{ frame: RenderFrame; held: boolean }> = [];
  const original = proto.render;
  vi.spyOn(proto, "render").mockImplementation(function (this: unknown, frame: RenderFrame) {
    out.push({ frame, held: el?.()?.classList.contains(SHADOW_AWAY_CLASS) ?? false });
    return original.call(this, frame);
  });
  return out;
}

function transitionEnd(prop: string): Event {
  const e = new Event("transitionend", { bubbles: true });
  Object.defineProperty(e, "propertyName", { value: prop });
  return e;
}

const held = (el: HTMLElement): boolean => el.classList.contains(SHADOW_AWAY_CLASS);

describe("W88: the snapshot in the runtime (D88-2, D88-3)", () => {
  it("given_an_observed_element_with_an_outer_and_an_inset_layer_when_a_frame_runs_then_the_paint_carries_the_outer_layer_and_shadowLayers_both", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows).toEqual([DROP]);
    expect(rt.shadowLayers(el)).toEqual([DROP, INSET]);
    expect(rt.shadowLayers(document.createElement("div")), "unobserved").toEqual([]);
  });
});

describe("W88: the toggle in the runtime (D88-1, D88-7)", () => {
  it("given_canvas2d_and_a_moving_shadowed_element_when_frames_run_then_the_class_follows_each_render_and_goes_in_the_frame_restAlpha_reaches_1", async () => {
    authorStyles();
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype, () => el);
    moving.setRestAlpha(id, 0.5);
    clock.advance(1);
    expect(renders.at(-1)?.held, "at the first moving render the browser's shadow still shows").toBe(false);
    expect(held(el), "after that render the renderer's shadow replaces it").toBe(true);
    clock.advance(1);
    expect(renders.at(-1)?.held).toBe(true);
    moving.setRestAlpha(id, null); // restAlpha 1
    clock.advance(1);
    expect(held(el), "D88-7: the instant handoff, in the same frame").toBe(false);
    expect(getComputedStyle(el).boxShadow).toContain("20px");
  });

  it("given_the_class_toggling_every_frame_for_60_frames_when_they_run_then_no_colour_or_shadow_re_read_and_no_atlas_invalidation", async () => {
    authorStyles();
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    const refreshShadow = vi.spyOn(ElementRegistry.prototype, "refreshShadow");
    const before = rt.textInvalidations;
    let toggles = 0;
    for (let f = 0; f < 60; f++) {
      moving.setRestAlpha(id, f % 2 === 0 ? 0.5 : null);
      const was = held(el);
      clock.advance(1);
      await flush();
      if (held(el) !== was) toggles += 1;
    }
    expect(toggles).toBeGreaterThan(50);
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshShadow).not.toHaveBeenCalled();
    expect(rt.textInvalidations).toBe(before);
  });
});

describe("W88: re-reading the shadow (D88-3; Review Focus 2)", () => {
  it("given_a_box_shadow_transitionend_on_the_element_when_the_next_frame_runs_then_only_the_shadow_is_re_read_and_the_paint_carries_it", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const child = el.appendChild(document.createElement("span"));
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    const refreshShadow = vi.spyOn(ElementRegistry.prototype, "refreshShadow");
    const before = rt.textInvalidations;
    const later = document.createElement("style");
    later.textContent = ".btn.btn { box-shadow: 0 0 12px rgb(0, 255, 255); }"; // a hover style, emulated
    document.head.appendChild(later);
    child.dispatchEvent(transitionEnd("box-shadow")); // a descendant's: ignored
    clock.advance(1);
    expect(refreshShadow).not.toHaveBeenCalled();
    el.dispatchEvent(transitionEnd("box-shadow"));
    clock.advance(1);
    expect(refreshShadow).toHaveBeenCalledTimes(1);
    expect(refresh, "colours are untouched").not.toHaveBeenCalled();
    expect(rt.textInvalidations, "no atlas re-render").toBe(before);
    expect(renders.at(-1)?.frame.paints[id]?.shadows).toEqual([GLOW]);
  });

  it("given_an_own_class_change_when_the_next_frame_runs_then_the_shadow_is_re_read_with_the_colours", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    el.classList.add("alt");
    await flush();
    clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows).toEqual([GLOW]);
  });

  it("given_an_own_style_change_when_the_next_frame_runs_then_the_shadow_is_re_read", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    el.style.boxShadow = "0 0 12px rgb(0, 255, 255)";
    await flush();
    clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows).toEqual([GLOW]);
    el.removeAttribute("style");
    await flush();
    clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows, "back to the stylesheet's").toEqual([DROP]);
  });

  it("given_a_shadow_change_without_a_transition_or_mutation_when_frames_run_then_the_old_shadow_until_refresh_and_a_refresh_mid_motion_reads_the_author_shadow_not_none_review_focus_2", async () => {
    authorStyles();
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    moving.setRestAlpha(id, 0.4);
    clock.advance(1);
    expect(held(el), "moving: the class hides the browser's shadow").toBe(true);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype);
    const hover = document.createElement("style");
    hover.textContent = ".btn.btn { box-shadow: 0 0 12px rgb(0, 255, 255); }";
    document.head.appendChild(hover);
    for (let f = 0; f < 3; f++) clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows, "the old shadow, as the spec says").toEqual([DROP]);
    rt.refresh(el);
    clock.advance(1);
    expect(renders.at(-1)?.frame.paints[id]?.shadows, "never stale and never `none` after refresh").toEqual([GLOW]);
    expect(held(el), "the class is back on").toBe(true);
    expect(el.getAttribute("style"), "the lift leaves no inline style").toBeNull();
  });
});

describe("W88: the class on the fail-safe paths (D88-1; Review Focus 1, 3)", () => {
  it("given_the_class_held_when_unobserve_then_destroy_run_then_it_is_gone_each_time", async () => {
    authorStyles();
    const { rt, clock, moving } = await start();
    const a = button(10);
    const b = button(200);
    const ia = rt.observe(a);
    const ib = rt.observe(b);
    await flush();
    moving.setRestAlpha(ia, 0.5);
    moving.setRestAlpha(ib, 0.5);
    clock.advance(1);
    expect([held(a), held(b)]).toEqual([true, true]);
    rt.unobserve(a);
    expect(held(a)).toBe(false);
    rt.destroy();
    expect(held(b)).toBe(false);
  });

  it("given_the_class_held_when_reduced_motion_switches_on_then_it_goes_at_once_and_the_next_frame_draws_no_shadow", async () => {
    authorStyles();
    // The reduced-motion media query stub of reduced-motion-input.test.ts (jsdom has no matchMedia).
    type Listener = (e: { matches: boolean }) => void;
    const listeners = new Set<Listener>();
    const mql = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
      removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
    };
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (q: string) => (q.includes("prefers-reduced-motion") ? mql : { ...mql, media: q, addEventListener() {}, removeEventListener() {} }),
    });
    try {
      const { rt, clock, moving } = await start();
      const el = button();
      const id = rt.observe(el);
      await flush();
      moving.setRestAlpha(id, 0.5);
      clock.advance(1);
      expect(held(el)).toBe(true);
      const renders = captureRenders(FluidCanvas2DRenderer.prototype);
      mql.matches = true;
      for (const cb of [...listeners]) cb({ matches: true });
      expect(held(el), "no frame needed").toBe(false);
      expect(renders, "no repaint: the next frame draws no shadow").toEqual([]);
      expect(rt.reducedMotion).toBe(true);
      clock.advance(1);
      expect(renders.map((r) => r.frame.reducedMotion)).toEqual([true]);
      expect(held(el), "that frame drew no shadow (reduced motion): still the browser's").toBe(false);
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original });
    }
  });

  it("given_the_class_held_when_a_frame_throws_then_the_instance_stops_the_canvas_is_repainted_without_shadows_and_the_class_goes_review_focus_1", async () => {
    authorStyles();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    moving.setRestAlpha(id, 0.5);
    clock.advance(1);
    expect(held(el)).toBe(true);
    const renders = captureRenders(FluidCanvas2DRenderer.prototype, () => el);
    vi.spyOn(moving.backend.cores[0]!, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(held(el)).toBe(false);
    expect(renders.map((r) => r.frame.suppressShadows), "the stop's repaint: the liquid without its shadow").toEqual([true]);
    expect(renders[0]?.held, "drawn while the class was still on").toBe(true);
    expect(rt.shadowLayers(el)).toEqual([DROP, INSET]);
  });

  it("given_the_stop_repaint_itself_throws_when_the_instance_stops_then_the_canvas_bitmap_is_reset_and_still_one_console_error", async () => {
    authorStyles();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    moving.setRestAlpha(id, 0.5);
    clock.advance(1);
    expect(held(el)).toBe(true);
    vi.spyOn(FluidCanvas2DRenderer.prototype, "render").mockImplementation(() => {
      throw new Error("render broke");
    });
    const width = vi.spyOn(HTMLCanvasElement.prototype, "width", "set");
    clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(width.mock.contexts.includes(rt.canvas), "the canvas is cleared: no shadow can double").toBe(true);
    expect(held(el)).toBe(false);
  });

  it("given_webgpu_and_the_class_held_when_the_device_is_lost_then_the_class_goes_at_once_and_returns_under_the_canvas2d_rebuild", async () => {
    authorStyles();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rt, clock, moving } = await start("webgpu");
    expect(rt.activeRenderer).toBe("webgpu");
    const el = button();
    const id = rt.observe(el);
    await flush();
    moving.setRestAlpha(id, 0.5);
    clock.advance(1);
    expect(held(el), "WebGPU drew the shadow").toBe(true);
    gpu!.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    expect(held(el), "a lost device: the browser's shadow at once").toBe(false);
    await flush();
    clock.advance(1);
    expect(held(el), "the Canvas2D rebuild draws it again").toBe(true);
  });

  it("given_two_instances_observing_one_element_when_one_moves_then_one_hold_and_the_class_stays_until_the_last_moving_instance_releases_review_focus_3", async () => {
    authorStyles();
    const a = await start();
    const b = await start();
    const el = button();
    const ia = a.rt.observe(el);
    const ib = b.rt.observe(el);
    await flush();
    a.moving.setRestAlpha(ia, 0.5);
    a.clock.advance(1);
    b.clock.advance(1);
    expect(held(el), "a's liquid is away; b's rests").toBe(true);
    b.moving.setRestAlpha(ib, 0.5);
    b.clock.advance(1);
    a.moving.setRestAlpha(ia, null);
    a.clock.advance(1);
    expect(held(el), "b still holds it").toBe(true);
    b.rt.destroy();
    expect(held(el)).toBe(false);
  });
});
