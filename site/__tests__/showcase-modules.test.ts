// Ward 059: showcase factory export contract.
//
// Verifies the EXPORT shape:
// - Function is exported with arity 2
// - Calling it in jsdom (WASM unavailable) rejects rather than silently
//   resolving — because gold's factory calls `LiquidDOM.create()` which fails
//   under jsdom. Stub returns null (resolves) so this assertion fails in red.
//
// The runtime success path (actual physics) is verified by manual smoke test.

import { describe, it, expect } from "vitest";
import { createSquishShowcase } from "../src/showcases/squish";
import { createFusionShowcase } from "../src/showcases/fusion";

describe("Ward 059: showcase factory contracts", () => {
  it("squish_module_exports_factory", async () => {
    expect(typeof createSquishShowcase).toBe("function");
    expect(createSquishShowcase.length).toBe(2);
    const root = document.createElement("div");
    await expect(
      createSquishShowcase(root, "auto"),
      "factory must reject in jsdom (WASM unavailable)",
    ).rejects.toThrow();
  });

  it("fusion_module_exports_factory", async () => {
    expect(typeof createFusionShowcase).toBe("function");
    expect(createFusionShowcase.length).toBe(2);
    const root = document.createElement("div");
    await expect(
      createFusionShowcase(root, "auto"),
      "factory must reject in jsdom (WASM unavailable)",
    ).rejects.toThrow();
  });
});
