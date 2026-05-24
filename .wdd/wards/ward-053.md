---
ward: 53
revision: null
name: "Border-Radius Clip in preserveBackgrounds"
epic: "theming-polish"
status: "complete"
dependencies: [42]
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 053: Border-Radius Clip in preserveBackgrounds

## Scope
Close the documented limitation from `CONTEXT.md`: when `preserveBackgrounds: true`, the canvas clip cuts out a rectangular hole around the element regardless of CSS `border-radius`. For pill/circular buttons this causes visible particle leak in the corners. W53 uses the resolved border-radius (slot[8], established by W42) to construct a rounded-rect clip hole, eliminating the leak.

Canvas2D-only for this ward. WebGPU clip (mentioned in the original stub) is deferred to a follow-up under Epic 10 — there is no WebGPU renderer yet to update.

## Revision history
- **r1**: initial fleshed-out spec.
- **r2** (this revision): spec-review surfaced 3 must-fix + 2 should-fix + 2 design decisions. Resolved as follows:
  - **Polyfill cut.** `ctx.roundRect` is universally available (Chrome 99+ / Apr 2022, Firefox 113+ / May 2023, Safari 16+ / Sep 2022). As of 2026-05 the polyfill would be permanent dead code. Declared browser-support floor: native `roundRect` required. Test #5 removed; `drawRoundedRect` helper deleted; `estimated_tests` 5 → 4.
  - **Test #1 assertion form** made concrete: explicit `toHaveBeenCalledWith(0, 0, vw, vh)` + `not.toHaveBeenCalledWith(x, y, w, h)` pattern spelled out.
  - **Test #5 removed** (was the polyfill assertion, no longer applicable).
  - **Playground enablement moved to Must DO**: `preserveBackgrounds: true` must be set in `DEFAULT_INIT` in `demo/scenes/playground.ts` so the fix is visible out-of-the-box when loading the playground URL.
  - CONTEXT.md test-count row updated: `158 (43 Rust + 115 TS)`.
- **r3** (this revision): r2 review verified all 7 r1 items fixed. Two minor should-fix items addressed:
  - Test #3 was all-negative — added `expect(fakeCtx.fill).toHaveBeenCalled()` anchor so it doesn't pass vacuously if `render()` bails early for an unrelated reason.
  - Test #1 added `expect(fakeCtx.clip).toHaveBeenCalledWith("evenodd")` assertion to close the gap that the clip-rule application was not directly verified.
  - Fake ctx factory description clarified: `moveTo`/`lineTo`/`arcTo`/`bezierCurveTo` are spies on the renderer's particle-path methods to avoid undefined-method errors, NOT to be asserted in the clip tests.
- **r4** (red→gold audit-trail): red-phase test review found that `render()`'s viewport parameter type declared `cullMargin: number` as required. The new W53 tests omit it (passing `{ preserveBackgrounds, viewportWidth, viewportHeight }` only), causing `tsc --noEmit` to reject the test file. Fixed by making `cullMargin?: number` optional with `?? 0` fallback in `render()`. Behavior preserved — existing callers (`index.ts` always passes `cullMargin: 100`) are unaffected, and the fallback only triggers when omitted, where `0` matches "no extra margin" semantics. Out of original W53 scope but justified for executability; logged here for audit.

## Pre-conditions
- Run `npm test` before starting; baseline MUST be 154 tests (43 Rust + 111 TS). If different, reconcile.

## Inputs
- Resolved border-radius read from `buffer[id * FLOATS_PER_ENTITY + 8]` (written by W42 on observe and on resize)
- Existing `preserveBackgrounds` clip code path in `PhantomObserver.render()` at `ts/src/phantom-observer.ts` (search for `clipping = viewport?.preserveBackgrounds === true`) — currently:
  ```ts
  const clipping = viewport?.preserveBackgrounds === true;
  if (clipping) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    ctx.rect(x, y, w, h);   // ← the rectangular hole this ward replaces
    ctx.clip("evenodd");
  }
  ```
- Native `ctx.roundRect` (browser-support floor declared above)

## Outputs
- `PhantomObserver.render()` clip path uses `ctx.roundRect` when the entity's slot[8] is > 0; plain `ctx.rect` when slot[8] ≤ 0 (no perf change for the common rectangle case).
- Per-entity radius clamped at the clip site via a file-local helper (TS layer holds the unclamped pixel value; clamp here is defensive — Rust already clamps for body geometry, but the buffer keeps the raw value).
- Updated `demo/scenes/playground.ts` — `DEFAULT_INIT.preserveBackgrounds = true` so the fix is visible immediately on the playground page (pill, circle, rounded card all stop leaking in corners).
- Updated `CONTEXT.md` Known Limitations + Architecture Decisions + Key Metrics.

