---
ward: 54
revision: null
name: "box-shadow Compatibility under preserveBackgrounds"
epic: "theming-polish"
status: "complete"
dependencies: [42, 52, 53]
layer: "typescript"
estimated_tests: 9
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 054: box-shadow Compatibility under preserveBackgrounds

## Scope
Under `preserveBackgrounds: true` the canvas-clip rectangle is sized to the element's bounding box, which chops off any `box-shadow` that extends beyond the element's edges. After W54, the clip-hole inflates by the worst-case shadow margin per side so the shadow renders intact.

Scope is intentionally narrow:
- Outset shadows only. `inset` shadows render inside the element and do not require clip inflation.
- Compute margins via `getComputedStyle(el).boxShadow` parsing.
- Cache per-element margins on `observe()` and refresh via the existing W52 per-element `MutationObserver` (made unconditional and extended to refresh shadow on style/class mutation).

Out of scope:
- A `shadowMargin: number` escape-hatch config (mentioned as alt-(b) in r0). Decision §1 picks (a).
- Filter-based shadows (`filter: drop-shadow(...)`) — different CSS layer, handled by the browser, not subject to canvas clipping.

## Inputs
- `getComputedStyle(el).boxShadow` (single source of truth — already normalized to `rgb(r,g,b) Npx Npx Npx Npx [inset]` per shadow, comma-separated).
- Current clip-rect math in `PhantomObserver.render()` (`packages/core/ts/src/phantom-observer.ts:435-447`).
- W52 per-element `MutationObserver` infrastructure (`mutationObservers: Map<number, MutationObserver>` at line 89) — currently gated on `useComputedTheme`.
- W53's `clampClipRadius` (preserved unchanged — radius math operates on inflated rect just like it did on the bare rect).

