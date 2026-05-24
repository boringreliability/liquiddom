---
ward: 52
revision: null
name: "CSS Computed Background Reflection"
epic: "theming-polish"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 9
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 052: CSS Computed Background Reflection

## Scope
Today the LiquidDOM blob color is a single global value (`colorDefault` from config). Real-world buttons have brand colors — pink confirm, gray cancel, accent CTA — and a one-size-fits-all blob breaks the host site's palette. W52 introduces an opt-in `colorSource: 'computed'` mode: per-element computed `background-color` is read on observe and written to a per-entity theme cache; the renderer uses that color for the entity's blob. A shared `MutationObserver` invalidates the cache on `style` / `class` changes, and an explicit `instance.refreshTheme(el)` is exposed for manual triggers.

Backwards compat is preserved: the default `colorSource: 'config'` keeps the current behavior bit-for-bit.

Hover color remains globally configured (`colorHover`) for v1 — per-element hover variants are out of scope. Gradient parsing (`background-image: linear-gradient(...)`) is out of scope for v1; only solid `background-color` is read.

## Revision history
- **r1**: initial fleshed-out spec.
- **r2** (this revision): addresses spec-review findings (3 must-fix + 4 should-fix + 3 nice-to-have).
  - **W42 mock reference fix**: r1 cited "W47's ControllableResizeObserver" but the pattern is in W42 (`ts/__tests__/border-radius.test.ts:16-32`). Updated.
  - **MutationObserver mock skeleton spelled out** in §10 with concrete code, plus explicit `beforeAll` discipline (mock installed BEFORE `PhantomObserver` is constructed).
  - **Test #5 design corrected**: dropped the misleading "re-observe to verify cache cleared" path. Direct assertion: `mockMutationObserver.unobserve` was called once with `el` after `unobserve(el)`.
  - **Two new tests added**: test #6 (hover color stays global in computed mode), test #7 (`refreshTheme` public API + throws on destroyed instance). Test count 5 → 7.
  - `parseComputedColor` 3-arg `rgb()` form clarified as intentional fall-through (regex requires 4-arg for alpha check).
  - SSR guard (`typeof MutationObserver !== "undefined"`) elevated to Must DO.
  - Stylesheet-driven theme switches (e.g. `<html data-theme="dark">` cascading rule swap) documented as a Known Limitation in CONTEXT.md — MutationObserver on the observed element doesn't fire for ancestor-attribute-driven CSS rule changes.
- **r3**: r2 review surfaced one architectural issue — `MutationObserver` has no `unobserve(el)` method (unlike `ResizeObserver`). The r1/r2 "shared MutationObserver" pattern was unimplementable as written. Switched to **one MutationObserver per observed element** (`Map<number, MutationObserver>`), so per-element cleanup is just `mo.disconnect()`. Memory overhead is negligible (one tiny browser-internal object per observed element; ~tens of bytes each). Test #5 now asserts `disconnect()` was called, not `unobserve()`. Mock renamed accordingly. Also added: `beforeEach` reset code shown explicitly, and test #7 extended with a no-op assertion for `refreshTheme` called in `'config'` mode.
- **r4** (this revision): red-phase test review surfaced 2 must-fix + 2 should-fix.
  - **Test #7 split into 3 separate `it` blocks** (7a computed-refresh, 7b config-noop, 7c destroyed-throws). Sequentially-coupled assertions in one `async it` meant a partial gold impl could silently skip the destroyed-throw assertion. Test count 7 → 9.
  - **`LiquidDOM.create` now forwards `colorSource`**: added `useComputedTheme: options?.colorSource === "computed"` to the `PhantomObserver` constructor call. Without this, test #7a would have passed vacuously after partial gold impl.
  - **Test #5 cache-leak guard**: added a render-revert assertion after `unobserve` — verifies the themeCache entry was cleared, not just that MO was disconnected. Cache-leak bug class now covered.
  - **Test #3 `try/finally` cleanup**: each iteration's `restore()` runs even if the body throws. Prevents stale `getComputedStyle` mock leaking into subsequent iterations.
  - CONTEXT.md row updated: `167 (43 Rust + 124 TS)` (was 165 / 122).

