/**
 * @vitest-environment jsdom
 * W81 (D81-2, D81-3) in the runtime: the world passed to the core and kept by the runtime; its
 * growth when the window (or the container) outgrows it — one `resize_world` from the resize
 * handler (never inside a frame), one console.info per growth, never shrinking — and no core call
 * once a frame has failed (the core may be poisoned). jsdom's screen is 0 × 0, so body mode's
 * world is the window's inner size.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualClock, type ManualClock } from "../src/clock";
import { createFluidRuntime, type FluidRuntime, type FluidRuntimeOptions } from "../src/runtime";
import { WORLD_RESIZE_INFO } from "../src/world";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { createTestBackend, type TestBackend } from "./_fluid-test-backend";

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

interface Started {
  rt: FluidRuntime;
  clock: ManualClock;
  backend: TestBackend;
  /** Every recorded `resize_world:w:h` and `tick`, in call order. */
  calls: string[];
}

async function start(extra: Partial<FluidRuntimeOptions> = {}): Promise<Started> {
  const calls: string[] = [];
  const backend = createTestBackend({ onCall: (n) => (n === "tick" || n.startsWith("resize_world")) && calls.push(n) });
  const clock = createManualClock();
  const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, clock, ...extra });
  live.push(rt);
  return { rt, clock, backend, calls };
}

const resizes = (calls: string[]): string[] => calls.filter((n) => n.startsWith("resize_world"));

describe("W81 – the world in the runtime (D81-2, D81-3)", () => {
  it("given_the_window_grown_beyond_the_world_when_resize_fires_then_resize_world_runs_once_outside_any_frame_with_the_grown_world_and_logs_one_console_info", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { rt, backend, calls } = await start();
    expect(backend.cores[0]!.ctorArgs.slice(2, 4), "the constructor's world (frozen 7 args)").toEqual([1280, 800]);
    expect(rt.world).toEqual({ w: 1280, h: 800 });
    expect(resizes(calls), "nothing grows at create").toEqual([]);
    setWindow("innerWidth", 1400);
    window.dispatchEvent(new Event("resize"));
    expect(calls, "from the resize handler, not inside a frame").toEqual(["resize_world:1600:800"]);
    expect(rt.world).toEqual({ w: 1600, h: 800 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith(`${WORLD_RESIZE_INFO} 1600×800 px.`);
    setWindow("innerWidth", 1550);
    window.dispatchEvent(new Event("resize"));
    setWindow("innerWidth", 900);
    setWindow("innerHeight", 600);
    window.dispatchEvent(new Event("resize"));
    expect(resizes(calls), "within the headroom, then smaller: no call").toHaveLength(1);
    setWindow("innerWidth", 1700);
    window.dispatchEvent(new Event("resize"));
    expect(resizes(calls)).toEqual(["resize_world:1600:800", "resize_world:2000:800"]);
    expect(info).toHaveBeenCalledTimes(2);
    expect(rt.world).toEqual({ w: 2000, h: 800 });
  });

  it("given_container_mode_when_created_then_the_world_is_the_container_client_box_and_a_ResizeObserver_growth_reallocates_once_d81_3", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
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
    Object.defineProperty(box, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(box, "scrollHeight", { value: 1200, configurable: true });
    document.body.appendChild(box);
    const { rt, backend, calls } = await start({ container: box });
    expect(backend.cores[0]!.ctorArgs.slice(2, 4), "the client box, not the scroll range").toEqual([400, 300]);
    expect(rt.world).toEqual({ w: 400, h: 300 });
    Object.defineProperty(box, "clientWidth", { value: 520, configurable: true });
    observed!();
    expect(resizes(calls)).toEqual(["resize_world:520:300"]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(rt.world).toEqual({ w: 520, h: 300 });
  });

  it("given_a_frame_that_failed_when_the_window_grows_then_no_core_method_is_called_and_nothing_is_logged", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const all: string[] = [];
    const backend = createTestBackend({ onCall: (n) => all.push(n) });
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, clock });
    live.push(rt);
    vi.spyOn(backend.cores[0]!, "tick").mockImplementation(() => {
      throw new Error("boom (a poisoned core)");
    });
    clock.advance(1);
    expect(error, "the frame failed").toHaveBeenCalledTimes(1);
    const before = all.length;
    setWindow("innerWidth", 3000);
    window.dispatchEvent(new Event("resize"));
    expect(all.slice(before), "every core method recorded after the failed frame: none").toEqual([]);
    expect(info).not.toHaveBeenCalled();
    expect(rt.world).toEqual({ w: 1280, h: 800 });
  });

  it("given_a_world_beyond_8192_px_when_the_window_grows_then_resize_world_gets_the_capped_world_once_and_further_growth_calls_nothing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { rt, calls } = await start();
    setWindow("innerWidth", 9000);
    window.dispatchEvent(new Event("resize"));
    setWindow("innerWidth", 12000);
    window.dispatchEvent(new Event("resize"));
    expect(resizes(calls)).toEqual(["resize_world:8192:800"]);
    expect(rt.world).toEqual({ w: 8192, h: 800 });
  });
});
