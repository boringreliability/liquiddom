---
ward: 19
revision: null
name: "Reduced Motion, Focus State, and Touch Parity"
epic: "runtime-resilience"
status: "planned"
dependencies: [18]
layer: "typescript"
estimated_tests: 4
created: "2026-03-31"
completed: null
---
# Ward 019: Reduced Motion, Focus State, and Touch Parity

## Scope
Respect the user's `prefers-reduced-motion` media query by disabling or drastically softening physics-driven animation. Add focus/blur awareness so the interaction state reflects keyboard navigation. Extend pointer handling beyond mouse-only to support touch and pointer events for mobile and stylus parity.

## Inputs
- `window.matchMedia('(prefers-reduced-motion: reduce)')` query and change listener
- `focus` / `blur` events on interactive entities or the canvas
- Touch and pointer events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`)
- Existing mouse-based interaction state from earlier wards
- Viewport culling and DPR scaling from Ward 018

## Outputs
- `reducedMotion` runtime flag (auto-detected, config-overridable)
- When reduced motion is active: physics forces zeroed or near-zero, entities render in final/resting positions
- `interaction_state` extended with `'focused'` value
- Unified pointer handling: mouse, touch, and pen all produce the same internal pointer events
- Config option `forceReducedMotion: boolean` to override media query

## Specification

### Reduced Motion
- On init, read `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Listen for changes via the `change` event on the MediaQueryList.
- When active: set all physics spring/velocity forces to zero (or a near-zero constant), effectively freezing entities in their computed layout positions.
- A config flag `forceReducedMotion` can override detection (true = always reduced, false = always animated, undefined = auto-detect).
- Transition: if reduced motion toggles mid-session, entities settle to rest within one frame (no jarring snap — apply positions directly).

### Focus State
- When the canvas or an interactive entity receives a `focus` event, set `interaction_state = 'focused'` on that entity.
- On `blur`, revert to the previous interaction state (idle or whatever it was).
- Focus state is visually distinct from hover (downstream rendering concern, but the state must be available).
- Focus must work alongside pointer states — a focused + hovered entity reports both.

### Touch / Pointer Parity
- Replace or augment `mousedown/mousemove/mouseup` listeners with `pointerdown/pointermove/pointerup/pointercancel`.
- Pointer events carry `pointerId` and `pointerType` — store per-pointer state to support multi-touch if needed later.
- `pointercancel` is treated as `pointerup` (release interaction).
- Touch-action CSS (`touch-action: none`) applied to the canvas to prevent browser scroll/zoom interference.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_reduced_motion_disables_physics` | When prefers-reduced-motion matches, physics forces are zero and entities are at rest positions |
| 2 | `test_focus_triggers_interaction_state` | A focus event on the canvas sets interaction_state to 'focused'; blur reverts it |
| 3 | `test_touch_events_work_as_pointer` | A simulated pointerdown with pointerType 'touch' produces the same internal state as a mouse click |
| 4 | `test_config_override_for_reduced_motion` | Setting forceReducedMotion=true activates reduced motion regardless of media query |

## Must NOT
- Ignore prefers-reduced-motion — accessibility is mandatory
- Break mouse input when adding pointer events
- Assume single-pointer (store per pointerId)
- Let focus state override or erase hover state — they coexist

## Must DO
- Auto-detect prefers-reduced-motion and listen for changes
- Provide forceReducedMotion config override
- Zero physics forces when reduced motion is active
- Set interaction_state to 'focused' on focus events
- Use pointer events (not mouse events) as the primary input path
- Apply touch-action: none on the canvas element

## Verification
- All 4 tests green
- Manual test: toggle "Reduce motion" in OS settings — animation stops/starts
- Manual test: Tab-focus onto canvas — interaction_state reflects 'focused'
- Manual test: touch interaction on mobile/tablet behaves identically to mouse
