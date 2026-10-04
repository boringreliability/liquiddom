/**
 * @vitest-environment jsdom
 * W66 T2: snapshotColorsWithout re-reads colours with the liquid class lifted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { snapshotColors, snapshotColorsWithout } from "../src/color";
import { ELEMENT_CLASS } from "../src/stylesheet";

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  const style = document.createElement("style");
  style.textContent = `.btn { background-color: rgb(9, 8, 7); } .${ELEMENT_CLASS} { background-color: transparent !important; }`;
  document.head.appendChild(style);
});

describe("W66: snapshotColorsWithout", () => {
  it("given_class_present_when_snapshotColorsWithout_then_reads_original_colour_and_restores_class", () => {
    const el = document.createElement("button");
    el.className = `btn ${ELEMENT_CLASS}`;
    document.body.appendChild(el);
    expect(snapshotColorsWithout(el, ELEMENT_CLASS).background).toEqual([9, 8, 7, 1]);
    expect(el.className).toBe(`btn ${ELEMENT_CLASS}`);
  });

  it("given_class_absent_when_snapshotColorsWithout_then_equals_snapshotColors_and_class_not_added", () => {
    const el = document.createElement("button");
    el.className = "btn";
    document.body.appendChild(el);
    expect(snapshotColorsWithout(el, ELEMENT_CLASS)).toEqual(snapshotColors(el));
    expect(el.className).toBe("btn");
  });
});
