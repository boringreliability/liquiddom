/**
 * @vitest-environment jsdom
 * W75 "text that stays true" in the runtime (D75-1 … D75-3): colour auto-refresh on a
 * style/class mutation and on transitionend; atlas re-render on text mutations, fonts and DPR,
 * coalesced to one per element and frame (Review Focus 3, 5); liquiddom's own class writes never
 * loop (Review Focus 2); the Canvas2D halo, also on the fail-safe paths. W74's real TextAtlas
 * runs on the fake atlas canvas (_fake-atlas.ts). jsdom ignores @layer, so colour tests add an
 * unlayered rule that emulates the layered !important rules (as stylesheet.test.ts does).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { DEFAULT_TEXT_COLOR } from "../src/color";
import { ElementRegistry } from "../src/element-registry";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { RenderFrame } from "../src/renderers/frame";
import { TextAtlas } from "../src/renderers/webgpu/text-atlas";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { ELEMENT_CLASS, HALO_CLASS, HALO_ID_ATTR, STYLE_ELEMENT_ID, TEXT_CLASS } from "../src/stylesheet";
import { fakeAtlasCanvas, installRangeRects, oneLinePerNode, type FakeAtlasFactory } from "./_fake-atlas";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu } from "./_fake-gpu";
import { movingBackend, type MovingBackend } from "./_moving-backend";

let fake2d: FakeCanvasHandle;
let gpu: LifecycleGpu | null = null;
let restoreRects: () => void;
const live: FluidRuntime[] = [];
const setWindow = (key: string, value: number): void => {
  Object.defineProperty(window, key, { value, configurable: true });
};
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  // W74's atlas reads line boxes through Range.getClientRects (missing in jsdom).
  restoreRects = installRangeRects(
    oneLinePerNode((node) => {
      const r = (node.parentElement as HTMLElement).getBoundingClientRect();
      return { left: r.left + 20, top: r.top + 12 };
    }),
  );
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  restoreRects();
  gpu?.restore();
  gpu = null;
  fake2d.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setWindow("devicePixelRatio", 1);
  delete (document as unknown as { fonts?: unknown }).fonts;
});

/** Author colours plus the unlayered emulation of `.liquid-element` and W74's `.liquid-text` (text-fill, never `color`). */
function authorStyles(): void {
  const style = document.createElement("style");
  style.textContent = [
    ".btn { background-color: rgb(47, 111, 222); color: rgb(255, 255, 255); }",
    ".btn.alt { background-color: rgb(200, 30, 30); color: rgb(255, 230, 0); }",
    `.${ELEMENT_CLASS} { background-color: transparent !important; }`,
    `.${TEXT_CLASS}, .${TEXT_CLASS} * { -webkit-text-fill-color: transparent !important; }`,
  ].join("\n");
  document.head.appendChild(style);
}

function button(label = "Splash"): HTMLElement {
  const el = document.createElement("button");
  el.className = "btn";
  el.textContent = label;
  mockRect(el, 10, 10, 140, 48);
  document.body.appendChild(el);
  return el;
}

async function start(
  renderer: "canvas2d" | "webgpu" = "canvas2d",
  moving: MovingBackend = movingBackend(),
): Promise<{ rt: FluidRuntime; clock: ManualClock; moving: MovingBackend; atlas: FakeAtlasFactory }> {
  if (renderer === "webgpu") gpu = installFakeGpuLifecycle();
  const clock = createManualClock();
  const atlas = fakeAtlasCanvas();
  const rt = await createFluidRuntime({
    particles: 256, maxElements: 4, seed: 1, testBackend: moving.backend, clock, renderer, textAtlasCanvas: atlas.create,
  });
  live.push(rt);
  return { rt, clock, moving, atlas };
}

function captureFrames(proto: { render(frame: RenderFrame): void }, order?: string[]): RenderFrame[] {
  const frames: RenderFrame[] = [];
  const original = proto.render;
  vi.spyOn(proto, "render").mockImplementation(function (this: unknown, frame: RenderFrame) {
    order?.push("render");
    frames.push(frame);
    return original.call(this, frame);
  });
  return frames;
}

function transitionEnd(prop: string): Event {
  const e = new Event("transitionend", { bubbles: true });
  Object.defineProperty(e, "propertyName", { value: prop });
  return e;
}

