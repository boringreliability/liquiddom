---
ward: 55
revision: 2
name: "Smooth Scroll-Snap Interpolation (+ W26 implementation fix)"
epic: "theming-polish"
status: "complete"
dependencies: [26]
layer: "typescript"
estimated_tests: 11
created: "2026-05-10"
completed: "2026-05-15"
---
# Ward 055: Smooth Scroll-Snap Interpolation (+ W26 implementation fix)

## Scope
Two changes, one ward — because W55's value depends on W26 actually working:

### Part A: Fix W26's implementation gap
W26's spec (Ward 026, completed) promised "Physics Pause" during scroll: *"Når `isScrolling === true`, skip physics substep-beregning i animation loop."* That was never implemented. The current code at `packages/core/ts/src/index.ts:445` reads `const physicsDt = reducedMotion ? 0 : dt;` — `scrolling` is tracked but never feeds into `physicsDt`. Physics runs at full speed under fast scroll, which is the exact partikel-eksplosion scenario W26 was meant to prevent.

The W26 "snap on idle" callback at line 371 (`observer.sync()`) is also redundant — `observer.sync()` already runs every frame at line 443 regardless of scroll state. The fix removes both: physics pauses during scroll (`physicsDt=0`), and the redundant idle-time sync() call is dropped.

### Part B: W55 smooth scroll-snap interpolation
After Part A's fix, scroll-end currently produces a hard snap — physics resumes with whatever `base_pos` it had captured during scroll, and springs may have to react to a large delta in one frame. W55 replaces the hard snap with an eased transition: when `scrolling` flips false, capture the current `base_pos` snapshot per entity, then lerp toward the live `getBoundingClientRect()` target over `snapDurationMs` (default 150 ms). Physics resumes immediately but reads the lerped `base_pos`, so springs see a smooth target trajectory instead of a single-frame teleport.

Out of scope:
- Per-entity opt-out from scroll-snap (all observed elements get the smooth path).
- Configurable easing curve (W55 uses linear interp for v1; ease-out could be a future tuning ward).
- Container-mode scroll independent of page scroll (existing W26 listener already covers both — see `isContainerMode` branch at line 377-379).
- Soft-body internal squish during the lerp — the lerp affects `base_pos` only; existing springs handle interior dynamics.

## Inputs
- W26 `scrolling: boolean` flag at `packages/core/ts/src/index.ts:361` + `scrollIdleTimer` at line 362.
- `observer.sync()` at line 443 — runs every frame, writes `getBoundingClientRect()` → `slot[0..3]`.
- `observer.getBuffer()` for reading current `slot[0..1]` (the `base_pos` x, y).
- Existing `LiquidOptions.maxDt` clamping — preserved.
- W42 `parseBorderRadius` etc — not affected (slot[8] unchanged).

## Outputs
**Part A (W26 fix):**
- `packages/core/ts/src/index.ts:445` — `physicsDt = (reducedMotion || scrolling) ? 0 : dt`.
- Remove the redundant `observer.sync()` call inside `scrollIdleTimer`'s setTimeout (line 371). It's a no-op redundancy after the per-frame sync at line 443 (and after Part B, also overridden by the lerp loop).
- `pointer_active` already gates on `reducedMotion`; W55 also gates on `scrolling` so pointer-driven repulsion freezes too (matches "physics frozen" intent — see Decision §10).

**Behavior changes for consumers** (W26 fix surfaces):
- Pointer-driven repulsion now FREEZES during page scroll (previously continued). Any consumer relying on concurrent scroll + hover effects sees the hover blob deformation pause until scroll ends. Aligned with W26's "physics frozen" intent; promote to changelog.

**Part B (W55 lerp):**
- New `LiquidOptions.snapDurationMs?: number` (default 150).
- Per-entity lerp state stored in a TS-side `Map<number, ScrollSnapState>` (slot id → snapshot + start time).
- New TS function: when `scrolling` flips from `true` → `false`, populate the map with current `slot[0]/[1]` snapshots for every observed entity.
- Per-frame loop step BEFORE `observer.sync()`: if the map is non-empty, for each entry compute `t = (now - startTime) / snapDurationMs`, lerp `slot[0]/[1]` from snapshot toward the LIVE rect (read fresh each frame), write to buffer. When `t >= 1`, remove the entry. Once the map is empty, `observer.sync()` resumes its normal role.
- Importantly: while the lerp is active, `observer.sync()` is **skipped** (otherwise it would overwrite our lerped values). So the RAF loop becomes:
  ```ts
  if (scrollSnapActive) {
    runScrollSnapLerp();
  } else {
    observer.sync();
  }
  ```
