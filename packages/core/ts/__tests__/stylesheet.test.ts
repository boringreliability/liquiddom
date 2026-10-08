/**
 * @vitest-environment jsdom
 * W66 T2: injected stylesheet, stacking, canvas mount, decoration round-trip,
 * colour snapshot ordering (D66-3, D66-15).
 *
 * jsdom ignores `@layer` (verified 2026-10-03), so behavioural colour tests add
 * a test-local UNLAYERED rule that emulates what the layered `!important` rule
 * does in a real browser.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LiquidDOM } from "../src/index";
import {
  CANVAS_CLASS, ELEMENT_CLASS, LIQUID_CSS, STACK_ATTR, STYLE_ELEMENT_ID,
  acquireLiquidStyles, mountLiquidCanvas, remountLiquidCanvas, stackingFor,
} from "../src/stylesheet";
import { ElementRegistry } from "../src/element-registry";
import { FluidBridge } from "../src/fluid-bridge";
import { DEFAULT_LIQUID_COLOR } from "../src/color";
import { freshBackend, instanceTracker, mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => tracker.destroyAll());

async function create(extra: Parameters<typeof LiquidDOM.create>[0] = {}) {
  return tracker.track(
    await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 8, ...extra }),
  );
}

function makeRegistry() {
  const backend = freshBackend();
  // 7 args: particles, maxElements, worldWPx, worldHPx, areaHintPx2, maxElementHPx, seed.
  const core = new backend.FluidCore(1024, 4, 1280, 800, 0, 0, 1);
  const bridge = new FluidBridge(backend, core);
  const registry = new ElementRegistry(bridge, { coordOffset: () => ({ x: 0, y: 0 }), scheduleRedistribute: () => {} });
  return { registry, core };
}

function emulateBrowserLayer(btnBackground: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent =
    `.btn { background-color: ${btnBackground}; color: rgb(250, 240, 230); }` +
    ` .${ELEMENT_CLASS} { background-color: transparent !important; }`;
  document.head.appendChild(style);
  return style;
}

function recordOf(registry: ElementRegistry, el: HTMLElement) {
  const rec = [...registry.entries()].find((r) => r.el === el);
  if (!rec) throw new Error("element not in registry");
  return rec;
}

describe("W66 T2: injected stylesheet", () => {
  it("given_two_instances_when_created_then_one_style_element_per_document", async () => {
    await create();
    await create();
    const styles = document.querySelectorAll(`style#${STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(LIQUID_CSS);
    expect(styles[0]!.parentElement).toBe(document.head);
  });

  it("given_last_instance_destroyed_when_destroying_then_style_element_removed", async () => {
    const a = await create();
    const b = await create();
    a.destroy();
    expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
    b.destroy();
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });

  it("given_style_element_removed_externally_when_next_acquire_then_reinserted_and_refcount_kept", () => {
    const releaseA = acquireLiquidStyles(document);
    document.getElementById(STYLE_ELEMENT_ID)!.remove();
    const releaseB = acquireLiquidStyles(document);
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    releaseA();
    releaseA(); // idempotent per handle
    expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
    releaseB();
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });

  it("given_css_text_when_read_then_paint_and_stacking_scoped_to_screen_without_forced_colors_and_print_and_forced_colors_hide_canvas", () => {
    // D66-15 AMENDED (saga dec_d05913c9): scope instead of revert-layer.
    expect(LIQUID_CSS.startsWith("@layer liquiddom {")).toBe(true);
    expect(LIQUID_CSS).not.toMatch(/revert-layer/);
    const screenOpen = "@media screen and (forced-colors: none) {";
    const at = LIQUID_CSS.indexOf(screenOpen);
    expect(at).toBeGreaterThan(0);
    // The screen block, up to its closing brace at the block's indentation.
    const rest = LIQUID_CSS.slice(at + screenOpen.length);
    const end = rest.indexOf("\n  }");
    expect(end).toBeGreaterThan(0);
    const screen = rest.slice(0, end);
    expect(screen).toMatch(/\.liquid-element \{[^}]*background: transparent !important;[^}]*border-color: transparent !important;[^}]*box-shadow: none !important;/);
    expect(screen).toMatch(/\.liquid-element\[data-liquid-stack="relative"\] \{ position: relative !important; z-index: 1 !important; \}/);
    expect(screen).toMatch(/\.liquid-element\[data-liquid-stack="z"\] \{ z-index: 1 !important; \}/);
    expect(screen).toMatch(/\.liquid-text \{ color: transparent !important; \}/);
    // Nothing paint-, stacking- or text-related outside the screen block.
    const outside = LIQUID_CSS.slice(0, at) + rest.slice(end);
    expect(outside).not.toMatch(/\.liquid-element|\.liquid-text/);
    const hideAt = LIQUID_CSS.indexOf("@media print, (forced-colors: active) {");
    expect(hideAt).toBeGreaterThan(0);
    expect(LIQUID_CSS.slice(hideAt)).toMatch(/canvas\.liquid-canvas \{ display: none !important; \}/);
  });
});

describe("W66 T2: stacking (D66-3)", () => {
  it("given_stackingFor_table_when_evaluated_then_static_relative_auto_z_else_null", () => {
    expect(stackingFor("static", "auto")).toBe("relative");
    expect(stackingFor("", "")).toBe("relative");
    expect(stackingFor("absolute", "auto")).toBe("z");
    expect(stackingFor("relative", "")).toBe("z");
    expect(stackingFor("fixed", "3")).toBeNull();
    expect(stackingFor("sticky", "0")).toBeNull();
    expect(stackingFor("static", "3")).toBe("relative"); // z-index is inert on static (D66-3 "static → relative")
  });

  it("given_static_element_when_observed_then_class_and_stack_relative_z1", async () => {
    const inst = await create();
    const el = document.createElement("button");
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    inst.observe(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(el.getAttribute(STACK_ATTR)).toBe("relative");
    expect(el.getAttribute("style")).toBeNull(); // D66-3: no inline style writes
    expect(LIQUID_CSS).toContain(`.liquid-element[${STACK_ATTR}="relative"] { position: relative !important; z-index: 1 !important; }`);
  });

  it("given_positioned_element_with_z_auto_when_observed_then_only_z1", async () => {
    const inst = await create();
    const el = document.createElement("div");
    el.style.position = "absolute";
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    const styleBefore = el.getAttribute("style");
    inst.observe(el);
    expect(el.getAttribute(STACK_ATTR)).toBe("z");
    expect(el.getAttribute("style")).toBe(styleBefore); // D66-3: no inline style writes
    expect(LIQUID_CSS).toContain(`.liquid-element[${STACK_ATTR}="z"] { z-index: 1 !important; }`);
  });

  it("given_positioned_element_with_explicit_z_when_observed_then_stacking_untouched", async () => {
    const inst = await create();
    const el = document.createElement("div");
    el.style.position = "relative";
    el.style.zIndex = "5";
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    const styleBefore = el.getAttribute("style");
    inst.observe(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(el.hasAttribute(STACK_ATTR)).toBe(false);
    expect(el.getAttribute("style")).toBe(styleBefore); // D66-3: untouched, no inline writes
  });

  it("given_static_element_with_explicit_z_index_when_observed_then_relative_because_z_index_is_inert_on_static_and_no_inline_write", async () => {
    // D66-3 reads "static → relative": z-index has no effect on a static element, so the
    // element still needs position:relative to rise above the canvas. Pinned interpretation.
    const inst = await create();
    const el = document.createElement("div");
    el.style.zIndex = "3";
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    const styleBefore = el.getAttribute("style");
    inst.observe(el);
    expect(el.getAttribute(STACK_ATTR)).toBe("relative");
    expect(el.getAttribute("style")).toBe(styleBefore);
    inst.unobserve(el);
    expect(el.hasAttribute(STACK_ATTR)).toBe(false);
    expect(el.getAttribute("style")).toBe(styleBefore);
  });

  it("given_unobserve_when_called_then_element_class_and_attr_exactly_restored", async () => {
    const inst = await create();
    const bare = document.createElement("button");
    const classy = document.createElement("button");
    classy.className = "btn primary";
    const preset = document.createElement("div");
    preset.className = `${ELEMENT_CLASS} card`;
    preset.setAttribute(STACK_ATTR, "z");
    preset.style.position = "static";
    const els = [bare, classy, preset];
    for (const el of els) {
      mockRect(el, 0, 0, 80, 30);
      document.body.appendChild(el);
    }
    const before = els.map((el) => el.outerHTML);
    for (const el of els) inst.observe(el);
    expect(preset.getAttribute(STACK_ATTR)).toBe("relative");
    for (const el of els) inst.unobserve(el);
    expect(els.map((el) => el.outerHTML)).toEqual(before);
  });
});

describe("W66 T2: canvas mount", () => {
  it("given_canvas_when_mounted_then_aria_hidden_true_pointer_events_none_fixed_z0_last_in_body", async () => {
    document.body.appendChild(document.createElement("main"));
    await create();
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`)!;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(canvas.style.position).toBe("fixed");
    expect(canvas.style.zIndex).toBe("0");
    expect(document.body.lastElementChild).toBe(canvas);
  });

  it("given_container_mode_when_mounted_then_canvas_inside_container", async () => {
    const container = document.createElement("section");
    mockRect(container, 50, 60, 400, 300);
    document.body.appendChild(container);
    await create({ container });
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`)!;
    expect(canvas.parentElement).toBe(container);
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.style.zIndex).toBe("0");
  });
});

describe("W66 T2: colour snapshot and refresh", () => {
  it("given_element_with_background_when_observed_then_color_snapshotted_before_class", () => {
    emulateBrowserLayer("rgb(10, 20, 30)");
    const { registry } = makeRegistry();
    const el = document.createElement("button");
    el.className = "btn";
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    registry.observe(el);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(getComputedStyle(el).backgroundColor).toBe("rgba(0, 0, 0, 0)"); // the class is active…
    expect(recordOf(registry, el).background).toEqual([10, 20, 30, 1]); // …but the snapshot predates it
    expect(recordOf(registry, el).text).toEqual([250, 240, 230, 1]);
  });

  it("given_refresh_when_called_then_class_temporarily_removed_and_colors_reread", () => {
    const style = emulateBrowserLayer("rgb(10, 20, 30)");
    const { registry } = makeRegistry();
    const el = document.createElement("button");
    el.className = "btn";
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    registry.observe(el);
    style.textContent =
      ".btn { background-color: rgb(40, 50, 60); color: rgb(1, 2, 3); }" +
      ` .${ELEMENT_CLASS} { background-color: transparent !important; }`;
    registry.refresh(el);
    // Reading WITH the class would give transparent → DEFAULT_LIQUID_COLOR.
    expect(recordOf(registry, el).background).toEqual([40, 50, 60, 1]);
    expect(recordOf(registry, el).text).toEqual([1, 2, 3, 1]);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(() => registry.refresh(document.createElement("div"))).not.toThrow(); // unobserved → no-op
  });

  it("given_transparent_background_when_observed_then_default_liquid_color", () => {
    const { registry } = makeRegistry();
    const el = document.createElement("div");
    mockRect(el, 0, 0, 100, 40);
    document.body.appendChild(el);
    registry.observe(el);
    expect(recordOf(registry, el).background).toEqual(DEFAULT_LIQUID_COLOR);
  });
});

describe("W72: canvas remount (D72-1, D72-3)", () => {
  it("given_a_mounted_canvas_in_body_when_remounted_then_a_new_canvas_takes_its_place_with_identical_markup", () => {
    const before = document.body.appendChild(document.createElement("p"));
    const old = mountLiquidCanvas();
    const after = document.body.appendChild(document.createElement("p"));
    old.width = 640;
    const fresh = remountLiquidCanvas(old);
    expect(fresh).not.toBe(old);
    expect(old.isConnected).toBe(false);
    expect(fresh.previousSibling).toBe(before);
    expect(fresh.nextSibling).toBe(after);
    const reference = mountLiquidCanvas();
    expect(fresh.outerHTML).toBe(reference.outerHTML);
    expect(fresh.className).toBe(CANVAS_CLASS);
    expect(fresh.getAttribute("aria-hidden")).toBe("true");
    expect(fresh.style.position).toBe("fixed");
    expect(fresh.style.pointerEvents).toBe("none");
    expect(fresh.style.zIndex).toBe("0");
    expect(fresh.width).toBe(300); // backing-store size is the runtime's job (resize), not the remount's
  });

  it("given_container_mode_when_remounted_then_the_new_canvas_is_in_the_container_with_absolute_style", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const old = mountLiquidCanvas(container);
    const fresh = remountLiquidCanvas(old, container);
    expect(fresh.parentElement).toBe(container);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(fresh.style.position).toBe("absolute");
    expect(fresh.style.width).toBe("100%");
    expect(fresh.style.height).toBe("100%");
  });

  it("given_a_detached_old_canvas_when_remounted_then_the_new_canvas_is_mounted_like_mountLiquidCanvas", () => {
    const old = mountLiquidCanvas();
    old.remove();
    const tail = document.body.appendChild(document.createElement("p"));
    const fresh = remountLiquidCanvas(old);
    expect(fresh.isConnected).toBe(true);
    expect(fresh.previousSibling).toBe(tail); // appended last in body, as a fresh mount
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
  });
});