/** W74's real atlas (the runtime owns it): spy on TextAtlas.invalidate and call through. */
function spyInvalidate(order?: string[]): ReturnType<typeof vi.spyOn> {
  const original = TextAtlas.prototype.invalidate;
  return vi.spyOn(TextAtlas.prototype, "invalidate").mockImplementation(function (this: TextAtlas, id: number) {
    order?.push(`invalidate:${id}`);
    original.call(this, id);
  });
}

describe("W75: colour auto-refresh (D75-2)", () => {
  it("given_an_author_class_change_when_the_next_frame_runs_then_colours_are_re_snapshotted_once_and_the_paint_carries_them_D75_2", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    const frames = captureFrames(FluidCanvas2DRenderer.prototype);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    clock.advance(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(frames.at(-1)?.paints[id]?.background).toEqual([47, 111, 222, 1]);

    el.classList.add("alt");
    await flush();
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(frames.at(-1)?.paints[id]?.background).toEqual([200, 30, 30, 1]);
    expect(frames.at(-1)?.paints[id]?.text).toEqual([255, 230, 0, 1]);

    for (let f = 0; f < 3; f++) {
      await flush();
      clock.advance(1);
    }
    expect(refresh, "the snapshot's own attribute round trip is not a change").toHaveBeenCalledTimes(1);
    expect(el.getAttribute("style")).toBeNull();
  });

  it("given_own_class_toggles_and_a_refresh_every_frame_when_60_frames_run_then_no_extra_snapshot_and_no_text_invalidation_RF2", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock } = await start("canvas2d", moving);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    const before = rt.textInvalidations;
    rt.refresh(el); // one explicit refresh: its class lift and style round trip follow as records
    for (let f = 0; f < 60; f++) {
      moving.setRestAlpha(id, f % 2 === 0 ? 0.5 : null); // the halo toggles every frame
      el.classList.toggle(TEXT_CLASS); // W74's toggle, emulated
      clock.advance(1);
      await flush();
    }
    expect(refresh, "only the explicit refresh()").toHaveBeenCalledTimes(1);
    expect(rt.textInvalidations - before, "only the explicit refresh() re-renders the atlas entry").toBe(1);
  });

  it("given_transitionend_for_background_color_or_color_on_the_element_when_the_next_frame_runs_then_one_refresh_and_other_properties_or_bubbled_events_none_D75_2", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const child = el.appendChild(document.createElement("span"));
    rt.observe(el);
    await flush();
    clock.advance(1);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");

    el.dispatchEvent(transitionEnd("background-color"));
    expect(refresh, "deferred to the next frame").not.toHaveBeenCalled();
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    el.dispatchEvent(transitionEnd("color"));
    el.dispatchEvent(transitionEnd("color"));
    clock.advance(1);
    expect(refresh, "coalesced per frame").toHaveBeenCalledTimes(2);

    el.dispatchEvent(transitionEnd("opacity"));
    child.dispatchEvent(transitionEnd("color")); // bubbles to el, but its target is the child
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("given_liquid_text_on_mid_motion_when_refresh_runs_then_the_author_text_colour_is_read_and_the_atlas_is_rebuilt_in_it_before_the_render", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock, atlas } = await start("webgpu", moving);
    expect(rt.activeRenderer).toBe("webgpu");
    const inv = spyInvalidate();
    const frames = captureFrames(WebGPURenderer.prototype);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1); // W74 review (I1): the first render uploads the atlas page ...
    await flush(); // ... which is confirmed once its error scope resolves; only then is textReady true
    moving.setRestAlpha(id, 0.4);
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS), "W74's toggle: webgpu, atlas ready, moving").toBe(true);
    expect(atlas.fills().map((f) => f.fillStyle)).toEqual(["rgb(255, 255, 255)"]);

    const author = document.createElement("style");
    author.textContent = ".btn.btn { color: rgb(255, 230, 0); }"; // a stylesheet change: no mutation on el
    document.head.appendChild(author);
    inv.mockClear();
    const version = frames.at(-1)?.textAtlas?.version ?? 0;
    rt.refresh(el);
    clock.advance(1);
    expect(frames.at(-1)?.paints[id]?.text).toEqual([255, 230, 0, 1]);
    expect(frames.at(-1)?.paints[id]?.text).not.toEqual(DEFAULT_TEXT_COLOR);
    expect(inv).toHaveBeenCalledWith(id);
    expect(frames.at(-1)?.textAtlas?.version, "rebuilt before this frame's render").toBe(version + 1);
    expect(
      atlas.fills().map((f) => f.fillStyle),
      "liquid-text is on, yet the atlas reads the author colour: W74's rule never sets color",
    ).toEqual(["rgb(255, 230, 0)"]);
    expect(el.classList.contains(TEXT_CLASS), "D75-1 A: masked until the recoloured page is confirmed").toBe(false);
    await flush();
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS), "the confirmed page draws the author colour").toBe(true);
  });
});

