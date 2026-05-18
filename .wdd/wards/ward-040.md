---
ward: 40
revision: 3
name: "Background Refraction Sampling"
epic: "webgpu-rendering"
status: "complete"
dependencies: [39]
layer: "typescript"
estimated_tests: 10
created: "2026-05-10"
completed: "2026-05-18"
---
# Ward 040: Background Refraction Sampling

## Scope
Opt-in WebGPU-only optical effect: each blob acts as a glass lens that refracts a host-supplied background bitmap. The library never rasterizes the DOM itself — hosts hand in an `ImageBitmap` via `instance.setBackgroundTexture(bitmap)`. The fusion fragment shader displaces UV coordinates by the SDF gradient times a `strength` factor, producing a refractive lensing effect. Refraction is gated by `theme.refraction.enabled` AND a host-supplied texture; either falsy → silent no-op. `prefers-reduced-motion` disables refraction at the renderer layer. Refraction requires the fusion pipeline (W39); when enabled without an explicit `fusionRadius` the fusion pipeline auto-promotes with `fusionRadius=0` (smin with `k=0` reduces to `min`, equivalent to standalone polygon silhouettes — but with refraction applied).

## Inputs
- W39 fusion pipeline (full-screen-quad + smin SDF combine), shared `GPUBindGroupLayout` + `GPUPipelineLayout`, global uniform `flags vec4` with `flags.z` already reserved
- W38 `sdf-helpers.wgsl.ts` (unchanged)
- W19 reduced-motion detection (currently a closure variable in `index.ts` RAF loop)
- W36 `Renderer` interface + `RenderFrame` DTO (adds new field `reducedMotion`)

## Outputs
- `LiquidOptions.theme.refraction?: { enabled?: boolean; strength?: number }`
- `RenderFrame.theme.refraction?: { enabled: boolean; strength: number }` (CPU-clamped, normalized)
- `RenderFrame.reducedMotion: boolean` (new top-level field; default `false`)
- Instance API: `setBackgroundTexture(bitmap: ImageBitmap | null): void`
- Renderer: extended shared `GPUBindGroupLayout` (3 → 5 entries), `refractionTexture: GPUTexture`, `refractionSampler: GPUSampler`, `hasUserTexture: boolean`, `warnedRefractionCapacityFallback: boolean`
- WGSL: refraction sampling block in `fusion-sdf.wgsl.ts` gated by `flags.z > 0`
- Demo scene: `demo/scenes/refraction.html` + `refraction.ts`

## Specification

### 1 — `RenderFrame.reducedMotion: boolean` field added
W36's `RenderFrame` did not carry reduced-motion state — it lived as a closure variable in the RAF loop. W40 adds `reducedMotion: boolean` as a top-level **required** field on `RenderFrame` (NOT optional — keeps the field reliably present at the renderer boundary).

**Implementation requirements:**
- `renderer.ts`: extend `RenderFrame` interface with `reducedMotion: boolean`.
- `phantom-observer.ts`: `buildFrame(viewport, reducedMotion: boolean)` accepts the new argument and sets it on the returned frame.
- `index.ts` RAF loop: pass the existing closure variable into `observer.buildFrame(viewport, reducedMotion)`.
- All existing test fixtures (`webgpu-fusion.test.ts`'s `makeFrame`, `webgpu-renderer.test.ts`'s frame builders, `webgpu-sdf.test.ts`, `_render-helper.ts` shim): add `reducedMotion: false` default. This is part of the implementation, NOT a separate test refactor task.

The renderer reads `frame.reducedMotion` only — no DOM/`window.matchMedia` reads in the renderer (Rule of Two compliance: renderer stays in pure render-data territory).

### 2 — Bind group layout extension (shared between AABB + fusion pipelines)
The shared explicit `GPUBindGroupLayout` from W39 extends 3 → 5 entries:
- `binding: 0` uniform (mat4 + flags vec4) — unchanged
- `binding: 1` entities storage — unchanged
- `binding: 2` particles storage — unchanged
- `binding: 3` refraction texture: `texture: { sampleType: 'float', viewDimension: '2d' }`, fragment-only visibility
- `binding: 4` refraction sampler: `sampler: { type: 'filtering' }`, fragment-only visibility

The same BGL serves both pipelines (W39 Decision §72 invariant maintained). The AABB shader does not reference bindings 3/4 — WebGPU permits bind groups to carry resources unused by the pipeline's shader.

