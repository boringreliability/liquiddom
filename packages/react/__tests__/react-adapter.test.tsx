/**
 * @vitest-environment jsdom
 * W66 T5: @liquiddom/react on the fluid API. `liquiddom` resolves to core's
 * dist; the shared core helpers are imported by relative path (A6).
 */
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest";
import { render, renderHook, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import * as adapter from "../src/index";
import { LiquidProvider, LiquidElement, useLiquid, useLiquidRef } from "../src/index";
import { elementSlots, freedOf, mockRect, setupFacadeTestEnv, spyBackend, type SpyBackend } from "../../core/ts/__tests__/_facade-helpers";
import { El } from "../../core/ts/src/fluid-layout";
import { installFakeGpuLifecycle } from "../../core/ts/__tests__/_fake-gpu";

interface ObserveCall { el: HTMLElement; opts: unknown; id: number }
let createSpy: MockInstance | null = null;
let sb: SpyBackend;
let calls: ObserveCall[];
let config: LiquidOptions;

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
  cleanup();
  createSpy?.mockRestore();
  createSpy = null;
  document.body.replaceChildren();
});

function detachedButton(): HTMLButtonElement {
  const el = document.createElement("button");
  mockRect(el, 10, 20, 100, 50);
  return el;
}
function makeCapture() {
  const ref: { current: LiquidDOMInstance | null } = { current: null };
  function Capture() {
    ref.current = useLiquid();
    return null;
  }
  return { ref, Capture };
}
const slotsOf = (el: HTMLElement) => {
  const call = calls.filter((c) => c.el === el).at(-1)!;
  return elementSlots(sb, sb.cores.at(-1)!, call.id);
};