## Pre-conditions
- Run `npm test` before starting; baseline MUST be 158 tests (43 Rust + 115 TS). If different, reconcile.

## Inputs
- `getComputedStyle(el).backgroundColor` browser API
- `MutationObserver` browser API
- `PhantomObserver` already maintains `idToElement: Map<number, HTMLElement>` and a shared `ResizeObserver` (W42 pattern) — reuse the per-element registry shape
- W42's `getComputedStyle` integration in `observe()` — extend the same call site rather than introducing a new one

## Outputs
- New optional `LiquidOptions.colorSource: 'config' | 'computed'` (default `'config'`)
- New method `LiquidDOMInstance.refreshTheme(el: HTMLElement): void` — re-reads the element's computed bg-color and updates the cache; no-op if `colorSource !== 'computed'` or if element is not observed
- New private `themeCache: Map<number, string>` on `PhantomObserver` — keyed by entity id, stores the resolved per-element default color (hover stays global)
- New `mutationObservers: Map<number, MutationObserver>` on `PhantomObserver` — one observer per observed element (necessary because `MutationObserver` has no per-target `unobserve` method, only `disconnect()` which disconnects everything). Each observer watches `style` + `class` attributes on its element; invalidates cache + re-reads on change. Memory overhead: tens of bytes per observed entity.
- Updated `render()` clip block: `fillStyle` resolves from `themeCache.get(id) ?? this.colorDefault` for base, `this.colorHover` for hover (unchanged)
- New file-local pure helper `parseComputedColor(raw: string | null): string | null` — handles `transparent`, `rgba(_,_,_,0)`, empty, and the invalid-CSS-fallback shape `getComputedStyle` returns in jsdom
- Updated `CLAUDE.md` colour pipeline section + `CONTEXT.md` decisions/metrics

## Specification

### 1. API surface

`LiquidOptions` adds one optional field:
```ts
export interface LiquidOptions {
  // ... existing ...
  /** When 'computed', each observed element's bg-color is read on observe + on style/class changes. Default 'config'. */
  colorSource?: 'config' | 'computed';
}
```

`LiquidDOMInstance` adds one method:
```ts
/** Re-read computed bg-color for an observed element; no-op if colorSource !== 'computed' or element not observed. */
refreshTheme(el: HTMLElement): void;
```

### 2. Color resolution helper

File-local in `phantom-observer.ts`:
```ts
function parseComputedColor(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "transparent" || trimmed === "initial" || trimmed === "inherit") {
    return null;
  }
  // rgba(_, _, _, 0) — transparent via alpha
  const m = trimmed.match(/^rgba?\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)\s*\)$/i);
  if (m && parseFloat(m[1]!) === 0) return null;
  return trimmed;
}
```

Returns `null` for "no usable color" (caller falls back to `colorDefault`). Returns the trimmed raw value otherwise — Canvas2D accepts any valid CSS color string directly, so no further normalization is needed.

Note: the regex requires the **4-arg `rgba(...)` form** to extract alpha. The 3-arg `rgb(r, g, b)` form does NOT match the regex and falls through to the return statement — this is intentional (no alpha == fully opaque, so no transparency check needed). CSS4 space-separated form `rgb(r g b / a)` is not matched either; modern browsers and jsdom normalize to comma form before this code runs. A future jsdom version changing normalization would be a known v1 limitation.

### 3. PhantomObserver wiring

Constructor stores new fields:
```ts
private themeCache: Map<number, string> = new Map();
private mutationObservers: Map<number, MutationObserver> = new Map();
private readonly useComputedTheme: boolean;
```

`PhantomObserverOptions` gains:
```ts
useComputedTheme?: boolean; // wired from LiquidDOM.create's colorSource === 'computed'
```

Constructor sets `this.useComputedTheme = options?.useComputedTheme === true`. The `Map` is always constructed (empty); individual `MutationObserver` instances are constructed lazily in `observe()` when `useComputedTheme === true` AND `typeof MutationObserver !== "undefined"`.

In `observe(el)`, after writing slot[8] (existing W42 code):
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

