/**
 * @vitest-environment jsdom
 *
 * Ward 052: CSS Computed Background Reflection — red phase tests.
 * Tests #1-#7 per ward-052.md spec §Tests.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { PhantomObserver, FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/phantom-observer";
import { LiquidDOM } from "../src/index";
import { renderWithFakeCtx } from "./_render-helper";

// jsdom polyfill for ResizeObserver (existing W42 dependency)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ── ControllableMutationObserver: per-instance tracking, see spec §10 mock skeleton ──
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
  // Install BEFORE any PhantomObserver is constructed — observers capture
  // globalThis.MutationObserver at construction time.
  globalThis.MutationObserver = ControllableMutationObserver as unknown as typeof MutationObserver;
});

beforeEach(() => {
  ControllableMutationObserver.instances = [];
});

function moFor(el: HTMLElement): ControllableMutationObserver | undefined {
  return ControllableMutationObserver.instances.find((o) => o.observedEl === el);
}

// ── Fake ctx (same shape as W53 tests) ──
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

// ── getComputedStyle mocking ──
type StyleMap = { backgroundColor?: string };
function mockGetComputedStyle(map: WeakMap<Element, StyleMap>) {
  const original = window.getComputedStyle;
  Object.defineProperty(window, "getComputedStyle", {
    value: (el: Element) => {
      const stub = map.get(el) ?? {};
      return {
        backgroundColor: stub.backgroundColor ?? "",
        borderRadius: "",
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

function makeObserver(capacity: number, opts: { useComputedTheme?: boolean } = {}) {
  const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
  return new PhantomObserver(capacity, { particleView, ...opts });
}

const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 };
const RENDER_OPTS = { preserveBackgrounds: false, ...VIEWPORT };

// Instance defaults from PhantomObserver — referenced in fillStyle assertions.
const DEFAULT_COLOR = "rgba(83, 52, 131, 0.8)";
const DEFAULT_COLOR_HOVER = "rgba(120, 80, 180, 0.9)";

/** Common setup: element with mocked computed bg, appended to body. */
function setupThemedEl(bg: string) {
  const styleMap = new WeakMap<Element, StyleMap>();
  const el = mockedEl(100, 50, 200, 80);
  styleMap.set(el, { backgroundColor: bg });
  const restore = mockGetComputedStyle(styleMap);
  document.body.appendChild(el);
  return { el, styleMap, restore };
}

function renderWith(observer: PhantomObserver, fakeCtx: ReturnType<typeof makeFakeCtx>) {
  renderWithFakeCtx(observer, fakeCtx as unknown as CanvasRenderingContext2D, RENDER_OPTS);
}

