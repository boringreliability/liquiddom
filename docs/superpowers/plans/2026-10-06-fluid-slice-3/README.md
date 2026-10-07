# liquiddom fluid engine, slice 3 (WebGPU liquid): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every ward also follows WDD / GS-TDD:** direction gate (all `Decision:` lines approved) → failing tests → `wdd ward status NN red` → STOP for Dennis' "godkendt" → implement → green → ward review → `wdd ward status NN gold` → STOP. AI never decides on its own that a ward is complete; after Dennis approves gold, AI may run `wdd complete` (or apply the transition by hand when the harness blocks it).

**Goal:** The liquid looks like liquid in WebGPU (instanced splats, thresholded silhouette, blended colour, crisp analytic contour at rest), `auto` becomes WebGPU with a Canvas2D fallback, and a lost device rebuilds as Canvas2D. Acceptance steps 1, 2, 3, 4, 6 and 8 pass under `renderer=webgpu`.

**Architecture:** Rust is untouched (DOM- and colour-blind, Rule of Two). TypeScript gets a real `WebGPURenderer` with three passes per frame: splat into `T0 rgba16float` + `T0a r16float` at a reduced render scale, composite into the swapchain (threshold 0.5, `fwidth` edge, `Σw·rgb/Σw`, alpha `Σw·a/Σw`), and a rest SDF overlay drawn at `restAlpha`. Particle `x, y` are uploaded every frame, `home` only on a generation change, a small element buffer every frame. W72 makes the runtime's renderer slot mutable so `auto` can fall back and `device.lost` can rebuild as Canvas2D on a remounted canvas.

**Tech stack:** TypeScript (strict), WebGPU + WGSL (as TS string constants), Vitest 4 (jsdom, with a fake `navigator.gpu`), Playwright 1.63.0 (pinned image `mcr.microsoft.com/playwright:v1.63.0-noble`, SwiftShader in CI; Metal locally).

**Spec:** the binding [`docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`](../../specs/2026-10-02-liquiddom-fluid-design.md) (amended for slice 3 in `9cc85fd`) and the slice design [`docs/superpowers/specs/2026-10-06-liquiddom-slice-3-webgpu-design.md`](../../specs/2026-10-06-liquiddom-slice-3-webgpu-design.md). Executors read both, this index and the ward file they are working on. The acceptance scene and matrix are in `.wdd/NORTH-STAR.md`.

## Wards

| Ward | Slice | File | Content | Size |
|---|---|---|---|---|
| W71 | 3 | [W71.md](W71.md) | **Liquid in WebGPU:** SwiftShader CI spike (task 0), shared kernel params, GPU buffers, splat/composite/rest passes, `?renderer=webgpu` and `__liquidTest.pixels()` in the scene, the local `webgpu-hw` project, acceptance steps 1–3 in WebGPU | see file |
| W72 | 3 | [W72.md](W72.md) | **WebGPU by default, robust:** `auto` probe and fallback (`isFallbackAdapter`, remount, `silentFallback`), explicit `'webgpu'` accepts fallback adapters, `device.lost` → Canvas2D rebuild, overdraw logging, steps 4/6/8 in WebGPU, the local `record-webgpu` project, GIFs in both renderers | see file |

Order: W71 → W72. Each ward leaves `npm run verify` and `npm run e2e:canvas2d` green.

**Human prerequisites:**
- Before W71 red: direction gate for D71-1 … D71-6 (ward-071.md).
- Before W72 red: direction gate for D72-1 … D72-5 (ward-072.md).
- W71 gold: Dennis chooses the T0 scale (0.5× vs 0.75×) from side-by-side crops (D71-4).
- Linux baselines for the `webgpu` project are committed only after Dennis' vision approval (D65-7), and only if the W71.0 spike answered "yes". They come from the CI `e2e-update-baselines` job (local Docker runs amd64 under emulation, where SwiftShader fails; CONTEXT), so each ward asks Dennis before pushing the branch to dispatch it.

## Global Constraints

Every task implicitly includes these.

