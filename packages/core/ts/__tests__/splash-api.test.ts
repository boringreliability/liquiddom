/**
 * W67 – public splash() / shake() (spec §5; decisions D67-4, D67-5, D67-8; B9).
 * Facade → runtime → FluidCore FFI, asserted through W66's spyBackend.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiquidDOM, type LiquidDOMInstance, type SplashOptions } from "../src/index";
import { createManualClock } from "../src/clock";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, spyBackend, type SpyBackend } from "./_facade-helpers";

let fake: FakeCanvasHandle;
let live: LiquidDOMInstance | null = null;
let sb: SpyBackend = spyBackend();

const splashCalls = (): unknown[][] => sb.calls.filter((c) => c.method === "splash").map((c) => c.args);
const shakeCalls = (): unknown[] => sb.calls.filter((c) => c.method === "shake").map((c) => c.args[0]);

async function create(container?: HTMLElement): Promise<LiquidDOMInstance> {
  sb = spyBackend();
  live = await LiquidDOM.create({
    testBackend: sb.backend,
    clock: createManualClock(),
    renderer: "canvas2d",
    autoObserve: false,
    particles: 1024,
    maxElements: 4,
    seed: 1,
    ...(container ? { container } : {}),
  });
  return live;
}

function makeButton(left: number, top: number, parent: HTMLElement = document.body): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = "Splash";
  parent.appendChild(el);
  mockRect(el, left, top, 140, 48);
  return el;
}

function caught(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

const STRENGTH_MSG = /strength must be a finite number in \[0, 2\]/;

beforeEach(() => {
  fake = installFakeCanvas2D();
});

afterEach(() => {
  live?.destroy();
  live = null;
  fake.restore();
  document.body.replaceChildren();
});

describe("W67 splash() / shake() API", () => {
  it("given_splash_without_options_when_called_then_strength_1_at_rect_centre", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    const id = liquid.observe(el);
    liquid.splash(el);
    expect(splashCalls()).toEqual([[id, 80, 44, 1]]);
  });

  it("given_splash_with_at_and_strength_when_called_then_core_receives_buffer_point_and_strength", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    const id = liquid.observe(el);
    liquid.splash(el, { strength: 1.5, at: { x: 33, y: 41 } });
    expect(splashCalls()).toEqual([[id, 33, 41, 1.5]]);
  });

  it("given_splash_at_client_point_in_container_mode_when_called_then_converted_with_container_offset", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mockRect(container, 100, 50, 600, 400);
    const liquid = await create(container);
    const el = makeButton(110, 70, container);
    const id = liquid.observe(el);
    liquid.splash(el, { at: { x: 150, y: 90 } });
    liquid.splash(el);
    expect(splashCalls()).toEqual([
      [id, 50, 40, 1],
      [id, 80, 44, 1],
    ]);
  });

  it("given_strength_nan_or_out_of_0_2_when_splash_or_shake_then_TypeError", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    liquid.observe(el);
    for (const bad of [Number.NaN, -0.01, 2.01, Number.POSITIVE_INFINITY, "1"]) {
      expect(() => liquid.splash(el, { strength: bad as number })).toThrow(STRENGTH_MSG);
      expect(() => liquid.shake(bad as number)).toThrow(STRENGTH_MSG);
    }
    expect(caught(() => liquid.shake(Number.NaN))).toBeInstanceOf(TypeError);
    expect(splashCalls()).toEqual([]);
    expect(shakeCalls()).toEqual([]);
  });

  it("given_strength_0_and_2_when_splash_or_shake_then_accepted_bounds_inclusive", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    const id = liquid.observe(el);
    liquid.splash(el, { strength: 0 });
    liquid.splash(el, { strength: 2 });
    liquid.shake(0);
    liquid.shake(2);
    expect(splashCalls()).toEqual([
      [id, 80, 44, 0],
      [id, 80, 44, 2],
    ]);
    expect(shakeCalls()).toEqual([0, 2]);
  });

  it("given_invalid_at_when_splash_then_TypeError", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    liquid.observe(el);
    const bad: unknown[] = [null, { x: Number.NaN, y: 1 }, { x: 1 }, [1, 2], "10,20", { x: 1, y: Number.POSITIVE_INFINITY }];
    for (const at of bad) {
      expect(() => liquid.splash(el, { at } as unknown as SplashOptions)).toThrow(/at must be \{ x: number, y: number \}/);
    }
    expect(splashCalls()).toEqual([]);
  });

  it("given_old_or_unknown_splash_option_when_splash_then_TypeError_naming_new_shape", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    liquid.observe(el);
    // D67-4: every 0.2 key is pinned on its own, so a partial whitelist cannot pass.
    for (const key of ["threshold", "count", "jitter", "speedScale", "lifetimeMs", "radius", "magnitude", "direction", "splash"]) {
      const err = caught(() => liquid.splash(el, { [key]: 1 } as unknown as SplashOptions));
      expect(err, `0.2 key ${key}`).toBeInstanceOf(TypeError);
      expect(String(err), `0.2 key ${key}`).toMatch(/SplashOptions changed shape/);
    }
    expect(() => liquid.splash(el, { strenght: 1 } as unknown as SplashOptions)).toThrow(/unknown option "strenght"/);
    // An unknown (non-0.2) key is a TypeError too, but not via the "changed shape" path.
    const unknown = caught(() => liquid.splash(el, { foo: 1 } as unknown as SplashOptions));
    expect(unknown).toBeInstanceOf(TypeError);
    expect(String(unknown)).not.toMatch(/changed shape/);
    expect(() => liquid.splash(el, 1 as unknown as SplashOptions)).toThrow(/opts must be an object/);
    expect(caught(() => liquid.splash(el, null as unknown as SplashOptions))).toBeInstanceOf(TypeError);
    expect(caught(() => liquid.splash(el, { strength: Number.NEGATIVE_INFINITY }))).toBeInstanceOf(TypeError);
    expect(caught(() => liquid.shake(Number.NEGATIVE_INFINITY))).toBeInstanceOf(TypeError);
    expect(splashCalls()).toEqual([]);
  });

  it("given_unobserved_element_when_splash_then_Error", async () => {
    const liquid = await create();
    const other = makeButton(300, 20);
    const err = caught(() => liquid.splash(other));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(String(err)).toMatch(/\[liquiddom\] splash: element is not observed/);
    expect(caught(() => liquid.splash(null as unknown as HTMLElement))).toBeInstanceOf(TypeError);
    expect(splashCalls()).toEqual([]);
  });

  it("given_shake_without_argument_when_called_then_core_shake_1", async () => {
    const liquid = await create();
    liquid.observe(makeButton(10, 20));
    liquid.shake();
    expect(shakeCalls()).toEqual([1]);
  });

  it("given_destroyed_instance_when_splash_or_shake_then_Error", async () => {
    const liquid = await create();
    const el = makeButton(10, 20);
    liquid.observe(el);
    liquid.destroy();
    for (const fn of [() => liquid.splash(el), () => liquid.shake()]) {
      const err = caught(fn);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TypeError);
    }
    expect(splashCalls()).toEqual([]);
    expect(shakeCalls()).toEqual([]);
  });
});
