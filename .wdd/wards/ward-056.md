---
ward: 56
revision: null
name: "FreeDrop Canvas Rendering"
epic: "element-physics-extensions"
status: "complete"
dependencies: [43, 45]
layer: "typescript"
estimated_tests: 6
created: "2026-05-14"
completed: "2026-05-14"
---
# Ward 056: FreeDrop Canvas Rendering

## Scope
Make FreeDrop slots visible. W43+W44+W45 built the entire FreeDrop pipeline (spawn, lifetime, cull, splash-trigger) at the WASM-buffer level, but `PhantomObserver.render()` iterates only `idToElement` (soft-body slots) and skips every droplet. W56 extends the render loop to also iterate `dropletIds` and draw each droplet as a particle-spline blob — the same render path soft-bodies already use, just keyed by droplet id.

Pure TypeScript ward. No FFI changes, no Rust changes. The particle data Rust already writes (16 positions on a circle around the droplet center) flows through the existing spline renderer without modification.

Out of scope:
- Per-droplet color customization (W56 uses `colorDefault` for all droplets).
- Hover/focus interaction on droplets (FreeDrop has no DOM, no event source).
- Custom render shape (SDF rendering is W38).
- Soft-body render changes — the existing `idToElement` loop is preserved verbatim.

## Inputs
- W43 `dropletIds: Set<number>` tracking per-instance.
- Rust-written particle positions in `particleBuffer` at `id * PARTICLES_PER_BODY * 2` (already populated correctly for FreeDrop slots — 16 points on a circle of `slot[2]/2` around `(slot[0], slot[1])`).
- Existing spline render loop at `packages/core/ts/src/phantom-observer.ts:601-633` (Bezier midpoint quadratic curves through 16 particle positions).
- W54 `preserveBackgrounds` exclusion for FreeDrop already in place at `phantom-observer.ts:581-582` (`isFreeDrop` check skips the clip-hole).

## Outputs
- `render()` body extended: after the existing `for (const [id] of this.idToElement)` loop, add a second loop `for (const id of this.dropletIds)` that draws each droplet using the same particle-spline path.
- The two loops share the cull-check + fill helpers; W56 factors the per-id render block into a private method `renderEntityAt(ctx, id, viewport, isFreeDrop)` to avoid copy-pasting 60 lines.
- Mock-mode fallback (no `particleBuffer`): droplets draw as filled circles via `ctx.arc()` instead of `fillRect` — `(slot[0], slot[1])` is the center, `slot[2]/2` is the radius. Acceptable visual when WASM is absent.

