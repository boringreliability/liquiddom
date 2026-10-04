/**
 * @vitest-environment jsdom
 * W66 T2: snapshotColorsWithout re-reads colours with the liquid class lifted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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

/** Records the element's style attribute / inline transition at the first getComputedStyle(el). */
function spyStyleDuringRead(el: HTMLElement): { readonly seen: { attr: string | null; transition: string } | null; restore(): void } {
  const real = window.getComputedStyle.bind(window);
  const box: { seen: { attr: string | null; transition: string } | null } = { seen: null };
  const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((e, p) => {
    if (e === el && box.seen === null) {
      box.seen = {
        attr: el.getAttribute("style"),
        transition: `${el.style.getPropertyValue("transition")}|${el.style.getPropertyPriority("transition")}`,
      };
    }
    return real(e, p);
  });
  return {
    get seen() {
      return box.seen;
    },
    restore: () => spy.mockRestore(),
  };
}

describe("W66 ward-fix I1: transition-safe snapshot leaves the style attribute untouched", () => {
  it("given_no_style_attribute_when_snapshotColorsWithout_then_transition_none_during_read_and_no_style_attribute_after", () => {
    const el = document.createElement("button");
    el.className = `btn ${ELEMENT_CLASS}`;
    document.body.appendChild(el);
    const probe = spyStyleDuringRead(el);
    try {
      expect(snapshotColorsWithout(el, ELEMENT_CLASS).background).toEqual([9, 8, 7, 1]);
    } finally {
      probe.restore();
    }
    expect(probe.seen?.transition).toBe("none|important");
    expect(el.hasAttribute("style")).toBe(false);
    expect(el.getAttribute("class")).toBe(`btn ${ELEMENT_CLASS}`);
  });

  it("given_existing_style_attribute_when_snapshotColorsWithout_then_style_attribute_is_byte_identical", () => {
    const el = document.createElement("button");
    el.className = `btn ${ELEMENT_CLASS}`;
    const original = "color:  red ;transition: background-color 2s;--x: 1";
    el.setAttribute("style", original);
    document.body.appendChild(el);
    const probe = spyStyleDuringRead(el);
    try {
      snapshotColorsWithout(el, ELEMENT_CLASS);
    } finally {
      probe.restore();
    }
    expect(probe.seen?.transition).toBe("none|important");
    expect(el.getAttribute("style")).toBe(original);
    expect(el.getAttribute("class")).toBe(`btn ${ELEMENT_CLASS}`);
  });
});
