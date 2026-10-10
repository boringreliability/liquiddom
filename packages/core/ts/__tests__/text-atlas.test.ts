/**
 * @vitest-environment jsdom
 * W74 (D74-5, Review Focus 1 and 4): the text atlas — shelf packing with the 10 px gutter,
 * word-wise fillText at the line boxes with the computed style, elements without text, page
 * overflow, 32 elements, a missing canvas or 2d context, the W75 invalidate hook, and a
 * missing Range.getClientRects. jsdom: fake canvas factory and Range stub (_fake-atlas.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ATLAS_GUTTER_PX, ATLAS_MAX_SIZE_PX, TextAtlas, type AtlasRect } from "../src/renderers/webgpu/text-atlas";
import { fakeAtlasCanvas, installRangeRects, oneLinePerNode } from "./_fake-atlas";
import { mockRect, resetDom } from "./_facade-helpers";

let restoreRects: (() => void) | null = null;
afterEach(() => {
  restoreRects?.();
  restoreRects = null;
  resetDom();
});

const STYLE = { fontStyle: "normal", fontWeight: "600", fontSize: "16px", fontFamily: "Arial", color: "rgb(255, 255, 255)" };

function textEl(text: string, box: readonly [number, number, number, number], style: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, STYLE, style);
  mockRect(el, box[0], box[1], box[2], box[3]);
  document.body.appendChild(el);
  return el;
}

/** Each text node's line starts 20 px right of and 12 px below its parent's box; 8 px per character. */
function lineInBox(): void {
  restoreRects = installRangeRects(
    oneLinePerNode((node) => {
      const r = (node.parentElement as HTMLElement).getBoundingClientRect();
      return { left: r.left + 20, top: r.top + 12 };
    }),
  );
}

