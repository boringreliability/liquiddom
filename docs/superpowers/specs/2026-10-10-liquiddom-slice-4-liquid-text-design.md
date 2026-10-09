# liquiddom slice 4: liquid text (design)

Status: brainstormed with Dennis 2026-10-09/10 after a time-boxed spike; written for review. The binding design stays `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` (the spec); this document details slice 4 inside it and lists the amendments it needs. Acceptance scene and matrix: `.wdd/NORTH-STAR.md`.

## 1. Goal and scope

"The text is liquid too. While an element moves, its text stretches and tears with its own liquid (WebGPU). At rest the real DOM text is shown, pixel-exact." Matrix S4: step 3 "✅ W with text", step 8 "+ forced-colors ✅"; steps 1, 2, 4, 6 stay green. Canvas2D never gets liquid text (spec §3).

| Ward | Content | Steps |
|---|---|---|
| W74 "Text that flows" | F in Rust, text atlas, T1 text pass, `liquid-text` toggle with fail-safe, `device.lost` removes the class, the splash "ghost pill" | 3 with text (W) |
| W75 "Text that stays true" | per-element MutationObserver, atlas re-render triggers (fonts, DPR), colour auto-refresh, `refresh()` and a11y under WebGPU, forced-colors/print with `liquid-text` active, Canvas2D halo | 8 + forced-colors |
| W76 whole-picture after slice 4 | first check in both renderers (W69 template) | all |

Out (unchanged): drag/merge (slice 5); scroll, resize, parking, gravity, adapters, site (slice 6); icons, images and SVG stay DOM (atlas v1 = text nodes); WebGPU compute; liquid above the DOM.

## 2. Spike W74.0 (2026-10-09, throwaway, D2)

Question: does F-warped atlas text look like text that stretches and tears with the liquid at 8000 particles, is F stable, what does it cost? **Answer: yes, with changes.** Text bends in arcs, shears into streaks in the outflow and vanishes exactly where the liquid tears; pointer sweeps slant it locally; readable in shake and hover, not in a hard splash core (f6–f24), as expected.

- Cost per fixed step (Node, release wasm, seed 1, 4×600 frames, splash/splash/shake): F off 3.41 / p95 3.83 ms; F every substep 3.66 / 4.09 ms (+0.25 ms); every 2nd substep 3.55 / 3.90 ms. Browser: text-pass JS cost lost in noise (4.81 vs 4.89 ms/frame, 60 fps); GPU time not measured.
- Stability: 0 non-finite, 0 det ≤ 0; det ∈ [0.28, 16.6]; σ within [0.2, 5]; at most 242 particles (3 %) torn at once.
- Atlas vs DOM at F = I with T1 at 1× DPR: pixel-identical (MAE 5e-6). T1 at T0's 0.5× is visibly blurred.
- Transition: no positional jump; a small "sharpness snap" after a hard splash because F lags the positions when `restAlpha` reaches 1.
- Kernel 0.6× gives white specks at tear edges (Σw too low); the liquid's kernel works. F⁻¹ norm clamp 2 and 4 are visually identical.
- Seen, to handle: a small text smear under a pointer resting over the card; the pre-existing pale "ghost pill" (rest overlay at falling `restAlpha`) inside a splash hole, more visible with text.
Evidence: session scratchpad `w74-spike/` (stills, GIF, numbers, `spike.patch` reference only).

## 3. W74 "Text that flows"

**Rust (render-only F, `src/fluid/`).** In G2P every substep: `F ← (I + dt·C)·F`, then slip `F ← F + dt·SLIP_RATE·s²·(I − F)`; closed-form 2×2 SVD clamp `σ ∈ [0.2, 5]`, det < 0 flipped to the nearest rotation; no allocation; F never enters the stress. `torn` (FLAG_TORN) is sticky: set when a singular value hits the clamp, cleared only when σ ∈ [0.67, 1.5]. Rest gains a third condition: per element `max‖F − I‖ < 0.05` alongside `s > 0.95` and `maxDev < 0.75 px` (computed in the same pass as `maxDev`); re-form stays within 3 s (measured). The FFI is unchanged (`f00..f11`, `flags` already in the dynamic view).

**Text atlas (`renderers/webgpu/text-atlas.ts`).** Per observed element: walk text nodes, line boxes from `Range.getClientRects()`, computed style (font, weight, size, letter/word spacing, text-transform, colour), `OffscreenCanvas` `fillText` word by word at the current DPR, no re-wrapping. One atlas texture for all elements, shelf-packed, gutter 10 px; `ElementPaint.atlasRect` filled. jsdom has no `OffscreenCanvas`: the atlas builder takes an injectable canvas factory (a fake in tests).

**GPU.** The particle buffer grows from `x, y` to `x, y, f00, f01, f10, f11, flags` (32 B/particle, ≈ 256 KB/frame at 8000); `rest_u, rest_v` upload only on a generation change (like `home`). A separate text pass at 1× backing writes `T1 rgba16float` (Σw·text_rgba_premul) and `T1w r16float` (Σw) — separate because all attachments of one render pass share a size and T0 is at `t0Scale`. Only particles of elements with `restAlpha < 1` splat text, with the liquid's kernel, `uv = rest_uv + diag(1/w_rest, 1/h_rest)·F⁻¹·(frag − x_p)`, `‖F⁻¹‖` clamped to 2, coverage 0 when torn, `|det F| < ε` or `uv ∉ [0,1]²`. Screen order: liquid composite → rest SDF overlay → text composite (`T1 / T1w`, in the text colour), so the text never blinks at the cross-fade. **T2 is dropped.**