**Unchanged contracts (do not touch)**
- No Rust changes in slice 3 (`src/fluid/` and the FFI stay as they are). No JSON over FFI. Fixed pools.
- `RenderFrame` and `Renderer` (`renderers/frame.ts`) keep their shape. Renderers read the views; rendering never touches the DOM (the canvas element itself is owned by the runtime).
- Dynamic view is SoA: field `f` of particle `i` is `dynamicView[f * particleCapacity + i]`, fields `x=0, y=1, f00=2, f01=3, f10=4, f11=5, flags=6`. Static view SoA fields `home=0, rest_u=1, rest_v=2`; `home < 0` means unassigned. Particles in `[0, activeParticles)` only.
- State view: 4 floats per element, `restAlpha` at offset 2. `paints[id] === undefined` → the slot is not drawn.
- Only `ts/src/wasm-loader.ts` imports `pkg/`. The canvas stays below the DOM (D7).

**Rendering values (spec §3, slice-3 design §2)**
- Kernel: `R = min(KERNEL_RADIUS_CAP_PX, KERNEL_RADIUS_PER_SPACING · spacingPx)` with `KERNEL_RADIUS_CAP_PX = 8`, `KERNEL_RADIUS_PER_SPACING = 2.3` (D71-5); weight `w(r) = mass · (1 − r²/R²)² / (π·R²/3)` for `r < R`, `mass = areaPerParticle`, so a filled interior reads density 1 and the threshold `DENSITY_THRESHOLD = 0.5` lands on the rect edge. `EDGE_SOFTNESS = 0.1`.
- Splat targets (D71-3, amended by the W71 plan, Corrections 1): `T0 rgba16float` holds straight `Σw·rgb` (rgb) and `Σw` (a); `T0a r16float` holds `Σw·a` (the blended alpha needs its own channel, otherwise a translucent element comes out opaque). Both use the additive blend `{srcFactor: 'one', dstFactor: 'one', operation: 'add'}` for colour and alpha. 8 B + 2 B = 10 B per sample. **No 32-bit float targets. No T1, no T2 in slice 3.**
- T0/T0a render scale default **0.5 × DPR** (`T0_SCALE_DEFAULT = 0.5`), configurable for the D71-4 comparison (`@internal webgpuT0Scale`, demo `?t0=0.5|0.75`).
- Composite: context `alphaMode: 'premultiplied'`, format `navigator.gpu.getPreferredCanvasFormat()`; coverage = `smoothstep(0.5 − soft, 0.5 + soft, Σw)` with `soft = max(EDGE_SOFTNESS, 0.75·fwidth(Σw))`; colour = `T0.rgb / max(Σw, ε)`; alpha = coverage × `T0a / max(Σw, ε)`; the output is premultiplied once, here.
- Cross-fade (D71-6 = D70-4): particles of an element splat at full weight while its `restAlpha < 1` and are skipped at `restAlpha = 1`; the rest pass draws the element's rounded-rect SDF at alpha `restAlpha` over the composite.

