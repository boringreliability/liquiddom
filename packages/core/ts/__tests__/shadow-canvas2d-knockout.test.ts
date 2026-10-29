/**
 * @vitest-environment jsdom
 * W88.5b: the Canvas2D knockout touches only the casters' union dirty rect (putImageData's dirty-rect
 * overload, a destination-out draw of that source rect, zeroing only those rows), and its closing
 * pass gives the same alpha as the reference algorithm below (a copy of the pre-optimisation knockOut).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, St, STATE_STRIDE, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { kernelRadiusPx, KERNEL_RADIUS_CAP_PX } from "../src/renderers/kernel-params";
import { KNOCKOUT_CLOSE_PER_KERNEL } from "../src/renderers/shadow-plan";
import { ShadowCanvas2D } from "../src/renderers/shadow-canvas2d";
import { parseBoxShadow } from "../src/shadow";
import { FakeContext2D, installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

const CELL = 2;
const GW = 200;
const GH = 150;
const DROP = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");
const R = Math.min(Math.max(kernelRadiusPx(2), CELL), KERNEL_RADIUS_CAP_PX);

let fake: FakeCanvasHandle;
beforeEach(() => {
  fake = installFakeCanvas2D();
});
afterEach(() => fake.restore());

type Pt = { x: number; y: number; home: number };

/** A lattice of 2 px particles over [x, x+w) × [y, y+h) for element `home`, minus those `drop` removes. */
function lattice(home: number, x: number, y: number, w: number, h: number, drop?: (px: number, py: number) => boolean): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) if (!drop?.(x + i, y + j)) out.push({ x: x + i, y: y + j, home });
  return out;
}

function frameOf(pts: Pt[], elements: number): RenderFrame {
  const cap = pts.length;
  const dynamicView = new Float32Array(cap * DYNAMIC_FIELDS);
  const staticView = new Float32Array(cap * STATIC_FIELDS);
  const elementView = new Float32Array(elements * ELEMENT_STRIDE);
  const stateView = new Float32Array(elements * STATE_STRIDE);
  for (let e = 0; e < elements; e++) elementView.set([0, 0, 100, 40, 8, 0, 0, 0, NaN, NaN], e * ELEMENT_STRIDE);
  pts.forEach((p, i) => {
    dynamicView[Dyn.X * cap + i] = p.x;
    dynamicView[Dyn.Y * cap + i] = p.y;
    dynamicView[Dyn.F00 * cap + i] = 1;
    dynamicView[Dyn.F11 * cap + i] = 1;
    staticView[Stat.HOME * cap + i] = p.home;
  });
  for (let e = 0; e < elements; e++) stateView[e * STATE_STRIDE + St.REST_ALPHA] = 0;
  const paints: ElementPaint[] = [];
  for (let e = 0; e < elements; e++) {
    paints.push({ id: e, background: [47, 111, 222, 1], text: [255, 255, 255, 1], radiusPx: 8, particleCount: cap, areaPerParticle: 4, spacingPx: 2, atlasRect: null, shadows: DROP });
  }
  return {
    dynamicView, staticView, generation: 1, stateView, elementView, particleCapacity: cap, activeParticles: cap, paints,
    viewport: { widthCss: GW * CELL, heightCss: GH * CELL, dpr: 1 }, reducedMotion: false,
  };
}

function run(pts: Pt[], elements = 1): { sc: ShadowCanvas2D; ctx: FakeContext2D; knockCtx: FakeContext2D } {
  const sc = new ShadowCanvas2D();
  const ctx = new FakeContext2D(document.createElement("canvas"));
  sc.draw(ctx as unknown as CanvasRenderingContext2D, frameOf(pts, elements), CELL, GW, GH);
  return { sc, ctx, knockCtx: fake.contexts[fake.contexts.length - 1]! };
}

/** The mask cell box of a caster, as drawCaster computes it (before clamping to the grid). */
function box(pts: Pt[]): { ox: number; oy: number; mw: number; mh: number } {
  const x0 = Math.min(...pts.map((p) => p.x)) - R;
  const y0 = Math.min(...pts.map((p) => p.y)) - R;
  const x1 = Math.max(...pts.map((p) => p.x)) + R;
  const y1 = Math.max(...pts.map((p) => p.y)) + R;
  const ox = Math.floor(x0 / CELL);
  const oy = Math.floor(y0 / CELL);
  return { ox, oy, mw: Math.ceil(x1 / CELL) - ox + 1, mh: Math.ceil(y1 / CELL) - oy + 1 };
}

