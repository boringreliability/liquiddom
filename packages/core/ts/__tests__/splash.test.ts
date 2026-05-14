/**
 * @vitest-environment jsdom
 *
 * Ward 044: Impulse-Triggered Droplet Spawning — red-phase tests (T1–T7).
 * Spec at `.wdd/wards/ward-044.md` r2.
 *
 * Splash fires droplets at the element's perimeter when `impulse()` is called
 * with a `splash` config AND `magnitude >= splash.threshold`. Capacity-
 * exhausted throws abort the splash loop silently. Existing impulse semantics
 * (Shake) are unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { FLOATS_PER_ENTITY } from "../src/phantom-observer";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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

/** Project a buffer offset onto the rect's edges; returns which edge or null. */
function edgeOf(
  px: number, py: number,
  rx: number, ry: number, rw: number, rh: number,
): "top" | "right" | "bottom" | "left" | null {
  const tol = 1e-3;
  const inX = px >= rx - tol && px <= rx + rw + tol;
  const inY = py >= ry - tol && py <= ry + rh + tol;
  if (inX && Math.abs(py - ry) < tol) return "top";
  if (inY && Math.abs(px - (rx + rw)) < tol) return "right";
  if (inX && Math.abs(py - (ry + rh)) < tol) return "bottom";
  if (inY && Math.abs(px - rx) < tol) return "left";
  return null;
}

