/**
 * W89 (D89-2, D89-3, D89-5, D89-6, D89-9, D89-10; Review Focus 1, 2, 3): Canvas2D ink. Two
 * elements' liquids overlap on one 2 px lattice (A at x 100–220, B at 160–280), so every cell of the
 * overlap holds both at p = 0.5. The renderer decides the mixing report in one frame and draws the
 * atlas text and the ink from the next; textMixing(id) is what the last render drew.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, Interaction, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { ElementPaint, RenderFrame, TextAtlasFrame } from "../src/renderers/frame";
import { MIX_RELEASE_FRAMES } from "../src/renderers/mix-report";
import { installFakeCanvas2D, type FakeCanvasHandle, type FakeContext2D, type FakeImageData } from "./_fake-canvas";

const PER = 1200; // 60 × 20 particles on a 2 px lattice per element
const CAP = 2 * PER;
const A_RECT = { x: 10, y: 10, w: 120, h: 40 };
const B_RECT = { x: 150, y: 10, w: 120, h: 40 };
// W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): the ink grid is 4 px (INK_CELL_FACTOR 2), so the probed cells are (190, 120) and (120, 120) px on that lattice.
const OVERLAP = [47, 30] as const; // a 4 px ink cell in the overlap's middle
const A_ONLY = [30, 30] as const; // an ink cell in A's own liquid

let fake: FakeCanvasHandle;
beforeEach(() => {
  fake = installFakeCanvas2D();
});
afterEach(() => fake.restore());

/** A 280 × 60 atlas page at dpr 1: A's and B's slots white at `alpha`, the rest transparent; `reads` records getImageData. */
function atlasPage(version = 1, alpha = 255): { frame: TextAtlasFrame; reads: Array<readonly number[]> } {
  const reads: Array<readonly number[]> = [];
  const [w, h] = [280, 60];
  const data = new Uint8ClampedArray(w * h * 4);
  for (const r of [A_RECT, B_RECT]) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set([255, 255, 255, alpha], (y * w + x) * 4);
  const ctx = { getImageData: (x: number, y: number, ww: number, hh: number) => (reads.push([x, y, ww, hh]), { width: ww, height: hh, data: data.slice() }) };
  const canvas = { width: w, height: h, getContext: (t: string) => (t === "2d" ? ctx : null) } as unknown as OffscreenCanvas;
  return { frame: { canvas, width: w, height: h, dpr: 1, version }, reads };
}

const paint = (id: number, text: boolean, mass = 4): ElementPaint => ({
  id, background: id === 0 ? [47, 111, 222, 1] : [26, 131, 97, 1], text: [255, 255, 255, 1], radiusPx: 8, particleCount: PER,
  areaPerParticle: mass, spacingPx: 2, atlasRect: text ? (id === 0 ? A_RECT : B_RECT) : null, shadows: [],
});

interface FrameOpts {
  atlas?: TextAtlasFrame | null;
  restAlpha?: readonly [number, number];
  bx?: number;
  text?: readonly [boolean, boolean];
  interaction?: readonly [number, number];
  awaySlots?: Uint8Array;
  reducedMotion?: boolean;
  suppressText?: boolean;
  textOff?: number;
  paints?: ElementPaint[];
  generation?: number;
  /** rest_v of every particle (default: its lattice row). */
  restV?: number;
}

