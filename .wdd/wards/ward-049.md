---
ward: 49
revision: 4
name: "Tweakpane Visual Playground"
epic: "framework-adapters-dx"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 7
created: "2026-05-10"
completed: "2026-05-10"
---
# Ward 049: Tweakpane Visual Playground

## Scope
A standalone interactive demo page where visitors can drag sliders for every live-tunable physics parameter and see the effect immediately on a fixed set of demo elements. Includes "Copy config" (clipboard) and "Reset to defaults" actions. Persists state across reloads via `localStorage`. Mobile-friendly via collapsible Tweakpane.

The playground is also the canonical visual showcase for W42 (border-radius support) by rendering a pill, a circle, and a rectangle side-by-side.

## Revision history
- **r1**: initial fleshed-out spec.
- **r2**: addresses initial spec-review findings.
  - Test #1 needs an observable surface — added `getPhysicsConfig()` getter on `LiquidDOMInstance`.
  - `setPhysicsConfig` atomicity made explicit: merge → validate → assign.
  - `validatePhysicsConfig` promotion details: top-level named export, `/** @internal */` JSDoc.
  - Preset feedback loop guard pattern specified (`settingPreset` flag).
  - URL params for "Reload with these settings" encoding scheme defined; precedence vs. localStorage clarified.
  - `setTheme` decision committed: v1 = instance rebuild on color change (reviewer recommendation).
  - `'custom'` preset detection uses 1-decimal rounding for `damping` (only non-integer-step param).
  - Test count arithmetic corrected (138 prior + 4 new = 142 total).
  - State-loader extracted to `demo/scenes/playground-state.ts` for Tweakpane-free testability.
  - Tweakpane pinned to `^4.0.4`.
  - localStorage flush on `beforeunload`; key renamed `liquiddom-playground-v1` (no `@`).
  - CONTEXT.md row text made concrete.
- **r3**: r2 review surfaced two executability gaps and two race-condition concerns.
  - Explicit `LiquidDOMInstance` interface extension block added (new TS signatures for `setPhysicsConfig` and `getPhysicsConfig`).
  - `rebuildWithColors` race-condition guarded via debouncing + in-flight cancellation.
  - URL param precedence clarified as per-parameter (not all-or-nothing).
  - Test #3 error messages spelled out explicitly.
  - Reviewer's "presets lack damping" finding (C) verified false — all 3 presets in `ts/src/index.ts:37-62` define damping (goo=12, jelly=4, firm=8). Documented for record.
- **r4** (this revision): red-phase test review surfaced 2 must-fix + 3 should-fix coverage gaps. Test count expanded from 4 → 7 to cover spec requirements that were under-tested.
  - Test #2 atomicity check enhanced with a baseline `expect(before.tension).toBe(100)` to prevent vacuous-pass when `getPhysicsConfig` returns a live reference.
  - New test #5: `getPhysicsConfig_returns_shallow_copy` — spec §1's shallow-copy invariant.
  - New test #6: `localStorage_recovers_from_schema_mismatch_and_invalid_shape` — covers spec §8 schema version mismatch and structurally-invalid-but-parseable JSON cases.
  - New test #7: `parseUrlParams_validates_per_field` — covers spec §4 URL param parsing with valid/invalid sub-cases and `history.replaceState` side effect.
  - Reviewer's M1 (demo/ import / tsconfig rootDir) verified non-issue: `tsconfig.build.json` excludes `ts/__tests__/`; `npm run build` passes clean; Vitest transforms test files independently.

## Inputs
- Public `LiquidOptions` and `LiquidPhysicsConfig` from `ts/src/index.ts`
- Existing `DEFAULT_PHYSICS` constant + `presets` (goo, jelly, firm)
- Existing `validatePhysicsConfig` function at `ts/src/index.ts:64` (already top-level, not closure-captured — clean promotion to named export)
- Tweakpane `^4.0.4` (~6kB minified gz, MIT) as a *demo-only* devDependency

## Outputs
- New `demo/scenes/playground.html` — standalone HTML with Tweakpane mount point
- New `demo/scenes/playground.ts` — Tweakpane wiring, glue between UI and state
- New `demo/scenes/playground-state.ts` — pure state functions (load/save/parse URL params); Tweakpane-free, importable from tests
- New method `LiquidDOMInstance.setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void` — atomic live update (merge → validate → assign)
- New getter `LiquidDOMInstance.getPhysicsConfig(): Required<LiquidPhysicsConfig>` — returns a shallow copy of the current live physics object (read-only inspection; mutating the returned object does NOT affect state)
- Promote `validatePhysicsConfig` to `export function validatePhysicsConfig(...)` with `/** @internal */` JSDoc marker in `ts/src/index.ts`
- `demo/index.html` updated with a prominent link to the playground
- `package.json` devDependency `"tweakpane": "^4.0.4"` added

