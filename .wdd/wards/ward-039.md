---
ward: 39
revision: null
name: "Metaball Fusion Shader"
epic: "webgpu-rendering"
status: "complete"
dependencies: [38]
layer: "typescript"
estimated_tests: 7
created: "2026-05-10"
completed: "2026-05-17"
---
# Ward 039: Metaball Fusion Shader

## Revision history
- **r1** — initial fleshed-out spec.
- **r2** (this revision) — addresses 5 must-fix + 7 should-fix findings from 3 parallel reviews:
  - **F1 fix (RenderFrame.theme.fusionRadius optional):** R1 had `fusionRadius: number` as required → breaks every existing inline `RenderFrame.theme` fixture in `renderer-abstraction.test.ts` + `webgpu-sdf.test.ts`. r2: type as `fusionRadius?: number`. Renderer reads `frame.theme.fusionRadius ?? 0`. Existing tests stay green at `tsc`.
  - **F2 fix (CRITICAL — explicit `GPUPipelineLayout` for both pipelines):** `layout: "auto"` produces pipeline-specific bind-group layouts even when bindings are structurally identical. Decision §9's "shared bindGroup across two `auto` pipelines" would silently fail in real WebGPU (mock tests don't catch this). r2: gold builds ONE `GPUBindGroupLayout` explicitly + ONE `GPUPipelineLayout`, passes it to both `createRenderPipeline` calls. ~15 LOC addition; saves W39.1 retrofit + makes W40's 4th binding (sampler+texture) trivial to add.
  - **F3 fix (Must-NOT addition):** "Do not change `entityBuffer` from `storage` to `uniform`." R4's storage-buffer OOB-returns-zero relies on storage semantics. Lock against accidental change.
  - **F4 fix (W40 forward-compat lock):** added explicit note that W40 refraction reads the WINNER entity's SDF gradient — color and refraction stay on the same entity to avoid midpoint double-flicker.
  - **F5 fix (sdPolygon signature already correct in W38):** review #2 alleged a mismatch but both W38's `sdf-helpers.wgsl.ts` and `blob-sdf.wgsl.ts` use the 3-arg `sdPolygon(p, base, count)`. r1's W39 shader matches. No code change needed; documenting that the alleged mismatch was a review misread.
  - **m1 fix (CPU clamp + validation):** `LiquidDOM.create()` clamps `fusionRadius = Math.max(0, isFinite(raw) ? raw : 0)`. NaN/Infinity from a buggy consumer no longer poisons the uniform. Defense-in-depth at the boundary.
  - **m2 fix (epsilon-stable winner comparison):** shader uses `if (d < minD - 0.001)` instead of `if (d < minD)`. Suppresses 1-px color flicker at the smin midpoint where FP rounding decides winners.
  - **m3 fix (dead consts removed):** `INV_PROJ_W` and `INV_PROJ_H` in r1's fusion shader were unreferenced (the inverse-projection does its own `* 0.5`). Removed.
  - **m4 fix (Test 3 byte offset wording):** r1 had a parenthetical typo saying "offset 64 is flags.x" while pointing at offset 68 for fusionRadius. Both are correct individually (flags.x is indeed at 64; flags.y is at 68). r2 wording clarifies that fusionRadius lives at byte offset 68 (= flags.y).
  - **m5 fix (T5 NEW — bind-group reuse):** added a fifth test asserting that the same `bindGroup` reference is passed to `pass.setBindGroup` across consecutive AABB+fusion renders. Locks Decision §9 (bind-group sharing) at the renderer level, which is now MORE load-bearing post-F2 fix.
  - **m6 fix (manual smoke caveat):** explicit pass-criterion that standalone blobs at `fusionRadius = 60` still show 16-facet silhouette (smin self-blend is invisible at this scale). Calibrates user expectation: fusion smooths the MERGE zone, not the standalone polygon outline.
  - **m7 fix (LiquidOptions namespace note):** documented that `theme.fusionRadius` lives under a nested `theme` object while `colorDefault`/`colorHover`/`colorSource` stay flat. Deliberate inconsistency for now; future cleanup ward can flatten or unify before public 1.0. Spec calls this out so reviewers don't re-discover.

## Scope
Adjacent entities visually merge into a single "goo" blob via smooth-min (`smin`) blending of their signed-distance fields. The smin operator smoothly interpolates between two SDFs near their boundary instead of taking the hard `min` — when two blobs are close, their isosurfaces merge into one continuous shape; when far apart, they look unchanged. Classic metaball math, applied per-fragment in the WebGPU path.