Each per-element observer closes over `el` and `id` — the callback knows exactly which entity to refresh without iterating the mutation records or doing a Map lookup. Simpler than a shared observer; equally correct.

Where `refreshElementTheme` is a private method:
```ts
private refreshElementTheme(el: HTMLElement, id: number): void {
  if (typeof window === "undefined") return;
  const raw = window.getComputedStyle(el).backgroundColor;
  const resolved = parseComputedColor(raw);
  if (resolved === null) {
    this.themeCache.delete(id);   // explicit removal so reads fall through to colorDefault
  } else {
    this.themeCache.set(id, resolved);
  }
}
```

In `unobserve(el)` (after the existing event-listener + slot-zero cleanup):
```ts
if (this.useComputedTheme) {
  const mo = this.mutationObservers.get(id);
  if (mo) {
    mo.disconnect();
    this.mutationObservers.delete(id);
  }
  this.themeCache.delete(id);
}
```

In `unobserveAll()` / on destroy, the per-element loop already calls `unobserve(el)` for each id, so the per-element `mo.disconnect()` fires naturally — no extra cleanup needed.

Public method:
```ts
refreshTheme(el: HTMLElement): void {
  if (!this.useComputedTheme) return;
  const id = this.elementToId.get(el);
  if (id === undefined) return;
  this.refreshElementTheme(el, id);
}
```

### 4. Renderer integration

The existing line in `render()`:
```ts
ctx.fillStyle = isHover ? this.colorHover : this.colorDefault;
```

Becomes:
```ts
const baseColor = this.themeCache.get(id) ?? this.colorDefault;
ctx.fillStyle = isHover ? this.colorHover : baseColor;
```

Hover color stays global in v1. When `colorSource === 'config'`, `themeCache` is always empty (no `useComputedTheme` flag means nothing writes to it), so the lookup always falls through — bit-for-bit backwards compat.

### 5. LiquidDOM.create wiring

`LiquidDOM.create()` passes `useComputedTheme: options.colorSource === 'computed'` to `PhantomObserver`. The new `refreshTheme` instance method forwards to `observer.refreshTheme(el)`. Throws if instance is destroyed (matches `setPhysicsConfig` / `observe` pattern).

### 6. Backwards compat
- Default `colorSource: 'config'` (or omitted) → no `MutationObserver` constructed, no computed reads, no themeCache writes. Existing tests pass unchanged.
- `colorDefault` / `colorHover` config still works in both modes — they're the fallback when an element's computed color is unparseable / transparent.

### 7. v1 limitations (documented)
- `background-image: linear-gradient(...)` not parsed; only solid `background-color`.
- Per-element hover colors not supported; global `colorHover` applies in both modes.
- `currentColor` / CSS variables: `getComputedStyle` resolves these, but the resolved form may still be unusable (`currentColor` resolves to the inherited color, which is usually fine; CSS vars resolve to their value or empty string).
- No throttling: rapid `style` attribute changes trigger a re-read per mutation. Acceptable for v1 — real-world theme switches are rare events.

### 8. Documentation updates
- `CLAUDE.md`: append a new section after the React adapter section:
  ```
  ### Computed-theme color source (Ward 052)

  Opt-in via `LiquidOptions.colorSource: 'computed'` (default `'config'` preserves
  legacy behavior). Each observed element's `getComputedStyle(...).backgroundColor`
  is resolved on `observe()` and on `style` / `class` mutations (via a shared
  `MutationObserver`). The resolved color is used as the blob's base fill;
  hover state continues to use the global `colorHover` for v1. Transparent or
  unparseable values fall back to `colorDefault`. Call `instance.refreshTheme(el)`
  to trigger a manual re-read.
  ```
