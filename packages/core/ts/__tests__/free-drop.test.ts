/**
 * @vitest-environment jsdom
 *
 * Ward 043: FreeDrop Entity Type & Buffer Extension — red phase tests (#5–#8).
 * Spec at `.wdd/wards/ward-043.md` r2.
 *
 * Tests #1–#4 are Rust-side and live in `src/api.rs`. These four TS tests
 * cover the spawnDroplet API surface, capacity guard, observe rejection,
 * and unobserveAll cleanup of droplet slots.
 */
import { describe, it, expect, vi } from "vitest";
import { PhantomObserver, FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/phantom-observer";

function makeObserver(capacity: number, releaseSlot?: (id: number) => void) {
  const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
  return new PhantomObserver(capacity, { particleView, releaseSlot });
}

describe("Ward 043: FreeDrop TS API", () => {
  // ── Test #5 — spawnDroplet writes buffer correctly with options object ──
  it("spawnDroplet_options_object_writes_buffer_correctly", () => {
    const observer = makeObserver(4);
    const buf = observer.getBuffer();

    const id = observer.spawnDroplet({ x: 10, y: 20, vx: 0, vy: 0, radius: 6 });
    expect(id).toBeGreaterThanOrEqual(0);

    const off = id * FLOATS_PER_ENTITY;
    expect([
      buf[off],
      buf[off + 1],
      buf[off + 2],
      buf[off + 3],
      buf[off + 4],
      buf[off + 5],
      buf[off + 6],
      buf[off + 7],
      buf[off + 8],
    ]).toEqual([10, 20, 12, 12, 0, 6, 0, 0, 0]); // diameter=12 (=2*radius=6)

    // Default radius = 4, diameter = 8.
    const id2 = observer.spawnDroplet({ x: 0, y: 0, vx: 0, vy: 0 });
    const off2 = id2 * FLOATS_PER_ENTITY;
    expect(buf[off2 + 2]).toBe(8);
    expect(buf[off2 + 3]).toBe(8);
  });

  // ── Test #6 — capacity-exceeded throw, slot pool unchanged ──
  it("spawnDroplet_throws_when_capacity_exceeded", () => {
    const observer = makeObserver(1);
    expect(observer.spawnDroplet({ x: 1, y: 1, vx: 0, vy: 0 })).toBe(0);

    expect(() => observer.spawnDroplet({ x: 2, y: 2, vx: 0, vy: 0 })).toThrow(/capacity exceeded/);

    // Slot pool state must be unchanged after the throw.
    const peek = observer as unknown as {
      availableIds: number[];
      nextId: number;
    };
    expect(peek.availableIds.length).toBe(0);
    expect(peek.nextId).toBe(1);
  });

  // ── Test #7 — observe(el, 6) is rejected with an error mentioning spawnDroplet ──
  it("observe_rejects_liquid_type_6", () => {
    const observer = makeObserver(4);
    const el = document.createElement("div");

    expect(() => observer.observe(el, 6)).toThrow(/spawnDroplet/);

    // Allocation state unchanged.
    const peek = observer as unknown as {
      availableIds: number[];
      nextId: number;
    };
    expect(peek.availableIds.length).toBe(0);
    expect(peek.nextId).toBe(0);
  });

  // ── Soft-body unobserve also calls releaseSlot (cross-API recycle path) ──
  it("unobserve_soft_body_calls_releaseSlot", () => {
    const releaseSlot = vi.fn();
    const observer = makeObserver(4, releaseSlot);

    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 10, height: 10,
      top: 0, left: 0, right: 10, bottom: 10,
      toJSON: () => {},
    });
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    const id = observer.observe(el);
    expect(id).toBe(0);
    releaseSlot.mockClear(); // Ignore any allocator-time clears.

    observer.unobserve(el);
    expect(releaseSlot).toHaveBeenCalledWith(0);
  });

  // ── Test #8 — unobserveAll iterates dropletIds + calls releaseSlot per id ──
  it("unobserveAll_releases_droplet_slots", () => {
    const releaseSlot = vi.fn();
    const observer = makeObserver(4, releaseSlot);

    const ids = [
      observer.spawnDroplet({ x: 1, y: 1, vx: 0, vy: 0 }),
      observer.spawnDroplet({ x: 2, y: 2, vx: 0, vy: 0 }),
      observer.spawnDroplet({ x: 3, y: 3, vx: 0, vy: 0 }),
    ];
    expect(ids).toEqual([0, 1, 2]);

    const peek = observer as unknown as { dropletIds: Set<number> };
    expect(peek.dropletIds.size).toBe(3);

    observer.unobserveAll();

    // After unobserveAll, releaseSlot called per droplet id and the set is empty.
    for (const id of ids) {
      expect(releaseSlot).toHaveBeenCalledWith(id);
    }
    expect(peek.dropletIds.size).toBe(0);
  });
});