- `LiquidDOMInstance.isScrollSnapping: boolean` — read-only flag, true while the lerp map is non-empty. Useful for external code (and tests).
- Reduced-motion bypass: under reduced motion, scroll-end skips the lerp and just lets `observer.sync()` write live values (instant snap, matching the existing reduced-motion "freeze physics" baseline).

## Decisions (locked in this spec)
1. **W26 fix first, W55 lerp builds on it.** Both ship in one ward because W55's "ease the snap" only makes sense if physics actually pauses during scroll. Shipping W55 alone would smooth a non-existent jolt; shipping W26-fix alone would expose the same hard-snap UX issue. Two-in-one keeps the scope honest.
2. **Lerp target is read LIVE from `getBoundingClientRect()` each frame, not captured at scroll-end.** Reason: if the user scrolls AGAIN during the lerp, the live target moves with them. Snapshot-at-scroll-end would lerp toward a stale position. Cost: one rect read per entity per lerp frame (~150ms × 60fps = 9 reads per entity). Negligible for typical capacities (32-128).
3. **The lerp uses linear interpolation `t = elapsed / duration`.** Simpler than ease-out, gives a predictable rate. Future v2 ward can add `LiquidOptions.snapEasing: 'linear' | 'ease-out'`.
4. **`scrollSnapActive` map keys on slot id, not element.** Avoids holding strong refs to detached elements. If an element is unobserved during the lerp, its entry is naturally orphaned — it eventually gets `t >= 1` and is removed. Defensive: `unobserve()` also explicitly deletes its entry to avoid drift (1-line fix).
5. **`observer.sync()` skipped during lerp.** The W55 lerp owns the buffer slot[0]/[1] writes. Once lerp completes (map empty), sync() resumes its per-frame role.
6. **Reduced-motion bypasses the lerp entirely.** No state captured at scroll-end; `observer.sync()` keeps writing live rects. Matches reduced-motion's "freeze physics, render last state" philosophy.
7. **Tween() composition: tween wins.** W32 `instance.tween(el, ...)` writes directly to buffer slot[0]/[1] over a `duration`. If a tween starts mid-lerp for the same entity, the tween's writes overwrite the lerp's writes (tween runs at setInterval(16ms), lerp runs in the RAF loop). After tween completes, lerp may still have entries → it resumes for remaining entities. To keep this clean: **starting a tween for an entity removes that entity from the lerp map.** One-line addition to `tween()`.
8. **Snap duration default 150 ms.** Matches typical iOS overscroll-snap duration. Configurable via `LiquidOptions.snapDurationMs` (init-only — not live-tunable in v1).
9. **Drop the redundant `observer.sync()` call inside `scrollIdleTimer`.** It's executed AFTER the regular per-frame sync, so it's a no-op redundancy. Removing it simplifies the W55 implementation (no double-write conflict).
10. **`pointer_active` gates on `scrolling` too.** Currently `pointer_active && !reducedMotion`. W55 makes it `pointer_active && !reducedMotion && !scrolling` so pointer-repulsion freezes during scroll. Matches W26's "physics frozen" intent for hover-driven effects.

## Specification

### Part A: W26 fix

**Edit `packages/core/ts/src/index.ts:445`:**
```ts
// BEFORE:
const physicsDt = reducedMotion ? 0 : dt;
// AFTER:
const physicsDt = (reducedMotion || scrolling) ? 0 : dt;
```

**Edit `packages/core/ts/src/index.ts:457`:**
```ts
// BEFORE:
pointerActive && !reducedMotion,
// AFTER:
pointerActive && !reducedMotion && !scrolling,
```

