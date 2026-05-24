// Ward 059: capability indicator behavior.

import { describe, it, expect, beforeEach } from "vitest";
import { wireCapabilityIndicator } from "../src/lib/toggle-indicator";

describe("Ward 059: RendererToggle capability indicator", () => {
  beforeEach(() => {
    // Reset document body between tests. textContent="" avoids the XSS-prone
    // innerHTML setter (no html content needed; we build via createElement).
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  });

  it("renderer_toggle_indicator_listens_to_resolved", () => {
    // Fixture mimics the markup RendererToggle.astro will emit in gold:
    // a host element containing an empty `[data-renderer-active]` span.
    const root = document.createElement("div");
    root.dataset.rendererToggle = "root";
    const indicator = document.createElement("span");
    indicator.dataset.rendererActive = "";
    root.appendChild(indicator);
    document.body.appendChild(root);

    const cleanup = wireCapabilityIndicator(root, {
      getCurrentPreference: () => "auto",
    });
    try {
      window.dispatchEvent(
        new CustomEvent("liquiddom:renderer-resolved", {
          detail: { resolved: "webgpu" },
        }),
      );
      // After the event fires, the indicator text should include the resolved
      // renderer name. (Exact phrasing — e.g. "Active: webgpu" — is decided
      // in gold; the test asserts the substring is present.)
      expect(indicator.textContent ?? "").toContain("webgpu");
    } finally {
      cleanup();
    }
  });
});