## Specification

### 1. Clip path construction
At the existing clip site in `PhantomObserver.render()`, replace the second `ctx.rect(x, y, w, h)` call with a conditional:

```ts
const r = clampClipRadius(this.buffer[entityOffset + 8], w, h);
if (r > 0) {
  ctx.roundRect(x, y, w, h, r);
} else {
  ctx.rect(x, y, w, h);
}
```

Where `clampClipRadius` is a file-local pure function in the same file:

```ts
function clampClipRadius(r: number, w: number, h: number): number {
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, Math.min(w, h) / 2);
}
```

The `if (r > 0)` branch and `ctx.roundRect` are inline at the call site — no helper wrapper is added (the entire native call is one line; introducing `drawRoundedRect` would only make sense for the polyfill, which is cut).

### 2. r = 0 fast path
When `clampClipRadius` returns 0 (rectangle / unset / invalid radius), the implementation MUST call `ctx.rect(x, y, w, h)` — NOT `ctx.roundRect(x, y, w, h, 0)`. Two reasons:
1. **No perf change for the common case** (most observed elements have border-radius: 0).
2. **Test #2 verifies** `ctx.roundRect` is NOT called when r === 0, catching a buggy implementation that always uses `roundRect`.

### 3. preserveBackgrounds: false unchanged
The clip block is gated by `viewport?.preserveBackgrounds === true`. When false, neither `rect` nor `roundRect` is called from this code path. Test #3 verifies this.