describe("W66 T5: @liquiddom/react", () => {
  it("given_adapter_index_when_imported_then_exports_are_kept", () => {
    expect(Object.keys(adapter).sort()).toEqual(["LiquidContext", "LiquidElement", "LiquidProvider", "useLiquid", "useLiquidRef"]);
  });

  it("provider_creates_instance_after_mount", async () => {
    const { ref, Capture } = makeCapture();
    render(<LiquidProvider config={config}><Capture /></LiquidProvider>);
    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(document.querySelector("canvas.liquid-canvas")).not.toBeNull();
  });

  it("provider_destroys_instance_on_unmount", async () => {
    const { ref, Capture } = makeCapture();
    const { unmount } = render(<LiquidProvider config={config}><Capture /></LiquidProvider>);
    await waitFor(() => expect(ref.current).not.toBeNull());
    const destroySpy = vi.spyOn(ref.current!, "destroy");
    unmount();
    expect(destroySpy).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
  });

  it("useLiquidRef_observes_element_when_attached", async () => {
    const el = detachedButton();
    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el)} />;
    }
    render(<LiquidProvider config={config}><HookButton /></LiquidProvider>);
    await waitFor(() => expect(el.classList.contains("liquid-element")).toBe(true));
    expect(slotsOf(el)[El.X]).toBe(10);
    expect(slotsOf(el)[El.W]).toBe(100);
  });

  it("useLiquidRef_unobserves_on_unmount", async () => {
    const el = detachedButton();
    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el)} />;
    }
    const tree = (show: boolean) => <LiquidProvider config={config}>{show ? <HookButton /> : null}</LiquidProvider>;
    const { rerender } = render(tree(true));
    await waitFor(() => expect(el.classList.contains("liquid-element")).toBe(true));
    rerender(tree(false));
    await waitFor(() => expect(el.classList.contains("liquid-element")).toBe(false));
    expect(slotsOf(el)[El.W]).toBe(0);
  });

  it("given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options", async () => {
    const el = detachedButton();
    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>({ viscosity: 0.25 });
      return <span ref={() => refCb(el)} />;
    }
    render(<LiquidProvider config={config}><HookButton /></LiquidProvider>);
    await waitFor(() => expect(calls.some((c) => c.el === el)).toBe(true));
    expect(calls.find((c) => c.el === el)!.opts).toEqual({ viscosity: 0.25 });
    expect(slotsOf(el)[El.VISCOSITY]).toBe(0.25);
    expect(Number.isNaN(slotsOf(el)[El.RECOVERY])).toBe(true);
  });

  it("given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them", async () => {
    const { container } = render(
      <LiquidProvider config={config}>
        <LiquidElement as="button" viscosity={0.25} recovery={1.5}>go</LiquidElement>
      </LiquidProvider>,
    );
    const btn = container.querySelector("button")!;
    await waitFor(() => expect(calls.some((c) => c.el === btn)).toBe(true));
    expect(calls.find((c) => c.el === btn)!.opts).toEqual({ viscosity: 0.25, recovery: 1.5 });
    expect(slotsOf(btn)[El.RECOVERY]).toBe(1.5);
    expect(btn.hasAttribute("viscosity")).toBe(false);
    expect(btn.hasAttribute("recovery")).toBe(false);
  });

  it("given_LiquidElement_rerendered_with_new_viscosity_when_observed_then_captured_once_D66_4", async () => {
    const tree = (v: number) => (
      <LiquidProvider config={config}>
        <LiquidElement as="button" viscosity={v}>go</LiquidElement>
      </LiquidProvider>
    );
    const { container, rerender } = render(tree(0.25));
    const btn = container.querySelector("button")!;
    await waitFor(() => expect(calls.some((c) => c.el === btn)).toBe(true));
    rerender(tree(0.9));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.el === btn)).toHaveLength(1);
    expect(slotsOf(btn)[El.VISCOSITY]).toBe(0.25);
  });

  it("useLiquid_returns_null_outside_provider", () => {
    const { result } = renderHook(() => useLiquid());
    expect(result.current).toBeNull();
  });

  it("strict_mode_tree_observes_correctly_and_is_idempotent", async () => {
    const { ref, Capture } = makeCapture();
    const el = detachedButton();
    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el)} />;
    }
    render(<StrictMode><LiquidProvider config={config}><Capture /><HookButton /></LiquidProvider></StrictMode>);
    await waitFor(() => expect(el.classList.contains("liquid-element")).toBe(true));
    expect(slotsOf(el)[El.W]).toBe(100);
    expect(ref.current!.observe(el)).toBe(ref.current!.observe(el));
  });

  it("liquidElement_forwards_html_attrs_and_uses_as_prop", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <LiquidProvider config={config}>
        <LiquidElement as="button" className="my-button" data-test="x" onClick={onClick}>child text</LiquidElement>
      </LiquidProvider>,
    );
    const btn = container.querySelector("button")!;
    await waitFor(() => expect(btn.classList.contains("liquid-element")).toBe(true));
    expect(btn.classList.contains("my-button")).toBe(true);
    expect(btn.getAttribute("data-test")).toBe("x");
    expect(btn.textContent).toBe("child text");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ssr_renderToString_does_not_throw", () => {
    expect(() => renderToString(<LiquidProvider><div>content</div></LiquidProvider>)).not.toThrow();
  });

  it("W72_given_provider_unmounted_while_webgpu_init_is_pending_when_init_completes_then_no_canvas_the_device_is_destroyed_and_no_warning", async () => {
    // README Review Focus 5: the adapter's cancel path (destroy as soon as create resolves).
    const gpu = installFakeGpuLifecycle({ holdInit: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { unmount } = render(
        <LiquidProvider config={{ ...config, renderer: "webgpu" }}>
          <span />
        </LiquidProvider>,
      );
      await waitFor(() => expect(gpu.devices).toHaveLength(1)); // init parked after requestDevice
      unmount();
      gpu.releaseInit();
      await waitFor(() => expect(gpu.devices[0]!.destroyed).toBe(1));
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(document.querySelector("canvas")).toBeNull();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
      gpu.restore();
    }
  });
});
