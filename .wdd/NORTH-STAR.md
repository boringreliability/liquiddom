# North Star — liquiddom

> *"WASM/WGPU-driven **fluid dynamics** on web elements via hidden canvas, preserving a11y"* (`.wdd/PROJECT.md`)

This file is **canonical** for the vision, the acceptance scene and the slice matrix. The design spec ([2026-10-02-liquiddom-fluid-design.md](../docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md)) and [PROJECT.md](PROJECT.md) link here. The scene steps and the matrix are kept identical to spec §6. Change both in the same commit, or `packages/core/__tests__/wdd-docs.test.ts` fails.

This is a playground, not a product. There is no launch and no go/no-go. Progress is measured against the scene below, slice by slice, never by ward count.

## Experiences
What a person sees and feels. Every ward moves at least one of these closer, or says why it moves none.

- **The elements are liquid.** Buttons and cards on an ordinary page are made of liquid. At rest they look exactly like themselves: crisp edges, their own colour, the real DOM text.
- **A click splashes.** Clicking a button bursts it into jets and fingers of liquid at the pointer. Enter or Space on a focused button splashes it from its centre.
- **It always re-forms (T-1000).** However hard it was splashed or shaken, the liquid crawls home and re-forms the element: a button within 1.5 s of a splash, everything within 3 s of a shake.
- **The pointer is felt, not punched.** Moving the pointer over the liquid raises a soft bulge that follows the pointer's motion. It never leaves a hole.
- **Liquids merge and separate.** Dragging one element into another displaces and merges the two liquids. On release they separate and both re-form, and their labels never overlap.
- **The text is liquid too.** While an element moves, its text stretches and tears with its own liquid (WebGPU). At rest the real DOM text is shown, pixel-exact.
- **A shake sloshes everything.** A shake sets every element sloshing at once, and everything comes back.
- **Nothing is lost for accessibility.** The DOM stays the source of truth for semantics, focus and hit areas. The focus ring is always drawn above the liquid, the canvas is `aria-hidden`, and the keyboard can splash.
- **Calm when asked.** Under reduced motion the liquid holds still: crisp, at rest, DOM text visible. Forced colours and print switch the liquid off.
- **It follows the page.** On scroll and resize the liquid follows its elements without snapping.
- **It is a playground.** Viscosity, cohesion and recovery are sliders; water, honey and jelly are presets.

**Not the north star:** a launch, WebGPU compute (spec D3), liquid flying above the DOM (D7), rendered borders or shadows (D8), liquid icons or images, WebGL2.

## Acceptance scene

### Page
`demo/scenes/acceptance.html`: three buttons ("Splash", "Split", "Merge"), a card with a heading and two lines of text, a fixed `seed`, and a fixed viewport of 1280×800 in Playwright. Playwright projects: `canvas2d` (always blocking) and `webgpu` (soft until 10 green runs in a row). Scene parameters arrive in W65: `?seed`, `?renderer`, `?clock=manual`, `?rm`, `?test=1`.

### Scene steps
1. Idle for 2 s: crisp edges and the DOM text visible at rest.
2. Pointer sweep: soft bulge, no holes.
3. Click "Splash": jets and fingers. **[WebGPU]** the text tears with the liquid. Re-form within **1.5 s** (`restAlpha = 1`).
4. Tab + Enter on "Split": the same splash at the centre. The focus ring is visible throughout.
5. Drag "Merge" into the card and release: displacement merge, separation, both re-form within **3 s**, and the labels never overlap.
6. Shake: everything sloshes and re-forms within **3 s**.
7. Scroll 300 px and back: the liquid follows with no snap.
8. Reduced motion / forced colours / Canvas2D project / `device.lost`: each behaves as in §4.

### Slice matrix
✅ = must pass, ⏳ = not expected yet, W/C = per renderer project (WebGPU / Canvas2D).

| Step | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| 1 Idle | ✅ C (roundRect + DOM text) | ✅ C | ✅ W+C | ✅ | ✅ | ✅ |
| 2 Pointer | ⏳ | ✅ C | ✅ W+C | ✅ | ✅ | ✅ |
| 3 Splash | ⏳ | ✅ C (no text) | ✅ W+C (no text) | ✅ W with text | ✅ | ✅ |
| 4 Keyboard | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 Drag/merge | ⏳ | ⏳ | ⏳ | ⏳ | ✅ | ✅ |
| 6 Shake | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 Scroll | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✅ |
| 8 Modes | reduced-motion + print ✅ | ✅ | + device.lost ✅ | + forced-colors ✅ | ✅ | ✅ |

## Slices and wards