## Decisions (locked in this spec)
1. **Two-loop render, not unified iteration.** Extending `idToElement` to include droplet ids would require keying droplets into a Map too, which leaks "this is a soft-body" semantics. Two clean loops separated by entity kind keeps the code grep-able. The shared per-id render block is extracted to `renderEntityAt` so the loops differ only in iteration source.
2. **Droplets use `colorDefault`, not `themeCache`.** FreeDrop has no DOM element → no `getComputedStyle` → no theme. The hover branch (`isHover` check) is short-circuited for FreeDrop slots: `interaction_state` (slot[4]) is unused for FreeDrop (reserved per W45 Decision §3 for future hover-on-droplet) so the check returns idle. Hover styling for droplets is intentionally out of scope.
3. **Viewport cull adapts to FreeDrop center semantics.** For soft-bodies the existing cull check uses `x + w < -m` (top-left corner + extent). For FreeDrop, `slot[0]/[1]` is the particle **center** and `slot[2]` is the diameter. Cull check for FreeDrop becomes `pos.x + r < -m || pos.x - r > vw + m` (and same for y), where `r = slot[2]/2`. **Note on TS/Rust cull asymmetry:** W45's Rust cull is purely center-based (`pos.x < vp.x - margin || pos.x > vp.x + vp.w + margin`), no radius offset. The TS render cull adds the bbox `± r` margin and is therefore more generous — a droplet whose center is just outside Rust's threshold may still render for ~1 frame before Rust deactivates it. This is intentional: Rust is the liveness truth-source; render draws whatever Rust considers active.
4. **Mock-mode draws filled circles, not rects.** Without `particleBuffer`, soft-bodies fall back to `fillRect(x, y, w, h)`. For droplets, falling back to `fillRect(x, y, diameter, diameter)` would draw the rect centered offset incorrectly (slot[0] is center, not top-left). Use `ctx.arc(slot[0], slot[1], slot[2]/2, 0, 2*Math.PI); ctx.fill()` instead. **Reachability:** mock-mode (null `particleBuffer`) only triggers when WASM imports fail at runtime — production reachability is essentially zero. T5 locks the path in for completeness.
5. **`renderEntityAt` is a private method, not a free function.** It needs access to `this.buffer`, `this.particleBuffer`, `this.themeCache`, `this.shadowCache`, `this.colorDefault`, `this.colorHover`. Passing all six as args would bloat the signature. Private method keeps the call sites clean.
6. **Skip FreeDrop slots inside the soft-body loop (defense-in-depth).** Today `idToElement` never contains droplet ids — but the extraction MOVES the `isFreeDrop` trust source from "derived from `slot[5]` at the call site" (current W54 line 581) to "passed as a caller-controlled parameter to `renderEntityAt`". The single line preserving the W54 visibility invariant — that a droplet never renders via the soft-body path with wrong center semantics — is now the soft-body loop's early-continue. The comment must call this out explicitly so a future contributor doesn't delete it as "dead defensive code". Recommended inline comment: `// W56 Decision §6 (defense-in-depth): idToElement should never contain droplet ids, but if a future code path leaks one, the droplet would render twice — once here with wrong soft-body center semantics, once correctly in the droplet loop below. The renderEntityAt(isFreeDrop=true) caller-trust contract depends on this guard.`
7. **No changes to `dropletIds` iteration order.** ES2015+ `Set` guarantees insertion order. Droplets render in spawn order. Acceptable — overlapping droplets compose via alpha blending of `colorDefault`, no z-ordering needed.

## Specification

### Refactored `render()` shape

```ts
render(
  ctx: CanvasRenderingContext2D,
  viewport?: { viewportWidth: number; viewportHeight: number; cullMargin?: number; preserveBackgrounds?: boolean },
): void {
  ctx.save();

  // Existing soft-body loop — unchanged except for the FreeDrop early-continue (Decision §6).
  for (const [id] of this.idToElement) {
    const entityOffset = id * FLOATS_PER_ENTITY;
    if (Math.round(this.buffer[entityOffset + 5]) === 6) continue; // W56 §6: never render droplet via soft-body path
    this.renderEntityAt(ctx, id, viewport, /* isFreeDrop */ false);
  }

  // W56: FreeDrop droplets — iterate dropletIds after soft-bodies.
  for (const id of this.dropletIds) {
    this.renderEntityAt(ctx, id, viewport, /* isFreeDrop */ true);
  }

  ctx.restore();
}
```

### `renderEntityAt` private method (extracted from current loop body)

Reads slot[0..4], applies cull check (kind-specific math), sets fill color, optionally clip-holes the rect (soft-body only — Decision §3 + existing W54 `isFreeDrop` skip), writes the particle spline or mock-mode fallback.

