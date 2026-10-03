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
6. Unchanged: `planned → red → (human approves tests) → approved → gold → (human approves) → complete`. AI never marks a ward complete.

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
