/**
 * @vitest-environment jsdom
 * W82 (D82-5) in the runtime: `set_viewport(w, h)` gives the core the visible window in buffer px
 * (body mode: the window's inner size; container mode: the container's client box) at `create()`,
 * before the first tick, and again from every `resizeCanvas()` (the resize handler or the
 * container's ResizeObserver), never inside a frame and never after a failed frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualClock } from "../src/clock";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { createTestBackend } from "./_fluid-test-backend";

let fake2d: FakeCanvasHandle;
const live: FluidRuntime[] = [];
const setWindow = (key: string, value: number): void => {
  Object.defineProperty(window, key, { value, configurable: true });
};

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  setWindow("innerWidth", 1280);
  setWindow("innerHeight", 800);
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  fake2d.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setWindow("innerWidth", 1024);
  setWindow("innerHeight", 768);
});

/** The recorded `set_viewport:w:h` and `tick` calls, in order. */
function recorder(): { calls: string[]; backend: ReturnType<typeof createTestBackend> } {
  const calls: string[] = [];
  const backend = createTestBackend({ onCall: (n) => (n === "tick" || n.startsWith("set_viewport")) && calls.push(n) });
  return { calls, backend };
}

describe("W82 – the viewport in the core (D82-5)", () => {
  it("given_body_mode_when_created_and_the_window_resizes_then_set_viewport_gets_the_inner_size_before_the_first_tick_and_again_from_the_resize_handler", async () => {
    const { calls, backend } = recorder();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, clock });
    live.push(rt);
    expect(calls, "at create(), before any frame").toEqual(["set_viewport:1280:800"]);
    clock.advance(2);
    expect(calls.filter((c) => c.startsWith("set_viewport")), "frames never call it").toHaveLength(1);
    setWindow("innerWidth", 900);
    setWindow("innerHeight", 700);
    window.dispatchEvent(new Event("resize"));
    expect(calls.at(-1)).toBe("set_viewport:900:700");
  });

  it("given_container_mode_when_created_and_the_container_resizes_then_set_viewport_gets_its_client_box_and_after_a_failed_frame_nothing_is_called", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let observed: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const box = document.createElement("div");
    box.style.position = "relative";
    box.style.zIndex = "0"; // a stacking context: no D82-1 fallback warning
    Object.defineProperty(box, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 300, configurable: true });
    document.body.appendChild(box);
    const { calls, backend } = recorder();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, clock, container: box });
    live.push(rt);
    expect(calls).toEqual(["set_viewport:400:300"]);
    expect(warn, "a stacking-context container: no warning").not.toHaveBeenCalled();
    Object.defineProperty(box, "clientWidth", { value: 520, configurable: true });
    observed!();
    expect(calls.at(-1)).toBe("set_viewport:520:300");
    vi.spyOn(backend.cores[0]!, "tick").mockImplementation(() => {
      throw new Error("boom (a poisoned core)");
    });
    clock.advance(1);
    expect(error, "the frame failed").toHaveBeenCalledTimes(1);
    const before = calls.length;
    Object.defineProperty(box, "clientWidth", { value: 640, configurable: true });
    observed!();
    expect(calls.slice(before), "no set_viewport on a stopped instance").toEqual([]);
  });
});
