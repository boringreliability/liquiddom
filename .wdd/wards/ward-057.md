---
ward: 57
revision: null
name: "Canvas Z-Index Default Fix"
epic: "theming-polish"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 3
created: "2026-05-15"
completed: "2026-05-16"
---
# Ward 057: Canvas Z-Index Default Fix

## Scope
Fix a long-standing visibility bug where the LiquidDOM canvas renders correctly but is hidden behind the body's solid background. Reproduction: open `demo/scenes/playground.html` — the canvas reports 256k+ non-zero alpha pixels in the right colors at the right positions, but the user sees only text labels on the body background. Manual hoisting of `canvas.style.zIndex = '9999'` instantly reveals the rendered blobs.

Root cause: `LiquidDOM.create({ canvasZIndex: -1 })` (the library's current default) combined with any body that has a solid `background-color` triggers CSS's negative-z-index paint-order trap. A `<canvas style="position:fixed; z-index:-1">` paints BETWEEN the root element's background and the body's box. Body's own background (painted as part of body's box, z-index: auto) then covers the canvas. This affects ALL 6 demo scenes (`main`, `dragable-cards`, `scroll-hero`, `splash-buttons`, `tilt-bowl`, `playground`) and any consumer who follows the docs/scene patterns.

The fix is a single value change: default `canvasZIndex` from `-1` to `0`. Combined with the existing `pointer-events: none` and the typical pattern of `[data-liquid] { position: relative; z-index: 1 }`, this produces a stacking order of: body bg < canvas (z=0) < liquid elements (z=1). Text remains visible on top of the blob; pointer events still pass through; preserveBackgrounds still works.

Out of scope:
- Changing the canvas mount strategy (still appendChild to body / container).
- Forcing demos to use stacking-context CSS workarounds — the library default should "just work".
- Anything in Rust — pure TS configuration default.

## Inputs
- `packages/core/ts/src/index.ts:231` — current default `canvasZIndex = -1`.
- `packages/core/ts/src/index.ts:245` — applies the value via `canvas.style.zIndex`.
- All 6 demo scenes pass `canvasZIndex: -1` explicitly (they were written to match the documented default). After the fix they should pass `canvasZIndex: 0` OR drop the option entirely.

## Outputs
- `packages/core/ts/src/index.ts:231` — default `canvasZIndex = 0`.
- 6 demo scenes updated to drop explicit `canvasZIndex: -1` (use new default).
- Existing tests still pass; one new test in `liquiddom-api.test.ts` locks the new default behavior.
- Manual smoke test: open playground without query params → see 4 blobs immediately.

## Specification

### Core change
**Edit `packages/core/ts/src/index.ts:231`:**
```ts
// BEFORE:
const canvasZIndex = options?.canvasZIndex ?? -1;
// AFTER:
const canvasZIndex = options?.canvasZIndex ?? 0;
```

That's it for core. The applied style logic at line 245 (`canvas.style.zIndex = String(canvasZIndex)`) is unchanged.

### Demo scene updates
Drop `canvasZIndex: -1` from each scene's `LiquidDOM.create({ ... })` call (the new default makes it redundant). Six files:
- `demo/main.ts:8`
- `demo/scenes/dragable-cards.ts:8`
- `demo/scenes/scroll-hero.ts:8`
- `demo/scenes/splash-buttons.ts:37`
- `demo/scenes/tilt-bowl.ts:15`
- `demo/scenes/playground.ts:117` AND `:205` (the rebuild path)

