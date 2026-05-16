// Ward 038 — SDF blob fragment shader. Replaces W37's polygon-fan geometry
// with one AABB quad per entity + per-fragment signed-distance-to-polygon
// computation. Produces smooth anti-aliased silhouettes (matches or exceeds
// Canvas2D's midpoint-Bezier output) and supports the `preserveBackgrounds`
// clip-hole via fragment discard.

import { SDF_HELPERS_WGSL } from "./sdf-helpers.wgsl";

const SHADER_BODY = /* wgsl */ `
struct Globals {
  projection: mat4x4<f32>,
  // flags.x = preserveBackgroundsActive (0 or 1). W39 fusion, W40 refraction
  // will fill the remaining 3 slots.
  flags: vec4<f32>,
};

struct EntityGPU {
  color: vec4<f32>,           // 16B — premultiplied rgba
  aabb: vec4<f32>,            // 16B — minX, minY, maxX, maxY (CSS px, includes softness margin)
  clipRect: vec4<f32>,        // 16B — DOM rect (x, y, w, h) for preserveBackgrounds discard
  params: vec4<f32>,          // 16B — (softness, clipBorderRadius, _, _)
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
  // Two triangles per quad. Vertex index → corner of unit quad:
  //  0,3 → (0,0)  1,4 → (1,0)  2,5 → (0,1) or (1,1)
  // Layout:
  //   triangle A: (0,1,2) = (minX,minY) (maxX,minY) (minX,maxY)
  //   triangle B: (2,1,3) = (minX,maxY) (maxX,minY) (maxX,maxY)
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
  );
  let pos = mix(entity.aabb.xy, entity.aabb.zw, corners[vid]);

  var clipPos: vec4<f32>;
  // Inactive instance (color.a == 0): collapse all 6 vertices off-screen.
  // The rasterizer trivially rejects primitives outside [-1, 1] clip space.
  if (entity.color.a == 0.0) {
    clipPos = vec4<f32>(-99999.0, -99999.0, 0.0, 1.0);
  } else {
    clipPos = globals.projection * vec4<f32>(pos, 0.0, 1.0);
  }
  return VOut(clipPos, iid, pos);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let entity = entities[in.entityId];
  let softness = entity.params.x;
  let sdf = sdPolygon(in.worldPos, in.entityId * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
  // sdf < 0 inside, > 0 outside. smoothstep maps softness→0 outside →
  // -softness→1 inside. (1 - smoothstep) inverts so inside=1, outside=0.
  let alpha = 1.0 - smoothstep(-softness, softness, sdf);
  if (alpha < 0.001) {
    discard;
  }
  // preserveBackgrounds: carve a hole matching the DOM element's rounded rect.
  // Gated on global flag AND the rect having non-zero size (droplets pack
  // clipRect = zeros so the gate's second condition skips clip for them).
  if (globals.flags.x > 0.5 && entity.clipRect.z > 0.0 && entity.clipRect.w > 0.0) {
    let clipR = entity.params.y;
    let clipSdf = sdRoundedRect(in.worldPos, entity.clipRect, clipR);
    if (clipSdf < 0.0) {
      discard;
    }
  }
  // Premultiplied output: c.rgb is already rgb*c.a from CPU parseColor.
  // Apply edge alpha: final = (rgb * c.a * alpha, c.a * alpha).
  let c = entity.color;
  return vec4<f32>(c.rgb * alpha, c.a * alpha);
}
`;

export const BLOB_SDF_WGSL = SDF_HELPERS_WGSL + SHADER_BODY;
