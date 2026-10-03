/** W64: CSS colour parsing and the colour snapshot (spec §3 "Colour"). */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LIQUID_COLOR, parseCssColor, snapshotColors } from "../src/color";

afterEach(() => {
  document.body.replaceChildren();
});

describe("W64 colour", () => {
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

  it("given_transparent_background_when_snapshotted_then_default_liquid_color", () => {
    const el = document.createElement("div");
    el.style.backgroundColor = "transparent";
    document.body.appendChild(el);
    expect(snapshotColors(el).background).toEqual(DEFAULT_LIQUID_COLOR);
  });
});
