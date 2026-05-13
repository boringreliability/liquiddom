/**
 * @vitest-environment jsdom
 *
 * Ward 042: Border-Radius Aware Rest Shape — red phase tests.
 * Tests #9-#14 per ward-042.md spec.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { parseBorderRadius } from "../src/border-radius";
import { LiquidDOM } from "../src/index";
import { FLOATS_PER_ENTITY } from "../src/phantom-observer";

// ── Ward 042 §7: ControllableResizeObserver mock ──
// jsdom's ResizeObserver polyfill is a no-op (see liquiddom-api.test.ts:7-14).
// Test #14 needs a callback that actually fires. This mock captures the latest
// instance so tests can synthesize entries.
type Entry = { target: Element; contentRect: { width: number; height: number } };
let lastObserver: { trigger: (entries: Entry[]) => void } | null = null;

class ControllableResizeObserver {
  private cb: (entries: Entry[]) => void;
  constructor(cb: (entries: Entry[]) => void) {
    this.cb = cb;
    lastObserver = { trigger: (e) => this.cb(e) };
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
});

function cleanDOM() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // Reset shared mock state so tests #13 / #14 don't leak observer handles between
  // each other (M6).
  lastObserver = null;
}

describe("Ward 042: parseBorderRadius (pure)", () => {
  // ── Test #9: pixel and zero values (incl. 0% per spec §2, S1) ──
  it("parseBorderRadius_handles_pixel_values", () => {
    expect(parseBorderRadius("10px", 100, 50)).toBe(10);
    expect(parseBorderRadius("0px", 100, 50)).toBe(0);
    expect(parseBorderRadius("0", 100, 50)).toBe(0);
    expect(parseBorderRadius("0%", 100, 50)).toBe(0);
  });

  // ── Test #10: percent resolution against min(w, h) ──
  // Spec §2: % resolves against min(w,h) — no /2 clamping at the parser level
  // (Rust clamps to min(w,h)/2 at body construction per §3 step 1).
  // The spec's original "100% on 200×80 === 40" expected value was an
  // arithmetic error (100% of min(200,80) = 80, not 40). Corrected during
  // gold-phase implementation.
  it("parseBorderRadius_resolves_percent_against_min_dim", () => {
    expect(parseBorderRadius("50%", 100, 50)).toBe(25);
    expect(parseBorderRadius("100%", 200, 80)).toBe(80);
    expect(parseBorderRadius("50%", 200, 80)).toBe(40);
  });

  // ── Test #11: unparseable / fallback values (incl. negative clamp per spec §2, S2) ──
  it("parseBorderRadius_falls_back_for_unparseable", () => {
    expect(parseBorderRadius("", 100, 50)).toBe(0);
    expect(parseBorderRadius("normal", 100, 50)).toBe(0);
    expect(parseBorderRadius("auto", 100, 50)).toBe(0);
    expect(parseBorderRadius("banana", 100, 50)).toBe(0);
    expect(parseBorderRadius("calc(10px + 5%)", 100, 50)).toBe(0);
    expect(parseBorderRadius("-5px", 100, 50)).toBe(0);
    expect(parseBorderRadius("-10%", 100, 50)).toBe(0);
  });

  // ── Test #12: first-token semantics for mixed values ──
  it("parseBorderRadius_uses_first_token_for_mixed_values", () => {
    expect(parseBorderRadius("10px 20px", 100, 50)).toBe(10);
    expect(parseBorderRadius("10px / 5px", 100, 50)).toBe(10);
    expect(parseBorderRadius("10px 20px 30px 40px", 100, 50)).toBe(10);
  });
});

describe("Ward 042: observe writes border_radius_px to slot[8]", () => {
  beforeEach(cleanDOM);

  // ── Test #13: observe writes resolved border-radius to slot[8] ──
  it("observe_writes_resolved_border_radius_to_slot_8", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    const el = document.createElement("div");
    el.style.borderRadius = "12px";
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      top: 0,
      left: 0,
      right: 100,
      bottom: 50,
      toJSON: () => {},
    });
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    document.body.appendChild(el);

    // Document jsdom assumption (M5): setting `el.style.borderRadius` must
    // produce the same value via `getComputedStyle`. If a jsdom version
    // upgrade changes this, the next assertion fails first and points the
    // diagnostic here rather than at the W42 implementation.
    expect(window.getComputedStyle(el).borderRadius).toBe("12px");

    const id = instance.observe(el);
    const buf = instance.getBuffer()!;

    expect(buf[id * FLOATS_PER_ENTITY + 8]).toBe(12);

    instance.destroy();
  });

  // ── Test #14: ResizeObserver callback re-reads radius ──
  it("resize_re_reads_border_radius_via_resize_observer", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    const el = document.createElement("div");
    el.style.borderRadius = "50%";
    let rectW = 100;
    let rectH = 50;
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: rectW,
      height: rectH,
      top: 0,
      left: 0,
      right: rectW,
      bottom: rectH,
      toJSON: () => {},
    });
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    document.body.appendChild(el);

    const id = instance.observe(el);
    const buf = instance.getBuffer()!;

    // Initial: 50% of min(100, 50) = 25
    expect(buf[id * FLOATS_PER_ENTITY + 8]).toBe(25);

    // Synthesize a resize to 200×100
    rectW = 200;
    rectH = 100;
    expect(lastObserver).not.toBeNull();
    lastObserver!.trigger([
      { target: el, contentRect: { width: 200, height: 100 } },
    ]);

    // After resize: 50% of min(200, 100) = 50
    expect(buf[id * FLOATS_PER_ENTITY + 8]).toBe(50);

    instance.destroy();
  });
});
