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
import { renderWithFakeCtx } from "./_render-helper";

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
    // W43: slot[2] = diameter (active marker + visual size).
    // W45: slot[3] = lifetimeMs (default 5000); slot[5] = liquid_type FreeDrop.
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
    ]).toEqual([10, 20, 12, 5000, 0, 6, 0, 0, 0]);

    // Default radius = 4, diameter = 8.
    const id2 = observer.spawnDroplet({ x: 0, y: 0, vx: 0, vy: 0 });
    const off2 = id2 * FLOATS_PER_ENTITY;
    expect(buf[off2 + 2]).toBe(8);
    // slot[3] is no longer diameter — it's lifetime. See T10 for explicit lifetime check.
    expect(buf[off2 + 3]).toBe(5000);
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

// ─────────────────────────────────────────────────────────────────────
// Ward 045 — Droplet Culling & Lifetime Management (TS tests 6-10)
// ─────────────────────────────────────────────────────────────────────

describe("Ward 045: Droplet Culling & Lifetime API", () => {
  // ── W45 Test #6 — spawnDroplet recycles Rust-culled slots via scan ──
  it("spawnDroplet_reuses_rust_culled_slots", () => {
    const observer = makeObserver(2);

    const id0 = observer.spawnDroplet({ x: 1, y: 1, vx: 0, vy: 0 });
    const id1 = observer.spawnDroplet({ x: 2, y: 2, vx: 0, vy: 0 });
    expect([id0, id1]).toEqual([0, 1]);

    // Simulate Rust cull on slot 0: zero w (slot[2]). dropletIds still has id 0.
    const buf = observer.getBuffer();
    buf[0 * FLOATS_PER_ENTITY + 2] = 0;

    // Third spawn must recycle id 0 via scan (NOT throw capacity-exceeded).
    const id2 = observer.spawnDroplet({ x: 3, y: 3, vx: 99, vy: 99 });
    expect(id2).toBe(0);

    // Buffer at slot 0 reflects fresh data.
    expect(buf[0]).toBe(3);
    expect(buf[6]).toBe(99);

    const peek = observer as unknown as { dropletIds: Set<number> };
    expect(peek.dropletIds.has(0)).toBe(true);
  });

  // ── W45 Test #7 — availableIds wins over scan (allocator priority) ──
  it("spawnDroplet_prefers_availableIds_over_scan", () => {
    const observer = makeObserver(2);

    const id0 = observer.spawnDroplet({ x: 1, y: 1, vx: 0, vy: 0 });
    const id1 = observer.spawnDroplet({ x: 2, y: 2, vx: 0, vy: 0 });
    expect([id0, id1]).toEqual([0, 1]);

    // despawnDroplet(0) pushes 0 to availableIds.
    observer.despawnDroplet(0);

    // Zero slot 1's w (simulate Rust cull on slot 1).
    const buf = observer.getBuffer();
    buf[1 * FLOATS_PER_ENTITY + 2] = 0;

    // Now both paths could recycle: availableIds has [0], scan would find 1.
    // Decision §7: availableIds wins.
    const id2 = observer.spawnDroplet({ x: 3, y: 3, vx: 0, vy: 0 });
    expect(id2).toBe(0);
  });

  // ── W45 Test #8 — despawnDroplet removes + recycles, idempotent ──
  it("despawnDroplet_removes_slot_and_recycles_id", () => {
    const releaseSlot = vi.fn();
    const observer = makeObserver(4, releaseSlot);

    const id = observer.spawnDroplet({ x: 10, y: 20, vx: 0, vy: 0 });
    releaseSlot.mockClear(); // ignore allocator-time calls

    const peek = observer as unknown as {
      dropletIds: Set<number>;
      availableIds: number[];
    };
    expect(peek.dropletIds.has(id)).toBe(true);

    observer.despawnDroplet(id);

    expect(peek.dropletIds.has(id)).toBe(false);
    expect(peek.availableIds).toContain(id);
    expect(releaseSlot).toHaveBeenCalledWith(id);

    // Buffer slot is zeroed.
    const buf = observer.getBuffer();
    const off = id * FLOATS_PER_ENTITY;
    for (let k = 0; k < FLOATS_PER_ENTITY; k++) {
      expect(buf[off + k]).toBe(0);
    }

    // Idempotent: second despawn is a silent no-op.
    releaseSlot.mockClear();
    const availableBefore = [...peek.availableIds];
    observer.despawnDroplet(id);
    expect(releaseSlot).not.toHaveBeenCalled();
    expect(peek.availableIds).toEqual(availableBefore);

    // despawnDroplet on a non-droplet id is also a no-op.
    observer.despawnDroplet(999);
    expect(releaseSlot).not.toHaveBeenCalled();
    expect(peek.availableIds).toEqual(availableBefore);
  });

  // ── W45 Test #9 — despawnDroplet throws after destroy (public API guard) ──
  // Uses LiquidDOM.create which is async; jsdom mock-mode lets us exercise the destroy guard
  // without WASM.
  it("despawnDroplet_throws_after_destroy", async () => {
    // We need the public LiquidDOMInstance to test the destroy guard, not the
    // raw observer. Dynamic import keeps this test isolated.
    const { LiquidDOM } = await import("../src/index");
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    instance.destroy();
    expect(() => instance.despawnDroplet(0)).toThrow(/destroyed/i);
  });

  // ── W45 Test #10 — spawnDroplet writes lifetimeMs to slot[3] ──
  it("spawnDroplet_writes_lifetime_to_slot_3", () => {
    const observer = makeObserver(4);
    const buf = observer.getBuffer();

    const id = observer.spawnDroplet({ x: 0, y: 0, vx: 0, vy: 0, lifetimeMs: 1234 });
    expect(buf[id * FLOATS_PER_ENTITY + 3]).toBe(1234);

    // Default lifetime when omitted: 5000.
    const id2 = observer.spawnDroplet({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(buf[id2 * FLOATS_PER_ENTITY + 3]).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ward 056 — FreeDrop Canvas Rendering (TS tests T1-T7)
// ─────────────────────────────────────────────────────────────────────

/** Fake CanvasRenderingContext2D with vi.fn() spies on every method. */
function makeFakeCtx() {
  const calls: { fillStyle: unknown[] } = { fillStyle: [] };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    _fillStyleAssignments: calls.fillStyle,
  } as unknown as CanvasRenderingContext2D & {
    _fillStyleAssignments: unknown[];
  };
  // Mock setter on fillStyle: record every assignment in call order.
  Object.defineProperty(ctx, "fillStyle", {
    set(v) { calls.fillStyle.push(v); },
    get() { return calls.fillStyle[calls.fillStyle.length - 1] ?? ""; },
    configurable: true,
  });
  return ctx;
}

function writeDroplet(
  observer: PhantomObserver,
  cx: number, cy: number, diameter: number,
  liquidType = 6,
): number {
  const id = observer.spawnDroplet({
    x: cx, y: cy, vx: 0, vy: 0, radius: diameter / 2,
  });
  // spawnDroplet already writes the buffer. Override liquid_type if needed.
  if (liquidType !== 6) {
    observer.getBuffer()[id * FLOATS_PER_ENTITY + 5] = liquidType;
  }
  return id;
}

/** Populate the particle buffer for a single droplet slot with 16 known points on a circle. */
function writeParticleCircle(
  particleBuffer: Float32Array,
  id: number,
  cx: number, cy: number, radius: number,
) {
  const base = id * PARTICLES_PER_BODY * 2;
  for (let j = 0; j < PARTICLES_PER_BODY; j++) {
    const theta = (j / PARTICLES_PER_BODY) * Math.PI * 2;
    particleBuffer[base + j * 2] = cx + Math.cos(theta) * radius;
    particleBuffer[base + j * 2 + 1] = cy + Math.sin(theta) * radius;
  }
}

describe("Ward 056: FreeDrop Canvas Rendering", () => {
  // ── T1: render produces one spline-fill per active droplet ──
  it("render_draws_spline_for_each_droplet", () => {
    const capacity = 4;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, { particleView });

    const id0 = writeDroplet(observer, 100, 100, 16);
    const id1 = writeDroplet(observer, 200, 200, 8);
    const id2 = writeDroplet(observer, 300, 50, 12);
    writeParticleCircle(particleView, id0, 100, 100, 8);
    writeParticleCircle(particleView, id1, 200, 200, 4);
    writeParticleCircle(particleView, id2, 300, 50, 6);

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D);

    // 3 droplets → 3 beginPath + 3 fill calls.
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    // Each droplet contributes 16 quadraticCurveTo calls → 48 total.
    expect((ctx.quadraticCurveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(48);
  });

  // ── T2: inactive (w=0) droplet slots are skipped ──
  it("render_skips_inactive_droplet_slots", () => {
    const capacity = 4;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, { particleView });

    const id0 = writeDroplet(observer, 100, 100, 16);
    const id1 = writeDroplet(observer, 200, 200, 12);
    writeParticleCircle(particleView, id0, 100, 100, 8);
    writeParticleCircle(particleView, id1, 200, 200, 6);

    // Simulate Rust cull on droplet 0 (slot[2] = 0).
    observer.getBuffer()[id0 * FLOATS_PER_ENTITY + 2] = 0;

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D);

    // Only id1 should render.
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // ── T3: droplets use colorDefault, hover state ignored ──
  it("render_droplet_uses_colorDefault_ignores_hover", () => {
    const capacity = 2;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, {
      particleView,
      colorDefault: "rgb(1,1,1)",
      colorHover: "rgb(2,2,2)",
    });

    const id = writeDroplet(observer, 50, 50, 8);
    writeParticleCircle(particleView, id, 50, 50, 4);
    // Force hover state on the droplet slot (should be ignored).
    observer.getBuffer()[id * FLOATS_PER_ENTITY + 4] = 1.0;

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D);

    // colorHover must never be assigned during the droplet pass; colorDefault is.
    expect(ctx._fillStyleAssignments).not.toContain("rgb(2,2,2)");
    expect(ctx._fillStyleAssignments).toContain("rgb(1,1,1)");
  });

  // ── T4: viewport cull uses center semantics (bbox = pos ± r) ──
  it("render_droplet_viewport_cull_uses_center_semantics", () => {
    const capacity = 2;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, { particleView });

    // (a) Off-screen left: center (-20, 50) radius 5 → x+r = -15 < 0, culled.
    const offScreen = writeDroplet(observer, -20, 50, 10);
    writeParticleCircle(particleView, offScreen, -20, 50, 5);
    // (b) Straddling left edge: center (-3, 50) radius 5 → x+r = 2 > 0, renders.
    const straddling = writeDroplet(observer, -3, 50, 10);
    writeParticleCircle(particleView, straddling, -3, 50, 5);

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, { viewportWidth: 100, viewportHeight: 100, cullMargin: 0 });

    // Only the straddling droplet should fire fill.
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // ── T5: mock-mode (no particleBuffer) draws filled circle via arc ──
  it("render_droplet_mock_mode_draws_arc_not_rect", () => {
    const capacity = 2;
    // No particleView → particleBuffer stays null → mock-mode.
    const observer = new PhantomObserver(capacity);

    writeDroplet(observer, 100, 100, 8);

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D);

    // ctx.arc invoked with center + radius; fillRect never called for droplet.
    const arcCalls = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls;
    expect(arcCalls.length).toBeGreaterThan(0);
    expect(arcCalls[0]).toEqual([100, 100, 4, 0, Math.PI * 2]);
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // ── T6: droplets are NOT clip-holed under preserveBackgrounds ──
  it("render_droplet_not_clipped_under_preserveBackgrounds", () => {
    const capacity = 2;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, { particleView });

    const id = writeDroplet(observer, 50, 50, 8);
    writeParticleCircle(particleView, id, 50, 50, 4);

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D, {
      viewportWidth: 200, viewportHeight: 200,
      preserveBackgrounds: true,
    });

    // For a droplet-only render, ctx.clip must never be called.
    expect((ctx.clip as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  // ── T7: soft-body render unaffected by W56 extraction (visual regression) ──
  it("render_soft_body_unaffected_by_W56_extraction", () => {
    const capacity = 2;
    const particleView = new Float32Array(capacity * PARTICLES_PER_BODY * 2);
    const observer = new PhantomObserver(capacity, { particleView });

    // Observe one element (soft-body slot 0).
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50,
      top: 20, left: 10, right: 110, bottom: 70,
      toJSON: () => {},
    });
    (el as HTMLElement).setPointerCapture = () => {};
    (el as HTMLElement).releasePointerCapture = () => {};
    document.body.appendChild(el);
    const id = observer.observe(el);
    observer.sync();
    writeParticleCircle(particleView, id, 60, 45, 30);

    const ctx = makeFakeCtx();
    renderWithFakeCtx(observer, ctx as unknown as CanvasRenderingContext2D);

    // Regression locker for W56 extraction — any benign soft-body render
    // change (extra save/restore pair, lineWidth reset, etc.) must update
    // these counts intentionally. Not a behavioral contract.
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1); // outer save only
    expect((ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1); // outer restore only
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.quadraticCurveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(16);
    expect((ctx.closePath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    document.body.removeChild(el);
  });
});