- `CONTEXT.md` Architecture Decisions: APPEND `| Per-element computed-bg theme via colorSource: 'computed' | Opt-in (default 'config' preserves bit-for-bit); shared MutationObserver on style/class; gradient + per-element hover + stylesheet-cascade deferred to v2 | W52 |`
- `CONTEXT.md` Key Metrics: APPEND `| Total tests | 167 (43 Rust + 124 TS) | W52 |`
- `CONTEXT.md` Known Limitations: APPEND three lines:
  > `colorSource: 'computed'` reads `background-color` only — `background-image: linear-gradient(...)` falls back to `colorDefault` (W52 v1 limitation, gradients deferred to v2)
  > `colorSource: 'computed'` uses global `colorHover` for all hover states — per-element hover variants deferred to v2
  > `colorSource: 'computed'` MutationObserver fires on the observed element's `style`/`class` attribute changes only — ancestor-driven CSS rule swaps (e.g. `<html data-theme="dark">` toggling a `.btn { background: ... }` rule) do NOT trigger automatic refresh; call `instance.refreshTheme(el)` after the theme switch

## Tests

All in `ts/__tests__/computed-theme.test.ts` (new file). Same fake-ctx pattern as W53 tests (renderer is the verification surface).

### ControllableMutationObserver mock (required for tests #4, #5, #7)

Install at module scope BEFORE any `PhantomObserver` is constructed — `new MutationObserver(...)` resolves `globalThis.MutationObserver` at construction time. Pattern is shaped like W42's `ControllableResizeObserver` (`ts/__tests__/border-radius.test.ts:16-32`) but tracks `disconnect()` instead of `unobserve()` (real `MutationObserver` has no `unobserve`):

```ts
type MutRecord = Pick<MutationRecord, "target" | "type" | "attributeName">;
class ControllableMutationObserver {
  private cb: (mutations: MutRecord[], obs: MutationObserver) => void;
  /** All instances created since the last beforeEach reset. */
  static instances: ControllableMutationObserver[] = [];
  /** Per-instance: tracks which element this observer was attached to. */
  observedEl: Element | null = null;
  /** Per-instance: tracks whether disconnect() has been called. */
  disconnected = false;

  constructor(cb: (mutations: MutRecord[]) => void) {
    this.cb = cb;
    ControllableMutationObserver.instances.push(this);
  }
  observe(el: Element, _opts?: MutationObserverInit) {
    this.observedEl = el;
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): MutRecord[] {
    return [];
  }
  trigger(mutations: MutRecord[]) {
    if (!this.disconnected) this.cb(mutations, this as unknown as MutationObserver);
  }
}

beforeAll(() => {
  globalThis.MutationObserver = ControllableMutationObserver as unknown as typeof MutationObserver;
});

beforeEach(() => {
  ControllableMutationObserver.instances = [];
});
```

Helper for tests: `const moFor = (el: HTMLElement) => ControllableMutationObserver.instances.find(o => o.observedEl === el)`.

### Mocking `getComputedStyle`