**Selection and errors (spec §3 as amended)**
- `renderer: 'auto' | 'webgpu' | 'canvas2d'`, option default `'auto'` (`options.ts`).
- W71: `'auto'` stays Canvas2D without probing; `'webgpu'` draws the liquid; `WEBGPU_INFRA_ONLY_WARNING` is removed.
- W72: `'auto'` → WebGPU, falling back to Canvas2D on `WebGPUUnavailableError` or `adapter.info.isFallbackAdapter` (checked right after `requestAdapter`, via `acceptFallbackAdapter: false`), one `console.info` unless `silentFallback`, canvas remounted. Explicit `'webgpu'` accepts a fallback adapter and rejects `create()` with `WebGPUUnavailableError` when unavailable. Any other init error (shader/pipeline validation via `pushErrorScope`) rejects `create()`.
- W72: `device.lost` with `reason !== 'destroyed'` after init → rebuild as Canvas2D on a remounted canvas, one `console.warn` (from the runtime; the renderer itself never warns from W72 on), `activeRenderer === 'canvas2d'`. `'destroyed'` never rebuilds. A loss during init counts as `WebGPUUnavailableError` (W71's `init` awaits `popErrorScope()` after `requestDevice`, which is the window). The only `console.error` paths are a runtime GPU validation error (W71, a bug) and a failed Canvas2D rebuild (W72); a loss never produces one, because a lost device generates no validation errors and the renderer stops drawing (`lost`) before the runtime reacts.

**Verification**
- Every e2e spec imports `test` from `e2e/fixtures.ts` (fails on `console.error`, `pageerror`, panics). Visual specs skip on macOS; canvas2d Linux baselines via `npm run e2e:update`, webgpu Linux baselines via the CI `e2e-update-baselines` job (spike "yes" only).
- The `webgpu` Playwright project (SwiftShader, CI soft) forces `renderer=webgpu`; no GPU timing on SwiftShader; overdraw is logged, not gated.
- **Local hardware WebGPU (one mechanism):** W71 adds the local-only project `webgpu-hw` (channel `chromium`, `WEBGPU_HW_LAUNCH_ARGS = ["--enable-unsafe-webgpu"]`, no SwiftShader flag; `npm run e2e:webgpu-hw`), routed to the same specs as `webgpu`. W72 extends its routing (robust spec, webgpu perf) and adds `record-webgpu` with the same launch args. CI never names either project.
- **Spike routing (one constant):** `SWIFTSHADER_RUNS_LIQUID` in `e2e/projects.ts` is written once in W71.6 from the W71.0 answer; W71's `e2e-harness` test `given_the_webgpu_hw_project_…_W71` ties it to the CI webgpu step, and W72 routes `webgpu-robust.spec.ts` to `webgpu` only when it is `true`.
- **Pixel readback (one mechanism):** a WebGPU canvas is readable only in the task that rendered it. W71's acceptance scene snapshots the liquid canvas at the end of every `__liquidTest.advance()`; every e2e pixel read (W71 and W72) goes through `__liquidTest.pixels()`. W72's `e2e/frame-readback.ts` is a thin wrapper over it (no own `drawImage`).
- **Gold artefacts:** raw gold screenshots go to `test-results/vision-w71/` and `test-results/whole-picture/shots/` and are copied to the scratchpad, never committed. Committed gold GIFs live in `docs/superpowers/whole-picture/` next to the slice-2 GIFs (W70 precedent `slice-2-addendum-canvas2d.gif`): W72 writes `slice-3-w72-canvas2d.gif` and `slice-3-w72-webgpu.gif`. Slice 3 has no whole-picture report.
- Gold: screenshots from a real GPU (Metal, `webgpu-hw`) inspected with vision, Canvas2D vs WebGPU side by side, same seed and step.
- **Counts:** vitest `424 passed | 4 skipped` at `9cc85fd` → W71 `460 | 4` (50 files) → W72 `501 | 4` (54 files); cargo `151 passed, 1 ignored` throughout. Playwright `--list`: `canvas2d` 35 → 36 → 36; `webgpu` 3 → 23 → 31 [yes] / 23 [no]; `webgpu-hw` – → 23 → 33; `perf` 1 → 1 → 2; `record` 1 → 1 → 2; `record-webgpu` – → – → 2; `dist` 1.
- Test files are not type-checked; helpers start with `_`.

**Process**
- Commit by path (`git add <paths>`), never `git add -A`. Trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JWKWkrzUtppUzFBpDS954E`.
- Never push to master or merge; ask before pushing a branch.
- Ward status only via `wdd ward status NN <state>`; ward files are hand-created flat files (D63-1).
- Changesets: one `.changeset/*.md` per ward for `liquiddom` (patch, pre mode alpha).

## Shared interfaces (W71 produces, W72 consumes)

These names are binding across both ward files. They record the final two-step evolution as the ward plans write it (verified 2026-10-07, `_verification.md`): first the W71 state, then what W72 adds or changes. W72 consumes only W71's names or names an earlier W72 task adds.

```ts
// ---- packages/core/ts/src/renderers/kernel-params.ts (W71) ----
export const KERNEL_RADIUS_CAP_PX = 8;
export const KERNEL_RADIUS_PER_SPACING = 2.3;
export const DENSITY_THRESHOLD = 0.5;
export const EDGE_SOFTNESS = 0.1;
export function kernelRadiusPx(spacingPx: number): number;          // min(cap, perSpacing·spacing); non-finite/≤0 → cap
export function kernelWeight(r: number, radiusPx: number, mass: number): number; // 0 for r ≥ R
// density-grid.ts re-exports the four constants for existing importers.

// ---- packages/core/ts/src/renderers/webgpu/errors.ts (W71; moved from renderers/webgpu-renderer.ts, re-exported by index.ts) ----
export class WebGPUUnavailableError extends Error {}

// ---- packages/core/ts/src/renderers/webgpu/gpu-buffers.ts (W71, pure) ----
export const ELEMENT_GPU_FLOATS: number;   // 16 floats = 64 B per slot
export const EG: { /* field offsets of the element record */ };
export const OFFSCREEN_PX: number;         // non-finite positions go here
export function packParticles(frame: RenderFrame, out: Float32Array): number;  // x,y interleaved; returns instance count
export function packHomes(frame: RenderFrame, out: Int32Array): void;          // home id per particle, −1 when none, unpainted or inactive
export function packElements(frame: RenderFrame, out: Float32Array): number;   // returns 1 + the last drawable slot

