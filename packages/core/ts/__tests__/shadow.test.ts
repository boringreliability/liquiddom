/**
 * @vitest-environment jsdom
 * W88 (D88-1 … D88-3): the box-shadow parser, the outer-layer cap, the snapshot that lifts
 * `liquid-shadow-away`, and the shared "liquid is away" rule. jsdom returns a box-shadow as
 * specified (not normalised), so the parser takes the parts in any order; jsdom ignores @layer,
 * so the snapshot test emulates the layered !important rule with an unlayered one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setColorProbe } from "../src/color";
import { Interaction } from "../src/fluid-layout";
import { hasOuterLayer, liquidAway, MAX_SHADOW_LAYERS, outerShadows, parseBoxShadow, snapshotShadow, type ShadowLayer } from "../src/shadow";
import { SHADOW_AWAY_CLASS } from "../src/stylesheet";

const layer = (o: Partial<ShadowLayer>): ShadowLayer => ({ color: [0, 0, 0, 1], dx: 0, dy: 0, blur: 0, spread: 0, inset: false, ...o });

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  setColorProbe(() => null); // W86: jsdom has no 2d canvas; a named colour stays unread
});
afterEach(() => {
  setColorProbe(null);
  vi.restoreAllMocks();
});

describe("W88: parseBoxShadow (D88-3)", () => {
  it("given_a_computed_value_with_two_layers_when_parsed_then_colour_offsets_blur_spread_and_inset_in_css_order", () => {
    expect(parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px, rgb(0, 255, 255) 0px 0px 12px 2px inset")).toEqual([
      layer({ color: [0, 0, 0, 0.4], dy: 8, blur: 20 }),
      layer({ color: [0, 255, 255, 1], blur: 12, spread: 2, inset: true }),
    ]);
  });

  it("given_none_empty_or_garbage_when_parsed_then_no_layers", () => {
    for (const raw of ["none", "", "  ", "foo", "rgb(0, 0, 0) 1px", "rgb(0, 0, 0) 1px 2px 3px 4px 5px", "rgb(0, 0, 0) 1px 2px -3px", "rgb(0, 0, 0) 1em 2em", "1px 2px 3px", "rgb(0, 0, 0) 2 3"]) {
      expect(parseBoxShadow(raw), JSON.stringify(raw)).toEqual([]);
    }
    expect(parseBoxShadow(null)).toEqual([]);
    expect(parseBoxShadow(undefined)).toEqual([]);
  });

  it("given_the_specified_form_with_lengths_first_unitless_zero_and_short_alpha_when_parsed_then_the_same_layer_as_the_computed_form", () => {
    const computed = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");
    expect(parseBoxShadow("0 8px 20px rgba(0,0,0,.4)")).toEqual(computed);
    expect(parseBoxShadow("inset 0 0 2px #ff0000")).toEqual([layer({ color: [255, 0, 0, 1], blur: 2, inset: true })]);
    expect(parseBoxShadow("2px 3px rgb(1, 2, 3)")).toEqual([layer({ color: [1, 2, 3, 1], dx: 2, dy: 3 })]);
  });

  it("given_an_oklch_layer_when_parsed_then_its_colour_comes_from_the_W86_colour_probe", () => {
    setColorProbe((raw) => (raw === "oklch(0.82 0.15 205 / 0.55)" ? [0, 223, 242, 0.55] : null));
    expect(parseBoxShadow("oklch(0.82 0.15 205 / 0.55) 0px 0px 28px 2px")).toEqual([layer({ color: [0, 223, 242, 0.55], blur: 28, spread: 2 })]);
  });

  it("given_a_transparent_or_unreadable_layer_among_others_when_parsed_then_only_that_layer_is_dropped", () => {
    expect(parseBoxShadow("rgba(0, 0, 0, 0) 0px 4px 8px 0px, rgb(9, 9, 9) 1px 1px 0px 0px, chartreuse 0px 0px 2px 0px")).toEqual([
      layer({ color: [9, 9, 9, 1], dx: 1, dy: 1 }),
    ]);
  });

  it("given_zero_blur_and_negative_spread_when_parsed_then_both_are_kept", () => {
    expect(parseBoxShadow("rgba(0, 0, 0, 0.3) 0px 4px 0px -6px")).toEqual([layer({ color: [0, 0, 0, 0.3], dy: 4, spread: -6 })]);
  });

  it("given_six_layers_with_two_inset_when_outerShadows_then_the_first_four_outer_layers_and_the_same_array_twice_D88_2", () => {
    const all = parseBoxShadow(
      "rgb(1, 0, 0) 0px 0px 1px 0px, rgb(2, 0, 0) 0px 0px 2px 0px inset, rgb(3, 0, 0) 0px 0px 3px 0px, rgb(4, 0, 0) 0px 0px 4px 0px, rgb(5, 0, 0) 0px 0px 5px 0px inset, rgb(6, 0, 0) 0px 0px 6px 0px, rgb(7, 0, 0) 0px 0px 7px 0px",
    );
    expect(MAX_SHADOW_LAYERS).toBe(4);
    const outer = outerShadows(all);
    expect(outer.map((l) => l.blur)).toEqual([1, 3, 4, 6]);
    expect(outerShadows(all), "memoised per array").toBe(outer);
    expect(hasOuterLayer(all)).toBe(true);
    expect(hasOuterLayer(parseBoxShadow("rgb(1, 1, 1) 0px 0px 2px 0px inset"))).toBe(false);
    expect(outerShadows(parseBoxShadow("rgb(1, 1, 1) 0px 0px 2px 0px inset"))).toEqual([]);
  });
});

describe("W88: snapshotShadow (D88-3)", () => {
  it("given_an_element_holding_liquid_shadow_away_when_snapshotted_then_the_author_shadow_is_read_and_class_and_style_are_restored_exactly", () => {
    const style = document.createElement("style");
    style.textContent = `.card { box-shadow: 0 8px 20px rgba(0,0,0,.4); } .${SHADOW_AWAY_CLASS} { box-shadow: none !important; }`;
    document.head.appendChild(style);
    const el = document.body.appendChild(document.createElement("div"));
    el.className = `card ${SHADOW_AWAY_CLASS}`;
    el.setAttribute("style", "--probe:  1 ;");
    expect(getComputedStyle(el).boxShadow, "the toggle class hides the author's shadow").toBe("none");
    expect(snapshotShadow(el)).toEqual([layer({ color: [0, 0, 0, 0.4], dy: 8, blur: 20 })]);
    expect(el.getAttribute("class")).toBe(`card ${SHADOW_AWAY_CLASS}`);
    expect(el.getAttribute("style")).toBe("--probe:  1 ;");
    const plain = document.body.appendChild(document.createElement("div"));
    expect(snapshotShadow(plain), "no box-shadow").toEqual([]);
    expect(plain.hasAttribute("style"), "no lift without the class").toBe(false);
  });

  it("given_currentColor_resolved_by_the_browser_when_snapshotted_then_the_layer_carries_the_text_colour_review_focus_5", () => {
    const el = document.body.appendChild(document.createElement("button"));
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ boxShadow: "rgb(200, 40, 120) 0px 0px 16px 0px", color: "rgb(200, 40, 120)" } as CSSStyleDeclaration);
    expect(snapshotShadow(el)).toEqual([layer({ color: [200, 40, 120, 1], blur: 16 })]);
  });
});

describe("W88: liquidAway (D88-1)", () => {
  it("given_restAlpha_and_interaction_when_asked_then_away_below_1_or_dragged_never_under_reduced_motion_and_nan_is_rest", () => {
    expect(liquidAway(false, 0.4, Interaction.IDLE)).toBe(true);
    expect(liquidAway(false, 1, Interaction.IDLE)).toBe(false);
    expect(liquidAway(false, 1, Interaction.DRAGGED), "dragged").toBe(true);
    expect(liquidAway(false, 1, Interaction.HOVER)).toBe(false);
    expect(liquidAway(false, Number.NaN, Interaction.IDLE), "NaN counts as rest").toBe(false);
    expect(liquidAway(true, 0.2, Interaction.DRAGGED), "reduced motion").toBe(false);
  });
});
