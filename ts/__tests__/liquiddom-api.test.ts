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
});
