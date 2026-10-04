/**
 * @vitest-environment jsdom
 * W66 T5: @liquiddom/vue on the fluid API (core dist + shared helpers, A6).
 */
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, watch } from "vue";
import { renderToString } from "@vue/server-renderer";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import * as adapter from "../src/index";
import { LiquidProvider, LiquidPlugin, LiquidElement, useLiquid, useLiquidRef } from "../src/index";
import { elementSlots, freedOf, mockRect, setupFacadeTestEnv, spyBackend, type SpyBackend } from "../../core/ts/__tests__/_facade-helpers";
import { El } from "../../core/ts/src/fluid-layout";

interface ObserveCall { el: HTMLElement; opts: unknown; id: number }
let createSpy: MockInstance | null = null;
let sb: SpyBackend;
let calls: ObserveCall[];
let config: LiquidOptions;
let lastWrapper: VueWrapper<unknown> | null = null;

beforeEach(() => {
  setupFacadeTestEnv();
  sb = spyBackend();
  calls = [];
  config = { testBackend: sb.backend, autoObserve: false, particles: 1024, maxElements: 4 };
  const original = LiquidDOM.create.bind(LiquidDOM);
  createSpy = vi.spyOn(LiquidDOM, "create").mockImplementation(async (options?: LiquidOptions) => {
    const inst = await original(options);
    const observe = inst.observe.bind(inst);
    inst.observe = (el, opts) => {
      const id = observe(el, opts);
      calls.push({ el, opts, id });
      return id;
    };
    return inst;
  });
});
afterEach(() => {
  lastWrapper?.unmount();
  lastWrapper = null;
  createSpy?.mockRestore();
  createSpy = null;
  document.body.replaceChildren();
});

function makeCapture() {
  const ref_: { current: LiquidDOMInstance | null } = { current: null };
  const Capture = defineComponent({
    setup() {
      const inst = useLiquid();
      watch(inst, (v) => { ref_.current = v; }, { immediate: true });
      return () => null;
    },
  });
  return { instanceRef: ref_, Capture };
}
async function waitForInstance(r: { current: LiquidDOMInstance | null }) {
  await vi.waitFor(() => expect(r.current).not.toBeNull());
  await nextTick();
}
const slotsOf = (el: Element) => elementSlots(sb, sb.cores.at(-1)!, calls.filter((c) => c.el === el).at(-1)!.id);

