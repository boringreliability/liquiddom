/**
 * W74 (D74-5): the text atlas (spec §3 "Text atlas"; slice-4 design §3). The runtime builds it
 * from the DOM under WebGPU — text nodes only, line boxes from `Range.getClientRects()`, the
 * computed style of each text node's parent, `fillText` word by word at the device pixel ratio,
 * no re-wrapping — into one shelf-packed canvas page with `ceil(10·dpr)` atlas px of gutter
 * around each element. The renderer only uploads the page: rendering never touches the DOM.
 * jsdom has no OffscreenCanvas, so tests inject `createCanvas`.
 *
 * Fail-safe (README Review Focus 1 and 4): an element without text, wider than the page or past
 * its height gets no rect, so it never gets `liquid-text` and its DOM text stays. A factory that
 * returns null (no OffscreenCanvas) or a page without a 2d context gives no atlas, silently; a
 * missing `Range.getClientRects` throws (the runtime warns once and draws no text).
 * W75: `invalidate(id)` marks the page stale; the runtime rebuilds while `stale`.
 */

/** An element's border box in the atlas page, in atlas px (CSS px × dpr). */
export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Creates the atlas page; null when the environment has no OffscreenCanvas. */
export type AtlasCanvasFactory = (w: number, h: number) => OffscreenCanvas | null;

/** CSS px of empty page around each element (≥ one kernel radius, spec §3): `ceil(10·dpr)` atlas px. */
export const ATLAS_GUTTER_PX = 10;
/** Page edge in atlas px; within WebGPU's guaranteed maxTextureDimension2D (8192). */
export const ATLAS_MAX_SIZE_PX = 4096;

export interface AtlasEntry {
  readonly id: number;
  readonly el: HTMLElement;
  /** Device pixel ratio; every entry of one build carries the same value (the first one wins). */
  readonly dpr: number;
}

export const defaultAtlasCanvas: AtlasCanvasFactory = (w, h) =>
  typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : null;

/** NodeFilter.SHOW_TEXT, without relying on a NodeFilter global. */
const SHOW_TEXT = 0x4;
const WORD = /\S+/g;

interface Placed {
  readonly id: number;
  readonly el: HTMLElement;
  readonly box: DOMRect;
  readonly x: number;
  readonly y: number;
}

/** True when `el` has a text node with non-whitespace content. */
function hasText(el: HTMLElement): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.nodeValue ?? "").trim() !== "") return true;
  }
  return false;
}

