# liquiddom fluid engine, slice 4 (liquid text): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every ward also follows WDD / GS-TDD:** direction gate (all `Decision:` lines approved) → failing tests → `wdd ward status NN red` → STOP for Dennis' "godkendt" → implement → green → ward review → `wdd ward status NN gold` → STOP. AI never decides on its own that a ward is complete; after Dennis approves gold, AI may run `wdd complete` (or apply the approved manual transition when the harness blocks it).

**Goal:** In WebGPU the text of a moving element stretches and tears with its own liquid; at rest the real DOM text is shown pixel-exact; the text stays true to DOM changes, fonts, colours, forced colours and print; Canvas2D keeps DOM text with a contrast halo while moving. Slice 4 ends with the first whole-picture check in both renderers.

**Architecture:** Rust updates a render-only deformation gradient F per particle (clamped, with a sticky `torn` flag) and adds `‖F − I‖` to the rest criterion. TypeScript builds a text atlas from the DOM, uploads F/flags/rest UVs, and draws a separate 1× DPR text pass (T1 + T1w) composited after the rest SDF. The runtime toggles `liquid-text` (DOM text transparent) only while the atlas text stands in for it, with a fail-safe; W75 keeps atlas and colours in sync with the DOM.

**Tech stack:** Rust (edition 2024, wasm-bindgen), TypeScript (strict), WebGPU/WGSL, Vitest 4 (jsdom, fake GPU and fake canvas), Playwright 1.63.0 (canvas2d blocking in CI; WebGPU local on Metal, W71.0 fallback B).

**Spec:** the binding [`2026-10-02-liquiddom-fluid-design.md`](../../specs/2026-10-02-liquiddom-fluid-design.md) (amended for slice 4 in `58c1512`) and the slice design [`2026-10-10-liquiddom-slice-4-liquid-text-design.md`](../../specs/2026-10-10-liquiddom-slice-4-liquid-text-design.md). Executors read both, this index and their ward file. Spike evidence (reference only, D2): session scratchpad `w74-spike/` (`spike.patch` must never be copied).

## Wards

| Ward | Slice | File | Content |
|---|---|---|---|
| W74 | 4 | [W74.md](W74.md) | **Text that flows:** F in Rust (clamp, torn hysteresis, rest needs F ≈ I), text atlas, particle/rest-UV upload, T1/T1w text pass, text composite after the SDF, `liquid-text` toggle with fail-safe, `device.lost` removes the class, the splash ghost pill |
| W75 | 4 | [W75.md](W75.md) | **Text that stays true:** per-element MutationObserver, colour auto-refresh (+ `transitionend`), atlas re-render on text/fonts/DPR, forced-colors/print with `liquid-text` active, `refresh()` and a11y under WebGPU, Canvas2D `liquid-halo` |
| W76 | 4 | [W76.md](W76.md) | **Whole picture after slice 4:** recording in both renderers, vision, per-step status against S4, carried table, perf, recommendation (W69 template) |

Order: W74 → W75 → W76. Test totals at each ward's end: W74 cargo `168 passed; 2 ignored`, vitest `564 passed | 4 skipped (568)`; W75 vitest `592 | 4 (596)`; W76 vitest `594 | 4 (598)` (cargo unchanged after W74). Each ward leaves `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green.

**Human prerequisites:** direction gate per ward before red (D74-*, D75-*, D76-*); Dennis approves red, gold, and any Linux baseline (D65-7); W76's recommendation decides what comes before slice 5.

## Global Constraints

**Unchanged contracts**
- FFI layout and strides unchanged (`ELEMENT_STRIDE 10`, `DYNAMIC_FIELDS 7`, `STATIC_FIELDS 3`, `STATE_STRIDE 4`); the dynamic view already carries `f00, f01, f10, f11, flags`; `FLAG_TORN = 1`. The state view's `reserved` slot (index 3) may carry `max‖F − I‖` per element (W74; documented in layout.rs and fluid-layout.ts).
- No JSON over FFI, fixed pools, no hot-path allocation, no panics on JS input (`clippy::indexing_slicing` denied), F never enters the stress.
- Rendering never touches the DOM; the runtime owns every class write. The canvas stays below the DOM (D7). Only `wasm-loader.ts` imports `pkg/`.
- Canvas2D never sets `liquid-text`; the lace guard (D73-3) and existing baselines stay green.