describe("W75: atlas re-render triggers (D75-1, Review Focus 3 and 5)", () => {
  it("given_webgpu_and_a_text_mutation_mid_motion_when_the_next_frame_runs_then_one_invalidate_before_render_and_that_render_already_draws_the_rebuilt_atlas_RF3", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock, atlas } = await start("webgpu", moving);
    const order: string[] = [];
    const inv = spyInvalidate(order);
    const frames = captureFrames(WebGPURenderer.prototype, order);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1); // W74 review (I1): the first render uploads the atlas page ...
    await flush(); // ... which is confirmed once its error scope resolves; only then is textReady true
    moving.setRestAlpha(id, 0.4);
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    const built = atlas.canvases.length;
    const version = frames.at(-1)?.textAtlas?.version ?? 0;
    const owner = frames.at(-1)?.paints[id]?.owner;

    order.length = 0;
    (el.firstChild as Text).data = "Splo"; // characterData
    el.append("sh!"); // childList
    el.append(document.createElement("b")); // childList
    clock.advance(1);
    expect(inv, "three mutations, one frame, one re-render").toHaveBeenCalledTimes(1);
    expect(inv).toHaveBeenCalledWith(id);
    expect(order.indexOf(`invalidate:${id}`)).toBeLessThan(order.indexOf("render"));
    expect(atlas.canvases.length - built, "one rebuild").toBe(1);
    expect(frames.at(-1)?.textAtlas?.version, "this frame's render uploads the rebuilt page").toBe(version + 1);
    expect(atlas.fills().map((f) => f.text), "no stale glyphs: the page holds the new text only").toEqual(["Splo", "sh!"]);
    expect(frames.at(-1)?.paints[id]?.atlasRect, "the rest-UV mapping follows the rebuilt rect").toEqual({ x: 10, y: 10, w: 140, h: 48 });
    expect(frames.at(-1)?.paints[id]?.owner, "D75-1 A: a new owner token masks the slot on the confirmed (old) page").not.toBe(owner);
    expect(el.classList.contains(TEXT_CLASS), "D75-1 A: no stale glyphs while the new page is staged: the new DOM text shows").toBe(false);
    await flush(); // the staged upload's error scope resolves clean
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS), "the confirmed new page draws the new text: liquid-text is back").toBe(true);

    clock.advance(1);
    expect(inv).toHaveBeenCalledTimes(1);
    expect(atlas.canvases.length - built, "no rebuild without a change").toBe(1);
  });

  it("given_document_fonts_loadingdone_when_the_next_frame_runs_then_every_observed_element_is_invalidated_once_RF5", async () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    const { rt, clock } = await start("webgpu");
    const inv = spyInvalidate();
    const a = rt.observe(button("A"));
    const b = rt.observe(button("B"));
    await flush();
    clock.advance(1);
    inv.mockClear();
    const before = rt.textInvalidations;

    fonts.dispatchEvent(new Event("loadingdone"));
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(inv, "deferred to the next frame").not.toHaveBeenCalled();
    clock.advance(1);
    expect(inv.mock.calls.map((c) => c[0]).sort()).toEqual([a, b].sort());
    expect(rt.textInvalidations - before).toBe(2);
    clock.advance(1);
    expect(inv).toHaveBeenCalledTimes(2);

    rt.destroy();
    expect(() => fonts.dispatchEvent(new Event("loadingdone"))).not.toThrow();
    expect(inv).toHaveBeenCalledTimes(2);
  });

  it("given_a_dpr_change_on_the_resolution_query_when_fired_then_the_canvas_is_resized_every_element_is_invalidated_and_the_query_is_re_armed_RF5", async () => {
    const listeners = new Map<string, Set<() => void>>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: false,
        media: q,
        addEventListener: (_t: string, l: () => void) => {
          const set = listeners.get(q) ?? new Set<() => void>();
          set.add(l);
          listeners.set(q, set);
        },
        removeEventListener: (_t: string, l: () => void) => {
          listeners.get(q)?.delete(l);
        },
      })),
    );
    setWindow("devicePixelRatio", 1);
    const { rt, clock } = await start("webgpu");
    const inv = spyInvalidate();
    const id = rt.observe(button());
    await flush();
    clock.advance(1);
    inv.mockClear();
    expect(listeners.get("(resolution: 1dppx)")?.size).toBe(1);

    window.dispatchEvent(new Event("resize")); // same DPR: a resize alone re-renders nothing
    clock.advance(1);
    expect(inv).not.toHaveBeenCalled();

    setWindow("devicePixelRatio", 2);
    for (const l of [...(listeners.get("(resolution: 1dppx)") ?? [])]) l();
    expect(rt.canvas.width).toBe(Math.round(window.innerWidth * 2));
    expect(listeners.get("(resolution: 1dppx)")?.size ?? 0).toBe(0);
    expect(listeners.get("(resolution: 2dppx)")?.size).toBe(1);
    clock.advance(1);
    expect(inv).toHaveBeenCalledTimes(1);
    expect(inv).toHaveBeenCalledWith(id);
  });
});