describe("W74 text atlas (D74-5)", () => {
  it("given_three_elements_with_text_when_built_then_shelf_packed_left_to_right_with_a_10px_gutter_and_rects_in_atlas_px", () => {
    lineInBox();
    const fake = fakeAtlasCanvas();
    const atlas = new TextAtlas({ createCanvas: fake.create });
    const a = textEl("Splash", [100, 200, 140, 48]);
    const b = textEl("Split", [264, 200, 140, 48]);
    const c = textEl("Liquid at rest", [200, 300, 320, 180]);
    const rects = atlas.build([
      { id: 0, el: a, dpr: 1 },
      { id: 1, el: b, dpr: 1 },
      { id: 3, el: c, dpr: 1 },
    ]);
    expect([ATLAS_GUTTER_PX, ATLAS_MAX_SIZE_PX]).toEqual([10, 4096]);
    expect([...rects.entries()]).toEqual([
      [0, { x: 10, y: 10, w: 140, h: 48 }],
      [1, { x: 170, y: 10, w: 140, h: 48 }],
      [3, { x: 330, y: 10, w: 320, h: 180 }],
    ]);
    expect([atlas.width, atlas.height, atlas.dpr, atlas.version, atlas.stale]).toEqual([660, 200, 1, 1, false]);
    expect(fake.canvases.map((cv) => [cv.width, cv.height])).toEqual([[660, 200]]);
    expect(atlas.canvas).toBe(fake.canvases[0]);
    expect(fake.canvases[0]!.ctx!.clears).toBe(1);
  });

  it("given_text_nodes_when_built_at_dpr_2_then_each_word_is_filled_at_its_line_box_baseline_with_the_computed_font_colour_letter_spacing_and_text_transform", () => {
    lineInBox();
    const fake = fakeAtlasCanvas();
    const atlas = new TextAtlas({ createCanvas: fake.create });
    const el = textEl("Liquid  at rest", [100, 200, 320, 180], { letterSpacing: "1px", textTransform: "uppercase" });
    const rects = atlas.build([{ id: 2, el, dpr: 2 }]);
    expect(rects.get(2)).toEqual({ x: 20, y: 20, w: 640, h: 360 });
    expect([atlas.width, atlas.height, atlas.dpr]).toEqual([680, 400, 2]);
    const fills = fake.fills();
    expect(fills.map((f) => f.text)).toEqual(["LIQUID", "AT", "REST"]);
    // Word starts at characters 0, 8 and 11 → client x = 100 + 20 + 8 · start (no re-wrapping).
    expect(fills.map((f) => f.x)).toEqual([120, 184, 208]);
    for (const f of fills) {
      // Line top 212, height 24; font box 12.8 + 3.2 = 16 → baseline 212 + (24 − 16) / 2 + 12.8.
      expect(f.y).toBeCloseTo(228.8, 5);
      expect(f.font).toBe("normal 600 16px Arial");
      expect(f.fillStyle).toBe("rgb(255, 255, 255)");
      expect(f.letterSpacing).toBe("1px");
      // Client CSS px → atlas px: scale by dpr, element origin at the gutter (20 − 100·2, 20 − 200·2).
      expect(f.transform).toEqual([2, 0, 0, 2, -180, -380]);
    }
  });

  it("given_an_element_without_text_or_with_whitespace_only_when_built_then_it_has_no_rect_and_an_atlas_without_text_has_no_canvas_review_focus_1", () => {
    lineInBox();
    const fake = fakeAtlasCanvas();
    const atlas = new TextAtlas({ createCanvas: fake.create });
    const icon = document.createElement("div");
    icon.appendChild(document.createElement("span"));
    mockRect(icon, 0, 0, 40, 40);
    document.body.appendChild(icon);
    const blank = textEl("   \n  ", [50, 0, 60, 30]);
    expect(atlas.build([{ id: 0, el: icon, dpr: 1 }, { id: 1, el: blank, dpr: 1 }]).size).toBe(0);
    expect([atlas.canvas, atlas.version]).toEqual([null, 0]);
    expect(fake.canvases).toHaveLength(0);
    const word = textEl("Merge", [0, 100, 140, 48]);
    const rects = atlas.build([{ id: 0, el: icon, dpr: 1 }, { id: 2, el: word, dpr: 1 }]);
    expect([...rects.keys()]).toEqual([2]);
    expect(atlas.version).toBe(1);
  });

  it("given_an_element_wider_than_the_page_or_past_its_height_when_built_then_only_that_element_has_no_rect_review_focus_4", () => {
    lineInBox();
    const atlas = new TextAtlas({ createCanvas: fakeAtlasCanvas().create, maxSize: 256 });
    const rects = atlas.build([
      { id: 0, el: textEl("A", [0, 0, 140, 48]), dpr: 1 }, //   slot 160×68 → (0, 0)
      { id: 1, el: textEl("B", [0, 0, 140, 48]), dpr: 1 }, //   does not fit the shelf → next shelf (0, 68)
      { id: 2, el: textEl("C", [0, 0, 320, 180]), dpr: 1 }, //  slot 340 wide > 256: never fits
      { id: 4, el: textEl("E", [0, 0, 100, 150]), dpr: 1 }, //  next shelf at y 136, 136 + 170 > 256: page full
      { id: 5, el: textEl("F", [0, 0, 40, 20]), dpr: 1 }, //    still fits at (0, 136)
    ]);
    expect([...rects.entries()]).toEqual([
      [0, { x: 10, y: 10, w: 140, h: 48 }],
      [1, { x: 10, y: 78, w: 140, h: 48 }],
      [5, { x: 10, y: 146, w: 40, h: 20 }],
    ]);
    expect([atlas.width, atlas.height]).toEqual([160, 176]);
  });

  it("given_32_elements_with_text_at_dpr_2_when_built_then_every_rect_fits_the_page_without_overlap_review_focus_4", () => {
    lineInBox();
    const atlas = new TextAtlas({ createCanvas: fakeAtlasCanvas().create });
    const entries = Array.from({ length: 32 }, (_, id) => ({ id, el: textEl(`Button ${id}`, [10 * id, 0, 140, 48]), dpr: 2 }));
    const rects = atlas.build(entries);
    expect(rects.size).toBe(32);
    expect([atlas.width, atlas.height]).toEqual([3840, 408]); // 12 slots of 320 × 136 per shelf, 3 shelves
    const gutter = Math.ceil(ATLAS_GUTTER_PX * 2);
    const list: AtlasRect[] = [...rects.values()];
    for (const r of list) {
      expect(r.x >= gutter && r.y >= gutter && r.x + r.w + gutter <= atlas.width && r.y + r.h + gutter <= atlas.height).toBe(true);
    }
    for (const [i, a] of list.entries()) {
      for (const b of list.slice(i + 1)) {
        const apart =
          a.x + a.w + 2 * gutter <= b.x || b.x + b.w + 2 * gutter <= a.x || a.y + a.h + 2 * gutter <= b.y || b.y + b.h + 2 * gutter <= a.y;
        expect(apart, "two gutters between neighbours").toBe(true);
      }
    }
  });

  it("given_a_factory_that_returns_null_or_a_canvas_without_a_2d_context_when_built_then_an_empty_map_and_no_canvas", () => {
    lineInBox();
    const el = textEl("Splash", [0, 0, 140, 48]);
    for (const opts of [{ canvas: "null" as const }, { context: "null" as const }]) {
      const atlas = new TextAtlas({ createCanvas: fakeAtlasCanvas(opts).create });
      expect(atlas.build([{ id: 0, el, dpr: 1 }]).size).toBe(0);
      expect([atlas.canvas, atlas.width, atlas.height, atlas.version]).toEqual([null, 0, 0, 0]);
    }
    // jsdom has no OffscreenCanvas: the default factory yields no atlas, silently.
    expect(typeof OffscreenCanvas).toBe("undefined");
    expect(new TextAtlas().build([{ id: 0, el, dpr: 1 }]).size).toBe(0);
  });

  it("given_invalidate_when_called_then_stale_until_the_next_build_and_the_version_bumps_per_built_canvas", () => {
    lineInBox();
    const el = textEl("Split", [0, 0, 140, 48]);
    const atlas = new TextAtlas({ createCanvas: fakeAtlasCanvas().create });
    expect([atlas.stale, atlas.version]).toEqual([false, 0]);
    atlas.build([{ id: 1, el, dpr: 1 }]);
    expect([atlas.stale, atlas.version]).toEqual([false, 1]);
    atlas.invalidate(1);
    expect(atlas.stale).toBe(true);
    atlas.build([{ id: 1, el, dpr: 1 }]);
    expect([atlas.stale, atlas.version]).toEqual([false, 2]);
    expect(() => new TextAtlas({ maxSize: 0 })).toThrow(RangeError);
  });

  it("given_no_Range_getClientRects_when_built_with_text_then_it_throws_a_named_error", () => {
    const el = textEl("Splash", [0, 0, 140, 48]);
    const atlas = new TextAtlas({ createCanvas: fakeAtlasCanvas().create });
    expect(typeof (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects).toBe("undefined");
    expect(() => atlas.build([{ id: 0, el, dpr: 1 }])).toThrow(/Range\.getClientRects/);
    expect([atlas.canvas, atlas.version, atlas.stale]).toEqual([null, 0, false]);
  });
});

// W74 review: an overflowing word never bleeds into a neighbour's slot.
describe("W74 review: text atlas slot clipping", () => {
  it("given_an_over_wide_word_when_built_then_each_element_is_clipped_to_its_slot_box_and_the_clip_is_restored", () => {
    lineInBox();
    const fake = fakeAtlasCanvas();
    const atlas = new TextAtlas({ createCanvas: fake.create });
    const narrow = textEl("Supercalifragilistic", [100, 200, 60, 48]); // 20 chars × 8 px = 160 px > 60 px box
    const next = textEl("Split", [300, 200, 140, 48]);
    const rects = atlas.build([
      { id: 0, el: narrow, dpr: 2 },
      { id: 1, el: next, dpr: 2 },
    ]);
    const r0 = rects.get(0)!;
    const r1 = rects.get(1)!;
    expect(r0).toEqual({ x: 20, y: 20, w: 120, h: 96 });
    expect(r1).toEqual({ x: 180, y: 20, w: 280, h: 96 });
    const ctx = fake.canvases[0]!.ctx!;
    expect(ctx.ops).toEqual([
      { op: "save", args: [] },
      { op: "beginPath", args: [] },
      { op: "rect", args: [r0.x, r0.y, r0.w, r0.h] },
      { op: "clip", args: [] },
      { op: "restore", args: [] },
      { op: "save", args: [] },
      { op: "beginPath", args: [] },
      { op: "rect", args: [r1.x, r1.y, r1.w, r1.h] },
      { op: "clip", args: [] },
      { op: "restore", args: [] },
    ]);
    const fills = fake.fills();
    expect(fills.map((f) => f.text)).toEqual(["Supercalifragilistic", "Split"]);
    expect(fills[0]!.clip, "the over-wide word is clipped to its own slot").toEqual([r0.x, r0.y, r0.w, r0.h]);
    expect(fills[1]!.clip).toEqual([r1.x, r1.y, r1.w, r1.h]);
  });
});
