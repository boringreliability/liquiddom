---
ward: 37
revision: null
name: "WebGPU Pipeline Scaffolding"
epic: "webgpu-rendering"
status: "complete"
dependencies: [36]
layer: "typescript"
estimated_tests: 7
created: "2026-05-10"
completed: "2026-05-16"
---
# Ward 037: WebGPU Pipeline Scaffolding

<!-- W41 changed `LiquidOptions.renderer` default from 'canvas2d' to 'auto'.
     References to 'canvas2d' as the default below are historical — see ward-041.md. -->


## Revision history
- **r1** — initial fleshed-out spec.
- **r2** (this revision) — addresses 8 critical and 6 should-fix findings from 3 parallel reviews (code-reviewer + WebGPU-technical + forward-compat):
  - **C1 fix (Decision §4 + WGSL):** locked `EntityGPU` to 32 bytes (`color: vec4<f32>, centroid: vec2<f32>, _pad: vec2<f32>`). Removed `ImplementationNote A` waffling. Shader pseudocode rewritten to read `entities[iid].centroid` correctly (was `vec2<f32>(0.0, 0.0)` placeholder that would have rendered all blobs from screen origin).
  - **C2 fix (Decision §11 + barrel re-export):** broke the would-be circular import. `WebGPUUnavailableError` is exported ONLY from `webgpu-renderer.ts`. The package barrel imports directly from `./renderers/webgpu-renderer`, NOT via `renderer.ts` re-export. Spec §Type-additions corrected.
  - **C3 fix (Decision §6 + new R9):** sRGB color-space mismatch resolved. `ctx.configure()` now uses `viewFormats: [format, sRgbFormat]` and the render pass creates the color attachment view with the `-srgb` view format so the framebuffer write does sRGB gamma encoding. Without this, blobs render visibly darker than Canvas2D.
  - **C4 fix (Decision §7 + Specification + new R10):** added `device.pushErrorScope("validation")` around shader/pipeline creation with `await popErrorScope()` to catch shader compilation errors as `WebGPUUnavailableError`. R7 mention of "try/catch" was insufficient.
  - **C5 fix (Decision §17 NEW):** locked "WebGPU canvas must be fresh — getContext('2d') must never have been called on it." Trivially satisfied in W37 (init-time renderer choice; opposite-typed `getContext` is never called). For W41's `'auto'` fallback, this means probing must happen on a throwaway canvas OR the canvas must be recreated on renderer switch.
  - **C6 fix (Tests):** added T5 covering both `requestDevice` rejection (Decision §7 path C) AND `getContext("webgpu")` returning null (path D — new sub-path explicitly enumerated). Test count 4→5.
  - **C7 fix (Decision §1 amendment):** draw-call arity (`VERTICES_PER_BLOB=48`) is shader-pair-specific. W38 may change to `draw(6, capacity)` for AABB quads when SDF replaces triangle fans. Documented as non-locked.
  - **C8 fix (Decision §10 amendment):** `preserveBackgrounds` clip support is no longer a vague "deferred to W38" — it's a HARD requirement of W38's Must-DO list (clip via SDF discard against rounded-rect of element rect). Prevents the feature from falling through cracks.
  - **m1 fix (Decision §18 NEW):** `RenderFrame.theme` is treated as additively-extensible; W39 (fusion config), W40 (refraction config) can add fields without breaking the W37 contract.
  - **m2 fix (R1 amendment):** `@webgpu/types` pinned to `^0.1.50` (stable WebGPU types compatible with TS 5.x). Specified explicitly to avoid build-zero version drift.
  - **m3 fix (R3 amendment):** documented the fan-overlap blending artifact (alpha<1 + overlapping triangles compositing darker bands during deformation). W38 SDF eliminates this entirely.
  - **m4 fix (Decision §7 path enumeration):** WebGPUUnavailableError sub-paths now A/B/C/D (was A/B/C). D = `canvas.getContext("webgpu")` returned null.
  - **m5 fix (Decision §13 amendment):** added that the mock-mode no-op in `render()` is for hypothetical future env where init succeeded but particles transiently null; jsdom always rejects at init.
  - **m6 fix (W41 transition note):** added one-line callout in Specification §Wire-up that W41 will extend the `if/switch` with an `'auto'` arm.

## Scope
Implement `WebGPURenderer` (TypeScript-only, native browser `navigator.gpu` API — no `wgpu-rust` crate) that draws colored polygons matching Canvas2D's soft-body and droplet output at visual rest. Establishes the GPU device + pipeline + buffer layout + per-frame upload path. This is the foundation for W38 (SDF blob fragment shader), W39 (metaball fusion), and W40 (refraction). No SDF, no metaballs, no clip pass in this ward — that's all W38+.

After W37 a consumer passes `LiquidDOM.create({ renderer: 'webgpu', ... })` and gets blobs rendered through the GPU pipeline. On any WebGPU init failure (no `navigator.gpu`, adapter rejected, device rejected), `LiquidDOM.create()` rejects with a `WebGPUUnavailableError`. The Canvas2D path is unchanged; consumers without `renderer` option still get Canvas2D as before. The `'auto'` value that probes WebGPU and falls back silently is W41's job — W37 is explicit opt-in only.

Out of scope:
- `'auto'` option value or graceful fallback (W41).
- SDF / metaball / refraction shaders (W38, W39, W40).
- `preserveBackgrounds: true` support in WebGPU path (deferred — see Decision §10).
- Per-element themed colors from `themeCache` for the WebGPU path. The `colorDefault` / `colorHover` global colors are honored; per-element computed colors fall back to `colorDefault` for now. (Locked by Decision §11; W38 SDF can revisit.)
- Compute shaders. Centroid is computed CPU-side from slot[0..3] (the rect center). Marginal mid-deformation drift is acceptable for scaffolding because W38 SDF replaces the geometry entirely.
- WebGPU on Node.js / Deno / Bun (Dawn bindings). Browser-only.
- Color space management beyond sRGB premultiplied. WebGPU's preferred format is auto-negotiated via `navigator.gpu.getPreferredCanvasFormat()`.

