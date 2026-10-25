# liquiddom shadows (Epic 16, W88): design

Agreed with Dennis in a brainstorm on 2026-10-24 (saga dec_c7b5f5d4, dec_1b99e860). It opens Epic 16 "Liquid look": renderer work on top of the finished fluid engine (Epic 15). The W88 direction gate turns the choices below into `D88-x` decisions.

## 1. Intent

An observed element keeps its own CSS `box-shadow`, and the shadow follows the liquid. A drop shadow sags and stretches with a splash, and a glow wraps the liquid when it sloshes, drags and merges. Today liquiddom throws the shadow away: the stylesheet sets `box-shadow: none !important` on every `.liquid-element`, so `box-shadow: 0 0 24px cyan` on a button simply vanishes once it is observed.

There is no new API. The author writes CSS, and liquiddom honours it. An element without an outer shadow costs nothing.

The work serves two further goals:
- The dark site gets the luminous look W86 had to do without.
- A soft shadow under moving liquid gives the text above it a backdrop. This helps the open text-over-liquid findings of `.wdd/memory/whole-picture/slice-6.md`, but it is not the goal of this ward.

## 2. The hybrid model

The browser draws the shadow at rest, and the renderer draws it while the liquid is away.

- **At rest.** The element's liquid is exactly its box, so the browser's own `box-shadow` is right and pixel-exact, and it costs nothing. `box-shadow: none` leaves the `.liquid-element` rule.
- **In motion.** While an element's liquid is away (`restAlpha < 1`, or the element is dragged), the runtime sets the new class `liquid-shadow-away` (`box-shadow: none !important`). The renderer then draws the element's outer shadow layers from the liquid's shape.
- **Toggle lifecycle.** The class follows the lifecycle of `liquid-away` and the halo:
  - It is refcounted per element across instances.
  - It is removed at once under reduced motion, and on `unobserve`, `destroy`, a stopped instance and a lost device.
  - It sits in the same `@layer liquiddom` and the same `@media screen and (forced-colors: none)` scope, so print and forced colours show the element's own shadow as today.
- **Handoff.** When `restAlpha` reaches 1, the class goes and the browser's shadow takes over. In that frame the renderer draws the shadow from liquid shaped exactly like the box, so the difference should be small. Spike Q3 measures how visible it is.
- **Inset.** Inset shadows show at rest, because the browser draws them. In motion they hide with the rest, and the renderer draws outer layers only. This is truer to the author's CSS than hiding inset always, and it needs no per-element filtering rule.

## 3. Snapshot

`snapshotShadow(el)` reads the computed `box-shadow`. Browsers normalise it to a list of layers such as `rgba(0, 0, 0, 0.4) 0px 8px 20px 0px` with an optional `inset`, and `none` when there is no shadow.

- Each layer parses into `{ color: RGBA, dx, dy, blur, spread, inset }` in CSS px. Colours go through `parseCssColor`, including the W86 colour probe, so oklch works.
- The renderer receives the outer layers only, at most 4 per element. More layers draw the first 4, which is documented.
- The snapshot runs where and when the colour snapshot runs:
  - at `observe`;
  - on W75's triggers: the element's own `class`/`style` change, and `transitionend` (now also for `box-shadow`);
  - on `refresh(el)`.
- A snapshot taken while the element carries `liquid-shadow-away` lifts that class first, the way the colour snapshot lifts `liquid-element`.
- Each element's paint in `RenderFrame` gains `shadows: readonly ShadowLayer[]`. The renderer scales them by the DPR.

## 4. Renderers

Shared rules:
- Only elements whose liquid is away and that have outer shadows cost anything.
- Every shadow is drawn **before** all liquid. A shadow never lies on top of another element's liquid, and two merged liquids share their shadows naturally. (CSS lets a later element's shadow fall on an earlier one; for liquid that would read as a dark stain.)
- Parked (W81) and inactive elements draw no shadow.
- Knockout: an element's shadow is masked by its own liquid coverage, so holes and tears in the liquid show the page (amended at the W88 gate, 2026-10-25, D88-10).
- In container mode the container's canvas clips the shadow, like the liquid.

