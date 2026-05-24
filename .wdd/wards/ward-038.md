---
ward: 38
revision: null
name: "SDF Blob Fragment Shader"
epic: "webgpu-rendering"
status: "complete"
dependencies: [37]
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: "2026-05-16"
---
# Ward 038: SDF Blob Fragment Shader

## Revision history
- **r1** — initial fleshed-out spec.
- **r2** (this revision) — addresses 4 blockers, 5 should-fix, 3 forward-compat findings from 3 parallel reviews:
  - **F1 fix (Decision §10 amended):** `projMatrix = Float32Array(16)` would silently no-op the flag write because TypedArrays don't auto-grow on out-of-bounds index. Locked: `Float32Array(20)`, `projectionBuffer` size bumped 64→80, `writeBuffer` byteLength = 80. Without this, `preserveBackgrounds` clip would compile + run but never activate.
  - **F2 fix (Outputs):** `FLOATS_PER_ENTITY_GPU` is **16** (was misdocumented as 12). Pack writes 16 floats = 64 bytes per entity, matching Decision §6's 4 × vec4 layout. Test #2 size assertion `capacity × 64` was correct; the Outputs narrative was wrong.
  - **F3 fix (Decision §10b NEW):** explicit callout that the projection buffer's `createBuffer({size: 80})` in `init()` replaces W37's `size: 64`. Without this, `writeBuffer` with byteLength 80 would overflow the GPU allocation → WebGPU validation error every frame.
  - **F4 fix (CPU packing):** explicit droplet AABB pack code added. Droplets compute `aabb = (cx - r - softness, cy - r - softness, cx + r + softness, cy + r + softness)` where `cx, cy = slot[0..1]` and `r = slot[2] / 2`. Implicit "zeros" would have produced a zero-area on-screen quad, not the intended off-screen collapse.
  - **F5 fix (shader comment):** `sdPolygon` uses **even/odd crossing rule** (Jordan-curve test), NOT winding number. Comment updated. The algorithm is correct for simple polygons; self-intersecting polygons during fast deformation (R2) produce visible "tears" — that's an even/odd property, not a bug.
  - **F6 fix (pack pseudocode):** border-radius clamp `Math.min(radius, Math.min(w, h) / 2)` now appears in the pack pseudocode, not just in R3. Mirrors `clampClipRadius` from W53 Canvas2D path.
  - **F7 fix (Must DO):** explicit "delete `warnedPreserveBg` field and its `render()` guard" line added.
  - **F8 fix (Test #4 wording):** "byte at offset 64" replaced with explicit `new Float32Array(buffer, 64, 1)[0]` decoder pattern. Avoids false-passing test where reading a single byte at offset 64 returns 0x00 for both 0.0 and 1.0 (little-endian).
  - **m1 fix (Decision §15 NEW):** SDF helpers (`sdSegment`, `sdPolygon`, `sdRoundedRect`) extracted to `sdf-helpers.wgsl.ts` so W40 refraction can reuse them without retrofitting. Pure mechanical move during W38; expensive to retrofit later.
  - **m2 fix (Decision §16 NEW):** documented that `particleBuffer` and `entityBuffer` are RENDERER-owned (lifecycle tied to `WebGPURenderer` instance), not pipeline-owned. W39's full-screen fusion pipeline shares these buffers with the W38 per-entity pipeline.
  - **m3 fix (R9 soften):** removed "CCW emit" claim. After projection Y-flip the AABB-quad winding flips to CW in clip space, but `cullMode: "none"` makes winding irrelevant. Updated wording: "winding-agnostic until W39".
  - **m4 fix (R1 amended):** added worst-case overdraw note for capacity 128 + overlapping near-fullscreen AABBs (N × screen-area rather than summed). Typical usage stays comfortably within budget.
  - **m5 fix (W39 droplet eligibility):** explicit note that droplet fusion eligibility is deferred to W39 — W38 packs full AABBs for droplets so the W39 author can choose.

## Scope
Replace W37's polygonal triangle-fan geometry with a signed-distance-field fragment-shader pass. Each entity becomes a soft-edged blob whose silhouette is computed per-fragment from its 16 perimeter particles via a signed-distance-to-polygon evaluation + `smoothstep` for anti-aliased edges. The visible payoff over W37: smooth curved silhouettes (matching or exceeding Canvas2D's midpoint-quadratic-spline output), no polygon facets, no fan-overlap-blending artifact (R3 in W37).

This ward ALSO lands `preserveBackgrounds: true` clip support for the WebGPU path — a hard requirement per W37 Decision §10. The clip is implemented as a fragment `discard` against the element's rounded rect (computed from `slot[0..3]` + `slot[8]` border-radius). Same SDF infrastructure carries both blob silhouette + clip-hole — single shader pass.