**Values (design §3/§4, spec as amended 2026-10-10)**
- F: `F ← (I + dt·C)·F`, slip `F ← F + dt·SLIP_RATE·s²·(I − F)`, σ clamp `[0.2, 5]`, det < 0 flipped; `torn` set at the clamp, cleared at σ ∈ `[0.67, 1.5]`; rest also needs `max‖F − I‖ < 0.05` (Frobenius norm); F every substep (D74-1, fallback every 2nd only if perf breaks).
- Text pass: T1 `rgba16float` (Σw·text_rgba_premul) + T1w `r16float` (Σw) at 1× backing in their own pass; the liquid's kernel (`kernel-params.ts`); `‖F⁻¹‖` clamp 2; coverage 0 when torn, `|det F| < 1e-4`, or `uv ∉ [0,1]²`; screen order liquid composite → rest SDF → text composite. No T2.
- Atlas: `Range.getClientRects()` line boxes, computed style, word-wise `fillText` on an `OffscreenCanvas` at DPR, one shelf-packed atlas, gutter 10 px, text nodes only, no re-wrap.
- Toggle: `liquid-text` only when renderer = WebGPU ∧ atlas entry ready (`textReady`) ∧ `restAlpha < 1` ∧ not reduced motion; refcounted across instances; removed on Canvas2D, RM, atlas failure, `device.lost`, a failed frame, a failed Canvas2D rebuild, `unobserve`, `destroy`. The CSS hides glyphs with `-webkit-text-fill-color` (never `color`), so colour snapshots and atlas builds read the author colour while it is on.
- Atlas ownership: the runtime builds and owns the `TextAtlas` (the renderer only uploads the page from `RenderFrame.textAtlas`); W75 re-renders through `textAtlas.invalidate(id)`, rebuilt before `render()` in the same frame.
- Halo (W75): `liquid-halo` class, Canvas2D only, while `restAlpha < 1`; `text-shadow` in the element's background colour via one rule per element (`data-liquid-id`) in the refcounted sheet; no inline style (D66-3); same refcount helper and fail-safe paths as `liquid-text`.
- Linux baselines: W74.8 (D74-7 may move step 3 f12 / step 6 f20) is approved and committed before W75.5 regenerates the halo baselines on top of it; each STOPs for Dennis (D65-7).

**Verification**
- Every e2e spec imports `test` from `e2e/fixtures.ts`; WebGPU specs run locally in `webgpu-hw` (Metal); pixel reads via `__liquidTest.pixels()`; compare renderers only at the same manual-clock frame.
- Gold: Metal stills at the same frames, inspected with vision; visual changes to Canvas2D need new Linux baselines approved by Dennis.

**Process**
- Commit by path, never `git add -A`. Trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JWKWkrzUtppUzFBpDS954E`.
- No pushes or merges without asking. Ward status via `wdd ward status`; ward files hand-created flat (D63-1). One changeset per ward (patch, pre mode alpha) unless Dennis rules otherwise.

## Shared interfaces (binding; W74 produces, W75/W76 consume)

Final names after the cross-ward verification (2026-10-10, `_verification.md`). W74's names were validated by applying its code blocks to a scratch copy; W75 consumes them unchanged.

```text
Rust (W74)
  src/fluid/fmath.rs            pub const F_SIGMA_MIN 0.2, F_SIGMA_MAX 5.0, TORN_CLEAR_MIN 0.67, TORN_CLEAR_MAX 1.5, F_REST_TOL 0.05, F_SLIP_RATE_PER_S 1.5 × SLIP_RATE_PER_S (D74-2 amended)
                                pub fn mul2(m: [f32; 4], n: [f32; 4]) -> [f32; 4]
                                pub fn svd2(f: [f32; 4]) -> ([f32; 4], [f32; 2], [f32; 4])   // U, σ (desc, ≥ 0), V; F = U·diag(σ)·Vᵀ (V a reflection when det F < 0), no alloc
                                pub fn clamp_f(f: [f32; 4]) -> ([f32; 4], bool)               // clamped F (trig-free), hit_clamp
                                pub fn update_f(f, c, dt, stiffness, torn) -> ([f32; 4], bool) // (I + dt·C)·F, slip, clamp, sticky torn
                                pub fn f_dev(f: [f32; 4]) -> f32                               // ‖F − I‖_F
  src/fluid/layout.rs           ST_MAX_F_DEV = 3 (was ST_RESERVED): state view slot 3 = max‖F − I‖_F of the element's particles
  src/fluid/solver.rs           SubstepOpts.f_dt (0 skips F), Scratch.max_fdev, measure_max_f_dev(p, out)
  src/fluid/elements.rs         Elements::update_rest_state_with_f(…) (update_rest_state stays as the maxFDev = 0 form)