/** A at (100, 100) and B at (bx, 100), both 120 × 40, each filled by its own lattice; both move (restAlpha 0.3) by default. */
function frame(o: FrameOpts = {}): RenderFrame {
  const bx = o.bx ?? 160;
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  const staticView = new Float32Array(CAP * STATIC_FIELDS);
  for (let i = 0; i < CAP; i++) {
    const [e, k] = [Math.floor(i / PER), i % PER];
    dynamicView[Dyn.X * CAP + i] = (e === 0 ? 100 : bx) + 1 + 2 * (k % 60);
    dynamicView[Dyn.Y * CAP + i] = 101 + 2 * Math.floor(k / 60);
    dynamicView[Dyn.F00 * CAP + i] = 1;
    dynamicView[Dyn.F11 * CAP + i] = 1;
    staticView[Stat.HOME * CAP + i] = e;
    staticView[Stat.REST_U * CAP + i] = ((k % 60) + 0.5) / 60;
    staticView[Stat.REST_V * CAP + i] = o.restV ?? (Math.floor(k / 60) + 0.5) / 20;
  }
  const inter = o.interaction ?? [Interaction.IDLE, Interaction.IDLE];
  const elementView = new Float32Array(2 * ELEMENT_STRIDE);
  elementView.set([100, 100, 120, 40, 8, inter[0], 0, 0, Number.NaN, Number.NaN], 0);
  elementView.set([bx, 100, 120, 40, 8, inter[1], 0, 0, Number.NaN, Number.NaN], ELEMENT_STRIDE);
  const ra = o.restAlpha ?? [0.3, 0.3];
  const stateView = Float32Array.from([1, 0, ra[0], 0, 1, 0, ra[1], 0]); // s, maxDev, restAlpha, maxFDev per slot
  const text = o.text ?? [true, true];
  return {
    dynamicView, staticView, generation: o.generation ?? 1, stateView, elementView, particleCapacity: CAP, activeParticles: CAP,
    paints: o.paints ?? [paint(0, text[0]), paint(1, text[1])], viewport: { widthCss: 400, heightCss: 300, dpr: 1 },
    reducedMotion: o.reducedMotion ?? false, textAtlas: o.atlas === undefined ? null : o.atlas,
    ...(o.awaySlots ? { awaySlots: o.awaySlots } : {}), ...(o.suppressText ? { suppressText: true } : {}),
    ...(o.textOff !== undefined ? { textOff: o.textOff } : {}),
  };
}

interface Setup {
  r: FluidCanvas2DRenderer;
  main: FakeContext2D;
  /** Index in fake.contexts of the first context the renderer creates after its canvas and density buffer. */
  from: number;
}

async function setup(): Promise<Setup> {
  const from = fake.contexts.length + 2;
  const canvas = document.createElement("canvas");
  const r = new FluidCanvas2DRenderer();
  await r.init(canvas);
  r.resize(400, 300, 1);
  return { r, main: fake.ctxFor(canvas)!, from };
}

const extra = (s: Setup): FakeContext2D[] => fake.contexts.slice(s.from);
const alphaAt = (img: FakeImageData, [cx, cy]: readonly [number, number]): number => img.data[(cy * img.width + cx) * 4 + 3]!;
const redAt = (img: FakeImageData, [cx, cy]: readonly [number, number]): number => img.data[(cy * img.width + cx) * 4]!;
/** drawImage calls of the atlas page on any context, in order (their args). */
const atlasDraws = (atlas: TextAtlasFrame): unknown[][] =>
  fake.contexts.flatMap((c) => c.ops("drawImage").filter((d) => d.args[0] === atlas.canvas).map((d) => d.args));
/** The ink image: an image of this renderer's with colour and alpha in the overlap (the fade mask has no colour). */
const inkImage = (s: Setup): FakeImageData | undefined =>
  extra(s).map((c) => c.lastImage).find((img): img is FakeImageData => img !== null && alphaAt(img, OVERLAP) > 0 && redAt(img, OVERLAP) > 0);