| Slice | Name | Wards | Scene steps it turns ✅ |
|---|---|---|---|
| 1 | Liquid at rest | W63 north star + WDD rules · W64 liquid at rest · W65 verification harness · W66 public API swap + soft-body retirement | 1 (C), 8 (reduced motion + print) |
| 2 | Liquid that reacts | W67 splash and shake · W68 pointer, hover and material · W69 playground + whole-picture check | 2, 3 (C, no text), 4, 6 |
| 3 | WebGPU liquid | planned after the slice-2 whole-picture check | 1–3 in W, `device.lost` |
| 4 | Liquid text | planned later | 3 with text, forced colours |
| 5 | Drag and merge | planned later | 5 |
| 6 | The world | planned later | 7, adapters, site |

## How wards use this file
1. Every ward spec has a line `North star: <scene steps this ward moves>` directly under its title.
2. **Vertical slices.** Every ward ends in something visible in the acceptance scene. No "data structures first" wards.
3. **Direction gate before `red`.** Each technique, architecture or scope choice is a `### D<NN>-<k>` item in the ward's `## Decisions`. Present it to Dennis in chat as a named decision with its consequence. Record it with `saga_record_decision`, write `Decision: APPROVED YYYY-MM-DD — <choice> (saga dec_…)`, and add a row to *Plan decisions* below. A ward cannot move to `red` while any line says `Decision: PENDING`.
4. **Whole-picture checks** (below). The next slice is planned only after one.
5. **Spikes** are time-boxed and answer one question. Their code never becomes production code.
6. Unchanged: `planned → red → (human approves tests) → approved → gold → (human approves) → complete`. AI never decides on its own that a ward is complete: it stops at `gold` and waits for Dennis' approval. Once Dennis has approved gold, AI may run `wdd complete`.

## Whole-picture checks

| After | Ward | What is recorded | Where |
|---|---|---|---|
| Slice 2 | W69 | The acceptance scene, steps 1–4, 6 and 8, recorded with the RAF clock in canvas2d only (no WebGPU fluid renderer exists before slice 3), plus status per scene step against the matrix | `.wdd/memory/whole-picture/slice-2.md`, `docs/superpowers/whole-picture/slice-2-canvas2d.gif` |
| Slice 4 | (planned later) | Every renderer that exists at that point (canvas2d and webgpu) | `.wdd/memory/whole-picture/slice-4.md` |
| Slice 6 | (planned later) | Every renderer, all 8 steps | `.wdd/memory/whole-picture/slice-6.md` |

The recording is inspected with vision before the status is written. Each status is ✅, ⏳ or ❌ per step, measured against that slice's column.

## Decision log

### Design decisions (spec §0)

Rows are copied verbatim from the spec; 'this spec' and § references mean the design spec.

| # | Decision | Saga |
|---|---|---|
| D1 | Goal: play with real fluid simulation. No launch | `dec_4a8a1817` |
| D2 | Solver: MLS-MPM. It won a bake-off against PBF + shape matching (branches `spike/fluid-mpm`, `spike/fluid-pbf`). The production solver is **re-implemented under test, with the spike as reference**. Spike code is not copied | `dec_83e8c8fd` |
| D3 | Physics stays in Rust/WASM on the CPU. WebGPU compute is rejected and needs a separate decision to come back | `dec_f9d25477` |
| D4 | The soft-body engine is retired. Its last state is tagged `softbody-final` (`515f54d`) | `dec_f9d25477` |
| D5 | The text is liquid while the element is moving. **At rest the real DOM text is shown.** a11y is carried by the DOM semantics | `dec_83e8c8fd` + this revision |
| D6 | Rendering: WebGPU, with a simple Canvas2D fallback that has no liquid text | this spec |
| D7 | The canvas sits **below** observed elements (stacking defined in §4). Focus rings stay visible | this spec |
| D8 | Border and box-shadow on observed elements are **dropped visually** in v1. This is an accepted loss | this spec |

### Plan decisions (direction gates)

