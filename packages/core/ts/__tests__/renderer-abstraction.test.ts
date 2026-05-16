/**
 * @vitest-environment jsdom
 *
 * Ward 036 — Render Abstraction Layer.
 * These tests lock the Renderer interface contract and verify that
 * Canvas2DRenderer produces the same ctx call sequence as the pre-W36
 * inline PhantomObserver.render() path. Tests #3 and #4 are REGRESSION
 * LOCKERS — if Canvas2D rendering legitimately changes, update the
 * expected sequences intentionally.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Canvas2DRenderer } from "../src/renderers/canvas2d-renderer";
import type { Renderer, RenderFrame, RenderFrameViewport } from "../src/renderers/renderer";
import { LiquidDOM } from "../src/index";
import { ZERO_MARGIN } from "../src/box-shadow";

// jsdom doesn't ship ResizeObserver
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Proxy-based mock that records every method call on a 2D context as [name, ...args]. */
function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      const key = String(prop);
      // Allow fillStyle to be set + read as a plain property so the renderer's
      // `ctx.fillStyle = "..."` mutations show up as ['set', 'fillStyle', value].
      if (key === "fillStyle") {
        return target.fillStyle ?? "rgba(0,0,0,0)";
      }
      // All method accesses return a recording function.
      return (...args: unknown[]) => {
        calls.push([key, ...args]);
        return undefined;
      };
    },
    set(target, prop, value) {
      const key = String(prop);
      target[key] = value;
      calls.push(["set", key, value]);
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}

/** Make a canvas whose getContext("2d") returns the supplied recording ctx. */
function canvasWithCtx(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => ctx) as HTMLCanvasElement["getContext"];
  return canvas;
}

const VIEWPORT_DEFAULT: RenderFrameViewport = {
  widthCss: 800,
  heightCss: 600,
  dpr: 1,
  cullMargin: 100,
  preserveBackgrounds: false,
};

function makeFrame(overrides: Partial<RenderFrame> = {}): RenderFrame {
  return {
    entities: new Float32Array(9),
    particles: null,
    capacity: 1,
    softBodyIds: [],
    dropletIds: [],
    viewport: VIEWPORT_DEFAULT,
    theme: {
      colorDefault: "rgba(15, 52, 96, 0.75)",
      colorHover: "rgba(233, 69, 96, 0.85)",
      themeCache: new Map(),
      shadowCache: new Map(),
    },
    ...overrides,
  };
}

