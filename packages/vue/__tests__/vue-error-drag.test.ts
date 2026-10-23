/**
 * @vitest-environment jsdom
 * W85 (D85-2, D85-3): the Vue provider's and plugin's error state and the `drag` prop. A stopped
 * instance is destroyed, `useLiquid().value` is null and `useLiquidError().value` the error;
 * `config.onError` is still called, after the adapter's handler. A `create()` rejection sets the
 * same error. No retry; a remount clears it. `drag` is a Boolean prop with `default: undefined`,
 * so an absent prop passes no key; it never reaches the DOM.
 */
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createApp, defineComponent, h, nextTick, ref, toRaw, type Ref } from "vue";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import { LiquidProvider, LiquidPlugin, LiquidElement, useLiquid, useLiquidError } from "../src/index";
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
let lastWrapper: VueWrapper<unknown> | null = null;

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
  lastWrapper?.unmount();
  lastWrapper = null;
  createSpy?.mockRestore();
  createSpy = null;
  error.mockRestore();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  document.body.replaceChildren();
});

const FRAME_FAILED = /frame failed; the instance stopped/;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

/** The refs the newest Capture injected (a remount injects new ones). */
function capture() {
  const got: { instance: Ref<LiquidDOMInstance | null> | null; error: Ref<unknown> | null } = { instance: null, error: null };
  const Capture = defineComponent({
    setup() {
      got.instance = useLiquid();
      got.error = useLiquidError();
      return () => null;
    },
  });
  return { got, Capture };
}

function stopNewest(err: Error): void {
  vi.spyOn(sb.cores.at(-1)!, "tick").mockImplementation(() => {
    throw err;
  });
  clock.advance(1);
}