## Inputs
- `Renderer` interface, `RenderFrame` DTO + `RenderFrameViewport` from `packages/core/ts/src/renderers/renderer.ts` (W36).
- `FLOATS_PER_ENTITY` (9), `PARTICLES_PER_BODY` (16) re-exported from the same module.
- `PhantomObserver.buildFrame(viewport)` from W36 — provides entity buffer, particle buffer, soft-body/droplet id arrays, theme, viewport.
- `LiquidOptions` from `packages/core/ts/src/index.ts` — extends with `renderer?: 'canvas2d' | 'webgpu'` (default `'canvas2d'`).
- `Canvas2DRenderer` (W36) for the fallback default. Unchanged.

## Outputs
- New file `packages/core/ts/src/renderers/webgpu-renderer.ts` — `WebGPURenderer implements Renderer`.
- New file `packages/core/ts/src/renderers/shaders/blob.wgsl` — minimal vertex + fragment pair drawing per-entity colored triangle fans. WGSL source as inline string in a TS file or imported via Vite raw-loader; this spec locks the file path but lets gold pick the inlining strategy (a TS string export from `blob.wgsl.ts` is simplest and unblocks W38).
- New exported class `WebGPUUnavailableError extends Error` from `webgpu-renderer.ts` (and re-exported from `renderer.ts` for W41 to catch).
- Edit `packages/core/ts/src/index.ts`:
  - Add `renderer?: 'canvas2d' | 'webgpu'` to `LiquidOptions` (default `'canvas2d'`).
  - Replace `const renderer: Renderer = new Canvas2DRenderer()` with a 1-line `switch` (or `if`):
    ```ts
    const renderer: Renderer = options?.renderer === 'webgpu'
      ? new WebGPURenderer()
      : new Canvas2DRenderer();
    ```
  - `await renderer.init(canvas)` is already in place from W36 and propagates failure correctly.
