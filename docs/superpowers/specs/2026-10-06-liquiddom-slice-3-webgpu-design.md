# liquiddom slice 3: WebGPU liquid (design)

Status: brainstormed with Dennis on 2026-10-06; written for review. The binding design stays
`docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` (the spec); this document details
slice 3 inside it and lists the spec amendments it needs. The canonical acceptance scene and
slice matrix are in `.wdd/NORTH-STAR.md`.

## 1. Goal and scope

The liquid looks like liquid in WebGPU: instanced particle splats, a thresholded silhouette with
an anti-aliased edge, blended colour where elements meet, and a crisp analytic contour at rest.
`auto` becomes WebGPU with a Canvas2D fallback, and a lost device rebuilds as Canvas2D.

Acceptance in WebGPU (brainstorm answer A, wider than the slice table's "1–3 in W"): every step
that is green in Canvas2D after slice 2 also passes under `renderer=webgpu`:

| Ward | Steps in WebGPU |
|---|---|
| W71 "Liquid in WebGPU" | 1 (at rest), 2 (pointer bulge), 3 (splash) |
| W72 "WebGPU by default, robust" | 4 (keyboard splash), 6 (shake), 8 (reduced motion) + `device.lost` |

**Out of slice 3** (unchanged from the spec slice table): F deformation gradient, `torn`, text
atlas, T1, the `liquid-text` toggle, the extended MutationObserver, forced-colors and colour
auto-refresh (slice 4); drag and merge (slice 5); scroll, resize, parking, gravity, adapters and
site (slice 6). There is no whole-picture check after slice 3; the next is after slice 4, the
first with both renderers. The DOM-text halo stays with slice 4 (D72-5).

## 2. Renderer architecture (W71)

Files under `packages/core/ts/src/renderers/`:

- `webgpu/webgpu-renderer.ts`: the `Renderer` (`init / render / resize / destroy`); owns device,
  targets, pipelines and the per-frame encoder. Replaces today's infra-only `webgpu-renderer.ts`.
- `webgpu/shaders.ts`: WGSL as TS string constants (no bundler plugin).
- `webgpu/gpu-buffers.ts`: pure packing from `RenderFrame` views into typed arrays for upload.
- `kernel-params.ts` (new, shared): `KERNEL_RADIUS_CAP_PX` 8, `KERNEL_RADIUS_PER_SPACING`,
  `DENSITY_THRESHOLD` 0.5 and the `(1 − r²/R²)²` normalisation. Canvas2D's `density-grid.ts`
  imports it, so both renderers put the 0.5 threshold on the rect edge the same way.

Per-frame data:

- **Particle buffer** (storage): only `x, y` from the dynamic view, written with
  `queue.writeBuffer` every frame (8000 particles ≈ 64 KB). The F fields are not uploaded until
  slice 4.
- **Home buffer** (storage): the element id per particle from the static view, uploaded only
  when `generation` changes. Particles with `home < 0` collapse to a degenerate quad.
- **Element buffer** (storage): per slot the rect, radius, premultiplied colour, splat mass
  (`areaPerParticle`), kernel radius and `restAlpha`, written every frame.

Three passes per frame:

1. **Splat**: one instanced quad per particle into `T0 rgba16float` (`Σw·rgb_premul`, `Σw`) with
   additive blending `{src: one, dst: one, op: add}`, at the T0 render scale (D71-4, default
   0.5× DPR).
2. **Composite**: a full-screen triangle into the swapchain (`alphaMode: 'premultiplied'`):
   threshold at 0.5 with an `fwidth` anti-aliased edge; colour `Σw·rgb / Σw`.
3. **Rest overlay**: one instanced quad per element with `restAlpha > 0`, an analytic
   rounded-rect SDF with analytic anti-aliasing, drawn over the composite at alpha `restAlpha`.

Cross-fade (D71-6, the WebGPU form of D70-4): particles splat at full weight while
`restAlpha < 1`, and the SDF overlay is drawn at `restAlpha` on top; at `restAlpha = 1` the
element's particles are skipped and only the SDF is drawn. No translucent dip, no fur at rest.

**T2 is deferred to slice 4** (D71-3). With the per-element cross-fade rule, `restAlpha` is a
per-element value read from the element buffer; a per-pixel `Σw·restAlpha` target buys nothing
until the text composite needs it.

## 3. Selection, fallback and `device.lost` (W72)

W71 uses WebGPU only for an explicit `renderer: 'webgpu'` and drops `WEBGPU_INFRA_ONLY_WARNING`;
`auto` stays Canvas2D. W72 switches `auto`, which is the default option value.

- **`auto`** (D72-1): try WebGPU. `WebGPUUnavailableError` or `adapter.info.isFallbackAdapter`
  → Canvas2D, one `console.info` unless `silentFallback`, and the canvas is **remounted** (a
  canvas that has handed out a `webgpu` context cannot give a `2d` context). Any other init error
  (shader compile, pipeline validation, caught with `pushErrorScope`) rejects `create()`.
- **Explicit `'webgpu'`** (D72-2): unavailable → reject with `WebGPUUnavailableError` (as today).
  A fallback adapter (SwiftShader) is **accepted**, so CI can test the WebGPU path.
- **`device.lost` at runtime** (D72-3): the runtime's renderer slot becomes mutable; destroy the
  WebGPU renderer, remount the canvas, init Canvas2D, continue on the next frame with the same
  particle state, one `console.warn`. `activeRenderer` then reports `'canvas2d'`. A loss with
  `reason: 'destroyed'` (our own `destroy()`) never rebuilds. A loss during init counts as
  `WebGPUUnavailableError`. There is no `liquid-text` to remove until slice 4.
- **Overdraw** (D72-4): the splat pass counts fragments per frame (instances × quad area at the
  T0 scale), exposed on `window.__liquidTest` and logged by the perf spec. Logging only, no gate.

## 4. Verification

- **W71 task 0, SwiftShader spike** (D71-1; time-box ½ day; throwaway code): can WebGPU run on
  SwiftShader in the pinned Linux image without `device lost`, 20 consecutive runs of the smoke
  plus a minimal splat page? Try the Chromium flags (`--enable-unsafe-swiftshader`,
  `--use-angle=swiftshader`, Vulkan variants), `--disable-dev-shm-usage` / a larger shm, and one
  worker. Answer recorded in the ward file.
  - **Yes**: the `webgpu` Playwright project runs the acceptance spec with Linux baselines
    (`maxDiffPixelRatio 0.01`); still soft until 10 green runs in a row (spec §6), then blocking.
  - **No** (fallback B): WebGPU acceptance runs locally on macOS (Metal) only; CI keeps the soft
    smoke; the limitation goes into CONTEXT.
- **Unit tests (jsdom)**: buffer packing, `kernel-params` parity between both renderers, and the
  selection logic against a small fake `navigator.gpu` (`_fake-gpu.ts`, next to
  `_fake-canvas.ts`): unavailable, fallback adapter, init bug, `device.lost` with `'destroyed'`
  and `'unknown'`, runtime rebuild and canvas remount.
- **Browser tests**: `scene-params` accepts `?renderer=webgpu` and `test-hooks` types
  `'canvas2d' | 'webgpu'`; the acceptance spec is parametrised by renderer and reuses the
  canvas2d pixel asserts (no hole, bulge ≥ 5 px, `restAlpha = 1` within 3 s); a shader test
  builds every pipeline under `pushErrorScope('validation')` and expects no error; the
  `device.lost` test destroys the device through the test hook and checks Canvas2D continues,
  `activeRenderer === 'canvas2d'` and no `console.error`.
- **Gold** (both wards): screenshots from a real GPU (Dennis' Mac, Metal), inspected with vision,
  Canvas2D and WebGPU side by side for the same step and seed. W72 gold also records the scene
  in both renderers as GIFs.
- **Perf**: no GPU timing on SwiftShader (spec §6). Locally on Metal, RAF p95 and overdraw for
  webgpu are logged, not gated. The Canvas2D budget is unchanged.

## 5. Decisions for the direction gate

✔ = direction already chosen by Dennis in the brainstorm on 2026-10-06; it still passes the
gate as a formal decision.

| ID | Decision | Recommendation |
|---|---|---|
| D71-1 | CI verification route | ✔ SwiftShader spike (½ day), fallback B: local Metal + soft CI |
| D71-2 | Steps in WebGPU | ✔ 1–3 in W71; 4, 6, 8 + `device.lost` in W72 |
| D71-3 | Pass architecture | ✔ splat, composite, SDF rest overlay; T2 deferred to slice 4 |
| D71-4 | T0 render scale | configurable, default 0.5×; at W71 gold Dennis compares 0.5× and 0.75× side by side |
| D71-5 | Kernel radius per spacing | 2.3, shared by both renderers via `kernel-params.ts`; if vision still shows bead chains, try 2.8 in both |
| D71-6 | Cross-fade | the D70-4 rule: full density while `restAlpha < 1`, SDF at `restAlpha` on top |
| D72-1 | `auto` | probes WebGPU and becomes the effective default; fallback on unavailable or fallback adapter |
| D72-2 | Explicit `'webgpu'` | accepts a fallback adapter |
| D72-3 | `device.lost` | rebuild as Canvas2D in place, one `console.warn`; ignore `'destroyed'` |
| D72-4 | Overdraw | logged via the test hook and the perf spec, no gate |
| D72-5 | DOM-text halo | stays in slice 4; under WebGPU the text sits on the bare page while its liquid is away, as in Canvas2D today |

## 6. Spec amendments (applied with this document)

- §3 "WebGPU: two passes": T2 deferred to slice 4; the slice-3 pass list is splat, composite,
  rest overlay.
- §3 "Crisp at rest": the SDF contour is an overlay drawn at `restAlpha`, not density added into
  T0/T2.
- §3 "Infrastructure and errors": explicit `'webgpu'` accepts a fallback adapter; only `auto`
  treats it as unavailable. A loss with `reason: 'destroyed'` does not rebuild.
- §6 "Slices": slice 3 row reads "Splat/composite (T0), rest SDF overlay, blended colour,
  `device.lost`, overdraw logging".