`Object.defineProperty(window, "getComputedStyle", { value: vi.fn(...), writable: true })` lets each test set the computed bg-color for the element under test. Restore in `afterEach`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `default_color_source_uses_instance_colors` | With `colorSource` omitted (defaults to `'config'`): observe element with computed bg-color `"rgb(255, 0, 0)"`. Render to fake ctx. `fillStyle` assigned to `colorDefault` (the configured instance color), NOT to `"rgb(255, 0, 0)"`. Regression test — verifies backwards compat. |
| 2 | `computed_source_reads_element_background_color` | With `colorSource: 'computed'`: observe element where `getComputedStyle(el).backgroundColor === "rgb(255, 0, 0)"`. Render to fake ctx with no hover (slot[4] === 0). `fillStyle` was assigned exactly `"rgb(255, 0, 0)"` (NOT the instance `colorDefault`). |
| 3 | `transparent_background_falls_back_to_colorDefault` | With `colorSource: 'computed'`: three sub-cases (`"rgba(0, 0, 0, 0)"`, `""`, `"transparent"`) — for each, render `fillStyle` equals instance `colorDefault`. |
| 4 | `mutation_observer_refreshes_theme_on_style_change` | `colorSource: 'computed'`, element computed bg `"rgb(0, 0, 255)"` (blue). Observe; render once — assert `fillStyle === "rgb(0, 0, 255)"`. Change getComputedStyle to return `"rgb(0, 255, 0)"` (green). Look up the per-element observer (`moFor(el)`) and call `.trigger([{ target: el, type: "attributes", attributeName: "style" }])`. Render again; assert `fillStyle === "rgb(0, 255, 0)"`. |
| 5 | `unobserve_disconnects_mutation_observer` | After `colorSource: 'computed'` + observe + initial render: capture `mo = moFor(el)`, assert `mo.disconnected === false`. Call `unobserve(el)`. Assert `mo.disconnected === true`. (Direct semantic: the per-element MutationObserver was disconnected on unobserve — no re-observe games.) |
| 6 | `hover_state_uses_global_colorHover_even_in_computed_mode` | `colorSource: 'computed'`, element computed bg `"rgb(255, 0, 0)"`. Manually set `buffer[id * FLOATS_PER_ENTITY + 4] = 1.0` (hover). Render. `fillStyle` was assigned to the instance `colorHover` (the global), NOT to `"rgb(255, 0, 0)"`. v1 limitation made testable. |
| 7a | `refreshTheme_in_computed_mode_picks_up_changed_bg` | `colorSource: 'computed'`, observe element with computed bg `"rgb(0, 0, 255)"`. Change `getComputedStyle` to return `"rgb(255, 255, 0)"`. `expect(() => instance.refreshTheme(el)).not.toThrow()` (no MutationObserver trigger involved). The cache-update path is independently exercised by test #4 via the MO trigger. |
| 7b | `refreshTheme_in_config_mode_is_noop` | Separate instance with `colorSource: 'config'` (default). Observe element. `expect(() => instance.refreshTheme(el)).not.toThrow()`. Defensive — no-op, not error. |
| 7c | `refreshTheme_on_destroyed_instance_throws` | `colorSource: 'computed'`, observe element, then `instance.destroy()`. `expect(() => instance.refreshTheme(el)).toThrow("Cannot refreshTheme on a destroyed LiquidDOM instance")`. |

## Must NOT
- Read computed style every frame (per-frame `getComputedStyle` is expensive in DOM-heavy apps).
- Hard-fail on unparseable colors (`currentColor` post-resolution, malformed values, etc.) — fall back to `colorDefault` gracefully.
- Construct the `MutationObserver` unless `colorSource === 'computed'` (zero cost for the default config path).
- Break backwards compat: with `colorSource` omitted or `'config'`, render output must be byte-identical to pre-W52 behavior.
- Read or modify slot[4] (interaction_state) — hover handling stays as today.
- Parse `background-image` / gradients (deferred to v2).
- Synthesize per-element hover colors (deferred to v2).
- Touch Rust, FFI buffer, or any WASM-facing code.

## Must DO
- `LiquidOptions.colorSource` defaults to `'config'`.
- `themeCache` keyed by entity id (matches the existing buffer-offset pattern).
- `MutationObserver` is shared (one instance for all observed elements) — matches W42's `ResizeObserver` shape.
- `MutationObserver` observes `style` AND `class` attributes (covers inline styles, stylesheet-driven class swaps on the observed element).
- Guard `MutationObserver` construction with `typeof MutationObserver !== "undefined"` for SSR compatibility (matches the W42 `ResizeObserver` guard).
- Public `instance.refreshTheme(el)` available, no-op in `'config'` mode (defensive, not an error). Throws `Error("Cannot refreshTheme on a destroyed LiquidDOM instance")` if instance is destroyed (matches `setPhysicsConfig` pattern).
- `unobserve` cleans up both the MutationObserver subscription AND the themeCache entry.
- Update CLAUDE.md + CONTEXT.md per §8.

## Verification
- `npm test` — 167 tests green (158 + 9 new), 0 clippy warnings (Rust untouched), 0 TS errors.
- `npm run build` — full build clean. `npm pack --dry-run` unchanged (no new files in tarball beyond compiled core).
- Manual: temporary scene with 3 buttons styled `background: hotpink`, `background: rebeccapurple`, `background: lightseagreen`. Init with `colorSource: 'computed'`. All three blobs match host colors immediately. Mutate one button's class to swap color → blob updates within ~one frame after the MutationObserver microtask.
- `colorSource` omitted on the same demo → all three blobs use the configured `colorDefault` (regression check).
