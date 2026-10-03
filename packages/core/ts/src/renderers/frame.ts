/**
 * The fluid `RenderFrame` and `Renderer` (spec §3; method shape kept from the
 * old renderer; decision D64-17). Coexists with the old `renderer.ts` until
 * W66 deletes it.
 */
import type { RGBA } from "../color";

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
  /** Text atlas sub-rect; slice 4. */
  readonly atlasRect: null;
}

export interface RenderViewport {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly dpr: number;
}

export interface RenderFrame {
  /** SoA `x, y, f00, f01, f10, f11, flags` (B14); a fresh view every frame. */
  readonly dynamicView: Float32Array;
  /** SoA `home, rest_u, rest_v`; changes only with `generation`. */
  readonly staticView: Float32Array;
  readonly generation: number;
  /** 4 floats per element: `s, maxDev, restAlpha, reserved`. */
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
}

export interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(frame: RenderFrame): void;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  destroy(): void;
}
