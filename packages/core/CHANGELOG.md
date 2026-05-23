# liquiddom

## 0.2.0-rc.0

### Minor Changes

Initial public release.

**Core capabilities:**
- WASM-driven soft-body physics on real DOM elements via hidden `<canvas>` overlay
- 9-float-per-entity flat `Float32Array` FFI contract (no JSON over the boundary)
- Pre-allocated buffer pool with explicit `grow()` (no entity churn)
- Phantom DOM observation — original elements stay accessible

**Rendering:**
- `renderer: 'auto'` (default) — probes WebGPU, falls back to Canvas2D transparently
- Canvas2D path: Bezier-spline blobs, universal browser support
- WebGPU path: SDF blobs, metaball fusion (`theme.fusionRadius`), background refraction (`theme.refraction`)
- `instance.activeRenderer` exposes the chosen backend

**Liquid types:**
- `0` Default — soft-body following DOM rect
- `3` Dragged — drag the element, physics follows
- `4` Shake — vibrates after `impulse()`
- `5` Tween — external position target
- `6` FreeDrop — DOM-less droplet particles

**Interaction primitives:**
- `impulse(el, opts)` with optional droplet splash
- `tween(el, opts)` with `linear` / `ease-out` easing
- `spawnDroplet(opts)` / `despawnDroplet(id)`
- `setPhysicsConfig(partial)` for live runtime tuning

**Environment integration:**
- Scroll-aware physics pause + smooth snap-back lerp
- Reduced-motion respect
- `prefers-color-scheme` via `colorSource: 'computed'`
- Device orientation gravity (`gravity.source: 'orientation'`)
- Container-mode (positioned containing block) + fullscreen mode
- `preserveBackgrounds` clip-hole with border-radius + box-shadow margin handling

**Browser support:**
- Canvas2D path: all modern browsers (Chrome, Firefox, Safari, Edge)
- WebGPU path: Chrome 113+, Edge 113+
