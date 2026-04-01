---
ward: 18
revision: null
name: "High-DPI Canvas and Viewport Culling"
epic: "runtime-resilience"
status: "complete"
dependencies: [17]
layer: "typescript"
estimated_tests: 3
created: "2026-03-31"
completed: "2026-04-01"
---
# Ward 018: High-DPI Canvas and Viewport Culling

## Scope
Scale the canvas backing store to match `window.devicePixelRatio` so renders are crisp on Retina / high-DPI displays, while keeping all public APIs in CSS-pixel coordinates. Add basic viewport culling so entities fully outside the visible area (plus a configurable margin buffer) are skipped during rendering, and skip zero-sized or inactive entities entirely.

## Inputs
- Canvas element and CanvasRenderingContext2D from existing renderer
- `window.devicePixelRatio`
- Entity positions and sizes from the physics/particle buffer
- Pause/resume state from Ward 017 (rendering respects paused state)

## Outputs
- DPI-aware canvas setup: `canvas.width/height` scaled by DPR, CSS size unchanged
- `ctx.setTransform` or `ctx.scale` applied once per frame for DPR
- `isInViewport(entity, margin)` culling helper
- Zero-size / inactive entity guard in the render path
- `CULL_MARGIN` config (default 100 CSS pixels)

## Specification

### High-DPI Scaling
- On canvas init (and on resize), set `canvas.width = cssWidth * dpr` and `canvas.height = cssHeight * dpr`.
- Keep `canvas.style.width/height` at the CSS pixel values.
- Apply `ctx.scale(dpr, dpr)` at the start of each frame (after `clearRect`) so all drawing code operates in CSS-pixel space.
- If `devicePixelRatio` changes (e.g. window dragged between monitors), re-initialise on next frame.

### Viewport Culling
- Before rendering each entity, check if its bounding box (position + size) intersects the viewport rectangle expanded by `CULL_MARGIN` on all sides.
- If the entity is fully outside the expanded viewport, skip its render call entirely.
- Entities with zero width or zero height are always skipped.
- Entities flagged as inactive (if such a flag exists) are always skipped.

### Coordinate Consistency
- All public APIs (pointer input, entity positions, config values) remain in CSS pixels.
- The DPR scaling is an internal renderer concern only.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_canvas_dimensions_scaled_by_dpr` | canvas.width equals cssWidth * dpr; CSS style unchanged |
| 2 | `test_offscreen_entity_skipped` | Entity fully outside viewport + margin is not rendered |
| 3 | `test_zero_width_entity_not_rendered` | Entity with width=0 or height=0 has its render call skipped |

## Must NOT
- Expose DPR scaling to public API consumers — all coords stay in CSS pixels
- Render entities that are fully off-screen (beyond margin)
- Render zero-sized entities
- Allocate a new canvas on every frame for DPR changes — reuse and resize in place

## Must DO
- Set canvas backing store to cssWidth * dpr on init and resize
- Apply ctx.scale(dpr, dpr) each frame
- Cull entities outside viewport + CULL_MARGIN
- Skip zero-sized and inactive entities
- Make CULL_MARGIN configurable (default 100 CSS px)

## Verification
- All 3 tests green
- Manual test on Retina display: sharp edges, no blurriness
- Manual test: entities scrolled off-screen are confirmed skipped via render-count logging