// ---- packages/core/ts/src/renderers/webgpu/shaders.ts (W71) ----
export const SPLAT_WGSL: string;      // two targets: T0 (Σw·rgb, Σw) and T0a (Σw·a)
export const COMPOSITE_WGSL: string;
export const REST_WGSL: string;

// ---- packages/core/ts/src/renderers/webgpu/webgpu-renderer.ts (W71; replaces renderers/webgpu-renderer.ts) ----
export const T0_SCALE_DEFAULT = 0.5;
export const T0_FORMAT = "rgba16float";
export const T0_ALPHA_FORMAT = "r16float";
export function buildPipelines(device: GPUDevice, canvasFormat: GPUTextureFormat): LiquidPipelines; // no error scope of its own
export interface WebGPURendererOptions {
  readonly t0Scale?: number;                 // W71 (D71-4), validated in (0, 1], RangeError otherwise
  readonly acceptFallbackAdapter?: boolean;  // W72 (D72-1/2); default true (explicit 'webgpu' behaviour)
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void; // W72 (D72-3); never for 'destroyed', never after destroy()
}
export class WebGPURenderer implements Renderer {
  constructor(opts?: WebGPURendererOptions);
  readonly t0Scale: number;                  // W71
  get isFallbackAdapter(): boolean;          // W71 getter (set after requestAdapter); W72 reads it and gates on it
  get lastFragmentEstimate(): number;        // W71 getter, always 0; W72 (D72-4) fills it every frame
  loseDeviceForTest(): void;                 // W72 @internal (D72-3)
}
// W71: `init` awaits device.popErrorScope() after requestDevice (the loss-during-init window W72 uses);
//      a pipeline validation error rejects with a plain Error; the first uncaptured GPU error logs one console.error.
// W71: a device.lost (not 'destroyed') logs one console.warn and stops drawing; W72 replaces that with onDeviceLost (no warn).
export const SIMULATED_LOSS_MESSAGE: string;                   // W72
export function adapterIsFallback(adapter: GPUAdapter): boolean; // W71 module-private; W72 exports it (same body)

// ---- packages/core/ts/src/renderers/webgpu/overdraw.ts (W72) ----
export function estimateSplatFragments(frame: RenderFrame, t0Scale: number): number;

// ---- packages/core/ts/src/renderers/select.ts ----
// W71:
export interface SelectRendererOptions { readonly t0Scale?: number }
export interface SelectedRenderer { readonly renderer: Renderer; readonly active: ActiveRenderer }
export function selectRenderer(choice: RendererChoice, canvas: HTMLCanvasElement, opts?: SelectRendererOptions /* = {} */)
  : Promise<SelectedRenderer>;      // 'auto' = Canvas2D without probing
// W72 (replaces the file; same names, wider shapes):
export interface SelectRendererOptions {
  readonly silentFallback: boolean;
  readonly remountCanvas: () => HTMLCanvasElement; // replaces the runtime's canvas in place, returns the new one
  readonly onDeviceLost: (info: GPUDeviceLostInfo) => void;
  readonly t0Scale?: number;
}
export interface SelectedRenderer { readonly renderer: Renderer; readonly active: ActiveRenderer; readonly canvas: HTMLCanvasElement }
export function selectRenderer(choice: RendererChoice, canvas: HTMLCanvasElement, opts: SelectRendererOptions): Promise<SelectedRenderer>;
export const FALLBACK_INFO_PREFIX = "[liquiddom] WebGPU is not available";
export function fallbackInfo(reason: string): string;
export function initCanvas2D(canvas: HTMLCanvasElement): Promise<FluidCanvas2DRenderer>;

// ---- packages/core/ts/src/stylesheet.ts (W72) ----
export function remountLiquidCanvas(old: HTMLCanvasElement, container?: HTMLElement): HTMLCanvasElement;