```ts
private renderEntityAt(
  ctx: CanvasRenderingContext2D,
  id: number,
  viewport: RenderViewport | undefined,
  isFreeDrop: boolean,
): void {
  const entityOffset = id * FLOATS_PER_ENTITY;
  const x = this.buffer[entityOffset];
  const y = this.buffer[entityOffset + 1];
  const w = this.buffer[entityOffset + 2];
  const h = this.buffer[entityOffset + 3];

  // Inactive slot (W43 skip-condition); also catches Rust-culled droplets.
  if (w === 0 || h === 0) return;

  // Viewport cull — kind-specific because FreeDrop's slot[0..3] semantics differ.
  if (viewport) {
    const m = viewport.cullMargin ?? 0;
    if (isFreeDrop) {
      const r = w * 0.5; // diameter / 2
      if (x + r < -m || y + r < -m || x - r > viewport.viewportWidth + m || y - r > viewport.viewportHeight + m) return;
    } else {
      if (x + w < -m || y + h < -m || x > viewport.viewportWidth + m || y > viewport.viewportHeight + m) return;
    }
  }

  // Fill style: droplets use colorDefault (no theme, no hover). Soft-bodies match current behavior.
  if (isFreeDrop) {
    ctx.fillStyle = this.colorDefault;
  } else {
    const isHover = this.buffer[entityOffset + 4] === 1.0;
    const baseColor = this.themeCache.get(id) ?? this.colorDefault;
    ctx.fillStyle = isHover ? this.colorHover : baseColor;
  }

  // Clip-hole — soft-bodies only (FreeDrop has no DOM behind it; W43 §9).
  // Math here is identical to the current render() body.
  const clipping = viewport?.preserveBackgrounds === true && !isFreeDrop;
  if (clipping) { /* …existing W53/W54 clip block, unchanged… */ }

  // Particle spline OR mock-mode fallback.
  if (this.particleBuffer) {
    // …existing spline render, unchanged…
  } else if (isFreeDrop) {
    // W56 §4: draw filled circle in mock mode.
    const r = w * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h); // existing soft-body mock-mode fallback
  }

  if (clipping) ctx.restore();
}
```

### `RenderViewport` type
A module-private type alias (NOT exported), shared by both `render()`'s public signature AND `renderEntityAt()`'s parameter. Reviewer flagged mixing inline anonymous + named alias as a style drift — r2 unifies both call sites on the alias. No public API impact (the alias is structurally identical to the inline shape that callers already use).

```ts
type RenderViewport = {
  viewportWidth: number;
  viewportHeight: number;
  cullMargin?: number;
  preserveBackgrounds?: boolean;
};

// Public:
render(ctx: CanvasRenderingContext2D, viewport?: RenderViewport): void;
// Private:
private renderEntityAt(
  ctx: CanvasRenderingContext2D,
  id: number,
  viewport: RenderViewport | undefined,
  isFreeDrop: boolean,
): void;
```

