// Ward 058: renderer-store tests.
//
// jsdom env. Tests the localStorage + CustomEvent contract documented in spec §2.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPreference, setPreference, subscribePreference } from "../src/lib/renderer-store";

const STORAGE_KEY = "liquiddom-renderer-preference";
const EVENT_NAME = "liquiddom:renderer-change";

describe("Ward 058: renderer-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renderer_store_default_is_auto", () => {
    // No localStorage entry → "auto" (matches W41's default)
    expect(getPreference()).toBe("auto");
  });

  it("renderer_store_persists_on_set", () => {
    setPreference("webgpu");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("webgpu");
    expect(getPreference()).toBe("webgpu");
  });

  it("renderer_store_emits_change_event", () => {
    const handler = vi.fn();
    window.addEventListener(EVENT_NAME, handler);
    try {
      setPreference("canvas2d");
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]?.[0] as CustomEvent<{ preference: string }>;
      expect(event.detail.preference).toBe("canvas2d");
    } finally {
      window.removeEventListener(EVENT_NAME, handler);
    }
  });

  it("renderer_store_handles_localstorage_failure", () => {
    // Simulate private mode / quota-exceeded: setItem throws.
    // Install override + listener INSIDE try-block so cleanup runs even if
    // setup itself somehow throws (reviewer fix #6).
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const handler = vi.fn();
    try {
      window.localStorage.setItem = () => {
        throw new Error("simulated localStorage failure");
      };
      window.addEventListener(EVENT_NAME, handler);

      // Must NOT throw — persistence failure cannot block UI state change
      expect(() => setPreference("webgpu")).not.toThrow();
      // Event still fires so the toggle UI updates for the session
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.localStorage.setItem = originalSetItem;
      window.removeEventListener(EVENT_NAME, handler);
    }
  });

  it("renderer_store_get_handles_localstorage_failure", () => {
    // Defense-in-depth: getPreference's try/catch around getItem.
    // Private mode could throw on read too — must fall through to "auto".
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    try {
      window.localStorage.getItem = () => {
        throw new Error("simulated localStorage read failure");
      };
      expect(() => getPreference()).not.toThrow();
      expect(getPreference()).toBe("auto");
    } finally {
      window.localStorage.getItem = originalGetItem;
    }
  });

  it("renderer_store_subscribe_returns_unsubscribe", () => {
    const cb = vi.fn();
    const unsubscribe = subscribePreference(cb);
    expect(typeof unsubscribe).toBe("function");

    setPreference("webgpu");
    expect(cb).toHaveBeenCalledWith("webgpu");

    cb.mockClear();
    unsubscribe();
    setPreference("canvas2d");
    // After unsubscribe, the callback must not be invoked
    expect(cb).not.toHaveBeenCalled();
  });
});