**Edit `packages/core/ts/src/index.ts:365-373`:** drop the inner `observer.sync()` call:
```ts
const onScroll = () => {
  scrolling = true;
  if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => {
    scrolling = false;
    // W55: scroll-end triggers the smooth-snap lerp (see Part B).
    initiateScrollSnap();
  }, SCROLL_IDLE_MS);
};
```

### Part B: W55 lerp

**New module-private state in `LiquidDOM.create()`:**
```ts
interface ScrollSnapState {
  /** Slot[0]/[1] snapshot at scroll-end. The "from" point of the lerp. */
  fromX: number;
  fromY: number;
  /** Element ref needed to read live target via getBoundingClientRect. */
  el: HTMLElement;
  /** performance.now() timestamp at lerp start. */
  startTime: number;
}
const scrollSnap = new Map<number, ScrollSnapState>();

const snapDurationMs = options?.snapDurationMs ?? 150;
```

**`initiateScrollSnap()`:**
```ts
function initiateScrollSnap() {
  if (reducedMotion) return; // Decision §6: bypass under reduced-motion
  const buf = observer.getBuffer();
  const now = performance.now();
  // Snapshot every observed entity's current base_pos.
  // (idToElement is the source of truth for "what's being observed.")
  for (const [id, el] of (observer as unknown as { idToElement: Map<number, HTMLElement> }).idToElement) {
    const off = id * FLOATS_PER_ENTITY;
    scrollSnap.set(id, { fromX: buf[off], fromY: buf[off + 1], el, startTime: now });
  }
}
```

**RAF loop integration (replaces the unconditional `observer.sync()` call):**
```ts
// Inside the RAF loop, BEFORE the existing sync/tick block:
if (scrollSnap.size > 0) {
  runScrollSnapLerp();
} else {
  observer.sync();
}
```

**`runScrollSnapLerp()`:**
```ts
function runScrollSnapLerp() {
  const buf = observer.getBuffer();
  const now = performance.now();
  for (const [id, state] of scrollSnap) {
    const elapsed = now - state.startTime;
    const t = Math.min(1, elapsed / snapDurationMs);
    // Live target read each frame so concurrent scroll deltas aren't stale.
    const rect = state.el.getBoundingClientRect();
    const targetX = rect.x - coordOffsetX; // matches observer.sync() math
    const targetY = rect.y - coordOffsetY;
    const off = id * FLOATS_PER_ENTITY;
    buf[off]     = state.fromX + (targetX - state.fromX) * t;
    buf[off + 1] = state.fromY + (targetY - state.fromY) * t;
    // Also keep slot[2]/[3] in sync (width/height could change during scroll on responsive layouts).
    buf[off + 2] = rect.width;
    buf[off + 3] = rect.height;
    if (t >= 1) scrollSnap.delete(id);
  }
}
```

Note: `coordOffsetX/Y` come from container mode; in fullscreen mode they're 0. Same math as `observer.sync()` to keep parity.

**`unobserve()` extension:** add `scrollSnap.delete(id)` to the cleanup block. One line.

**`tween()` extension:** at the top of `tween()`, after the destroy guard and `getEntityId` lookup, add `scrollSnap.delete(id)` so a freshly-started tween bypasses any lingering lerp for that slot. Tween's writes then own the slot until completion.

**`isScrollSnapping` getter:**
```ts
get isScrollSnapping(): boolean {
  return scrollSnap.size > 0;
}
```

Added to `LiquidDOMInstance` interface.

**`destroy()` extension:** add `scrollSnap.clear()` to release the element refs held in the map.

## Tests
All in `packages/core/ts/__tests__/scroll-snap.test.ts` (new file). Use vitest fake timers + `vi.useFakeTimers()` to control `performance.now()` deterministically.

### Part A: W26 fix tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `physicsDt_clamps_to_zero_during_scroll` | Dispatch a `scroll` event on `window`. Spy on `core.tick`. Verify next tick passes `physicsDt === 0`. Without scroll: passes `physicsDt === dt`. |
| 2 | `pointer_active_clamps_to_false_during_scroll` | Set `pointerActive = true` via pointermove. Dispatch scroll. Spy on `core.tick`: verify `pointer_active` arg is `false` (the `pointerActive && !reducedMotion && !scrolling` AND-chain). |
| 3 | `scroll_idle_does_not_double_sync` | Spy on `observer.sync`. Scroll → wait `SCROLL_IDLE_MS + 50` (fake timers advance) → assert `sync` is NOT called from the scrollIdleTimer callback (only from per-frame RAF). |