describe("Ward 036: Render Abstraction Layer", () => {
  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  });

  // ── Test #1: contract sanity ─────────────────────────────────────────
  it("canvas2d_renderer_satisfies_renderer_contract", () => {
    // Compile-time check: assigning to Renderer fails compilation if the
    // class drifts from the interface. This is the actual contract lock.
    const _: Renderer = new Canvas2DRenderer();
    void _;

    // Runtime sanity: shape matches the contract.
    const r = new Canvas2DRenderer();
    expect(typeof r.init).toBe("function");
    expect(typeof r.render).toBe("function");
    expect(typeof r.resize).toBe("function");
    expect(typeof r.destroy).toBe("function");

    const canvas = canvasWithCtx(makeRecordingCtx().ctx);
    const initResult = r.init(canvas);
    expect(initResult).toBeInstanceOf(Promise);
  });

  // ── Test #2: PhantomObserver.render() replaced by buildFrame() ───────
  it("phantom_observer_render_method_replaced_by_buildFrame", async () => {
    const instance = await LiquidDOM.create({ capacity: 4 });
    // Reach into the closure-captured observer via the instance buffer accessor
    // chain. We need to verify the observer's surface — access it via a
    // protected dump: the public `getBuffer()` returns the observer's buffer
    // reference, but we need the observer itself. The simplest reliable path
    // is to construct a PhantomObserver directly.
    const { PhantomObserver } = await import("../src/phantom-observer");
    const observer = new PhantomObserver(4);

    // After W36: render() removed, buildFrame() added.
    expect((observer as unknown as { render?: unknown }).render).toBeUndefined();
    expect(
      typeof (observer as unknown as { buildFrame?: unknown }).buildFrame,
    ).toBe("function");

    const frame = (observer as unknown as {
      buildFrame: (vp: RenderFrameViewport) => RenderFrame;
    }).buildFrame(VIEWPORT_DEFAULT);

    expect(frame).toHaveProperty("entities");
    expect(frame).toHaveProperty("particles");
    expect(frame).toHaveProperty("capacity");
    expect(frame).toHaveProperty("softBodyIds");
    expect(frame).toHaveProperty("dropletIds");
    expect(frame).toHaveProperty("viewport");
    expect(frame).toHaveProperty("theme");
    expect(frame.entities).toBeInstanceOf(Float32Array);
    expect(Array.isArray(frame.softBodyIds)).toBe(true); // Decision §12
    expect(Array.isArray(frame.dropletIds)).toBe(true);  // Decision §12
    expect(frame.theme.themeCache).toBeInstanceOf(Map);
    expect(frame.theme.shadowCache).toBeInstanceOf(Map);

    instance.destroy();
  });

  // ── Test #3: soft-body render sequence (happy path + mock fallback) ──
  it("canvas2d_renderer_renders_soft_body_call_sequence", async () => {
    const renderer = new Canvas2DRenderer();
    const { ctx, calls } = makeRecordingCtx();
    const canvas = canvasWithCtx(ctx);
    await renderer.init(canvas);

    // Frame A: mock-mode (particles=null) → fallback fillRect(x, y, w, h).
    const entitiesA = new Float32Array(9);
    entitiesA[0] = 10; entitiesA[1] = 20; entitiesA[2] = 100; entitiesA[3] = 50;
    entitiesA[4] = 0; entitiesA[5] = 0; entitiesA[8] = 0;
    const frameA = makeFrame({
      entities: entitiesA,
      particles: null,
      softBodyIds: [0],
    });
    renderer.render(frameA);

    // After mock-mode frame, expect: setTransform, clearRect, save,
    // (no clip — preserveBackgrounds=false), set fillStyle, fillRect, restore.
    const namesA = calls.map((c) => c[0]);
    expect(namesA).toEqual([
      "setTransform",
      "clearRect",
      "save",
      "set",                         // fillStyle = colorDefault
      "fillRect",
      "restore",
    ]);
    // Verify fillRect args = (10, 20, 100, 50)
    const fillRectCall = calls.find((c) => c[0] === "fillRect")!;
    expect(fillRectCall.slice(1)).toEqual([10, 20, 100, 50]);

    // Reset recorder.
    calls.length = 0;

    // Frame B: with particle buffer → spline path (moveTo + 16 quadraticCurveTo + closePath + fill).
    const PARTICLES = 16;
    const particlesB = new Float32Array(PARTICLES * 2);
    for (let j = 0; j < PARTICLES; j++) {
      const t = (j / PARTICLES) * Math.PI * 2;
      particlesB[j * 2]     = 60 + Math.cos(t) * 50;
      particlesB[j * 2 + 1] = 45 + Math.sin(t) * 25;
    }
    const frameB = makeFrame({
      entities: entitiesA,
      particles: particlesB,
      softBodyIds: [0],
    });
    renderer.render(frameB);

    const namesB = calls.map((c) => c[0]);
    expect(namesB[0]).toBe("setTransform");
    expect(namesB[1]).toBe("clearRect");
    expect(namesB[2]).toBe("save");
    expect(namesB).toContain("beginPath");
    expect(namesB).toContain("moveTo");
    expect(namesB.filter((n) => n === "quadraticCurveTo")).toHaveLength(PARTICLES);
    expect(namesB).toContain("closePath");
    expect(namesB).toContain("fill");
    expect(namesB[namesB.length - 1]).toBe("restore");
  });

  // ── Test #4: clip path + droplet path + destroy idempotency ──────────
  it("canvas2d_renderer_renders_droplet_and_preserveBackgrounds_clip", async () => {
    const renderer = new Canvas2DRenderer();
    const { ctx, calls } = makeRecordingCtx();
    const canvas = canvasWithCtx(ctx);
    await renderer.init(canvas);

    // Soft-body slot 0 at (10, 20, 100, 50) with border-radius=10
    // Droplet slot 1 at center (200, 200) with diameter=8 (radius=4), liquid_type=6
    const entities = new Float32Array(9 * 2);
    // Slot 0 (soft-body)
    entities[0] = 10; entities[1] = 20; entities[2] = 100; entities[3] = 50;
    entities[4] = 0; entities[5] = 0; entities[8] = 10;
    // Slot 1 (droplet — slot[5]=6 marks FreeDrop; slot[2]=diameter)
    const off = 9;
    entities[off + 0] = 200; entities[off + 1] = 200; entities[off + 2] = 8;
    entities[off + 3] = 5000; entities[off + 4] = 0; entities[off + 5] = 6;
    entities[off + 8] = 0;

    // Particles for slot 0 = perimeter polygon, slot 1 = 16 circle samples.
    const PARTICLES = 16;
    const particles = new Float32Array(PARTICLES * 2 * 2);
    for (let j = 0; j < PARTICLES; j++) {
      const t = (j / PARTICLES) * Math.PI * 2;
      // slot 0
      particles[j * 2]     = 60 + Math.cos(t) * 50;
      particles[j * 2 + 1] = 45 + Math.sin(t) * 25;
      // slot 1 (offset PARTICLES*2)
      particles[PARTICLES * 2 + j * 2]     = 200 + Math.cos(t) * 4;
      particles[PARTICLES * 2 + j * 2 + 1] = 200 + Math.sin(t) * 4;
    }

    const shadowCache = new Map();
    shadowCache.set(0, { top: 4, right: 4, bottom: 4, left: 4 });

    const frame = makeFrame({
      entities,
      particles,
      capacity: 2,
      softBodyIds: [0],
      dropletIds: [1],
      viewport: { ...VIEWPORT_DEFAULT, preserveBackgrounds: true },
      theme: {
        colorDefault: "rgba(15, 52, 96, 0.75)",
        colorHover: "rgba(233, 69, 96, 0.85)",
        themeCache: new Map(),
        shadowCache,
      },
    });

    renderer.render(frame);

    const names = calls.map((c) => c[0]);

    // Soft-body clip pass under preserveBackgrounds=true:
    // outer save, beginPath, rect(0,0,vw,vh), roundRect(cx,cy,cw,ch,r), clip("evenodd")
    expect(names).toContain("rect");
    expect(names).toContain("roundRect");
    const clipCall = calls.find((c) => c[0] === "clip");
    expect(clipCall).toBeDefined();
    expect(clipCall![1]).toBe("evenodd");

    // Verify the inflated clip rect = (x - left, y - top, w + lr, h + tb) = (6, 16, 108, 58)
    const roundRectCall = calls.find((c) => c[0] === "roundRect")!;
    expect(roundRectCall.slice(1)).toEqual([6, 16, 108, 58, 10]);

    // Droplet drawing: 16 quadraticCurveTo for the soft-body + 16 for the droplet = 32 total
    expect(names.filter((n) => n === "quadraticCurveTo")).toHaveLength(PARTICLES * 2);

    // Destroy idempotency: two calls do not throw.
    expect(() => renderer.destroy()).not.toThrow();
    expect(() => renderer.destroy()).not.toThrow();

    // Render-after-destroy is a no-op: clear recorder, call render, expect 0 calls.
    calls.length = 0;
    expect(() => renderer.render(frame)).not.toThrow();
    expect(calls.length).toBe(0);
  });
});
