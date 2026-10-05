/**
 * @vitest-environment jsdom
 * W66 ward-fix M1: the provider's cleanup resets its context state to null, so
 * the context matches its JSDoc ("null before init / after destroy"). React 18
 * drops state updates on an unmounted component, so the reset is observed at
 * the adapter's own useState setter (a pass-through wrapper over React's).
 * Kept in its own file because the `react` mock applies module-wide.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import type { LiquidDOMInstance, LiquidOptions } from "liquiddom";
import { setupFacadeTestEnv, spyBackend } from "../../core/ts/__tests__/_facade-helpers";

const setterValues = vi.hoisted(() => [] as unknown[]);

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  function useState<S>(init: S | (() => S)): [S, (v: S | ((p: S) => S)) => void] {
    const [value, set] = actual.useState(init);
    const logged = actual.useCallback(
      (v: S | ((p: S) => S)) => {
        setterValues.push(v);
        set(v);
      },
      [set],
    );
    return [value, logged];
  }
  return { ...actual, default: { ...actual, useState }, useState };
});

// Imported after the mock is registered (vi.mock is hoisted).
import { LiquidProvider, useLiquid } from "../src/index";

let config: LiquidOptions;
beforeEach(() => {
  setupFacadeTestEnv();
  setterValues.length = 0;
  config = { testBackend: spyBackend().backend, autoObserve: false, particles: 1024, maxElements: 4 };
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("W66 ward-fix M1: LiquidProvider resets its context on cleanup", () => {
  it("given_a_live_instance_when_the_provider_unmounts_then_its_context_state_is_set_to_null_after_destroy", async () => {
    const seen: { current: LiquidDOMInstance | null } = { current: null };
    function Capture() {
      seen.current = useLiquid();
      return null;
    }
    const { unmount } = render(<LiquidProvider config={config}><Capture /></LiquidProvider>);
    await waitFor(() => expect(seen.current).not.toBeNull());
    const inst = seen.current!;
    const setIdx = setterValues.indexOf(inst);
    expect(setIdx).toBeGreaterThanOrEqual(0);

    unmount();
    expect(setterValues.slice(setIdx + 1)).toContain(null);
    expect(setterValues.at(-1)).toBeNull();
  });

  it("given_a_keyed_remount_when_the_new_provider_mounts_then_the_context_is_null_until_its_new_instance_arrives", async () => {
    const values: Array<LiquidDOMInstance | null> = [];
    function Capture() {
      values.push(useLiquid());
      return null;
    }
    const { rerender } = render(<LiquidProvider key="a" config={config}><Capture /></LiquidProvider>);
    await waitFor(() => expect(values.at(-1)).not.toBeNull());
    const first = values.at(-1)!;
    const destroy = vi.spyOn(first, "destroy");
    const mark = values.length;

    rerender(<LiquidProvider key="b" config={config}><Capture /></LiquidProvider>);
    expect(destroy).toHaveBeenCalledOnce();
    await waitFor(() => expect(values.at(-1)).not.toBeNull());
    const after = values.slice(mark);
    expect(after[0]).toBeNull(); // between destroy and the new instance
    expect(after).not.toContain(first);
    expect(values.at(-1)).not.toBe(first);
  });
});
