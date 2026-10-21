# liquiddom fluid engine, slice 5 (drag and merge): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every ward also follows WDD / GS-TDD:** direction gate (all `Decision:` lines approved) → failing tests → `wdd ward status NN red` → STOP for Dennis' "godkendt" → implement → green → ward review → `wdd ward status NN gold` → STOP. AI never decides on its own that a ward is complete; after Dennis approves gold, AI may run `wdd complete` (or apply the approved manual transition when the harness blocks it).

**Goal:** Dragging "Merge" with a mouse or pen moves its liquid, not its DOM element: the liquid softens and follows the pointer, the label follows the liquid, and on release the liquid crawls home and re-forms within 3 s (W78). Dragged into the card, the two liquids displace and merge, separate after release, both re-form within 3 s, and their labels never overlap (W79). Slice 5 ends with scene step 5 ✅ in both renderers; steps 1–4, 6 and 8 stay green.

**Architecture:** TypeScript owns the gesture: a per-instance `DragTracker` (`drag-tracker.ts`) turns a mouse/pen press past 4 px into an active drag `{el, dx, dy}`, captures the pointer, swallows the click that ends it once, and cancels on every abnormal path. The registry writes `DRAGGED` (3) into slot 5 and the offset into slots 6–7 every frame. Rust stays DOM-blind: a dragged element is held at `s ≤ 0.5` every substep (so it never rests), its home velocity includes the offset delta, and the soft pointer field skips its particles; the saturated home spring gives the crawl home after release. WebGPU's atlas text already rides the liquid; under Canvas2D the runtime hides the dragged element's DOM glyphs with a refcounted `liquid-away` class until it is at rest again. W79 adds neighbour softening under the dragged home, slip tuned for separation and the "no two labels on one pixel" rule (D79-1), all measured first by the W78.0 spike.

**Tech stack:** Rust (edition 2024, wasm-bindgen), TypeScript (strict), WebGPU/WGSL, Vitest 4 (jsdom, fake canvas, fake GPU), Playwright 1.63.0 (canvas2d blocking in CI; WebGPU local on Metal, W71.0 fallback B).

**Spec:** the binding [`2026-10-02-liquiddom-fluid-design.md`](../../specs/2026-10-02-liquiddom-fluid-design.md) (amended for slice 5 in `c9ecf5e`: §2 damage rules ~121, hover and focus ~126, interaction table drag row ~171, §4 DOM model ~335, §6 slice row 5 ~490) and the slice design [`2026-10-11-liquiddom-slice-5-drag-merge-design.md`](../../specs/2026-10-11-liquiddom-slice-5-drag-merge-design.md) (binding for this plan). Executors read both, this index and their ward file. Acceptance scene and matrix: `.wdd/NORTH-STAR.md`. Spike evidence (reference only, D2): session scratchpad `w78spike/` — never copied into the repo.

## Wards

| Ward | Slice | File | Content |
|---|---|---|---|
| W78 | 5 | [W78.md](W78.md) | **Drag the liquid:** spike W78.0 (half a day, throwaway) for W79's constants and the D79-1 mechanism; `DragTracker` (mouse/pen, primary button, 4 px, capture at the threshold, click swallowed once, cancel paths); `DRAGGED` in slot 5 and `home_dx/dy` in slots 6–7; Rust holds `s ≤ 0.5`, home velocity includes the offset, no rest while dragged, pointer field skips the dragged liquid; Canvas2D `liquid-away` label class; step 5 drag away and back in both renderers; two new Canvas2D Linux baselines |
| W79 | 5 | [W79.md](W79.md) | **Merge and separate:** W79.0 confirmation measurement (≤ 2 h, throwaway, on this plan's code) for the Canvas2D closed-region bound; neighbours whose home rect overlaps the dragged home rect grown by 16 px held at `s ≤ 0.2` every substep; a per-element merge slip (4.5/s, 240 px/s) for the dragged element and its softened neighbours until they rest, every other element unchanged (D79-2 option B; the spike's global slip is option A); WebGPU text pass writes a per-texel element-id target (`rg16float`, `min` on `(id, −id)`) and the composite drops the text where two ids meet (D79-1); `@internal` `captureTextIds()` readback for the e2e (D79-6); merges held 90 frames (D79-4); step 5 e2e in both renderers incl. the closed-region check; one new and one moved Canvas2D Linux baseline; merge perf guard against a card splash (D79-3); gold vision of step 5. Constants from spike W78.0 (ward-078.md) |

