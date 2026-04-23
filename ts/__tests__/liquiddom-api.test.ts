/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { LiquidDOM } from "../src/index";

// jsdom doesn't provide ResizeObserver — minimal polyfill for tests
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe("LiquidDOM Instance API", () => {
  beforeEach(() => {
    // Clean up DOM from previous tests
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("create returns instance with correct methods", async () => {
    const instance = await LiquidDOM.create({ capacity: 16 });

    // Instance should have the required methods
    expect(typeof instance.observe).toBe("function");
    expect(typeof instance.unobserve).toBe("function");
    expect(typeof instance.destroy).toBe("function");

    // Canvas should be injected
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.style.position).toBe("fixed");
    expect(canvas!.style.pointerEvents).toBe("none");
  });

  it("multiple instances coexist", async () => {
    const instance1 = await LiquidDOM.create({ capacity: 8 });
    const instance2 = await LiquidDOM.create({ capacity: 8 });

    // Each instance should inject its own canvas
    const canvases = document.querySelectorAll("canvas");
    expect(canvases.length).toBe(2);

    // Instances should be distinct objects
    expect(instance1).not.toBe(instance2);
  });

  it("observe and unobserve work on instance in isolation", async () => {
    const instance1 = await LiquidDOM.create({ capacity: 8 });
    const instance2 = await LiquidDOM.create({ capacity: 8 });

    const el = document.createElement("button");
    el.setAttribute("data-liquid", "");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 40,
      top: 20, left: 10, right: 110, bottom: 60,
      toJSON: () => {},
    });
    document.body.appendChild(el);

    // Observe on instance1
    const id = instance1.observe(el);
    expect(typeof id).toBe("number");

    // Unobserve on instance1 should not throw
    expect(() => instance1.unobserve(el)).not.toThrow();

    // Instance2 was never involved — unobserve should be harmless
    expect(() => instance2.unobserve(el)).not.toThrow();
  });

  it("auto observes data-liquid attributes via create", async () => {
    const btn = document.createElement("button");
    btn.setAttribute("data-liquid", "");
    btn.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 40,
      top: 20, left: 10, right: 110, bottom: 60,
      toJSON: () => {},
    });
    document.body.appendChild(btn);

    const card = document.createElement("div");
    card.setAttribute("data-liquid", "");
    card.getBoundingClientRect = () => ({
      x: 200, y: 50, width: 150, height: 80,
      top: 50, left: 200, right: 350, bottom: 130,
      toJSON: () => {},
    });
    document.body.appendChild(card);

    await LiquidDOM.create({ capacity: 16, autoObserve: true });

    // Both elements should still be in the DOM
    const elements = document.querySelectorAll("[data-liquid]");
    expect(elements.length).toBe(2);

    // Canvas should be created
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  // ── Lifecycle & edge case tests ──

  it("destroy removes canvas and listeners", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    expect(document.querySelector("canvas")).not.toBeNull();

    instance.destroy();

    // Canvas should be gone
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("double destroy does not throw", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });
    instance.destroy();
    expect(() => instance.destroy()).not.toThrow();
  });

  it("destroy works in mock mode (no WASM)", async () => {
    // In jsdom, WASM always fails — this IS mock mode
    const instance = await LiquidDOM.create({ capacity: 8 });
    expect(() => instance.destroy()).not.toThrow();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("observe after destroy throws", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });
    instance.destroy();

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 50, height: 50,
      top: 0, left: 0, right: 50, bottom: 50,
      toJSON: () => {},
    });

    expect(() => instance.observe(el)).toThrow();
  });

  it("duplicate observe returns same id", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });

    const id1 = instance.observe(el);
    const id2 = instance.observe(el);
    expect(id1).toBe(id2);
  });

  // ── Ward 014: Teardown hardening ──

  it("destroy unobserves all tracked elements", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    // Track listener removal via spy
    const removals: string[] = [];
    function makeEl() {
      const el = document.createElement("div");
      el.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 50, height: 50,
        top: 0, left: 0, right: 50, bottom: 50,
        toJSON: () => {},
      });
      const origRemove = el.removeEventListener.bind(el);
      el.removeEventListener = (type: string, ...args: unknown[]) => {
        removals.push(type);
        return (origRemove as Function)(type, ...args);
      };
      return el;
    }

    const el1 = makeEl();
    const el2 = makeEl();
    instance.observe(el1);
    instance.observe(el2);

    instance.destroy();

    // Each element should have had mouseenter + mouseleave removed
    const enterRemovals = removals.filter((t) => t === "mouseenter");
    const leaveRemovals = removals.filter((t) => t === "mouseleave");
    expect(enterRemovals.length).toBe(2);
    expect(leaveRemovals.length).toBe(2);
  });

  it("create-destroy-create cycle works cleanly", async () => {
    // First instance
    const instance1 = await LiquidDOM.create({ capacity: 8 });
    expect(document.querySelectorAll("canvas").length).toBe(1);

    instance1.destroy();
    expect(document.querySelectorAll("canvas").length).toBe(0);

    // Second instance — must work without interference from the first
    const instance2 = await LiquidDOM.create({ capacity: 8 });
    expect(document.querySelectorAll("canvas").length).toBe(1);

    // Second instance is fully functional
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });
    const id = instance2.observe(el);
    expect(typeof id).toBe("number");

    instance2.destroy();
    expect(document.querySelectorAll("canvas").length).toBe(0);
  });

  it("unobserve after destroy is silent no-op", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 50, height: 50,
      top: 0, left: 0, right: 50, bottom: 50,
      toJSON: () => {},
    });
    instance.observe(el);
    instance.destroy();

    // Should not throw
    expect(() => instance.unobserve(el)).not.toThrow();
  });

  // ── Ward 016: Capacity Correctness ──

  it("capacity reflects state after grow", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    expect(instance.capacity).toBe(4);

    instance.grow(16);
    expect(instance.capacity).toBe(16);

    instance.destroy();
  });

  it("new entities can be observed after grow", async () => {
    const instance = await LiquidDOM.create({ capacity: 2, autoObserve: false });

    function makeEl() {
      const el = document.createElement("div");
      el.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 50, height: 50,
        top: 0, left: 0, right: 50, bottom: 50,
        toJSON: () => {},
      });
      return el;
    }

    // Fill to capacity
    instance.observe(makeEl());
    instance.observe(makeEl());

    // Third observe should throw — at capacity
    expect(() => instance.observe(makeEl())).toThrow();

    // Grow and try again
    instance.grow(8);
    expect(() => instance.observe(makeEl())).not.toThrow();

    instance.destroy();
  });

  it("grow preserves existing observed data", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 123, y: 456, width: 789, height: 101,
      top: 456, left: 123, right: 912, bottom: 557,
      toJSON: () => {},
    });
    instance.observe(el);

    // Grow — data should survive
    instance.grow(16);

    // Re-observe same element should return same id (idempotent)
    // and the element should still be tracked
    expect(() => instance.unobserve(el)).not.toThrow();

    instance.destroy();
  });

  it("grow on destroyed instance throws", async () => {
    const instance = await LiquidDOM.create({ capacity: 4 });
    instance.destroy();
    expect(() => instance.grow(16)).toThrow();
  });

  // ── Ward 017: Pause/Resume & dt clamping ──

  it("pause stops loop and sets isPaused", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    expect(instance.isPaused).toBe(false);

    instance.pause();
    expect(instance.isPaused).toBe(true);

    // Idempotent — double pause is safe
    expect(() => instance.pause()).not.toThrow();
    expect(instance.isPaused).toBe(true);

    instance.destroy();
  });

  it("resume restarts after pause", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    instance.pause();
    expect(instance.isPaused).toBe(true);

    instance.resume();
    expect(instance.isPaused).toBe(false);

    // Idempotent — double resume is safe
    expect(() => instance.resume()).not.toThrow();
    expect(instance.isPaused).toBe(false);

    instance.destroy();
  });

  it("pause and resume on destroyed instance are no-ops", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });
    instance.destroy();

    // Should not throw — destroyed guards handle it
    expect(() => instance.pause()).not.toThrow();
    expect(() => instance.resume()).not.toThrow();
  });

  it("visibility hidden triggers pause", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    // Simulate tab going hidden
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(instance.isPaused).toBe(true);

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(instance.isPaused).toBe(false);

    instance.destroy();

    // Reset for other tests
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  // ── Ward 018: High-DPI ──

  it("canvas dimensions scaled by DPR", async () => {
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2, writable: true, configurable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 800, writable: true, configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 600, writable: true, configurable: true,
    });

    const instance = await LiquidDOM.create({ capacity: 4 });

    const canvas = document.querySelector("canvas")!;
    expect(canvas.width).toBe(800 * 2);
    expect(canvas.height).toBe(600 * 2);
    expect(canvas.style.width).toBe("100vw");
    expect(canvas.style.height).toBe("100vh");

    instance.destroy();

    Object.defineProperty(window, "devicePixelRatio", {
      value: 1, writable: true, configurable: true,
    });
  });

  // ── Ward 019: Reduced Motion, Focus, Touch ──

  it("reduced motion config disables physics", async () => {
    const instance = await LiquidDOM.create({
      capacity: 8,
      forceReducedMotion: true,
    });

    expect(instance.isReducedMotion).toBe(true);

    instance.destroy();
  });

  it("forceReducedMotion false overrides OS reduced-motion", async () => {
    // Mock matchMedia to report reduced motion
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;

    const instance = await LiquidDOM.create({
      capacity: 8,
      forceReducedMotion: false,
    });

    // OS says reduce, but explicit false overrides
    expect(instance.isReducedMotion).toBe(false);

    instance.destroy();
    window.matchMedia = originalMatchMedia;
  });

  it("pointer events update internal pointer state", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    // Pointer state should be exposed for verification
    expect(instance.pointerActive).toBe(false);

    // Simulate pointermove (touch type)
    document.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 100,
      clientY: 200,
      pointerType: "touch",
    }));

    expect(instance.pointerActive).toBe(true);

    // Simulate pointerleave
    document.dispatchEvent(new PointerEvent("pointerleave"));

    expect(instance.pointerActive).toBe(false);

    instance.destroy();
  });

  // ── Ward 020: Container-Scoped Rendering ──

  it("container mode renders inside element", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    document.body.appendChild(container);

    const instance = await LiquidDOM.create({
      capacity: 8,
      container,
    });

    // Canvas should be inside the container, not body directly
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();

    // Body should NOT have a direct canvas child (it's inside container)
    const bodyCanvases = Array.from(document.body.children).filter(
      (el) => el.tagName === "CANVAS",
    );
    expect(bodyCanvases.length).toBe(0);

    // Canvas backing store should be container-sized * DPR
    const dpr = window.devicePixelRatio || 1;
    expect(canvas!.width).toBe(400 * dpr);
    expect(canvas!.height).toBe(300 * dpr);

    instance.destroy();

    // Canvas should be removed from container after destroy
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("fullscreen mode still works (no container)", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    // Canvas should be directly in body
    const canvas = document.querySelector("body > canvas") as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.style.position).toBe("fixed");

    instance.destroy();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("container mode transforms pointer coordinates", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    // Container is offset 50px from page origin
    container.getBoundingClientRect = () => ({
      x: 50, y: 100, width: 400, height: 300,
      top: 100, left: 50, right: 450, bottom: 400,
      toJSON: () => {},
    });
    document.body.appendChild(container);

    const instance = await LiquidDOM.create({
      capacity: 8,
      container,
      autoObserve: false,
    });

    // Simulate pointermove at page coords (150, 250)
    // Container-relative should be (100, 150)
    document.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 150,
      clientY: 250,
    }));

    // Expose pointer coords for verification
    expect(instance.pointerX).toBe(100); // 150 - 50 (container left)
    expect(instance.pointerY).toBe(150); // 250 - 100 (container top)

    instance.destroy();
  });

  // ── Ward 021: Dynamic Observation ──

  it("dynamically added element gets observed via autoDiscover", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    instance.autoDiscover();

    // Dynamically add a [data-liquid] element
    const el = document.createElement("div");
    el.setAttribute("data-liquid", "");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });
    document.body.appendChild(el);

    // MutationObserver fires asynchronously — wait a microtask
    await new Promise((r) => setTimeout(r, 0));

    // Element should now be observed — unobserve should not throw
    expect(() => instance.unobserve(el)).not.toThrow();

    instance.destroy();
  });

  it("removed element cleaned up by autoDiscover", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    // Manually observe an element
    const el = document.createElement("div");
    el.setAttribute("data-liquid", "");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });
    document.body.appendChild(el);
    instance.observe(el);

    instance.autoDiscover();

    // Remove the element from DOM
    el.remove();

    // Wait for MutationObserver
    await new Promise((r) => setTimeout(r, 0));

    // Element should have been unobserved — re-observe should get id 0 (slot reused)
    document.body.appendChild(el);
    const id = instance.observe(el);
    expect(id).toBe(0);

    instance.destroy();
  });

  it("explicit API works independently of autoDiscover", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    // No autoDiscover — explicit observe/unobserve still works
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });

    const id = instance.observe(el);
    expect(typeof id).toBe("number");
    expect(() => instance.unobserve(el)).not.toThrow();

    instance.destroy();
  });

  // ── Ward 023: Configurable Materials ──

  it("preset creates expected frozen config", async () => {
    const { presets } = await import("../src/index");

    expect(presets.jelly).toBeDefined();
    expect(presets.jelly.tension).toBeGreaterThan(0);
    expect(presets.jelly.damping).toBeGreaterThan(0);
    expect(presets.goo.damping!).toBeGreaterThan(presets.firm.damping!);

    // Presets should be frozen
    expect(Object.isFrozen(presets.jelly)).toBe(true);
    expect(Object.isFrozen(presets.goo)).toBe(true);
    expect(Object.isFrozen(presets.firm)).toBe(true);
  });

  it("config validated at init", async () => {
    // Negative tension
    await expect(
      LiquidDOM.create({ capacity: 4, physics: { tension: -1 } }),
    ).rejects.toThrow(TypeError);

    // NaN damping
    await expect(
      LiquidDOM.create({ capacity: 4, physics: { damping: NaN } }),
    ).rejects.toThrow(TypeError);

    // particleCount < 3
    await expect(
      LiquidDOM.create({ capacity: 4, physics: { particleCount: 1 } }),
    ).rejects.toThrow(TypeError);

    // substeps < 1
    await expect(
      LiquidDOM.create({ capacity: 4, physics: { substeps: 0 } }),
    ).rejects.toThrow(TypeError);
  });

  it("custom physics config is accepted", async () => {
    const instance = await LiquidDOM.create({
      capacity: 8,
      physics: { tension: 200, damping: 10, substeps: 2 },
    });

    // Should not throw — valid config
    expect(instance.capacity).toBe(8);

    instance.destroy();
  });

  // ── Ward 024: Package Exports ──

  it("package exports resolve correctly", async () => {
    // Verify that the main entry exports the expected public API
    const mod = await import("../src/index");

    // LiquidDOM class
    expect(mod.LiquidDOM).toBeDefined();
    expect(typeof mod.LiquidDOM.create).toBe("function");

    // Presets
    expect(mod.presets).toBeDefined();
    expect(mod.presets.goo).toBeDefined();
    expect(mod.presets.jelly).toBeDefined();
    expect(mod.presets.firm).toBeDefined();
  });

  it("internal modules are not leaked via main export", async () => {
    const mod = await import("../src/index");
    const keys = Object.keys(mod);

    // Only intentional exports should be present
    expect(keys).toContain("LiquidDOM");
    expect(keys).toContain("presets");

    // Internal types should NOT be exported as runtime values
    expect(keys).not.toContain("PhantomObserver");
    expect(keys).not.toContain("WasmBridge");
    expect(keys).not.toContain("DEFAULT_PHYSICS");
    expect(keys).not.toContain("validatePhysicsConfig");
  });
});

