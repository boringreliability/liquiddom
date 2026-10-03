// Single-flight WASM loader (spec §2 "Robustness"; the W61 root cause is in
// spec §0). This is the only module that imports the repo-root wasm-pack
// output, and it must stay directly in ts/src/: scripts/copy-wasm.mjs rewrites
// that specifier for the published dist by file depth (plan resolution D3).
// Every type here is structural, so no emitted .d.ts references the glue.

/** The `FluidCore` surface TS relies on (Rust: `src/fluid/api.rs`). */
export interface FluidCoreLike {
  elements_ptr(): number;
  dynamic_ptr(): number;
  static_ptr(): number;
  state_ptr(): number;
  particle_capacity(): number;
  element_capacity(): number;
  active_particles(): number;
  cell_px(): number;
  max_area_px2(): number;
  element_stride(): number;
  state_stride(): number;
  dynamic_fields(): number;
  static_fields(): number;
  generation(): number;
  tick(
    rawDtS: number,
    px: number,
    py: number,
    pvx: number,
    pvy: number,
    pointerActive: boolean,
    gx: number,
    gy: number,
  ): number;
  splash(id: number, x: number, y: number, strength: number): void;
  shake(strength: number): void;
  set_material(viscosity: number, cohesion: number, recovery: number): void;
  redistribute(): void;
  set_reduced_motion(on: boolean): void;
  free(): void;
}

/** Plan resolution B15 adds `maxElementHPx` (the grid margin source). */
export type FluidCoreCtor = new (
  particles: number,
  maxElements: number,
  worldWPx: number,
  worldHPx: number,
  areaHintPx2: number,
  maxElementHPx: number,
  seed: number,
) => FluidCoreLike;

/** The loaded backend; also the shape of the `@internal` `testBackend` option. */
export interface FluidBackend {
  readonly memory: { readonly buffer: ArrayBufferLike };
  readonly FluidCore: FluidCoreCtor;
}

/** What the wasm-bindgen glue module looks like to the loader. */
export interface WasmModuleLike {
  default: (init?: unknown) => Promise<{ memory: { readonly buffer: ArrayBufferLike } }>;
  FluidCore?: FluidCoreCtor;
}

export type WasmImporter = () => Promise<WasmModuleLike>;

/** `create()` rejects with this when the WASM module cannot be loaded. */
export class LiquidWasmLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LiquidWasmLoadError";
  }
}

/**
 * Returns a loader that runs `importer` and the glue's init at most once at a
 * time: concurrent callers share one promise, and a rejection resets it so
 * the next call retries.
 */
export function createWasmLoader(
  importer: WasmImporter,
  initArg?: () => unknown,
): () => Promise<FluidBackend> {
  let inflight: Promise<FluidBackend> | null = null;
  const load = async (): Promise<FluidBackend> => {
    let mod: WasmModuleLike;
    try {
      mod = await importer();
    } catch (cause) {
      throw new LiquidWasmLoadError(
        "[liquiddom] could not import the WASM glue. Run `npm run build:wasm` (or check the deployed wasm/ folder).",
        { cause },
      );
    }
    const FluidCore = mod.FluidCore;
    if (typeof FluidCore !== "function") {
      throw new LiquidWasmLoadError(
        "[liquiddom] the WASM glue has no FluidCore export; rebuild it with `npm run build:wasm`.",
      );
    }
    let exports: { memory: { readonly buffer: ArrayBufferLike } };
    try {
      exports = await mod.default(initArg?.());
    } catch (cause) {
      throw new LiquidWasmLoadError(
        "[liquiddom] could not instantiate liquiddom_bg.wasm (fetch or compile failed).",
        { cause },
      );
    }
    return { memory: exports.memory, FluidCore };
  };
  return () => {
    if (inflight) return inflight;
    const p = load();
    inflight = p;
    p.catch(() => {
      if (inflight === p) inflight = null;
    });
    return p;
  };
}

const importGlue: WasmImporter = () =>
  import("../../../../pkg/liquiddom.js") as unknown as Promise<WasmModuleLike>;

/** Module-level single flight shared by every runtime in this realm. */
export const loadFluidWasm: () => Promise<FluidBackend> = createWasmLoader(importGlue);
