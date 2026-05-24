// Ward 060: LiveHero factory + mount-helper tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeroBlobs } from "../src/showcases/hero-blobs";
import { mountLiveHero } from "../src/lib/live-hero-mount";

const RESOLVED_EVENT = "liquiddom:renderer-resolved";

describe("Ward 060: hero-blobs factory contract", () => {
  it("hero_blobs_module_exports_factory", async () => {
    expect(typeof createHeroBlobs).toBe("function");
    expect(createHeroBlobs.length).toBe(2);
    // jsdom can't load WASM → real factory must reject. Stub resolves null
    // (which fails the shape assertion below), gold rejects.
    const root = document.createElement("div");
    const result = await createHeroBlobs(root, "auto").catch((err) => ({ __err: err }));
    if (result && "__err" in result) {
      // Gold path: factory rejected because WASM unavailable in jsdom.
      // That's the export contract — we just verify it threw.
      expect(result.__err).toBeInstanceOf(Error);
      return;
    }
    // Stub path: returned a value. Must be a valid HeroBlobsHandle.
    expect(result, "factory must return a HeroBlobsHandle").not.toBeNull();
    expect(result, "HeroBlobsHandle must have .instance").toHaveProperty("instance");
    expect(result, "HeroBlobsHandle must have .activeRenderer").toHaveProperty("activeRenderer");
    expect(result, "HeroBlobsHandle must have .destroy").toHaveProperty("destroy");
  });
});

describe("Ward 060: mountLiveHero behavior", () => {
  let dispatchedEvents: CustomEvent[] = [];
  const captureDispatched = (e: Event) => {
    dispatchedEvents.push(e as CustomEvent);
  };
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    dispatchedEvents = [];
    window.addEventListener(RESOLVED_EVENT, captureDispatched);
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.removeEventListener(RESOLVED_EVENT, captureDispatched);
    // Restore (or delete if jsdom didn't provide one originally).
    if (originalMatchMedia) {
      (window as Window & typeof globalThis).matchMedia = originalMatchMedia;
    } else {
      delete (window as Partial<Window> & typeof globalThis).matchMedia;
    }
  });

  // Validates the query argument so a gold-phase regression that asks for
  // the WRONG media feature (e.g. `prefers-color-scheme: dark`) surfaces as
  // a loud assertion failure rather than a silently-correct mock response.
  function mockMatchMedia(matches: boolean): void {
    (window as Window & typeof globalThis).matchMedia = ((query: string) => {
      expect(query, "mountLiveHero must query prefers-reduced-motion").toBe(
        "(prefers-reduced-motion: reduce)",
      );
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    }) as typeof window.matchMedia;
  }

  it("hero_blobs_reduced_motion_short_circuit", async () => {
    mockMatchMedia(true);                          // reduced motion ON
    const factory = vi.fn().mockResolvedValue({
      instance: {},
      activeRenderer: "webgpu",
      destroy: vi.fn(),
    });
    const root = document.createElement("div");

    await mountLiveHero(root, factory, { getPreference: () => "auto" });

    expect(factory, "factory must NOT be called under reduced-motion").not.toHaveBeenCalled();
    expect(dispatchedEvents, "renderer-resolved must NOT dispatch under reduced-motion").toHaveLength(0);
  });

  it("renderer_resolved_dispatched_after_hero_mount", async () => {
    mockMatchMedia(false);                         // reduced motion OFF — normal mount
    const mockHandle = {
      instance: {} as unknown,
      activeRenderer: "webgpu" as const,
      destroy: vi.fn(),
    };
    const factory = vi.fn().mockResolvedValue(mockHandle);
    const root = document.createElement("div");

    await mountLiveHero(root, factory, { getPreference: () => "webgpu" });

    expect(factory, "factory must be called once").toHaveBeenCalledTimes(1);
    expect(dispatchedEvents, "renderer-resolved must dispatch once after mount").toHaveLength(1);
    // Destructure rather than non-null-assert to avoid a TypeError if a
    // reorder ever breaks the toHaveLength guard ordering.
    const [event] = dispatchedEvents;
    expect(event).toBeDefined();
    expect(event!.detail).toEqual({ resolved: "webgpu" });
  });
});