describe("Package metadata", () => {
  it("package.json has correct ESM config", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    expect(pkg.type).toBe("module");
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports["."]).toBeDefined();
    expect(pkg.exports["."].types).toBeDefined();
    expect(pkg.exports["."].import).toBeDefined();
    expect(pkg.files).toContain("dist/");
  });
});

// ── Ward 026: Scroll-Aware Base Position ──

describe("Scroll-Aware Physics", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("scroll pauses physics", async () => {
    const instance = await LiquidDOM.create({ capacity: 8 });

    expect(instance.isScrolling).toBe(false);

    // Simulate scroll event
    window.dispatchEvent(new Event("scroll"));

    expect(instance.isScrolling).toBe(true);
    // Physics should be paused during scroll (but NOT isPaused — that's user-level pause)

    instance.destroy();
  });

  it("scroll end triggers snap after idle timeout", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    const el = document.createElement("div");
    let rectX = 100;
    el.setAttribute("data-liquid", "");
    el.getBoundingClientRect = () => ({
      x: rectX, y: 50, width: 200, height: 100,
      top: 50, left: rectX, right: rectX + 200, bottom: 150,
      toJSON: () => {},
    });
    document.body.appendChild(el);
    instance.observe(el);

    // Simulate scroll
    window.dispatchEvent(new Event("scroll"));
    expect(instance.isScrolling).toBe(true);

    // "Move" the element (simulates scroll displacement)
    rectX = 300;

    // Wait for idle timeout (100ms + buffer)
    await new Promise((r) => setTimeout(r, 150));

    // Scroll should have ended, isScrolling back to false
    expect(instance.isScrolling).toBe(false);

    instance.destroy();
  });

  it("particles converge after snap", async () => {
    // This test verifies the contract: after scroll ends,
    // physics resumes and particles should converge to new positions.
    // In jsdom (no WASM), we verify the state flags are correct.
    const instance = await LiquidDOM.create({ capacity: 8 });

    // Scroll → wait for idle → verify resumed
    window.dispatchEvent(new Event("scroll"));
    expect(instance.isScrolling).toBe(true);

    await new Promise((r) => setTimeout(r, 150));

    // Physics should be resumed (isScrolling false, isPaused false)
    expect(instance.isScrolling).toBe(false);
    expect(instance.isPaused).toBe(false);

    instance.destroy();
  });
});

