import { describe, it, expect, afterEach } from "vitest";
import { PhantomObserver, FLOATS_PER_ENTITY } from "../src/phantom-observer";
import { renderWithFakeCtx } from "./_render-helper";

// jsdom doesn't ship ResizeObserver — minimal polyfill so observe() doesn't
// throw on the W42 resize subscription. Idempotent across test files.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Real DOM element with `getBoundingClientRect` overridden. Pre-W42 this
 * test used a plain JS object cast to `HTMLElement`, but W42 added
 * `window.getComputedStyle(el)` inside `observe()` for border-radius
 * resolution — jsdom rejects non-Element values with a TypeError.
 * Using `document.createElement` produces a real Element that satisfies
 * both `getComputedStyle` AND the ResizeObserver subscription added in W42.
 */
function mockElement(
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    x, y, width, height,
    top: y, left: x, right: x + width, bottom: y + height,
    toJSON: () => {},
  });
  document.body.appendChild(el);
  return el;
}

describe("PhantomObserver", () => {
  // W62 regression-fix follow-up: `mockElement` and `mockInteractiveElement`
  // both `appendChild` to document.body so jsdom's `getComputedStyle` accepts
  // them. Without per-test cleanup, leaked nodes accumulate across tests and
  // could interfere with future capacity-based tests that count active slots.
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("initializes with correct capacity", () => {
    const observer = new PhantomObserver(10);
    const buffer = observer.getBuffer();

    // 10 entities × 8 floats = 80
    expect(buffer).toBeInstanceOf(Float32Array);
    expect(buffer.length).toBe(10 * FLOATS_PER_ENTITY);

    // All zeros initially
    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(0);
    }
  });

  it("observe assigns ids and writes rect", () => {
    const observer = new PhantomObserver(10);
    const el0 = mockElement(10, 20, 300, 150);
    const el1 = mockElement(50, 60, 400, 200);

    const id0 = observer.observe(el0);
    const id1 = observer.observe(el1);

    expect(id0).toBe(0);
    expect(id1).toBe(1);

    const buf = observer.getBuffer();

    // Entity 0: offset 0
    expect(buf[0]).toBe(10); // x
    expect(buf[1]).toBe(20); // y
    expect(buf[2]).toBe(300); // width
    expect(buf[3]).toBe(150); // height

    // Entity 1: offset FLOATS_PER_ENTITY
    expect(buf[FLOATS_PER_ENTITY + 0]).toBe(50);
    expect(buf[FLOATS_PER_ENTITY + 1]).toBe(60);
    expect(buf[FLOATS_PER_ENTITY + 2]).toBe(400);
    expect(buf[FLOATS_PER_ENTITY + 3]).toBe(200);
  });

  it("sync updates moved elements", () => {
    const observer = new PhantomObserver(10);

    // Start position
    let currentX = 10;
    let currentY = 20;
    // Real DOM element so W42's `window.getComputedStyle(el)` works under jsdom.
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: currentX,
      y: currentY,
      width: 100,
      height: 50,
      top: currentY,
      left: currentX,
      right: currentX + 100,
      bottom: currentY + 50,
      toJSON: () => {},
    });
    document.body.appendChild(el);

    observer.observe(el);
    const buf = observer.getBuffer();
    expect(buf[0]).toBe(10);
    expect(buf[1]).toBe(20);

    // "Move" the element
    currentX = 999;
    currentY = 888;

    // Buffer should still have old values before sync
    expect(buf[0]).toBe(10);
    expect(buf[1]).toBe(20);

    // After sync, buffer should reflect the new position
    observer.sync();
    expect(buf[0]).toBe(999);
    expect(buf[1]).toBe(888);
    expect(buf[2]).toBe(100); // width unchanged
    expect(buf[3]).toBe(50); // height unchanged
  });

  it("unobserve frees id for reuse", () => {
    const observer = new PhantomObserver(10);
    const el0 = mockElement(1, 2, 3, 4);
    const el1 = mockElement(5, 6, 7, 8);
    const el2 = mockElement(9, 10, 11, 12);

    const id0 = observer.observe(el0);
    const id1 = observer.observe(el1);
    expect(id0).toBe(0);
    expect(id1).toBe(1);

    // Free id 0
    observer.unobserve(el0);

    // Next observe should reuse id 0
    const id2 = observer.observe(el2);
    expect(id2).toBe(0);

    // Verify el2's rect is now at slot 0
    const buf = observer.getBuffer();
    expect(buf[0]).toBe(9);
    expect(buf[1]).toBe(10);
    expect(buf[2]).toBe(11);
    expect(buf[3]).toBe(12);
  });

  it("capacity limit throws", () => {
    const observer = new PhantomObserver(2);
    const el0 = mockElement(0, 0, 10, 10);
    const el1 = mockElement(0, 0, 10, 10);
    const el2 = mockElement(0, 0, 10, 10);

    observer.observe(el0);
    observer.observe(el1);

    // Third observe should throw — capacity is 2
    expect(() => observer.observe(el2)).toThrow();
  });

  it("render executes without errors", () => {
    const observer = new PhantomObserver(10);
    const el = mockElement(10, 20, 100, 50);
    observer.observe(el);

    // Mock CanvasRenderingContext2D with no-op methods
    const ctx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      quadraticCurveTo: () => {},
      closePath: () => {},
      fill: () => {},
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    // Should not throw (fallback mode — no particleBuffer)
    expect(() => renderWithFakeCtx(observer, ctx)).not.toThrow();
  });

  // ── Ward 11: Interaction State tests ──

  /**
   * Real DOM element with `getBoundingClientRect` overridden. Pre-W42 this
   * was a plain object with hand-rolled addEventListener/dispatchEvent —
   * but `document.createElement` gives us those for free and (critically)
   * satisfies `window.getComputedStyle()` which W42 added inside observe().
   */
  function mockInteractiveElement(
    x: number,
    y: number,
    width: number,
    height: number,
  ): HTMLElement {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x, y, width, height,
      top: y, left: x, right: x + width, bottom: y + height,
      toJSON: () => {},
    });
    document.body.appendChild(el);
    return el;
  }

  it("hover updates interaction_state", () => {
    const observer = new PhantomObserver(10);
    const el = mockInteractiveElement(10, 20, 100, 50);

    const id = observer.observe(el);
    const buf = observer.getBuffer();
    const stateIndex = id * FLOATS_PER_ENTITY + 4;

    // Initially 0 (default)
    expect(buf[stateIndex]).toBe(0);

    // Simulate mouseenter
    el.dispatchEvent(new Event("mouseenter"));

    // Sync to flush hover state to buffer
    observer.sync();

    expect(buf[stateIndex]).toBe(1.0);
  });

  it("mouseleave resets interaction_state", () => {
    const observer = new PhantomObserver(10);
    const el = mockInteractiveElement(10, 20, 100, 50);

    const id = observer.observe(el);
    const buf = observer.getBuffer();
    const stateIndex = id * FLOATS_PER_ENTITY + 4;

    // Hover on
    el.dispatchEvent(new Event("mouseenter"));
    observer.sync();
    expect(buf[stateIndex]).toBe(1.0);

    // Hover off
    el.dispatchEvent(new Event("mouseleave"));
    observer.sync();
    expect(buf[stateIndex]).toBe(0.0);
  });

  // ── Ward 018: Viewport Culling ──

  it("zero-width entity not rendered", () => {
    const observer = new PhantomObserver(4);

    const normal = mockElement(10, 20, 100, 50);
    const zeroWidth = mockElement(10, 20, 0, 50);

    observer.observe(normal);
    observer.observe(zeroWidth);
    observer.sync();

    let fillCalls = 0;
    const ctx = {
      save: () => {},
      restore: () => {},
      fillStyle: "",
      fillRect: () => { fillCalls++; },
      beginPath: () => {},
      moveTo: () => {},
      quadraticCurveTo: () => {},
      closePath: () => {},
      fill: () => { fillCalls++; },
    } as unknown as CanvasRenderingContext2D;

    renderWithFakeCtx(observer, ctx, { viewportWidth: 800, viewportHeight: 600, cullMargin: 100 });

    // Only the normal element should complete a fill — zero-width skipped
    expect(fillCalls).toBe(1);
  });

  it("offscreen entity skipped in render", () => {
    const observer = new PhantomObserver(4);

    const onScreen = mockElement(100, 100, 200, 100);
    const offScreen = mockElement(99999, 99999, 100, 50);

    observer.observe(onScreen);
    observer.observe(offScreen);
    observer.sync();

    let fillCalls = 0;
    const ctx = {
      save: () => {},
      restore: () => {},
      fillStyle: "",
      fillRect: () => { fillCalls++; },
      beginPath: () => {},
      moveTo: () => {},
      quadraticCurveTo: () => {},
      closePath: () => {},
      fill: () => { fillCalls++; },
    } as unknown as CanvasRenderingContext2D;

    renderWithFakeCtx(observer, ctx, { viewportWidth: 800, viewportHeight: 600, cullMargin: 100 });

    // Only the on-screen element should render
    expect(fillCalls).toBe(1);
  });

  // ── Ward 019: Focus State ──

  it("focus triggers interaction_state", () => {
    const observer = new PhantomObserver(10);
    const el = mockInteractiveElement(10, 20, 100, 50);

    const id = observer.observe(el);
    const buf = observer.getBuffer();
    const stateIndex = id * FLOATS_PER_ENTITY + 4;

    // Initially idle
    observer.sync();
    expect(buf[stateIndex]).toBe(0);

    // Simulate focus
    el.dispatchEvent(new Event("focus"));
    observer.sync();
    expect(buf[stateIndex]).toBe(2.0); // 2.0 = focused

    // Simulate blur — reverts to idle
    el.dispatchEvent(new Event("blur"));
    observer.sync();
    expect(buf[stateIndex]).toBe(0);
  });
});
