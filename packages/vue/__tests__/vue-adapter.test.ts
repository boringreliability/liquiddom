/**
 * @vitest-environment jsdom
 *
 * Ward 048: @liquiddom/vue Adapter Package — red phase tests.
 * Tests #1-#9 per ward-048.md spec §10.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, watch } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  LiquidProvider,
  LiquidPlugin,
  LiquidElement,
  useLiquid,
  useLiquidRef,
} from "../src/index";
import type { LiquidDOMInstance } from "liquiddom";

// jsdom polyfills — match runtime-truth.test.ts pattern
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

let lastWrapper: VueWrapper<unknown> | null = null;
afterEach(() => {
  if (lastWrapper) {
    lastWrapper.unmount();
    lastWrapper = null;
  }
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

/** Wait for the provider's async create + watch propagation to settle. */
async function waitForInstance(instanceRef: { current: LiquidDOMInstance | null }) {
  await vi.waitFor(() => {
    expect(instanceRef.current).not.toBeNull();
  });
  await nextTick();
}

function mockRect(el: Element, opts: { x: number; y: number; w: number; h: number }) {
  (el as HTMLElement).getBoundingClientRect = () => ({
    x: opts.x,
    y: opts.y,
    width: opts.w,
    height: opts.h,
    top: opts.y,
    left: opts.x,
    right: opts.x + opts.w,
    bottom: opts.y + opts.h,
    toJSON: () => {},
  });
  (el as HTMLElement).setPointerCapture = () => {};
  (el as HTMLElement).releasePointerCapture = () => {};
}