**Order:** W78.0 (ward file, baseline, spike) → D78 direction gate → W78.1 red → W78.2 … W78.6 → W78 gold (done, `c1a52ff`). W79.0 (ward file, epic row, baseline, confirmation measurement) → D79 direction gate (D79-1 … D79-6) → W79.1 red → W79.2 (Rust) → W79.3 (WebGPU) → W79.4 (browser runs, baselines, STOP for vision) → W79.5 (docs, verify, ward review) → W79 gold. W79.2 and W79.3 touch disjoint files and may run in either order; W79.4 needs both.

**Test totals at W78's end** (baseline measured 2026-10-11 at `c9ecf5e`: cargo `170 passed; 0 failed; 2 ignored`, vitest `633 passed | 4 skipped (637)` in 61 files, Playwright `--list` canvas2d 58 / webgpu 33 / webgpu-hw 68 / perf 3): cargo **`178 passed; 0 failed; 2 ignored`**; vitest **`670 passed | 4 skipped (674)`**, 64 files; Playwright `--list` canvas2d **64**, webgpu **39**, webgpu-hw **76**, perf 3. W78 leaves `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green. (Measured at W78 gold, `43ee0e5`, after its red-review and ward-review additions: cargo `181 passed`, vitest `684 passed | 4 skipped (688)` in 67 files, `--list` 64 / 39 / 76 / 3.)

**Test totals at W79's end** (baseline at `c1a52ff` = W78 gold above): cargo **`191 passed; 0 failed; 2 ignored`** (+10); vitest **`693 passed | 4 skipped (697)`**, 68 files (+9 new, 2 approved-test changes); Playwright `--list` canvas2d **66**, webgpu **41**, webgpu-hw **80**, perf **4**. W79 leaves `npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw` and the perf project's W77 and W79 guards green.

**Human prerequisites:**
- Direction gate for D78-1 … D78-6 after the spike (D78-1 … D78-3 were chosen in the brainstorm of 2026-10-11, saga dec_e541d1bd, and still pass the gate formally); W79's gate (D79-1 … D79-6, with D79-2's options A and B side by side) after W79.0's confirmation measurement.
- Dennis approves red ("godkendt"), every Linux baseline (D65-7) and gold.
- Docker Desktop running for the Linux baselines (W78.5, W79.4); a Mac with Metal for `e2e:webgpu-hw`.

## Global Constraints

**Unchanged contracts**
- FFI layout and strides unchanged: `ELEMENT_STRIDE 10`, `STATE_STRIDE 4`, `DYNAMIC_FIELDS 7`, `STATIC_FIELDS 3`. Slot 5 keeps its semantics (`0` idle, `1` hover, `2` focused, `3` dragged; `INTERACTION_DRAGGED = 3` already exists in `src/fluid/layout.rs:49` and `Interaction.DRAGGED` in `fluid-layout.ts:36`); slots 6–7 stay "drag offset of the home rect relative to the DOM rect (px), 0 when not dragging" (spec ~204). No new slot, no new FFI call.
- No JSON over FFI; fixed pools; no hot-path allocation (the drag tracker allocates one press record per pointerdown, never per frame or per move); no panics on JS input in `src/fluid` (`clippy::indexing_slicing` denied, no unwrap).
- Rendering never touches the DOM; the runtime owns every class write (`liquid-text`, `liquid-halo`, `liquid-away`). The canvas stays below the DOM (D7). Only `ts/src/wasm-loader.ts` imports `pkg/`. The DOM, focus and hit areas never move during a drag.
- Canvas2D never sets `liquid-text` (D74-6, pinned by `e2e/acceptance.spec.ts:496` and `e2e/modes.spec.ts:107`); WebGPU never sets `liquid-away`.