describe("W75: the Canvas2D halo in the runtime (D75-3)", () => {
  it("given_canvas2d_and_a_moving_element_when_frames_run_then_liquid_halo_on_once_off_at_rest_with_a_rule_in_the_background_colour_and_no_inline_style_D75_3", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock } = await start("canvas2d", moving);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const key = el.getAttribute(HALO_ID_ATTR) ?? "";
    expect(key).toMatch(/^h\d+$/);
    expect(document.getElementById(STYLE_ELEMENT_ID)?.textContent).toContain(
      `.${HALO_CLASS}[${HALO_ID_ATTR}="${key}"] { text-shadow: 0 0 1px rgba(47, 111, 222, 1)`,
    );
    expect(el.classList.contains(HALO_CLASS)).toBe(false);

    const mo = new MutationObserver(() => {});
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    moving.setRestAlpha(id, 0.6);
    for (let f = 0; f < 6; f++) clock.advance(1);
    expect(el.classList.contains(HALO_CLASS)).toBe(true);
    expect(mo.takeRecords(), "one class write for six moving frames").toHaveLength(1);
    moving.setRestAlpha(id, null);
    clock.advance(1);
    expect(el.classList.contains(HALO_CLASS)).toBe(false);
    mo.disconnect();
    expect(el.getAttribute("style"), "D66-3: no inline style").toBeNull();
  });

  it("given_unobserve_and_destroy_when_mutations_and_transitionend_follow_then_no_refresh_and_class_attribute_rule_and_listeners_are_gone", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock } = await start("canvas2d", moving);
    const el = button("A");
    const other = button("B");
    const id = rt.observe(el);
    rt.observe(other);
    await flush();
    moving.setRestAlpha(id, 0.5);
    clock.advance(1);
    expect(el.classList.contains(HALO_CLASS)).toBe(true);
    const key = el.getAttribute(HALO_ID_ATTR) ?? "";

    rt.unobserve(el);
    expect(el.classList.contains(HALO_CLASS)).toBe(false);
    expect(el.hasAttribute(HALO_ID_ATTR)).toBe(false);
    expect(document.getElementById(STYLE_ELEMENT_ID)?.textContent).not.toContain(`"${key}"`);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    el.classList.add("alt");
    el.dispatchEvent(transitionEnd("color"));
    await flush();
    clock.advance(1);
    expect(refresh).not.toHaveBeenCalled();

    rt.destroy();
    expect(other.hasAttribute(HALO_ID_ATTR)).toBe(false);
    expect(other.classList.contains(HALO_CLASS)).toBe(false);
    other.classList.add("alt");
    other.dispatchEvent(transitionEnd("background-color"));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });
});

