# liquiddom slice 5: drag and merge (design)

Status: brainstormed with Dennis 2026-10-11 after W77; written for review. The binding design stays `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` (the spec); this document details slice 5 inside it and lists the amendments it needs. Acceptance scene and matrix: `.wdd/NORTH-STAR.md`.

## 1. Goal and scope

"Liquids merge and separate. Dragging one element into another displaces and merges the two liquids. On release they separate and both re-form, and their labels never overlap." Scene step 5: "Drag 'Merge' into the card and release: displacement merge, separation, both re-form within **3 s**, and the labels never overlap." Matrix S5: step 5 ✅; steps 1–4, 6 and 8 stay green in both renderers.

| Ward | Content | Steps |
|---|---|---|
| W78 "Drag the liquid" | spike W78.0; the drag gesture (mouse/pen, capture, 4 px threshold, click suppression, cancel); `DRAGGED` in slot 5 and `home_dx/dy` in slots 6–7; `s ≤ 0.5` while dragged; home velocity includes the offset; no rest while dragged; the label follows the liquid (Canvas2D hides the DOM text while away) | 5 (drag away, release, crawl home) |
| W79 "Merge and separate" | neighbour softening under the dragged home; slip tuned for separation; WebGPU text drops where two elements' liquids mix; step 5 e2e in both renderers, Linux baselines, perf guard | 5 ✅ |

No whole-picture check after slice 5 (NORTH-STAR: after slices 2, 4 and 6). Gold of W79 records step 5 with vision in both renderers and updates the matrix.

**Out:** touch drag (the `touch-action` and scroll conflict belongs with slice 6 "The world"); keyboard drag (drag is decoration, not function: the DOM, focus and hit areas never move); the W77 open findings (Canvas2D stair-step edge at the 3.5 px cell, the dark landing card past the viewport edge under shake, "Book a demo" beading); per-time pointer decay (may join W78 if Dennis asks); stacking of liquid behind opaque neighbours (slice 6); owner-aware physics (separate velocity fields per element or an immiscibility term: the bake-off chose MLS-MPM for its volume-preserving displacement merge, and slip stays the separation mechanism).

## 2. What exists (2026-10-11 survey)

- **Rust:** the element buffer already has `interaction` (slot 5, `INTERACTION_DRAGGED = 3`) and `home_dx/dy` (slots 6–7). `home_rect` adds the offset, then the hover swell; `target_px` maps `rest_uv` into it. Only `HOVER` is read; `DRAGGED` and `FOCUSED` behave as idle. `Elements::damage(id, cap)` exists (splash, shake). `update_velocities` uses the DOM rect delta only, so the home spring's damping would oppose a moving home. All elements share one grid: their particles already collide and mix; slip (rate 3/s, max 160 px/s, ×s²) is the only separation mechanism.
- **TS:** the registry writes slots 5–7 as 0 at observe and only `interactionCode` (hover > focus > idle) afterwards. `homeRectInto` already applies `home_dx/dy`, so the rest contour in both renderers follows a displaced home. No drag gesture exists; `input.ts` has click and keyboard splash only.
- **Spikes (reference only, D2):** PBF moved the home anchor with the DOM still (`set_offset`) and added damage 0.35 on release; MPM softened the dragged element (cap 0.3) and neighbours within 16 px (cap 0.2), without which an overlapped stiff neighbour pushes back instead of merging. Both used pointer capture, a 6 px threshold and click suppression.

## 3. Spike W78.0 (time-boxed to half a day, throwaway, D2)

Question: with the spec model (dragged `s ≤ 0.5`, home velocity including the offset, slip separation) plus a neighbour cap under the dragged home, which caps (dragged 0.3–0.5, neighbour 0.2–0.5) and slip (rate, max) make "Merge" dragged into the card (1) merge visibly, (2) separate after release, (3) both re-form within 180 frames, (4) leave no pixel carrying both elements' WebGPU text coverage during and after the merge, and with which mechanism (§5 candidates a/b), at what cost per frame? Output: a table in `ward-078.md` with frames to rest per element, a mixing measure (particles of one element inside the other's home rect at rest), and Metal stills at mid-drag and f30/f90 after release. The answer sets the W79 constants; the code is never copied.

## 4. W78 "Drag the liquid"

