/**
 * @vitest-environment jsdom
 * W74 (D74-6, Review Focus 1): the liquid-text toggle — the rule, every gate that keeps or takes
 * the class off, refcounting across instances, and the fail-safe primitives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { clearTextClasses, releaseTextClass, syncTextClasses, type TextToggleArgs } from "../src/text-toggle";
import { TEXT_CLASS } from "../src/stylesheet";
import type { Renderer } from "../src/renderers/frame";
import { resetDom } from "./_facade-helpers";

afterEach(() => resetDom());

function renderer(ready: (id: number) => boolean): Renderer {
  return { init: async () => {}, render: () => {}, resize: () => {}, destroy: () => {}, textReady: ready };
}

function el(cls = "btn"): HTMLElement {
  const e = document.createElement("button");
  e.className = cls;
  document.body.appendChild(e);
  return e;
}

type Opts = Partial<Omit<TextToggleArgs, "elementOf" | "restAlpha">> & { els: HTMLElement[]; alphas: number[] };

function args(o: Opts): TextToggleArgs {
  return {
    ids: o.ids ?? o.els.map((_, i) => i),
    elementOf: (id) => o.els[id],
    restAlpha: (id) => o.alphas[id] ?? Number.NaN,
    renderer: o.renderer === undefined ? renderer(() => true) : o.renderer,
    activeRenderer: o.activeRenderer ?? "webgpu",
    reducedMotion: o.reducedMotion ?? false,
    held: o.held ?? new Set<HTMLElement>(),
  };
}

describe("W74 liquid-text toggle (D74-6)", () => {
  it("given_webgpu_a_ready_renderer_and_rest_alpha_below_1_when_synced_then_the_element_gets_liquid_text_once_and_loses_it_at_rest_alpha_1", () => {
    const a = el();
    const held = new Set<HTMLElement>();
    syncTextClasses(args({ els: [a], alphas: [0.4], held }));
    expect(a.className).toBe(`btn ${TEXT_CLASS}`);
    expect(held.has(a)).toBe(true);
    syncTextClasses(args({ els: [a], alphas: [0.4], held }));
    expect(a.className, "one hold per instance").toBe(`btn ${TEXT_CLASS}`);
    syncTextClasses(args({ els: [a], alphas: [1], held }));
    expect(a.className).toBe("btn");
    expect(held.size).toBe(0);
  });

  it("given_canvas2d_reduced_motion_no_textReady_or_nan_rest_alpha_when_synced_then_no_class_and_a_held_class_is_released_review_focus_1", () => {
    const bare: Renderer = { init: async () => {}, render: () => {}, resize: () => {}, destroy: () => {} };
    const cases: Array<[string, Partial<TextToggleArgs>, number]> = [
      ["canvas2d", { activeRenderer: "canvas2d" }, 0.4],
      ["reduced motion", { reducedMotion: true }, 0.4],
      ["atlas text not ready", { renderer: renderer(() => false) }, 0.4],
      ["a renderer without textReady (Canvas2D)", { renderer: bare }, 0.4],
      ["no renderer (device-lost rebuild in flight)", { renderer: null }, 0.4],
      ["restAlpha NaN", {}, Number.NaN],
    ];
    for (const [name, o, alpha] of cases) {
      const a = el();
      const held = new Set<HTMLElement>();
      syncTextClasses(args({ els: [a], alphas: [0.4], held }));
      expect(a.classList.contains(TEXT_CLASS), `${name}: precondition`).toBe(true);
      syncTextClasses(args({ ...o, els: [a], alphas: [alpha], held }));
      expect(a.classList.contains(TEXT_CLASS), name).toBe(false);
      expect(held.size, name).toBe(0);
      const fresh = el();
      syncTextClasses(args({ ...o, els: [fresh], alphas: [alpha] }));
      expect(fresh.className, `${name}: never set`).toBe("btn");
    }
  });

  it("given_two_instances_holding_one_element_when_one_releases_then_the_class_stays_until_both_release", () => {
    const a = el("btn");
    const h1 = new Set<HTMLElement>();
    const h2 = new Set<HTMLElement>();
    syncTextClasses(args({ els: [a], alphas: [0.4], held: h1 }));
    syncTextClasses(args({ els: [a], alphas: [0.4], held: h2 }));
    syncTextClasses(args({ els: [a], alphas: [1], held: h1 }));
    expect(a.classList.contains(TEXT_CLASS), "the other instance still draws its text").toBe(true);
    releaseTextClass(h2, a);
    expect(a.className).toBe("btn");
    const authored = el(`card ${TEXT_CLASS}`);
    const h3 = new Set<HTMLElement>();
    syncTextClasses(args({ els: [authored], alphas: [0.4], held: h3 }));
    clearTextClasses(h3);
    expect(authored.className, "an author's own liquid-text class survives").toBe(`card ${TEXT_CLASS}`);
  });

  it("given_held_elements_when_clearTextClasses_then_every_class_is_removed_and_held_is_empty", () => {
    const [a, b] = [el(), el()];
    const held = new Set<HTMLElement>();
    syncTextClasses(args({ els: [a, b], alphas: [0.2, 0.7], held }));
    expect(held.size).toBe(2);
    clearTextClasses(held);
    expect([a.className, b.className, held.size]).toEqual(["btn", "btn", 0]);
    clearTextClasses(held);
    expect([a.className, b.className]).toEqual(["btn", "btn"]);
  });

  it("given_a_held_element_that_is_no_longer_in_ids_or_released_when_synced_then_its_class_is_removed", () => {
    const [a, b] = [el(), el()];
    const held = new Set<HTMLElement>();
    syncTextClasses(args({ els: [a, b], alphas: [0.2, 0.2], held }));
    syncTextClasses(args({ els: [a, b], ids: [0], alphas: [0.2, 0.2], held }));
    expect(b.className, "no longer observed: released").toBe("btn");
    expect(a.classList.contains(TEXT_CLASS)).toBe(true);
    releaseTextClass(held, a);
    expect(a.className).toBe("btn");
    releaseTextClass(held, a);
    expect([a.className, held.size]).toEqual(["btn", 0]);
  });
});