## Specification

### 1. Live update mechanism

**Interface extension** — add to `LiquidDOMInstance` in `ts/src/index.ts:81`:
```ts
setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void;
getPhysicsConfig(): Required<LiquidPhysicsConfig>;
```

**Implementation**:
- `setPhysicsConfig(partial)` follows a strict **merge → validate → assign** ordering for atomicity:
  ```ts
  setPhysicsConfig(partial) {
    if (destroyed) throw new Error("Cannot setPhysicsConfig on a destroyed LiquidDOM instance");
    const merged = { ...physics, ...partial };
    validatePhysicsConfig(merged); // throws on invalid; state unchanged
    Object.assign(physics, merged); // only reached on success
  }
  ```
  Validating the MERGED config (not just `partial`) catches cross-field invariants if any are added in future revisions.
- `getPhysicsConfig()` returns `{ ...physics }` (shallow copy) so callers cannot mutate internal state via the returned reference.
- Per-frame loop already reads `physics.tension` etc. on every tick — no separate config-FFI needed (W23 invariant preserved).
- Both methods throw with descriptive messages if the instance is destroyed.

### 2. Live-tunable parameters (Tweakpane bindings)
All exposed in a "Physics" folder, each with explicit min/max/step:

| Param | Min | Max | Step | Default |
|-------|-----|-----|------|---------|
| `tension` | 1 | 500 | 1 | 100 |
| `damping` | 0 | 30 | 0.1 | 5 |
| `repulsionRadius` | 0 | 300 | 1 | 100 |
| `repulsionStrength` | 0 | 20000 | 100 | 5000 |
| `substeps` | 1 | 8 | 1 (integer) | 1 |
| `neighborSpringK` | 0 | 100 | 1 | 30 |

