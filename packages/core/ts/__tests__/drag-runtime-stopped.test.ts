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
});
