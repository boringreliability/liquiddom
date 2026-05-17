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
  theme: {
    colorDefault: string;
    colorHover: string;
    themeCache: Map<number, string>;
    shadowCache: Map<number, ShadowMargin>;
    /** Ward 039 metaball fusion radius (CSS px). Optional; undefined = 0 (no fusion). */
    fusionRadius?: number;
  };
}

export interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  render(frame: RenderFrame): void;
  resize(widthPx: number, heightPx: number, dpr: number): void;
  destroy(): void;
}
