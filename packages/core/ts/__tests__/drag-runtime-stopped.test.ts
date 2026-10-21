/**
 * @vitest-environment jsdom
 * W78.3 review fix round 1: a stopped instance (a failed frame) takes no more drags: no capture,
 * no prevented selectstart, no swallowed click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock } from "../src/clock";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend } from "./_facade-helpers";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { installFakeGpuLifecycle, type LifecycleGpu } from "./_fake-gpu";
import { Interaction, ELEMENT_STRIDE, El } from "../src/fluid-layout";
import { AWAY_CLASS } from "../src/stylesheet";
import { movingBackend } from "./_moving-backend";

let fake2d: FakeCanvasHandle;
const live: FluidRuntime[] = [];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  fake2d.restore();
  vi.restoreAllMocks();
});

describe("W78.3 review: a stopped instance takes no more drags", () => {
  it("given_a_failed_frame_when_a_new_press_is_dragged_past_4_px_then_no_capture_no_prevented_selectstart_and_the_click_is_not_swallowed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = spyBackend(movingBackend().backend);
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: "canvas2d" });
    live.push(rt);
    const el = document.createElement("button");
    mockRect(el, 734, 260, 140, 48);
    const setCapture = vi.fn();
    Object.assign(el, { setPointerCapture: setCapture, releasePointerCapture: vi.fn(), hasPointerCapture: () => false });
    document.body.appendChild(el);
    rt.observe(el);
    await flush();
    (sb.cores[0] as unknown as { tick: () => never }).tick = () => {
      throw new Error("tick failed");
    };
    clock.advance(1);
    el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: 804, clientY: 284 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: 804, clientY: 224 }));
    expect(setCapture).not.toHaveBeenCalled();
    const sel = new Event("selectstart", { bubbles: true, cancelable: true });
    document.dispatchEvent(sel);
    expect(sel.defaultPrevented).toBe(false);
    el.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0, clientX: 804, clientY: 224 }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    el.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("given_a_failed_frame_when_the_resync_throws_too_then_still_exactly_one_console_error_and_nothing_escapes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = spyBackend(movingBackend().backend);
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: "canvas2d" });
    live.push(rt);
    const el = document.createElement("button");
    mockRect(el, 734, 260, 140, 48);
    document.body.appendChild(el);
    rt.observe(el);
    await flush();
    let tickFailed = false;
    (sb.cores[0] as unknown as { tick: () => never }).tick = () => {
      tickFailed = true;
      throw new Error("tick failed");
    };
    const realView = rt.bridge.elementView.bind(rt.bridge);
    const viewSpy = vi.spyOn(rt.bridge, "elementView").mockImplementation(() => {
      if (tickFailed) throw new Error("view gone");
      return realView();
    });
    expect(() => clock.advance(1)).not.toThrow();
    expect(tickFailed, "precondition: the resync ran after the failed tick").toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(() => clock.advance(2)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(viewSpy.mock.calls.length, "the resync did reach the throwing view").toBeGreaterThan(0);
    viewSpy.mockRestore(); // destroy() in afterEach needs the real view
  });
});

describe("W78 review: a failed Canvas2D rebuild during a drag", () => {
  let gpu: LifecycleGpu;
  afterEach(() => gpu?.restore());

  it("given_a_canvas2d_drag_in_a_pending_rebuild_when_the_rebuild_fails_then_liquid_away_is_off_and_slot_5_is_not_dragged", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    gpu = installFakeGpuLifecycle();
    const moving = movingBackend();
    const sb = spyBackend(moving.backend);
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: "webgpu" });
    live.push(rt);
    const el = document.createElement("button");
    mockRect(el, 734, 260, 140, 48);
    Object.assign(el, { setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => true });
    document.body.appendChild(el);
    const id = rt.observe(el);
    await flush();
    let failInit: (err: Error) => void = () => {};
    vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockImplementation(
      () => new Promise((_resolve, reject) => {
        failInit = reject;
      }),
    );
    gpu.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    // The rebuild is in flight: a new drag starts and may hide the label (accepted window, as the halo).
    el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: 804, clientY: 284 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: 804, clientY: 224 }));
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(el.classList.contains(AWAY_CLASS), "precondition: the pending-rebuild window hides the label").toBe(true);
    failInit(new Error("2d gone"));
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(el.classList.contains(AWAY_CLASS), "a failed rebuild clears the label class").toBe(false);
    expect(rt.bridge.elementView()[id * ELEMENT_STRIDE + El.INTERACTION]).not.toBe(Interaction.DRAGGED);
  });
});