TypeScript (W74)
  fluid-layout.ts               St.MAX_F_DEV = 3 (was St.RESERVED)
  renderers/webgpu/text-atlas.ts
    export interface AtlasRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number } // atlas px
    export type AtlasCanvasFactory = (w: number, h: number) => OffscreenCanvas | null
    export interface AtlasEntry { readonly id: number; readonly el: HTMLElement; readonly dpr: number }
    export const ATLAS_GUTTER_PX = 10            // CSS px; ceil(10·dpr) atlas px
    export const ATLAS_MAX_SIZE_PX = 4096
    export const defaultAtlasCanvas: AtlasCanvasFactory
    export class TextAtlas {
      constructor(opts?: { createCanvas?: AtlasCanvasFactory; maxSize?: number });
      build(entries: ReadonlyArray<AtlasEntry>): ReadonlyMap<number, AtlasRect>;   // whole page; reads computed `color` per text node
      invalidate(id: number): void;              // sets `stale` (v1 re-renders the whole page on the next build)
      readonly canvas: OffscreenCanvas | null; readonly width: number; readonly height: number;
      readonly dpr: number; readonly version: number; readonly stale: boolean;
    }
  renderers/frame.ts            ElementPaint.atlasRect: AtlasRect | null
                                export interface TextAtlasFrame { canvas: OffscreenCanvas; width; height; dpr; version }
                                RenderFrame.textAtlas?: TextAtlasFrame | null
                                Renderer.textReady?(id: number): boolean   (WebGPU only; true while render() draws that slot's atlas text)
  renderers/webgpu/gpu-buffers.ts  PARTICLE_GPU_FLOATS = 8 (x, y, f00, f01, f10, f11, flags, pad), TEXT_INFO_FLOATS = 8
                                   packParticles(frame, out): number; packRestUV(frame, out): void;
                                   packTextInfo(frame, atlas: AtlasSize, out, ok: Uint8Array): number; hasMovingText(frame, ok): boolean
  renderers/webgpu/shaders.ts   TEXT_WGSL (splat into T1/T1w), TEXT_COMPOSITE_WGSL, FINV_NORM_CLAMP = 2, TEXT_DET_EPS = 1e-4
  renderers/webgpu/webgpu-renderer.ts  five pipelines; T1_FORMAT, T1_WEIGHT_FORMAT, ATLAS_FORMAT; WebGPURenderer.textReady(id)
  stylesheet.ts                 TEXT_CLASS = "liquid-text"; rule `.liquid-text, .liquid-text * { -webkit-text-fill-color: transparent; text-decoration-color: transparent; text-shadow: none }` (!important, screen + forced-colors: none; never sets `color`)
                                addTextClass(el) / removeTextClass(el)   // refcounted per element across instances; author's own class kept
  text-toggle.ts                export interface TextToggleArgs { ids: Iterable<number>; elementOf(id): HTMLElement | undefined; restAlpha(id): number;
                                  renderer: Renderer | null; activeRenderer: ActiveRenderer; reducedMotion: boolean; held: Set<HTMLElement> }
                                syncTextClasses(a: TextToggleArgs): void           // after render(); sweeps held elements no longer observed
                                clearTextClasses(held: Set<HTMLElement>): void     // device.lost, RM, failed frame, failed rebuild, destroy
                                releaseTextClass(held: Set<HTMLElement>, el): void // unobserve
  runtime.ts                    owns the atlas: `const textAtlas = new TextAtlas(…)`, `rebuildAtlas()` with the paints on a generation / paints change
                                  or while `activeRenderer === "webgpu" && textAtlas.stale`, before render(); `syncText()` after render();
                                  per-instance `textHeld`; TEXT_ATLAS_WARNING; FluidRuntimeOptions.textAtlasCanvas (@internal)
  tests                         _fake-atlas.ts (fakeAtlasCanvas, installRangeRects, oneLinePerNode, rect, fontPx); _fluid-test-backend.ts forceRestAlpha(id, a | null);
                                _fake-gpu.ts copyExternalImageToTexture (calls.externalCopies)

TypeScript (W75)
  element-observer.ts           new ElementObserver(factory?: MutationObserverFactory): observe(el), unobserve(el), disconnect(), drain(): Map<HTMLElement, DomChange>, size
                                DomChange = { colour: boolean; text: boolean }; OWN_CLASSES = {liquid-element, liquid-text, liquid-halo}; OBSERVER_INIT
                                  (attributeFilter style/class only, so data-liquid-id / data-liquid-stack are never observed); authorClasses(value)
  stylesheet.ts                 HALO_CLASS = "liquid-halo"; HALO_ID_ATTR = "data-liquid-id"; HALO_BLUR_PX = [1, 2, 4, 8]; haloRule(key, bg)
                                acquireHaloRule(el, bg: RGBA) / updateHaloRule(el, bg) / releaseHaloRule(el)   // keyed by element (document-unique h<n>), refcounted
                                addHaloClass(el) / removeHaloClass(el)   // same private classHolds helper as add/removeTextClass
  halo-toggle.ts                HaloEntry { id; el }; HaloSyncArgs { entries; restAlpha(id); activeRenderer; reducedMotion; held: Set<HTMLElement> }
                                wantsHalo(activeRenderer, reducedMotion, restAlpha); syncHaloClasses(a); clearHaloClasses(held); releaseHaloClass(held, el)
  runtime.ts                    applyDomChanges() first in frameBody (drain, transitionend, fonts loadingdone, DPR) → registry.refresh + textAtlas.invalidate(id);
                                  syncHalo() after syncText(); halo cleared on a failed frame, a failed rebuild, unobserve, destroy;
                                  FluidRuntime.textInvalidations (@internal) and scene hook `textInvalidations`
  color.ts                      unchanged: snapshotColorsWithout(el, ELEMENT_CLASS) (no liquid-text lift needed)
  tests                         _moving-backend.ts movingBackend(): { backend; setRestAlpha(id, a | null) } (adapter over forceRestAlpha)

W76 consumes no new code names: the scene classes (`liquid-text`, `liquid-halo`), the scene hook and the record projects.
```

## Review Focus

1. **Invisible text** (W74): any path where `liquid-text` stays on without atlas text drawn — atlas build failure, an element with no text nodes, a lost device mid-motion, reduced motion switched on mid-splash, destroy during motion. Expected: DOM text visible again on the next frame.
2. **Class feedback loop** (W75): the toggle's own `class` writes or the halo rule must not trigger the MutationObserver into re-snapshotting or re-rendering every frame.
3. **Text content changes mid-motion** (W75): changing an element's text while it splashes re-renders its atlas entry without leaving stale glyphs or a wrong `rest_uv` mapping.
4. **Large or many elements** (W74): atlas size limits (`maxTextureDimension2D`), an element larger than the atlas page, 32 elements with text; no validation error, degrade by dropping text for the overflowing element (fail-safe keeps DOM text).
5. **Fonts and DPR** (W75): a web font finishing after observe, and a DPR change (zoom), both re-render the atlas; no blurred or misplaced atlas text at rest→motion.

## Cross-ward verification

The ward files are written in parallel against this index, then a cross-checker verifies names, signatures, file paths, test counts, D-item coverage and Review Focus pinning; findings go to `_verification.md`.