**Capacity-change bind-group rebuild** (existing `webgpu-renderer.ts:287-294`): the existing rebuild logic that fires on entity/particle buffer resize must be extended to include entries 3+4 (the texture + sampler). Otherwise post-resize the rebuilt bind group would be 3-entry and validation would reject it.

### 3 — Default 1×1 white dummy texture
Created in `WebGPURenderer.init()`:
```ts
this.refractionTexture = device.createTexture({
  size: [1, 1, 1],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.writeTexture(
  { texture: this.refractionTexture },
  new Uint8Array([255, 255, 255, 255]),
  { bytesPerRow: 4 },
  [1, 1, 1],
);
```
Bound unconditionally so `flags.z`-gated shader paths are safe even when refraction is disabled. `RENDER_ATTACHMENT` is NOT included in usage flags (texture is never used as a render target). The sampler is created once in `init()` with `{ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }`.

### 4 — `setBackgroundTexture(bitmap)` semantics
Method body opens with idempotency guards:
```ts
setBackgroundTexture(bitmap: ImageBitmap | null): void {
  if (!this.device) return;  // post-destroy no-op
  if (bitmap === null && !this.hasUserTexture) return;  // already-dummy no-op
  // ... main logic ...
}
```
- `bitmap: ImageBitmap`:
  1. Create new `GPUTexture` with format `'rgba8unorm'`, usage `COPY_DST | TEXTURE_BINDING`, size `[bitmap.width, bitmap.height, 1]`.
  2. `device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: newTex }, [bitmap.width, bitmap.height, 1])`.
  3. Destroy previous texture (`this.refractionTexture.destroy()`) — this covers both the dummy and any prior host-supplied texture; WebGPU defers actual memory release until in-flight command buffers complete.
  4. Replace `this.refractionTexture = newTex`. Set `hasUserTexture = true`.
  5. Recreate the bind group (texture binding changed → BindGroup is immutable, must rebuild). Pipelines + layout unchanged.
- `bitmap: null` (and `hasUserTexture === true`):
  1. Destroy current user-supplied texture.
  2. Create a fresh 1×1 white dummy (same as init §3) and assign to `this.refractionTexture`.
  3. Set `hasUserTexture = false`. Recreate bind group.
  - Rationale for re-creation vs caching a separate dummy reference: step (1) above unconditionally calls `destroy()` on `this.refractionTexture`. If we cached the original dummy from init, the `bitmap` path would destroy the user texture and leave the cached dummy untouched — but on a subsequent `null` call, we'd destroy the cached dummy. Re-creating each time avoids needing a `if (this.refractionTexture !== this.dummyTexture)` guard.