describe("W66 T5: @liquiddom/vue", () => {
  it("given_adapter_index_when_imported_then_exports_are_kept", () => {
    expect(Object.keys(adapter).sort()).toEqual(["LiquidElement", "LiquidKey", "LiquidPlugin", "LiquidProvider", "useLiquid", "useLiquidRef"]);
  });

  it("provider_creates_instance_after_mount", async () => {
    const { instanceRef, Capture } = makeCapture();
    lastWrapper = mount(LiquidProvider, { props: { config }, slots: { default: () => h(Capture) }, attachTo: document.body });
    await waitForInstance(instanceRef);
    expect(document.querySelector("canvas.liquid-canvas")).not.toBeNull();
  });

  it("provider_destroys_instance_on_unmount", async () => {
    const { instanceRef, Capture } = makeCapture();
    const wrapper = mount(LiquidProvider, { props: { config }, slots: { default: () => h(Capture) }, attachTo: document.body });
    await waitForInstance(instanceRef);
    const destroySpy = vi.spyOn(instanceRef.current!, "destroy");
    wrapper.unmount();
    expect(destroySpy).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
  });

  it("useLiquidRef_observes_element_when_attached", async () => {
    const { instanceRef, Capture } = makeCapture();
    const HookButton = defineComponent({ setup() { const elRef = useLiquidRef<HTMLButtonElement>(); return () => h("button", { ref: elRef }); } });
    lastWrapper = mount(LiquidProvider, { props: { config }, slots: { default: () => [h(Capture), h(HookButton)] }, attachTo: document.body });
    const btn = lastWrapper.find("button").element;
    mockRect(btn, 10, 20, 100, 50);
    await waitForInstance(instanceRef);
    await vi.waitFor(() => expect(btn.classList.contains("liquid-element")).toBe(true));
    expect(slotsOf(btn)[El.X]).toBe(10);
  });

  it("useLiquidRef_unobserves_on_unmount", async () => {
    const { instanceRef, Capture } = makeCapture();
    const show = ref(true);
    const HookButton = defineComponent({ setup() { const elRef = useLiquidRef<HTMLButtonElement>(); return () => h("button", { ref: elRef }); } });
    const TestRoot = defineComponent({
      setup: () => () => h(LiquidProvider, { config }, { default: () => [h(Capture), show.value ? h(HookButton) : null] }),
    });
    lastWrapper = mount(TestRoot, { attachTo: document.body });
    const btn = lastWrapper.find("button").element;
    mockRect(btn, 10, 20, 100, 50);
    await waitForInstance(instanceRef);
    await vi.waitFor(() => expect(btn.classList.contains("liquid-element")).toBe(true));
    const unobserveSpy = vi.spyOn(instanceRef.current!, "unobserve");
    show.value = false;
    await flushPromises();
    await nextTick();
    expect(unobserveSpy).toHaveBeenCalledWith(btn);
    expect(btn.classList.contains("liquid-element")).toBe(false);
    expect(slotsOf(btn)[El.W]).toBe(0);
  });

  it("given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options", async () => {
    const { instanceRef, Capture } = makeCapture();
    const HookButton = defineComponent({ setup() { const elRef = useLiquidRef<HTMLButtonElement>({ viscosity: 0.25 }); return () => h("button", { ref: elRef }); } });
    lastWrapper = mount(LiquidProvider, { props: { config }, slots: { default: () => [h(Capture), h(HookButton)] }, attachTo: document.body });
    const btn = lastWrapper.find("button").element;
    mockRect(btn, 0, 0, 100, 40);
    await waitForInstance(instanceRef);
    await vi.waitFor(() => expect(calls.some((c) => c.el === btn)).toBe(true));
    expect(calls.find((c) => c.el === btn)!.opts).toEqual({ viscosity: 0.25 });
    expect(slotsOf(btn)[El.VISCOSITY]).toBe(0.25);
  });

  it("given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them", async () => {
    const { instanceRef, Capture } = makeCapture();
    lastWrapper = mount(LiquidProvider, {
      props: { config },
      slots: { default: () => [h(Capture), h(LiquidElement, { as: "button", viscosity: 0.25, recovery: 1.5 }, { default: () => "go" })] },
      attachTo: document.body,
    });
    const btn = lastWrapper.find("button").element;
    mockRect(btn, 0, 0, 100, 40);
    await waitForInstance(instanceRef);
    await vi.waitFor(() => expect(calls.some((c) => c.el === btn)).toBe(true));
    expect(calls.find((c) => c.el === btn)!.opts).toEqual({ viscosity: 0.25, recovery: 1.5 });
    expect(slotsOf(btn)[El.RECOVERY]).toBe(1.5);
    expect(btn.hasAttribute("viscosity")).toBe(false);
  });

  it("useLiquid_returns_null_outside_provider", async () => {
    const { instanceRef, Capture } = makeCapture();
    lastWrapper = mount(Capture, { attachTo: document.body });
    await flushPromises();
    await nextTick();
    expect(instanceRef.current).toBeNull();
  });

  it("liquidElement_forwards_attrs_and_uses_as_prop", async () => {
    const { instanceRef, Capture } = makeCapture();
    const onClick = vi.fn();
    lastWrapper = mount(LiquidProvider, {
      props: { config },
      slots: { default: () => [h(Capture), h(LiquidElement, { as: "button", class: "my-button", "data-test": "x", onClick }, { default: () => "child text" })] },
      attachTo: document.body,
    });
    await waitForInstance(instanceRef);
    const btn = lastWrapper.find("button");
    expect(btn.classes()).toContain("my-button");
    expect(btn.attributes("data-test")).toBe("x");
    expect(btn.text()).toBe("child text");
    await btn.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ssr_renderToString_does_not_throw", async () => {
    const app = createSSRApp({ render: () => h(LiquidProvider, null, { default: () => h("div", "content") }) });
    await expect(renderToString(app)).resolves.toBeDefined();
  });

  it("plugin_install_provides_instance", async () => {
    const { instanceRef, Capture } = makeCapture();
    const mountTarget = document.createElement("div");
    document.body.appendChild(mountTarget);
    const app = createApp(Capture);
    try {
      app.use(LiquidPlugin, config);
      app.mount(mountTarget);
      await waitForInstance(instanceRef);
      expect(document.querySelector("canvas.liquid-canvas")).not.toBeNull();
    } finally {
      app.unmount();
    }
    expect(document.querySelector("canvas")).toBeNull();
  });
});
