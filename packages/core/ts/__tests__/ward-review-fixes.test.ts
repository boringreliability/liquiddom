/**
 * @vitest-environment jsdom
 * W66 ward-review fixes: I2 (static container warning) and M2 (frame failure
 * stops the loop for good; destroy() never throws).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM } from "../src/index";
import { createManualClock } from "../src/clock";
import { createFluidRuntime } from "../src/runtime";
import {
  freshBackend, instanceTracker, mockRect, resetDom, restoreVisibility, setupFacadeTestEnv,
  setVisibility, spyBackend,
} from "./_facade-helpers";

const STATIC_WARNING =
  "[liquiddom] container must be a positioned element (e.g. position: relative); the canvas is absolutely positioned inside it";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  tracker.destroyAll();
  restoreVisibility();
  vi.restoreAllMocks();
});

function makeContainer(position?: string): HTMLElement {
  const c = document.createElement("section");
  if (position !== undefined) c.style.position = position;
  mockRect(c, 0, 0, 600, 400);
  document.body.appendChild(c);
  return c;
}

const staticWarnings = (spy: ReturnType<typeof vi.spyOn>): unknown[][] =>
  spy.mock.calls.filter((args: unknown[]) => args[0] === STATIC_WARNING);

describe("W66 ward-fix I2: container mode needs a positioned container", () => {
  it("given_static_container_when_create_then_warns_once_and_does_not_change_its_position", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = makeContainer();
    expect(getComputedStyle(container).position).toBe("static");
    const inst = tracker.track(
      await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 4, container }),
    );
    inst.pause();
    inst.resume();
    expect(staticWarnings(warn)).toHaveLength(1);
    expect(container.getAttribute("style")).toBeNull();
  });

  it("given_relative_container_when_create_then_no_static_warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = makeContainer("relative");
    tracker.track(
      await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 4, container }),
    );
    expect(staticWarnings(warn)).toHaveLength(0);
  });

  it("given_two_instances_on_one_static_container_when_created_then_each_warns_once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = makeContainer();
    for (let i = 0; i < 2; i++) {
      tracker.track(
        await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 4, container }),
      );
    }
    expect(staticWarnings(warn)).toHaveLength(2);
  });
});

describe("W66 ward-fix M2: a failing frame stops the instance; destroy never throws", () => {
  it("given_tick_throws_when_frames_advance_then_one_console_error_and_the_loop_never_rearms", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock });
    const core = sb.cores[0] as unknown as { tick: (...a: unknown[]) => number };
    const boom = new Error("tick boom");
    core.tick = () => {
      throw boom;
    };
    expect(() => clock.advance(1)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/^\[liquiddom\] frame failed; the instance stopped/);
    expect(error.mock.calls[0][1]).toBe(boom);

    let ticks = 0;
    core.tick = () => {
      ticks += 1;
      return 0;
    };
    clock.advance(5);
    rt.pause();
    rt.resume();
    clock.advance(5);
    setVisibility("hidden");
    setVisibility("visible");
    clock.advance(5);
    expect(ticks).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(() => rt.destroy()).not.toThrow();
  });

  it("given_free_throws_when_destroy_then_does_not_throw_and_warns", async () => {
    const sb = spyBackend();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock: createManualClock() });
    (sb.cores[0] as unknown as { free: () => void }).free = () => {
      throw new Error("free boom");
    };
    expect(() => rt.destroy()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(rt.canvas.isConnected).toBe(false);
    expect(() => rt.destroy()).not.toThrow();
  });

  it("given_free_throws_when_facade_destroy_then_does_not_throw", async () => {
    const sb = spyBackend();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inst = await LiquidDOM.create({ testBackend: sb.backend, autoObserve: false, particles: 1024, maxElements: 4 });
    (sb.cores[0] as unknown as { free: () => void }).free = () => {
      throw new Error("free boom");
    };
    expect(() => inst.destroy()).not.toThrow();
  });
});
