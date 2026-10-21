/**
 * @vitest-environment jsdom
 * W66 T2: injected stylesheet, stacking, canvas mount, decoration round-trip,
 * colour snapshot ordering (D66-3, D66-15).
 *
 * jsdom ignores `@layer` (verified 2026-10-03), so behavioural colour tests add
 * a test-local UNLAYERED rule that emulates what the layered `!important` rule
 * does in a real browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM } from "../src/index";
import {
  TEXT_CLASS, addTextClass, removeTextClass, AWAY_CLASS,
  HALO_CLASS, HALO_ID_ATTR, HALO_BLUR_PX, haloRule, acquireHaloRule, updateHaloRule, releaseHaloRule, addHaloClass, removeHaloClass,
  CANVAS_CLASS, ELEMENT_CLASS, LIQUID_CSS, STACK_ATTR, STYLE_ELEMENT_ID,
  acquireLiquidStyles, mountLiquidCanvas, remountLiquidCanvas, stackingFor,
  CANVAS_Z_FALLBACK, CANVAS_Z_UNDER, holdStacking, releaseStacking,
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

  // W74 red: approved-test change (D74-6: the text rule hides descendants via -webkit-text-fill-color)
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
    expect(screen).toContain(
      ".liquid-text, .liquid-text * { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }",
    );
    // `color` stays: the atlas reads it and currentColor icons keep it (D74-6).
    expect(screen).not.toMatch(/(?<![-\w])color: transparent/);
    // Nothing paint-, stacking- or text-related outside the screen block.
    const outside = LIQUID_CSS.slice(0, at) + rest.slice(end);
    expect(outside).not.toMatch(/\.liquid-element|\.liquid-text/);
    const hideAt = LIQUID_CSS.indexOf("@media print, (forced-colors: active) {");
    expect(hideAt).toBeGreaterThan(0);
    expect(LIQUID_CSS.slice(hideAt)).toMatch(/canvas\.liquid-canvas \{ display: none !important; \}/);
  });

  it("given_css_text_when_read_then_liquid_away_hides_glyphs_with_the_liquid_text_declarations_inside_the_screen_block_and_beats_a_halo_W78", () => {
    // W78 (D78-1): Canvas2D hides the dragged element's DOM glyphs; never `color`, never in print or forced colors.
    expect(AWAY_CLASS).toBe("liquid-away");
    const screenOpen = "@media screen and (forced-colors: none) {";
    const at = LIQUID_CSS.indexOf(screenOpen);
    const rest = LIQUID_CSS.slice(at + screenOpen.length);
    const end = rest.indexOf("\n  }");
    const screen = rest.slice(0, end);
    expect(screen).toContain(
      ".liquid-away, .liquid-away * { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }",
    );
    // Another Canvas2D instance's halo (0,2,0) must not draw around glyphs liquid-away hides.
    expect(screen).toContain(
      ".liquid-away.liquid-halo[data-liquid-id], .liquid-away .liquid-halo[data-liquid-id] { text-shadow: none !important; }",
    );
    expect(LIQUID_CSS.slice(0, at) + rest.slice(end), "print and forced colors never hide the label").not.toMatch(/liquid-away/);
  });

  it("given_two_holders_when_addTextClass_twice_and_removeTextClass_once_then_the_class_stays_until_the_last_release_and_a_pre_existing_class_is_kept", () => {
    const el = document.createElement("p");
    el.className = "lead";
    document.body.appendChild(el);
    addTextClass(el);
    addTextClass(el);
    expect(el.className).toBe(`lead ${TEXT_CLASS}`);
    removeTextClass(el);
    expect(el.classList.contains(TEXT_CLASS)).toBe(true);
    removeTextClass(el);
    expect(el.className).toBe("lead");
    removeTextClass(el);
    expect(el.className, "an unbalanced release is a no-op").toBe("lead");
    const authored = document.createElement("p");
    authored.className = TEXT_CLASS;
    document.body.appendChild(authored);
    addTextClass(authored);
    removeTextClass(authored);
    expect(authored.className).toBe(TEXT_CLASS);
  });
});

describe("W66 T2: stacking (D66-3)", () => {
  // W82 red: approved-test change (D82-2, D82-3): only an instance in the z-index 0 fallback stacks
  // its elements (data-liquid-stack); opaque <html> and <body> backgrounds put every instance of this
  // block there (one console.warn each, silenced here).
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.documentElement.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
  });
  afterEach(() => {
    tracker.destroyAll();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    vi.restoreAllMocks();
  });

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
  // W82 red: approved-test change (D82-1): the canvas sits under the page at z-index -1 (was 0).
  it("given_canvas_when_mounted_then_aria_hidden_true_pointer_events_none_fixed_z_minus_1_last_in_body", async () => {
    document.body.appendChild(document.createElement("main"));
    await create();
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`)!;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(canvas.style.position).toBe("fixed");
    expect(canvas.style.zIndex).toBe("-1");
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
    // W82 red: approved-test change (D82-1): a fresh mount (and its remount) sits at z-index -1.
    expect(fresh.style.zIndex).toBe("-1");
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

describe("W75: the Canvas2D halo rule (D75-3)", () => {
  const BLUE = [47, 111, 222, 1] as const;
  const RED = [200, 30, 30, 1] as const;
  // A fresh document per test: other tests in this file observe elements of the shared
  // `document` through bare registries, and their halo claims would show up in its sheet.
  let doc: Document;
  let release: () => void;
  beforeEach(() => {
    doc = document.implementation.createHTMLDocument("w75");
    release = acquireLiquidStyles(doc);
  });
  afterEach(() => release());
  const sheetText = (): string => doc.getElementById(STYLE_ELEMENT_ID)?.textContent ?? "";
  const make = (tag: "button" | "div" | "span" = "button"): HTMLElement => doc.body.appendChild(doc.createElement(tag));

  it("given_an_acquired_halo_rule_when_the_sheet_is_read_then_one_layered_screen_only_rule_keyed_by_a_document_unique_data_liquid_id_D75_3", () => {
    expect(HALO_CLASS).toBe("liquid-halo");
    expect(HALO_ID_ATTR).toBe("data-liquid-id");
    expect(HALO_BLUR_PX).toEqual([1, 2, 4, 8]);
    expect(haloRule("h7", BLUE)).toBe(
      [
        "@layer liquiddom {",
        "  @media screen and (forced-colors: none) {",
        '    .liquid-halo[data-liquid-id="h7"] { text-shadow: 0 0 1px rgba(47, 111, 222, 1), 0 0 2px rgba(47, 111, 222, 1), 0 0 4px rgba(47, 111, 222, 1), 0 0 8px rgba(47, 111, 222, 1) !important; }',
        "  }",
        "}",
      ].join("\n"),
    );
    const el = make();
    acquireHaloRule(el, BLUE);
    const key = el.getAttribute(HALO_ID_ATTR) ?? "";
    expect(key).toMatch(/^h\d+$/);
    expect(sheetText()).toBe(`${LIQUID_CSS}\n${haloRule(key, BLUE)}`);
    releaseHaloRule(el);
  });

  it("given_two_elements_and_a_shared_element_when_claimed_and_released_then_keys_differ_rules_are_refcounted_and_the_last_release_restores_the_attribute", () => {
    const a = make();
    const b = make("div");
    b.setAttribute(HALO_ID_ATTR, "author");
    acquireHaloRule(a, BLUE);
    acquireHaloRule(a, BLUE); // a second instance observes the same element
    acquireHaloRule(b, RED);
    const ka = a.getAttribute(HALO_ID_ATTR) ?? "";
    const kb = b.getAttribute(HALO_ID_ATTR) ?? "";
    expect(ka).not.toBe(kb);
    expect(kb).not.toBe("author");
    releaseHaloRule(a);
    expect(a.getAttribute(HALO_ID_ATTR), "one claim left").toBe(ka);
    expect(sheetText()).toContain(`[data-liquid-id="${ka}"]`);
    releaseHaloRule(a);
    releaseHaloRule(a); // idempotent past zero
    expect(a.hasAttribute(HALO_ID_ATTR)).toBe(false);
    expect(sheetText()).not.toContain(`[data-liquid-id="${ka}"]`);
    releaseHaloRule(b);
    expect(b.getAttribute(HALO_ID_ATTR), "the author's value is restored").toBe("author");
  });

  it("given_updateHaloRule_when_the_background_changes_then_only_the_rule_text_changes_and_no_inline_style_is_written_D66_3", () => {
    const el = make();
    acquireHaloRule(el, BLUE);
    const key = el.getAttribute(HALO_ID_ATTR) ?? "";
    updateHaloRule(el, RED);
    expect(sheetText()).toBe(`${LIQUID_CSS}\n${haloRule(key, RED)}`);
    expect(el.getAttribute(HALO_ID_ATTR)).toBe(key);
    expect(el.getAttribute("style")).toBeNull();
    const stranger = make("span");
    updateHaloRule(stranger, RED); // not claimed: no-op
    expect(stranger.hasAttribute(HALO_ID_ATTR)).toBe(false);
    expect(sheetText()).toBe(`${LIQUID_CSS}\n${haloRule(key, RED)}`);
    releaseHaloRule(el);
  });

  it("given_every_halo_released_when_the_sheet_is_read_then_it_is_byte_identical_to_LIQUID_CSS", () => {
    const els = [make(), make(), make()];
    for (const el of els) acquireHaloRule(el, BLUE);
    expect(sheetText().length).toBeGreaterThan(LIQUID_CSS.length);
    for (const el of els) releaseHaloRule(el);
    expect(sheetText()).toBe(LIQUID_CSS);
  });

  it("given_two_halo_votes_when_one_is_removed_then_the_class_stays_until_the_last", () => {
    const el = make();
    el.className = "btn";
    addHaloClass(el);
    addHaloClass(el);
    expect(el.classList.contains(HALO_CLASS)).toBe(true);
    removeHaloClass(el);
    expect(el.classList.contains(HALO_CLASS)).toBe(true);
    removeHaloClass(el);
    expect(el.className).toBe("btn");
    removeHaloClass(el); // no vote left: no-op
    expect(el.className).toBe("btn");
    const own = make("div");
    own.className = HALO_CLASS; // the author's own class
    addHaloClass(own);
    removeHaloClass(own);
    expect(own.className, "the last release restores what the first hold found (W74's text-hold rule)").toBe(HALO_CLASS);
  });
});

describe("W75 amendment B and ward-review M7: halo sheet writes and liquid-text precedence", () => {
  const BLUE = [47, 111, 222, 1] as const;
  let doc: Document;
  let release: () => void;
  beforeEach(() => {
    doc = document.implementation.createHTMLDocument("w75-b");
    release = acquireLiquidStyles(doc);
  });
  afterEach(() => release());
  const sheetEl = (): HTMLElement => doc.getElementById(STYLE_ELEMENT_ID) as HTMLElement;

  /** Innermost `selector { declarations }` blocks of the sheet, in source order. */
  function rulesOf(css: string): Array<{ selector: string; body: string; order: number }> {
    const out: Array<{ selector: string; body: string; order: number }> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    let order = 0;
    while ((m = re.exec(css)) !== null) {
      for (const part of (m[1] ?? "").split(",")) out.push({ selector: part.trim(), body: m[2] ?? "", order: order++ });
    }
    return out;
  }

  /** [ids, classes + attributes + pseudo-classes, types]; `:not(x)` counts as its argument. */
  function specificity(selector: string): [number, number, number] {
    const s = selector.replace(/:not\(/g, " (").replace(/::[\w-]+/g, "");
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const cls = (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/\[[^\]]+\]/g) ?? []).length + (s.match(/:[\w-]+/g) ?? []).length;
    const types = (s.replace(/\[[^\]]+\]/g, "").match(/(^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
    return [ids, cls, types];
  }

  /** The winning `text-shadow` for `el` among the sheet's !important declarations (one layer, one origin). */
  function winningTextShadow(el: HTMLElement): string | null {
    let best: { spec: [number, number, number]; order: number; value: string } | null = null;
    for (const r of rulesOf(sheetEl().textContent ?? "")) {
      const decl = /text-shadow:\s*([^;]*?)\s*!important/.exec(r.body);
      if (!decl || r.selector === "" || r.selector.startsWith("@")) continue;
      let matches = false;
      try {
        matches = el.matches(r.selector);
      } catch {
        continue;
      }
      if (!matches) continue;
      const spec = specificity(r.selector);
      const beats =
        best === null ||
        spec[0] > best.spec[0] ||
        (spec[0] === best.spec[0] && (spec[1] > best.spec[1] || (spec[1] === best.spec[1] && (spec[2] > best.spec[2] || (spec[2] === best.spec[2] && r.order > best.order)))));
      if (beats) best = { spec, order: r.order, value: decl[1] ?? "" };
    }
    return best?.value ?? null;
  }

  it("given_liquid_text_and_a_halo_held_by_another_instance_on_one_element_when_the_cascade_resolves_then_no_text_shadow_around_the_transparent_glyphs_M7", () => {
    const el = doc.body.appendChild(doc.createElement("button"));
    acquireHaloRule(el, BLUE);
    addHaloClass(el); // a Canvas2D instance moves it ...
    expect(winningTextShadow(el), "sanity: the halo alone shows its shadow").toContain("rgba(47, 111, 222, 1)");
    addTextClass(el); // ... while a WebGPU instance draws its liquid text
    expect(winningTextShadow(el), "M7: liquid-text beats the halo rule").toBe("none");
    removeTextClass(el);
    expect(winningTextShadow(el)).toContain("rgba(47, 111, 222, 1)");
    removeHaloClass(el);
    releaseHaloRule(el);
  });

  it("given_updateHaloRule_with_the_same_background_when_called_then_the_sheet_is_not_rewritten_B2", () => {
    const el = doc.body.appendChild(doc.createElement("button"));
    acquireHaloRule(el, BLUE);
    const text = sheetEl().textContent;
    const writes = new MutationObserver(() => {});
    writes.observe(sheetEl(), { childList: true, characterData: true, subtree: true });
    updateHaloRule(el, [47, 111, 222, 1]); // equal RGBA, a different array
    expect(writes.takeRecords(), "D75-2 B: an unchanged background rewrites nothing").toHaveLength(0);
    expect(sheetEl().textContent).toBe(text);
    updateHaloRule(el, [200, 30, 30, 1]);
    expect(writes.takeRecords().length).toBeGreaterThan(0);
    writes.disconnect();
    releaseHaloRule(el);
  });
});

