/**
 * @vitest-environment jsdom
 *
 * Ward 053: Border-Radius Clip in preserveBackgrounds — red phase tests.
 * Tests #1-#4 per ward-053.md spec §Tests.
 *
 * Strategy: pass a hand-rolled fake ctx with vi.fn() spies directly to
 * PhantomObserver.render(). The renderer's only contact with the canvas is
 * through the ctx object, so a fake satisfies the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PhantomObserver, FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/phantom-observer";

// jsdom polyfills — match runtime-truth.test.ts pattern
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Fake canvas 2D context with vi.fn() spies. Methods needed by render():
 *  - clip path: save, restore, beginPath, rect, roundRect, clip
 *  - particle path: moveTo, lineTo, bezierCurveTo, arcTo (avoid undefined-method errors only — NOT asserted in clip tests)
 *  - draw: fill
 *  - state: fillStyle (assignable)
 */
function makeFakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
  };
}

/** Element factory with a bounded rect — matches liquiddom-api.test.ts pattern. */
function mockedEl(x: number, y: number, w: number, h: number) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    x, y, width: w, height: h,
    top: y, left: x, right: x + w, bottom: y + h,
    toJSON: () => {},
  });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  return el;
}

/** Construct an observer with a non-null particleBuffer so fill() runs. */
function makeObserver(capacity: number) {
  const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
  return new PhantomObserver(capacity, { particleView });
}

/** Set up one observed element with the given rect and slot[8] radius. */
function setupClipTest(rect: { x: number; y: number; w: number; h: number }, radius = 0) {
  const fakeCtx = makeFakeCtx();
  const observer = makeObserver(4);
  const el = mockedEl(rect.x, rect.y, rect.w, rect.h);
  document.body.appendChild(el);
  const id = observer.observe(el);
  if (radius !== 0) observer.getBuffer()[id * FLOATS_PER_ENTITY + 8] = radius;
  const ctx = fakeCtx as unknown as CanvasRenderingContext2D;
  return { fakeCtx, observer, ctx };
}

const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 };

describe("Ward 053: Border-Radius Clip", () => {
  beforeEach(() => {
    // Clean DOM between tests so observer setup doesn't leak.
    document.body.replaceChildren();
  });

  // ── Test #1: r > 0 → ctx.roundRect with element rect AND clip("evenodd") ──
  it("clip_uses_roundRect_when_radius_present", () => {
    const { fakeCtx, observer, ctx } = setupClipTest({ x: 100, y: 50, w: 200, h: 80 }, 10);

    observer.render(ctx, { preserveBackgrounds: true, ...VIEWPORT });

    expect(fakeCtx.roundRect).toHaveBeenCalledWith(100, 50, 200, 80, 10);
    expect(fakeCtx.rect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(fakeCtx.rect).not.toHaveBeenCalledWith(100, 50, 200, 80);
    expect(fakeCtx.clip).toHaveBeenCalledWith("evenodd");
  });

  // ── Test #2: r === 0 → plain rect (no roundRect, regression-safe) ──
  it("clip_uses_rect_when_radius_zero", () => {
    // slot[8] left at default 0 (parseBorderRadius('') === 0)
    const { fakeCtx, observer, ctx } = setupClipTest({ x: 100, y: 50, w: 200, h: 80 });

    observer.render(ctx, { preserveBackgrounds: true, ...VIEWPORT });

    expect(fakeCtx.rect).toHaveBeenCalledWith(100, 50, 200, 80);
    expect(fakeCtx.roundRect).not.toHaveBeenCalled();
  });

  // ── Test #3: preserveBackgrounds=false → no clip ops, but particles still drawn ──
  it("clip_skipped_when_preserveBackgrounds_false", () => {
    const { fakeCtx, observer, ctx } = setupClipTest({ x: 100, y: 50, w: 200, h: 80 }, 10);

    observer.render(ctx, { preserveBackgrounds: false, ...VIEWPORT });

    expect(fakeCtx.rect).not.toHaveBeenCalledWith(100, 50, 200, 80);
    expect(fakeCtx.rect).not.toHaveBeenCalledWith(0, 0, 800, 600);
    expect(fakeCtx.roundRect).not.toHaveBeenCalled();
    // Anchor: positive assertion that render reached the particle-draw path.
    // Without this, the all-negative assertions could pass vacuously if
    // render() bailed early for an unrelated reason.
    expect(fakeCtx.fill).toHaveBeenCalled();
  });

  // ── Test #4: r > min(w,h)/2 → clamped at clip site ──
  it("clip_radius_clamped_to_half_min_dim", () => {
    const { fakeCtx, observer, ctx } = setupClipTest({ x: 100, y: 50, w: 100, h: 50 }, 999);

    observer.render(ctx, { preserveBackgrounds: true, ...VIEWPORT });

    // min(100, 50) / 2 === 25
    expect(fakeCtx.roundRect).toHaveBeenCalledWith(100, 50, 100, 50, 25);
    expect(fakeCtx.roundRect).not.toHaveBeenCalledWith(100, 50, 100, 50, 999);
    // Symmetry with test #1: verify clip-rule is still applied in the clamp path.
    expect(fakeCtx.clip).toHaveBeenCalledWith("evenodd");
  });
});