`particleCount` is NOT exposed (it's fixed at 16 per FFI invariant; would require rebuild and ward extension).

### 3. Presets dropdown
Tweakpane `addBinding` for an enum: `'custom' | 'goo' | 'jelly' | 'firm'`. Selecting a preset writes that preset's values into the live params; `'custom'` is auto-selected when the user manually drags a slider.

**Feedback-loop guard (required)**: use a module-scoped boolean `settingPreset = false`. When applying a preset:
```ts
settingPreset = true;
Object.assign(state.physics, presets[name]);
pane.refresh();
settingPreset = false;
```
In slider change handlers: skip the auto-detect step if `settingPreset === true`.

**Comparison for `'custom'` detection**: integer-step params (`tension`, `repulsionRadius`, `repulsionStrength`, `substeps`, `neighborSpringK`) use strict equality `===`. For `damping` (step 0.1), round both sides to 1 decimal before comparing: `Math.round(current * 10) === Math.round(preset * 10)`. Other floating-point precision concerns are out of scope for v1.

### 4. Init-only parameters
Surfaced under an "Init-only" folder so visitors see them but understand they require a page reload:
- `capacity` (number input, default 64)
- `forceReducedMotion` (boolean, default false)
- `preserveBackgrounds` (boolean, default false)

A "Reload with these settings" button at the bottom of that folder re-loads the page with the values encoded in URL params.

**URL param encoding scheme**:
- `?capacity=<integer>&forceReducedMotion=<true|false>&preserveBackgrounds=<true|false>`
- Booleans serialized as exact strings `"true"` / `"false"` (case-sensitive).
- Capacity: positive integer parsed via `parseInt(v, 10)`.

**Page-load parsing** (in `playground-state.ts::parseUrlParams`):
- Read `window.location.search` via `URLSearchParams`.
- Each param validated independently:
  - `capacity`: must parse to integer > 0 — else fall back to default 64.
  - Booleans: must be exactly `"true"` or `"false"` — else fall back to default.
- After successful parse, call `history.replaceState({}, "", window.location.pathname)` to strip params from the address bar (avoids confusion on subsequent reloads).

**Precedence (per-parameter, NOT all-or-nothing)**: URL params take precedence over localStorage, but only for the parameters that are present and valid in the URL. Each parameter is resolved independently:
- For each init-only param: if URL has a valid value → use it; else if localStorage has a value → use that; else use the default.
- Live-tunable params are never expressed in URL params — they always come from localStorage or defaults.

Example: opening `?capacity=128` (only `capacity` in URL) with localStorage containing `{ capacity: 64, forceReducedMotion: true, preserveBackgrounds: false }` resolves to `capacity=128` (URL wins), `forceReducedMotion=true` (localStorage), `preserveBackgrounds=false` (localStorage).

### 5. Visual params
- `colorDefault` (color picker, default `rgba(15, 52, 96, 0.75)`)
- `colorHover` (color picker, default `rgba(233, 69, 96, 0.85)`)

**v1 strategy: rebuild on color change.** Color changes trigger a full instance rebuild.

**Race-condition guard (required)**: color picker drag events fire rapidly. Without protection, multiple concurrent rebuilds can race — a second `destroy()` mid-flight while the first `create()` is pending corrupts state.

```ts
let rebuildSeq = 0;
const rebuildColorsDebounced = debounce(async (colorDefault, colorHover) => {
  const mySeq = ++rebuildSeq;
  instance.destroy();
  const next = await LiquidDOM.create({ ...currentOptions, colorDefault, colorHover });
  if (mySeq !== rebuildSeq) {
    // A newer rebuild started before we finished — discard this one.
    next.destroy();
    return;
  }
  instance = next;
}, 150); // 150ms debounce
```

This is a brief visual flash but acceptable for v1. Adding a `setTheme` method requires `PhantomObserver` to expose color setters, which touches the render path and is out of scope here (potential W52 follow-up). Document this limitation in a comment in `playground.ts`.

### 6. Showcase elements
The playground page renders a fixed set of `data-liquid` elements arranged in a grid, demonstrating W42 + Default strategy:
- A pill: `border-radius: 50%` on a 200×60 button
- A circle: `border-radius: 50%` on a 120×120 div
- A rectangle: `border-radius: 0` on a 160×80 card
- A rounded card: `border-radius: 16px` on a 220×140 div

All four use `liquid_type: 0` (Default). Total entities: 4. Capacity 16 is plenty.

### 7. Actions row (top of pane)
- **"Copy config" button**: serializes the current physics + theme config to JSON via `JSON.stringify(getCurrentConfig(), null, 2)`. Uses `navigator.clipboard.writeText(...)` with a fallback to `document.execCommand('copy')` for older browsers. Shows transient toast "Copied!" for 1.5s.
- **"Reset to defaults" button**: resets all live params to `DEFAULT_PHYSICS` values and clears the relevant `localStorage` entry. Confirms via `window.confirm()` to avoid accidental clicks.
- **"Pause" toggle**: calls `instance.pause()` / `instance.resume()`.

### 8. localStorage persistence
- Key: `liquiddom-playground-v1` (hyphenated; versioned for schema migration)
- Value: `JSON.stringify({ schema: 1, physics: {...}, theme: {...} })`
- Saved on every Tweakpane change (debounced 250ms via `setTimeout`)
- A `window.addEventListener('beforeunload', flush)` handler cancels the pending timer and saves immediately — prevents data loss on rapid tab close
- Loaded on init and applied via `setPhysicsConfig` (after instance create)
- If schema version mismatches or JSON parse fails, fall back to defaults and clear the entry
- **Migration policy**: schema version mismatch is handled by discarding old state, not migrating. This is by design for v1 — explicit non-policy so future maintainers don't look for migration logic that doesn't exist.

### 9. Mobile responsiveness
- Pane wraps in a fixed-position container, top-right corner desktop / full-width-bottom drawer on `< 720px` width
- Tweakpane folders default to collapsed on mobile
- Header bar with a hamburger to fully hide/show the pane
- The demo grid reflows from 2×2 desktop to 1-column mobile

### 10. Test surface (4 tests in `ts/__tests__/playground.test.ts`, new file)
The playground is largely visual, but its config plumbing is unit-testable in jsdom:

1. **`setPhysicsConfig_applies_partial_update`** — observable via `getPhysicsConfig()`:
   ```ts
   const instance = await LiquidDOM.create({ capacity: 4 });
   instance.setPhysicsConfig({ tension: 200 });
   expect(instance.getPhysicsConfig().tension).toBe(200);
   expect(instance.getPhysicsConfig().damping).toBe(5); // unchanged
   ```
2. **`setPhysicsConfig_validates_input`** — invalid values throw `TypeError` from `validatePhysicsConfig`. State unchanged:
   ```ts
   const before = instance.getPhysicsConfig();
   expect(() => instance.setPhysicsConfig({ tension: -1 })).toThrow(TypeError);
   expect(instance.getPhysicsConfig()).toEqual(before); // atomicity
   ```
3. **`setPhysicsConfig_on_destroyed_instance_throws`** — descriptive `Error` after `destroy()`. `getPhysicsConfig` also throws.
4. **`playground_localStorage_recovers_from_corrupt_data`** — imports `loadPlaygroundState` from `demo/scenes/playground-state.ts` (not `playground.ts`, which imports Tweakpane and breaks under jsdom). Writes garbage JSON to the key, calls loader, asserts defaults returned and key cleared.

The page itself (Tweakpane UI, copy-to-clipboard, scene grid layout, mobile drawer) is verified manually per the Verification section — outside the automated test surface.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `setPhysicsConfig_applies_partial_update` | After `setPhysicsConfig({ tension: 200 })`, `getPhysicsConfig().tension === 200` AND other fields unchanged |
| 2 | `setPhysicsConfig_validates_input` | Baseline `before.tension === 100`; invalid inputs (negative tension, non-integer substeps, non-finite) throw `TypeError`; atomicity: `getPhysicsConfig()` after the failed calls deep-equals `before` |
| 3 | `setPhysicsConfig_on_destroyed_instance_throws` | After `instance.destroy()`: `setPhysicsConfig({...})` throws `Error("Cannot setPhysicsConfig on a destroyed LiquidDOM instance")`; `getPhysicsConfig()` throws `Error("Cannot getPhysicsConfig on a destroyed LiquidDOM instance")` |
| 4 | `playground_localStorage_recovers_from_corrupt_data` | `localStorage.setItem('liquiddom-playground-v1', 'not json')` + `loadPlaygroundState()` → returns null, no throw, corrupt entry cleared |
| 5 | `getPhysicsConfig_returns_shallow_copy` | Mutating the object returned from `getPhysicsConfig()` does NOT affect subsequent reads of internal state |
| 6 | `localStorage_recovers_from_schema_mismatch_and_invalid_shape` | Schema-version mismatch (`schema:2`) → null + cleared; structurally invalid (`{schema:1}` missing `physics`/`theme`) → null + cleared |
| 7 | `parseUrlParams_validates_per_field` | `?capacity=128` returns `{ capacity: 128 }`; invalid `capacity=abc` ignored, invalid boolean `forceReducedMotion=yes` ignored; on successful parse, `history.replaceState` is called with bare pathname |

## Must NOT
- Add Tweakpane (or any other UI library) to the published library — `tweakpane` lives in `devDependencies`, imported only from `demo/scenes/playground.ts`.
- Couple `LiquidDOM` core to Tweakpane's metadata format (the pane reads from `LiquidOptions`, not the other way around).
- Introduce a separate config-FFI; live updates must flow through the existing per-frame `tick()` parameters (W23 invariant).
- Promote `validatePhysicsConfig` to a fully-fledged public API surface — `/** @internal */` JSDoc marker required; must NOT add usage examples to README.
- Import Tweakpane from `playground-state.ts` (must stay UI-free for jsdom testability).
- Persist sensitive state (none expected, but no `localStorage` keys with credentials or PII).
- Allow `localStorage` JSON parse to throw uncaught.
- Delete or modify existing `CONTEXT.md` rows (Key Metrics, Architecture Decisions) — append-only per W42 precedent.

## Must DO
- `setPhysicsConfig` follows merge → validate → assign atomicity (Spec §1 implementation block).
- `getPhysicsConfig` returns a shallow copy (mutations to the returned object don't affect state).
- Live updates flow through the next-frame tick with NO instance rebuild for the 6 live-tunable params.
- Color changes rebuild (v1 limitation, documented in `playground.ts` comments).
- `'custom'` preset auto-selects when the user manually drags any slider, guarded by `settingPreset` flag.
- URL params take precedence over localStorage; `history.replaceState` strips them after parse.
- localStorage debounce flushes on `beforeunload`.
- Add this concrete row to `CONTEXT.md` Architecture Decisions:
  `| Live physics update via setPhysicsConfig | Partial merge validated atomically before mutation; colors require instance rebuild (v1); particleCount not live-tunable | W49 |`
- Append (do NOT replace) the test-count row in CONTEXT.md Key Metrics:
  `| Total tests | 142 (43 Rust + 99 TS) | W49 |`
- Link the playground from `demo/index.html` so it's discoverable.
- Pin `tweakpane` to `^4.0.4` in `package.json` devDependencies.

## Verification
- `npm test ts/__tests__/playground.test.ts` (tests 1–4) green.
- `npm run build && npm test` — full 142-test suite green (138 prior + 4 new = 142), 0 clippy warnings (Rust untouched but verify), 0 TS errors.
- `npm run dev` then navigate to `/scenes/playground.html` — every live-tunable slider visibly affects the demo blobs in real time within ~1 frame; color picker rebuilds (visible flash is acceptable).
- "Copy config" produces valid JSON that, when pasted into `demo/main.ts`'s `physics` field, reproduces the visual state on next page load.
- Mobile (responsive devtools 360×640): pane is reachable via hamburger, sliders draggable, demo grid is single-column.
- Reload page after tweaking 3 sliders — the tweaked values restore from localStorage; the demo matches the pre-reload state visually.
- Open with `?capacity=128&forceReducedMotion=true` — URL params apply, address bar is cleared after init.
- `localStorage.removeItem('liquiddom-playground-v1')` + reload → defaults restored.
- `npm pack --dry-run` shows `tweakpane` is NOT in the tarball.