describe("W89 Canvas2D ink (D89-2, D89-5, D89-6)", () => {
  it("given_two_moving_text_elements_whose_liquids_overlap_when_rendered_then_both_report_textMixing_from_the_next_frame_and_their_atlas_text_is_drawn_at_their_dom_boxes_D89_5_D89_6", async () => {
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    expect([s.r.textMixing(0), s.r.textMixing(1)], "decided in this frame, drawn from the next").toEqual([false, false]);
    expect(atlasDraws(atlas)).toHaveLength(0);
    s.r.render(frame({ atlas }));
    expect([s.r.textMixing(0), s.r.textMixing(1)]).toEqual([true, true]);
    expect(atlasDraws(atlas), "each element's atlas rect at its DOM box (CSS px)").toEqual([
      [atlas.canvas, 10, 10, 120, 40, 100, 100, 120, 40],
      [atlas.canvas, 150, 10, 120, 40, 160, 100, 120, 40],
    ]);
    const scratch = extra(s).find((c) => c.ops("drawImage").some((d) => d.args[0] === atlas.canvas))!;
    expect(s.main.ops("drawImage").some((d) => d.args[0] === scratch.canvas), "the masked text lands on the liquid canvas").toBe(true);
  });

  it("given_mixing_elements_when_rendered_then_the_atlas_text_is_masked_by_one_minus_fade_with_destination_out_and_the_ink_lies_only_where_the_liquids_mix_D89_2_D89_6", async () => {
    // W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): OVERLAP/A_ONLY on the 4 px ink lattice.
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    const scratch = extra(s).find((c) => c.ops("drawImage").some((d) => d.args[0] === atlas.canvas));
    expect(scratch, "a scratch canvas carries the atlas text").toBeDefined();
    const draws = scratch!.ops("drawImage");
    const lastAtlas = draws.map((d) => d.args[0]).lastIndexOf(atlas.canvas);
    const mask = draws.slice(lastAtlas + 1).find((d) => d.composite === "destination-out");
    expect(mask, "the fade mask is cut out of the atlas text").toBeDefined();
    const maskImg = fake.contexts.find((c) => c.canvas === mask!.args[0])?.lastImage;
    expect(maskImg && alphaAt(maskImg, OVERLAP), "fade 1 in the overlap").toBe(255);
    expect(maskImg && alphaAt(maskImg, A_ONLY), "fade 0 in A's own liquid").toBe(0);
    const ink = inkImage(s);
    expect(ink, "an ink image with white ink in the overlap").toBeDefined();
    expect(alphaAt(ink!, A_ONLY), "no ink where one liquid is alone").toBe(0);
    const inkCanvas = extra(s).find((c) => c.lastImage === ink)!.canvas;
    expect(s.main.ops("drawImage").some((d) => d.args[0] === inkCanvas), "the ink lands on the liquid canvas").toBe(true);
  });

  it("given_one_moving_element_beside_one_at_rest_when_rendered_then_no_atlas_read_no_ink_canvas_and_neither_textMixing_nor_wantsAtlas_D89_9", async () => {
    const s = await setup();
    const page = atlasPage();
    for (let f = 0; f < 3; f++) s.r.render(frame({ atlas: page.frame, restAlpha: [0.3, 1] }));
    expect(page.reads, "no pixel read without a mix").toHaveLength(0);
    expect(extra(s), "no ink canvases").toHaveLength(0);
    expect([s.r.textMixing(0), s.r.textMixing(1), s.r.wantsAtlas()]).toEqual([false, false, false]);
    expect(atlasDraws(page.frame)).toHaveLength(0);
  });

  it("given_two_moving_elements_when_rendered_then_wantsAtlas_turns_true_and_stays_and_the_page_is_read_once_per_version_D89_5", async () => {
    const s = await setup();
    s.r.render(frame({ atlas: null }));
    expect(s.r.wantsAtlas(), "two elements move: the prewarm").toBe(true);
    expect(s.r.textMixing(0), "no atlas yet").toBe(false);
    s.r.render(frame({ atlas: null, restAlpha: [0.3, 1] }));
    expect(s.r.wantsAtlas(), "sticky").toBe(true);
    const v1 = atlasPage(1);
    s.r.render(frame({ atlas: v1.frame }));
    s.r.render(frame({ atlas: v1.frame }));
    expect(v1.reads).toEqual([[0, 0, 280, 60]]);
    const v2 = atlasPage(2);
    s.r.render(frame({ atlas: v2.frame }));
    expect(v2.reads).toHaveLength(1);
  });

  it("given_the_dragged_element_or_one_held_away_when_it_mixes_then_it_never_reports_textMixing_and_its_atlas_text_is_not_drawn_but_its_ink_feeds_the_zone_D89_3_D89_6", async () => {
    // W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): OVERLAP/A_ONLY on the 4 px ink lattice.
    for (const o of [
      { interaction: [Interaction.DRAGGED, Interaction.IDLE] as const },
      { awaySlots: Uint8Array.from([1, 0]) },
    ]) {
      const s = await setup();
      const { frame: atlas } = atlasPage();
      for (let f = 0; f < 3; f++) s.r.render(frame({ atlas, text: [true, false], ...o }));
      expect([s.r.textMixing(0), s.r.textMixing(1)], `${JSON.stringify(o)}: A is away, B has no text`).toEqual([false, false]);
      expect(atlasDraws(atlas)).toHaveLength(0);
      expect(inkImage(s), "A's label still feeds the ink (its DOM text is hidden by liquid-away)").toBeDefined();
    }
  });

  it("given_a_text_less_partner_when_the_liquids_mix_then_the_text_element_reports_mixing_and_its_ink_is_diluted_review_focus_3", async () => {
    // W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): OVERLAP/A_ONLY on the 4 px ink lattice.
    const both = await setup();
    const { frame: a1 } = atlasPage(1, 64);
    both.r.render(frame({ atlas: a1 }));
    both.r.render(frame({ atlas: a1 }));
    const fullImg = inkImage(both);
    expect(fullImg, "both carry text: an ink image").toBeDefined();
    const full = alphaAt(fullImg!, OVERLAP);
    const lone = await setup();
    const { frame: a2 } = atlasPage(1, 64);
    lone.r.render(frame({ atlas: a2, text: [true, false] }));
    lone.r.render(frame({ atlas: a2, text: [true, false] }));
    expect([lone.r.textMixing(0), lone.r.textMixing(1)], "a text-less liquid counts (D89-3)").toEqual([true, false]);
    const lonelyImg = inkImage(lone);
    expect(lonelyImg, "A's ink alone: an ink image").toBeDefined();
    const diluted = alphaAt(lonelyImg!, OVERLAP);
    expect(diluted, `diluted ${diluted} vs ${full}`).toBeGreaterThan(0.25 * full);
    expect(diluted).toBeLessThan(0.75 * full);
  });

  it("given_restAlpha_1_while_the_report_holds_when_rendered_then_textMixing_is_false_in_that_frame_and_its_atlas_text_is_not_drawn_review_focus_2", async () => {
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    expect(s.r.textMixing(0), "precondition").toBe(true);
    const before = atlasDraws(atlas).length;
    s.r.render(frame({ atlas, restAlpha: [1, 0.3] }));
    expect(s.r.textMixing(0), "forced release at rest (D89-6)").toBe(false);
    expect(atlasDraws(atlas).slice(before).filter((d) => d[1] === A_RECT.x), "A's atlas text is gone in the same frame").toHaveLength(0);
  });

  it("given_reduced_motion_or_suppressText_while_the_report_holds_when_rendered_then_no_ink_no_atlas_text_and_textMixing_false_D89_10", async () => {
    for (const o of [{ reducedMotion: true }, { suppressText: true }]) {
      const s = await setup();
      const { frame: atlas } = atlasPage();
      s.r.render(frame({ atlas }));
      s.r.render(frame({ atlas }));
      expect(s.r.textMixing(0), "precondition").toBe(true);
      const draws = atlasDraws(atlas).length;
      const puts = extra(s).map((c) => c.ops("putImageData").length);
      s.r.render(frame({ atlas, ...o }));
      expect([s.r.textMixing(0), s.r.textMixing(1)], JSON.stringify(o)).toEqual([false, false]);
      expect(atlasDraws(atlas).length, "no atlas text").toBe(draws);
      expect(extra(s).map((c) => c.ops("putImageData").length), "no ink image").toEqual(puts);
    }
  });

  it("given_the_liquids_part_while_both_still_move_when_rendered_then_the_atlas_text_stays_for_10_frames_and_goes_in_the_11th_D89_6", async () => {
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    for (let f = 1; f <= MIX_RELEASE_FRAMES; f++) {
      s.r.render(frame({ atlas, bx: 300 }));
      expect(s.r.textMixing(0), `parted frame ${f}: held`).toBe(true);
    }
    s.r.render(frame({ atlas, bx: 300 }));
    expect([s.r.textMixing(0), s.r.textMixing(1)], "released").toEqual([false, false]);
  });

  it("given_thin_liquid_in_the_overlap_when_rendered_then_the_fade_is_full_but_the_ink_takes_the_liquids_edge_coverage_smoothstep_0_4_0_6_and_is_0_D89_2", async () => {
    // W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): OVERLAP/A_ONLY on the 4 px ink lattice.
    const s = await setup();
    const { frame: atlas } = atlasPage();
    const thin = [paint(0, true, 0.5), paint(1, true, 0.5)]; // Σw ≈ 2 × 0.125 = 0.25 < 0.4 in the overlap
    s.r.render(frame({ atlas, paints: thin }));
    s.r.render(frame({ atlas, paints: thin }));
    expect(s.r.textMixing(0), "the liquids still mix").toBe(true);
    const mask = extra(s).map((c) => c.lastImage).find((img) => img !== null && alphaAt(img, OVERLAP) === 255);
    expect(mask, "fade 1 in the overlap").toBeDefined();
    expect(inkImage(s), "no ink outside the liquid's edge coverage").toBeUndefined();
  });

  it("given_the_same_generation_paints_and_page_when_the_rest_uvs_change_then_the_per_particle_ink_is_cached_and_a_new_generation_recomputes_it_D89_2", async () => {
    // W89.6: approved-test change (D89-9 fallback, saga dec_ffdf9914): OVERLAP/A_ONLY on the 4 px ink lattice.
    const s = await setup();
    const { frame: atlas } = atlasPage();
    const paints = [paint(0, true), paint(1, true)];
    s.r.render(frame({ atlas, paints }));
    s.r.render(frame({ atlas, paints }));
    const ink = inkImage(s);
    expect(ink, "precondition: ink").toBeDefined();
    const inkCtx = extra(s).find((c) => c.lastImage === ink)!;
    const puts = (): number => inkCtx.ops("putImageData").length;
    const p0 = puts();
    s.r.render(frame({ atlas, paints, restV: 5 })); // rest cells off the page: blank, were the ink recomputed
    expect(puts(), "cached: the same ink is drawn").toBe(p0 + 1);
    s.r.render(frame({ atlas, paints, restV: 5, generation: 2 }));
    expect(puts(), "a new generation recomputes it: blank, nothing to draw").toBe(p0 + 1);
  });

  it("given_textOff_for_a_mixing_slot_when_rendered_then_that_slots_atlas_text_is_left_out_and_the_other_keeps_its_own_review_focus_1", async () => {
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    expect([s.r.textMixing(0), s.r.textMixing(1)], "precondition").toEqual([true, true]);
    const before = atlasDraws(atlas).length;
    s.r.render(frame({ atlas, textOff: 0 }));
    expect([s.r.textMixing(0), s.r.textMixing(1)]).toEqual([false, true]);
    expect(atlasDraws(atlas).slice(before).map((d) => d[1]), "only B's atlas rect").toEqual([B_RECT.x]);
  });
  it("given_ink_and_atlas_text_drawn_when_the_renderer_is_destroyed_then_its_text_layer_ink_and_mask_canvases_shrink_to_0_and_no_page_copy_is_kept_W89_final_review_M3", async () => {
    const s = await setup();
    const { frame: atlas } = atlasPage();
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    expect([s.r.textMixing(0), s.r.textMixing(1)], "precondition").toEqual([true, true]);
    const layer = extra(s).find((c) => c.ops("drawImage").some((d) => d.args[0] === atlas.canvas))!.canvas;
    const inkCanvas = extra(s).find((c) => c.lastImage === inkImage(s))!.canvas;
    const maskCanvas = layer && (fake.ctxFor(layer)!.ops("drawImage").find((d) => d.composite === "destination-out")!.args[0] as HTMLCanvasElement);
    const sizes = (): number[][] => [layer, inkCanvas, maskCanvas].map((c) => [c.width, c.height]);
    expect(sizes().every(([w, h]) => w! > 0 && h! > 0), "precondition: allocated").toBe(true);
    s.r.destroy();
    expect(sizes(), "text layer (device px), ink image and fade mask are released at once, not at GC").toEqual([[0, 0], [0, 0], [0, 0]]);
    const ink = (s.r as unknown as { ink: { page: unknown; badCanvas: unknown; pageCanvas: unknown } }).ink;
    expect([ink.page, ink.pageCanvas, ink.badCanvas], "no atlas page copy or canvas reference survives destroy").toEqual([null, null, null]);
  });

  it("given_an_unreadable_atlas_page_when_the_renderer_is_destroyed_then_it_keeps_no_reference_to_that_page_W89_final_review_M3", async () => {
    const s = await setup();
    const canvas = { width: 280, height: 60, getContext: () => null } as unknown as OffscreenCanvas;
    const atlas: TextAtlasFrame = { canvas, width: 280, height: 60, dpr: 1, version: 1 };
    s.r.render(frame({ atlas }));
    s.r.render(frame({ atlas }));
    const ink = (s.r as unknown as { ink: { badCanvas: unknown } }).ink;
    expect(ink.badCanvas, "precondition: the bad page is remembered").toBe(canvas);
    s.r.destroy();
    expect(ink.badCanvas).toBeNull();
  });
});
