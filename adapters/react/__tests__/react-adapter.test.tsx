/**
 * @vitest-environment jsdom
 *
 * Ward 047: @liquiddom/react Adapter Package — red phase tests.
 * Tests #1-#9 per ward-047.md spec §Tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  LiquidProvider,
  LiquidElement,
  useLiquid,
  useLiquidRef,
} from "../index";
import type { LiquidDOMInstance } from "../../../ts/src/index";

// jsdom polyfills — match runtime-truth.test.ts:11-18 pattern
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

function mockedButton(opts: { x: number; y: number; w: number; h: number }) {
  const el = document.createElement("button");
  el.getBoundingClientRect = () => ({
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
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  return el;
}

function makeCapture() {
  const ref: { current: LiquidDOMInstance | null } = { current: null };
  function Capture() {
    const inst = useLiquid();
    ref.current = inst;
    return null;
  }
  return { ref, Capture };
}

describe("Ward 047: LiquidProvider", () => {
  // ── Test #1: provider creates instance on mount ──
  it("provider_creates_instance_after_mount", async () => {
    const { ref, Capture } = makeCapture();

    render(
      <LiquidProvider>
        <Capture />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  // ── Test #2: provider destroys instance on unmount (spied) ──
  it("provider_destroys_instance_on_unmount", async () => {
    const { ref, Capture } = makeCapture();

    const { unmount } = render(
      <LiquidProvider>
        <Capture />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(document.querySelector("canvas")).not.toBeNull();

    const destroySpy = vi.spyOn(ref.current!, "destroy");
    unmount();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).toBeNull();
  });
});

describe("Ward 047: useLiquidRef", () => {
  // ── Test #3: ref attached → observe called → slot[0] holds element x ──
  it("useLiquidRef_observes_element_when_attached", async () => {
    const { ref, Capture } = makeCapture();
    const el = mockedButton({ x: 10, y: 20, w: 100, h: 50 });

    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el as unknown as HTMLButtonElement)} />;
    }

    render(
      <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
        <Capture />
        <HookButton />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    await waitFor(() => {
      const buf = ref.current!.getBuffer();
      expect(buf).not.toBeNull();
      expect(buf![0]).toBe(10);
    });
  });

  // ── Test #4: ref detaches → unobserve called → slot[2] (width) zeroed ──
  it("useLiquidRef_unobserves_on_unmount", async () => {
    const { ref, Capture } = makeCapture();
    const el = mockedButton({ x: 10, y: 20, w: 100, h: 50 });

    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el as unknown as HTMLButtonElement)} />;
    }

    function Conditional({ show }: { show: boolean }) {
      return show ? <HookButton /> : null;
    }

    const { rerender } = render(
      <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
        <Capture />
        <Conditional show={true} />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    await waitFor(() => expect(ref.current!.getBuffer()![2]).toBe(100));

    rerender(
      <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
        <Capture />
        <Conditional show={false} />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current!.getBuffer()![2]).toBe(0));
  });

  // ── Test #9: liquidType option forwarded to observe → slot[5] ──
  it("useLiquidRef_forwards_liquidType_to_observe", async () => {
    const { ref, Capture } = makeCapture();
    const el = mockedButton({ x: 10, y: 20, w: 100, h: 50 });

    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>({ liquidType: 4 });
      return <span ref={() => refCb(el as unknown as HTMLButtonElement)} />;
    }

    render(
      <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
        <Capture />
        <HookButton />
      </LiquidProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    await waitFor(() => {
      // slot[5] = liquid_type per FFI contract (CLAUDE.md entity buffer table)
      expect(ref.current!.getBuffer()![5]).toBe(4);
    });
  });
});

describe("Ward 047: useLiquid outside provider", () => {
  // ── Test #5: no provider → null ──
  it("useLiquid_returns_null_outside_provider", () => {
    const { result } = renderHook(() => useLiquid());
    expect(result.current).toBeNull();
  });
});

describe("Ward 047: strict mode", () => {
  // ── Test #6: strict-mode tree mounts cleanly; observe is idempotent ──
  // Note: React 18 strict-mode double-invokes effects only on the *initial*
  // mount of the strict-mode tree. The provider's effect therefore double-
  // invokes during initial mount (creating two instances; the first is
  // destroyed via the cancellation flag, the second is kept). When useLiquidRef's
  // first invocation runs with instance=null it bails; the eventual setInstance
  // triggers a single observe on the surviving instance. The strict-mode
  // invariant we verify is: the final state is correct AND observe is
  // idempotent (W14) — so any double-invocations cannot corrupt the slot.
  it("strict_mode_tree_observes_correctly_and_is_idempotent", async () => {
    const { ref, Capture } = makeCapture();
    const el = mockedButton({ x: 10, y: 20, w: 100, h: 50 });

    function HookButton() {
      const refCb = useLiquidRef<HTMLButtonElement>();
      return <span ref={() => refCb(el as unknown as HTMLButtonElement)} />;
    }

    render(
      <StrictMode>
        <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
          <Capture />
          <HookButton />
        </LiquidProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    // The strict-mode tree's eventual state must be correct: width === rect.
    // If the provider's double-invoke had failed (e.g., setInstance on the
    // destroyed first instance), this assertion would fail.
    await waitFor(() => expect(ref.current!.getBuffer()![2]).toBe(100));

    // W14 idempotency directly: re-observing the same element returns same id.
    // This is the guarantee that allows useLiquidRef to be strict-mode safe
    // even if React internals invoke observe more than once.
    const firstId = ref.current!.observe(el);
    const secondId = ref.current!.observe(el);
    expect(firstId).toBe(secondId);
  });
});

describe("Ward 047: LiquidElement", () => {
  // ── Test #7: forwards HTML attrs, uses `as` prop, AND observes ──
  it("liquidElement_forwards_html_attrs_and_uses_as_prop", async () => {
    const onClick = vi.fn();
    const { ref, Capture } = makeCapture();

    function App({ showElement }: { showElement: boolean }) {
      return (
        <LiquidProvider config={{ capacity: 1, autoObserve: false }}>
          <Capture />
          {showElement && (
            <LiquidElement
              as="button"
              className="my-button"
              data-test="x"
              onClick={onClick}
            >
              child text
            </LiquidElement>
          )}
        </LiquidProvider>
      );
    }

    const { container, rerender } = render(<App showElement={false} />);
    await waitFor(() => expect(ref.current).not.toBeNull());

    // Verify LiquidElement actually goes through useLiquidRef → observe.
    const observeSpy = vi.spyOn(ref.current!, "observe");
    rerender(<App showElement={true} />);

    await waitFor(() => {
      const btn = container.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.className).toBe("my-button");
      expect(btn!.getAttribute("data-test")).toBe("x");
      expect(btn!.textContent).toBe("child text");
    });

    expect(observeSpy).toHaveBeenCalled();

    fireEvent.click(container.querySelector("button")!);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Ward 047: SSR safety", () => {
  // ── Test #8: renderToString does not throw ──
  it("ssr_renderToString_does_not_throw", () => {
    expect(() =>
      renderToString(
        <LiquidProvider>
          <div>content</div>
        </LiquidProvider>,
      ),
    ).not.toThrow();
  });
});