**`liquid-text` toggle (runtime, never the renderer).** Per frame: an element gets `liquid-text` (DOM text `color: transparent`) when the active renderer is WebGPU, its atlas entry is ready and its `restAlpha < 1`; otherwise the class is removed. Refcounted like `liquid-element` (shared elements across instances). **Fail-safe:** removed under Canvas2D, reduced motion, a missing/failed atlas, `device.lost` (the rebuild removes it on every element) and `destroy()`; the DOM text can never be invisible without the atlas text in its place.

**Ghost pill.** The pale rest-SDF overlay inside a splash hole is investigated in W74 (why `restAlpha` is still > 0 there) and removed; the fix is a W74 decision.

## 4. W75 "Text that stays true"

- **Per-element MutationObserver:** `childList`, `characterData`, `subtree`, attributes `style` and `class`; class mutations are compared with liquiddom's own classes (`liquid-element`, `liquid-text`, `liquid-halo`) removed, so W74's toggle cannot loop; mutations coalesce to one re-snapshot/re-render per frame.
- **Colour auto-refresh** (D66-12's promise): on a style/class mutation the colours are re-snapshotted with `refresh()`'s method (class lifted, `transition: none`), plus once more on `transitionend` for `background-color`/`color`.
- **Atlas re-render triggers:** text mutations, `document.fonts` `loadingdone`, DPR/zoom change (`matchMedia` resolution listener plus the resize path).
- **forced-colors and print:** the CSS already neutralises both classes in those media; tests with `liquid-text` active (mid-splash, then emulate forced-colors/print live → DOM text visible at once).
- **`refresh()` and a11y under WebGPU:** axe 0 violations, focus ring above the liquid (`webgpu-hw`), `refresh()` mid-motion updates liquid and text colour.
- **Canvas2D halo:** `liquid-halo` class, Canvas2D only, while the element moves (`restAlpha < 1`): `text-shadow` in the element's own background colour through one rule per element in the refcounted stylesheet (`data-liquid-id`), no inline style (D66-3). Not under WebGPU (the text rides its liquid).

## 5. Verification

Rust: every F finite with det > 0 after the stress sequence (splash, shake, pointer); torn hysteresis; rest needs `‖F − I‖ < 0.05` and re-form stays ≤ 3 s; F-cost benchmark (every vs every 2nd substep). jsdom: atlas packing via the fake canvas seam; toggle logic incl. every fail-safe path; MutationObserver filtering and coalescing; colour refresh incl. `transitionend`; Canvas2D halo. e2e `webgpu-hw` (Metal, local; W71.0 fallback B): text visible in the text colour mid-splash, DOM text and no class at rest, no blink at the transition, `device.lost` removes the class, live forced-colors/print, axe and focus ring. e2e canvas2d (blocking in CI): `liquid-text` never set, halo only while moving, lace guard and baselines untouched. Gold per ward: Metal stills at the same frames, vision. W76: recording in both renderers, vision, per-step status against S4, carried table, perf, recommendation; slice 5 is planned only afterwards.

## 6. Decisions for the direction gates

| ID | Decision | Recommendation |
|---|---|---|
| D74-1 | F update rate | every substep (+0.25 ms); every 2nd only if the perf budget breaks |
| D74-2 | Rest needs F ≈ I | per element `max‖F − I‖ < 0.05`; re-form measured against 3 s |
| D74-3 | torn hysteresis | set at the clamp, clear at σ ∈ [0.67, 1.5] |
| D74-4 | Text pass | T1 + T1w at 1× DPR in its own pass; the liquid's kernel; F⁻¹ clamp 2; text composite after the SDF; T2 dropped |
| D74-5 | Atlas | `getClientRects` + word-wise `fillText` at DPR, one shelf-packed atlas, gutter 10 px, text nodes only |
| D74-6 | `liquid-text` toggle | refcounted; fail-safe (set only with a ready atlas under WebGPU) |
| D74-7 | Ghost pill | fixed in W74; cause investigated in W74.0 |
| D75-1 | MutationObserver | per element, ignores own classes, coalesced per frame |
| D75-2 | Colour refresh | on mutation and on `transitionend` |
| D75-3 | Canvas2D halo | `liquid-halo` with `text-shadow` in the background colour, Canvas2D only, while moving |
| D76-1 | Whole picture | both renderers, W69 template |

## 7. Spec amendments (applied with this document)

- §2 "T-1000 re-form / Per-element rest state": `restAlpha` also needs `max‖F − I‖ < 0.05` (D74-2).
- §2 "Deformation gradient F": torn is sticky with hysteresis (clear at σ ∈ [0.67, 1.5]) (D74-3).
- §3 "WebGPU": T1 (+ T1w) at 1× DPR in its own pass; the text composite after the rest SDF; T2 dropped (D74-4).
- §3 "Liquid text: the formula": `‖F⁻¹‖` clamp 2; gutter 10 px (D74-4/5).
- §6 slice table row 4 and §7 open point "F every substep" (decided in W74, D74-1).
