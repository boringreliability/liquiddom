/**
 * The fluid `RenderFrame` and `Renderer` (spec §3; method shape kept from the
 * old renderer; decision D64-17). W74 adds the text atlas: the runtime builds it (renderers
 * never touch the DOM) and hands the page and each element's rect to the renderer.
 */
import type { RGBA } from "../color";
import type { ShadowLayer } from "../shadow";
import type { AtlasRect } from "./webgpu/text-atlas";

/**
 * Per-element paint record, rebuilt on every generation bump and kept until
 * the bump that reassigns the slot (plan resolution B12).
 */
export interface ElementPaint {
  readonly id: number;
  readonly background: RGBA;
  readonly text: RGBA;
  readonly radiusPx: number;
  readonly particleCount: number;
  /** Element area / particle count at redistribution (px²): the splat mass. */
  readonly areaPerParticle: number;
  /** √areaPerParticle (px): the kernel radius scales with it. */
  readonly spacingPx: number;
  /**
   * W74 (D74-5): the element's border box in the text atlas (atlas px); null without atlas text
   * (no text nodes, page overflow, no atlas, Canvas2D). Null keeps the DOM text visible.
   */
  readonly atlasRect: AtlasRect | null;
  /**
   * W74 ward-review (I1): a token of the element this slot holds (one per element per instance).
   * While a new atlas version is pending, a slot whose owner differs from the one the drawn page
   * was built for gets no atlas text. Undefined compares equal to undefined.
   */
  readonly owner?: number;
  /**
   * W88 (D88-2, D88-3): the element's outer box-shadow layers in CSS px, at most MAX_SHADOW_LAYERS,
   * in CSS order (the first paints on top); empty without one. The renderer draws them while the
   * element's liquid is away (`liquidAway`) and scales them by the DPR itself.
   */
  readonly shadows: readonly ShadowLayer[];
}

export interface RenderViewport {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly dpr: number;
}

/** W74 (D74-5): the atlas page the runtime built, for the WebGPU renderer to upload. */
export interface TextAtlasFrame {
  readonly canvas: OffscreenCanvas;
  /** Page size in atlas px. */
  readonly width: number;
  readonly height: number;
  /** The DPR the page was drawn at: CSS px = atlas px / dpr. */
  readonly dpr: number;
  /** +1 per built page; the renderer re-uploads when it changes. */
  readonly version: number;
}

export interface RenderFrame {
  /** SoA `x, y, f00, f01, f10, f11, flags` (B14); a fresh view every frame. */
  readonly dynamicView: Float32Array;
  /** SoA `home, rest_u, rest_v`; changes only with `generation`. */
  readonly staticView: Float32Array;
  readonly generation: number;
  /** 4 floats per element: `s, maxDev, restAlpha, maxFDev` (W74). */
  readonly stateView: Float32Array;
  /** 10 floats per element, as written by TS this frame. */
  readonly elementView: Float32Array;
  /** SoA field stride (B3). */
  readonly particleCapacity: number;
  /** 0 or `particleCapacity` in slices 1–2 (B3). */
  readonly activeParticles: number;
  /** Indexed by slot id; `undefined` = no paint (B12). */
  readonly paints: ReadonlyArray<ElementPaint | undefined>;
  readonly viewport: RenderViewport;
  readonly reducedMotion: boolean;
  /** W74: the text atlas; null or absent under Canvas2D, without OffscreenCanvas or after an atlas failure. */
  readonly textAtlas?: TextAtlasFrame | null;
  /**
   * W88 (Review Focus 1): true for the runtime's repaint when an instance stops
   * (no frame follows): it draws the liquid as it is and no shadow, so the browser's shadow (back as
   * the class goes) is never doubled by the canvas's.
   */
  readonly suppressShadows?: boolean;
}

export interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(frame: RenderFrame): void;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  destroy(): void;
  /**
   * W74 (D74-6): true when render() draws atlas text for slot `id` whenever its restAlpha < 1
   * (WebGPU only). The runtime sets `liquid-text` only then; a renderer without it never gets one.
   */
  textReady?(id: number): boolean;
  /**
   * W88 (D88-1): true when the last render() drew slot `id`'s outer shadow layers. The runtime holds
   * `liquid-shadow-away` on an element with outer layers only then, so the browser's shadow never
   * hides without the renderer's taking its place (a lost device, an element past the WebGPU source cap).
   */
  shadowsDrawn?(id: number): boolean;
}
