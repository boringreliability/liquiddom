---
ward: 20
revision: null
name: "Container-Scoped Rendering Mode"
epic: "runtime-resilience"
status: "planned"
dependencies: [13]
layer: "typescript"
estimated_tests: 3
created: "2026-03-31"
completed: null
---
# Ward 020: Container-Scoped Rendering Mode

## Scope
Allow the LiquidDOM canvas to be hosted inside an arbitrary container element rather than always rendering fullscreen. All coordinate handling (pointer input, entity positioning, viewport culling) must be relative to the container's bounding rect. The existing fullscreen mode remains the default and must continue to work unchanged.

## Inputs
- Runtime instance API from Ward 013 (instance-based runtime)
- Optional `container: HTMLElement` config property
- Container's `getBoundingClientRect()` for coordinate mapping
- ResizeObserver for container dimension changes

## Outputs
- `container` config option (HTMLElement | undefined; undefined = fullscreen)
- Container-relative coordinate transform for all pointer events
- Canvas sized to container dimensions (not window) when in container mode
- ResizeObserver-driven resize handling for the container
- Fullscreen mode preserved as default when no container is provided

## Specification

### Container Mode Activation
- If `config.container` is provided, the runtime creates/appends the canvas inside that element instead of `document.body`.
- Canvas `width` and `height` track the container's `clientWidth` and `clientHeight` (times DPR per Ward 018).
- A `ResizeObserver` on the container triggers canvas resize on dimension changes.

### Coordinate Mapping
- All incoming pointer coordinates are transformed from page-space to container-space using `container.getBoundingClientRect()`.
- `clientX - rect.left` and `clientY - rect.top` produce container-relative coordinates.
- The bounding rect is cached per frame (not per event) to avoid layout thrashing; refreshed at the start of each RAF tick.
- Viewport culling (Ward 018) uses container dimensions as the viewport, not `window.innerWidth/Height`.

### Fullscreen Mode
- When `config.container` is undefined (default), behaviour is identical to pre-Ward-020: canvas appended to `document.body`, sized to `window.innerWidth/Height`, coordinates are page-absolute.
- No code paths should regress for fullscreen mode.

### Teardown
- On `destroy()`, the ResizeObserver is disconnected, the canvas is removed from the container, and all container-scoped listeners are cleaned up.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_container_mode_renders_inside_element` | Canvas is appended as child of the provided container element, sized to container dimensions |
| 2 | `test_coordinates_are_container_relative` | Pointer event at (pageX, pageY) is correctly transformed to container-relative (x, y) |
| 3 | `test_fullscreen_mode_still_works` | When no container is provided, canvas is appended to body and sized to window dimensions |

## Must NOT
- Break fullscreen mode (it is the default and must remain unchanged)
- Read getBoundingClientRect() on every pointer event — cache per frame
- Leak ResizeObserver or event listeners after teardown
- Assume container is statically positioned (use getBoundingClientRect, not offsetLeft/Top)

## Must DO
- Accept optional container HTMLElement in config
- Append canvas inside container when provided
- Size canvas to container clientWidth/Height (times DPR)
- Transform pointer coords to container-relative space
- Use ResizeObserver for container dimension changes
- Use container dimensions (not window) for viewport culling in container mode
- Clean up all container-scoped resources on teardown

## Verification
- All 3 tests green
- Manual test: embed canvas inside a 400x300 div — rendering is contained, pointer interactions are accurate
- Manual test: resize the container div — canvas adapts smoothly
- Manual test: fullscreen mode (no container) behaves exactly as before