/** Clamped to the grid: [x, y, w, h] in cells. */
function clamped(b: { ox: number; oy: number; mw: number; mh: number }): number[] {
  const x0 = Math.max(0, b.ox);
  const y0 = Math.max(0, b.oy);
  const x1 = Math.min(GW, b.ox + b.mw);
  const y1 = Math.min(GH, b.oy + b.mh);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** M1: the put rect is the dirty rect grown by one cell on each side, clamped to the grid. */
function grown(x: number, y: number, w: number, h: number): number[] {
  const x0 = Math.max(0, x - 1);
  const y0 = Math.max(0, y - 1);
  const x1 = Math.min(GW, x + w + 1);
  const y1 = Math.min(GH, y + h + 1);
  return [0, 0, x0, y0, x1 - x0, y1 - y0];
}

describe("W88.5b: the knockout's dirty rect", () => {
  it("given_one_small_caster_on_a_large_grid_when_drawn_then_putImageData_and_the_destination_out_draw_cover_only_its_cells", () => {
    const pts = lattice(0, 101, 101, 140, 20);
    const [x, y, w, h] = clamped(box(pts)) as [number, number, number, number];
    expect(w * h, "the test is only meaningful for a small rect").toBeLessThan(GW * GH * 0.2);
    const { ctx, knockCtx } = run(pts);
    const put = knockCtx.ops("putImageData");
    expect(put).toHaveLength(1);
    expect(put[0]!.args.slice(1), "M1: grown by one cell on each side, clamped to the grid").toEqual(grown(x, y, w, h));
    const out = ctx.ops("drawImage").filter((c) => c.composite === "destination-out");
    expect(out).toHaveLength(1);
    expect(out[0]!.args.slice(1)).toEqual([x, y, w, h, x * CELL, y * CELL, w * CELL, h * CELL]);
  });

  it("given_two_casters_far_apart_when_drawn_then_the_union_rect_covers_both", () => {
    const a = lattice(0, 21, 21, 40, 20);
    const b = lattice(1, 301, 201, 60, 40);
    const ra = clamped(box(a)) as [number, number, number, number];
    const rb = clamped(box(b)) as [number, number, number, number];
    const x0 = Math.min(ra[0], rb[0]);
    const y0 = Math.min(ra[1], rb[1]);
    const x1 = Math.max(ra[0] + ra[2], rb[0] + rb[2]);
    const y1 = Math.max(ra[1] + ra[3], rb[1] + rb[3]);
    const { ctx, knockCtx } = run([...a, ...b], 2);
    expect(knockCtx.ops("putImageData")[0]!.args.slice(1)).toEqual(grown(x0, y0, x1 - x0, y1 - y0));
    const out = ctx.ops("drawImage").filter((c) => c.composite === "destination-out");
    expect(out[0]!.args.slice(1, 5)).toEqual([x0, y0, x1 - x0, y1 - y0]);
  });

  it("given_two_frames_when_drawn_then_the_second_starts_from_a_clean_image_outside_its_own_rect", () => {
    const sc = new ShadowCanvas2D();
    const ctx = new FakeContext2D(document.createElement("canvas")) as unknown as CanvasRenderingContext2D;
    sc.draw(ctx, frameOf(lattice(0, 21, 21, 40, 20), 1), CELL, GW, GH);
    sc.draw(ctx, frameOf(lattice(0, 301, 201, 40, 20), 1), CELL, GW, GH);
    const knock = fake.contexts[fake.contexts.length - 1]!.lastImage!;
    expect(knock.data[(15 * GW + 15) * 4 + 3], "the first frame's cells are zero again").toBe(0);
  });
});

/** The pre-optimisation closing algorithm, copied verbatim (closure `at`, 2 passes × 4 axes). */
function referenceKnock(cov: Float32Array, b: { ox: number; oy: number; mw: number; mh: number }): Uint8ClampedArray {
  const { ox, oy, mw, mh } = b;
  const out = new Uint8ClampedArray(GW * GH * 4);
  const closed = new Float32Array(mw * mh);
  const full = Math.max(1, Math.round((KNOCKOUT_CLOSE_PER_KERNEL * R) / CELL));
  const half = Math.max(1, Math.round(full / 2));
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
  const at = (ix: number, iy: number): number => (ix < 0 || iy < 0 || ix >= mw || iy >= mh ? 0 : (cov[iy * mw + ix] ?? 0));
  for (let iy = 0; iy < mh; iy++) {
    for (let ix = 0; ix < mw; ix++) {
      let k = cov[iy * mw + ix] ?? 0;
      for (let pass = 0; k < 1 && pass < 2; pass++) {
        const d = pass === 0 ? full : half;
        for (const [ax, ay] of axes) {
          const bridge = Math.min(at(ix + ax * d, iy + ay * d), at(ix - ax * d, iy - ay * d));
          if (bridge > k) k = bridge;
        }
      }
      closed[iy * mw + ix] = k;
    }
  }
  for (let iy = 0; iy < mh; iy++) {
    const gy = oy + iy;
    if (gy < 0 || gy >= GH) continue;
    for (let ix = 0; ix < mw; ix++) {
      const gx = ox + ix;
      if (gx < 0 || gx >= GW) continue;
      const a = (closed[iy * mw + ix] ?? 0) * 255;
      const p = (gy * GW + gx) * 4 + 3;
      if (a > (out[p] ?? 0)) out[p] = a;
    }
  }
  return out;
}

describe("W88.5b: the closing pass equals the reference algorithm", () => {
  const layouts: Array<[string, Pt[]]> = [
    ["a solid blob", lattice(0, 101, 101, 60, 40)],
    ["a ring with a narrow hole", lattice(0, 101, 101, 60, 40, (x, y) => Math.hypot(x - 131, y - 121) < 3)],
    ["a ring with a wide hole", lattice(0, 101, 101, 100, 80, (x, y) => Math.hypot(x - 151, y - 141) < 22)],
    ["a caster partly outside the grid", lattice(0, -20, -14, 80, 50, (x, y) => Math.hypot(x - 10, y - 10) < 5)],
    ["a caster past the far edge", lattice(0, 350, 260, 80, 60)],
  ];
  for (const [name, pts] of layouts) {
    it(`given_${name.replaceAll(" ", "_")}_when_drawn_then_every_knockout_alpha_equals_the_reference`, () => {
      const { sc, knockCtx } = run(pts);
      const cov = (sc as unknown as { cov: Float32Array }).cov;
      const expected = referenceKnock(cov, box(pts));
      const actual = knockCtx.lastImage!.data;
      expect(actual.length).toBe(expected.length);
      let mismatches = 0;
      let covered = 0;
      for (let i = 3; i < expected.length; i += 4) {
        if (actual[i] !== expected[i]) mismatches++;
        if (expected[i]! > 0) covered++;
      }
      expect(mismatches).toBe(0);
      expect(covered, "the layout covers some cells").toBeGreaterThan(0);
    });
  }
});
