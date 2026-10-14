/**
 * @vitest-environment jsdom
 * W82 (D82-1, D82-2, D82-3): the canvas under the page through the facade (test backend, fake
 * canvas). jsdom ignores `@layer` (stylesheet.test.ts), so these tests check what liquiddom writes:
 * the canvas's inline z-index, the warnings and the `data-liquid-stack` attribute the D7 rules key on.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { LiquidDOM } from "../src/index";
import { CONTAINER_STACKING_WARNING, OPAQUE_BACKGROUND_WARNING } from "../src/stacking";
import { CANVAS_CLASS, ELEMENT_CLASS, STACK_ATTR } from "../src/stylesheet";
import { freshBackend, instanceTracker, mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";

const tracker = instanceTracker();
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  tracker.destroyAll();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  vi.restoreAllMocks();
});

async function create(extra: Parameters<typeof LiquidDOM.create>[0] = {}) {
  return tracker.track(
    await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 8, renderer: "canvas2d", ...extra }),
  );
}

function button(parent: HTMLElement = document.body): HTMLElement {
  const el = parent.appendChild(document.createElement("button"));
  mockRect(el, 10, 10, 120, 40);
  return el;
}

/** liquiddom's warnings so far (the first argument of each console.warn that starts with "[liquiddom]"). */
const warnings = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith("[liquiddom]"));
const canvases = (): HTMLCanvasElement[] => Array.from(document.querySelectorAll<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`));

describe("W82 the canvas under the page (D82-1 … D82-3)", () => {
  it("given_body_mode_without_an_opaque_page_when_created_and_observing_then_the_canvas_is_at_z_index_minus_1_nothing_warns_and_no_element_gets_data_liquid_stack", async () => {
    document.body.style.backgroundColor = "rgb(244, 246, 251)"; // propagates to the root: fine
    const inst = await create();
    const el = button();
    const positioned = button();
    positioned.style.position = "relative";
    inst.observe(el);
    inst.observe(positioned);
    expect(canvases()[0]!.style.zIndex).toBe("-1");
    expect(warnings()).toEqual([]);
    expect(el.classList.contains(ELEMENT_CLASS)).toBe(true);
    expect(el.hasAttribute(STACK_ATTR), "D82-3: no D7 rule at z-index -1").toBe(false);
    expect(positioned.hasAttribute(STACK_ATTR)).toBe(false);
  });

  it("given_opaque_html_and_body_when_created_then_one_console_warn_names_body_the_canvas_is_at_z_index_0_and_every_observed_element_is_stacked_D7", async () => {
    document.documentElement.style.backgroundColor = "rgb(244, 246, 251)";
    document.body.style.backgroundColor = "rgb(244, 246, 251)";
    const inst = await create();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]!.startsWith(`${OPAQUE_BACKGROUND_WARNING} <body>.`)).toBe(true);
    expect(canvases()[0]!.style.zIndex).toBe("0");
    const a = button();
    const b = button();
    b.style.position = "absolute";
    inst.observe(a);
    inst.observe(b);
    expect(a.getAttribute(STACK_ATTR)).toBe("relative");
    expect(b.getAttribute(STACK_ATTR)).toBe("z");
    expect(warnings(), "one warning per instance").toHaveLength(1);
  });

  it("given_an_opaque_wrapper_when_an_element_inside_it_is_observed_then_one_warn_names_it_the_canvas_drops_to_z_index_0_every_observed_element_is_stacked_and_the_fallback_is_one_way", async () => {
    const inst = await create();
    const free = button();
    inst.observe(free);
    expect(canvases()[0]!.style.zIndex).toBe("-1");
    const wrap = document.body.appendChild(document.createElement("div"));
    wrap.className = "wrap";
    wrap.style.backgroundColor = "rgb(255, 255, 255)";
    const wrapped = button(wrap);
    inst.observe(wrapped);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("<div.wrap>");
    expect(canvases()[0]!.style.zIndex).toBe("0");
    expect(free.getAttribute(STACK_ATTR), "an element observed before the fallback is stacked too").toBe("relative");
    expect(wrapped.getAttribute(STACK_ATTR)).toBe("relative");
    inst.unobserve(wrapped);
    expect(wrapped.hasAttribute(STACK_ATTR)).toBe(false);
    expect(canvases()[0]!.style.zIndex, "one-way: the instance stays at z-index 0").toBe("0");
    const later = button();
    inst.observe(later);
    expect(later.getAttribute(STACK_ATTR)).toBe("relative");
    const other = document.body.appendChild(document.createElement("section"));
    other.style.backgroundColor = "rgb(0, 0, 0)";
    inst.observe(button(other));
    expect(warnings(), "no second warning").toHaveLength(1);
  });

  it("given_container_mode_when_the_container_is_or_is_not_a_stacking_context_then_minus_1_without_a_warning_or_one_container_warning_and_the_z_0_fallback", async () => {
    const iso = document.body.appendChild(document.createElement("div"));
    iso.style.position = "relative";
    iso.style.zIndex = "0";
    iso.style.backgroundColor = "rgb(255, 255, 255)"; // its own background paints below its z-index -1 canvas
    mockRect(iso, 0, 0, 400, 300);
    const a = await create({ container: iso });
    const inIso = button(iso);
    a.observe(inIso);
    expect(iso.querySelector<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`)!.style.zIndex).toBe("-1");
    expect(warnings()).toEqual([]);
    expect(inIso.hasAttribute(STACK_ATTR)).toBe(false);
    expect(iso.getAttribute("style"), "never restyled").toBe("position: relative; z-index: 0; background-color: rgb(255, 255, 255);");

    const rel = document.body.appendChild(document.createElement("div"));
    rel.style.position = "relative";
    mockRect(rel, 0, 300, 400, 300);
    const b = await create({ container: rel });
    expect(warnings()).toEqual([CONTAINER_STACKING_WARNING]);
    expect(rel.querySelector<HTMLCanvasElement>(`canvas.${CANVAS_CLASS}`)!.style.zIndex).toBe("0");
    const inRel = button(rel);
    b.observe(inRel);
    expect(inRel.getAttribute(STACK_ATTR)).toBe("relative");
    expect(rel.getAttribute("style")).toBe("position: relative;");
  });

  it("given_one_element_observed_by_an_instance_under_the_page_and_by_one_in_the_fallback_when_destroyed_in_either_order_then_data_liquid_stack_is_held_while_the_fallback_instance_observes_it_and_the_element_is_restored_exactly", async () => {
    const rel = document.body.appendChild(document.createElement("div"));
    rel.style.position = "relative"; // no stacking context: the container instance falls back
    mockRect(rel, 0, 0, 400, 300);
    const el = button(rel);
    el.className = "btn";
    const before = el.outerHTML;
    for (const order of ["fallback-first", "under-first"] as const) {
      const under = await create();
      const fallback = await create({ container: rel });
      under.observe(el);
      expect(el.hasAttribute(STACK_ATTR), "the instance under the page sets no stacking").toBe(false);
      fallback.observe(el);
      expect(el.getAttribute(STACK_ATTR), "held by the fallback instance").toBe("relative");
      if (order === "fallback-first") {
        fallback.destroy();
        expect(el.hasAttribute(STACK_ATTR), "released with the fallback instance's observation").toBe(false);
        expect(el.classList.contains(ELEMENT_CLASS), "still decorated for the other instance").toBe(true);
        under.destroy();
      } else {
        under.destroy();
        expect(el.getAttribute(STACK_ATTR)).toBe("relative");
        fallback.destroy();
      }
      expect(el.outerHTML, order).toBe(before);
    }
  });

  it("given_renderer_auto_without_webgpu_when_the_canvas_is_remounted_then_it_keeps_the_instance_z_index_under_the_page_and_in_the_fallback", async () => {
    await create({ renderer: "auto", silentFallback: true });
    expect(canvases()).toHaveLength(1);
    expect(canvases()[0]!.style.zIndex, "the remounted canvas stays under the page").toBe("-1");
    tracker.destroyAll();
    document.documentElement.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    await create({ renderer: "auto", silentFallback: true });
    expect(canvases()).toHaveLength(1);
    expect(canvases()[0]!.style.zIndex, "the remounted canvas keeps the fallback").toBe("0");
  });
});