describe("Ward 048: LiquidProvider", () => {
  // ── Test #1: provider creates instance on mount ──
  it("provider_creates_instance_after_mount", async () => {
    const { instanceRef, Capture } = makeCapture();

    lastWrapper = mount(LiquidProvider, {
      slots: { default: () => h(Capture) },
      attachTo: document.body,
    });

    await waitForInstance(instanceRef);

    expect(instanceRef.current).not.toBeNull();
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  // ── Test #2: provider destroys instance on unmount ──
  it("provider_destroys_instance_on_unmount", async () => {
    const { instanceRef, Capture } = makeCapture();

    const wrapper = mount(LiquidProvider, {
      slots: { default: () => h(Capture) },
      attachTo: document.body,
    });

    await waitForInstance(instanceRef);
    expect(instanceRef.current).not.toBeNull();
    expect(document.querySelector("canvas")).not.toBeNull();

    const destroySpy = vi.spyOn(instanceRef.current!, "destroy");
    wrapper.unmount();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).toBeNull();
  });
});

describe("Ward 048: useLiquidRef", () => {
  // ── Test #3: ref attached → observe called → slot[0] holds rect.x ──
  it("useLiquidRef_observes_element_when_attached", async () => {
    const { instanceRef, Capture } = makeCapture();

    const HookButton = defineComponent({
      setup() {
        const elRef = useLiquidRef<HTMLButtonElement>();
        return () => h("button", { ref: elRef });
      },
    });

    lastWrapper = mount(LiquidProvider, {
      props: { config: { capacity: 1, autoObserve: false } },
      slots: { default: () => [h(Capture), h(HookButton)] },
      attachTo: document.body,
    });

    const btn = lastWrapper.find("button").element;
    mockRect(btn, { x: 10, y: 20, w: 100, h: 50 });

    await waitForInstance(instanceRef);

    const buf = instanceRef.current!.getBuffer()!;
    expect(buf[0]).toBe(10);
  });

  // ── Test #4: ref detaches via conditional render → unobserve fires → slot[2] zeroed ──
  it("useLiquidRef_unobserves_on_unmount", async () => {
    const { instanceRef, Capture } = makeCapture();
    const show = ref(true);

    const HookButton = defineComponent({
      setup() {
        const elRef = useLiquidRef<HTMLButtonElement>();
        return () => h("button", { ref: elRef });
      },
    });

    const TestRoot = defineComponent({
      setup: () => () =>
        h(
          LiquidProvider,
          { config: { capacity: 1, autoObserve: false } },
          { default: () => [h(Capture), show.value ? h(HookButton) : null] },
        ),
    });

    lastWrapper = mount(TestRoot, { attachTo: document.body });

    const btn = lastWrapper.find("button").element;
    mockRect(btn, { x: 10, y: 20, w: 100, h: 50 });

    await waitForInstance(instanceRef);
    expect(instanceRef.current!.getBuffer()![2]).toBe(100);

    // Spy on unobserve BEFORE detaching — verifies the adapter actually
    // calls the unobserve API (not just that slot[2] happens to zero, which
    // could fire from getBoundingClientRect on a detached node in jsdom).
    const unobserveSpy = vi.spyOn(instanceRef.current!, "unobserve");
    show.value = false;
    await flushPromises();
    await nextTick();

    expect(unobserveSpy).toHaveBeenCalledWith(btn);
    expect(instanceRef.current!.getBuffer()![2]).toBe(0);
  });

  // ── Test #8: liquidType option forwarded to observe → slot[5] ──
  it("useLiquidRef_forwards_liquidType_to_observe", async () => {
    const { instanceRef, Capture } = makeCapture();

    const HookButton = defineComponent({
      setup() {
        const elRef = useLiquidRef<HTMLButtonElement>({ liquidType: 4 });
        return () => h("button", { ref: elRef });
      },
    });

    lastWrapper = mount(LiquidProvider, {
      props: { config: { capacity: 1, autoObserve: false } },
      slots: { default: () => [h(Capture), h(HookButton)] },
      attachTo: document.body,
    });

    const btn = lastWrapper.find("button").element;
    mockRect(btn, { x: 10, y: 20, w: 100, h: 50 });

    await waitForInstance(instanceRef);

    expect(instanceRef.current!.getBuffer()![5]).toBe(4);
  });
});

describe("Ward 048: useLiquid outside provider", () => {
  // ── Test #5: no provider → null ref ──
  it("useLiquid_returns_null_outside_provider", async () => {
    const { instanceRef, Capture } = makeCapture();

    lastWrapper = mount(Capture, { attachTo: document.body });

    // No provider — instance never becomes non-null; flushPromises+nextTick suffices.
    await flushPromises();
    await nextTick();

    expect(instanceRef.current).toBeNull();
  });
});

describe("Ward 048: LiquidElement", () => {
  // ── Test #6: forwards attrs, uses `as` prop, click fires once ──
  it("liquidElement_forwards_attrs_and_uses_as_prop", async () => {
    const { instanceRef, Capture } = makeCapture();
    const onClick = vi.fn();

    lastWrapper = mount(LiquidProvider, {
      props: { config: { capacity: 1, autoObserve: false } },
      slots: {
        default: () => [
          h(Capture),
          h(
            LiquidElement,
            { as: "button", class: "my-button", "data-test": "x", onClick },
            { default: () => "child text" },
          ),
        ],
      },
      attachTo: document.body,
    });

    await waitForInstance(instanceRef);

    const btn = lastWrapper.find("button");
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).toContain("my-button");
    expect(btn.attributes("data-test")).toBe("x");
    expect(btn.text()).toBe("child text");

    await btn.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Ward 048: SSR safety", () => {
  // ── Test #7: renderToString does not throw ──
  it("ssr_renderToString_does_not_throw", async () => {
    const app = createSSRApp({
      render: () =>
        h(LiquidProvider, null, { default: () => h("div", "content") }),
    });
    await expect(renderToString(app)).resolves.toBeDefined();
  });
});

describe("Ward 048: LiquidPlugin", () => {
  // ── Test #9: plugin install provides instance ──
  it("plugin_install_provides_instance", async () => {
    const { instanceRef, Capture } = makeCapture();

    // Mount to a dedicated child div, NOT document.body — `app.mount(target)`
    // replaces target's content. LiquidDOM.create() appends a canvas to
    // document.body synchronously inside the plugin's install, so mounting
    // to body would wipe the canvas before the test can observe it.
    const mountTarget = document.createElement("div");
    document.body.appendChild(mountTarget);

    const app = createApp(Capture);
    try {
      app.use(LiquidPlugin, { capacity: 4 });
      app.mount(mountTarget);

      await waitForInstance(instanceRef);

      expect(instanceRef.current).not.toBeNull();
      expect(document.querySelector("canvas")).not.toBeNull();
    } finally {
      app.unmount();
    }
    expect(document.querySelector("canvas")).toBeNull();
  });
});