### Why `0` and not e.g. `auto`?
- `0` puts canvas in the same stacking layer as default body children, but the explicit `position: fixed` keeps it positionally where it is.
- DOM elements with `position: relative; z-index: 1` (the documented demo pattern) sit ABOVE canvas, so text reads correctly on top of the blob.
- DOM elements WITHOUT explicit z-index (just `position: static`) also sit above z=0 canvas (per CSS painting rules: positioned elements without z-index don't form stacking contexts but paint above non-positioned in-flow content; canvas is `position: fixed` though, so the comparison is between two positioned-without-z-index items — DOM elements win because they come later in document order).
- For consumers who explicitly want canvas BEHIND body bg (rare; usually means they're using a transparent body), they can still pass `canvasZIndex: -1` themselves.

### Backwards-compat note
- Existing `canvasZIndex: -1` callers continue to work as before (still hits the trap, still gets hidden — but their explicit choice, and ours to fix at the demo layer).
- Existing `canvasZIndex: 1` or higher callers see no change.
- Only `undefined`/default callers get the new behavior.

## Decisions (locked in this spec)
1. **Default `0`, not `auto` or removing the property.** `auto` would let the stacking context decide, which is unpredictable; `0` is explicit, deterministic, and aligns with default body-child behavior.
2. **Drop explicit `canvasZIndex: -1` from all 6 demo scenes** rather than changing them to `0`. The whole point is "consumer code shouldn't need to know about this" — let the default work.
3. **No CSS-stacking-context workaround in core or demos.** Forcing `body { position: relative; z-index: 0 }` would create stacking context that consumers might not want. The z-index default change is the lighter touch.
4. **No deprecation cycle.** This is a bug-fix default change in a `0.x` pre-release library. The behavior change only affects consumers who were already broken (their blobs invisible). Anyone who NEEDS z=-1 can still set it.

## Tests
All new tests in `packages/core/ts/__tests__/liquiddom-api.test.ts` (existing file). Use jsdom mock canvas; we're verifying `canvas.style.zIndex` not actual pixel visibility (that's an integration test).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `default_canvas_z_index_is_zero` | After `LiquidDOM.create()` with no `canvasZIndex` option, the canvas in `document.body` has `style.zIndex === "0"`. Locks Decision §1. |
| 2 | `explicit_canvas_z_index_minus_one_is_preserved` | After `LiquidDOM.create({ canvasZIndex: -1 })`, canvas has `style.zIndex === "-1"`. Locks backwards-compat: explicit choice still works for consumers who need it. |
| 3 | `explicit_canvas_z_index_custom_positive_is_preserved` | After `LiquidDOM.create({ canvasZIndex: 42 })`, canvas has `style.zIndex === "42"`. Locks pass-through for any positive value. |

After W57: 256 + 3 = **259 tests** (55 Rust + 204 TS).

## Must NOT
- Change the way `canvas.style.zIndex` is applied (line 245 stays).
- Change Rust code or FFI.
- Add CSS-stacking-context hacks to demo HTML.
- Break the `container` mode (canvas there is `position: absolute` inside container, z-index logic the same).
- Touch `preserveBackgrounds`, `colorSource`, or any other rendering options.

## Must DO
- All 256 existing tests continue to pass.
- After the fix, opening `demo/scenes/playground.html` shows 4 visible blobs immediately at page load (no hover, no scroll, no config change required).
- All 5 other demo scenes still work as before (verified by manual smoke).
- Tests #1-#3 are independent; running them in isolation succeeds.

## Manual Smoke Test
### Setup
```
npm run dev
```

### Steps
1. Open `http://localhost:3000/scenes/playground.html` in a fresh browser tab (clear localStorage first to avoid stale state).
   Expected: 4 blobs visible (pill, circle, rectangle, rounded card) in the configured colors WITHOUT any interaction.
2. Open `http://localhost:3000/scenes/scroll-hero.html`.
   Expected: blobs visible at page load; scroll behavior unchanged.
3. Repeat for `dragable-cards.html`, `splash-buttons.html`, `tilt-bowl.html`, and `/` (main demo).
   Expected: all show blobs.

### Pass criteria
- [ ] Playground shows 4 visible blobs at page load with NO interaction
- [ ] All other demo scenes show their blobs at page load
- [ ] DOM-element text stays readable on top of blob
- [ ] Hover/drag/impulse interactions still work in their respective scenes
- [ ] No regressions visible (rendering offsets, missing blobs, console errors)

## Verification
`npm run build && npm test && cargo test && cargo clippy` — all green, 0 clippy warnings.
- T1-T3 cover the core default + pass-through contract.
- Manual smoke test covers the actual fix (visible blobs).
- Existing 256 tests cover regressions in everything else.