This ward delivers the **smooth-curve silhouette** that W38 deliberately left as a known limitation (Decision §3 polygon-SDF). Even when `fusionRadius=0`-effective and entities don't actually fuse, the `smin` formula degenerates to `min` and the per-entity 16-vertex polygon outline gets blended with itself ever-so-slightly — producing the same anti-aliased polygon as W38. To get TRULY smooth single-blob silhouettes (matching Canvas2D parity), `fusionRadius > 0` is required (the smin term spreads the SDF gradient across particles, rounding the 16-facet polygon into a continuous curve).

Out of scope:
- Replacing W38's per-entity AABB pipeline. W38 stays as the `fusionRadius === 0` (default) renderer. W39 adds a SECOND pipeline (full-screen quad) that activates only when fusion is on.
- Compute-shader pre-pass for neighbor pairs. v1 iterates ALL active entities per fragment in the full-screen pass. CPU pre-pass deferred (Decision §3 — smin's exponential falloff naturally handles "far apart" entities at near-zero perf cost).
- Per-entity fusion-radius. v1 is a global `theme.fusionRadius` for the whole instance.
- Fusion across renderers. WebGPU-only. Canvas2D path is unchanged (no smin operation available without rebuilding the renderer).
- Fusion with droplets. v1: droplets DO fuse with soft-bodies (data is there per W38 §17). If visually wrong in smoke, W39.1 adds a flag to exclude.
- `fusionStrength` parameter. v1 hardcodes the smin "softness" derived from `fusionRadius`. `fusionStrength` is reserved in the spec but unused — added in a future ward if needed.

## Inputs
- W38 `WebGPURenderer` (`packages/core/ts/src/renderers/webgpu-renderer.ts`).
- W38 SDF helpers (`packages/core/ts/src/renderers/shaders/sdf-helpers.wgsl.ts`) — `sdSegment`, `sdPolygon`, `sdRoundedRect`. Decision §15 anticipated reuse.
- W38 `EntityGPU` storage buffer layout (64 bytes per entity).
- W38 global uniform layout (80 bytes, `mat4x4 projection + vec4 flags`). `flags.y` reserved for `fusionRadius` (W38 §10).
- W38 `BLOB_SDF_WGSL` for the AABB-per-entity pipeline (kept as the default).
- `LiquidOptions` from `packages/core/ts/src/index.ts`. Extends with `theme.fusionRadius?: number` (W37 §18 — additive extension of `RenderFrame.theme`).
- `RenderFrame.theme` from W36 (`packages/core/ts/src/renderers/renderer.ts`). Extends with `fusionRadius` field. `observer.buildFrame()` passes it through from `LiquidOptions`.

## Outputs
- New file `packages/core/ts/src/renderers/shaders/fusion-sdf.wgsl.ts` — full-screen quad vertex shader + smin-blending fragment shader. Imports `SDF_HELPERS_WGSL` via the same string-concatenation pattern as W38's `blob-sdf.wgsl.ts`.
- Edit `packages/core/ts/src/renderers/webgpu-renderer.ts`:
  - Build a SECOND render pipeline at `init()` time using `FUSION_SDF_WGSL`. Two pipelines coexist; the bind group is shared (same EntityGPU/particles/globals buffers).
  - In `render()`, branch on `frame.theme.fusionRadius > 0` to pick the pipeline.
  - Write `frame.theme.fusionRadius` into `projMatrix[17]` (= `globals.flags.y`) per frame.
  - In fusion pipeline: `pass.draw(6, 1, 0, 0)` — single full-screen quad. In AABB pipeline: `pass.draw(6, frame.capacity, 0, 0)` — unchanged from W38.
  - Capacity safety valve: if `fusionRadius > 0 && frame.capacity > 64`, fall back to the AABB pipeline + once-per-session `console.warn`. Prevents the worst-case `capacity × 16 × screen-area` from running away on very large instances.
- Edit `packages/core/ts/src/renderers/renderer.ts`:
  - Extend `RenderFrame.theme` with `fusionRadius: number` (default 0). Additive type-level extension; existing renderers ignore it.
- Edit `packages/core/ts/src/index.ts`:
  - Extend `LiquidOptions` with `theme?: { fusionRadius?: number }` (move existing color/source theme fields into the new object OR add a separate `fusion?: { radius?: number }` field — see Decision §6).
  - Pass `fusionRadius` through to the `PhantomObserver` constructor.
- Edit `packages/core/ts/src/phantom-observer.ts`:
  - Add `fusionRadius` to `PhantomObserverOptions` and stash on the observer.
  - Include it in `buildFrame()`'s returned `theme.fusionRadius` field.
- New demo scene `demo/scenes/fusion.html` + `fusion.ts` showing 4 buttons near each other with `theme: { fusionRadius: 60 }`. Manual smoke = visible merging between adjacent buttons.
- 4 new tests in `packages/core/ts/__tests__/webgpu-fusion.test.ts`.

## Decisions (locked in this spec)

### Pipeline strategy

1. **Two pipelines coexist; runtime branch on `fusionRadius`.** W38 `BLOB_SDF_WGSL` AABB-per-entity pipeline stays as the `fusionRadius === 0` path. W39 adds `FUSION_SDF_WGSL` full-screen pipeline. Both share bind group layout + the same `entityBuffer`, `particleBuffer`, `projectionBuffer`. Branch in `render()`:
   ```ts
   const useFusion = frame.theme.fusionRadius > 0 && frame.capacity <= 64;
   const pipeline = useFusion ? this.fusionPipeline : this.aabbPipeline;
   if (useFusion) pass.draw(6, 1);
   else pass.draw(6, frame.capacity);
   ```
   Rationale: single-pipeline approaches (one shader that branches internally) either pay full-screen cost always OR ship dead code. Two pipelines keep the W38 fast path untouched and isolate fusion's overhead.

2. **Capacity safety valve at 64 with `fusionRadius > 0` → fall back to AABB pipeline + warn.** Reason: the fusion fragment shader iterates ALL active entities per fragment. At capacity 64 × 16-segment SDF = 1024 SDF evaluations per fragment. At 1080p = ~2B ops/frame. Acceptable on mid-range GPU. At capacity 128 → 4B ops/frame, borderline. At capacity 256 → 8B ops/frame, unacceptable. Cap at 64 for fusion; consumer can lower their explicit `capacity` if they want fusion at scale. Falls back to AABB-per-entity (still rendered, just no fusion) with a single `console.warn("fusion disabled at capacity > 64")` per session.

### Smin math

3. **Quadratic polynomial smin, NOT exponential.** Formula:
   ```wgsl
   fn smin(a: f32, b: f32, k: f32) -> f32 {
     let h = max(k - abs(a - b), 0.0) / k;
     return min(a, b) - h * h * k * 0.25;
   }
   ```
   Properties: degenerates to `min(a, b)` when `k → 0` (no fusion). Smoothly blends when `|a - b| < k`. C2-continuous (smooth first derivative → no visible seams). Faster than exponential `-log(exp(-ka) + exp(-kb)) / k` (no transcendentals; no `k=0` divide-by-zero — guarded by spec to call only when `k > 0` per Decision §1). Visually equivalent to exp-smin for k < ~50 px (typical fusion radii).

4. **Fragment shader iterates ALL active entities, smin-accumulating into one global SDF.** Per fragment:
   ```wgsl
   var sdf: f32 = 1e9;
   for (var i: u32 = 0u; i < entityCount; i = i + 1u) {
     if (entities[i].color.a == 0.0) { continue; }
     let d = sdPolygon(p, i * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
     sdf = smin(sdf, d, globals.flags.y);
   }
   ```
   The `1e9` initial value ensures `smin(1e9, d, k) ≈ d` for any reasonable `d` (since `|1e9 - d| >> k` makes the smin term collapse to `min`). Inactive entities skip-continue so they don't contaminate the smin accumulator. The smin's exponential falloff naturally handles "far apart" entities at no perf cost — no CPU neighbor-pair pre-pass needed.

5. **Color from `min`-winning entity, NOT blended.** During fragment iteration, track which entity contributed the minimum `d`:
   ```wgsl
   var winnerId: u32 = 0u;
   var minD: f32 = 1e9;
   for (...) {
     let d = sdPolygon(...);
     if (d < minD) { minD = d; winnerId = i; }
     sdf = smin(sdf, d, ...);
   }
   let color = entities[winnerId].color;
   ```
   Reason: blending colors via smin gives a smooth but visually noisy gradient between neighbour blobs. Hard color boundary at the smin midpoint produces a cleaner aesthetic (matches Shadertoy reference implementations). The smoothness comes from the SDF blending; color stays per-entity. Future ward could add `theme.fusionColorBlend: boolean` for the smooth-blend variant.

### Globals + storage

6. **Theme extension as flat fields on `LiquidOptions.theme`, NOT a nested `fusion` object.** Current W37 LiquidOptions has `colorDefault`/`colorHover`/`colorSource` as top-level fields. Decision: keep that pattern; add `theme?: { fusionRadius?: number }` as a peer with explicit `theme` namespace. Slight inconsistency with existing flat layout but matches the W37 §18 spec language ("theme.fusionRadius"). Implementation:
   ```ts
   interface LiquidOptions {
     // ...existing flat color fields...
     theme?: { fusionRadius?: number };
   }
   ```
   `LiquidDOM.create()` resolves `options.theme?.fusionRadius ?? 0` and passes through to `PhantomObserver`. `buildFrame()` returns it on `RenderFrame.theme.fusionRadius`.

7. **`fusionRadius` lives in `globals.flags.y`** (W38 §10 reserved slot). CPU writes it per frame:
   ```ts
   this.projMatrix[17] = frame.theme.fusionRadius ?? 0;
   ```
   No buffer-size change needed. `globals.flags.y` is read by the fusion shader as the smin `k` parameter.

8. **`flags.z`/`flags.w` remain reserved** (W40 refraction strength + 1 more slot).

### Pipeline + bind group sharing

9. **Both pipelines share an EXPLICIT `GPUPipelineLayout` (r2 F2 critical fix).** `layout: "auto"` produces pipeline-specific bind-group layouts that are NOT interchangeable, even when bindings are structurally identical. To share one `bindGroup` between the AABB and fusion pipelines (which is what Decision §9 requires), gold MUST create:
   ```ts
   const bindGroupLayout = device.createBindGroupLayout({
     entries: [
       { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
       { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
       { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
     ],
   });
   const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
   // Pass `layout: pipelineLayout` (NOT "auto") to BOTH createRenderPipeline calls.
   ```
   The `bindGroup` is then created against `bindGroupLayout` directly (not `pipeline.getBindGroupLayout(0)`). Both pipelines accept the same bindGroup because they share the same layout.
   
   This is a CHANGE from W37+W38 which used `layout: "auto"`. The W37 AABB pipeline keeps working — `auto` was fine when only ONE pipeline existed. W39 needs the explicit layout for cross-pipeline bindGroup sharing. W40 will also benefit (adding a sampler+texture binding = single bindGroupLayout edit).

10. **Both pipelines built at `init()` time.** Eager creation costs ~2 ms once at startup, not per frame. Avoid lazy fusion-pipeline creation (would otherwise risk a first-fusion-frame stutter when consumer enables fusion mid-session).

### Demo scene

11. **`demo/scenes/fusion.html` + `fusion.ts` shipped in W39.** 4 small buttons (~60×60 px) arranged in a 2×2 grid with 30 px gap. `LiquidDOM.create({ theme: { fusionRadius: 60 }, renderer: 'webgpu' })`. Manual smoke: adjacent buttons visibly merge into single "goo" blobs as pointer moves between them; far-apart buttons stay separate. The `?renderer=canvas2d` fallback (default) shows the same demo without fusion (proves the v1 limitation that fusion is WebGPU-only).

### Tests

12. **Tests in NEW file `webgpu-fusion.test.ts`**, parallel to W37's `webgpu-renderer.test.ts` and W38's `webgpu-sdf.test.ts`. Reuses the `GPUBufferUsage` polyfill + WebGPU mock harness pattern from W38.

## Specification

### `fusion-sdf.wgsl.ts`
```ts
import { SDF_HELPERS_WGSL } from "./sdf-helpers.wgsl";

const SHADER_BODY = /* wgsl */ `
struct Globals {
  projection: mat4x4<f32>,
  flags: vec4<f32>,  // (preserveBackgroundsActive, fusionRadius, reserved, reserved)
};

struct EntityGPU {
  color: vec4<f32>,
  aabb: vec4<f32>,
  clipRect: vec4<f32>,
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> particles: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> entities: array<EntityGPU>;

const PARTICLES_PER_BODY: u32 = 16u;
// Maximum entities iterated per fragment. Capacity > MAX_ENTITIES falls back
// to the AABB pipeline at the renderer level (Decision §2), so this loop
// bound is always >= frame.capacity in practice.
const MAX_ENTITIES: u32 = 64u;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VOut {
  // Full-screen quad in NDC — two triangles covering [-1, 1] × [-1, 1].
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let ndc = corners[vid];
  return VOut(vec4<f32>(ndc, 0.0, 1.0), ndc);
}

// Inverse-project NDC back to CSS px so SDF math runs in world (CSS) space.
// projection is built as: x_clip = 2x/w - 1, y_clip = -2y/h + 1.
// → x_world = (x_clip + 1) * w / 2
// → y_world = (1 - y_clip) * h / 2
// We extract w, h from the projection matrix: m[0] = 2/w, m[5] = -2/h.
fn ndcToWorld(ndc: vec2<f32>) -> vec2<f32> {
  let m = globals.projection;
  let w = 2.0 / m[0][0];
  let h = -2.0 / m[1][1];
  return vec2<f32>((ndc.x + 1.0) * w * 0.5, (1.0 - ndc.y) * h * 0.5);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let p = ndcToWorld(in.ndc);
  let k = globals.flags.y;
  var sdf: f32 = 1e9;
  var winnerId: u32 = 0u;
  var minD: f32 = 1e9;

  for (var i: u32 = 0u; i < MAX_ENTITIES; i = i + 1u) {
    if (entities[i].color.a == 0.0) { continue; }
    let d = sdPolygon(p, i * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
    // r2 m2 fix: epsilon-stable comparison. Plain `d < minD` flips winner per
    // frame at the smin midpoint where d1 ≈ d2 due to FP rounding → 1-px
    // color flicker. The 0.001 epsilon is well below human visual threshold.
    if (d < minD - 0.001) { minD = d; winnerId = i; }
    sdf = smin(sdf, d, k);
  }

  // Use the winner's softness for edge AA.
  let softness = entities[winnerId].params.x;
  let alpha = 1.0 - smoothstep(-softness, softness, sdf);
  if (alpha < 0.001) { discard; }

  // preserveBackgrounds: discard fragments inside the winner's element rect.
  if (globals.flags.x > 0.5 && entities[winnerId].clipRect.z > 0.0) {
    let clipR = entities[winnerId].params.y;
    let clipSdf = sdRoundedRect(p, entities[winnerId].clipRect, clipR);
    if (clipSdf < 0.0) { discard; }
  }

  let c = entities[winnerId].color;
  return vec4<f32>(c.rgb * alpha, c.a * alpha);
}
`;

export const FUSION_SDF_WGSL = SDF_HELPERS_WGSL + SHADER_BODY;
```

### `WebGPURenderer` edits
- Add private fields: `aabbPipeline: GPURenderPipeline | null` (renamed from `pipeline`), `fusionPipeline: GPURenderPipeline | null`, `warnedFusionCapacityFallback: boolean = false`.
- In `init()`: create BOTH pipelines under the same `pushErrorScope("validation")` block. Both throw `WebGPUUnavailableError` on compile failure.
- In `render()`:
  ```ts
  const fusionRadius = frame.theme.fusionRadius ?? 0;
  const wantsFusion = fusionRadius > 0;
  const useFusion = wantsFusion && frame.capacity <= 64;

  if (wantsFusion && !useFusion && !this.warnedFusionCapacityFallback) {
    console.warn(`[liquiddom] fusionRadius set but capacity (${frame.capacity}) > 64. Fusion disabled — falling back to per-entity AABB pipeline.`);
    this.warnedFusionCapacityFallback = true;
  }

  this.projMatrix[16] = frame.viewport.preserveBackgrounds ? 1.0 : 0.0;
  this.projMatrix[17] = useFusion ? fusionRadius : 0;
  // ...

  const pipeline = useFusion ? this.fusionPipeline! : this.aabbPipeline!;
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, this.bindGroup!);
  if (useFusion) {
    pass.draw(6, 1, 0, 0);  // single full-screen quad
  } else {
    pass.draw(6, frame.capacity, 0, 0);  // per-entity AABB quad
  }
  ```
- In `destroy()`: nothing extra — pipelines are released with `device.destroy()`.

### `Renderer` interface + `PhantomObserver.buildFrame()`
**(r2 F1 fix)** `fusionRadius` is OPTIONAL in `RenderFrame.theme` to keep all existing test fixtures (inline `theme` objects in `renderer-abstraction.test.ts`, `webgpu-sdf.test.ts`, etc.) typecheck without modification. Renderers read `frame.theme.fusionRadius ?? 0`.
```ts
// renderer.ts:
export interface RenderFrame {
  // ...existing fields...
  theme: {
    colorDefault: string;
    colorHover: string;
    themeCache: Map<number, string>;
    shadowCache: Map<number, ShadowMargin>;
    /** Ward 039 metaball fusion. Optional — undefined treated as 0 (no fusion). */
    fusionRadius?: number;
  };
}

// phantom-observer.ts:
buildFrame(viewport: RenderFrameViewport): RenderFrame {
  return {
    // ...existing fields...
    theme: {
      colorDefault: this.colorDefault,
      colorHover: this.colorHover,
      themeCache: this.themeCache,
      shadowCache: this.shadowCache,
      fusionRadius: this.fusionRadius,  // NEW
    },
  };
}
```

### `LiquidOptions` + `LiquidDOM.create()` wire-up
```ts
// index.ts:
export interface LiquidOptions {
  // ...existing fields...
  theme?: {
    /**
     * Ward 039 metaball fusion radius in CSS px. When > 0, adjacent entities
     * visually merge via smooth-min (`smin`) SDF blending. Default 0 (no fusion).
     * Capacity > 64 disables fusion + logs a one-time warning. WebGPU only.
     */
    fusionRadius?: number;
  };
}

// In create():
// r2 m1 fix: clamp + validate. NaN/Infinity from buggy consumer no longer
// poisons the uniform.
const rawFusion = options?.theme?.fusionRadius ?? 0;
const fusionRadius = Number.isFinite(rawFusion) ? Math.max(0, rawFusion) : 0;
const observer = new PhantomObserver(capacity, {
  colorDefault: options?.colorDefault,
  colorHover: options?.colorHover,
  // ...
  fusionRadius,
});
```

### Demo scene
- `demo/scenes/fusion.html` — minimal HTML: 4 buttons in a 2×2 grid, each `data-liquid`, ~60×60 px with 30 px gap, body bg dark.
- `demo/scenes/fusion.ts`:
  ```ts
  await LiquidDOM.create({
    capacity: 8,
    autoObserve: true,
    renderer: "webgpu",
    theme: { fusionRadius: 60 },
    physics: { ...presets.jelly, tension: 80 },
  });
  ```
- `?renderer=canvas2d` URL override to see the non-fused version side by side.

## Tests

All in new file `packages/core/ts/__tests__/webgpu-fusion.test.ts`. Reuses W38's WebGPU mock harness pattern (`GPUBufferUsage` polyfill + device + queue + pass mocks).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `fusion_disabled_uses_aabb_pipeline_when_fusionRadius_is_zero` | Render with `frame.theme.fusionRadius = 0`. Capture `passEncoder.setPipeline` arg + `passEncoder.draw` args. Assert pipeline is the AABB one (not fusion) AND `draw(6, frame.capacity, 0, 0)`. Locks Decision §1 default path: zero fusion → W38 behavior unchanged. |
| 2 | `fusion_enabled_uses_fullscreen_pipeline_and_single_instance` | Render with `frame.theme.fusionRadius = 30` and `frame.capacity = 4`. Assert pipeline is the fusion one AND `draw(6, 1, 0, 0)`. Locks Decision §1 fusion path: positive fusion → switch pipeline + single full-screen quad. |
| 3 | `fusion_radius_written_to_uniform_flags_y` | Render with `fusionRadius = 25`. Capture `queue.writeBuffer` to the projection uniform (byteLength 80). Decode float at byte offset 68 (4 bytes after the mat4x4, offset 64 is flags.x). Assert it equals 25. Then render with `fusionRadius = 0` and assert offset 68 equals 0. Locks Decision §7. |
| 4 | `fusion_capacity_safety_valve_falls_back_above_64` | Construct `frame.capacity = 128` with `fusionRadius = 30`. Render. Assert the AABB pipeline was used (`draw(6, 128, 0, 0)`, NOT `draw(6, 1, 0, 0)`). Also spy on `console.warn` and assert it fired ONCE on the first such frame, then a second render with capacity 128 + fusion does NOT re-warn (once-per-session). Locks Decision §2 safety valve. |
| 5 | `fusion_and_aabb_pipelines_share_one_bindGroup` | (r2 m5 NEW.) Render two frames: one with `fusionRadius = 0` (AABB path), one with `fusionRadius = 30, capacity = 4` (fusion path). Capture `passEncoder.setBindGroup` arg for each frame. Assert both calls received the **same object reference** (`===`). Locks Decision §9: the explicit `GPUPipelineLayout` + `GPUBindGroupLayout` shared between both pipelines actually shares the bindGroup, NOT two independent layout-derived bindGroups. Critical now that Decision §9 promotes to explicit layout (r2 F2 fix). |

After W39: 274 + 5 = **279 tests** (55 Rust + 224 TS).

### Test #3 byte-offset clarification (r2 m4)
Test #3 decodes the float at byte offset **68** from the captured projection-buffer write. The layout is: `mat4x4` occupies bytes 0..63 (16 floats × 4 bytes); `flags.x` (preserveBackgroundsActive) at bytes 64..67; `flags.y` (fusionRadius) at bytes 68..71. r1's parenthetical "(4 bytes after the mat4x4, offset 64 is flags.x)" was syntactically correct but confusingly placed at the same line as "offset 68"; r2 clarifies fusionRadius is at byte offset 68.

## Risks & Mitigations

- **R1: Performance cliff at capacity ≤ 64 but with overlapping fullscreen AABBs.** Decision §2's cap is on capacity, NOT on individual entity sizes. A consumer using `capacity: 8` with 8 fullscreen-sized elements (rare but possible) still pays 8 × 16 SDF evaluations per fragment × 2M fragments at 1080p = ~256M ops. Acceptable. The real cliff is multiple full-screen elements with high fusionRadius, but those are intentional aesthetic choices.

- **R2: `1e9` SDF initial value precision loss.** `smin(1e9, d, k)` where `d` is in CSS px range (typically 0–1000) and k is small (30–60): the smin's `max(k - |1e9 - d|, 0)` term is 0 → result = min(1e9, d) = d. Verified: no precision degradation since the smin branch falls through to `min`. Could be smaller (e.g. `1e6`) but `1e9` is conservative.

- **R3: Color snap at smin midpoint.** Decision §5 picks the entity with the smallest unblended distance for the fragment color. At the smin midpoint between two neighbour blobs (where `d1 = d2`), the winner ID can flip frame-to-frame based on FP rounding, causing 1-pixel-wide color flicker. Mitigation: in practice the midpoint is a single curve through the merged blob and the color flip is invisible at >5px fusionRadius (smin transition zone is wider than the FP noise band). Document as known minor; v2 could add fade-blending.

- **R4: WGSL `for` loop with `MAX_ENTITIES` constant vs runtime `frame.capacity`.** Decision §4 hardcodes `MAX_ENTITIES = 64` in the shader. Inactive slots `continue;` early, so the work past `frame.capacity` is just `entities[i].color.a == 0.0` test (one storage read, one compare) per fragment. ~64 × 4 ops = 256 ops worst case for inactive iterations. Negligible. Could use a uniform `entityCount` instead, but storage-buffer-driven loop bounds add complexity without measurable perf win at this scale.

- **R5: preserveBackgrounds in fusion mode.** The fusion shader carves clip-hole using the WINNER entity's `clipRect`. If two entities have overlapping merged region but different clipRects, the carved hole flickers between the two rects at the midpoint. Mitigation: smin's smoothing zone is narrow (~30 px) and consumer typically uses fusion either among same-shape elements OR among elements far enough apart that the merge zone is OUTSIDE both clip-holes. Document as expected behavior; v2 can do per-rect clip-multiply.

- **R6: Bind group sharing between pipelines.** Decision §9 says both pipelines use the same bind group. WebGPU spec: bind groups are matched against pipeline layouts by structural compatibility (binding indices, types, visibility, storage access). Both pipelines have identical bind-group declarations in their WGSL (the entire WGSL prelude is shared via `SDF_HELPERS_WGSL`), so layouts match. Verified by `layout: "auto"` pattern from W37/W38. If `auto` produces incompatible layouts, gold catches via shader-compile validation (W37 path E error scope).

- **R7: `console.warn` once-per-session for the capacity fallback.** State held on the renderer instance. Multiple `LiquidDOM.create()` calls in one page lifetime each get their own warn-once. Acceptable — a consumer who creates+destroys+creates expects to be reminded each time they hit the cap.

- **R8: Fragment shader compile failure on some adapters.** WGSL features used: `for` loop with runtime bound (Decision §4), storage buffer `array<EntityGPU>` (W38), conditional `discard`. All WGSL core spec features; no adapter-specific extensions required. R8 from W37 (preferred-format/-srgb support) still applies but is renderer-level, not pipeline-level — no new risk in W39.

## Must NOT

- Run an O(N²) CPU loop per frame. Fusion math lives entirely in the fragment shader; CPU just packs entities + writes uniforms.
- Break Canvas2D path. Canvas2DRenderer ignores `theme.fusionRadius` entirely. The `Renderer` interface adds an optional field; canvas2d-renderer.ts doesn't change.
- Allocate per-frame GPU buffers. Both pipelines share the existing buffer pool from W38.
- Replace the W38 AABB pipeline. The full-screen fusion pipeline is ADDITIVE. Default (`fusionRadius = 0`) uses W38 unchanged.
- Implement `theme.fusionStrength` — v1 reserves the name without behavior.
- Implement per-entity fusion radius. v1 is one global value.
- Add new `LiquidOptions` fields outside the `theme` namespace.
- Touch Rust, Cargo.toml, or any FFI shape.
- Implement a CPU neighbor-pair pre-pass. Smin's natural falloff handles distance; pre-pass is premature optimization.
- **(r2 F3 fix) Change `entityBuffer` from `storage` to `uniform` buffer type.** The fusion shader's `MAX_ENTITIES = 64` loop reads past `frame.capacity` for inactive slots; WebGPU's robust-buffer-access guarantee says STORAGE buffer OOB reads return zeroed values (allowing the `color.a == 0` skip-continue). Uniform buffers have stricter OOB semantics (undefined behavior on some adapters). Keep storage.
- Use `layout: "auto"` for the W39 pipelines (r2 F2 fix). Decision §9 explicitly requires an EXPLICIT `GPUPipelineLayout` + shared `GPUBindGroupLayout`. `auto` produces pipeline-specific BGLs that aren't interchangeable, breaking Decision §9's shared-bindGroup design.

## Must DO

- All 274 existing tests continue to pass.
- 4 new tests (T1-T4) pass.
- `npm run build` produces 0 TS errors. `cargo clippy` 0 warnings.
- Manual smoke test on `demo/scenes/fusion.html` with `?renderer=webgpu`: 4 buttons in a 2×2 grid visibly merge their silhouettes when adjacent. Same demo with `?renderer=canvas2d` shows the un-fused (per-element) version for visual A/B.
- W38's existing manual smoke tests (playground, all demo scenes) continue to render identically — fusion off by default.
- The new `theme.fusionRadius` option appears in the public `LiquidOptions` type and is documented (one JSDoc paragraph above the field).
- **(r2 m6)** Manual smoke shows that STANDALONE blobs at `fusionRadius = 60` still display 16-facet polygon silhouette (smin self-blend is invisible at non-merging entities). Fusion smooths the MERGE zone, not the standalone outline.
- **(r2 m7)** `theme.fusionRadius` lives under a nested `theme` object while `colorDefault`/`colorHover`/`colorSource` stay flat on `LiquidOptions`. Deliberate inconsistency for v1; future cleanup ward can unify before 1.0.

## Manual Smoke Test

### Setup
```
npm run build:ts
npm run dev
```

### Steps
1. Open `http://localhost:3000/scenes/fusion.html` (Chrome 113+).
   Expected: 4 buttons in a 2×2 grid. Adjacent buttons visibly merge into goo shapes — the gap between top-left and top-right is filled by a smooth bridge of blob.
2. Open same URL with `?renderer=canvas2d`.
   Expected: 4 separate buttons, no merging (fusion is WebGPU-only). Proves the v1 limitation.
3. Switch to `?renderer=webgpu&preserveBackgrounds=true`.
   Expected: button backgrounds carved out; the merged goo silhouette wraps AROUND the elements correctly.
4. Open `playground.html?renderer=webgpu` (no fusionRadius). 
   Expected: unchanged from W38. Polygon-with-AA edges, no merging. Confirms default backwards-compat.

### Pass criteria
- [ ] Adjacent buttons merge visibly into single blob in fusion.html
- [ ] Far-apart buttons stay visually separate (smin's "far apart → min" property)
- [ ] Canvas2D fallback shows 4 separate buttons (proves opt-in design)
- [ ] preserveBackgrounds clip still works in fusion mode
- [ ] Playground default (no fusion) renders identically to W38
- [ ] No console warnings except the once-per-session capacity-fallback if intentionally testing it
- [ ] FPS stays > 60 on M-series MacBook at the demo's capacity 8

## Verification

`npm run verify` — `build + test:rust + test + clippy`. All green.
- T1-T4 lock the dual-pipeline contract + uniform write + safety valve.
- Existing 274 tests cover all error paths + W37/W38 invariants.
- Manual smoke covers the actual GPU output.

W40 (Background Refraction) builds on W39 by adding texture sampling along the SDF gradient — applies to both AABB and fusion pipelines. `theme.refraction.{enabled,strength}` is a separate additive theme field (W37 §18); reserves `globals.flags.z` (W38 §10).

**(r2 F4 forward-compat lock for W40):** W40's refraction reads the WINNER entity's SDF gradient — color and refraction stay on the same entity to avoid midpoint double-flicker. Reuses the `winnerId`/`minD` already computed for the color pick. W40 should NOT introduce a separate winner-pick for refraction; that would produce two flicker boundaries at slightly-different midpoints.

**(r2 F2 forward-compat for W40):** the explicit `GPUPipelineLayout` (Decision §9 r2) makes adding W40's sampler+texture binding a one-entry diff. W40 author just adds `binding: 3` for the sampler and `binding: 4` for the texture to the existing `bindGroupLayout`, then updates both pipelines + bindGroup. No `auto`-layout retrofit needed.