**Gesture (TS, new `drag-tracker.ts`, one per instance).**
- `pointerdown` on an observed element with `pointerType` mouse or pen and the primary button; touch never drags in slice 5.
- `setPointerCapture`; the drag starts once the pointer has moved more than 4 px from the down point (spec threshold; the spikes' 6 px is not adopted). One active drag per instance: `{id, startX, startY, dx, dy}`, `dx/dy` in CSS px from the down point.
- After a drag that crossed the threshold, the next `click` on that element is swallowed once in the capture phase and the flag is cleared in the next task, so a later click splashes normally. A press that never crosses the threshold stays a click (splash).
- `pointerup` releases. `pointercancel`, window `blur`, `Escape`, `lostpointercapture`, `unobserve()`, `destroy()`, a switch to reduced motion, a detached element and a lost device cancel; cancel and release are the same in the engine.

**Slots (TS → Rust, per frame in `registry.sync()`).**
- Interaction priority: `DRAGGED (3) > hover (1) > focus (2) > idle (0)`; reduced motion → 0. The hover swell is off while dragged (Rust reads `HOVER` only).
- The dragged element's slots 6–7 = `dx, dy`; every other element 0. On release or cancel slot 5 → 0 and slots 6–7 → 0 in the same frame; the saturated home spring (3200 px/s²) gives the crawl home, with no TS glide.
- The pointer field skips the dragged element's particles (its liquid follows the home, not the pointer field).

**Engine (Rust, DOM-blind).**
- `DRAGGED` → `damage(id, 0.5)` every tick (spec §2 damage rule, unbuilt until now).
- `update_velocities` uses the home rect's delta (rect + offset), so the spring damps relative to the moving home.
- An element with slot 5 = 3 never reaches `restAlpha = 1`: rest detection treats it as moving, so the displaced rest contour is never drawn at rest. After release the existing rules (`s > 0.95`, `maxDev < 0.75 px`, `‖F − I‖ < 0.05`, 150 ms) apply against the DOM home.

**Label (Dennis 2026-10-11: it follows the liquid).**
- WebGPU: unchanged; the atlas text rides on the liquid as in slice 4.
- Canvas2D: while an element is dragged or not yet at rest after a drag, the runtime sets a class that hides its DOM glyphs (`-webkit-text-fill-color: transparent`, the `liquid-text` rule; `color`, the a11y tree and focus are untouched), refcounted per element like `liquid-text`, removed at rest, on cancel, reduced motion, forced colours, print, `unobserve` and `destroy`. Canvas2D shows no text on the dragged liquid; the halo is not set while the glyphs are hidden.

**Reduced motion:** drag is ignored (spec §2): no slot writes, no capture, the click splashes as normal (which reduced motion also gates).

## 5. W79 "Merge and separate"

- **Neighbour softening (Rust).** Every tick, each element whose home rect overlaps the dragged element's home rect (inflated by the kernel radius) gets `damage(id, cap_n)`; `cap_n` and the dragged cap come from W78.0. Overlap is computed on rects Rust already holds. After release, damage stops and `s` recovers as after a splash.
- **Separation.** Slip (non-physical, spec §2) carries particles buried in the other element's liquid home; its rate and max may be raised within the W78.0 result. Both elements re-form within 3 s (180 frames) after release.
- **Labels never overlap (Dennis 2026-10-11: displacement + fade).** The physics displaces the card's liquid and its text away from the dragged liquid. Where two elements' particles still mix, the text drops, so no pixel carries text of both elements. The mechanism is part of D79-1 and is chosen from W78.0's answer; candidates: (a) the T1 pass also accumulates the min and max element id per texel (two extra `r16float` targets with min/max blending) and the composite drops text where they differ; (b) Rust flags a particle "foreign" when its grid cell's mass is mostly another element's (a per-substep owner-mass pass), and the T1 splat gives it coverage 0 like `torn`. Canvas2D never draws liquid text and hides the dragged DOM label (W78), so its labels cannot overlap.

## 6. Verification

- **Rust:** `DRAGGED` holds `s ≤ 0.5`; home velocity includes the offset; an overlapped neighbour is softened and a non-overlapped one is not; `restAlpha < 1` while dragged; scenario test: "Merge" dragged into the card, released, both at rest within 180 frames.
- **Vitest (jsdom):** `drag-tracker` (threshold, mouse/pen only, capture, one swallowed click, cancel paths, reduced motion); `DRAGGED` beats hover in slot 5; cancel on `unobserve`/`destroy`; the Canvas2D label class lifecycle.
- **e2e, canvas2d (blocking), manual clock:** step 5 — pointerdown on "Merge", drag to the card centre, hold 30 frames, release; both `restAlpha = 1` within 180 frames; the click does not splash; the "Merge" DOM text is hidden while away and visible at rest. W79: a closed region between the two liquids mid-drag (hole pixels in their union rect, the lace-guard method).
- **e2e, webgpu-hw:** the same flow; no frame with both elements' text coverage on one pixel (through `__liquidTest`).
- **Baselines:** Linux Canvas2D step 5 mid-drag and after re-form, committed only after Dennis' vision approval (D65-7). Steps 1, 4, 6 and reduced motion must not move.
- **Perf:** frame time during the merge ≤ 1.15 × the splash frame time (W77-style ratio guard).
- **Gold (W79):** vision of step 5 in both renderers; matrix S5 step 5 ✅.

## 7. Decisions for the direction gates

| ID | Decision | Recommendation |
|---|---|---|
| D78-1 | Label during drag | follows the liquid: WebGPU atlas text as today; Canvas2D hides the DOM glyphs while dragged or not at rest after a drag (brainstorm, Dennis 2026-10-11) |
| D78-2 | Input | mouse and pen, pointer capture, 4 px threshold; no touch, no keyboard drag in slice 5 (brainstorm, Dennis 2026-10-11) |
| D78-3 | Physics approach | spec model + neighbour softening and home velocity in Rust, spike W78.0 first (brainstorm, Dennis 2026-10-11) |
| D78-4 | Interaction priority | `DRAGGED > hover > focus > idle`; swell off while dragged; pointer field skips the dragged element |
| D78-5 | Rest while dragged | never: slot 5 = 3 keeps `restAlpha < 1` |
| D78-6 | Click after drag | swallowed once in the capture phase, cleared next task |
| D79-1 | Labels never overlap | displacement + fade: foreign coverage gives text coverage 0 (brainstorm, Dennis 2026-10-11) |
| D79-2 | Neighbour caps and slip | values from W78.0 |
| D79-3 | Merge perf guard | ≤ 1.15 × splash frame time |

## 8. Spec amendments (applied with this document)

- §2 damage rules: drag also softens overlapped neighbours (W79, D79-2); `DRAGGED` never reaches `restAlpha = 1` (D78-5).
- §2 hover and focus: `DRAGGED` beats hover; no swell while dragged (D78-4).
- §2 interaction table, drag row: mouse and pen only, pointer capture, cancel paths (D78-2, D78-6).
- §4 DOM model, drag: under Canvas2D the dragged element's DOM glyphs are hidden while it is away (D78-1).
- §6 slice table row 5: wards and design document.