### 5 — Config: `theme.refraction.enabled` + `strength`
- `LiquidOptions.theme.refraction?: { enabled?: boolean; strength?: number }`.
- `enabled` default `false`. `strength` default `8` (CSS pixels of UV displacement at the blob edge). Strength is CSS-pixel-space (DPR-independent); the renderer already operates in CSS pixels throughout.
- CPU clamp at instance layer (`packages/core/ts/src/index.ts`): `Number.isFinite(rawStrength) ? Math.max(0, rawStrength) : 0`. NaN, Infinity, negative all → 0. Same clamp pattern as W39 `fusionRadius`.
- Threaded into `RenderFrame.theme.refraction` via `PhantomObserver.buildFrame()` (mirror of W39 `fusionRadius` plumbing).
- Live-config mutation of `theme.refraction` is NOT exposed in v1 (W49's `setPhysicsConfig` is physics-only by design). Consumers can mutate the `LiquidOptions.theme` reference at runtime; the next `buildFrame()` will pick up changes via the existing path. A future ward may add `setThemeConfig` if symmetry pressure builds.

### 6 — Renderer-layer gate (`flags.z`)
The renderer computes the effective refraction strength carried in `flags.z`:
```ts
const wantsFusion = (frame.theme.fusionRadius ?? 0) > 0;
const wantsRefraction = frame.theme.refraction?.enabled === true;

// Refraction requires fusion pipeline; auto-promote when refraction
// requested without explicit fusionRadius.
const needsFusionPipeline = wantsFusion || (wantsRefraction && this.hasUserTexture);
const useFusion = needsFusionPipeline && frame.capacity <= FUSION_MAX_CAPACITY;

const refractionActive = wantsRefraction
  && this.hasUserTexture
  && !frame.reducedMotion
  && useFusion;

const refractionStrength = refractionActive
  && Number.isFinite(frame.theme.refraction!.strength)
    ? Math.max(0, frame.theme.refraction!.strength!)
    : 0;
this.projMatrix[18] = refractionStrength;  // flags.z slot
```
The `flags.z = 0` path is fast: shader sees zero and skips refraction sampling entirely.

### 7 — Capacity safety valve + dual-warn priority
The combined capacity-overflow path:
```ts
if (needsFusionPipeline && !useFusion) {
  // capacity > 64 with at least one of fusion or refraction requested
  if (wantsFusion && !this.warnedFusionCapacityFallback) {
    console.warn(`[LiquidDOM] fusionRadius set but capacity (${frame.capacity}) > 64; falling back to AABB pipeline.`);
    this.warnedFusionCapacityFallback = true;
  } else if (wantsRefraction && this.hasUserTexture && !wantsFusion && !this.warnedRefractionCapacityFallback) {
    console.warn(`[LiquidDOM] theme.refraction.enabled set but capacity (${frame.capacity}) > 64; refraction disabled.`);
    this.warnedRefractionCapacityFallback = true;
  }
}
```
**Dual-warn priority:** when both fusion and refraction are requested and capacity overflows, only the fusion warn fires (fusion is the broader feature; its disablement implies refraction is also off). `warnedRefractionCapacityFallback` fires only when refraction was the *sole* reason fusion pipeline was needed. Both flags are instance-level (mirror W39 Decision §R7 pattern).

### 8 — WGSL refraction block in fusion fragment shader

**`fs_main` structure preserved.** W39's `fs_main` body keeps its existing single-pass entity loop that simultaneously computes the smin-blended SDF (`sdf`) AND the winner-tracking (`winnerId`, `minD`, `winnerColor`). W40 does NOT refactor that loop. The baseline distance `sdf` from W39's main loop IS the value `combinedSdf(p)` would return — they are the same computation.

**`combinedSdf` helper added** as a NEW WGSL function used ONLY for central-difference gradient sampling at offset points (`p ± vec2(eps, 0)` and `p ± vec2(0, eps)`):
```wgsl
fn combinedSdf(p: vec2<f32>) -> f32 {
  var d = 1e9;
  for (var i: u32 = 0u; i < MAX_ENTITIES; i = i + 1u) {
    let entity = entities[i];
    if (entity.color.a == 0.0) { continue; }
    let dEntity = sdPolygon(p, i * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
    let k = flags.y;
    d = select(min(d, dEntity), smin(d, dEntity, k), k > 0.0);
  }
  return d;
}
```
- `MAX_ENTITIES = 64u` constant matches existing `fs_main` loop bound.
- `select(min(...), smin(...), k > 0.0)` guards against `smin`'s divide-by-`k` at `k=0` (relevant when refraction auto-promotes with `fusionRadius=0`).
- Helper called 4× per fragment when refraction active (gradient: `dx` = 2 calls, `dy` = 2 calls). Plus `fs_main`'s existing main loop = 5 total entity-iterations when refraction active. Performance: ~10B segment-distance ops/frame at 1080p × capacity=64 × 16 segments × 5 iterations — opt-in only, accepted v1 cost. A future ward may add a CPU neighbor-pair pre-pass per W39 R1 deferred work.
- Winner-color tracking is NOT duplicated in `combinedSdf` — the helper returns distance only. `fs_main` keeps its single winner-tracking pass.

Refraction block in `fs_main` (inserted between W39's existing winner-color resolution and the final framebuffer write):
```wgsl
var finalColor = winnerColor;
if (flags.z > 0.0) {
  let eps = 1.0;  // CSS pixels
  // Central differences via the new combinedSdf helper (4 calls).
  // fs_main's existing main loop already produced `sdf` (= combinedSdf(p))
  // alongside winner-tracking; we don't repeat it here.
  let dx = combinedSdf(p + vec2(eps, 0.0)) - combinedSdf(p - vec2(eps, 0.0));
  let dy = combinedSdf(p + vec2(0.0, eps)) - combinedSdf(p - vec2(0.0, eps));
  let grad = vec2(dx, dy);
  let gradLen = length(grad);
  if (gradLen > 0.001) {
    // Recover resolution from projection (column-major: m[col][row])
    // m[0][0] = 2/widthCss, m[1][1] = -2/heightCss
    let width = 2.0 / projection[0][0];
    let height = -2.0 / projection[1][1];
    let resolution = vec2(width, height);
    // Single-scalar division avoids aspect-ratio asymmetry on non-square canvases
    let uvOffset = (grad / gradLen) * (flags.z / resolution.y);
    let uv = (p / resolution) + uvOffset;
    let sampled = textureSample(refractionTex, refractionSamp, uv);
    finalColor = mix(sampled, winnerColor, 0.3);  // 70% sampled + 30% tint per WGSL mix semantics
  }
}
```
- **Aspect-ratio fix** (R1 review BLOCKER): divide strength by a single scalar (`resolution.y`) rather than per-axis `resolution.xy`. This keeps horizontal and vertical displacement isotropic on non-square canvases.
- **Polygon-SDF gradient note**: the polygon SDF is a true Euclidean signed distance — `length(grad) ≈ 1` everywhere except near segment vertices (where it dips). The `gradLen > 0.001` guard handles the degenerate vertex case; `grad / gradLen` is essentially a direction unit vector. `flags.z` carries the pixel magnitude.
- **Alpha note**: `winnerColor` is premultiplied alpha (renderer packs `[r*a, g*a, b*a, a]`). `sampled` from `textureSample` is straight alpha (raw `rgba8unorm` upload via `copyExternalImageToTexture` with no premultiply hint). For opaque host bitmaps (`a=1` everywhere) the difference is invisible. For bitmaps with transparency the mix produces a slight darkening — acceptable v1 trade-off; a future ward may add a premultiply pass.

### 9 — Pipeline shape unchanged; only bind group + shader extended
- `aabbPipeline` and `fusionPipeline` are both created from the shared `GPUPipelineLayout` (which references the extended BGL).
- AABB shader is unchanged — it doesn't read bindings 3/4.
- Bind group created at init time with dummy texture. `setBackgroundTexture` recreates the bind group; pipelines stay alive.

### 10 — Demo scene
`demo/scenes/refraction.html` + `refraction.ts`:
- A `<div>` rendered with bright text + a CSS gradient acts as the visual backdrop.
- `refraction.ts` paints the same content to a `<canvas>` (Canvas2D `fillText` + gradient fills), converts to `ImageBitmap` via `createImageBitmap(canvas)`, hands to `instance.setBackgroundTexture(bitmap)`.
- URL overrides: `?strength=12` (default 8), `?refraction=off` (compares against W39 fusion-only).
- Renderer-badge present (parity with `fusion.html`).
- `WebGPUUnavailableError` fallback to canvas2d with `console.warn` (parity with `fusion.html`); refraction silently absent in fallback.
- No `html2canvas` dependency (forbidden in Must-NOT).

### 11 — Cleanup + device-lost
**`destroy()` sequence** (matches existing W39 pattern at `webgpu-renderer.ts`):
```ts
destroy(): void {
  this.refractionTexture?.destroy();  // NEW: refraction cleanup
  this.particleBuffer?.destroy();
  this.entityBuffer?.destroy();
  this.projectionBuffer?.destroy();
  this.device?.destroy();
  // Null state AFTER device.destroy() so subsequent setBackgroundTexture
  // sees this.device === null and early-returns
  this.device = null;
  this.refractionTexture = null;
  this.hasUserTexture = false;
}
```
**`device.lost` handler** (extends W37's existing handler): on device-lost, also `this.refractionTexture = null` and `this.hasUserTexture = false`. The texture handle becomes invalid when the device is lost; subsequent `setBackgroundTexture` calls would otherwise try to destroy an invalid handle.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | bind_group_layout_has_five_entries | Renderer init calls `createBindGroupLayout` with 5 entries; entries at index 3 (texture) and 4 (sampler) present with fragment visibility |
| 2 | set_background_texture_creates_gpu_texture_and_rebuilds_bind_group | `setBackgroundTexture(bitmap)` calls `device.createTexture` + `copyExternalImageToTexture` exactly once with bitmap dimensions; ALSO calls `device.createBindGroup` (new BindGroup ref vs pre-call); sets `hasUserTexture = true` |
| 3 | set_background_texture_null_releases_prior_and_recreates_dummy | After `setBackgroundTexture(bitmap)` then `setBackgroundTexture(null)`: prior `GPUTexture.destroy()` called; `hasUserTexture` is false; new 1×1 dummy texture present |
| 4 | flags_z_carries_strength_when_active | Render with `refraction.enabled=true`, prior `setBackgroundTexture` call, `reducedMotion=false`: `projMatrix[18]` equals clamped strength (e.g. 8) |
| 5 | flags_z_zero_when_no_user_texture | Render with `refraction.enabled=true` but no `setBackgroundTexture` call: `projMatrix[18]` is 0 |
| 6 | flags_z_zero_under_reduced_motion | Render with `refraction.enabled=true` + texture + `reducedMotion=true`: `projMatrix[18]` is 0 |
| 7a | cpu_clamp_strength_nan | `LiquidDOM.create({ theme: { refraction: { enabled: true, strength: NaN } } })`: `RenderFrame.theme.refraction.strength` is 0 |
| 7b | cpu_clamp_strength_negative | `{ strength: -10 }`: `RenderFrame.theme.refraction.strength` is 0 |
| 8 | set_background_texture_after_destroy_is_silent | `destroy()`, then `setBackgroundTexture(bitmap)`: no throw, no `createTexture` call (early-return on null device); also: `setBackgroundTexture(null)` with already-no-user-texture: no `destroy()` call (idempotency) |
| 9 | refraction_auto_promotes_to_fusion_pipeline | Render with `refraction.enabled=true` + texture + `fusionRadius=0`: `pass.setPipeline(fusionPipeline)` called; draw arity is 1 instance (full-screen quad), NOT `frame.capacity` (per-entity quad of AABB path); `flags.y` is 0 |
| 10 | refraction_capacity_overflow_warns_once | Render with capacity > 64, `refraction.enabled=true`, texture, `fusionRadius=0`: `console.warn` fires once with message containing "refraction"; second render does NOT re-warn (`warnedRefractionCapacityFallback` flag). When BOTH `fusionRadius>0` AND refraction at over-capacity: only fusion warn fires (not refraction warn) |

## Must NOT
- Pull `html2canvas` or any DOM-rasterization dependency into the library or demo
- Refract aggressively enough at default `strength=8` to make hover/focus text unreadable
- Allocate per-frame GPU resources (texture creation only on `setBackgroundTexture`)
- Recreate the pipeline on `setBackgroundTexture` (only the bind group is recreated)
- Break W37/W38/W39 tests — bind group layout extension must be backward-compatible at the shader level (AABB shader doesn't reference bindings 3/4)
- Read `window.matchMedia` or any DOM API from the renderer — reduced-motion flows through `RenderFrame.reducedMotion` only

## Must DO
- Maintain the W36 Renderer interface contract — `setBackgroundTexture` is exposed on `LiquidDOM` instance; on Canvas2D path it logs once via `console.warn` then becomes a silent no-op (`hasWarnedCanvas2DRefraction` flag)
- Respect `prefers-reduced-motion` at the renderer layer (via `RenderFrame.reducedMotion`, not direct DOM reads)
- Idempotent destroy + idempotent setBackgroundTexture (W14 invariant): post-destroy calls are silent no-ops; null-then-null and null-when-no-user-texture are no-ops
- Document the host-supplied-snapshot pattern in the demo's `<p class="note">` with a 10-line example referencing `createImageBitmap`
- Preserve W39's shared `GPUBindGroupLayout` + `GPUPipelineLayout` invariant (Decision §72): one BGL, two pipelines
- Update the capacity-change bind-group rebuild in `webgpu-renderer.ts` to include bindings 3+4

## Verification
1. `npm run dev` → open `http://localhost:3000/scenes/refraction.html` in Chrome 113+
2. Expected: 4 blobs over a Lorem-ipsum-textured backdrop. Each blob shows a refracted, lensed version of the text behind it.
3. URL `?refraction=off`: blobs render as solid color (no refraction); proves opt-in.
4. URL `?strength=20`: refraction is stronger (visible UV warp at edges).
5. URL `?renderer=canvas2d`: blobs render as solid color (refraction silently absent in fallback); proves WebGPU-only design. Canvas2D path logs the no-op warning once.
6. Toggle macOS "Reduce motion" preference: refraction disappears even with `refraction.enabled=true`.
7. `cargo test && npm test` → all 281 prior tests + 10 W40 tests = 291 tests green.
8. `cargo clippy` → 0 warnings.
9. Resize the window while refraction is active: bind-group rebuild path runs without validation errors (capacity-change BGL rebuild includes bindings 3+4).
