/**
 * @vitest-environment jsdom
 * W84 (D84-2, D84-5): `observe(el, { drag: false })`. The option is a boolean, validated and captured
 * once like `viscosity`; the layer's callout rule (`-webkit-touch-callout: none`) applies to every
 * observed element except those every observing instance opted out (`data-liquid-drag="off"`,
 * refcounted across instances, the last release restores the element exactly). jsdom ignores
 * `@layer` (stylesheet.test.ts), so the rule is checked as text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiquidDOM } from "../src/index";
import { validateElementOptions } from "../src/options";
import { DRAG_ATTR, ELEMENT_CLASS, LIQUID_CSS, holdDragMode, releaseDragMode } from "../src/stylesheet";
import { freshBackend, instanceTracker, mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  tracker.destroyAll();
  vi.restoreAllMocks();
});

async function create() {
  return tracker.track(await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 8, renderer: "canvas2d" }));
}

const SCREEN_OPEN = "@media screen and (forced-colors: none) {";
const CALLOUT_RULE = `.${ELEMENT_CLASS}:not([${DRAG_ATTR}="off"]) { -webkit-touch-callout: none !important; }`;

describe("W84: drag opt-out (D84-2, D84-5)", () => {
  // 18
  it("given_element_options_with_drag_when_validated_then_booleans_pass_anything_else_throws_a_TypeError_naming_drag_and_an_unknown_key_lists_drag", () => {
    for (const ok of [{ drag: true }, { drag: false }, { drag: undefined }, { viscosity: 0.2, recovery: 1, drag: false }]) {
      expect(() => validateElementOptions(ok), JSON.stringify(ok)).not.toThrow();
    }
    for (const bad of [{ drag: "no" }, { drag: 0 }, { drag: 1 }, { drag: null }]) {
      expect(() => validateElementOptions(bad), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => validateElementOptions(bad)).toThrow(/drag must be a boolean/);
    }
    expect(() => validateElementOptions({ grab: true })).toThrow(/allowed: viscosity, recovery, drag/);
  });

  // 19
  it("given_css_text_when_read_then_the_callout_rule_keys_on_observed_elements_not_opted_out_inside_the_screen_block_only", () => {
    expect(DRAG_ATTR).toBe("data-liquid-drag");
    const at = LIQUID_CSS.indexOf(SCREEN_OPEN);
    const rest = LIQUID_CSS.slice(at + SCREEN_OPEN.length);
    const end = rest.indexOf("\n  }");
    expect(rest.slice(0, end)).toContain(CALLOUT_RULE);
    expect(LIQUID_CSS.slice(0, at) + rest.slice(end), "print and forced colours: the author's own behaviour").not.toMatch(/touch-callout/);
  });

  // 20
  it("given_holdDragMode_from_two_observers_when_one_drags_and_one_opts_out_then_data_liquid_drag_is_off_only_while_every_holder_opted_out_and_the_last_release_restores_it", () => {
    const el = document.createElement("div");
    el.setAttribute(DRAG_ATTR, "author");
    holdDragMode(el, false);
    expect(el.getAttribute(DRAG_ATTR)).toBe("off");
    holdDragMode(el, true);
    expect(el.getAttribute(DRAG_ATTR), "one observer drags it: the callout stays suppressed").toBe("author");
    releaseDragMode(el, true);
    expect(el.getAttribute(DRAG_ATTR)).toBe("off");
    releaseDragMode(el, false);
    expect(el.getAttribute(DRAG_ATTR), "restored").toBe("author");
    releaseDragMode(el, false); // unbalanced: a no-op
    expect(el.getAttribute(DRAG_ATTR)).toBe("author");
    const bare = document.createElement("div");
    holdDragMode(bare, true);
    expect(bare.hasAttribute(DRAG_ATTR), "a draggable element gets no attribute").toBe(false);
    releaseDragMode(bare, true);
    expect(bare.outerHTML).toBe("<div></div>");
  });

  // 21
  it("given_two_instances_observing_one_element_one_with_drag_false_when_destroyed_in_either_order_then_data_liquid_drag_is_off_only_while_no_instance_drags_it_and_the_element_is_restored_exactly", async () => {
    const el = document.body.appendChild(document.createElement("button"));
    el.className = "btn";
    mockRect(el, 10, 10, 120, 40);
    const before = el.outerHTML;
    for (const order of ["opted-out-first", "draggable-first"] as const) {
      const off = await create();
      const on = await create();
      expect(() => off.observe(el, { drag: "no" as never }), "validated like viscosity").toThrow(/drag must be a boolean/);
      off.observe(el, { drag: false });
      expect(el.getAttribute(DRAG_ATTR)).toBe("off");
      on.observe(el);
      expect(el.hasAttribute(DRAG_ATTR), "the other instance drags it").toBe(false);
      if (order === "opted-out-first") {
        off.destroy();
        expect(el.hasAttribute(DRAG_ATTR)).toBe(false);
        on.destroy();
      } else {
        on.destroy();
        expect(el.getAttribute(DRAG_ATTR), "only the opted-out instance is left").toBe("off");
        off.destroy();
      }
      expect(el.outerHTML, order).toBe(before);
    }
  });
});