describe("Ward 052: CSS Computed Background Reflection", () => {
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

  // ── Test #1: config default → instance colorDefault, backwards compat ──
  it("default_color_source_uses_instance_colors", () => {
    const fakeCtx = makeFakeCtx();
    const setup = setupThemedEl("rgb(255, 0, 0)");
    restoreStyle = setup.restore;

    // No useComputedTheme → 'config' mode (default)
    const observer = makeObserver(4);
    observer.observe(setup.el);
    renderWith(observer, fakeCtx);

    // colorDefault (instance default per PhantomObserver constructor)
    expect(fakeCtx.fillStyle).toBe(DEFAULT_COLOR);
    expect(fakeCtx.fillStyle).not.toBe("rgb(255, 0, 0)");
  });

  // ── Test #2: computed mode reads element bg-color → fillStyle ──
  it("computed_source_reads_element_background_color", () => {
    const fakeCtx = makeFakeCtx();
    const setup = setupThemedEl("rgb(255, 0, 0)");
    restoreStyle = setup.restore;

    const observer = makeObserver(4, { useComputedTheme: true });
    observer.observe(setup.el);
    renderWith(observer, fakeCtx);

    expect(fakeCtx.fillStyle).toBe("rgb(255, 0, 0)");
  });

  // ── Test #3: transparent / empty / "transparent" keyword → colorDefault ──
  it("transparent_background_falls_back_to_colorDefault", () => {
    const cases = ["rgba(0, 0, 0, 0)", "", "transparent"];
    for (const bg of cases) {
      const fakeCtx = makeFakeCtx();
      const setup = setupThemedEl(bg);
      try {
        const observer = makeObserver(4, { useComputedTheme: true });
        observer.observe(setup.el);
        renderWith(observer, fakeCtx);

        expect(fakeCtx.fillStyle, `bg=${JSON.stringify(bg)}`).toBe(DEFAULT_COLOR);
      } finally {
        setup.restore();
        document.body.replaceChildren();
        ControllableMutationObserver.instances = [];
      }
    }
  });

  // ── Test #4: MutationObserver triggers theme refresh ──
  it("mutation_observer_refreshes_theme_on_style_change", () => {
    const fakeCtx = makeFakeCtx();
    const { el, styleMap, restore } = setupThemedEl("rgb(0, 0, 255)");
    restoreStyle = restore;

    const observer = makeObserver(4, { useComputedTheme: true });
    observer.observe(el);

    renderWith(observer, fakeCtx);
    expect(fakeCtx.fillStyle).toBe("rgb(0, 0, 255)");

    // Change the element's computed bg-color and trigger the MutationObserver.
    styleMap.set(el, { backgroundColor: "rgb(0, 255, 0)" });
    const mo = moFor(el);
    expect(mo, "per-element MutationObserver must exist after observe()").toBeDefined();
    mo!.trigger([{ target: el, type: "attributes", attributeName: "style" }]);

    renderWith(observer, fakeCtx);
    expect(fakeCtx.fillStyle).toBe("rgb(0, 255, 0)");
  });

  // ── Test #5: unobserve disconnects the per-element MutationObserver AND clears theme cache ──
  it("unobserve_disconnects_mutation_observer", () => {
    const fakeCtx = makeFakeCtx();
    const { el, styleMap, restore } = setupThemedEl("rgb(0, 0, 255)");
    restoreStyle = restore;

    const observer = makeObserver(4, { useComputedTheme: true });
    observer.observe(el);

    // Sanity: themeCache populated → first render uses element bg
    renderWith(observer, fakeCtx);
    expect(fakeCtx.fillStyle).toBe("rgb(0, 0, 255)");

    const mo = moFor(el);
    expect(mo, "per-element MO must exist").toBeDefined();
    expect(mo!.disconnected).toBe(false);

    observer.unobserve(el);

    // Disconnect contract
    expect(mo!.disconnected).toBe(true);

    // Cache-leak guard: re-observe and render — if themeCache wasn't cleared,
    // the stale rgb(0,0,255) entry would still be there. After unobserve, the
    // id slot is freed; re-observe gets a fresh id. With a different bg we
    // verify no stale state leaks.
    styleMap.set(el, { backgroundColor: "" }); // transparent → fall back
    observer.observe(el);
    renderWith(observer, fakeCtx);
    expect(fakeCtx.fillStyle).toBe(DEFAULT_COLOR);
  });

  // ── Test #6: hover state still uses global colorHover in computed mode ──
  it("hover_state_uses_global_colorHover_even_in_computed_mode", () => {
    const fakeCtx = makeFakeCtx();
    const setup = setupThemedEl("rgb(255, 0, 0)");
    restoreStyle = setup.restore;

    const observer = makeObserver(4, { useComputedTheme: true });
    const id = observer.observe(setup.el);

    // Force hover state via buffer[id*9 + 4] = 1.0
    observer.getBuffer()[id * FLOATS_PER_ENTITY + 4] = 1.0;
    renderWith(observer, fakeCtx);

    // colorHover is the instance default — NOT the element's red bg
    expect(fakeCtx.fillStyle).toBe(DEFAULT_COLOR_HOVER);
    expect(fakeCtx.fillStyle).not.toBe("rgb(255, 0, 0)");
  });

  // ── Test #7a: refreshTheme in computed mode picks up changed bg ──
  it("refreshTheme_in_computed_mode_picks_up_changed_bg", async () => {
    const { el, styleMap, restore } = setupThemedEl("rgb(0, 0, 255)");
    restoreStyle = restore;

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      colorSource: "computed",
    });
    instance.observe(el);

    // Direct call to refreshTheme (no MutationObserver trigger involved) must
    // not throw and must update the cache. We can't render through LiquidDOM
    // in jsdom (no canvas context), so we assert no throw — the cache update
    // path is independently exercised in test #4.
    styleMap.set(el, { backgroundColor: "rgb(255, 255, 0)" });
    expect(() => instance.refreshTheme(el)).not.toThrow();

    instance.destroy();
  });

  // ── Test #7b: refreshTheme in config mode is a silent no-op ──
  it("refreshTheme_in_config_mode_is_noop", async () => {
    const el = mockedEl(0, 0, 100, 50);
    document.body.appendChild(el);

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      // colorSource omitted → defaults to 'config'
    });
    instance.observe(el);

    // No-op in config mode — must not throw.
    expect(() => instance.refreshTheme(el)).not.toThrow();

    instance.destroy();
  });

  // ── Test #7c: refreshTheme on destroyed instance throws ──
  it("refreshTheme_on_destroyed_instance_throws", async () => {
    const el = mockedEl(0, 0, 100, 50);
    document.body.appendChild(el);

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      colorSource: "computed",
    });
    instance.observe(el);
    instance.destroy();

    expect(() => instance.refreshTheme(el)).toThrow(
      "Cannot refreshTheme on a destroyed LiquidDOM instance",
    );
  });
});
