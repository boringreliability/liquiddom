import type { ShadowMargin } from "../box-shadow";

export { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../phantom-observer";

export interface RenderFrameViewport {
  widthCss: number;
  heightCss: number;
  dpr: number;
  cullMargin: number;
  preserveBackgrounds: boolean;
}

export interface RenderFrame {
  entities: Float32Array;
  particles: Float32Array | null;
  capacity: number;
  softBodyIds: ReadonlyArray<number>;
  dropletIds: ReadonlyArray<number>;
  viewport: RenderFrameViewport;
  /** Ward 040: reduced-motion gating threaded from the RAF loop into the renderer. */
  reducedMotion: boolean;
  theme: {
    colorDefault: string;
    colorHover: string;
    themeCache: Map<number, string>;
    shadowCache: Map<number, ShadowMargin>;
    /** Ward 039 metaball fusion radius (CSS px). Optional; undefined = 0 (no fusion). */
    fusionRadius?: number;
    /** Ward 040 background refraction. WebGPU-only; Canvas2D ignores. */
    refraction?: {
      enabled: boolean;
      /** UV displacement magnitude in CSS px. CPU-clamped to finite non-negative. */
      strength: number;
    };
  };
}

export interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(frame: RenderFrame): void;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  destroy(): void;
  /**
   * Ward 040: hand a host-supplied background snapshot for refractive sampling.
   * `null` releases any prior texture and falls back to the internal dummy.
   * WebGPU renderer uses it; Canvas2D logs once + no-ops.
   *
   * v1 limitation: `winner.color` is premultiplied alpha but `textureSample`
   * returns straight alpha — for fully-opaque bitmaps this is invisible, but
   * bitmaps with significant transparency (e.g., PNGs with alpha channels)
   * produce a slightly darkened fringe at the blob edge. Supply opaque
   * snapshots in v1; a future ward may add a premultiply pass.
   */
  setBackgroundTexture?(bitmap: ImageBitmap | null): void;
}
