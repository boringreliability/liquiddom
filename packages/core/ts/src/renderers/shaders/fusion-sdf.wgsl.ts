// Ward 039 — Metaball Fusion Shader. Full-screen quad + per-fragment smin
// blending of every active entity's polygon SDF. Activates when
// theme.fusionRadius > 0 (and capacity ≤ 64 per Decision §2 safety valve).
//
// Pipeline contract per ward-039.md r2:
//   Bind group 0 (shared with the W38 AABB pipeline):
//     binding 0 → uniform Globals (mat4x4 projection + vec4 flags)
//     binding 1 → storage<read> array<vec2<f32>>  // particles
//     binding 2 → storage<read> array<EntityGPU>  // 64-byte structs
//   Draw: 6 vertices × 1 instance (full-screen quad).
//
// Per-fragment work: 64 polygon-SDF evaluations × 16 segments = 1024 SDF
// computations. smin operator: quadratic polynomial (Decision §3) — no
// transcendentals; degenerates to min when |a-b| ≥ k. Winner-take-all color
// (Decision §5) with epsilon-stable comparison (Decision §m2) to prevent
// 1-px color flicker at smin midpoints.

import { SDF_HELPERS_WGSL } from "./sdf-helpers.wgsl";

const SHADER_BODY = /* wgsl */ `
struct Globals {
  projection: mat4x4<f32>,
  // W40: flags.z carries refraction strength (CSS px); 0 = refraction disabled.
  // flags.w reserved.
  flags: vec4<f32>,
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
// W40: refraction texture + sampler. Bound unconditionally — a 1×1 white dummy
// is bound when no host bitmap is supplied. Shader gates sampling on flags.z.
@group(0) @binding(3) var refractionTex: texture_2d<f32>;
@group(0) @binding(4) var refractionSamp: sampler;

const PARTICLES_PER_BODY: u32 = 16u;
const MAX_ENTITIES: u32 = 64u;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let ndc = corners[vid];
  return VOut(vec4<f32>(ndc, 0.0, 1.0), ndc);
}

// Inverse-project clip-space → CSS px so SDF math runs in world space.
// CPU projection: m[0][0] = 2/w, m[1][1] = -2/h. World w = 2/m[0][0],
// h = -2/m[1][1]. World x = (ndc.x + 1) * w / 2, y = (1 - ndc.y) * h / 2.
fn ndcToWorld(ndc: vec2<f32>) -> vec2<f32> {
  let m = globals.projection;
  let w = 2.0 / m[0][0];
  let h = -2.0 / m[1][1];
  return vec2<f32>((ndc.x + 1.0) * w * 0.5, (1.0 - ndc.y) * h * 0.5);
}

// Quadratic smin (IQ's polynomial form). Degenerates to min(a, b) when
// |a - b| ≥ k. Smoothly blends when |a - b| < k.
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Ward 040: helper for central-difference gradient sampling. Same MAX_ENTITIES
// bound as fs_main's main loop (Decision §8). Guarded against k=0 (auto-promote
// path where fusionRadius=0): smin's divide-by-k would NaN, so fall back to min.
fn combinedSdf(p: vec2<f32>) -> f32 {
  var d: f32 = 1e9;
  let k = globals.flags.y;
  for (var i: u32 = 0u; i < MAX_ENTITIES; i = i + 1u) {
    if (entities[i].color.a == 0.0) { continue; }
    let dEntity = sdPolygon(p, i * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
    d = select(min(d, dEntity), smin(d, dEntity, k), k > 0.0);
  }
  return d;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let p = ndcToWorld(in.ndc);
  let k = globals.flags.y;

  var sdf: f32 = 1e9;
  var minD: f32 = 1e9;
  var winnerId: u32 = 0u;

  // MAX_ENTITIES = 64 (Decision §4). Storage buffer OOB reads return zeroed
  // entries (WebGPU robust-buffer-access guarantee for storage), so iterating
  // past frame.capacity is safe — color.a == 0 triggers continue.
  for (var i: u32 = 0u; i < MAX_ENTITIES; i = i + 1u) {
    if (entities[i].color.a == 0.0) { continue; }
    let d = sdPolygon(p, i * PARTICLES_PER_BODY, PARTICLES_PER_BODY);
    // Epsilon-stable winner comparison (Decision §m2) — suppresses 1-px
    // color flicker at the smin midpoint where d1 ≈ d2 due to FP rounding.
    if (d < minD - 0.001) {
      minD = d;
      winnerId = i;
    }
    sdf = smin(sdf, d, k);
  }

  let winner = entities[winnerId];
  let softness = winner.params.x;
  let alpha = 1.0 - smoothstep(-softness, softness, sdf);
  if (alpha < 0.001) { discard; }

  // preserveBackgrounds: carve out the winner's clip rect.
  if (globals.flags.x > 0.5 && winner.clipRect.z > 0.0 && winner.clipRect.w > 0.0) {
    let clipR = winner.params.y;
    let clipSdf = sdRoundedRect(p, winner.clipRect, clipR);
    if (clipSdf < 0.0) { discard; }
  }

  // W40: refraction. Gated on flags.z > 0. Central-difference SDF gradient
  // via combinedSdf gives an outward-pointing direction; UV displacement is
  // strength / resolution.y (single scalar avoids per-axis asymmetry on
  // non-square canvases). winnerColor is premultiplied; sampled is straight
  // alpha — acceptable v1 trade-off (Spec §8 alpha note).
  var finalRgb = winner.color.rgb;
  var finalA = winner.color.a;
  if (globals.flags.z > 0.0) {
    let eps = 1.0;
    let dx = combinedSdf(p + vec2<f32>(eps, 0.0)) - combinedSdf(p - vec2<f32>(eps, 0.0));
    let dy = combinedSdf(p + vec2<f32>(0.0, eps)) - combinedSdf(p - vec2<f32>(0.0, eps));
    let grad = vec2<f32>(dx, dy);
    let gradLen = length(grad);
    if (gradLen > 0.001) {
      let m = globals.projection;
      let width = 2.0 / m[0][0];
      let height = -2.0 / m[1][1];
      let resolution = vec2<f32>(width, height);
      let uvOffset = (grad / gradLen) * (globals.flags.z / resolution.y);
      let uv = (p / resolution) + uvOffset;
      // textureSampleLevel (not textureSample) — sampling here is inside a
      // non-uniform conditional (gradLen > 0.001), which would violate
      // WGSL's uniformity rules for implicit-derivative textureSample.
      // LOD 0 is correct: refraction texture has no mipmaps.
      let sampled = textureSampleLevel(refractionTex, refractionSamp, uv, 0.0);
      // mix(sampled, winnerColor, 0.3) = 70% refracted + 30% tint.
      finalRgb = sampled.rgb * 0.7 + winner.color.rgb * 0.3;
      finalA = sampled.a * 0.7 + winner.color.a * 0.3;
    }
  }
  return vec4<f32>(finalRgb * alpha, finalA * alpha);
}
`;

export const FUSION_SDF_WGSL = SDF_HELPERS_WGSL + SHADER_BODY;
