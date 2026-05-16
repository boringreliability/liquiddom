// Ward 037 — WGSL shader for the WebGPU triangle-fan blob pipeline.
//
// EntityGPU layout (32 bytes, std430 stride):
//   color:    vec4<f32>   (16 B) — premultiplied rgba in [0, 1]
//   centroid: vec2<f32>   (8 B)  — CSS-px coords, rect center (Decision §3)
//   _pad:     vec2<f32>   (8 B)  — std430 stride padding
//
// Vertex pulling: 48 vertices per instance (16 triangles × 3 corners). For
// each instance `iid`:
//   - corner 0 = entity.centroid
//   - corner 1 = particles[iid*16 + triangle]
//   - corner 2 = particles[iid*16 + (triangle + 1) % 16]
// Inactive slots (color.a == 0) collapse to off-screen via sentinel position.
// W38 replaces this geometry with an AABB quad + SDF discard.
export const BLOB_WGSL = /* wgsl */ `
struct GlobalUniforms {
  projection: mat4x4<f32>,
};

struct EntityGPU {
  color: vec4<f32>,
  centroid: vec2<f32>,
  _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> globals: GlobalUniforms;
@group(0) @binding(1) var<storage, read> particles: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> entities: array<EntityGPU>;

const PARTICLES_PER_BODY: u32 = 16u;
const VERTS_PER_TRI: u32 = 3u;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) @interpolate(flat) entityId: u32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VOut {
  let triangle = vid / VERTS_PER_TRI;
  let corner = vid % VERTS_PER_TRI;
  let particleBase = iid * PARTICLES_PER_BODY;
  let entity = entities[iid];

  var pos: vec2<f32>;
  if (corner == 0u) {
    pos = entity.centroid;
  } else if (corner == 1u) {
    pos = particles[particleBase + triangle];
  } else {
    pos = particles[particleBase + (triangle + 1u) % PARTICLES_PER_BODY];
  }

  // Inactive instance: collapse vertices off-screen.
  if (entity.color.a == 0.0) {
    pos = vec2<f32>(-99999.0, -99999.0);
  }

  return VOut(globals.projection * vec4<f32>(pos, 0.0, 1.0), iid);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return entities[in.entityId].color;
}
`;
