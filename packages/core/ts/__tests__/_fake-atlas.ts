/**
 * W74: fakes for the text atlas in jsdom, which has no OffscreenCanvas and no
 * Range.getClientRects (verified 2026-10-10). `fakeAtlasCanvas()` is an AtlasCanvasFactory that
 * records every canvas it hands out and every fillText with the font, fill style, letter spacing
 * and transform in force. `installRangeRects(layout)` stubs Range.prototype.getClientRects with
 * the caller's layout of a text node's character range.
 */
import type { AtlasCanvasFactory } from "../src/renderers/webgpu/text-atlas";

export interface FakeFill {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly fillStyle: string;
  readonly letterSpacing: string;
  /** `[a, b, c, d, e, f]` of the last setTransform. */
  readonly transform: readonly number[];
}

/** px size in a CSS font shorthand ("normal 600 16px Arial" → 16); 10 when absent. */
export function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 10;
}

export class FakeAtlasContext {
  font = "10px sans-serif";
  fillStyle = "#000000";
  textBaseline = "alphabetic";
  letterSpacing = "0px";
  readonly fills: FakeFill[] = [];
  clears = 0;
  private transform: number[] = [1, 0, 0, 1, 0, 0];

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
  }

  clearRect(): void {
    this.clears += 1;
  }

  /** Ascent 0.8 · size, descent 0.2 · size, 0.5 · size per character. */
  measureText(text: string): TextMetrics {
    const size = fontPx(this.font);
    return {
      width: text.length * size * 0.5,
      fontBoundingBoxAscent: size * 0.8,
      fontBoundingBoxDescent: size * 0.2,
      actualBoundingBoxAscent: size * 0.7,
      actualBoundingBoxDescent: size * 0.1,
    } as TextMetrics;
  }

  fillText(text: string, x: number, y: number): void {
    this.fills.push({
      text, x, y, font: this.font, fillStyle: String(this.fillStyle), letterSpacing: this.letterSpacing, transform: [...this.transform],
    });
  }
}

export interface FakeAtlasCanvas {
  readonly width: number;
  readonly height: number;
  readonly ctx: FakeAtlasContext | null;
  getContext(type: string): FakeAtlasContext | null;
}

export interface FakeAtlasOptions {
  /** "null": the factory returns null (no OffscreenCanvas). */
  canvas?: "ok" | "null";
  /** "null": `getContext("2d")` returns null. */
  context?: "ok" | "null";
  /** Thrown by the factory. */
  throws?: Error;
}

export interface FakeAtlasFactory {
  readonly create: AtlasCanvasFactory;
  readonly canvases: FakeAtlasCanvas[];
  /** The fills of the newest canvas. */
  fills(): FakeFill[];
}

export function fakeAtlasCanvas(opts: FakeAtlasOptions = {}): FakeAtlasFactory {
  const canvases: FakeAtlasCanvas[] = [];
  const create: AtlasCanvasFactory = (width, height) => {
    if (opts.throws) throw opts.throws;
    if (opts.canvas === "null") return null;
    const ctx = opts.context === "null" ? null : new FakeAtlasContext();
    const canvas: FakeAtlasCanvas = { width, height, ctx, getContext: (type) => (type === "2d" ? ctx : null) };
    canvases.push(canvas);
    return canvas as unknown as OffscreenCanvas;
  };
  return { create, canvases, fills: () => canvases.at(-1)?.ctx?.fills ?? [] };
}

/** A DOMRect-shaped plain object. */
export function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/** Stubs Range.prototype.getClientRects with `layout(node, start, end)`; returns the restore function. */
export function installRangeRects(layout: (node: Text, start: number, end: number) => DOMRect[]): () => void {
  const proto = Range.prototype as unknown as { getClientRects?: unknown };
  const had = Object.prototype.hasOwnProperty.call(proto, "getClientRects");
  const previous = proto.getClientRects;
  proto.getClientRects = function getClientRects(this: Range): DOMRect[] {
    return layout(this.startContainer as Text, this.startOffset, this.endOffset);
  };
  return () => {
    if (had) proto.getClientRects = previous;
    else delete proto.getClientRects;
  };
}

/** Every text node on one line at `lineOf(node)`, `charW` px per character, `lineH` px high. */
export function oneLinePerNode(
  lineOf: (node: Text) => { left: number; top: number },
  charW = 8,
  lineH = 24,
): (node: Text, start: number, end: number) => DOMRect[] {
  return (node, start, end) => {
    const at = lineOf(node);
    return [rect(at.left + start * charW, at.top, (end - start) * charW, lineH)];
  };
}