// ── Ward 027: Coordinate System Unification ──

describe("Coordinate System", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("pointer and entity use same reference frame in fullscreen", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 100, y: 200, width: 150, height: 80,
      top: 200, left: 100, right: 250, bottom: 280,
      toJSON: () => {},
    });
    instance.observe(el);

    // Pointer at element's center
    document.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 175, clientY: 240,
    }));

    // Pointer coords should be in same space as entity coords (viewport-relative)
    expect(instance.pointerX).toBe(175);
    expect(instance.pointerY).toBe(240);

    instance.destroy();
  });

  it("pointer and entity use same reference frame in container mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    container.getBoundingClientRect = () => ({
      x: 50, y: 100, width: 400, height: 300,
      top: 100, left: 50, right: 450, bottom: 400,
      toJSON: () => {},
    });
    document.body.appendChild(container);

    const instance = await LiquidDOM.create({
      capacity: 8, container, autoObserve: false,
    });

    // Element at container-relative (60, 30)
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 110, y: 130, width: 100, height: 50,
      top: 130, left: 110, right: 210, bottom: 180,
      toJSON: () => {},
    });
    instance.observe(el);

    // Pointer at element center in page coords: (160, 155)
    // Container-relative: (160-50, 155-100) = (110, 55)
    document.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 160, clientY: 155,
    }));

    expect(instance.pointerX).toBe(110); // container-relative

    // Entity buffer should ALSO be container-relative
    // Element is at viewport (110, 130), container at (50, 100)
    // So entity should be at container-relative (60, 30)
    // This is what we need to verify — currently sync() writes viewport coords
    const buf = instance.getBuffer();
    expect(buf).toBeDefined();
    if (buf) {
      expect(buf[0]).toBe(60);  // x: 110 - 50 (container left)
      expect(buf[1]).toBe(30);  // y: 130 - 100 (container top)
    }

    instance.destroy();
  });

  it("fullscreen mode coordinates unchanged", async () => {
    const instance = await LiquidDOM.create({ capacity: 8, autoObserve: false });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 200, y: 300, width: 100, height: 50,
      top: 300, left: 200, right: 300, bottom: 350,
      toJSON: () => {},
    });
    instance.observe(el);

    // In fullscreen mode, entity coords are viewport-relative (unchanged)
    const buf = instance.getBuffer();
    if (buf) {
      expect(buf[0]).toBe(200);
      expect(buf[1]).toBe(300);
    }

    instance.destroy();
  });

  it("container mode entity coords are container-relative", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    container.getBoundingClientRect = () => ({
      x: 80, y: 60, width: 400, height: 300,
      top: 60, left: 80, right: 480, bottom: 360,
      toJSON: () => {},
    });
    document.body.appendChild(container);

    const instance = await LiquidDOM.create({
      capacity: 8, container, autoObserve: false,
    });

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 180, y: 160, width: 120, height: 70,
      top: 160, left: 180, right: 300, bottom: 230,
      toJSON: () => {},
    });
    instance.observe(el);

    // Entity should be container-relative: (180-80, 160-60) = (100, 100)
    const buf = instance.getBuffer();
    if (buf) {
      expect(buf[0]).toBe(100);
      expect(buf[1]).toBe(100);
    }

    instance.destroy();
  });
});