describe("W75: the halo on W74's fail-safe paths (README Review Focus 1 for the halo)", () => {
  it("given_liquid_text_on_under_webgpu_when_the_device_is_lost_then_liquid_text_goes_and_the_halo_applies_from_the_next_frame_under_canvas2d", async () => {
    authorStyles();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const moving = movingBackend();
    const { rt, clock } = await start("webgpu", moving);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1); // W74 review (I1): the first render uploads the atlas page ...
    await flush(); // ... which is confirmed once its error scope resolves; only then is textReady true
    moving.setRestAlpha(id, 0.4);
    clock.advance(1);
    expect([el.classList.contains(TEXT_CLASS), el.classList.contains(HALO_CLASS)], "webgpu: liquid text, no halo").toEqual([true, false]);
    gpu!.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    await flush();
    clock.advance(1);
    expect([el.classList.contains(TEXT_CLASS), el.classList.contains(HALO_CLASS)], "canvas2d after the rebuild: halo, no liquid text").toEqual([false, true]);
    moving.setRestAlpha(id, null);
    clock.advance(1);
    expect(el.classList.contains(HALO_CLASS), "at rest").toBe(false);
    expect(warn).toHaveBeenCalledTimes(1); // the W72 device-lost warning only
  });

  it("given_the_halo_on_when_a_frame_throws_or_the_canvas2d_rebuild_after_a_lost_device_fails_then_this_instance_withdraws_every_halo", async () => {
    authorStyles();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // (a) Canvas2D, a frame that throws: the instance stops and leaves no halo behind.
    const a = await start("canvas2d");
    const el = button("A");
    const ia = a.rt.observe(el);
    await flush();
    a.moving.setRestAlpha(ia, 0.5);
    a.clock.advance(1);
    expect(el.classList.contains(HALO_CLASS)).toBe(true);
    vi.spyOn(a.moving.backend.cores[0]!, "tick").mockImplementation(() => {
      throw new Error("boom");
    });
    a.clock.advance(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(el.classList.contains(HALO_CLASS), "a failed frame withdraws the halo").toBe(false);

    // (b) WebGPU, device lost, the Canvas2D rebuild is in flight (the halo already applies), then fails.
    const b = await start("webgpu");
    const other = button("B");
    const ib = b.rt.observe(other);
    await flush();
    b.moving.setRestAlpha(ib, 0.5);
    b.clock.advance(1);
    let failInit: (err: Error) => void = () => {};
    vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockImplementation(
      () => new Promise((_resolve, reject) => {
        failInit = reject;
      }),
    );
    gpu!.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(b.rt.activeRenderer).toBe("canvas2d"));
    b.clock.advance(1); // renderer null while the rebuild is in flight; the halo rule applies already
    expect(other.classList.contains(HALO_CLASS)).toBe(true);
    failInit(new Error("2d gone"));
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(String(error.mock.calls[1]![0])).toMatch(/Canvas2D rebuild after a lost WebGPU device failed/);
    expect(other.classList.contains(HALO_CLASS), "a failed rebuild withdraws the halo").toBe(false);
  });
});

// ---- W75 amendment B (D75-1/D75-2 AMENDED 2026-10-10, saga dec_b2499bfc) and ward-review minors ----

/** A stand-in for a running CSS transition as `el.getAnimations()` returns it (jsdom has no getAnimations). */
function runningAnimation(): Animation {
  return { playState: "running", pending: false } as unknown as Animation;
}

/** Stubs `el.getAnimations` on the instance; returns a switch for "an author transition is running". */
function stubAnimations(el: HTMLElement): { set(running: boolean): void } {
  let running = false;
  Object.defineProperty(el, "getAnimations", {
    configurable: true,
    value: () => (running ? [runningAnimation()] : []),
  });
  return { set: (r) => { running = r; } };
}

