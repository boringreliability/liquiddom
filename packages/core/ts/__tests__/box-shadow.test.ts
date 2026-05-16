/**
 * @vitest-environment jsdom
 *
 * Ward 054: box-shadow Compatibility under preserveBackgrounds — red phase tests (#1–#9).
 * Specified in `.wdd/wards/ward-054.md` r2.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { PhantomObserver, PARTICLES_PER_BODY } from "../src/phantom-observer";
import { parseBoxShadowMargin } from "../src/box-shadow";
import { renderWithFakeCtx } from "./_render-helper";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ── ControllableMutationObserver: mirrors W52's pattern ──
type MutRecord = Pick<MutationRecord, "target" | "type" | "attributeName">;
class ControllableMutationObserver {
  private cb: (mutations: MutRecord[], obs: MutationObserver) => void;
  static instances: ControllableMutationObserver[] = [];
  observedEl: Element | null = null;
  disconnected = false;

  constructor(cb: (mutations: MutRecord[]) => void) {
    this.cb = cb;
    ControllableMutationObserver.instances.push(this);
  }
  observe(el: Element, _opts?: MutationObserverInit) {
    this.observedEl = el;
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): MutRecord[] {
    return [];
  }
  trigger(mutations: MutRecord[]) {
    if (!this.disconnected) this.cb(mutations, this as unknown as MutationObserver);
  }
}

beforeAll(() => {
  globalThis.MutationObserver = ControllableMutationObserver as unknown as typeof MutationObserver;
});

beforeEach(() => {
  ControllableMutationObserver.instances = [];
});

function moFor(el: HTMLElement): ControllableMutationObserver | undefined {
  return ControllableMutationObserver.instances.find((o) => o.observedEl === el);
}

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

type StyleMap = {
  backgroundColor?: string;
  boxShadow?: string;
  borderRadius?: string;
};

function mockGetComputedStyle(map: WeakMap<Element, StyleMap>) {
  const original = window.getComputedStyle;
  Object.defineProperty(window, "getComputedStyle", {
    value: (el: Element) => {
      const stub = map.get(el) ?? {};
      return {
        backgroundColor: stub.backgroundColor ?? "",
        boxShadow: stub.boxShadow ?? "",
        borderRadius: stub.borderRadius ?? "",
        getPropertyValue: () => "",
      } as unknown as CSSStyleDeclaration;
    },
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(window, "getComputedStyle", {
      value: original,
      writable: true,
      configurable: true,
    });
  };
}

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

function makeObserver(capacity: number) {
  const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
  return new PhantomObserver(capacity, { particleView });
}

const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 };

describe("Ward 054: parseBoxShadowMargin — unit", () => {
  // ── Test #1: single outset shadow → per-side margins ──
  it("parseBoxShadowMargin_single_outset", () => {
    // box-shadow: 0 8px 24px 0 black
    const raw = "rgb(0, 0, 0) 0px 8px 24px 0px";
    const m = parseBoxShadowMargin(raw);
    expect(m.left).toBe(24);   // max(0, 24+0-0) = 24
    expect(m.right).toBe(24);  // max(0, 24+0+0) = 24
    expect(m.top).toBe(16);    // max(0, 24+0-8) = 16
    expect(m.bottom).toBe(32); // max(0, 24+0+8) = 32
  });

  // ── Test #2: multi-shadow per-side max ──
  it("parseBoxShadowMargin_multi_shadow_takes_per_side_max", () => {
    // Shadow A: 10px 0px 5px 0px → {top:5, right:15, bottom:5, left:0}
    // Shadow B: 0px 20px 30px 0px → {top:10, right:30, bottom:50, left:30}
    // Per-side max:                {top:10, right:30, bottom:50, left:30}
    const raw = "rgb(0, 0, 0) 10px 0px 5px 0px, rgba(0, 0, 0, 0.5) 0px 20px 30px 0px";
    const m = parseBoxShadowMargin(raw);
    expect(m.top).toBe(10);
    expect(m.right).toBe(30);
    expect(m.bottom).toBe(50);
    expect(m.left).toBe(30);
  });

  // ── Test #3: inset + unparseable → zeros ──
  it("parseBoxShadowMargin_skips_inset_and_unparseable", () => {
    // Trailing inset: first segment skipped, second contributes 12 on all sides.
    expect(parseBoxShadowMargin(
      "rgb(0,0,0) 0px 0px 8px 0px inset, rgb(0,0,0) 0px 0px 12px 0px"
    )).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });

    // Leading inset: single segment, fully skipped.
    expect(parseBoxShadowMargin(
      "inset rgb(0,0,0) 0px 0px 8px 0px"
    )).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

    // Empty / none / garbage → zeros, no throw.
    expect(parseBoxShadowMargin("")).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseBoxShadowMargin("none")).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseBoxShadowMargin("garbage tokens here")).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("Ward 054: clip-rect integration", () => {
  let restoreStyle: (() => void) | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    if (restoreStyle) {
      restoreStyle();
      restoreStyle = null;
    }
  });

  // ── Test #4: preserveBackgrounds=true + shadow → ctx.rect inflated ──
  it("clip_rect_inflates_when_preserveBackgrounds_and_shadow_set", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, {
      boxShadow: "rgb(0, 0, 0) 0px 8px 24px 0px",
      borderRadius: "0px",
    });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });

    // 1st ctx.rect call is the outer viewport rect: (0, 0, vw, vh).
    // 2nd ctx.rect call is the inner clip-hole — must be inflated.
    // With box-shadow 0/8/24 on (100, 50, 200, 80):
    //   cx = 100 - 24 = 76, cy = 50 - 16 = 34,
    //   cw = 200 + 24 + 24 = 248, ch = 80 + 16 + 32 = 128.
    expect(ctx.rect.mock.calls[0]).toEqual([0, 0, 800, 600]);
    expect(ctx.rect.mock.calls[1]).toEqual([76, 34, 248, 128]);
    // border-radius is 0, so roundRect must NOT be called.
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });

  // ── Test #5: preserveBackgrounds=false → no clip ──
  it("clip_rect_not_inflated_when_preserveBackgrounds_off", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, {
      boxShadow: "rgb(0, 0, 0) 0px 8px 24px 0px",
      borderRadius: "0px",
    });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, { preserveBackgrounds: false, ...VIEWPORT });

    // No clipping at all — ctx.clip must not be called.
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  // ── Test #6: MutationObserver refreshes shadowCache ──
  it("mutation_observer_refreshes_shadow_cache", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, { boxShadow: "none", borderRadius: "0px" });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    // Render before mutation → no inflation (shadow is "none").
    const ctx1 = makeFakeCtx();
    renderWithFakeCtx(observer, ctx1 as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });
    expect(ctx1.rect.mock.calls[1]).toEqual([100, 50, 200, 80]);

    // Mutate computed style; fire MO callback deterministically.
    styleMap.set(el, {
      boxShadow: "rgb(0, 0, 0) 0px 4px 12px 0px",
      borderRadius: "0px",
    });
    const mo = moFor(el);
    expect(mo, "expected per-element MutationObserver attached to el").toBeDefined();
    mo!.trigger([{ target: el, type: "attributes", attributeName: "style" }]);

    // Re-render → now inflated by new margin:
    // top = max(0, 12-4) = 8, right = 12, bottom = max(0, 12+4) = 16, left = 12.
    // cx = 100-12 = 88, cy = 50-8 = 42, cw = 200+24 = 224, ch = 80+24 = 104.
    const ctx2 = makeFakeCtx();
    renderWithFakeCtx(observer, ctx2 as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });
    expect(ctx2.rect.mock.calls[1]).toEqual([88, 42, 224, 104]);
  });

  // ── Test #7: preserveBackgrounds=true + no shadow → zero inflation ──
  it("clip_rect_zero_inflation_when_no_box_shadow", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, { boxShadow: "none", borderRadius: "0px" });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });

    // Bare element rect — no inflation despite preserveBackgrounds=true.
    expect(ctx.rect.mock.calls[1]).toEqual([100, 50, 200, 80]);
  });

  // ── Test #8: border-radius + box-shadow → roundRect inflated WH, unchanged r ──
  it("border_radius_and_box_shadow_combine_correctly", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, {
      boxShadow: "rgb(0, 0, 0) 0px 8px 24px 0px",
      borderRadius: "8px",
    });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });

    // Inflated WH, radius unchanged (Decision §7).
    // cx=76, cy=34, cw=248, ch=128, r=8.
    expect(ctx.roundRect).toHaveBeenCalledWith(76, 34, 248, 128, 8);
    // Outer rect still fires once for the viewport.
    expect(ctx.rect.mock.calls[0]).toEqual([0, 0, 800, 600]);
    // No bare rect for the inner hole — roundRect path took over.
    expect(ctx.rect.mock.calls).toHaveLength(1);
  });

  // ── Test #9: unobserve clears shadowCache entry (no leak across observe) ──
  it("unobserve_clears_shadow_cache_entry", () => {
    const observer = makeObserver(4);
    const styleMap = new WeakMap<Element, StyleMap>();

    // Element with shadow.
    const el1 = mockedEl(0, 0, 100, 100);
    styleMap.set(el1, {
      boxShadow: "rgb(0, 0, 0) 0px 4px 12px 0px",
      borderRadius: "0px",
    });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el1);

    observer.observe(el1);
    observer.sync();

    // Render proves margin is cached (top=8, right=12, bottom=16, left=12).
    const ctxBefore = makeFakeCtx();
    renderWithFakeCtx(observer, ctxBefore as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });
    expect(ctxBefore.rect.mock.calls[1]).toEqual([-12, -8, 124, 124]);

    // Direct-cache peek BEFORE unobserve: cache populated for slot 0.
    const cacheBefore = (observer as unknown as { shadowCache: Map<number, unknown> }).shadowCache;
    expect(cacheBefore.has(0)).toBe(true);

    observer.unobserve(el1);

    // Direct-cache peek AFTER unobserve: cache empty for slot 0.
    // Distinguishes "cleanup happened in unobserve" from "cleanup happened on
    // re-observe's zero-margin delete branch".
    expect(cacheBefore.has(0)).toBe(false);

    // Re-observe a NEW element at the same slot, this time with NO shadow.
    // If shadowCache leaked from el1, the new element would render inflated.
    const el2 = mockedEl(200, 200, 50, 50);
    styleMap.set(el2, { boxShadow: "none", borderRadius: "0px" });
    document.body.appendChild(el2);
    observer.observe(el2);
    observer.sync();

    const ctxAfter = makeFakeCtx();
    renderWithFakeCtx(observer, ctxAfter as unknown as CanvasRenderingContext2D, { preserveBackgrounds: true, ...VIEWPORT });
    // Bare rect — no inflation leaked from el1.
    expect(ctxAfter.rect.mock.calls[1]).toEqual([200, 200, 50, 50]);
  });

  // ── Decision §3 invariant: MO callback updates BOTH caches when useComputedTheme=true ──
  it("mutation_observer_updates_both_caches_when_useComputedTheme_true", () => {
    const particleView = new Float32Array(4 * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(4, { particleView, useComputedTheme: true });

    const styleMap = new WeakMap<Element, StyleMap>();
    const el = mockedEl(100, 50, 200, 80);
    styleMap.set(el, { backgroundColor: "rgb(255, 0, 0)", boxShadow: "none", borderRadius: "0px" });
    restoreStyle = mockGetComputedStyle(styleMap);
    document.body.appendChild(el);

    observer.observe(el);
    observer.sync();

    // Mutate both theme + shadow at once.
    styleMap.set(el, {
      backgroundColor: "rgb(0, 255, 0)",
      boxShadow: "rgb(0, 0, 0) 0px 4px 12px 0px",
      borderRadius: "0px",
    });

    const mo = moFor(el);
    expect(mo, "expected per-element MO").toBeDefined();
    mo!.trigger([{ target: el, type: "attributes", attributeName: "style" }]);

    // Both caches updated (gate inside MO callback runs the theme branch
    // because useComputedTheme=true; shadow branch runs unconditionally).
    const inst = observer as unknown as {
      themeCache: Map<number, string>;
      shadowCache: Map<number, unknown>;
    };
    expect(inst.themeCache.get(0)).toBe("rgb(0, 255, 0)");
    expect(inst.shadowCache.has(0)).toBe(true);
  });
});