**Values (slice design §4, spec as amended 2026-10-11)**
- Threshold: the drag starts once the pointer is **more than 4 px** from the down point (`DRAG_THRESHOLD_PX = 4`; the spikes' 6 px is not adopted). Mouse and pen only (`pointerType`), primary button (`button === 0`), primary pointer (`isPrimary`); touch and keyboard never drag. One drag per instance; the innermost observed element wins (D67-9's rule).
- Priority in slot 5: `DRAGGED (3) > hover (1) > focus (2) > idle (0)`; reduced motion writes 0. The dragged element's slots 6–7 hold `dx, dy` (CSS px from the down point); every other element writes 0; release and cancel write slot 5 → not 3 and slots 6–7 → 0 in the **same** `sync()` (no TS glide).
- Engine: `s ≤ 0.5` while dragged (`DRAG_STIFFNESS_CAP = 0.5`, applied every substep), so `restAlpha` stays 0 and a dragged element never rests (D78-5); home velocity includes the offset delta while dragged and nothing on the release frame; the soft pointer field skips the dragged element's particles; the hover swell is off while dragged (Rust reads `HOVER` only). After release the existing rest rules apply against the DOM home; re-form ≤ **180 frames** (3 s, NORTH-STAR step 5).
- Click: after a drag that crossed the threshold, the next click on that element is swallowed **once** (window capture phase, `stopImmediatePropagation` + `preventDefault`), cleared in the task after that press's `pointerup` or at the next press; a press that never crosses 4 px stays a click (splash).
- Cancel paths (cancel = release for the engine): `pointercancel`, window `blur`, `Escape`, `lostpointercapture`, a move with the primary button no longer down, `unobserve()`, `destroy()`, a switch to reduced motion, a detached element (next frame), a lost WebGPU device, a failed frame.
- Reduced motion ignores drag: no slot writes, no capture, no swallowed click (the click splash path is gated by D68-5 as before).
- Canvas2D label: `liquid-away` hides the element's DOM glyphs with the `liquid-text` declarations (`-webkit-text-fill-color: transparent`, never `color`; screen + `forced-colors: none` only, so print and forced colours show the text) while the element is dragged and after a release until `restAlpha = 1`; removed at once on cancel, reduced motion, unobserve, destroy, a failed frame or rebuild; refcounted per element across instances; no halo while it is held.

**Verification**
- Every e2e spec imports `test` from `e2e/fixtures.ts` (fails on `console.error`, `pageerror`, panics); WebGPU specs run locally in `webgpu-hw` (Metal); pixel reads via `__liquidTest.pixels()`; the drag is a real Playwright mouse gesture on the manual clock (`?clock=manual`), one frame per move.
- Linux baselines only via `npm run e2e:update` (Docker, pinned image) and only with Dennis' vision approval (D65-7). W78 adds two (`acceptance-step5-drag-mid`, `acceptance-step5-drag-reformed`); the eight existing baselines must not move.

**Process**
- Commit by path, never `git add -A`. Trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JWKWkrzUtppUzFBpDS954E`.
- No pushes or merges without asking. Ward status via `wdd ward status 78 …`; the ward file is hand-created flat (D63-1). One changeset per ward; W78 is a feature, so `minor` for `liquiddom` (pre mode alpha).

## Shared interfaces (binding; W78 produces, W79 consumes)

```text
Rust (W78)
  src/fluid/elements.rs      Elements::is_dragged(&self, id: usize) -> bool           // slot 5 within ±0.5 of DRAGGED; NaN/out of range → false
                             Elements.prev_off_x / prev_off_y: Vec<f32>               // offset at the last velocity sample (0 unless dragged)
                             Elements::update_velocities(dt)                          // + offset delta while dragged; release frame adds none
  src/fluid/interaction.rs   pub const DRAG_STIFFNESS_CAP: f32 = 0.5
                             pub fn hold_dragged(e: &mut Elements)                    // damage(id, DRAG_STIFFNESS_CAP) per dragged active element
  src/fluid/solver.rs        ElRow.dragged (private): the P2G pointer term is skipped for a dragged element's particles
  src/fluid/api.rs           tick: interaction::hold_dragged after update_stiffness, every substep
  tests                      src/fluid/drag_tests.rs (scene helpers: MERGE, CARD, element(b, interaction, dx, dy), scene(seed), drag_merge, release_merge)