describe("Ward 044: Impulse-Triggered Droplet Spawning", () => {
  let instance: LiquidDOMInstance;
  let el: HTMLElement;

  beforeEach(async () => {
    document.body.replaceChildren();
    instance = await LiquidDOM.create({ capacity: 16, autoObserve: false });
    el = mockedEl(100, 100, 80, 40);
    document.body.appendChild(el);
    instance.observe(el);
    // Sync once so buffer reflects the mock rect.
    // (sync runs in the RAF loop; we just need slot[0..3] populated.)
    const buf = instance.getBuffer()!;
    const off = instance.observe(el) * FLOATS_PER_ENTITY;
    buf[off] = 100;
    buf[off + 1] = 100;
    buf[off + 2] = 80;
    buf[off + 3] = 40;
  });

  afterEach(() => {
    instance.destroy();
  });

  // Count droplets via the WASM buffer (slot[5]===6 marks FreeDrop).
  function dropletIds(): Set<number> {
    const buf = instance.getBuffer()!;
    const ids = new Set<number>();
    for (let i = 0; i < instance.capacity; i++) {
      const off = i * FLOATS_PER_ENTITY;
      if (buf[off + 5] === 6.0 && buf[off + 2] > 0) ids.add(i);
    }
    return ids;
  }

  // ── T1: backwards-compat — no splash field → zero droplets ──
  it("impulse_without_splash_spawns_zero_droplets", () => {
    instance.impulse(el, { magnitude: 100, direction: [1, 0] });
    expect(dropletIds().size).toBe(0);
  });

  // ── T2: splash configured but magnitude below threshold → zero droplets ──
  it("impulse_below_threshold_spawns_zero_droplets", () => {
    instance.impulse(el, {
      magnitude: 5,
      direction: [1, 0],
      splash: { threshold: 10, count: 3 },
    });
    expect(dropletIds().size).toBe(0);
  });

  // ── T3: magnitude >= threshold → splash.count droplets, each liquid_type=6 ──
  it("impulse_above_threshold_spawns_requested_count", () => {
    instance.impulse(el, {
      magnitude: 50,
      direction: [1, 0],
      splash: { threshold: 10, count: 4 },
    });
    const ids = dropletIds();
    expect(ids.size).toBe(4);
    const buf = instance.getBuffer()!;
    for (const id of ids) {
      expect(buf[id * FLOATS_PER_ENTITY + 5]).toBe(6.0);
    }
  });

  // ── T4: spawn positions land on the rect perimeter (edge-centered sampling) ──
  it("splash_spawns_at_perimeter_positions", () => {
    instance.impulse(el, {
      magnitude: 50,
      direction: [1, 0],
      splash: { threshold: 0, count: 4 },
    });
    const buf = instance.getBuffer()!;
    const ids = dropletIds();
    expect(ids.size).toBe(4);

    const seenEdges = new Set<string>();
    for (const id of ids) {
      const off = id * FLOATS_PER_ENTITY;
      const px = buf[off];
      const py = buf[off + 1];
      const edge = edgeOf(px, py, 100, 100, 80, 40);
      expect(
        edge,
        `droplet ${id} at (${px}, ${py}) is not on rect perimeter`,
      ).not.toBeNull();
      seenEdges.add(edge!);
    }
    // With count=4 + edge-centered sampling, all four edges should be hit.
    expect(seenEdges.size).toBe(4);
  });

  // ── T5: velocity formula — direction*magnitude*speedScale + jitter * randomUnit ──
  it("splash_velocity_combines_direction_and_jitter", () => {
    // Math.random = 0 → angle = 0 → cos=1, sin=0.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      instance.impulse(el, {
        magnitude: 100,
        direction: [1, 0],
        splash: { threshold: 0, count: 1, jitter: 10, speedScale: 0.5 },
      });
    } finally {
      randomSpy.mockRestore();
    }
    const buf = instance.getBuffer()!;
    const ids = [...dropletIds()];
    expect(ids.length).toBe(1);
    const off = ids[0]! * FLOATS_PER_ENTITY;
    expect(buf[off + 6]).toBeCloseTo(60, 5);  // 1*100*0.5 + cos(0)*10 = 60
    expect(buf[off + 7]).toBeCloseTo(0, 5);   // 0*100*0.5 + sin(0)*10 = 0
  });

  // ── T6: capacity-exhausted → silent skip, no throw, partial spawn ──
  it("splash_silently_skips_when_capacity_exhausted", async () => {
    // Fresh tiny-capacity instance: 2 slots, 1 consumed by `observe`.
    instance.destroy();
    document.body.replaceChildren();
    instance = await LiquidDOM.create({ capacity: 2, autoObserve: false });
    el = mockedEl(50, 50, 40, 40);
    document.body.appendChild(el);
    const id = instance.observe(el);
    const buf = instance.getBuffer()!;
    buf[id * FLOATS_PER_ENTITY] = 50;
    buf[id * FLOATS_PER_ENTITY + 1] = 50;
    buf[id * FLOATS_PER_ENTITY + 2] = 40;
    buf[id * FLOATS_PER_ENTITY + 3] = 40;

    expect(() =>
      instance.impulse(el, {
        magnitude: 50,
        direction: [1, 0],
        splash: { threshold: 0, count: 5 },
      }),
    ).not.toThrow();
    expect(dropletIds().size).toBe(1);
  });

  // ── T7: lifetimeMs + radius overrides propagate; omission inherits default ──
  it("splash_lifetime_and_radius_overrides_propagate", () => {
    instance.impulse(el, {
      magnitude: 50,
      direction: [1, 0],
      splash: { threshold: 0, count: 1, lifetimeMs: 333, radius: 7 },
    });
    const buf = instance.getBuffer()!;
    const ids = [...dropletIds()];
    expect(ids.length).toBe(1);
    const off = ids[0]! * FLOATS_PER_ENTITY;
    expect(buf[off + 2]).toBeCloseTo(14, 5);  // diameter = 2 * 7
    expect(buf[off + 3]).toBeCloseTo(333, 5); // lifetime override

    // Omission: spawnDroplet's own defaults take over (5000 ms / radius 4).
    instance.impulse(el, {
      magnitude: 50,
      direction: [1, 0],
      splash: { threshold: 0, count: 1 },
    });
    const idsAfter = [...dropletIds()];
    expect(idsAfter.length).toBe(2);
    const off2 = idsAfter[1]! * FLOATS_PER_ENTITY;
    expect(buf[off2 + 2]).toBeCloseTo(8, 5);    // diameter = 2 * 4
    expect(buf[off2 + 3]).toBeCloseTo(5000, 5); // default lifetime
  });
});
