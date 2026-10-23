/**
 * @vitest-environment jsdom
 * W85 (D85-2, D85-3): the React provider's error state and the `drag` prop. A stopped instance (a
 * throwing frame through core's `onError`, D85-1) is destroyed by the provider, `useLiquid()`
 * returns null and `useLiquidError()` the error; `config.onError` is still called, after the
 * provider's own handler. A `create()` rejection sets the same error. No retry; a remount clears
 * it. `drag` reaches `observe()` and never the DOM; an absent `drag` passes no key.
 */
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest";
import { act, render, waitFor, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import { LiquidProvider, LiquidElement, useLiquid, useLiquidError, useLiquidRef } from "../src/index";
import { mockRect, setupFacadeTestEnv, spyBackend, type SpyBackend } from "../../core/ts/__tests__/_facade-helpers";
import { createManualClock, type ManualClock } from "../../core/ts/src/clock";

interface ObserveCall {
  el: HTMLElement;
  opts: unknown;
}
let createSpy: MockInstance | null = null;
let sb: SpyBackend;
let clock: ManualClock;
let calls: ObserveCall[];
let created: LiquidDOMInstance[];
let config: LiquidOptions;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  setupFacadeTestEnv();
  sb = spyBackend();
  clock = createManualClock();
  calls = [];
  created = [];
  config = { testBackend: sb.backend, autoObserve: false, particles: 1024, maxElements: 4, clock };
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  const original = LiquidDOM.create.bind(LiquidDOM);
  createSpy = vi.spyOn(LiquidDOM, "create").mockImplementation(async (options?: LiquidOptions) => {
    const inst = await original(options);
    created.push(inst);
    const observe = inst.observe.bind(inst);
    inst.observe = (el, opts) => {
      calls.push({ el, opts });
      return observe(el, opts);
    };
    return inst;
  });
});
afterEach(() => {
  cleanup();
  createSpy?.mockRestore();
  createSpy = null;
  error.mockRestore();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  document.body.replaceChildren();
});

const FRAME_FAILED = /frame failed; the instance stopped/;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

/** Every value the provider handed out, in render order. */
function capture() {
  const seen = { instances: [] as Array<LiquidDOMInstance | null>, errors: [] as unknown[] };
  function Capture() {
    seen.instances.push(useLiquid());
    seen.errors.push(useLiquidError());
    return null;
  }
  return { seen, Capture };
}

/** The newest core's tick throws from now on; one frame runs inside act(). */
function stopNewest(err: Error): void {
  vi.spyOn(sb.cores.at(-1)!, "tick").mockImplementation(() => {
    throw err;
  });
  act(() => clock.advance(1));
}