TypeScript (W78)
  drag-tracker.ts            export const DRAG_THRESHOLD_PX = 4
                             export type DragEnd = "release" | "cancel"
                             export interface ActiveDrag { readonly el: HTMLElement; readonly dx: number; readonly dy: number }
                             export interface DragTrackerDeps { reducedMotion(): boolean; onEnd?(el: HTMLElement, how: DragEnd): void }
                             export class DragTracker {
                               constructor(deps: DragTrackerDeps, doc: Document, win: Window);
                               attach(el): void; detach(el): void;         // per observed element; detach cancels a press on el
                               readonly active: ActiveDrag | null;         // only past the threshold
                               frame(): void;                              // per frame: a detached pressed element cancels
                               cancel(): void; destroy(): void;
                             }
  element-registry.ts        RegistryDeps.drag?(): ActiveDrag | null; sync() writes slot 5 (DRAGGED > hover > focus > idle) and slots 6–7
  stylesheet.ts              AWAY_CLASS = "liquid-away"; rule `.liquid-away, .liquid-away * { -webkit-text-fill-color: transparent; text-decoration-color: transparent; text-shadow: none }`
                               and `.liquid-away.liquid-halo[data-liquid-id], .liquid-away .liquid-halo[data-liquid-id] { text-shadow: none }` (all !important, screen + forced-colors: none)
                             addAwayClass(el) / removeAwayClass(el)      // the shared private classHolds helper (refcounted across instances)
  element-observer.ts        OWN_CLASSES = {liquid-element, liquid-text, liquid-halo, liquid-away}
  away-toggle.ts             export interface AwaySyncArgs { entries: Iterable<HaloEntry>; restAlpha(id); dragged: HTMLElement | null; activeRenderer; reducedMotion; held: Set<HTMLElement> }
                             wantsAway(activeRenderer, reducedMotion, dragged: boolean, held: boolean, restAlpha): boolean
                             syncAwayClasses(a); clearAwayClasses(held); releaseAwayClass(held, el)
  halo-toggle.ts             HaloSyncArgs.suppressed?: ReadonlySet<HTMLElement>  // elements whose glyphs liquid-away hides get no halo
  runtime.ts                 owns `dragTracker` and `awayHeld`; frame: applyDomChanges → dragTracker.frame → registry.sync → tick → render → syncText → syncAway → syncHalo
  demo/test-hooks.ts         SceneSlot { interaction; homeDx; homeDy; s }; LiquidTestHook.slots?(): SceneSlot[] (acceptance scene)
  tests                      drag-tracker.test.ts, away-toggle.test.ts, drag-runtime.test.ts; e2e acceptance.spec.ts "W78 – drag the liquid" block
                             (w78Slots, w78Centre, w78DragMergeToCard, w78MergeFill), webgpu-robust.spec.ts "W78" block (w78Drag, canvasTextPixelsIn(page, sel, offset))
```

W79 adds (consumed by nothing in slice 5; listed for slice 6):

```text
Rust (W79)
  src/fluid/elements.rs      pub fn rects_overlap(a: &Rect, b: &Rect, margin: f32) -> bool   // b overlaps a grown by margin; open intervals; NaN → false
                             Elements.merge_slip: Vec<bool>; merge_slip(id) -> bool; set_merge_slip(id, on)   // cleared at rest, reset, reduced motion, inactive
  src/fluid/interaction.rs   pub const NEIGHBOUR_MARGIN_PX: f32 = 16.0; pub const NEIGHBOUR_STIFFNESS_CAP: f32 = 0.2
                             hold_dragged: + damage(n, 0.2) and merge_slip for every non-dragged element overlapping the dragged home + 16 px
  src/fluid/solver.rs        pub const MERGE_SLIP_RATE_PER_S: f32 = 4.5; pub const MERGE_SLIP_MAX_PX_S: f32 = 240.0
                             pub fn slip_velocity_at(offset, s, rate_per_s, max); ElRow.slip_rate / slip_max / slip(offset) (private)
  tests                      src/fluid/merge_tests.rs; solver.rs w79_tests; FluidCore::merge_slip_of (cfg(test))

