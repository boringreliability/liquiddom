/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { createManualClock, type ManualClock } from "../src/clock";
import { createTestBackend } from "./_fluid-test-backend";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

type Listener = (e: { matches: boolean }) => void;

function stubReducedMotionMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const rm = {
    matches: initial,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  const other = { ...rm, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((q: string) => (q.includes("prefers-reduced-motion") ? rm : { ...other, media: q })),
  });
  return {
    fire(matches: boolean) {
      rm.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
    restore() {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original });
    },
  };
}

function stubRect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
}

function button(): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = "Splash";
  stubRect(b, 100, 50, 140, 48);
  document.body.appendChild(b);
  return b;
}

const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 150, clientY: 70 }));
const move = (x: number, y: number) =>
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, pointerType: "mouse", bubbles: true }));

describe("reduced-motion input gating (W68, D68-5)", () => {
  let fake: FakeCanvasHandle | null = null;
  let inst: LiquidDOMInstance | null = null;
  let media: ReturnType<typeof stubReducedMotionMedia> | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    fake = installFakeCanvas2D();
  });
  afterEach(() => {
    inst?.destroy();
    inst = null;
    media?.restore();
    media = null;
    fake?.restore(); // W64: installFakeCanvas2D() returns a FakeCanvasHandle
    fake = null;
    vi.restoreAllMocks();
  });

  async function create(extra: Record<string, unknown> = {}) {
    const backend = createTestBackend();
    const spies = {
      splash: vi.spyOn(backend.FluidCore.prototype, "splash"),
      shake: vi.spyOn(backend.FluidCore.prototype, "shake"),
      tick: vi.spyOn(backend.FluidCore.prototype, "tick"),
    };
    const clock: ManualClock = createManualClock(1000);
    inst = await LiquidDOM.create({
      testBackend: backend,
      clock,
      autoObserve: false,
      particles: 256,
      maxElements: 4,
      seed: 1,
      ...extra,
    } as Parameters<typeof LiquidDOM.create>[0]);
    const el = button();
    inst.observe(el);
    await Promise.resolve(); // flush the microtask-batched redistribute
    clock.advance(1);
    return { inst, el, clock, ...spies };
  }

  const pointerActive = (tick: { mock: { calls: unknown[][] } }) => tick.mock.calls.at(-1)?.[5];

  it("given_reduced_motion_when_observed_element_clicked_then_core_splash_not_called_and_default_not_prevented", async () => {
    const { el, splash } = await create({ forceReducedMotion: true });
    expect(click(el)).toBe(true);
    expect(splash).not.toHaveBeenCalled();
  });

  it("given_reduced_motion_when_splash_or_shake_api_called_then_still_validated_but_core_not_called", async () => {
    const { inst, el, splash, shake } = await create({ forceReducedMotion: true });
    expect(() => inst.splash(el)).not.toThrow();
    expect(() => inst.shake()).not.toThrow();
    expect(() => inst.splash(el, { strength: 3 })).toThrow(TypeError);
    expect(() => inst.shake(Number.NaN)).toThrow(TypeError);
    const stranger = document.createElement("button");
    expect(() => inst.splash(stranger)).toThrow(/not observed/);
    expect(splash).not.toHaveBeenCalled();
    expect(shake).not.toHaveBeenCalled();
  });

  it("given_live_media_change_to_reduce_when_pointer_moves_then_tick_pointer_inactive_until_changed_back", async () => {
    media = stubReducedMotionMedia(false);
    const { clock, tick } = await create();
    move(100, 60);
    clock.advance(1);
    expect(pointerActive(tick)).toBe(true);
    media.fire(true);
    move(110, 60);
    clock.advance(1);
    expect(pointerActive(tick)).toBe(false);
    media.fire(false);
    move(120, 60);
    clock.advance(1);
    expect(pointerActive(tick)).toBe(true);
  });

  it("given_live_media_change_to_reduce_when_clicked_then_no_splash_and_after_change_back_one_splash", async () => {
    media = stubReducedMotionMedia(false);
    const { el, splash } = await create();
    media.fire(true);
    click(el);
    expect(splash).not.toHaveBeenCalled();
    media.fire(false);
    click(el);
    expect(splash).toHaveBeenCalledTimes(1);
  });
});