describe("W85 – the Vue error state (D85-2)", () => {
  it("given_a_live_provider_when_its_instance_stops_then_it_is_destroyed_useLiquid_is_null_useLiquidError_is_the_error_and_config_onError_runs_after", async () => {
    const order: string[] = [];
    const onError = vi.fn((err: unknown) => {
      order.push(`config.onError ${(err as Error).message}, canvases ${document.querySelectorAll("canvas").length}`);
    });
    const { got, Capture } = capture();
    lastWrapper = mount(LiquidProvider, { props: { config: { ...config, onError } }, slots: { default: () => h(Capture) }, attachTo: document.body });
    await vi.waitFor(() => expect(got.instance!.value).not.toBeNull());
    const destroy = vi.spyOn(created[0]!, "destroy");
    const boom = new Error("boom");
    stopNewest(boom);
    expect(destroy).toHaveBeenCalledOnce();
    expect(got.instance!.value).toBeNull();
    expect(got.error!.value).toBe(boom);
    expect(onError).toHaveBeenCalledOnce();
    expect(order, "config.onError runs after the adapter's handler").toEqual(["config.onError boom, canvases 0"]);
    expect(error.mock.calls.filter((c) => FRAME_FAILED.test(String(c[0])))).toHaveLength(1);
    await settle();
    expect(createSpy, "no retry").toHaveBeenCalledTimes(1);
  });

  it("given_create_rejects_when_the_provider_mounts_then_useLiquidError_is_the_rejection_and_its_console_error_stays", async () => {
    const loadFailed = new Error("no wasm");
    const { got, Capture } = capture();
    lastWrapper = mount(LiquidProvider, {
      props: { config: { autoObserve: false, loader: () => Promise.reject(loadFailed) } },
      slots: { default: () => h(Capture) },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(got.error!.value).toBe(loadFailed));
    expect(got.instance!.value).toBeNull();
    expect(error.mock.calls.some((c) => String(c[0]).includes("LiquidProvider failed to create instance") && c[1] === loadFailed)).toBe(true);
    await settle();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("given_a_config_onError_that_is_not_a_function_when_the_provider_mounts_then_create_rejects_with_its_TypeError_and_the_error_state_holds_it", async () => {
    const { got, Capture } = capture();
    lastWrapper = mount(LiquidProvider, {
      props: { config: { ...config, onError: "log" as never } },
      slots: { default: () => h(Capture) },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(got.error!.value).toBeInstanceOf(TypeError));
    expect((got.error!.value as Error).message).toMatch(/onError must be a function/);
    expect(got.instance!.value).toBeNull();
  });

  it("given_a_stopped_provider_when_it_is_remounted_then_a_new_instance_arrives_and_the_error_is_cleared", async () => {
    const { got, Capture } = capture();
    const show = ref(true);
    const Root = defineComponent({ setup: () => () => (show.value ? h(LiquidProvider, { config }, { default: () => h(Capture) }) : null) });
    lastWrapper = mount(Root, { attachTo: document.body });
    await vi.waitFor(() => expect(got.instance!.value).not.toBeNull());
    stopNewest(new Error("boom"));
    expect(got.error!.value).toBeInstanceOf(Error);
    show.value = false;
    await nextTick();
    show.value = true;
    await nextTick();
    expect(got.error!.value, "a new provider, a new error ref").toBeNull();
    await vi.waitFor(() => expect(got.instance!.value).not.toBeNull());
    expect(toRaw(got.instance!.value)).toBe(created[1]);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it("given_the_plugin_when_its_instance_stops_or_create_rejects_then_the_injected_refs_hold_null_and_the_error", async () => {
    const { got, Capture } = capture();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const app = createApp(Capture);
    try {
      app.use(LiquidPlugin, config);
      app.mount(target);
      await vi.waitFor(() => expect(got.instance!.value).not.toBeNull());
      const destroy = vi.spyOn(created[0]!, "destroy");
      const boom = new Error("boom");
      stopNewest(boom);
      expect(destroy).toHaveBeenCalledOnce();
      expect(got.instance!.value).toBeNull();
      expect(got.error!.value).toBe(boom);
    } finally {
      app.unmount();
    }
    const loadFailed = new Error("no wasm");
    const app2 = createApp(Capture);
    try {
      app2.use(LiquidPlugin, { autoObserve: false, loader: () => Promise.reject(loadFailed) });
      app2.mount(target);
      await vi.waitFor(() => expect(got.error!.value).toBe(loadFailed));
      expect(got.instance!.value).toBeNull();
    } finally {
      app2.unmount();
    }
  });
});

describe("W85 – a stop during create() in the Vue provider (design resolution 11)", () => {
  it("given_an_instance_that_stops_while_create_awaits_the_renderer_when_create_resolves_then_the_provider_destroys_it_on_arrival_and_holds_the_error", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    const { got, Capture } = capture();
    lastWrapper = mount(LiquidProvider, {
      props: { config: { ...config, renderer: "canvas2d" } },
      slots: { default: () => h(Capture) },
      attachTo: document.body,
    });
    // onMounted called create(): the core exists, the renderer init is pending.
    expect(sb.cores).toHaveLength(1);
    const oom = new Error("oom at create");
    vi.spyOn(sb.cores[0]!, "resize_world").mockImplementation(() => {
      throw oom;
    });
    Object.defineProperty(window, "innerWidth", { value: 3000, configurable: true });
    await vi.waitFor(() => expect(got.error!.value).toBe(oom));
    await vi.waitFor(() => expect(created).toHaveLength(1));
    await settle();
    expect(got.instance!.value, "the stopped instance was never handed out").toBeNull();
    expect(document.querySelector("canvas"), "destroyed on arrival").toBeNull();
    expect(sb.calls.filter((c) => c.method === "free")).toHaveLength(1);
  });
});

describe("W85 – drag in the Vue adapter (D85-3)", () => {
  it("given_LiquidElement_with_drag_false_present_or_absent_when_mounted_then_observe_gets_drag_false_true_or_no_key_and_no_drag_attribute", async () => {
    lastWrapper = mount(LiquidProvider, {
      props: { config },
      slots: {
        default: () => [
          h(LiquidElement, { as: "button", drag: false }, { default: () => "off" }),
          h(LiquidElement, { as: "a" }, { default: () => "plain" }),
          h(LiquidElement, { as: "span", drag: "" }, { default: () => "present" }),
        ],
      },
      attachTo: document.body,
    });
    const off = lastWrapper.find("button").element;
    const plain = lastWrapper.find("a").element;
    const present = lastWrapper.find("span").element;
    for (const el of [off, plain, present]) mockRect(el, 0, 0, 100, 40);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.find((c) => c.el === off)!.opts).toEqual({ drag: false });
    expect(calls.find((c) => c.el === plain)!.opts, "absent: default undefined, no key (no Boolean cast to false)").toBeUndefined();
    expect(calls.find((c) => c.el === present)!.opts, "a bare drag attribute is true").toEqual({ drag: true });
    expect(off.getAttribute("data-liquid-drag")).toBe("off");
    expect(plain.hasAttribute("data-liquid-drag")).toBe(false);
    for (const el of [off, plain, present]) expect(el.hasAttribute("drag"), el.tagName).toBe(false);
  });

  it("given_LiquidElement_with_a_reactive_drag_false_changed_to_true_after_mount_then_observe_ran_once_with_drag_false", async () => {
    const drag = ref(false);
    const Root = defineComponent({
      setup: () => () => h(LiquidProvider, { config }, { default: () => h(LiquidElement, { as: "button", drag: drag.value }, { default: () => "go" }) }),
    });
    lastWrapper = mount(Root, { attachTo: document.body });
    const btn = lastWrapper.find("button").element;
    mockRect(btn, 0, 0, 100, 40);
    await vi.waitFor(() => expect(calls.some((c) => c.el === btn)).toBe(true));
    drag.value = true;
    await flushPromises();
    await nextTick();
    await settle();
    expect(calls.filter((c) => c.el === btn)).toEqual([{ el: btn, opts: { drag: false } }]);
    expect(btn.getAttribute("data-liquid-drag"), "captured once (D66-4)").toBe("off");
  });
});