describe("W75 amendment B: no colour re-read while the element animates (D75-2 B)", () => {
  it("given_a_running_author_transition_when_an_own_class_change_arrives_then_no_re_read_and_no_inline_style_while_it_runs_and_exactly_one_re_read_the_frame_after_it_ends_B1", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const frames = captureFrames(FluidCanvas2DRenderer.prototype);
    const anim = stubAnimations(el);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    const styleWrites = new MutationObserver(() => {});
    styleWrites.observe(el, { attributes: true, attributeFilter: ["style"] });

    anim.set(true); // e.g. `.alt { transform: scale(.95) }` with a transform transition, now running
    el.classList.add("alt");
    await flush();
    for (let f = 0; f < 5; f++) {
      clock.advance(1);
      await flush();
    }
    expect(refresh, "D75-2 B: the re-read waits while el.getAnimations() has a running animation").not.toHaveBeenCalled();
    expect(styleWrites.takeRecords(), "no inline `transition: none` ever touches the running transition").toHaveLength(0);
    expect(el.getAttribute("style")).toBeNull();
    expect(frames.at(-1)?.paints[id]?.background, "the liquid keeps the old colour meanwhile").toEqual([47, 111, 222, 1]);

    anim.set(false); // the transition ended
    clock.advance(1);
    expect(refresh, "the frame after it ends re-reads once").toHaveBeenCalledTimes(1);
    expect(frames.at(-1)?.paints[id]?.background).toEqual([200, 30, 30, 1]);
    expect(frames.at(-1)?.paints[id]?.text).toEqual([255, 230, 0, 1]);
    for (let f = 0; f < 3; f++) {
      await flush();
      clock.advance(1);
    }
    expect(refresh, "and only once").toHaveBeenCalledTimes(1);
    styleWrites.disconnect();
  });

  it("given_a_running_animation_when_transitionend_for_color_arrives_then_the_re_read_also_waits_until_it_ends_B1", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    rt.observe(el);
    await flush();
    clock.advance(1);
    const anim = stubAnimations(el);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    anim.set(true); // a colour transition ended, but a transform transition still runs
    el.dispatchEvent(transitionEnd("color"));
    clock.advance(1);
    clock.advance(1);
    expect(refresh).not.toHaveBeenCalled();
    anim.set(false);
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("W75 amendment B: only the element's own class/style re-reads colours (D75-2 B)", () => {
  it("given_a_descendant_class_change_when_the_next_frame_runs_then_no_colour_snapshot_and_exactly_one_text_invalidation_B2", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    const icon = el.appendChild(document.createElement("span"));
    rt.observe(el);
    await flush();
    clock.advance(1);
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    const before = rt.textInvalidations;
    icon.className = "spin"; // a JS-animated icon, a progress bar's style.width, ...
    icon.style.width = "40%";
    await flush();
    clock.advance(1);
    expect(refresh, "a descendant cannot change the element's own background or colour").not.toHaveBeenCalled();
    expect(rt.textInvalidations - before, "the atlas entry is re-rendered once").toBe(1);
    clock.advance(1);
    expect(rt.textInvalidations - before).toBe(1);
  });

  it("given_an_own_class_change_that_leaves_the_colours_unchanged_when_the_next_frame_runs_then_the_liquiddom_styles_sheet_is_not_rewritten_B2", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const el = button();
    rt.observe(el);
    await flush();
    clock.advance(1);
    const sheet = document.getElementById(STYLE_ELEMENT_ID);
    expect(sheet).not.toBeNull();
    const text = sheet!.textContent;
    const writes = new MutationObserver(() => {});
    writes.observe(sheet!, { childList: true, characterData: true, subtree: true });
    const refresh = vi.spyOn(ElementRegistry.prototype, "refresh");
    el.classList.add("is-busy"); // no rule changes its colours
    await flush();
    clock.advance(1);
    expect(refresh, "an own class change is re-read").toHaveBeenCalledTimes(1);
    expect(writes.takeRecords(), "D75-2 B: the halo rule is rewritten only when the background changed").toHaveLength(0);
    expect(sheet!.textContent).toBe(text);

    el.classList.add("alt"); // the background changes: now the rule is rewritten
    await flush();
    clock.advance(1);
    expect(writes.takeRecords().length).toBeGreaterThan(0);
    expect(sheet!.textContent).toContain("rgba(200, 30, 30, 1)");
    writes.disconnect();
  });
});

