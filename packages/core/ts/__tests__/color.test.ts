/** W64: CSS colour parsing and the colour snapshot (spec §3 "Colour"). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIQUID_COLOR, parseCssColor, setColorProbe, snapshotColors } from "../src/color";

afterEach(() => {
  document.body.replaceChildren();
});

describe("W64 colour", () => {
  // W86 (D86-9): "garbage" would reach the default canvas probe, and jsdom prints "Not implemented" for it.
  beforeEach(() => setColorProbe(() => null));
  afterEach(() => setColorProbe(null));

  it("given_rgba_alpha_zero_or_transparent_when_parsed_then_null", () => {
    for (const raw of ["rgba(0, 0, 0, 0)", "transparent", "", "rgb(0 0 0 / 0)", "#0000", "garbage", "rgb(1, 2)"]) {
      expect(parseCssColor(raw), raw).toBeNull();
    }
    expect(parseCssColor(null)).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });

  it("given_rgb_or_rgba_when_parsed_then_rgba_tuple", () => {
    expect(parseCssColor("rgb(47, 111, 222)")).toEqual([47, 111, 222, 1]);
    expect(parseCssColor("rgba(255, 0, 0, 0.5)")).toEqual([255, 0, 0, 0.5]);
    expect(parseCssColor("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
    expect(parseCssColor("#2f6fde")).toEqual([47, 111, 222, 1]);
    expect(parseCssColor("#FFF")).toEqual([255, 255, 255, 1]);
  });

  it("given_element_with_background_when_snapshotted_then_background_and_text_parsed", () => {
    const el = document.createElement("button");
    el.style.backgroundColor = "rgb(47, 111, 222)";
    el.style.color = "rgb(255, 255, 255)";
    document.body.appendChild(el);
    expect(snapshotColors(el)).toEqual({ background: [47, 111, 222, 1], text: [255, 255, 255, 1] });
  });

  it("given_liquid_element_class_makes_colors_transparent_when_snapshotted_before_vs_after_then_only_before_keeps_the_authored_colors", () => {
    const style = document.createElement("style");
    style.textContent =
      ".card{background-color:rgb(47, 111, 222);color:rgb(255, 255, 255)}" +
      ".card.liquid-element{background:transparent;color:transparent}";
    document.head.appendChild(style);
    try {
      const el = document.createElement("div");
      el.className = "card";
      document.body.appendChild(el);
      const before = snapshotColors(el);
      expect(before).toEqual({ background: [47, 111, 222, 1], text: [255, 255, 255, 1] });
      el.classList.add("liquid-element");
      const after = snapshotColors(el);
      // After the class the authored colours are gone: this is why the snapshot must come first.
      expect(after.background).toEqual(DEFAULT_LIQUID_COLOR);
      expect(after.background).not.toEqual(before.background);
    } finally {
      style.remove();
    }
  });

  it("given_transparent_background_when_snapshotted_then_default_liquid_color", () => {
    const el = document.createElement("div");
    el.style.backgroundColor = "transparent";
    document.body.appendChild(el);
    expect(snapshotColors(el).background).toEqual(DEFAULT_LIQUID_COLOR);
  });
});

describe("W86: colours the parser cannot read (D86-9)", () => {
  afterEach(() => setColorProbe(null));

  it("given_a_colour_parseCssColor_cannot_read_when_parsed_then_the_probe_result_is_used", () => {
    const seen: string[] = [];
    setColorProbe((raw) => (seen.push(raw), raw === "oklch(0.82 0.15 205)" ? [0, 223, 242, 1] : null));
    expect(parseCssColor("oklch(0.82 0.15 205)")).toEqual([0, 223, 242, 1]);
    expect(seen).toEqual(["oklch(0.82 0.15 205)"]);
  });

  it("given_the_probe_rejects_the_string_when_parsed_then_null", () => {
    setColorProbe(() => null);
    expect(parseCssColor("garbage")).toBeNull();
    expect(parseCssColor("lab(50% 40 59)")).toBeNull();
  });

  it("given_the_same_unread_colour_twice_when_parsed_then_the_probe_runs_once", () => {
    let calls = 0;
    setColorProbe(() => (calls++, [10, 20, 30, 1]));
    expect(parseCssColor("color(display-p3 1 0 0)")).toEqual([10, 20, 30, 1]);
    expect(parseCssColor("color(display-p3 1 0 0)")).toEqual([10, 20, 30, 1]);
    expect(calls).toBe(1);
  });

  it("given_the_probe_returns_alpha_zero_when_parsed_then_null", () => {
    setColorProbe(() => [1, 2, 3, 0]);
    expect(parseCssColor("oklch(0.5 0.1 100 / 0)")).toBeNull();
  });

  it("given_an_oklch_background_when_snapshotted_then_the_liquid_takes_the_probed_colour", () => {
    setColorProbe((raw) => (raw.startsWith("oklch(0.72") ? [242, 105, 203, 1] : null));
    const el = document.createElement("button");
    document.body.appendChild(el);
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "oklch(0.72 0.2 340)",
      color: "rgb(0, 0, 0)",
    } as CSSStyleDeclaration);
    try {
      expect(snapshotColors(el).background).toEqual([242, 105, 203, 1]);
    } finally {
      spy.mockRestore();
      el.remove();
    }
  });

  it("given_rgb_or_hex_when_parsed_then_the_probe_is_never_called", () => {
    let calls = 0;
    setColorProbe(() => (calls++, [9, 9, 9, 1]));
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseCssColor("#0a0b0c")).toEqual([10, 11, 12, 1]);
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseCssColor("#0000")).toBeNull();
    expect(calls).toBe(0);
  });
});