## Tests
New tests in `packages/core/ts/__tests__/free-drop.test.ts` (extending the existing W43/W45 file). The render code is exercised via fake `CanvasRenderingContext2D` spies (matching the W52/W53/W54 test pattern).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `render_draws_spline_for_each_droplet` | Spawn 3 droplets, populate `particleBuffer` directly with 16 positions per droplet. Call `render(ctx)`. Spy verifies: 3 separate `ctx.beginPath()` + `ctx.fill()` pairs (one per droplet). For each droplet, exactly 16 `quadraticCurveTo` calls. Soft-body entities (if any) render in their own pass. |
| 2 | `render_skips_inactive_droplet_slots` | Spawn 2 droplets. Manually zero `buffer[off+2]` for droplet 0 (simulates Rust cull or pending despawn). Call `render(ctx)`. Spy verifies: only 1 `ctx.fill()` invocation (for droplet 1). |
| 3 | `render_droplet_uses_colorDefault_ignores_hover` | Construct observer with explicit `colorDefault: "rgb(1,1,1)"` and `colorHover: "rgb(2,2,2)"`. Spawn 1 droplet. Manually set `buffer[off+4] = 1` (hover state — shouldn't apply to droplets). Call `render(ctx)`. Spy on `ctx.fillStyle` SETTER (vitest mock-style getter/setter): verify the LAST assignment before `ctx.fill()` was `"rgb(1,1,1)"`, AND that `"rgb(2,2,2)"` never appears in the setter's call list during the droplet pass. Order-dependent assertion — reviewer caught that "final-state" check would pass even with a buggy droplet branch that overwrites hover back to default. |
| 4 | `render_droplet_viewport_cull_uses_center_semantics` | Viewport 100×100, margin 0. Spawn droplets at: (a) `(-20, 50)` radius 5 → off-screen left edge (x+r=-15 < -0) → culled; (b) `(-3, 50)` radius 5 → straddles left edge (x+r=2 > -0) → rendered. Spy verifies only the straddling one fires `fill`. |
| 5 | `render_droplet_mock_mode_draws_arc_not_rect` | Construct `PhantomObserver` without `particleView` (null particle buffer). Spawn 1 droplet at `(100, 100)` diameter 8. Call `render(ctx)`. Spy verifies `ctx.arc(100, 100, 4, 0, 2π)` was called and `ctx.fillRect` was NOT called. |
| 6 | `render_droplet_not_clipped_under_preserveBackgrounds` | `preserveBackgrounds: true`. Spawn 1 droplet. Call `render(ctx)`. Spy verifies `ctx.clip` was NOT called for the droplet's render block (i.e., no save/clip/restore pair around the fill). Locks W43 Decision §9 invariant — droplets must not be clip-holed since they have no DOM behind them. |
| 7 | `render_soft_body_unaffected_by_W56_extraction` | Visual regression invariant for the 60-line extraction. Observe 1 soft-body with no droplets. Populate `particleBuffer` with 16 known positions for slot 0. Call `render(ctx)`. Spy asserts exact call counts: `ctx.beginPath` × 1, `ctx.quadraticCurveTo` × 16, `ctx.closePath` × 1, `ctx.fill` × 1, outer `ctx.save` × 1, outer `ctx.restore` × 1, NO inner save/restore (no clipping). Locks the post-extraction soft-body render path against accidental imbalance (stray `ctx.save` left behind during refactor would inflate the count). |

After W56: 225 + 7 = **232 tests** (52 Rust + 180 TS).

## Must NOT
- Render droplets inside the soft-body loop (Decision §6 — defensive early-continue if slot[5]=6 leaks into `idToElement`).
- Apply hover/focus styling to droplets (Decision §2).
- Run the `preserveBackgrounds` clip-hole block for droplets (already excluded by W43 §9 / W54 `isFreeDrop` check; preserved in extracted method).
- Modify the Rust particle-write code — W56 is render-only.
- Change `dropletIds` iteration order semantics (Set insertion-order preserved).
- Add a new public render mode or option — droplets render unconditionally when present.

## Must DO
- Existing soft-body render produces identical pixels (visual regression invariant — verified by all W22/W42/W52/W53/W54 tests continuing to pass).
- FreeDrop slots produce one spline-fill per droplet at each frame they're active.
- Mock-mode (no `particleBuffer`) renders droplets as visible filled circles, not zero-size rects.
- `renderEntityAt` is the single render-block entry point for both kinds; future render changes touch one method, not two.

## Manual Smoke Test

### Setup
```bash
npm run build && npm run dev
```

### Steps
1. Open `demo/index.html` in a browser.
2. In DevTools console: `instance.spawnDroplet({ x: 400, y: 100, vx: 50, vy: 0 })`.
   Expected: a small blob appears at (400, 100) and drifts rightward at ~50 px/s.
3. Spawn ~10 droplets in quick succession at different positions.
   Expected: all visible as blobs, each tracking its own velocity.
4. Trigger a hard impulse on an observed soft-body with `splash` config:
   `instance.impulse(el, { magnitude: 100, direction: [0, -1], splash: { threshold: 0, count: 8, jitter: 30 } })`.
   Expected: 8 droplets fly upward off the element's perimeter with jitter, visible as small blobs.
5. Wait ~5 seconds.
   Expected: droplets disappear as their lifetime expires (W45 auto-cull).

### Pass criteria
- [ ] At least one droplet is visibly drawn after step 2.
- [ ] Splash droplets (step 4) emerge from the element's edges, not its center.
- [ ] Droplets disappear automatically after ~5 seconds (W45 working).
- [ ] No new console errors or warnings.

## Verification
1. `npm run verify` — 52 Rust + 179 TS = 231 tests pass, 0 clippy warnings.
2. Manual smoke test above passes — primary visible signal that W56 closed the W43+W44+W45 visibility gap.
3. Visual regression: existing `demo/scenes/*.html` scenes (no droplets) render identically to pre-W56.