## Outputs
- New module `packages/core/ts/src/box-shadow.ts` exporting `parseBoxShadowMargin(raw: string): ShadowMargin` and the `ShadowMargin` type (matches W42's `border-radius.ts` precedent — separately testable, dist-shipped).
- New `shadowCache: Map<number, ShadowMargin>` in `PhantomObserver`.
- `refreshElementShadow(el, id)` private method, called on observe + on existing MutationObserver fire.
- Inflated clip rect in `render()`: `roundRect(x - left, y - top, w + left + right, h + top + bottom, r)`.
- Public `LiquidDOMInstance.refreshShadow(el)` (parity with W52's `refreshTheme`; throws after destroy).
- Updated CONTEXT.md Known Limitations (remove the W54 line).
- Updated CLAUDE.md W52 paragraph to reflect that per-element MO is now unconditional (one per observed element, drives both theme AND shadow refresh).

## Decisions (locked in this spec)
1. **Inflation, not escape-hatch.** Spec r0 offered "(a) inflate clip" vs "(b) document + per-element `shadowMargin` config". We pick (a): automatic, requires zero opt-in from consumers, reuses W52's MO infrastructure. The escape-hatch model leaks an internal concept (clip math) into the public API.
2. **MutationObserver becomes unconditional.** Pre-W54, per-element MO is gated on `useComputedTheme`. After W54 we need it for shadow refresh too. Simplest path: create the MO unconditionally (one per observed element). Cost is negligible — one MO instance + one event handler closure per element, both freed on `unobserve`. The MO already filters to `attributes: ["style", "class"]` which is the right granularity for both theme and shadow.
3. **Theme branch is explicitly gated inside the new combined callback.** `refreshElementTheme` is not internally guarded on `useComputedTheme` (the existing public `refreshTheme` is). Rather than push a new guard into the private method (and change W52's behavior), the new combined MO callback gates the theme call: `if (this.useComputedTheme) this.refreshElementTheme(el, id); this.refreshElementShadow(el, id);`. This prevents a silent regression where `useComputedTheme: false` consumers start getting auto-populated `themeCache` entries.
4. **Inset shadows + negative spread: ignore for inflation.** Inset shadows render inside the element and don't escape the clip. Negative spread on outset shadows is handled algebraically by `max(0, blur + spread ± offset)` — if the result is negative, it clamps to zero (no shrinkage of the clip below the element rect).
5. **Multiple shadows: per-side max.** Each shadow contributes a margin per side; the inflate uses the largest across all shadows.
6. **Cached at observe, refreshed on style/class mutation. No per-frame parse.** Matches W42/W52 cost model.
7. **Radius unchanged after inflate.** The clip-hole is a rounded-rect with the element's original border-radius. The inflated rectangle keeps that same radius for the corner curve. Rationale: the clip-hole's corner is invisible *behind* the DOM element, which still renders its own correct corner via CSS. The inflated-rect corner only matters where the shadow falls — and shadows have soft falloff that masks any geometric difference. Scaling the radius proportionally to the inflate would distort how the visible DOM element's CSS-rendered corner relates to the cutout, which is worse than the current acceptable approximation.

## Specification

### Margin math (per shadow)
Given a single shadow with `offsetX, offsetY, blur, spread`:

| Side   | Margin                                  |
|--------|-----------------------------------------|
| left   | `max(0, blur + spread - offsetX)`       |
| right  | `max(0, blur + spread + offsetX)`       |
| top    | `max(0, blur + spread - offsetY)`       |
| bottom | `max(0, blur + spread + offsetY)`       |

For multiple shadows, take per-side max across all entries.
For `inset` shadows, skip entirely (contribute `0` to all sides).

### Parser contract
`parseBoxShadowMargin(raw: string): ShadowMargin`

**Splitting:**
Walk the string char-by-char tracking an integer `depth` initialized to 0. Increment on `(`, decrement on `)`. Split only on `,` when `depth === 0`. This is a deliberate non-allowlist approach so the parser works against any current or future CSS color function (`rgb`, `rgba`, `hsl`, `hsla`, `color`, `lab`, `oklch`, `hwb`, etc.) without enumeration.

**Per-shadow segment parsing:**
- Detect `inset` keyword anywhere in the segment (case-insensitive). If found, skip the entire segment.
- Extract numeric tokens via `/(-?\d+(?:\.\d+)?)px/g` (case-insensitive `px` suffix).
  - Relies on `getComputedStyle`'s normalization: all length values come back as `Npx` form (including zero, which becomes `0px`). Raw stylesheet input is not supported.
  - Non-`px` tokens (color, keywords) are skipped — the parser does not need to understand color syntax.
- Assign tokens in order: `[offsetX, offsetY, blur?, spread?]`. Missing `blur`/`spread` default to 0.
- If fewer than 2 px-tokens were found, treat the segment as unparseable and contribute `{0,0,0,0}` (defensive, no throw).

**Edge cases:**
- `raw === "" || raw === "none"` → `{top:0, right:0, bottom:0, left:0}`.
- `box-shadow: var(--missing)` → browser resolves to `"none"` → handled by the above.
- Per CSS spec, `box-shadow` does not accept `%` offsets — getComputedStyle will never emit them, so no special handling.

### Render integration
At `packages/core/ts/src/phantom-observer.ts:435-447`, when `clipping === true`:
```ts
const m = this.shadowCache.get(id) ?? ZERO_MARGIN;
const cx = x - m.left;
const cy = y - m.top;
const cw = w + m.left + m.right;
const ch = h + m.top + m.bottom;
const r = clampClipRadius(this.buffer[entityOffset + 8], cw, ch);
if (r > 0) {
  ctx.roundRect(cx, cy, cw, ch, r);
} else {
  ctx.rect(cx, cy, cw, ch);
}
```
`ZERO_MARGIN` is a module-level frozen `{top:0, right:0, bottom:0, left:0}`.

### MutationObserver extension
Pre-W54 (W52 code at `phantom-observer.ts:281-288`):
```ts
if (this.useComputedTheme) {
  this.refreshElementTheme(el, id);
  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(() => this.refreshElementTheme(el, id));
    mo.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
    this.mutationObservers.set(id, mo);
  }
}
```

Post-W54:
```ts
// Always cache shadow margin
this.refreshElementShadow(el, id);
// Theme cache only when opted in
if (this.useComputedTheme) {
  this.refreshElementTheme(el, id);
}
// MO is now unconditional — fires on either theme or shadow style change
if (typeof MutationObserver !== "undefined") {
  const mo = new MutationObserver(() => {
    if (this.useComputedTheme) this.refreshElementTheme(el, id);
    this.refreshElementShadow(el, id);
  });
  mo.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
  this.mutationObservers.set(id, mo);
}
```

### Public refresh entry point
- `LiquidDOMInstance.refreshShadow(el: HTMLElement): void` — symmetric with W52's `refreshTheme(el)`. Throws `Error` after `destroy()`. Used for stylesheet-cascade-driven changes the MO can't observe (e.g., ancestor `data-theme` toggling a `.btn` rule with a different `box-shadow`).

### `unobserve` cleanup
Existing `unobserve` (line 343) disconnects the per-element MO and clears `themeCache`. After W54 it must ALSO clear `shadowCache.delete(id)`. Add to the existing cleanup block.

## Tests
Tests live in `packages/core/ts/__tests__/box-shadow.test.ts` (new file). Unit tests use `parseBoxShadowMargin` directly; integration tests use a `PhantomObserver` instance with mocked `getComputedStyle`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `parseBoxShadowMargin_single_outset` | `rgb(0,0,0) 0px 8px 24px 0px` → `{top:16, right:24, bottom:32, left:24}`. Covers `(offsetX, offsetY, blur, spread)` → per-side math. |
| 2 | `parseBoxShadowMargin_multi_shadow_takes_per_side_max` | `rgb(...) 10px 0px 5px 0px, rgb(...) 0px 20px 30px 0px` → `{top:10, right:30, bottom:50, left:30}` (per-side max across shadows). Shadow A contributes right=15 (blur+offsetX=5+10), shadow B contributes right=30 (blur=30); max is 30. |
| 3 | `parseBoxShadowMargin_skips_inset_and_unparseable` | Inputs: `"rgb(...) 0px 0px 8px 0px inset, rgb(...) 0px 0px 12px 0px"` (trailing `inset`) → `{12,12,12,12}`. `"inset rgb(...) 0px 0px 8px 0px"` (leading `inset`) → `{0,0,0,0}`. `"none"` / `""` / `"garbage tokens"` → `{0,0,0,0}` (no throw). |
| 4 | `clip_rect_inflates_when_preserveBackgrounds_and_shadow_set` | `border-radius: 0`, `box-shadow: 0 8px 24px black`. Render frame with `preserveBackgrounds: true`. Spy on `ctx.rect`. Asserts: the 2nd `ctx.rect` call (1st is the outer viewport rect at line 439) has args `(x-24, y-16, w+48, h+32)`. `ctx.roundRect` is NOT called (r=0 branch). |
| 5 | `clip_rect_not_inflated_when_preserveBackgrounds_off` | Same shadow setup, but `preserveBackgrounds: false`. `ctx.clip` is NOT called. Catches Must-NOT regression. |
| 6 | `mutation_observer_refreshes_shadow_cache` | Observe element with `box-shadow: "none"`. Mutate computed style to `"rgb(0,0,0) 0px 4px 12px 0px"`. Trigger MO callback directly (deterministic via `ControllableMutationObserver`). Assert `shadowCache.get(id)` reflects new margins `{top:8, right:12, bottom:16, left:12}`. |
| 7 | `clip_rect_zero_inflation_when_no_box_shadow` | `border-radius: 0`, `box-shadow: "none"` (or unset). Render frame with `preserveBackgrounds: true`. The 2nd `ctx.rect` call has args `(x, y, w, h)` — no inflation. Catches the `?? ZERO_MARGIN` fallback path. |
| 8 | `border_radius_and_box_shadow_combine_correctly` | `border-radius: 8px`, `box-shadow: 0 8px 24px black`. Render with `preserveBackgrounds: true`. Spy on `ctx.roundRect`. Asserts args `(x-24, y-16, w+48, h+32, 8)` — inflated WH, UNCHANGED radius (Decision §7). |
| 9 | `unobserve_clears_shadow_cache_entry` | Observe element with `box-shadow: 0 4px 12px black` → `shadowCache.has(id)` is true. `unobserve(el)` → `shadowCache.has(id)` is false. Re-observe a NEW element at the same slot id → `shadowCache.get(id)` is the new element's margin (or absent if no shadow), not the prior leak. Mirrors W52's `themeCache` cleanup precedent. |

189 + 9 = **198 tests after W54** (43 Rust + 155 TS).

## Must NOT
- Inflate clip when `preserveBackgrounds` is `false` — `viewport.preserveBackgrounds === true` is the only gate. Test #5 covers this.
- Re-parse `box-shadow` per frame. Parse once on `observe()`; refresh only on MO callback.
- Parse for inset shadows. Inset shadows do NOT contribute to the inflate; the existing rect-clip already excludes the inside of the element.
- Couple Rust to box-shadow. Rust remains DOM-blind + color-blind.
- Change `clampClipRadius` math — radius is still clamped against the (now inflated) rect's smaller dimension.
- Auto-populate `themeCache` for `useComputedTheme: false` consumers via the now-unconditional MO. Decision §3's explicit gate prevents this.

## Must DO
- Cached parse on observe; refresh on the existing W52 per-element `MutationObserver` (made unconditional and extended for shadow refresh).
- Public `LiquidDOMInstance.refreshShadow(el)` API + destroy-guard (mirrors W52's `refreshTheme`).
- `unobserve` clears `shadowCache.delete(id)` (mirrors `themeCache` cleanup).
- Visual: button with `box-shadow: 0 8px 24px black` + `preserveBackgrounds: true` — shadow fully visible.
- Update CONTEXT.md Known Limitations to remove the W54 line.
- Update CLAUDE.md W52 paragraph: "per-element MutationObserver — one per observed element (W54: now unconditional, drives both theme refresh and box-shadow margin refresh; clears on unobserve)".

## Risks & Mitigations
- **R1: Paren-aware split.** `box-shadow` contains `rgb(r, g, b)` / `rgba(...)` / `color(...)` with inner commas that would break a naive `split(",")`. Mitigation: depth-counting algorithm spelled out in §"Parser contract". Test #2 input exercises this with two `rgb(...)` shadows.
- **R2: `getComputedStyle` quirks across browsers.** Browsers normalize box-shadow output slightly differently (token order, default fills). Mitigation: parser is order-tolerant — extracts only numeric `px` tokens by position, ignores everything else.
- **R3: MO becoming unconditional changes resource model.** One MO + closure per observed element regardless of `useComputedTheme`. Cost: small (MO is freed on `unobserve`). Documented in Decision §2, CLAUDE.md, and Decision §3's explicit theme-gate prevents behavior regression.
- **R4: Inflated clip-hole + viewport-edge interaction.** The outer viewport clip at line 439 is `(0,0,vw,vh)`. The inner inflated hole may extend past the viewport. With `evenodd`, the two subpaths are independent — pixels outside the viewport rect aren't rendered anyway (Canvas's implicit clip), so the union "outer XOR inner" produces the correct result inside the canvas. No special handling needed.
- **R5: jsdom can't render real shadows.** Tests assert on clip-rect arguments via `ctx.rect`/`ctx.roundRect` spies, not on rendered output. Visual verification is manual via the demo scene.
- **R6: `var(--shadow)` with missing fallback.** Browser resolves to initial value `"none"` → parser returns zero margins → no crash.

## Verification
1. Build + 198 TS tests + 43 Rust tests green, clippy clean.
2. Demo: button with `box-shadow: 0 8px 24px black` in a `preserveBackgrounds` scene. Visually confirm shadow is fully visible (no horizontal cut at canvas-rect edge).
3. `npm pack --dry-run --workspace liquiddom` shows `dist/box-shadow.{js,d.ts}` in the tarball.