TypeScript (W79)
  renderers/webgpu/webgpu-renderer.ts   T1_ID_FORMAT = "rg16float"; TEXT_ID_EMPTY = 4096; MIN_BLEND; interface TextIdCapture
                                        captureTextIds(): Promise<TextIdCapture | null>   // @internal, acceptance hook only
  renderers/webgpu/shaders.ts           TEXT_WGSL @location(2) id = (id, −id); TEXT_COMPOSITE_WGSL @binding(4) t1_id, coverage 0 where ids differ
  runtime.ts                            FluidRuntime.captureTextIds()   // @internal
  demo/text-id-report.ts                halfToFloat, summarizeTextIds; demo/test-hooks.ts SceneTextIds, LiquidTestHook.textIds?()
  e2e/lace.ts                           regionHolePixels(page, rect, margin = 16, r = 4); regionTearPixels(page, null, …) = any opaque colour
```

## Review Focus

The five failure modes most likely to slip past the happy path, each pinned by a test in the owning task:

1. **A drag that starts on a child element** (the card's `<h2>` or `<p>`, an icon inside a button): the press must belong to the observed element, the capture must go to the observed element (not the child), and nested observed elements must give the press to the innermost one only. Pinned by W78.1 `drag-tracker.test.ts` tests 4 and 5 (`given_a_press_on_a_child_of_the_observed_element_…`, `given_nested_observed_elements_…`).
2. **A drag that ends outside the window**: the `pointerup` arrives at the document (or not at all); the drag must release on a document `pointerup`, cancel on window `blur`, and cancel when a later move shows the primary button up, never stay stuck with `DRAGGED` in slot 5. Pinned by `drag-tracker.test.ts` tests 8 and 9 (`given_an_active_drag_when_pointercancel_blur_escape_or_lostpointercapture_…`, `given_an_active_drag_when_the_pointer_is_released_outside_the_window_…`).
3. **A press with the right or middle mouse button, or a non-primary pointer**: it must never drag, capture or swallow a click (a context-menu gesture over a button must not move its liquid). Pinned by `drag-tracker.test.ts` test 3 and e2e `step 5 – given a right-button drag on Merge …` (W78.1, canvas2d).
4. **A second instance observing the same element**: each instance has its own tracker and slot; one click must be swallowed for both (the first window-capture listener stops it, the other clears in the next task); `liquid-away` stays until both instances release; another instance's halo must never draw around glyphs `liquid-away` hides. Pinned by `drag-runtime.test.ts` test 9 (`given_two_instances_observing_one_element_…`), `away-toggle.test.ts` tests 3 and 5, and `stylesheet.test.ts` W78 test (the `.liquid-away.liquid-halo` override).
5. **`unobserve()` mid-drag**: the slot is zeroed, the tracker forgets the press (a later move after re-observe must not resume it), `liquid-away` is released before the registry restores the element, and the pending click swallow is dropped. Pinned by `drag-runtime.test.ts` test 6 (`given_a_drag_when_the_element_is_unobserved_mid_drag_…`) and `drag-tracker.test.ts` test 11 (`given_an_active_drag_when_detach_cancel_or_destroy_…`).

Also watched in the ward review (not a Review Focus item of its own): the element observer must treat `liquid-away` as liquiddom's own class, or every drag start and end would re-snapshot colours and re-render the atlas (W75 RF2's loop); pinned by the approved-test change in `element-observer.test.ts`.

W79 adds five more, listed with their pins in W79.md "Review Focus": a neighbour that stays soft after the drag has passed; the merge slip leaking into runs without a drag; a text pixel of two elements on one texel (WebGPU, including the 60 frames after the release); the id target out of step with T1; a capture that hangs or leaks.

## Plan verification (2026-10-11, before review)

Every anchor W78.md edits was read at `c9ecf5e` and is cited with its line: `src/fluid/layout.rs:13-15, 46-49`; `src/fluid/elements.rs:59-72` (`swell_rect`), `:136-148` (`home_rect`), `:175-197` (`update_velocities`), `:204-222` (`reset_slot`), `:228-237` (`damage`), `:242-257` (`update_stiffness`), `:270-325` (rest state); `src/fluid/solver.rs:181-232` (`ElRow`), `:612`, `:633` (pointer term); `src/fluid/interaction.rs:31-34`, `:268`; `src/fluid/api.rs:244-256` (substep loop); `packages/core/ts/src/element-registry.ts:23-30, 134-139, 195-199, 249-260`; `pointer-tracker.ts:113-136`; `input.ts:27-64`; `runtime.ts:352-357, 372, 414-431, 476-486, 491-493, 651-690, 696-707, 720-736, 737-782, 787-808, 878-911`; `text-toggle.ts:30-66`; `halo-toggle.ts:16-54`; `stylesheet.ts:18-44, 273-316`; `element-observer.ts:17-19`; `fluid-layout.ts:76-108`; `demo/test-hooks.ts:37-73`; `demo/scenes/acceptance.ts:113, 169-209`; `e2e/acceptance.spec.ts:99-160`; `e2e/webgpu-robust.spec.ts:446-480`. The baseline counts above were measured at `c9ecf5e` (after `npm run build:wasm` and `npm run build -w liquiddom`).

**Scratch validation (2026-10-11, session scratchpad, never in the repo).** W78.md's code blocks were extracted by script and applied to copies of `c9ecf5e`:
- Rust, red (W78.1 stubs + `drag_tests.rs`): `172 passed; 6 failed; 2 ignored`, the six failures exactly tests 1, 2, 4, 5, 7, 8 (test 8 at its "never rests while dragged" precondition). Green (W78.2 applied): `178 passed; 0 failed; 2 ignored`, `cargo clippy --all-targets --all-features -- -D warnings` clean, `cargo fmt --check` clean after the formatting this plan now shows; test 8 re-forms **122 frames** after the release (budget 180, D78-5 floor ≈ 113).
- TS, red (W78.1 test files only): the six affected files give `15 failed | 55 passed`, `drag-tracker.test.ts` and `away-toggle.test.ts` not collected — the 15 failures listed in W78.1 Step 9. Green (W78.3 + W78.4 applied): the eight affected files (`drag-tracker`, `away-toggle`, `drag-runtime`, `hover-focus`, `stylesheet`, `element-observer`, `halo-toggle`, `text-toggle`) `97 passed`; the full suite collects `674` tests in 64 files (its only failures are the scratch copy's missing `.git`, `dist` and workspace links: `e2e-harness`, `wasm-import-paths`, `workspace-publish`, one `runtime-truth` test); `tsc --noEmit -p packages/core/tsconfig.json` reports nothing new in `src/` or the W78 test files.
- Not executed for the plan: the e2e specs (Playwright), the demo hook, the spike and the Linux baselines; W78.1 Step 9 and W78.5 run them for real.

**W79.md (2026-10-11, at `c1a52ff`).** Every anchor W79.md edits was read at `c1a52ff` and is cited with its line: `src/fluid/elements.rs:51, 83, 99, 129-133, 162-174, 247-267, 273-282, 315-371`; `src/fluid/interaction.rs:15, 35-50`; `src/fluid/solver.rs:49-51, 182-235, 237, 421-428, 673, 693-694`; `src/fluid/api.rs:244-250, 716`; `src/fluid/mod.rs:33-36`; `src/fluid/fmath.rs:25` (unchanged under option B); `packages/core/ts/src/renderers/webgpu/shaders.ts:241-374, 376-404`; `webgpu-renderer.ts:16, 50-52, 156-164, 192-205, 334-342, 546-553, 570-573, 955-985, 994-1062, 1065-1082`; `runtime.ts:28, 104, 923-925`; `demo/test-hooks.ts:45, 85`; `demo/scenes/acceptance.ts:18, 21, 212-220`; `e2e/lace.ts:159-184`; `e2e/acceptance.spec.ts:6, 908-1079`; `e2e/webgpu-robust.spec.ts:1024-1080`; `e2e/perf.spec.ts:121-169`; `packages/core/ts/__tests__/webgpu-renderer.test.ts:107, 159-196, 519-554`; `.wdd/CONTEXT.md` (8155 B). Scratch validation (session scratchpad `w79plan/`, never in the repo; the code blocks were applied by script to copies of `c1a52ff`): Rust red `182 passed; 9 failed; 2 ignored`, green `191 passed; 0 failed; 2 ignored`, clippy and fmt clean; TS red `8 failed | 62 passed` in the four affected files, green `70 passed`, the full suite collects 697 tests in 68 files; `e2e:typecheck` clean at red and green; the demo hook type-checks; the WGSL validates with naga 30.0.1. The plan's numbers for D79-2 options A/B, the hold lengths and the tick-cost ratio come from the same copies (W79.md "Plan validation"). Not executed: Playwright, the Linux baselines and the W79.0 confirmation measurement.
