# liquiddom slice 6: the world (design)

Status: brainstormed with Dennis 2026-10-13 after W79 (saga dec_645b54e4); written for review. The binding design stays `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` (the spec); this document details slice 6 inside it and lists the amendments it needs. Acceptance scene and matrix: `.wdd/NORTH-STAR.md`.

## 1. Goal and scope

"It follows the page. On scroll and resize the liquid follows its elements without snapping." Scene step 7: "Scroll 300 px and back: the liquid follows with no snap." Matrix S6: every step ✅ in every renderer the slice has. The slice also brings the adapters and the site up to the fluid engine and ends with a **whole-picture check** (NORTH-STAR: after slices 2, 4 and 6).

Order: the engine first, shipping last (Dennis 2026-10-13).

| Ward | Content | Steps |
|---|---|---|
| W80 "Scroll follows" | the acceptance scene can scroll; `scroll-tracker.ts`; `core.scroll_shift(dx, dy, ivx, ivy)` (rigid shift + light inertia); mid-drag scroll; container scroll; the 1-frame lag measured; a step-7 budget | 7 |
| W81 "Parking and resize" | park elements outside viewport + margin, re-enter at rest; one logged grid reallocation on resize; Canvas2D skips inactive and parked particles | 7, 1 |
| W82 "Under the page" | the canvas at `z-index: -1` (escaped liquid goes under all page content); container stacking context; the W77 open findings | 1, 3, 6 |
| W83 "Gravity and tilt" | gravity as a high-pass: the liquid sloshes when the tilt changes and rests at home afterwards; `fixed` and `orientation`; tilt scene | scene |
| W84 "Touch and opt-out" | touch drag on long-press; per-element drag opt-out; per-time pointer decay | 5 |
| W85 "Adapters" | adapters react to a stopped instance (`onError`); `drag` prop; area hint without autoObserve; `examples/vue` + dist e2e | adapters |
| W86 "The site" | landing + playground + short docs on the 0.3 API; back in workspaces, vitest and CI; deploy workflow ready (dispatch is Dennis' call) | site |
| W87 "Whole picture" | recording of the acceptance scene and the site landing in Canvas2D and WebGPU; status per step in `.wdd/memory/whole-picture/slice-6.md`; Epic 15 completion criteria reviewed | all |

**Out:** publishing `0.3.0-alpha.x` and the fate of `0.2.0-rc.0` (spec §7) — presented to Dennis at W87, never executed by AI; dispatching `deploy-site.yml`; WebGPU compute, a Worker, liquid icons, liquid above the DOM, border/shadow (spec §7); keyboard drag (decoration, not function); owner-aware physics; persistent gravity lean (rejected, §7 D83-1).

## 2. What exists (2026-10-13 survey)

- **Scroll:** no scroll code. Body-mode buffer space is the viewport (client px); `registry.sync()` re-reads every rect each frame, so a scroll looks to Rust like every home moving at scroll speed (`update_velocities`, rect delta over wall time) — full physics, which tears the liquid on a long scroll. The acceptance scene is ≈ 520 px tall at 1280×800 and cannot scroll; `e2e/north-star.ts` has no step-7 budget. Container mode: the canvas is `position: absolute` 100 % inside the container, so in an `overflow: auto` container it would scroll away with the content (unverified).
- **World and grid:** measured once at `create()` (`runtime.ts` `measureWorld`, viewport-sized in body mode); the Rust grid covers it plus a margin `max(200, maxElementH)` px and is never reallocated; off-grid targets and particles clamp to the walls.
- **Parking:** none. W67's lock probe recovered by slip alone (`ward-067.md`, 270 and 158 frames of 300), so CONTEXT's "a large scroll can lock particles … slice-6 parking" is stale. Canvas2D still splats inactive (`w == 0`) particles (W76 could not reproduce a visible case).
- **Stacking:** the canvas is `position: fixed; z-index: 0`; observed elements get `z-index: 1` (D7). Non-positioned page content paints below a positioned `z-index: 0` box, so escaped liquid paints over ordinary page text (slice-4 landing finding).
- **Gravity:** validated (`options.ts`), dropped by the facade; `tick` receives `0, 0`; Rust ignores `_gx/_gy`. Four `it.skip` in `gravity.test.ts` and one `#[ignore = "slice 6"]` scenario expect liquid to fall. `requestOrientationPermission()` exists; no `deviceorientation` listener.
- **Drag:** mouse/pen only (D78-2); no opt-out (W78 deferred it here, saga dec_4ee820b6); pointer decay ×0.8 per frame (D68-4).
- **Adapters:** React and Vue compile against 0.3 and pass their jsdom tests; neither reacts to a stopped instance; only `examples/react` exists (blocking `e2e/dist.spec.ts`).
- **Site:** Astro 6 + Tailwind 4 (`liquiddom.vsplat.io`), still on the 0.2 soft-body API (showcases and docs); out of workspaces, vitest and CI; `deploy-site.yml` dispatch-only; `SITE.md` stale; site vite `^7` vs root `^8`.
- **Release:** every package `0.3.0-alpha.0`; 12 pending changesets; `changeset version` never run.

## 3. W80 "Scroll follows"

**Spike W80.0 (half a day, throwaway, D2).** Question: with a rigid shift, which inertia factor and cap make a 300 px scroll at 1, 3 and 10 px/frame visibly "liquid" yet re-form within the step-7 budget, and is the 1-frame lag behind native scroll visible at rest (Canvas2D exact `roundRect` vs the DOM rect during `scrollTo`, Chromium and Metal recordings)? Output: a table in `ward-080.md`; the code is never copied.

**TS.** New `scroll-tracker.ts` (one per instance) reads the scroll position once per frame: `scrollX/Y` in body mode, the container's `scrollLeft/Top` in container mode. `Δ = now − previous`; the first frame, a remount and a new instance give 0. Inertia `iv = Δ / frameDt · SCROLL_INERTIA`, capped (constants from W80.0). Frame order: coord offset → `applyDomChanges()` → scroll-tracker → `dragTracker.frame()` → `registry.sync()` → `core.scroll_shift(dx, dy, ivx, ivy)` → `core.tick()` → render → toggles.

**Rust.** `scroll_shift` moves every active, non-parked particle and each element's previous home rect by `(−dx, −dy)`, so the element velocity (rect delta) sees only motion beyond the scroll: **without inertia the simulation is bit-identical to an unscrolled page**. The inertia is added to those particles' velocities (scrolling down, the liquid lags slightly and the spring brings it home). Input is sanitised (NaN/Inf → 0, shift clamped to ±`WORLD_MAX_PX`, inertia to the pointer's 2000 px/s); `invalidate_bounds()` as for splash. Reduced motion: inertia 0 (the pin still holds).

**Interplay.** A mid-drag scroll adds Δ to `home_dx/dy`, so the dragged liquid stays under the pointer (closes the CONTEXT limitation "a mid-drag scroll carries the liquid"). The pointer is viewport space and unchanged. Container mode: the canvas is kept on the container's visible window by a per-frame `transform` on the canvas (never on author DOM), then the same shift.

**Scene.** The acceptance scene gets a spacer below the stage so it can scroll ≥ 300 px; step 7 gets a re-form budget in NORTH-STAR and spec §6 together (D80-3). The landing scene keeps its no-scroll assertion (D76-2); the scrolling page is the site landing (W86).

## 4. W81 "Parking and resize"

**Parking (Rust).** An element is parked when its home rect lies entirely outside viewport + margin (the grid margin), and unparked when it comes ≥ 64 px inside that bound (hysteresis, D81-1). While parked its particles skip P2G/G2P and `scroll_shift`, and carry a `PARKED` particle flag that both renderers skip. On re-entry they are placed at rest at once (`home + rest_u/v`, F = I, `s = 1`, restAlpha 1): no excitation, as the spec's "invisible because it happens off-screen". A dragged element is never parked. The particle budget and the state stride are unchanged.

**Canvas2D** skips particles whose flags say inactive or parked (closes W76's `w == 0` item with a colour-keyed e2e guard).

**Resize.** When the viewport grows beyond the world allocated at `create()`, one explicit `core.resize_world(w, h)` reallocates the grid outside `tick`, with one `console.info` (spec §2: "one explicit, logged reallocation"). Never shrinks; particles are kept. This is not a hot-path allocation.

CONTEXT's stale lock line is removed.

## 5. W82 "Under the page"

**Stacking.** Body mode: the canvas moves to `z-index: -1` in the root stacking context, so all page text and elements sit above the liquid and escaped liquid goes under page content. Pitfall: when both `<html>` and `<body>` have an opaque background, body's background paints above the canvas; detected at `create()`, handled by D82-2 (one `console.warn` and fallback to `z-index: 0`, or an author rule). Container mode: the container must be a stacking context (e.g. `isolation: isolate`); documented, one `console.warn` at `create()` like the static-container warning; liquiddom never restyles it. Whether the observed elements' `z-index: 1` rule (`data-liquid-stack`) is still needed is measured in W82.0 (D82-3).

**W77 open findings** (each measured, each a decision at the gate):
- Canvas2D stair-step edge on the landing (3.5 px cell): a finer cell or a softer threshold in the density grid (D82-4).
- The dark card past the right viewport edge under shake: shake never pushes liquid past the viewport wall (D82-5).
- "Book a demo" drawn into a bead chain at f20: thin wide elements do not tear into beads; candidate a thickness-dependent yield (D82-6).

## 6. W83 "Gravity and tilt"

`gravity: { source: 'none' | 'fixed' | 'orientation', vector, strength }` (default strength 980 px/s²) reaches `tick(…, gx, gy)`. **Only changes in gravity act** (a high-pass, Dennis 2026-10-13): tilting the phone sloshes the liquid to one side and it settles at home again, so rest, the exact contour and the DOM text work as today. A `fixed` vector therefore acts only when it changes: at `create()` and through a new `setGravity(partial)` setter (D83-3); this is stated in the API docs. Rust adds the high-passed `g·dt` to grid velocities of cells with mass, scaled so the liquid never leaves its element (scale from a W83.0 measurement). `orientation`: a `deviceorientation` listener maps beta/gamma to `(gx, gy)`; `requestOrientationPermission()` on iOS; the listener is removed on `destroy`. Reduced motion: g = 0. New `demo/scenes/tilt.html` (a vector slider on desktop, real tilt on mobile). The four skipped TS tests and the ignored Rust scenario are rewritten to these semantics at W83 red (Dennis approves them as usual).

## 7. W84 "Touch and opt-out"

**Touch drag on long-press.** A touch `pointerdown` on an observed element starts a 350 ms timer; movement > 8 px, `pointerup` or `pointercancel` cancels it and the page scrolls as usual. When it fires, the element swells as feedback and the drag starts; a non-passive `touchmove` listener calls `preventDefault()` while the drag is live so the browser does not take over. The long-press context menu is suppressed on observed elements (`contextmenu`, `-webkit-touch-callout: none` in the layer). A tap is still a click; the click ending a drag is swallowed as for mouse. Tests: Playwright `hasTouch` and CDP touch events.

**Opt-out.** `observe(el, { drag: false })`, captured once like `viscosity`; the adapters get the prop in W85.

**Pointer decay per time.** ×0.8 per frame → `0.8^(dt·60)`; deterministic under `clock=manual`; 60 Hz and 120 Hz feel the same (closes D68-4's limitation).

## 8. W85 "Adapters"

- **Stopped instance:** a new core option `onError(err)` is called once when the first throwing frame stops the instance; the providers expose it (`useLiquid()` → `null` plus an error state). The exact API shape is D85-1.
- **`drag={false}`** on `LiquidElement` and in `useLiquidRef` (follows from `UseLiquidRefOptions = ElementOptions`).
- **Area hint without autoObserve:** core derives it from the first frame's `observe()` batch and redistributes once (slice-2 whole-picture recommendation; adapters are the typical case).
- **`examples/vue`** and a blocking Vue dist e2e, mirroring `examples/react`.

## 9. W86 "The site"

Astro and Tailwind stay; the content is rewritten: a **landing** that scrolls and uses liquiddom itself (the real long-page test of scroll and parking), a **playground** ported from `demo/scenes/playground.html`, and **short docs** (getting started, the 0.3 API reference, adapters, accessibility and limitations). The old showcases and the soft-body docs are deleted. The site returns to the root workspaces, vitest and the CI build, with a build-smoke e2e; vite is aligned with the root; `SITE.md` is corrected. `deploy-site.yml` stays `workflow_dispatch`; the dispatch is Dennis' call.

## 10. W87 "Whole picture"

Recording of the acceptance scene and the site landing in Canvas2D and WebGPU (`record` and `record-webgpu` projects), a status per scene step against the matrix in `.wdd/memory/whole-picture/slice-6.md`, inspected with vision. Epic 15's completion criteria are reviewed; "webgpu blocking after 10 green runs" (CI has only the SwiftShader smoke) is presented as an open point. Publishing `0.3.0-alpha.x` and the fate of `0.2.0-rc.0` are presented as Dennis' decisions.

## 11. Verification

- **Rust:** a rigid shift without inertia is bit-identical to no scroll; inertia lags and re-forms; sanitised NaN/Inf; parked particles untouched by P2G/G2P and shift; re-entry at rest; hysteresis; `resize_world` keeps particles; high-pass gravity sloshes and rests (no persistent deviation).
- **Vitest (jsdom):** scroll-tracker (body and container, first frame 0, remount); mid-drag scroll adjusts `home_dx/dy`; long-press timer, move/cancel paths, swallowed click; `drag: false`; per-time decay; `onError` once; adapter `drag` prop and error state; gravity mapping and listener removal.
- **e2e, canvas2d (blocking), manual clock:** step 7 — scroll 300 px and back; per frame the liquid's rest contour moves with the DOM rect within a bound (no snap) and every restAlpha is 1 within the step-7 budget; the colour-keyed parking guard; container scroll; touch long-press drag via CDP; the canvas under page text (a pixel probe over unobserved text).
- **e2e, webgpu-hw (local, Metal):** step 7 and the 1-frame-lag measurement in WebGPU.
- **Baselines:** Linux Canvas2D step 7 mid-scroll and after; committed only after Dennis' vision approval (D65-7). Steps 1–6 and 8 must not move unless a ward's decision says so (W82 stacking and findings will move landing baselines; each needs vision).
- **Perf:** a scroll frame ≤ 1.15 × an idle frame (W77-style ratio guard); parking lowers the frame time on a long page.
- **Gold (each ward):** vision in both renderers; W87 records every step.

## 12. Decisions for the direction gates

| ID | Decision | Recommendation |
|---|---|---|
| D80-1 | Scroll model | viewport space + rigid `scroll_shift` + light inertia (brainstorm, Dennis 2026-10-13) |
| D80-2 | Inertia factor and cap | values from W80.0 |
| D80-3 | Step-7 budget | from W80.0; NORTH-STAR and spec §6 changed together |
| D80-4 | 1-frame lag | accepted if W80.0 shows it invisible at rest; otherwise a canvas that scrolls with the content |
| D81-1 | Parking | skip simulation outside viewport + margin, 64 px hysteresis, re-enter at rest (brainstorm, Dennis 2026-10-13) |
| D81-2 | Resize | one logged `resize_world` when the viewport outgrows the world; never shrink |
| D82-1 | Stacking | canvas at `z-index: -1`, under all page content (brainstorm, Dennis 2026-10-13) |
| D82-2 | Opaque html + body backgrounds | from W82.0: warn + fallback, or an author rule |
| D82-3 | Observed-element `z-index: 1` rule | from W82.0 |
| D82-4…6 | W77 findings (edge, card past edge, beading) | from W82.0 measurements |
| D83-1 | Gravity | high-pass: slosh on change, rest at home (brainstorm, Dennis 2026-10-13) |
| D83-2 | Gravity scale | from W83.0 |
| D83-3 | Changing gravity at run time | a `setGravity(partial)` setter, validated like `setMaterial` |
| D84-1 | Touch drag | long-press 350 ms, 8 px cancel, non-passive touchmove while live (brainstorm, Dennis 2026-10-13) |
| D84-2 | Opt-out | `observe(el, { drag: false })` |
| D84-3 | Pointer decay | `0.8^(dt·60)` |
| D85-1 | Stopped-instance API | `onError(err)` option; provider error state |
| D86-1 | Site content | landing + playground + short docs; old showcases deleted (brainstorm, Dennis 2026-10-13) |

## 13. Spec amendments (applied with this document)

- §2 grid: the slice-6 reallocation is `resize_world`, outside `tick`, logged once, never shrinking.
- §2 walls and off-screen elements: parking hysteresis, the `PARKED` flag, a dragged element is never parked.
- §2 interaction table: a scroll row (rigid shift + light inertia); the drag row gains touch long-press and the opt-out; the gravity row becomes the high-pass.
- §4 canvas: `z-index: -1` (D82-1), container stacking context; the scroll row in the situation table points at W80's measurement.
- §5 API: `observe(el, { viscosity?, recovery?, drag? })`; gravity semantics (high-pass; `setGravity` per D83-3); a stopped-instance callback (shape D85-1).
- §6 slice table row 6: wards and this design document.
