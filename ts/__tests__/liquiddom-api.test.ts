/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { LiquidDOM } from "../src/index";

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
});