### Part B: W55 lerp tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 4 | `scroll_end_initiates_lerp_for_all_observed_entities` | Observe 3 elements with mocked rects. Trigger scroll → wait idle → verify `instance.isScrollSnapping === true` and the internal `scrollSnap` map has 3 entries. |
| 5 | `lerp_writes_interpolated_base_pos_each_frame` | Observe 1 element at `(0, 0, 100, 50)`. Scroll-end captures snapshot. Mock element's `getBoundingClientRect()` to return `(200, 100, 100, 50)`. Advance fake timer by 75ms (half of 150ms default). Manually invoke the RAF callback. Verify buffer `slot[0]` is `100` (linearly halfway between 0 and 200) within `±1px` tolerance. |
| 6 | `lerp_completes_within_snap_duration` | Observe 1 element. Scroll-end. Advance timer by 200ms (past default 150ms). Drive 3 RAF callbacks. Verify `isScrollSnapping === false` AND buffer slot[0]/[1] match the live target rect. |
| 7 | `reduced_motion_bypasses_lerp` | Construct with `forceReducedMotion: true`. Observe an element. Trigger scroll-end. Verify `isScrollSnapping` is `false` (map never populated). Subsequent frames let `observer.sync()` write live rects directly. |
| 8 | `tween_during_lerp_takes_over` | Observe element at `(0, 0)`. Scroll-end populates `scrollSnap` for the entity. Immediately call `instance.tween(el, { toX: 500, toY: 0, duration: 100 })`. Verify the entity is REMOVED from `scrollSnap` (via internal peek). Other observed entities mid-lerp are unaffected. |
| 9 | `scroll_during_lerp_resnapshots_on_idle` | (R4 regression locker.) Observe element at `(0, 0)`. Scroll → idle (snapshot captured at fromX=0). Advance timer 75ms into the lerp — slot[0] is now mid-lerp (say 100). Trigger another scroll → idle. Verify the new `scrollSnap` entry's `fromX` is the MID-LERP value (~100), not the original 0. Final lerp lands on the new live target. |
| 10 | `destroy_clears_scroll_snap_map` | Observe element. Trigger scroll → idle. Verify map populated (size > 0). Call `instance.destroy()`. Read internal `scrollSnap.size` via peek → assert 0. Verifies the `scrollSnap.clear()` cleanup is wired. |
| 11 | `container_mode_lerp_uses_coord_offset` | Construct with `container: el` (non-zero left/top, say `(50, 100)`). Observe a child element. Trigger container scroll → idle. Mock child's `getBoundingClientRect()` to return `(200, 150, 100, 50)`. Verify lerp target uses `(200 - 50, 150 - 100) = (150, 50)` after coord offset (matches `observer.sync()` math). |

After W55: 245 + 11 = **256 tests** (55 Rust + 201 TS — all 11 new tests TS-side).

## Must NOT
- Run the lerp while `scrolling === true` (Decision §1: lerp starts only on scroll-end timeout).
- Run `observer.sync()` while `scrollSnap.size > 0` (Decision §5 — would overwrite lerped writes).
- Apply the lerp for entities that became unobserved during scroll (Decision §4: explicit `scrollSnap.delete(id)` in `unobserve`).
- Apply the lerp under reduced-motion (Decision §6).
- Lerp slot[2]/[3] (width/height) — those are live-tracked, jumping instantly to the rect's current size each frame. Only slot[0]/[1] (x/y) are eased.
- Modify the buffer's slot[5]/[6]/[7] during the lerp (those are liquid_type / impulse / velocity — owned by other strategies).
- Break the existing W32 `tween()` — Decision §7 makes tween authoritative over the lerp for the affected entity.
- Add new buffer slots — all state lives in TS.