**Canvas2D.**
1. For each element in motion with shadows, splat its particles into a small alpha mask. The mask covers the element's particle bounds at the density grid's cell size.
2. Draw the mask once per layer with `shadowColor`, `shadowBlur` and `shadowOffsetX/Y` set. The mask itself sits off-screen and the offset compensates, so only the shadow lands. Canvas blur has the same semantics as CSS blur.
3. Spread dilates the mask: draw it shifted by `spread` px in 8 directions.
4. Draw the density image on top, as today.
5. Spread layers with blur 0 get a `shadowBlur` floor of one density cell (amended at the W88 gate, 2026-10-25, D88-12). The renderer scales `shadowBlur` and the offsets by the DPR (amended at the W88 gate, 2026-10-25, D88-14).

**WebGPU.**
1. A shadow pass splats the elements in motion into a half-resolution shadow target. Each particle carries its layer's colour and offset, and spread widens the splat.
2. A separable gaussian blur runs in two directions.
3. Blur radii vary per layer, so layers are grouped per distinct exact radius, at half resolution (quarter resolution for blur ≥ 32 px) and scissored. The buckets 4, 8, 16, 32 and 64 px are used only as overflow past about 6 distinct radii per frame (amended at the W88 gate, 2026-10-25, D88-6).
   Pass structure: one density splat per element, the offset applied in the resolve, one resolve pass per radius group (amended at the W88 gate, 2026-10-25, D88-11).
4. The screen pass composites the shadows under the liquid; the liquid composite blends OVER (amended at the W88 gate, 2026-10-25, D88-13).

Everything the shadows need is already in the particle record and the element buffers. Rust and the FFI are untouched.

## 5. Modes and edge cases

| Mode | Behaviour |
|---|---|
| Reduced motion | The liquid never leaves rest, so the browser's shadow shows throughout and the renderer draws none. |
| Print, forced colours | Unchanged: the toggle class is screen-scoped. |
| Lost WebGPU device | The class clears. The Canvas2D rebuild keeps drawing shadows. |
| Stopped instance | The class clears. |
| Colour or shadow change | Follows W75's triggers, extended to `box-shadow`. A `:hover` shadow change without a transition needs `refresh(el)`, as colours do. |

## 6. Scope

- **In:** outer shadows with up to 4 layers (offset, blur, spread, colour), the hybrid toggle, both renderers, a new scene, the site's glow, and the docs.
- **Out:**
  - inset shadows in motion;
  - borders and outlines (still hidden while observed);
  - an option to switch shadows off (YAGNI until cost proves a problem);
  - CSS `filter: drop-shadow()`;
  - per-corner radii.

## 7. Scene, site and docs

- **Scene.** A new `demo/scenes/shadows.html` holds elements with a drop shadow, a multi-layer glow, a spread shadow and an inset shadow. It exposes a hook `window.__shadows` with the scene's `restAlpha` and pixel read-backs.
- **Site.** The Deep-water hero pills and drops get a CSS glow, now that it follows the liquid. The docs pages `getting-started.md` and `limitations.md`, which say box-shadows are not drawn, are corrected.
- **Acceptance scene.** It is unchanged and has no `box-shadow`, so no Linux baseline moves. The demo landing's faint card shadow (`0 1px 2px`) becomes visible at rest; that page has no baseline.

## 8. Tests

- **vitest:**
  - the parser: computed strings with several layers, `inset`, `none`, oklch colours, and the 4-layer cap;
  - the snapshot triggers;
  - the toggle's lifecycle and refcount;
  - the stylesheet rules;
  - Canvas2D: shadows before liquid, through the fake canvas recording `shadow*`;
  - WebGPU: the shadow pass and the radius buckets, through the fake GPU.
- **e2e:**
  - at rest, a shadow outside the element on a page screenshot;
  - mid-splash, the shadow follows the liquid;
  - after the handoff, no gap and no double shadow;
  - both renderers (WebGPU locally on Metal).
- **Vision** at gold. No baseline moves.

## 9. Spike W88.0

Time-boxed, with the code thrown away:
- **Q1.** What does Canvas2D's per-element mask cost with 1 to 3 layers, and how many elements in motion can a page carry?
- **Q2.** What does the WebGPU blur cost, and how do radius buckets look against an exact blur?
- **Q3.** How visible is the handoff from the renderer's shadow to the browser's, in both renderers? Checked with vision.

Answered by spike W88.0 (see ward-088.md); decisions D88-1…14.