### 4. Clamp semantics
`clampClipRadius`:
- `r ≤ 0` or non-finite (NaN, Infinity, negative) → 0 (fall through to plain rect)
- `r > min(w, h) / 2` → `min(w, h) / 2` (clamp; matches Rust's body-init clamp per W42 §4 step 1)
- Otherwise → `r` unchanged

Negative `r` cannot occur in practice (W42's `parseBorderRadius` clamps negatives to 0 before writing to the buffer), but the guard is defensive. Cost is two comparisons on entities with `r === 0` — the early return means no `Math.min` call for the common path.

### 5. Browser-support floor
`ctx.roundRect` is required. No polyfill. Documented in the published README (W51) and in this spec. Browsers below the floor will throw on the `roundRect` call when `preserveBackgrounds: true` is enabled with a rounded element. Acceptable trade-off given universal availability in 2026.

### 6. Playground demo enablement
Modify `demo/scenes/playground.ts:22-26` so `DEFAULT_INIT.preserveBackgrounds` is `true` (changed from `false`):

```ts
const DEFAULT_INIT = {
  capacity: 64,
  forceReducedMotion: false,
  preserveBackgrounds: true,   // ← was false
};
```

The playground page already has rounded elements (pill, circle, rounded card per W49 §6). After this change, loading `demo/scenes/playground.html` immediately demonstrates the W53 fix — no toggle or extra step required.

The `localStorage` saved-state can still override this default (W49 §8 priority chain), so existing users with persisted state are unaffected; only new visitors / users who clear state see the W53 default.

### 7. Documentation updates
- `CONTEXT.md` Known Limitations: REMOVE the line:
  > `preserveBackgrounds: true` clips to rectangular element rect only — border-radius not matched (planned for W53)
- `CONTEXT.md` Architecture Decisions: APPEND:
  `| Rounded-rect clip in preserveBackgrounds | Uses native ctx.roundRect (browser floor: Chrome 99+/FF 113+/Safari 16+); clamps to min(w,h)/2 defensively; r=0 falls through to plain rect for perf | W53 |`
- `CONTEXT.md` Key Metrics: APPEND (do NOT modify prior rows):
  `| Total tests | 158 (43 Rust + 115 TS) | W53 |`

## Tests

All tests in `ts/__tests__/border-radius-clip.test.ts` (new file). Strategy: pass a hand-rolled fake `ctx` with `vi.fn()` spy methods directly to `PhantomObserver.render()` — jsdom's native canvas is too thin, but the renderer's only contact with the canvas is via the `ctx` object, so a fake works perfectly.

**Test patterns**:
- **Fake ctx factory**: returns an object with `vi.fn()` spies for every method `render()` calls (save, restore, beginPath, moveTo, lineTo, arcTo, bezierCurveTo, rect, roundRect, clip, fill) plus assignable `fillStyle`. Note: `moveTo`/`lineTo`/`arcTo`/`bezierCurveTo` are present to avoid undefined-method errors when the renderer draws particle paths — they are NOT asserted in the W53 clip tests, only `rect`, `roundRect`, `clip`, and `fill` are.
- **`@vitest-environment jsdom`** directive (matches existing pattern).
- All tests use a single observed element via `observer.observe(mockedEl)`, then write a specific value to `buffer[id * FLOATS_PER_ENTITY + 8]` to control the test radius.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `clip_uses_roundRect_when_radius_present` | After `observer.observe(el)` then `buffer[id*9 + 8] = 10`, call `render(fakeCtx, { preserveBackgrounds: true, viewportWidth: 800, viewportHeight: 600 })`. Assertions: `expect(fakeCtx.roundRect).toHaveBeenCalledWith(x, y, w, h, 10)` AND `expect(fakeCtx.rect).toHaveBeenCalledWith(0, 0, 800, 600)` (the viewport rect) AND `expect(fakeCtx.rect).not.toHaveBeenCalledWith(x, y, w, h)` (the element rect was REPLACED by roundRect) AND `expect(fakeCtx.clip).toHaveBeenCalledWith("evenodd")` (clip rule applied). |
| 2 | `clip_uses_rect_when_radius_zero` | After `observer.observe(el)` (slot[8] remains 0), `preserveBackgrounds: true`. Assertions: `expect(fakeCtx.rect).toHaveBeenCalledWith(x, y, w, h)` (element rect via plain rect path) AND `expect(fakeCtx.roundRect).not.toHaveBeenCalled()`. |
| 3 | `clip_skipped_when_preserveBackgrounds_false` | After `observer.observe(el)`, `buffer[id*9 + 8] = 10`, call render with `preserveBackgrounds: false`. Assertions: `expect(fakeCtx.rect).not.toHaveBeenCalledWith(x, y, w, h)` AND `expect(fakeCtx.rect).not.toHaveBeenCalledWith(0, 0, 800, 600)` AND `expect(fakeCtx.roundRect).not.toHaveBeenCalled()` AND `expect(fakeCtx.fill).toHaveBeenCalled()` (positive anchor — proves render reached the particle-draw path; without this, all-negative assertions could pass vacuously). |
| 4 | `clip_radius_clamped_to_half_min_dim` | Observe element with `w=100, h=50`. Write `buffer[id*9 + 8] = 999`. `preserveBackgrounds: true`. Assertion: `expect(fakeCtx.roundRect).toHaveBeenCalledWith(x, y, 100, 50, 25)` (radius clamped to `min(100, 50) / 2 = 25`, NOT 999). |

## Must NOT
- Change behavior when `preserveBackgrounds: false`.
- Change the rectangle path when slot[8] ≤ 0 (no perf regression for the common case).
- Trust the unclamped slot[8] value blindly — must clamp at the clip site for defense (Rust clamps for body geometry, but TS-side clip is a separate code path with its own correctness contract).
- Add a `roundRect` polyfill — declared browser-support floor is Chrome 99+/FF 113+/Safari 16+ (universal as of 2026).
- Modify the FFI buffer layout (slot[8] semantics established by W42; this ward only reads).
- Touch Rust or WASM.
- Add WebGPU clip code (deferred to Epic 10).

## Must DO
- Implement `clampClipRadius` as a file-local pure function in `ts/src/phantom-observer.ts`.
- Replace the second `ctx.rect(x, y, w, h)` in the clipping block (currently around line 355) with the conditional `ctx.roundRect` / `ctx.rect` per Spec §1.
- Modify `demo/scenes/playground.ts:22-26` so `DEFAULT_INIT.preserveBackgrounds = true` — makes the fix visible immediately on the playground page.
- Update `CONTEXT.md` per §7: remove old Known Limitation line, append decision row, append metrics row.
- Verify `npm test` reports 158 after implementation (154 + 4).

## Verification
- `npm test` — 158 tests green (154 + 4 new), 0 clippy warnings (Rust untouched), 0 TS errors.
- `npm run build` — full build clean.
- Manual: open `demo/scenes/playground.html` (after `npm run build:wasm && npm run dev`) — the pill, circle, and rounded card show NO particle leak in their corners. The plain rectangle still clips correctly. Compare against pre-W53 commit to see the difference.
- `git grep -nE 'ctx\.rect\(x, y, w, h\)' ts/src/phantom-observer.ts` should return ZERO hits inside the `clipping` block (the call is replaced by the helper / conditional).