describe("W75 amendment B: at most one atlas upload in flight (D75-1 B)", () => {
  it("given_text_changes_on_consecutive_frames_before_the_staged_upload_is_confirmed_when_frames_run_then_one_build_and_upload_until_the_confirmation_then_exactly_one_more_and_liquid_text_returns_B3", async () => {
    authorStyles();
    const moving = movingBackend();
    const { rt, clock, atlas } = await start("webgpu", moving);
    const frames = captureFrames(WebGPURenderer.prototype);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1); // W74 review (I1): the first render uploads the atlas page ...
    await flush(); // ... confirmed once its error scope resolves
    moving.setRestAlpha(id, 0.4);
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    const built = atlas.canvases.length;
    const uploads = gpu!.calls.externalCopies.length;
    const version = frames.at(-1)?.textAtlas?.version ?? 0;

    (el.firstChild as Text).data = "One";
    clock.advance(1); // rebuild + staged upload; its error scope has not resolved yet
    expect(atlas.canvases.length - built).toBe(1);
    expect(gpu!.calls.externalCopies.length - uploads).toBe(1);
    (el.firstChild as Text).data = "Two";
    clock.advance(1); // no microtask in between: the staged page is still unconfirmed
    (el.firstChild as Text).data = "Three";
    clock.advance(1);
    expect(atlas.canvases.length - built, "D75-1 B: a new rebuild waits while an upload is in flight").toBe(1);
    expect(gpu!.calls.externalCopies.length - uploads, "one upload in flight").toBe(1);
    expect(frames.at(-1)?.textAtlas?.version).toBe(version + 1);
    expect(el.classList.contains(TEXT_CLASS), "the DOM text shows while the new text waits").toBe(false);

    await flush(); // the staged upload is confirmed
    clock.advance(1); // the waiting rebuild runs now, with the newest text
    expect(atlas.canvases.length - built, "exactly one more build after the confirmation").toBe(2);
    expect(gpu!.calls.externalCopies.length - uploads, "exactly one more upload").toBe(2);
    expect(atlas.fills().map((f) => f.text)).toEqual(["Three"]);
    expect(el.classList.contains(TEXT_CLASS), "the confirmed page is 'One', not the current text").toBe(false);
    clock.advance(1);
    expect(atlas.canvases.length - built, "nothing else is pending").toBe(2);

    await flush(); // the second upload is confirmed
    clock.advance(1);
    expect(el.classList.contains(TEXT_CLASS), "liquid-text returns with the current text").toBe(true);
    expect(atlas.canvases.length - built).toBe(2);
    expect(gpu!.calls.externalCopies.length - uploads).toBe(2);
  });
});

describe("W75 ward-review minors (M3, M4)", () => {
  it("given_unobserve_and_observe_of_the_same_element_when_the_next_frame_runs_then_its_paint_owner_token_is_renewed_M3", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const frames = captureFrames(FluidCanvas2DRenderer.prototype);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const owner = frames.at(-1)?.paints[id]?.owner;
    expect(owner).toBeDefined();
    rt.unobserve(el);
    const again = rt.observe(el); // same task: same slot, one redistribute
    await flush();
    clock.advance(1);
    expect(again).toBe(id);
    expect(frames.at(-1)?.paints[again]?.owner, "a confirmed page's record for the old observation must not match").not.toBe(owner);
  });

  it("given_a_detached_element_when_refresh_runs_manually_or_automatically_then_its_previous_colours_and_halo_rule_are_kept_and_re_read_after_re_attachment_M4", async () => {
    authorStyles();
    const { rt, clock } = await start();
    const frames = captureFrames(FluidCanvas2DRenderer.prototype);
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    const key = el.getAttribute(HALO_ID_ATTR) ?? "";
    const ruleOf = (): string =>
      (document.getElementById(STYLE_ELEMENT_ID)?.textContent ?? "").split("\n").find((l) => l.includes(`"${key}"`)) ?? "";
    expect(ruleOf()).toContain("rgba(47, 111, 222, 1)");

    el.remove();
    el.classList.add("alt"); // an automatic refresh is due ...
    rt.refresh(el); // ... and a manual one
    await flush();
    clock.advance(1);
    clock.advance(1);
    expect(el.isConnected).toBe(false);
    expect(frames.at(-1)?.paints[id]?.background, "no fallback colour for a detached element").toEqual([47, 111, 222, 1]);
    expect(frames.at(-1)?.paints[id]?.text).toEqual([255, 255, 255, 1]);
    expect(ruleOf(), "the halo rule keeps its colour").toContain("rgba(47, 111, 222, 1)");

    document.body.appendChild(el); // re-attached: the pending re-read runs on the next frame
    clock.advance(1);
    expect(frames.at(-1)?.paints[id]?.background).toEqual([200, 30, 30, 1]);
    expect(ruleOf()).toContain("rgba(200, 30, 30, 1)");
  });
});