| # | Decision | Ward | Saga |
|---|---|---|---|
| D63-1 | Fluid ward files are hand-created flat `ward-063…069.md`; bare ids; `.wdd/reviews/.gitkeep` | W63 | dec_e6607da2 |
| D63-2 | Epic 15 hand-created as `15-fluid-engine.md` with its Goal | W63 | dec_855f5b43 |
| D63-3 | Epic 14's unbuilt wards 63–68 dropped; numbers reused | W63 | dec_ba0f700a |
| D63-4 | Slice 2 re-sliced: W67 splash and shake, W68 pointer, hover and material | W63 | dec_e3b8a07c |
| D63-5 | Spec amendments: 6963d7d (B2/B14/versioning) plus residuals | W63 | dec_c0218e5d |
| D63-6 | Direction gate enforced by `wdd-docs.test.ts` | W63 | dec_98e30762 |
| D64-1 | Cell size and density budget | W64 | dec_63b2ee30 |
| D64-2 | Interim binary restAlpha | W64 | dec_a755108e |
| D64-3 | Stable progressive redistribution | W64 | dec_006a27f1 |
| D64-4 | Full FFI surface now | W64 | dec_1a50aec1 |
| D64-5 | A null 2d context rejects create | W64 | dec_23485a8f |
| D64-6 | Reduced-motion detection, the matchMedia change listener and set_reduced_motion land here | W64 | dec_7ba30333 |
| D64-7 | The bridge class is named FluidBridge | W64 | dec_cf8b4244 |
| D64-8 | The internal entry is runtime.ts | W64 | dec_9a1f9037 |
| D64-9 | Interim scene CSS | W64 | dec_fce07c35 |
| D64-10 | Type files, names and defaults | W64 | dec_ec4c5ce2 |
| D64-11 | Canvas2D renderer | W64 | dec_961e6084 |
| D64-12 | World and margin | W64 | dec_7447fa0f |
| D64-13 | At-rest physics in W64 | W64 | dec_38532b3a |
| D64-14 | Canvas resize and DPR | W64 | dec_4016ae3d |
| D64-15 | copy-wasm rewrite | W64 | dec_622c0bd6 |
| D64-16 | Cargo profiles | W64 | dec_bc44838f |
| D64-17 | RenderFrame shape | W64 | dec_d6ad5a80 |
| D64-18 | Registry contract | W64 | dec_c732986e |
| D65-1 | Manual FrameClock via @internal clock option; scene ?clock=manual | W65 | dec_f400307b |
| D65-2 | Snapshot path, Linux-only baselines, vite :4173 --strictPort with BROWSER=none | W65 | dec_1b435f00 |
| D65-3 | CI e2e job in pinned image; canvas2d blocking, webgpu/perf soft | W65 | dec_e9d448f0 |
| D65-4 | Print spec fixme until W66 | W65 | dec_82109335 |
| D65-5 | WebGPU project: new headless + SwiftShader, smoke only, soft until 10 green | W65 | dec_fb1d2378 |
| D65-6 | @playwright/test 1.63.0 exact = image tag; yaml devDependency | W65 | dec_ee08361e |
| D65-7 | Baselines via Docker linux/amd64 now, workflow_dispatch later | W65 | dec_736206f7 |
| D65-8 | Perf recording non-blocking; no baseline file in W65 | W65 | dec_0ef7fed4 |
| D65-9 | opt-level 3 vs "s" by measurement, decided at gold | W65 | dec_facdf083 |
| D65-10 | Multi-instance stress page (1 instantiation, 1 memory, 50 reloads) | W65 | dec_5e69c474 |
| D65-11 | window.__liquidTest contract; [data-liquid] in DOM order | W65 | dec_dd763d4e |
| D66-1 | Removed and unknown options throw TypeError naming the replacement; whitelist keeps testBackend/loader/clock as @internal | W66 | dec_49026e5f |
| D66-2 | renderer auto = Canvas2D until slice 3; webgpu = infra-only clear plus one warn | W66 | dec_a6c048ad |
| D66-3 | Stacking via data-liquid-stack attribute, decided once at observe() | W66 | dec_a225efa1 |
| D66-4 | Adapter element options are flat props viscosity/recovery, captured at first attach | W66 | dec_9942525f |
| D66-5 | Old getters/types removed with full mapping; internal runtimeOf WeakMap for scenes | W66 | dec_9e687208 |
| D66-6 | Capacity bounds: particles [256, 65536], maxElements [1, 256] | W66 | dec_20f0ebc2 |
| D66-7 | Default seed is a random u32 | W66 | dec_85afadab |
| D66-8 | validateMaterial lands in W66 (viscosity/cohesion [0, 1], recovery [0.2, 3] s) | W66 | dec_b90481c1 |
| D66-9 | Versioning 0.3.0-alpha.0 to alpha.1 via changeset pre alpha; core build cleans dist and tsbuildinfo | W66 | dec_91b80476 |
| D66-10 | RangeError beyond maxElements, warn-and-skip for auto-observe, throw after destroy | W66 | dec_e82c98e2 |
| D66-11 | Type-level absence checked by root tsc fixture api-migration-types | W66 | dec_3a584830 |
| D66-12 | Known regressions documented: no colour auto-refresh until slice 4; separate pause sources | W66 | dec_8393ca6e |
| D66-13 | Area hint comes from autoObserve candidates | W66 | dec_4189fd3e |
| D66-14 | Resolved options carry a full Material | W66 | dec_1e47c536 |
| D66-15 | Injected CSS in @layer liquiddom with !important; AMENDED 2026-10-04: paint/stacking rules scoped to screen and forced-colors: none instead of revert-layer (reverted to the UA default in print; was dec_2911ef26); two axe passes | W66 | dec_d05913c9 |