- 4 tests in a new file `packages/core/ts/__tests__/webgpu-renderer.test.ts` covering the error path + contract sanity (jsdom can't run real WebGPU; runtime parity is a manual smoke test).
- `WebGPUUnavailableError` exported from the package barrel (`packages/core/src/index.ts`) so consumers and W41 can `catch (err) { if (err instanceof WebGPUUnavailableError) ... }`.

## Decisions (locked in this spec)

### Pipeline architecture

1. **Vertex pulling via storage buffers, not classic vertex buffers.** Particles arrive as a flat `Float32Array` from WASM via `frame.particles`. To avoid per-frame buffer recreation, we upload it once into a single GPU **storage buffer** sized for full capacity (`capacity × 16 × 2` floats = 8 KB at capacity 64) and let the vertex shader compute its position from `instance_index` + `vertex_index`. This eliminates the need for an index buffer per-entity and lets a single `draw` call render all active entities in one shot. W37: `passEncoder.draw(48, frame.capacity, 0, 0)` — 48 vertices per instance (16 triangles × 3), `frame.capacity` instances (inactive slots collapsed via degenerate vertices per Decision §2). **(r2 amendment, C7):** `VERTICES_PER_BLOB = 48` is shader-pair-specific and NOT locked across the WebGPU epic. W38's SDF replaces the triangle-fan geometry with AABB quads (`draw(6, capacity)`); the draw-call arity changes WITH the shader pair, not as a breaking change.

2. **One draw call per frame total**, not one per entity. The shader uses `instance_index` to look up its per-entity data and `vertex_index` to derive which triangle and corner to emit. Inactive slots are degenerated (vertices collapsed off-screen via a sentinel position) rather than skipped — branching in the vertex shader is cheaper than CPU bookkeeping for ≤128 instances. Worst-case GPU work at default capacity 128: 128 × 48 = 6144 vertex shader invocations per frame, well under any device limit. (W39 fusion pivots to a full-screen quad.)

3. **Centroid = rect center.** The vertex shader emits 16 triangles per entity, each `(centroid, particle[i], particle[i+1])`. For W37, the centroid is `(slot[0] + slot[2]/2, slot[1] + slot[3]/2)` — the rect center, not the actual particle centroid. The particle centroid drifts during deformation (drag, shake), but in deformation the difference is small (~5% of size) and W37 is scaffolding only. W38's SDF rendering replaces the geometry entirely. (R3 in Risks.) The centroid is computed CPU-side in `render()` and packed into the entity storage buffer alongside color — see Decision §4.

4. **`EntityGPU` storage-buffer layout: 32 bytes per entity, std430-aligned** (r2 amendment, C1):
   ```wgsl
   struct EntityGPU {
     color: vec4<f32>,    // 16 bytes: premultiplied rgba in [0, 1]
     centroid: vec2<f32>, // 8 bytes: CSS-px coords, rect center
     _pad: vec2<f32>,     // 8 bytes: alignment padding (std430 wants 16-byte stride for arrays of structs)
   };
   ```
   Total storage = `capacity × 32` bytes ≈ 2 KB at capacity 64, 4 KB at capacity 128. Layout is `Float32Array`-friendly: 8 floats per entity. CPU `entityScratch = new Float32Array(capacity * 8)`. Pack order per entity at offset `id × 8`: `[r·a, g·a, b·a, a, centroid_x, centroid_y, 0, 0]`. Color is computed CPU-side per frame from `frame.theme.colorDefault` / `colorHover` based on slot[4] (hover state) via a small `parseColor()` helper handling `rgba(r, g, b, a)` and `rgb(r, g, b)` syntax. `themeCache` is NOT read in v1 (Decision §11). Active slots have full alpha; inactive slots (w === 0) get alpha 0 so the degenerate-collapse branch in the vertex shader fires (`if (entity.color.a == 0.0) pos = (-99999, -99999)`).

5. **Projection matrix: orthographic CSS-px → clip-space, in a tiny uniform buffer.** Updated on `resize()`. Matrix is:
   ```
   m = [ 2/widthCss, 0,            0, 0,
         0,          -2/heightCss, 0, 0,
         0,          0,            1, 0,
         -1,         1,            0, 1 ]
   ```
   (Y-flip because WebGPU clip-space has Y up.) DPR is NOT in the matrix — DPR is applied to the canvas backing-store size (via `canvas.width = w * dpr` in the RAF loop's `resizeCanvas`, unchanged from W36); the GPU sees CSS px in, clip space out, framebuffer at the DPR-scaled size.

6. **Canvas context configuration with sRGB view format** (r2 amendment, C3): `canvas.getContext("webgpu")` is requested in `init()`. The context is configured with:
   ```ts
   const format = navigator.gpu.getPreferredCanvasFormat();  // typically bgra8unorm or rgba8unorm (NOT srgb on the storage side)
   const sRgbFormat = `${format}-srgb` as GPUTextureFormat;   // bgra8unorm-srgb / rgba8unorm-srgb
   ctx.configure({ device, format, alphaMode: "premultiplied", viewFormats: [sRgbFormat] });
   ```
   The render pass creates the color-attachment view with the `-srgb` view format: `ctx.getCurrentTexture().createView({ format: sRgbFormat })`. This makes the fragment shader's linear-space writes go through gamma encoding on framebuffer write, matching Canvas2D's sRGB blending behavior. Without it, blobs render visibly darker than the Canvas2D path. Alpha is premultiplied so the canvas composites correctly over body bg (matching Canvas2D's `globalCompositeOperation = "source-over"` default). `parseColor("rgba(r, g, b, a)")` returns `(r/255 × a, g/255 × a, b/255 × a, a)` — premultiplied — so the math matches the blend equation `srcFactor: one, dstFactor: one-minus-src-alpha`.

### Error handling

7. **`WebGPUUnavailableError` is a distinct error class** (extends `Error` with `.name = "WebGPUUnavailableError"`) thrown by `init()` from four sources (r2 amendment, m4):
   - **Path A:** `navigator.gpu === undefined` (Firefox, Safari ≤17.4 by default, all non-secure contexts).
   - **Path B:** `await navigator.gpu.requestAdapter()` returns `null` (no adapter found, hardware-incompatible).
   - **Path C:** `await adapter.requestDevice()` rejects or throws (device limits exceeded, internal error).
   - **Path D:** `canvas.getContext("webgpu")` returns `null` (canvas was already used for `"2d"` context — see Decision §17).
   - **Path E (r2 amendment, C4):** shader compilation or pipeline creation fails. Wrapped in `device.pushErrorScope("validation")` → create shader module → create pipeline → `await popErrorScope()`. If the scope returns a non-null `GPUError`, throw `WebGPUUnavailableError("shader compile or pipeline create failed", { cause: error })`.
   
   The message includes a `cause` field naming which sub-step failed. The class is exported from `webgpu-renderer.ts` ONLY (r2 amendment, C2: NO re-export from `renderer.ts` to avoid the renderer ↔ webgpu-renderer circular import). The package barrel imports it directly from `./renderers/webgpu-renderer`. Consumers `import { WebGPUUnavailableError } from "liquiddom"`.

8. **No retry logic in `init()`.** If init fails, the renderer is in a permanently-broken state. Re-attempting would require a fresh `WebGPURenderer` instance. W41's `'auto'` mode handles the fallback orchestration.

9. **`device.lost` is observed but NOT handled in W37.** When the GPU device is lost (driver crash, tab background, etc.), the WebGPU pipeline becomes unusable. W37 attaches a `.lost` listener that simply logs `console.warn("[liquiddom] WebGPU device lost — render loop continues but draws nothing")`. Subsequent `render()` calls become no-ops (the device's queue rejects all writes). W41 will add the actual mid-session fallback. This is acceptable because: (a) device-lost is rare in practice, (b) tests for the error class don't depend on lost-handling, (c) the silent-no-op is safer than throwing inside a render frame.

### Render path

10. **`preserveBackgrounds: true` is NOT supported in W37; W38 MUST land it** (r2 amendment, C8 — was vague punt, now hard binding). When the frame's viewport has `preserveBackgrounds: true`, `WebGPURenderer.render()` issues a `console.warn` once per session and renders without the clip-hole (so blobs are drawn on top of element backgrounds — visually wrong but functional). A proper implementation is part of W38: SDF gives us per-fragment masking naturally — discard fragments that fall inside the rounded-rect of the element's bbox (the rect data is available in the entity buffer; the element's border-radius is already in `slot[8]`). **This is now an explicit hard requirement of W38's Must-DO list** to prevent the feature falling through cracks across W38→W41. Rationale: implementing rounded-rect stencil in WebGPU for W37 alone is ~150 LOC of throwaway scaffolding; SDF reuses the same masking infrastructure. The `console.warn` is suppressible: it fires once via a closure-captured `warned` flag.

11. **`themeCache` (W052 per-element computed colors) is NOT read in W37.** All soft-body entities get `colorDefault` (or `colorHover` if slot[4] === 1.0). Droplets get `colorDefault`. Consumers using `colorSource: 'computed'` will see all blobs render in the same color when WebGPU renderer is active. Documented as a v1 limitation; W38 SDF revisits because per-element color packing is trivial in a storage buffer + shader sample.

12. **Droplet rendering mirrors soft-body rendering** — same triangle-fan from rect center to particle perimeter. For droplets, `frame.entities[off + 2]` is diameter (not width); the renderer treats `(cx ± diameter/2)` as the bounding rect and centers the fan at `(cx, cy)`. This works because droplet particles ARE laid out on a perimeter circle (Rust writes them that way in `api.rs:158-162`).

13. **Mock-mode tolerance preserved.** When `frame.particles === null` (WASM didn't load), `WebGPURenderer.render()` becomes a no-op for that frame. The renderer stays initialized — next frame with a non-null particle buffer renders normally. (Matches Canvas2D's behavior where mock-mode falls back to `fillRect`; WebGPU's equivalent is "nothing" because triangulated fillRect from a storage buffer with no particle data would render zero-area triangles anyway.) **(r2 clarification, m5):** in jsdom, `init()` always throws (no `navigator.gpu`), so the `render()` mock-mode branch is never reached in W37 tests. The branch exists for forward-compat with hypothetical environments where WebGPU init succeeds but particles are transiently null (e.g., between `instance.create()` and the first observation when capacity > 0 but no entities yet).

### Lifecycle

14. **`init()` returns `Promise<void>`.** Per W36 Decision §8. `init()` does the full async chain (`requestAdapter()`, `requestDevice()`, shader compile, pipeline create, buffer create, bind group create). All errors become `WebGPUUnavailableError`. Successful `init()` leaves the renderer ready for `render()` and `resize()`.

15. **`resize(widthPx, heightPx, dpr)` rebuilds the projection matrix uniform.** The canvas backing-store size is set by the RAF loop's `resizeCanvas()` BEFORE `renderer.resize()` is called (W36 Decision §15). WebGPU's canvas context picks up the new size automatically; we just need to update the projection matrix. No buffer recreation, no pipeline rebuild.

16. **`destroy()` is synchronous and idempotent.** Releases the `device` (which cascades to buffers, bind groups, pipelines). Sets internal fields to null. Idempotent because subsequent `destroy()` calls find null fields and exit. Safe to call before `init()` (uninitialized state) and after a failed `init()` (partially initialized — some buffers may exist, some not). Locked by Test #4. `device.destroy()` is fire-and-forget in WebGPU spec.

17. **WebGPU canvas must be FRESH** (r2 NEW, C5). `canvas.getContext("webgpu")` returns `null` permanently if `getContext("2d")` was ever called on the same canvas. For W37 this is trivially satisfied: the renderer choice is init-time (Decision §14, before any `getContext` call), and the chosen renderer is the only one to touch the canvas's context. **For W41's future `'auto'` mode this becomes load-bearing**: probing WebGPU on the actual canvas and then falling back to Canvas2D on the SAME canvas would have already burned the WebGPU context slot via Canvas2D's `getContext("2d")` first call. W41 MUST either (a) probe on a throwaway off-screen canvas before mounting, or (b) recreate the canvas element on fallback. This decision pre-commits W41's design surface.

18. **`RenderFrame.theme` is additively extensible** (r2 NEW, m1). W39 will add `theme.fusionRadius?: number` / `theme.fusionStrength?: number`. W40 will add `theme.refraction?: { enabled, strength }`. These are additive (optional) fields; they do NOT break the W36 DTO contract because consumers and renderers read what they expect and ignore the rest. The shape extension is non-breaking at the type level (optional properties). Renderer-direct methods like W40's `instance.setBackgroundTexture(bitmap: ImageBitmap)` for non-buffer-routed data are anticipated outside the `RenderFrame` DTO (they sit on `LiquidDOMInstance`).

### Build / packaging

17. **WGSL source is a TypeScript string in `blob.wgsl.ts`**, NOT a `.wgsl` file imported via raw-loader. Reasons: (a) avoids Vite-specific raw-import config that would break consumers using webpack/esbuild/Rollup, (b) keeps the published package buildable without bundler plugins, (c) WGSL strings benefit from TypeScript's tagged-template-literal hooks (not used in v1 but possible later). The file lives in `packages/core/ts/src/renderers/shaders/blob.wgsl.ts` and exports a single named string `BLOB_WGSL`. The `.wgsl` filename convention is preserved by the `.wgsl.ts` suffix for editor syntax highlighting via the `wgsl-tagged` extension.

## Specification

### Type additions

In `packages/core/ts/src/index.ts`'s `LiquidOptions`:
```ts
export interface LiquidOptions {
  // ... existing fields ...
  renderer?: 'canvas2d' | 'webgpu';  // default 'canvas2d'
}
```

In `packages/core/src/index.ts` (the package barrel) — r2 amendment (C2): import DIRECTLY from `webgpu-renderer.ts`, NOT via `renderer.ts` re-export, to avoid the circular `renderer.ts → webgpu-renderer.ts → renderer.ts` import graph:
```ts
// Append:
export { WebGPUUnavailableError } from "../ts/src/renderers/webgpu-renderer";
```

`renderer.ts` is NOT modified by W37 (W36's content untouched). The `WebGPURenderer` class is internal-only and not re-exported from the package barrel; only `WebGPUUnavailableError` is exported because consumers need it for `instanceof` checks in their `catch` blocks.

### `WebGPURenderer` class structure

```ts
// packages/core/ts/src/renderers/webgpu-renderer.ts
import { BLOB_WGSL } from "./shaders/blob.wgsl";
import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY, type RenderFrame, type Renderer } from "./renderer";

const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;
const BYTES_PER_PARTICLE = 8;                          // vec2<f32>
const FLOATS_PER_ENTITY_GPU = 8;                       // r2 (C1): vec4 color + vec2 centroid + vec2 pad
const BYTES_PER_ENTITY_GPU = FLOATS_PER_ENTITY_GPU * 4; // 32 bytes
const VERTICES_PER_BLOB = PARTICLES_PER_BODY * 3;      // 48 = 16 triangles × 3 corners
                                                       // (r2 C7: arity is shader-pair-specific; W38 may change)

export class WebGPUUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebGPUUnavailableError";
  }
}

export class WebGPURenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private particleBuffer: GPUBuffer | null = null;
  private entityBuffer: GPUBuffer | null = null;
  private projectionBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private capacity = 0;
  private projMatrix = new Float32Array(16);
  private entityScratch: Float32Array | null = null;  // CPU scratch for entity packing
  private warnedPreserveBg = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new WebGPUUnavailableError("navigator.gpu is undefined");
    }
    let adapter: GPUAdapter | null;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestAdapter threw", { cause });
    }
    if (!adapter) {
      throw new WebGPUUnavailableError("requestAdapter returned null");
    }
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestDevice rejected", { cause });
    }
    this.device = device;
    device.lost.then((info) => {
      console.warn(`[liquiddom] WebGPU device lost: ${info.message}`);
      this.device = null; // render becomes no-op
    });

    const ctx = canvas.getContext("webgpu");
    if (!ctx) {
      // Path D: canvas was already used for "2d" context, or other failure.
      throw new WebGPUUnavailableError("canvas.getContext('webgpu') returned null");
    }
    this.ctx = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    const sRgbFormat = `${format}-srgb` as GPUTextureFormat;  // r2 (C3): sRGB view fmt
    ctx.configure({
      device,
      format,
      alphaMode: "premultiplied",
      viewFormats: [sRgbFormat],  // r2 (C3): allow creating srgb view in render()
    });
    this.sRgbFormat = sRgbFormat;  // stored for use in render()

    // Build pipeline with validation error scope (r2 C4 / Path E).
    device.pushErrorScope("validation");
    const shaderModule = device.createShaderModule({ code: BLOB_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs_main" },
      fragment: {
        module: shaderModule,  // r2: share shader module across stages
        entryPoint: "fs_main",
        targets: [{ format: sRgbFormat, blend: { color: PREMUL_BLEND, alpha: PREMUL_BLEND } }],
      },
      primitive: { topology: "triangle-list" },
    });
    const validationError = await device.popErrorScope();
    if (validationError) {
      throw new WebGPUUnavailableError(
        "shader compile or pipeline create failed",
        { cause: validationError },
      );
    }

    // Projection buffer (16 floats, mat4x4). Updated on resize().
    this.projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  resize(_widthPx: number, _heightPx: number, _dpr: number): void {
    // Projection is built from frame.viewport.widthCss/heightCss in render().
    // This stub exists for interface compliance; gold may move proj-rebuild
    // here if profiling shows allocation pressure.
  }

  render(frame: RenderFrame): void {
    const device = this.device;
    const ctx = this.ctx;
    const pipeline = this.pipeline;
    const projBuf = this.projectionBuffer;
    if (!device || !ctx || !pipeline || !projBuf) return;
    if (!frame.particles) return; // mock-mode

    if (frame.viewport.preserveBackgrounds && !this.warnedPreserveBg) {
      console.warn("[liquiddom] WebGPU renderer does not support preserveBackgrounds in W37 — blobs will render on top of element backgrounds. Use renderer: 'canvas2d' for clip support, or wait for W38 SDF support.");
      this.warnedPreserveBg = true;
    }

    // Lazy-allocate particle + entity buffers on first render or capacity change.
    if (frame.capacity !== this.capacity) {
      this.particleBuffer?.destroy();
      this.entityBuffer?.destroy();
      this.particleBuffer = device.createBuffer({
        size: frame.capacity * PARTICLE_FLOATS_PER_BODY * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.entityBuffer = device.createBuffer({
        size: frame.capacity * BYTES_PER_ENTITY_GPU,  // 32 bytes per entity (r2 C1)
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.entityScratch = new Float32Array(frame.capacity * FLOATS_PER_ENTITY_GPU);
      this.capacity = frame.capacity;
      this.bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: projBuf } },
          { binding: 1, resource: { buffer: this.particleBuffer } },
          { binding: 2, resource: { buffer: this.entityBuffer } },
        ],
      });
    }

    // Update projection matrix uniform from the current viewport.
    this.updateProjectionMatrix(frame.viewport.widthCss, frame.viewport.heightCss);
    device.queue.writeBuffer(projBuf, 0, this.projMatrix.buffer, this.projMatrix.byteOffset, 64);

    // Upload particle data verbatim.
    device.queue.writeBuffer(this.particleBuffer!, 0, frame.particles.buffer, frame.particles.byteOffset, frame.particles.byteLength);

    // Pack per-entity (color + centroid) into the CPU scratch then upload.
    // Layout per entity (8 floats × 4 bytes = 32 bytes, std430 array stride):
    //   [r·a, g·a, b·a, a, centroid_x, centroid_y, 0, 0]
    const colorDefault = parseColor(frame.theme.colorDefault);
    const colorHover = parseColor(frame.theme.colorHover);
    const scratch = this.entityScratch!;
    scratch.fill(0); // default alpha 0 for inactive slots → degenerate-vertex collapse in vs
    for (const id of frame.softBodyIds) {
      const off = id * FLOATS_PER_ENTITY;
      if (frame.entities[off + 2] === 0) continue; // inactive
      const lt = Math.round(frame.entities[off + 5]);
      if (lt === 6) continue; // FreeDrop leaker
      const isHover = frame.entities[off + 4] === 1.0;
      const color = isHover ? colorHover : colorDefault;
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch.set(color, sOff);                                                  // r,g,b,a (premul)
      scratch[sOff + 4] = frame.entities[off] + frame.entities[off + 2] * 0.5;   // centroid.x = rect center
      scratch[sOff + 5] = frame.entities[off + 1] + frame.entities[off + 3] * 0.5;
      // sOff+6, sOff+7 are padding, left as 0.
    }
    for (const id of frame.dropletIds) {
      const off = id * FLOATS_PER_ENTITY;
      if (frame.entities[off + 2] === 0) continue;
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch.set(colorDefault, sOff);
      scratch[sOff + 4] = frame.entities[off];           // droplet: slot[0] IS center.x
      scratch[sOff + 5] = frame.entities[off + 1];       // slot[1] IS center.y
    }
    device.queue.writeBuffer(this.entityBuffer!, 0, scratch.buffer, scratch.byteOffset, scratch.byteLength);

    // ── Render pass ──
    const encoder = device.createCommandEncoder();
    // r2 (C3): create the color attachment view with the -srgb format so the
    // framebuffer write does sRGB gamma encoding. Matches Canvas2D output.
    const view = ctx.getCurrentTexture().createView({ format: this.sRgbFormat! });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(VERTICES_PER_BLOB, frame.capacity, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.particleBuffer?.destroy();
    this.entityBuffer?.destroy();
    this.projectionBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.ctx = null;
    this.device = null;
    this.pipeline = null;
    this.particleBuffer = null;
    this.entityBuffer = null;
    this.projectionBuffer = null;
    this.bindGroup = null;
    this.capacity = 0;
    this.entityScratch = null;
  }

  // (private updateProjectionMatrix + parseColor implementations elided)
}

const PREMUL_BLEND: GPUBlendComponent = {
  srcFactor: "one",
  dstFactor: "one-minus-src-alpha",
  operation: "add",
};
```

### WGSL shader (`blob.wgsl.ts`)

```ts
export const BLOB_WGSL = /* wgsl */ `
struct GlobalUniforms {
  projection: mat4x4<f32>,
};

struct EntityGPU {
  color: vec4<f32>,    // premultiplied rgba in [0, 1]
  centroid: vec2<f32>, // CSS-px coords (rect center per Decision §3)
  _pad: vec2<f32>,     // std430 stride padding to 32 bytes
};

@group(0) @binding(0) var<uniform> globals: GlobalUniforms;
@group(0) @binding(1) var<storage, read> particles: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> entities: array<EntityGPU>;

const PARTICLES_PER_BODY: u32 = 16u;
const VERTS_PER_TRI: u32 = 3u;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) @interpolate(flat) entityId: u32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VOut {
  let triangle = vid / VERTS_PER_TRI;
  let corner = vid % VERTS_PER_TRI;
  let particleBase = iid * PARTICLES_PER_BODY;
  let entity = entities[iid];

  var pos: vec2<f32>;
  if (corner == 0u) {
    pos = entity.centroid;  // r2 (C1): rect center, packed CPU-side
  } else if (corner == 1u) {
    pos = particles[particleBase + triangle];
  } else {
    pos = particles[particleBase + (triangle + 1u) % PARTICLES_PER_BODY];
  }

  // Inactive instance: collapse offscreen (vertices outside clip space).
  if (entity.color.a == 0.0) {
    pos = vec2<f32>(-99999.0, -99999.0);
  }

  return VOut(globals.projection * vec4<f32>(pos, 0.0, 1.0), iid);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return entities[in.entityId].color;
}
`;
```

The matching CPU pack is in `render()` (see above): `scratch[id*8 .. id*8+8] = [r·a, g·a, b·a, a, cx, cy, 0, 0]`. Std430 array stride for `EntityGPU` is 32 bytes — matched by `BYTES_PER_ENTITY_GPU = 32`. `vec4<f32>` is 16-byte aligned (offset 0); `vec2<f32>` after it lives at offset 16 (8-byte aligned, satisfied); the `_pad: vec2<f32>` at offset 24 brings the struct to a 32-byte stride that's also 16-byte aligned for array packing.

**(r2 amendment, forward-compat):** the 32-byte `EntityGPU` layout is W37-internal. W38 may repurpose the 8-byte `centroid + _pad` for AABB extents (`min: vec2<f32>` or similar) when SDF replaces the triangle-fan geometry. No external contract depends on the centroid being in this slot.

### Wire-up in `LiquidDOM.create()`

```ts
// Replace the W36 line:
const renderer: Renderer = new Canvas2DRenderer();
// with:
const renderer: Renderer = options?.renderer === 'webgpu'
  ? new WebGPURenderer()
  : new Canvas2DRenderer();
```

`await renderer.init(canvas)` propagates a `WebGPUUnavailableError` to the `LiquidDOM.create()` caller (rejected promise). Consumers catch it.

**(r2 amendment, m6 — W41 transition):** the binary `if/else` becomes a 3-arm `switch` in W41 when `'auto'` lands. W41's wire-up:
```ts
let renderer: Renderer;
if (options?.renderer === 'webgpu') {
  renderer = new WebGPURenderer();
} else if (options?.renderer === 'canvas2d') {
  renderer = new Canvas2DRenderer();
} else {  // 'auto' (W41 default)
  try {
    const wgpu = new WebGPURenderer();
    await wgpu.init(canvasOrFreshCanvas);  // Decision §17: must be fresh
    renderer = wgpu;
  } catch (e) {
    if (!(e instanceof WebGPUUnavailableError)) throw e;
    renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
  }
}
```
W37 doesn't ship this code; the snippet above is illustrative for the next ward planner.

## Tests

All in a new file `packages/core/ts/__tests__/webgpu-renderer.test.ts`. jsdom does NOT provide `navigator.gpu`; we mock it minimally for error-path tests and skip render-path tests (covered by manual smoke).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `webgpu_renderer_satisfies_renderer_contract` | Compile-time: `const _: Renderer = new WebGPURenderer();` Runtime: instance has `init`/`render`/`resize`/`destroy` as functions; `init()` returns a Promise; `WebGPUUnavailableError` extends `Error` and `name === "WebGPUUnavailableError"`. Locks the contract from Decision §14/§16. |
| 2 | `init_throws_WebGPUUnavailableError_when_navigator_gpu_missing` | With `Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true })`, call `renderer.init(canvas)`. Expect rejection with `WebGPUUnavailableError`, message contains `"navigator.gpu"`. Locks Decision §7 path A. |
| 3 | `init_throws_WebGPUUnavailableError_when_requestAdapter_returns_null` | Mock `navigator.gpu = { requestAdapter: async () => null, getPreferredCanvasFormat: () => "bgra8unorm" }`. Expect rejection with `WebGPUUnavailableError`, message contains `"adapter"`. Locks Decision §7 path B. |
| 4 | `destroy_is_idempotent_before_init_and_after_failed_init` | Construct `new WebGPURenderer()`. Call `destroy()` twice — no throw. Then `init()` with no `navigator.gpu` (rejects). Then `destroy()` twice more — still no throws. Locks Decision §16 (idempotent + safe-to-destroy-uninitialized, which W41's fallback path will exercise). |
| 5 | `init_throws_when_requestDevice_rejects_or_getContext_returns_null` | (r2 NEW, C6.) Two sub-cases in one test for the remaining error paths: **(a)** mock `navigator.gpu` with `requestDevice` throwing. Expect `WebGPUUnavailableError` with `cause` carrying the inner error (test-code review r2: propagation locked). Locks Decision §7 path C. **(b)** with `requestDevice` succeeding (minimal device mock), but `canvas.getContext("webgpu")` patched to return `null`. Expect `WebGPUUnavailableError` with message containing `"getContext"`. Locks Decision §7 path D. |
| 6 | `init_throws_WebGPUUnavailableError_when_pipeline_validation_fails` | (test-code review r2 P1.1.) Mock the full device chain through to a successful `requestDevice`, but `popErrorScope` returns a non-null `GPUError`. Expect rejection with `WebGPUUnavailableError` whose `cause` is the validation error. Locks Decision §7 path E — without this, gold could omit the `pushErrorScope("validation") + popErrorScope` wrapper and silently produce broken pipelines on shader typos. |
| 7 | `liquiddom_create_with_renderer_webgpu_rejects_when_unavailable` | (test-code review r2 P1.3.) End-to-end wire-up test: `LiquidDOM.create({ renderer: 'webgpu' })` with `navigator.gpu = undefined` rejects with `WebGPUUnavailableError`. Same call without `renderer` opt-in resolves cleanly (defaults to canvas2d, unaffected by missing navigator.gpu). Locks the 1-line `if/switch` in `index.ts` — without this, a gold that ships `WebGPURenderer` but forgets the dispatch wire-up would pass T1-T6 silently. |

After W37: 263 + 7 = **270 tests** (55 Rust + 215 TS). All 7 new tests TS-side.

**Note on test count change (5→7):** the spec's r2 Tests table planned 5 tests, but parallel reviews of the red-phase test code (after writing it) found two critical coverage gaps:
- Path E (shader/pipeline validation) was enumerated in Decision §7 but never tested. Without it, the `pushErrorScope` wrapper from r2 fix C4 is unverified.
- The 1-line `LiquidDOM.create()` switch from §Wire-up was unverified. A gold shipping `WebGPURenderer` without the switch would pass all 5 tests and silently default to Canvas2D.

T6 and T7 close both holes for ~25 LOC each. Test count bump documented in red phase rather than in r2's revision history.

## Risks & Mitigations

- **R1 (r2 amendment, m2): WebGPU types in `@webgpu/types`, pinned `^0.1.50`.** TypeScript needs `@webgpu/types` for `GPUDevice`, `GPUCanvasContext`, etc. As of mid-2026, TS 5.6+ ships built-in `GPU*` types in `lib.dom.d.ts`, which can conflict with `@webgpu/types`. Pinning `@webgpu/types@^0.1.50` resolves the duplicate-identifier issue by being the authoritative source (TS prefers the npm package over lib types when both are present). Add as `packages/core/package.json` devDependency (types erased at compile time; no runtime impact). Runtime uses `globalThis.navigator.gpu` directly.

- **R2: jsdom + WebGPU mocking.** Tests T2/T3/T5 mock `navigator.gpu` via `Object.defineProperty(navigator, "gpu", ...)`. Mitigated by: tests use `try/finally` to restore the original `navigator.gpu` (likely `undefined`) after each test. The mocks are minimal — just enough to drive the early-failure paths.

- **R3 (r2 amendment, m3): Centroid-vs-rect-center visual drift AND fan-overlap blending artifact.** Decision §3 uses rect center as centroid. During drag (W30) or shake (W31), the actual particle centroid drifts ~5-15% of element size from rect center → triangle fans look slightly skewed. **Additionally**, with `alpha < 1` (default `colorDefault` is 0.75 alpha) AND overlapping triangles during deformation, the premultiplied blend `src + (1-srcAlpha) × dst` composites darker bands where triangles overlap. Mitigated by: W37 is scaffolding for W38 SDF, which doesn't use triangulation at all — SDF discards fragments outside the metaball isosurface, no overlap. Acceptable for v1; documented as a known visual limitation in "Out of scope".

- **R4: WebGPU device-lost during long sessions.** Tabs backgrounded for hours, driver updates, or thermal throttling can trigger `device.lost`. Decision §9 handles this with a log + no-op, NOT a fallback rebuild. Mitigated by: W41 will add proper recovery. Until then, consumers can detect via the (future) `instance.activeRenderer` getter and restart.

- **R5: Premultiplied alpha mismatch with body bg.** WebGPU canvas in `alphaMode: "premultiplied"` blends correctly with the page background ONLY if the renderer outputs premultiplied colors (rgb × a, a). `parseColor()` returns `(r/255 × a, g/255 × a, b/255 × a, a)` for `rgba(r, g, b, a)`. Mitigated by: visual smoke test on Chrome — canvas should look IDENTICAL to Canvas2D path against the same body bg. If colors look washed-out or wrong, the parseColor branch is the place to look.

- **R6 / R11 merged (r2): Race between `init()` and `destroy()`.** See R11 below — same concern, kept R11 since it's the post-review canonical wording.

- **R7 / R10 merged (r2): WGSL shader compilation errors.** See R10 below — original R7 said "wrap in try/catch" which was insufficient (createShaderModule is sync but pipeline validation is async). R10 supersedes with `pushErrorScope("validation") + popErrorScope` per Decision §7 path E.

- **R8: `getPreferredCanvasFormat()` and storage-buffer feature support.** Some adapters report `bgra8unorm` only; others `rgba8unorm`. The shader's color blending math is format-agnostic. Storage buffers are required by the pipeline; the default adapter limits allow >= 128 MB storage buffer, well above our ~16 KB at capacity 64. Mitigated by: no adapter-specific feature requests in `requestDevice()`; we accept the default device capabilities. The corresponding `-srgb` view formats (`bgra8unorm-srgb`, `rgba8unorm-srgb`) are guaranteed to be valid view formats for these storage formats (WebGPU spec §Texture-format compatibility).

- **R9 (r2 NEW, C3): Color-space mismatch with Canvas2D.** Without the `-srgb` view format, fragment writes go to the framebuffer as linear values and are interpreted by the browser compositor as sRGB → blobs look ~2× darker than Canvas2D's sRGB-correct blending. Decision §6 fixes this by configuring the canvas context with `viewFormats: [sRgbFormat]` and creating the color-attachment view in `render()` with the `-srgb` format. The fragment shader writes linear values which are sRGB-encoded on framebuffer write. Visual smoke test on Chrome verifies parity with Canvas2D.

- **R10 (r2 NEW, C4): Shader compilation errors silently produce broken pipelines.** WebGPU's `createShaderModule` is synchronous and returns a module even with semantic errors; `createRenderPipeline` then fails async via the validation error queue. Without `pushErrorScope("validation") + popErrorScope`, a typo in `blob.wgsl.ts` results in a broken pipeline that silently no-ops at draw time. Decision §7 path E + the `init()` code in §Specification wraps shader+pipeline creation in an error scope and throws `WebGPUUnavailableError` on validation failure.

- **R11 (r2 NEW, C5): Race between `init()` resolution and `destroy()` call.** Consumer calls `LiquidDOM.create({ renderer: 'webgpu' })` → `init()` is async; if `instance.destroy()` is called before `init()` resolves (e.g., React strict mode double-mount), the device may be acquired AFTER destroy. Mitigated by: `LiquidDOM.create()` `await`s `renderer.init(canvas)` BEFORE returning the instance — consumer can't call `destroy()` until init resolves or rejects. Tested implicitly by Test #4 (destroy works in all states).

## Must NOT

- Add WebGPU types or runtime to Rust / Cargo.toml. Rule of Two preserved.
- Make `'webgpu'` the default `renderer` value. Default remains `'canvas2d'` until W41.
- Allocate GPU buffers per frame. All buffer allocations gated on capacity change (Decision §1 + §14).
- Throw or warn from `render()` for normal frames (mock-mode is silent; preserveBackgrounds warning fires ONCE).
- Add `options.renderer = 'auto'` — that's W41.
- Implement `themeCache` per-element colors. (Decision §11 — v1 limitation.)
- Implement the W53/W54 clip-pass. (Decision §10 — v1 limitation, blame & punt to W38.)
- Re-export `WebGPURenderer` from the package barrel. Internal-only. (`WebGPUUnavailableError` IS re-exported because consumers need to catch it.)
- Break ANY existing demo scene rendered with the default `Canvas2DRenderer`. (Verified by all 263 existing tests continuing to pass.)
- Block `LiquidDOM.create()` for non-WebGPU consumers. The class lazy-instantiates only when `renderer === 'webgpu'`.

## Must DO

- All 263 existing tests continue to pass.
- New tests #1-#4 pass.
- `npm run build` produces 0 TS errors. `cargo clippy` 0 warnings (no Rust change).
- `WebGPUUnavailableError` is re-exported from the package barrel and is `instanceof`-checkable by consumer code that catches `LiquidDOM.create()` rejections.
- Manual smoke test passes: in Chrome 113+, run a demo scene with `LiquidDOM.create({ renderer: 'webgpu' })`. Blobs render visually-similar to Canvas2D output. No console errors. `instance.destroy()` followed by re-create with the same option works without leaks (Chrome devtools' GPU memory tab shows no growth across 10 destroy/create cycles).

## Manual Smoke Test

### Setup
1. `npm run dev` (must be in Chrome 113+; Firefox/Safari will throw WebGPUUnavailableError — that's expected here).
2. Temporarily modify `demo/scenes/playground.ts` to add `renderer: 'webgpu'` to the `LiquidDOM.create()` options.
3. Open `http://localhost:3000/scenes/playground.html?preserveBackgrounds=false&capacity=64`.

### Steps
1. Expected: blobs visible, colors match colorDefault.
2. Hover over a blob: color flips to colorHover (single global hover color, themeCache NOT applied — Decision §11).
3. Drag a card (using `demo/scenes/dragable-cards.html` instead) — blob should follow, visibly skewed during high-velocity drag (Decision §3 acknowledged drift).
4. Force-fail: open Firefox at the same URL. Console: `WebGPUUnavailableError: navigator.gpu is undefined`. Page is otherwise broken (default render is Canvas2D, but the demo edit forced 'webgpu' — that's the test scenario).
5. Revert demo edit. Default (`'canvas2d'`) consumers see no change.

### Pass criteria
- [ ] Chrome 113+ shows blobs via WebGPU renderer.
- [ ] Hover color flips work globally.
- [ ] No console errors except the once-per-session `preserveBackgrounds` warning (when enabled).
- [ ] Firefox/Safari ≤17.4 sees `WebGPUUnavailableError` cleanly on init.
- [ ] `instance.destroy()` cleanup verified via Chrome devtools — no growing GPU memory across 10 cycles.

## Verification

`npm run verify`. All green. T1-T4 cover the error path + contract sanity; existing 263 tests cover Canvas2D regression. Manual smoke verifies the actual GPU pipeline.

- W38 (SDF blob fragment shader) can begin against the locked `Renderer` contract by replacing the body of `vs_main` + `fs_main` in `blob.wgsl.ts` — pipeline scaffolding stays.
- W41 (Canvas2D fallback) adds `renderer: 'auto'` and the try/catch wrapper that defaults to Canvas2D on `WebGPUUnavailableError`.