describe("W85 – the React provider's error state (D85-2)", () => {
  it("given_a_live_provider_when_its_instance_stops_then_the_provider_destroys_it_useLiquid_is_null_useLiquidError_is_the_error_and_config_onError_runs_after", async () => {
    const order: string[] = [];
    const onError = vi.fn((err: unknown) => {
      order.push(`config.onError ${(err as Error).message}, canvases ${document.querySelectorAll("canvas").length}`);
    });
    const { seen, Capture } = capture();
    render(
      <LiquidProvider config={{ ...config, onError }}>
        <Capture />
      </LiquidProvider>,
    );
    await waitFor(() => expect(seen.instances.at(-1)).not.toBeNull());
    const destroy = vi.spyOn(created[0]!, "destroy");
    const boom = new Error("boom");
    stopNewest(boom);
    expect(destroy, "the provider destroyed the stopped instance").toHaveBeenCalledOnce();
    expect(seen.instances.at(-1)).toBeNull();
    expect(seen.errors.at(-1)).toBe(boom);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(order, "config.onError runs after the provider's handler (the canvas is gone)").toEqual(["config.onError boom, canvases 0"]);
    expect(error.mock.calls.filter((c) => FRAME_FAILED.test(String(c[0])))).toHaveLength(1);
    act(() => clock.advance(3));
    await settle();
    expect(createSpy, "no retry").toHaveBeenCalledTimes(1);
  });

  it("given_create_rejects_when_the_provider_mounts_then_useLiquidError_is_the_rejection_its_console_error_stays_and_nothing_retries", async () => {
    const loadFailed = new Error("no wasm");
    const { seen, Capture } = capture();
    render(
      <LiquidProvider config={{ autoObserve: false, loader: () => Promise.reject(loadFailed) }}>
        <Capture />
      </LiquidProvider>,
    );
    await waitFor(() => expect(seen.errors.at(-1)).toBe(loadFailed));
    expect(seen.instances.at(-1)).toBeNull();
    expect(error.mock.calls.some((c) => String(c[0]).includes("LiquidProvider failed to create instance") && c[1] === loadFailed)).toBe(true);
    await settle();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("given_a_config_onError_that_is_not_a_function_when_the_provider_mounts_then_create_rejects_with_its_TypeError_and_the_error_state_holds_it", async () => {
    const { seen, Capture } = capture();
    render(
      <LiquidProvider config={{ ...config, onError: "log" as never }}>
        <Capture />
      </LiquidProvider>,
    );
    await waitFor(() => expect(seen.errors.at(-1)).toBeInstanceOf(TypeError));
    expect((seen.errors.at(-1) as Error).message).toMatch(/onError must be a function/);
    expect(seen.instances.at(-1)).toBeNull();
  });

  it("given_a_stopped_provider_when_it_is_remounted_with_a_new_key_then_a_new_instance_arrives_and_the_error_is_cleared", async () => {
    const { seen, Capture } = capture();
    const tree = (key: string) => (
      <LiquidProvider key={key} config={config}>
        <Capture />
      </LiquidProvider>
    );
    const { rerender } = render(tree("a"));
    await waitFor(() => expect(seen.instances.at(-1)).not.toBeNull());
    stopNewest(new Error("boom"));
    expect(seen.errors.at(-1)).toBeInstanceOf(Error);
    rerender(tree("b"));
    await waitFor(() => expect(seen.instances.at(-1)).not.toBeNull());
    expect(seen.errors.at(-1)).toBeNull();
    expect(seen.instances.at(-1)).toBe(created[1]);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it("given_strict_mode_when_the_live_instance_stops_then_one_error_both_instances_are_destroyed_and_no_third_create", async () => {
    const { seen, Capture } = capture();
    render(
      <StrictMode>
        <LiquidProvider config={config}>
          <Capture />
        </LiquidProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(seen.instances.at(-1)).not.toBeNull());
    await settle();
    expect(createSpy, "StrictMode's effect replay creates twice").toHaveBeenCalledTimes(2);
    const liveInst = seen.instances.at(-1)!;
    const destroy = vi.spyOn(liveInst, "destroy");
    const boom = new Error("boom");
    stopNewest(boom);
    expect(destroy).toHaveBeenCalledOnce();
    expect(seen.instances.at(-1)).toBeNull();
    expect(seen.errors.at(-1)).toBe(boom);
    expect(document.querySelector("canvas"), "the replayed-away instance and the stopped one are both gone").toBeNull();
    expect(error.mock.calls.filter((c) => FRAME_FAILED.test(String(c[0])))).toHaveLength(1);
    await settle();
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it("given_an_instance_that_stops_while_create_awaits_the_renderer_when_create_resolves_then_the_provider_destroys_it_on_arrival_and_holds_the_error", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    const { seen, Capture } = capture();
    render(
      <LiquidProvider config={{ ...config, renderer: "canvas2d" }}>
        <Capture />
      </LiquidProvider>,
    );
    // The effect called create(): the core exists, the renderer init is pending.
    expect(sb.cores).toHaveLength(1);
    const oom = new Error("oom at create");
    vi.spyOn(sb.cores[0]!, "resize_world").mockImplementation(() => {
      throw oom;
    });
    Object.defineProperty(window, "innerWidth", { value: 3000, configurable: true });
    await waitFor(() => expect(seen.errors.at(-1)).toBe(oom));
    await waitFor(() => expect(created).toHaveLength(1));
    await settle();
    expect(seen.instances.every((i) => i === null), "the stopped instance was never handed out").toBe(true);
    expect(document.querySelector("canvas"), "destroyed on arrival").toBeNull();
    expect(sb.calls.filter((c) => c.method === "free")).toHaveLength(1);
  });
});

describe("W85 – drag in the React adapter (D85-3)", () => {
  it("given_LiquidElement_with_drag_false_and_one_without_when_mounted_then_observe_gets_drag_false_and_no_key_and_no_drag_attribute_reaches_the_dom", async () => {
    const { container } = render(
      <LiquidProvider config={config}>
        <LiquidElement as="button" drag={false}>
          off
        </LiquidElement>
        <LiquidElement as="a">plain</LiquidElement>
      </LiquidProvider>,
    );
    const off = container.querySelector("button")!;
    const plain = container.querySelector("a")!;
    await waitFor(() => expect(calls.map((c) => c.el)).toEqual(expect.arrayContaining([off, plain])));
    expect(calls.find((c) => c.el === off)!.opts).toEqual({ drag: false });
    expect(calls.find((c) => c.el === plain)!.opts, "an absent drag passes no key").toBeUndefined();
    expect(off.getAttribute("data-liquid-drag")).toBe("off");
    expect(plain.hasAttribute("data-liquid-drag")).toBe(false);
    expect(off.hasAttribute("drag"), "drag is consumed, never spread").toBe(false);
    expect(error, "no unknown-prop warning").not.toHaveBeenCalled();
  });

  it("given_useLiquidRef_with_drag_false_when_rerendered_with_drag_true_then_observe_ran_once_with_drag_false", async () => {
    const el = document.createElement("button");
    mockRect(el, 10, 20, 100, 50);
    function Hook({ drag }: { drag: boolean }) {
      const refCb = useLiquidRef<HTMLButtonElement>({ drag });
      return <span ref={() => refCb(el)} />;
    }
    const tree = (drag: boolean) => (
      <LiquidProvider config={config}>
        <Hook drag={drag} />
      </LiquidProvider>
    );
    const { rerender } = render(tree(false));
    await waitFor(() => expect(calls.some((c) => c.el === el)).toBe(true));
    rerender(tree(true));
    await settle();
    expect(calls.filter((c) => c.el === el)).toEqual([{ el, opts: { drag: false } }]);
    expect(el.getAttribute("data-liquid-drag"), "captured once (D66-4)").toBe("off");
  });
});