## Must DO
- All 245 existing tests continue to pass after the W26 fix (especially the existing W26 test that checks scrolling toggles — currently asserts the flag, not its effect; W55 doesn't break that assertion).
- `isScrollSnapping` is `false` initially, `true` during the lerp, `false` after completion.
- Scroll-end triggers a smooth visual transition in `demo/scenes/scroll-hero.html` instead of a hard jolt.
- Manual verification on the existing scroll-hero scene shows clearly improved UX.

## Risks & Mitigations
- **R1 (LOCKED): `idToElement` is private to `PhantomObserver`.** W55 adds `PhantomObserver.getObservedEntries(): IterableIterator<[number, HTMLElement]>` — one-line wrapper around `this.idToElement.entries()`. `initiateScrollSnap()` uses this method. No casts. (Reviewer-flagged: spec r1 offered "either cast or method"; r2 commits to method.)
- **R2: Live `getBoundingClientRect()` reads during the lerp.** 9 frames × N entities (150ms at ~60fps). For capacity=128 worst case (all snapping concurrently), that's 9 × 128 = 1152 rect reads over the full lerp window. Each rect read is layout-cheap when nothing changes. Acceptable for v1; if measured slow, future ward can snapshot at scroll-end.
- **R3: Tween-during-lerp race condition.** Tween runs in a `setInterval(16)`; lerp runs in the RAF loop. If tween's interval fires between two RAF frames, it could write to a slot that lerp will then re-overwrite the next frame. Decision §7 mitigates by deleting from `scrollSnap` at tween start, BUT what if tween starts mid-RAF? In practice JS is single-threaded; `tween()` is synchronous; the `scrollSnap.delete(id)` runs before any subsequent RAF/setInterval. Safe.
- **R4: New scroll during lerp.** User scrolls again while lerp is active. `scrolling` flips back to `true`. Currently nothing in the spec deactivates active lerps when scrolling resumes — they continue writing toward a moving live target, which is correct (the lerp keeps catching up). When the user stops scrolling AGAIN, `initiateScrollSnap()` re-fires and overwrites the existing entries with fresh snapshots. Net effect: smooth re-snap. ✓
- **R5 (LOCKED): `coordOffsetX/Y` access from outside `PhantomObserver`.** W55 uses closure capture in `LiquidDOM.create()`. `containerRect.left/top` are already cached per-frame at the existing pointer-tracking site; W55 reads them directly inside `runScrollSnapLerp()`. No new observer surface. (Reviewer-flagged: spec r1 offered "either getter or closure"; r2 commits to closure.)
- **R6 (PRE-RED GATE): Fast-forward of `performance.now()` in tests.** Vitest's `vi.useFakeTimers()` mocks `performance.now()` by default in modern versions, but verify it BEFORE writing red tests. Smoke check: `vi.useFakeTimers(); const t0 = performance.now(); vi.advanceTimersByTime(50); expect(performance.now()).toBeGreaterThan(t0);`. If it fails: use `vi.setSystemTime()` or shim `performance.now` directly. Document the working approach in the test file's top comment.
- **R7: `pointer_active` clamp on scroll.** Pre-W55, `pointer_active` is `true` during scroll if user happens to be hovering. Repulsion forces apply normally. After W55 (Decision §10), pointer repulsion freezes during scroll. Visible UX change: hover-driven blob deformation pauses while scrolling. Probably desirable but worth noting in the changelog.

## Verification
0. **Pre-red gate**: confirm `vi.useFakeTimers() + vi.advanceTimersByTime(N)` advances `performance.now()`. Per R6.
1. `npm test -- packages/core/ts/__tests__/scroll-snap.test.ts` covers T1-T11.
2. Full verify: 55 Rust + 201 TS = 256 tests pass. 0 clippy.
3. Manual smoke test (existing demo):
   - Open `http://localhost:3000/scenes/scroll-hero.html`.
   - Scroll the page rapidly past the hero blob.
   - **Before W55:** blob teleports to its new position when scroll stops (visible jolt).
   - **After W55:** blob eases into its new position over ~150ms.
4. Manual smoke test (regression): existing demo scenes (`/`, `dragable-cards.html`, `splash-buttons.html`, `tilt-bowl.html`) behave identically when scroll is not involved.