function validDpr(dpr: number | undefined): number {
  return dpr !== undefined && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Canvas `font` shorthand from computed style: style, small-caps, weight, size, family. */
function canvasFont(cs: CSSStyleDeclaration): string {
  const caps = cs.fontVariantCaps === "small-caps" ? "small-caps" : "";
  return `${cs.fontStyle} ${caps} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`.replace(/\s+/g, " ").trim();
}

/** The DOM draws transformed glyphs; the word is transformed the same way (capitalize per word). */
function transformed(word: string, textTransform: string): string {
  if (textTransform === "uppercase") return word.toUpperCase();
  if (textTransform === "lowercase") return word.toLowerCase();
  if (textTransform === "capitalize") return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

function finiteOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Fills every word of `el`'s text nodes at its first line box: client CSS px mapped onto the page.
 * W74 review: clipped to the element's slot box (its atlas rect, set under the identity
 * transform), so an overflowing word or ellipsis text never bleeds into a neighbour's slot;
 * save/restore per element.
 */
function drawText(ctx: OffscreenCanvasRenderingContext2D, el: HTMLElement, box: DOMRect, slot: AtlasRect, dpr: number): void {
  const view = el.ownerDocument.defaultView;
  if (!view) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.w, slot.h);
    ctx.clip();
    fillWords(ctx, el, view, box, slot.x, slot.y, dpr);
  } finally {
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function fillWords(
  ctx: OffscreenCanvasRenderingContext2D,
  el: HTMLElement,
  view: Window,
  box: DOMRect,
  ox: number,
  oy: number,
  dpr: number,
): void {
  const doc = el.ownerDocument;
  const range = doc.createRange();
  ctx.setTransform(dpr, 0, 0, dpr, ox - box.left * dpr, oy - box.top * dpr);
  ctx.textBaseline = "alphabetic";
  const walker = doc.createTreeWalker(el, SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    const parent = n.parentElement;
    if (!parent || text.trim() === "") continue;
    const cs = view.getComputedStyle(parent);
    if (cs.visibility === "hidden" || cs.visibility === "collapse") continue;
    ctx.font = canvasFont(cs);
    ctx.fillStyle = cs.color;
    if ("letterSpacing" in ctx) {
      (ctx as { letterSpacing: string }).letterSpacing = cs.letterSpacing && cs.letterSpacing !== "normal" ? cs.letterSpacing : "0px";
    }
    const size = parseFloat(cs.fontSize) || 16;
    for (const m of text.matchAll(WORD)) {
      const start = m.index ?? 0;
      range.setStart(n, start);
      range.setEnd(n, start + m[0].length);
      const line = range.getClientRects()[0];
      if (!line || !(line.width > 0 && line.height > 0)) continue;
      const word = transformed(m[0], cs.textTransform);
      const tm = ctx.measureText(word);
      const ascent = finiteOr(tm.fontBoundingBoxAscent, 0.8 * size);
      const descent = finiteOr(tm.fontBoundingBoxDescent, 0.2 * size);
      // The line box centres the font box: baseline = top + (height − (ascent + descent)) / 2 + ascent.
      ctx.fillText(word, line.left, line.top + (line.height - (ascent + descent)) / 2 + ascent);
    }
  }
}

export class TextAtlas {
  private readonly createCanvas: AtlasCanvasFactory;
  private readonly maxSize: number;
  private page: OffscreenCanvas | null = null;
  private pageW = 0;
  private pageH = 0;
  private pageDpr = 1;
  private builds = 0;
  private dirty = false;

  constructor(opts: { createCanvas?: AtlasCanvasFactory; maxSize?: number } = {}) {
    const max = opts.maxSize ?? ATLAS_MAX_SIZE_PX;
    if (!(Number.isInteger(max) && max >= 1)) {
      throw new RangeError(`[liquiddom] TextAtlas maxSize must be a positive integer, got ${String(max)}`);
    }
    this.createCanvas = opts.createCanvas ?? defaultAtlasCanvas;
    this.maxSize = max;
  }

  /** The page of the last successful build; null before, without text or without a canvas. */
  get canvas(): OffscreenCanvas | null {
    return this.page;
  }

  get width(): number {
    return this.pageW;
  }

  get height(): number {
    return this.pageH;
  }

  /** The DPR the page was drawn at: CSS px = atlas px / dpr. */
  get dpr(): number {
    return this.pageDpr;
  }

  /** +1 per built page; the renderer re-uploads when it changes. */
  get version(): number {
    return this.builds;
  }

  /** W75: true after `invalidate()` until the next `build()`. */
  get stale(): boolean {
    return this.dirty;
  }

  /** W75 hook (text, font or DPR change of element `id`); v1 re-renders the whole page on the next build. */
  invalidate(_id: number): void {
    this.dirty = true;
  }

  /**
   * Packs every entry with text into one page and draws it. Returns the rect per id; an entry
   * without text, wider than the page or past its height has none. Throws when
   * `Range.getClientRects` is missing (after the page exists; the previous page is kept).
   */
  build(entries: ReadonlyArray<AtlasEntry>): ReadonlyMap<number, AtlasRect> {
    this.dirty = false;
    const rects = new Map<number, AtlasRect>();
    const dpr = validDpr(entries[0]?.dpr);
    const gutter = Math.ceil(ATLAS_GUTTER_PX * dpr);
    const max = this.maxSize;
    const placed: Placed[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    let usedW = 0;
    for (const e of entries) {
      if (!hasText(e.el)) continue;
      const box = e.el.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0)) continue;
      const slotW = Math.ceil(box.width * dpr) + 2 * gutter;
      const slotH = Math.ceil(box.height * dpr) + 2 * gutter;
      if (slotW > max || slotH > max) continue; // Review Focus 4: larger than the page
      if (x + slotW > max) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (y + slotH > max) continue; // Review Focus 4: the page is full
      placed.push({ id: e.id, el: e.el, box, x, y });
      x += slotW;
      usedW = Math.max(usedW, x);
      shelf = Math.max(shelf, slotH);
    }
    const first = placed[0];
    if (!first) {
      this.clearPage();
      return rects;
    }
    const w = usedW;
    const h = y + shelf;
    const canvas = this.createCanvas(w, h);
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) {
      this.clearPage();
      return rects;
    }
    if (typeof first.el.ownerDocument.createRange().getClientRects !== "function") {
      throw new Error("[liquiddom] text atlas: Range.getClientRects() is not available");
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const p of placed) {
      const slot: AtlasRect = { x: p.x + gutter, y: p.y + gutter, w: p.box.width * dpr, h: p.box.height * dpr };
      drawText(ctx, p.el, p.box, slot, dpr);
      rects.set(p.id, slot);
    }
    this.page = canvas;
    this.pageW = w;
    this.pageH = h;
    this.pageDpr = dpr;
    this.builds += 1;
    return rects;
  }

  private clearPage(): void {
    this.page = null;
    this.pageW = 0;
    this.pageH = 0;
  }
}
