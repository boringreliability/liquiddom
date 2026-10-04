/**
 * @vitest-environment jsdom
 *
 * Ward 042: parseBorderRadius (pure). The slot[8] block was deleted in W66 (A4):
 * the fluid FFI writes the radius to slot 4 (EL_RADIUS), covered by W64
 * element-registry.test.ts.
 */
import { describe, it, expect } from "vitest";
import { parseBorderRadius } from "../src/border-radius";

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