describe("W82: the canvas z-index and the stacking hold (D82-1, D82-3)", () => {
  it("given_a_fresh_mount_and_a_canvas_at_z_index_0_when_remounted_then_the_fresh_one_is_at_minus_1_and_a_remount_keeps_the_old_z_index", () => {
    const under = mountLiquidCanvas();
    expect(under.style.zIndex).toBe(CANVAS_Z_UNDER);
    expect(remountLiquidCanvas(under).style.zIndex).toBe("-1");
    const fallback = mountLiquidCanvas(undefined, CANVAS_Z_FALLBACK);
    expect(fallback.style.zIndex).toBe("0");
    const fresh = remountLiquidCanvas(fallback);
    expect(fresh.style.zIndex, "an 'auto' fallback or a device-loss rebuild keeps the instance's mode").toBe("0");
    expect(fresh.getAttribute("aria-hidden")).toBe("true");
    expect(fresh.style.pointerEvents).toBe("none");
  });

  it("given_holdStacking_twice_when_released_once_and_twice_then_data_liquid_stack_stays_until_the_last_release_and_the_author_value_is_restored", () => {
    const el = document.body.appendChild(document.createElement("button"));
    holdStacking(el);
    holdStacking(el); // a second fallback instance
    expect(el.getAttribute(STACK_ATTR), "static → relative (D66-3)").toBe("relative");
    releaseStacking(el);
    expect(el.getAttribute(STACK_ATTR), "one hold left").toBe("relative");
    releaseStacking(el);
    expect(el.hasAttribute(STACK_ATTR)).toBe(false);
    releaseStacking(el); // unbalanced: a no-op
    const positioned = document.body.appendChild(document.createElement("div"));
    positioned.style.position = "absolute";
    positioned.setAttribute(STACK_ATTR, "author");
    holdStacking(positioned);
    expect(positioned.getAttribute(STACK_ATTR)).toBe("z");
    releaseStacking(positioned);
    expect(positioned.getAttribute(STACK_ATTR), "the author's value is restored").toBe("author");
    const own = document.body.appendChild(document.createElement("div"));
    own.style.position = "relative";
    own.style.zIndex = "4";
    holdStacking(own);
    expect(own.hasAttribute(STACK_ATTR), "an explicit z-index is left alone (D66-3)").toBe(false);
    releaseStacking(own);
    expect(own.getAttribute("style"), "no inline style write").toBe("position: relative; z-index: 4;");
  });
});