Out of scope:
- Metaball fusion / smin-blending between neighbour entities (W39).
- Background refraction (W40).
- Compute shaders for SDF acceleration. CPU computes per-entity AABB; fragment shader does its own 16-segment SDF.
- Replacing Canvas2D output. Canvas2D path is unchanged; W38 only touches the WebGPU path.
- Per-element themed colors from `themeCache`. Still global `colorDefault` / `colorHover`. (W37 §11 limitation; revisit when `themeCache` is per-entity-buffer-friendly.)
- Tunable softness / radius runtime parameters. v1 derives them from element rect dimensions (Decision §4).
- Changing the `Renderer` interface. The `RenderFrame` DTO is unchanged. All updates live inside `WebGPURenderer` + `blob.wgsl.ts` (or a new `blob-sdf.wgsl.ts`).

## Inputs
- `WebGPURenderer` from W37 (`packages/core/ts/src/renderers/webgpu-renderer.ts`).
- `BLOB_WGSL` from W37 (`packages/core/ts/src/renderers/shaders/blob.wgsl.ts`) — either replace contents or add a new module.
- `RenderFrame` DTO from W36 (`packages/core/ts/src/renderers/renderer.ts`) — `entities`, `particles`, `softBodyIds`, `dropletIds`, `viewport`, `theme`.
- Per-entity data slots in `frame.entities`: slot[0..3] = `(x, y, w, h)`, slot[4] = hover state, slot[5] = liquid_type (FreeDrop guard), slot[8] = border_radius_px (W42 / W53 — needed for preserveBackgrounds clip).
- `PARTICLES_PER_BODY = 16` constant from W36 re-export.
- W37's `EntityGPU` storage buffer layout (32 bytes: color vec4 + centroid vec2 + pad vec2). W38 extends this (Decision §5).
- W37's existing `parseColor` helper, `PREMUL_BLEND`, projection-matrix path, sRGB view format, error-scope wrapper, destroy chain — all unchanged.

## Outputs
- New file `packages/core/ts/src/renderers/shaders/blob-sdf.wgsl.ts` — SDF vertex+fragment pair. Replaces the W37 triangle-fan shader at the pipeline level.
- Edit `packages/core/ts/src/renderers/webgpu-renderer.ts`:
  - Import `BLOB_SDF_WGSL` instead of `BLOB_WGSL`.
  - Bump `FLOATS_PER_ENTITY_GPU` **8 → 16** (Decision §6 — 4 × vec4 = 64 bytes per entity).
  - Change `VERTICES_PER_BLOB` 48 → 6 (one AABB quad). Rename to `VERTICES_PER_ENTITY` to drop the "blob" geometry implication.
  - **`projMatrix = new Float32Array(20)`** (was 16 in W37). Last 4 floats are `flags = (preserveBackgroundsActive, 0, 0, 0)` per Decision §10/§10b.
  - **`projectionBuffer = device.createBuffer({ size: 80, ... })`** in `init()` (was 64 in W37).
  - CPU per-frame: compute particle AABB per active entity (soft-body + droplet). Pack into entityScratch alongside color + clipRect + softness.
  - CPU per-frame: pack `slot[0..3]` (element rect) and clamped `slot[8]` (border-radius) into the entity slot for shader-side preserveBackgrounds clip.
  - **Delete the `warnedPreserveBg` field declaration AND its `render()` guard block** — clip now works in the WebGPU path (Decision §9), so the once-per-session warn is obsolete.
