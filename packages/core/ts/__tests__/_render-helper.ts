/**
 * W36 test-side shim: bridges the legacy `observer.render(ctx, viewport)`
 * call pattern (used by W52/W53/W54 tests) to the new buildFrame+Canvas2DRenderer
 * pipeline. Lets pre-W36 tests keep their fake-ctx assertion style.
 */
import type { PhantomObserver } from "../src/phantom-observer";
import { Canvas2DRenderer } from "../src/renderers/canvas2d-renderer";

export interface LegacyRenderViewport {
  viewportWidth?: number;
  viewportHeight?: number;
  preserveBackgrounds?: boolean;
  cullMargin?: number;
}

/**
 * Drive a single render using a caller-supplied fake `CanvasRenderingContext2D`.
 * Constructs a fresh Canvas2DRenderer per call to keep tests isolated.
 *
 * `Canvas2DRenderer.init()` resolves its Promise synchronously (just stores
 * canvas/ctx refs), so callers don't need to await.
 */
export function renderWithFakeCtx(
  observer: PhantomObserver,
  fakeCtx: CanvasRenderingContext2D,
  viewport: LegacyRenderViewport = {},
): void {
  // Pre-W36 tests' fake-ctx objects only mock the methods the old
  // observer.render(ctx) called (no setTransform/clearRect — those lived
  // in the RAF loop). After W36 Canvas2DRenderer.render() calls them
  // unconditionally, so inject no-op stubs when missing.
  const ctxAny = fakeCtx as unknown as Record<string, unknown>;
  for (const m of ["setTransform", "clearRect", "arc"] as const) {
    if (typeof ctxAny[m] !== "function") ctxAny[m] = () => {};
  }

  // jsdom-free fallback: synthesize a minimal canvas surrogate when running
  // in a node-env test file (e.g., phantom-observer.test.ts which has no
  // `@vitest-environment jsdom` annotation).
  const canvas =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : ({ getContext: () => fakeCtx } as unknown as HTMLCanvasElement);
  if (typeof document !== "undefined") {
    canvas.getContext = (() => fakeCtx) as HTMLCanvasElement["getContext"];
  }
  const renderer = new Canvas2DRenderer();
  void renderer.init(canvas);
  const frame = observer.buildFrame({
    widthCss: viewport.viewportWidth ?? 1e6,
    heightCss: viewport.viewportHeight ?? 1e6,
    dpr: 1,
    cullMargin: viewport.cullMargin ?? 100,
    preserveBackgrounds: viewport.preserveBackgrounds === true,
  });
  renderer.render(frame);
}