// ---- packages/core/ts/src/options.ts / runtime.ts / index.ts ----
// W71: LiquidOptions.webgpuT0Scale (@internal, in OPTION_KEYS), FluidRuntimeOptions.webgpuT0Scale.
// W72: FluidRuntimeOptions.silentFallback; FluidRuntime.simulateDeviceLoss(): Promise<boolean> (@internal),
//      FluidRuntime.fragmentEstimate (@internal); `canvas` and `activeRenderer` become live getters;
//      export const DEVICE_LOST_WARNING = "[liquiddom] WebGPU device lost"; internal `LossRelay`.

// ---- Test helpers: packages/core/ts/__tests__/_fake-gpu.ts ----
// W71 creates it:
export function installFakeGpu(opts?: {
  adapter?: "ok" | "null" | "throws"; isFallbackAdapter?: boolean; device?: "ok" | "rejects";
  context?: "ok" | "null"; configureError?: Error; validationError?: string;
}): FakeGpu;  // installs navigator.gpu, the GPU*Usage/GPUShaderStage globals and getContext("webgpu"); calls.errors
// W72 extends the same function (no second fake): option holdInit, calls.getContextWebgpu, FakeGpu.devices
// (per-device handles: index, destroyed, submits, lose(reason?, message?)), FakeGpu.releaseInit(), and the HTML rule
// "a canvas that handed out a webgpu context returns null for 2d". installFakeGpuLifecycle(opts) is a thin view over it.

// ---- demo ----
// demo/scenes/scene-params.ts: ?renderer=canvas2d|webgpu (W71; default canvas2d), ?t0=0.5|0.75 (W71, needs webgpu);
//                              W72 adds ?renderer=auto (the default stays canvas2d).
// demo/test-hooks.ts: SceneParams.renderer "canvas2d" | "webgpu" and t0Scale? (W71) → + "auto" (W72);
//   LiquidTestHook.pixels(): ImageData (W71); WebGpuLiquidHook, PipelineCheckResult (W71);
//   LiquidTestHook.loseDevice(): Promise<void> and readonly overdraw: number (W72).

// ---- e2e ----
// e2e/scene.ts: projectRenderer() (W71).
// e2e/projects.ts (W71): SceneRenderer, PROJECT_RENDERER, rendererForProject, WEBGPU_LIQUID_SPEC, WEBGPU_PROJECT_SPEC,
//   WEBGPU_HW_LAUNCH_ARGS, SWIFTSHADER_RUNS_LIQUID, project "webgpu-hw"; package.json "e2e:webgpu-hw".
// e2e/projects.ts (W72): WEBGPU_ROBUST_SPEC, anyOf, project "record-webgpu" (+ PROJECT_RENDERER entry), ProjectUse.headless;
//   package.json "record:w72".
// e2e/frame-readback.ts (W72): advanceFrames, advanceAndHash, advanceAndCountOpaque, advanceAndCountOutside —
//   thin wrappers over __liquidTest.advance() + __liquidTest.pixels().
```

## Review Focus

Failure modes the spec implies but no acceptance step exercises; each is pinned by a test in the owning ward.

1. **Resize and DPR change under WebGPU** (W71): T0 is reallocated to the new size; a 0×0 or sub-pixel canvas never creates a zero-size texture (clamped to ≥ 1×1) and raises no validation error.
2. **Empty scene** (W71): `activeParticles = 0` or no observed element renders a cleared canvas without zero-size buffers or validation errors (buffers have a minimum size).
3. **Unobserve between generations** (W71): a particle whose `home` points at a slot with `paints[id] === undefined` or `w == 0` is not drawn (packHomes writes −1), and the rest overlay skips that slot.
4. **Transparent or translucent element colour** (W71): `Σw = 0` never divides by zero; a translucent background composites premultiplied (no dark fringe), matching Canvas2D within the visual tolerance.
5. **Lifecycle races** (W72): `destroy()` while WebGPU init is pending leaves no canvas, no device and no warning; a `device.lost` that resolves after `destroy()` does not rebuild; two instances each own a device and losing one does not affect the other.

## Cross-ward verification

The two ward files are written in parallel against this index, then a cross-checker verifies that every name W72 consumes is produced by W71 with the same signature, that test counts and file paths agree, and that every D-item maps to at least one task. Findings and resolutions are in [`_verification.md`](_verification.md) (2026-10-07).