- New file `packages/core/ts/src/renderers/shaders/sdf-helpers.wgsl.ts` — exports `SDF_HELPERS_WGSL` containing `sdSegment`, `sdPolygon`, `sdRoundedRect`. Imported by `blob-sdf.wgsl.ts` via string concatenation (WGSL has no `#include` — TypeScript string composition is the pattern). Decision §15 — extracted now so W40 refraction can reuse without retrofitting.
- The W37 `blob.wgsl.ts` file is DELETED (Decision §11 — no need to keep a polygon-fan fallback; W38 supersedes it). Tests reference `BLOB_SDF_WGSL` for the regression locker.
- 4 new tests in a new file `packages/core/ts/__tests__/webgpu-sdf.test.ts` (jsdom error-path style, mirroring W37's webgpu-renderer.test.ts).
- Playground manual smoke uses existing `?renderer=webgpu` URL param — after W38 it implicitly = SDF (polygon-fan is gone). No new HTML/UI changes.

## Decisions (locked in this spec)

### Geometry + pipeline

1. **Per-entity AABB quad, NOT full-screen quad.** Each active entity (soft-body + droplet) maps to a 6-vertex (2-triangle) quad covering its AABB + softness margin. The vertex shader emits the four corners of the AABB in clip space. Fragment work scoped to the entity's bounding region — O(AABB area) per fragment × 16-segment SDF math = ~16K-64K fragment shader invocations per active entity at typical sizes. Full-screen quad (W39 fusion approach) would cost N×screen-area regardless of overlap. Per-entity AABB is the right scaling for W38 since fusion is opt-in. (W37 Decision §1 amendment carried over: draw arity = 6 vertices/instance.)

2. **AABB computed CPU-side from particle min/max each frame.** Per active entity: O(16) loop over particles → `(minX, minY, maxX, maxY)`. Margin of `softness` px added on all sides so the smoothstep falloff has room to fade to 0. AABB packed into the entity storage buffer (Decision §5). Cost: 64 entities × 16 particles × 4 ops/frame ≈ 4K ops, sub-millisecond.

3. **SDF formula: signed distance to the 16-vertex polygon defined by the perimeter particles**, NOT distance to the union of 16 discs. Reason: the polygon SDF gives the canonical Canvas2D-equivalent silhouette (which is "the area enclosed by joining particles in order"). Disc-union would render bumpy "necklace" outlines, which is the W39 metaball aesthetic, not the W38 "smooth replacement for the polygon-fan" target. WGSL implementation: classic `sdSegment` per edge with sign flip via winding number / crossing count. Per fragment: 16 segment distances + 16 winding-number tests. Total: ~32 multiplies + 32 abs/sign ops per fragment.

4. **Softness derived from entity diagonal size**: `softness = max(2, min(8, sqrt(w*w + h*h) * 0.01))`. Empirical: ~1% of element diagonal, clamped to [2, 8] px. Smaller elements get tighter edges, larger get more visible falloff. Tunable in a future ward via `LiquidOptions.theme.blobSoftness?: number` (not in v1).

### Storage buffer extension

5. **`EntityGPU` extends 32 → 48 bytes** to carry AABB + clip rect (W37 Decision §18: theme is additively extensible; the buffer layout follows suit):
   ```wgsl
   struct EntityGPU {
     color: vec4<f32>,          // 16B — premultiplied rgba
     aabb: vec4<f32>,           // 16B — minX, minY, maxX, maxY (CSS px)
     clipRect: vec4<f32>,       // 16B — x, y, w, h (DOM element rect for preserveBackgrounds discard)
   };
   ```
   Total 48 bytes. std430 array stride: round_up(48, 16) = 48. CPU pack at offset `id × 12` floats:
   ```
   [r·a, g·a, b·a, a, minX, minY, maxX, maxY, rectX, rectY, rectW, rectH]
   ```
   Centroid (W37 §3) is GONE — SDF doesn't need it. The 32B → 48B bump is intentional and small (48 × 128 = 6 KB at max capacity vs. previous 4 KB).

6. **Border-radius for clip-hole packed in a separate field OR encoded in clipRect.w when negative.** Tempting to encode as `clipRect.w * -1 = -borderRadius` for cheap packing, but adds complexity. Instead, store border-radius in a 4th vec4 slot? That makes EntityGPU 64 bytes. Decision: store `clipBorderRadius` in `color.a` lower bits? No — alpha is needed for activity check.

   **Final:** add a 5th field `clipBorderRadius: f32` packed alongside softness and 2 padding floats in a final vec4. Total EntityGPU = 64 bytes. CPU pack 16 floats per entity. ~8 KB at capacity 128 — still trivial.
   ```wgsl
   struct EntityGPU {
     color: vec4<f32>,          // 16B
     aabb: vec4<f32>,           // 16B
     clipRect: vec4<f32>,       // 16B
     params: vec4<f32>,         // 16B — (softness, clipBorderRadius, 0, 0)
   };
   ```
   Total 64 bytes, std430 stride 64. (Decision §5 amended.)

### Shader semantics

7. **Fragment shader returns `vec4(rgb·alpha, alpha)` where `alpha = base_alpha * smoothstep(softness, -softness, sdf)`.** `sdf < 0` is inside the polygon, `sdf > 0` outside. Smoothstep from softness (transparent) to -softness (opaque) gives a soft anti-aliased edge. Premultiplied output matches W37 §6.

8. **Inactive slots discard at vertex stage.** If `color.a == 0`, vertex shader emits a degenerate quad (all 6 vertices at sentinel `(-99999, -99999)`). Same pattern as W37 §2, just at 6 verts instead of 48. (Alpha-zero check survives the W37 → W38 transition unchanged.)

9. **`preserveBackgrounds: true` discard.** Final fragment-shader branch: if `params.y` (clipBorderRadius) > 0 OR clipRect.zw nonzero, compute SDF of the rounded rect of the element (using `sdRoundRect` standard WGSL helper). If the fragment is INSIDE the rounded rect, `discard`. This carves a hole in the blob exactly matching the DOM element's silhouette — works for any border-radius. The conditional is gated on a uniform flag `preserveBackgroundsActive: u32` passed via the projection uniform's unused vec4 slot OR via a 4-byte addition (see Decision §10). When `false`, the discard is skipped.

10. **`preserveBackgroundsActive` flag in the global uniform buffer.** Bump globals from `mat4x4` (64 bytes) to `mat4x4 + vec4` (80 bytes — `vec4` carries `(preserveBackgroundsActive, 0, 0, 0)` so future wards W39/W40 can fill the remaining 3 slots with `fusionRadius`, `fusionStrength`, `refractionStrength` etc). std140 alignment: vec4 must align to 16 bytes, mat4x4 already 16-aligned at offset 0 with size 64, so vec4 lands at offset 64. Total 80 bytes.

10b. **(r2 NEW, F1+F3 fix) Buffer + scratch sizes locked**: `projMatrix = new Float32Array(20)` (NOT 16 — last 4 floats are the flags vec4). `projectionBuffer = device.createBuffer({ size: 80, usage: UNIFORM | COPY_DST })` (NOT 64). `queue.writeBuffer(projectionBuffer, 0, projMatrix.buffer, projMatrix.byteOffset, 80)`. Without these size bumps, TypedArray out-of-bounds writes silently no-op (the flag never gets set) AND/OR `writeBuffer` overflows the GPU allocation (validation error every frame).

### Removal of W37 polygon-fan

11. **`blob.wgsl.ts` is deleted in W38.** Reason: W37's polygon-fan was scaffolding; the SDF supersedes it. Keeping both shaders adds maintenance burden and dead code. Tests that referenced `BLOB_WGSL` get updated to `BLOB_SDF_WGSL`. The `Renderer` interface contract is unchanged — only the shader module string. (`WebGPURenderer` itself still exists, still implements `Renderer`, still throws `WebGPUUnavailableError`.) If W41 fallback ever needs a "low-fidelity WebGPU mode", it could resurrect the polygon-fan as a separate `WebGPULowFiRenderer` — but YAGNI for now.

### Tests

12. **Tests live in a NEW file `webgpu-sdf.test.ts`, NOT extending `webgpu-renderer.test.ts`.** Reason: the W37 file's tests are about error paths + lifecycle (still relevant — keep). W38 tests are about pipeline parity + AABB math + clip + buffer layout. Different focus, different file. Both files run in the same workspace; the existing 7 W37 tests stay green.

13. **Visual smoke via existing playground query-param.** No new HTML scene required. `?renderer=webgpu` after W38 implicitly = SDF (since polygon-fan is gone). The W37 badge already shows the active renderer. Manual A/B = open `?renderer=webgpu` vs default `?renderer=canvas2d` and visually compare.

14. **Frame-time target preserved**: < 4 ms on M-series MacBook at capacity 64 (from W38 stub Verification). Not testable in jsdom; manual smoke tests this. Should be trivially within budget given fragment-shader complexity scales with rendered area not capacity.

15. **(r2 NEW, m1) SDF helpers extracted to `sdf-helpers.wgsl.ts`.** `sdSegment`, `sdPolygon`, `sdRoundedRect` live in their own module exported as `SDF_HELPERS_WGSL`. `blob-sdf.wgsl.ts` does `export const BLOB_SDF_WGSL = SDF_HELPERS_WGSL + \`...\`` (string concatenation — WGSL has no preprocessor `#include`). This pre-empts W40's refraction needing the same helpers (where sampling along SDF gradient requires `sdPolygon`). Cheap to do now (~20 lines); retrofitting in W40 would require touching W38's shader.

16. **(r2 NEW, m2) Buffer ownership lives on `WebGPURenderer`, NOT on the pipeline.** `particleBuffer`, `entityBuffer`, `projectionBuffer`, and `bindGroup` are private fields of `WebGPURenderer` (already true in W37). W39's full-screen fusion pipeline will share these buffers (only the SHADER + pipeline change between W38 and W39). Document explicitly so W39's author doesn't accidentally tie buffers to a pipeline.

17. **(r2 NEW, m5) Droplet fusion eligibility deferred to W39.** W38 packs full AABBs for droplets (same code path as soft-bodies via Decision §1 — every active slot gets a quad). Whether droplets PARTICIPATE in fusion is W39's call. W38's packing leaves the door open: if W39 wants fusion across all entities, the data is there; if W39 wants to exclude droplets, it filters by liquid_type at the CPU pre-pass.

## Specification

### `blob-sdf.wgsl.ts`
```wgsl
struct Globals {
  projection: mat4x4<f32>,
  flags: vec4<f32>,  // (preserveBackgroundsActive, 0, 0, 0)
};

struct EntityGPU {
  color: vec4<f32>,
  aabb: vec4<f32>,
  clipRect: vec4<f32>,
  params: vec4<f32>,  // (softness, clipBorderRadius, _, _)
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> particles: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> entities: array<EntityGPU>;

const PARTICLES_PER_BODY: u32 = 16u;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) @interpolate(flat) entityId: u32,
  @location(1) worldPos: vec2<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VOut {
  let entity = entities[iid];
  // Two triangles: (0,1,2) + (2,1,3). Vertex layout:
  //  0 = (minX, minY)   1 = (maxX, minY)
  //  2 = (minX, maxY)   3 = (maxX, maxY)
  let quadCorner = array<vec2<f32>, 6>(
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0),
  );
  let c = quadCorner[vid];
  let pos = mix(entity.aabb.xy, entity.aabb.zw, c);
  // Inactive instance: collapse off-screen.
  var clipPos: vec4<f32>;
  if (entity.color.a == 0.0) {
    clipPos = vec4<f32>(-99999.0, -99999.0, 0.0, 1.0);
  } else {
    clipPos = globals.projection * vec4<f32>(pos, 0.0, 1.0);
  }
  return VOut(clipPos, iid, pos);
}

// Signed distance from point p to segment ab.
fn sdSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Signed distance to polygon defined by particles[base..base+16].
// Returns negative inside, positive outside.
fn sdPolygon(p: vec2<f32>, base: u32) -> f32 {
  var d = dot(p - particles[base], p - particles[base]);
  var s = 1.0;
  var j = PARTICLES_PER_BODY - 1u;
  for (var i: u32 = 0u; i < PARTICLES_PER_BODY; i = i + 1u) {
    let a = particles[base + j];
    let b = particles[base + i];
    let e = b - a;
    let w = p - a;
    let bb = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    let q = w - e * bb;
    d = min(d, dot(q, q));
    // (r2 F5) Even/odd crossing rule (Jordan curve theorem), NOT a winding
    // number — flips sign on each edge crossing. Correct for simple polygons;
    // self-intersecting polygons during fast deformation (R2) produce visible
    // tears, which is a property of even/odd, not a bug.
    let c1 = p.y >= a.y;
    let c2 = p.y < b.y;
    let c3 = e.x * w.y > e.y * w.x;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
      s = -s;
    }
    j = i;
  }
  return s * sqrt(d);
}

// Signed distance to a rounded rectangle (origin = rect.xy, size = rect.zw, radius = r).
fn sdRoundedRect(p: vec2<f32>, rect: vec4<f32>, r: f32) -> f32 {
  let center = rect.xy + rect.zw * 0.5;
  let half = rect.zw * 0.5 - vec2<f32>(r);
  let d = abs(p - center) - half;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let entity = entities[in.entityId];
  let softness = entity.params.x;
  let sdf = sdPolygon(in.worldPos, in.entityId * PARTICLES_PER_BODY);
  // Outside → alpha 0. Inside → alpha 1. Boundary → smoothstep.
  let alpha = 1.0 - smoothstep(-softness, softness, sdf);
  if (alpha < 0.001) {
    discard;
  }
  // preserveBackgrounds: carve a hole at the DOM element's rounded rect.
  if (globals.flags.x > 0.5) {
    let clipR = entity.params.y;
    let clipSdf = sdRoundedRect(in.worldPos, entity.clipRect, clipR);
    if (clipSdf < 0.0) {
      discard;
    }
  }
  let c = entity.color;
  return vec4<f32>(c.rgb * alpha, c.a * alpha);
}
```

### CPU-side packing in `WebGPURenderer.render()`

**Soft-body slot:**
```ts
const off = id * FLOATS_PER_ENTITY;
const x = entities[off + 0];
const y = entities[off + 1];
const w = entities[off + 2];
const h = entities[off + 3];
const rawRadius = entities[off + 8];
// r2 fix F6: clamp border-radius to min(w, h) / 2 (mirrors W53 Canvas2D path).
const radius = Math.min(rawRadius, Math.min(w, h) / 2);

// Compute particle AABB.
const pBase = id * PARTICLES_PER_BODY * 2;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (let i = 0; i < PARTICLES_PER_BODY; i++) {
  const px = particles[pBase + i * 2];
  const py = particles[pBase + i * 2 + 1];
  if (px < minX) minX = px;
  if (py < minY) minY = py;
  if (px > maxX) maxX = px;
  if (py > maxY) maxY = py;
}
const softness = Math.max(2, Math.min(8, Math.sqrt(w * w + h * h) * 0.01));
// Expand AABB by softness so smoothstep falloff has room to fade to 0.
minX -= softness; minY -= softness;
maxX += softness; maxY += softness;

const isHover = entities[off + 4] === 1.0;
const color = isHover ? colorHover : colorDefault;
const sOff = id * FLOATS_PER_ENTITY_GPU;
scratch[sOff +  0] = color[0];
scratch[sOff +  1] = color[1];
scratch[sOff +  2] = color[2];
scratch[sOff +  3] = color[3];
scratch[sOff +  4] = minX;
scratch[sOff +  5] = minY;
scratch[sOff +  6] = maxX;
scratch[sOff +  7] = maxY;
scratch[sOff +  8] = x;
scratch[sOff +  9] = y;
scratch[sOff + 10] = w;
scratch[sOff + 11] = h;
scratch[sOff + 12] = softness;
scratch[sOff + 13] = radius;
// sOff+14, +15 = padding (zero).
```

**Droplet slot (r2 fix F4):** droplets have `slot[0..1]` = particle center, `slot[2]` = diameter (NOT width). Their particles ARE laid out on a perimeter circle of radius `diameter/2` around the center (Rust `api.rs:158-162`). So the AABB is symmetric around the center. preserveBackgrounds doesn't apply (W37 §12) — clipRect is zeroed.
```ts
const off = id * FLOATS_PER_ENTITY;
const cx = entities[off + 0];
const cy = entities[off + 1];
const diameter = entities[off + 2];
if (diameter === 0) continue; // inactive
const r = diameter * 0.5;
const softness = Math.max(2, Math.min(8, diameter * 0.05));

const sOff = id * FLOATS_PER_ENTITY_GPU;
scratch[sOff +  0] = colorDefault[0];
scratch[sOff +  1] = colorDefault[1];
scratch[sOff +  2] = colorDefault[2];
scratch[sOff +  3] = colorDefault[3];
scratch[sOff +  4] = cx - r - softness;
scratch[sOff +  5] = cy - r - softness;
scratch[sOff +  6] = cx + r + softness;
scratch[sOff +  7] = cy + r + softness;
scratch[sOff +  8] = 0; // clipRect.x — droplets don't clip
scratch[sOff +  9] = 0;
scratch[sOff + 10] = 0; // w = 0 makes the rounded-rect SDF degenerate;
scratch[sOff + 11] = 0; // shader gates clip on globals.flags.x AND clipRect.zw nonzero
scratch[sOff + 12] = softness;
scratch[sOff + 13] = 0; // clipBorderRadius (unused for droplets)
// sOff+14, +15 = padding (zero).
```

### Global uniform buffer extension
Bump projection buffer 64 → 80 bytes (r2 fix F1+F3). Required code changes:
```ts
// W37: this.projMatrix = new Float32Array(16)
// W38:
this.projMatrix = new Float32Array(20);

// W37: this.projectionBuffer = device.createBuffer({ size: 64, ... })
// W38:
this.projectionBuffer = device.createBuffer({
  size: 80,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Per frame in render():
this.updateProjectionMatrix(frame.viewport.widthCss, frame.viewport.heightCss);
this.projMatrix[16] = frame.viewport.preserveBackgrounds ? 1.0 : 0.0;
this.projMatrix[17] = 0; // reserved for W39 fusionRadius
this.projMatrix[18] = 0; // reserved for W39 fusionStrength
this.projMatrix[19] = 0; // reserved for W40 refractionStrength
device.queue.writeBuffer(projBuf, 0, this.projMatrix.buffer, this.projMatrix.byteOffset, 80);
```

### Draw call change
```ts
pass.draw(VERTICES_PER_ENTITY, frame.capacity, 0, 0);
// where VERTICES_PER_ENTITY = 6 (was 48)
```

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `webgpu_sdf_pipeline_uses_aabb_quad_draw_call` | Mock the full WebGPU success chain (per W37's `makeMinimalGpu`). Instrument `passEncoder.draw` to record its arguments. After `renderer.render(frame)`, assert the first arg is `6` (was 48 in W37) and the second is `frame.capacity`. Locks Decision §1. |
| 2 | `webgpu_sdf_entityGpu_layout_is_64_bytes_per_entity` | Mock device.createBuffer to capture the `size` parameter. After init+first render with `frame.capacity = 4`, assert the `entityBuffer` was created with size `4 × 64 = 256` bytes (was `4 × 32 = 128` in W37). Locks Decision §5/§6. |
| 3 | `webgpu_sdf_aabb_packed_correctly_from_particles` | Construct a `RenderFrame` with one active entity whose 16 particles span `[100..200] × [50..150]`. Capture `queue.writeBuffer(entityBuffer, ...)` and decode the float32 region for slot 0. Assert: scratch[4..8] = `[100-softness, 50-softness, 200+softness, 150+softness]`. Softness derived from rect-diagonal per Decision §4 — compute expected value inline (rect is 200×100 → diagonal ≈ 223.6 → softness = clamp(2.236, 2, 8) = 2.236). Locks Decision §2 + §4. |
| 4 | `webgpu_sdf_uniform_includes_preserveBackgrounds_flag` | Render two frames: one with `preserveBackgrounds: false`, one with `true`. Capture `queue.writeBuffer(projectionBuffer, ...)` for each. Decode the float at byte offset 64 via `new Float32Array(capturedBuffer, 64, 1)[0]` (r2 fix F8 — single-byte read at offset 64 is ambiguous because float `0.0` and `1.0` both have low byte `0x00` on little-endian). Assert decoded value is `0.0` and `1.0` respectively. Also assert `queue.writeBuffer`'s byteLength argument is `80` (was 64 in W37) — locks the buffer-size bump from Decision §10b. |

After W38: 270 + 4 = **274 tests** (55 Rust + 219 TS). All 4 new tests TS-side. The existing 7 W37 tests stay green (error-path contracts are unchanged by W38).

## Risks & Mitigations

- **R1: SDF performance at capacity 128 + 1080p.** Each fragment in an active entity's AABB runs 16-segment SDF. Worst case: 16 entities × 800×600 px each = 7.6M fragments × ~32 ops = ~240M ops/frame. Within mid-range GPU budget. Capacity 128 with the AABB-quad strategy is fine (AABBs typically <200×200 each = ~1M fragments total). Mitigation: profile on slowest target (Intel Iris Pro circa 2017). If we need optimization, reduce particle count to 12 (~25% saving) or move to compute-shader SDF baking (defer to W39+).

- **R2: Polygon SDF winding-number for self-intersecting shapes.** During fast deformation (W31 shake, W30 drag with high velocity), the polygon defined by 16 particles can become non-simple (self-intersecting). The winding-number test in `sdPolygon` will then misclassify some interior points as exterior. Result: visible "tears" in the blob until particles re-settle. Mitigation: acceptable for v1; W39 metaball smin replaces polygon SDF with union-of-discs, which has no winding hazard. Document as visible-during-fast-deformation.

- **R3: Border-radius for preserveBackgrounds clip can exceed `min(w, h)/2`.** Slot[8] is the raw user value (W42); Canvas2D clamps via `clampClipRadius`. WGSL needs the same clamp. Add the clamp CPU-side when packing `params.y` (the clip radius field). One line.

- **R4: AABB margin underestimates particle bounds during fast motion.** Decision §2 says AABB = particle min/max + softness margin. During shake or impulse the particles can overshoot the AABB if the CPU read lags the Rust physics by a frame. Mitigation: padding via `+softness` is typically enough (~8 px). If clipped edges appear during shake, bump the margin to `softness × 2`.

- **R5: Storage-buffer alignment validation.** `EntityGPU` is 64 bytes with 4 × vec4 fields. WGSL `vec4` requires 16-byte alignment; struct stride = max member alignment × ceiling = 16-aligned 64 ✓. CPU layout (4 floats per vec4) matches. Sanity-checked by Test #2 (size = capacity × 64).

- **R6: Premultiplied alpha at SDF boundary.** Smoothstep yields fractional alpha at the edge. Premultiplied output `(rgb·a, a)` already handles fractional alpha correctly (W37 §6). The fragment shader's final multiplication `c.rgb * alpha` × `c.a * alpha` is correct premultiplied math. Visual smoke verifies edge color matches Canvas2D's sub-pixel coverage.

- **R7: Test #3's "decode float32 from writeBuffer args" relies on the mock capturing the exact ArrayBuffer slice.** vitest's `vi.fn()` on `device.queue.writeBuffer` captures the args, including the underlying buffer. Test must read `(args[2] as ArrayBuffer)` (the source buffer) at `args[3]` offset, slice `args[4]` bytes, decode as `Float32Array`. Standard pattern; documented inline.

- **R8: `discard` on `bgra8unorm-srgb` view format.** WebGPU spec allows `discard` in fragment shaders with any color attachment format. No platform-specific gotcha on Mac/Win/Linux. Verified.

- **R9 (r2 m3): AABB-quad winding is irrelevant under `cullMode: "none"`** (W37 default, W38 unchanged). After projection Y-flip the CCW screen-space order `(minX,minY) → (maxX,minY) → (minX,maxY)` becomes CW in clip space, but culling is off → both orientations rasterize identically. If W39 enables culling for fusion's full-screen pass, this needs revisiting. Not a W38 concern.

- **R10 (r2 m4): Worst-case overdraw at capacity 128 + overlapping AABBs.** R1 assumed AABBs sum to bounded screen area. Worst case (all 128 entities at full screen with overlapping AABBs) scales as N × screen-area = 128 × 1080p ≈ 256M fragments × 32 ops = ~8G ops/frame. Still within mid-range GPU budget but tight. Mitigation: typical usage stays around capacity 16-64 with small elements; this worst case requires intentional adversarial input. Document as "performance cliff exists; users should not exceed capacity 64 with elements spanning >50% of viewport".

## Must NOT

- Change the `Renderer` interface or `RenderFrame` DTO.
- Touch Canvas2D path. W38 is WebGPU-only.
- Add new public API surface to `LiquidDOM` or `LiquidOptions`. (Internal storage-buffer layout is implementation detail.)
- Allocate GPU buffers per frame — buffer-resize remains gated on capacity change.
- Implement metaball smin / fusion math — that's W39.
- Implement texture sampling for refraction — that's W40.
- Read `themeCache` for per-element colors — still W37 §11 v1 limitation.
- Run an O(N²) CPU loop. AABB compute is O(N × 16) per frame.
- Throw or `console.warn` from `render()` for normal frames. The W37 once-per-session `preserveBackgrounds` warn is REMOVED (the feature now works in WebGPU).
- Keep `blob.wgsl.ts` alive — it's deleted in W38 (Decision §11).

## Must DO

- All 270 existing tests continue to pass. The 7 W37 tests are unchanged.
- New tests #1-#4 pass.
- `npm run build` produces 0 TS errors; `cargo clippy` 0 warnings (no Rust change).
- Manual smoke test: open `?renderer=webgpu&preserveBackgrounds=false` — blobs are smooth-edged (not polygonal). Open `?renderer=webgpu&preserveBackgrounds=true` — element backgrounds carved out cleanly. Compare with `?renderer=canvas2d` for parity.
- W37's `WebGPUUnavailableError`-paths stay locked (existing tests in `webgpu-renderer.test.ts`).
- The `device.lost` recovery semantics (W37 §9) carry over unchanged.
- **(r2 fix F7) DELETE the `warnedPreserveBg: boolean = false` field declaration in `webgpu-renderer.ts` AND the `if (frame.viewport.preserveBackgrounds && !this.warnedPreserveBg) { console.warn(...); this.warnedPreserveBg = true; }` block in `render()`.** The clip now works in WebGPU; the once-per-session warn is obsolete dead code.

## Manual Smoke Test

### Setup
```
npm run build:ts
npm run dev
```

### Steps
1. Open `http://localhost:3000/scenes/playground.html?preserveBackgrounds=false&capacity=64&renderer=webgpu`.
   Expected: 4 blobs visible with smooth curved edges (NOT polygonal facets like W37).
   Compare against `?renderer=canvas2d` (same URL, different param) — silhouettes match within sub-pixel.
2. Open same URL with `&preserveBackgrounds=true`. (Already an "Init-only" param.)
   Expected: blobs visible, DOM element rounded rect (with text "Pill button" etc.) carved out — the rect is NOT covered by the blob. Same look as Canvas2D with preserveBackgrounds.
3. Hover over each blob: color flips to hover color, edges stay smooth, no facets.
4. Drag a card (open `dragable-cards.html` with `?renderer=webgpu`). Particles deform during drag; blob silhouette tracks deformation smoothly. If self-intersection occurs during fast drag, expect brief "tears" (R2) — acceptable v1 limitation.
5. Check console: no warnings (the W37 preserveBackgrounds warn-once is now removed).

### Pass criteria
- [ ] WebGPU path renders smooth-edged blobs at 60 FPS on M-series MacBook
- [ ] preserveBackgrounds clip works in WebGPU path (Decision §9 + §10)
- [ ] Visual parity with Canvas2D within sub-pixel (smooth silhouettes)
- [ ] No console warnings or validation errors
- [ ] No regressions in canvas2d path or in any existing demo scene

## Verification

`npm run verify` — `build + test:rust + test + clippy`. All green.
- T1-T4 lock the pipeline + buffer layout + clip flag.
- Existing 270 tests cover all error paths + Canvas2D rendering + observer + physics.
- Manual smoke covers actual SDF visual output.

W39 (Metaball Fusion) then builds on the SDF infrastructure by replacing per-fragment polygon SDF with smooth-min over disc SDFs from neighbouring entities. The per-entity AABB strategy stays for non-fusing entities; fusion uses a separate full-screen pass.
