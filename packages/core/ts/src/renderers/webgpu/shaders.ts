/**
 * W71: WGSL for the WebGPU liquid (slice-3 design §2) as TS string constants (no bundler
 * plugin). The kernel cap, threshold and edge softness are interpolated from kernel-params.ts,
 * so both renderers put the 0.5 threshold on the rect edge the same way (D71-5). The structs
 * mirror gpu-buffers.ts (`Element`, 64 bytes, ELEMENT_GPU_FLOATS) and webgpu-renderer.ts
 * (`View`, 32 bytes, VIEW_UNIFORM_FLOATS).
 */
import { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX } from "../kernel-params";

/**
 * Upper bound of the composite's fwidth-widened edge half-width (density units). It stays below
 * DENSITY_THRESHOLD, so `threshold − soft > 0` and a near-zero Σw never gets coverage (no halo
 * around steep, dense blobs at a low dpr or t0Scale; W71.4 review, Minor 2).
 */
export const EDGE_SOFTNESS_MAX = 0.45;

/** A JS number as a WGSL f32 literal (`8` → `8.0`). */
function f32(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

const VIEW_WGSL = /* wgsl */ `
struct View {
  size_css: vec2f,
  size_px: vec2f,
  dpr: f32,
  t0_scale: f32,
  _pad0: f32,
  _pad1: f32,
}
`;

const ELEMENT_WGSL = /* wgsl */ `
struct Element {
  rect: vec4f,
  radius: f32,
  rest_alpha: f32,
  mass: f32,
  kernel_r: f32,
  color: vec4f,
  flags: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}
`;

const QUAD_WGSL = /* wgsl */ `
fn quad_corner(vi: u32) -> vec2f {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  return corners[vi % 6u];
}

fn css_to_clip(p: vec2f, size_css: vec2f) -> vec4f {
  let s = max(size_css, vec2f(1.0, 1.0));
  return vec4f(p.x / s.x * 2.0 - 1.0, 1.0 - p.y / s.y * 2.0, 0.0, 1.0);
}

const DEGENERATE = vec4f(-2.0, -2.0, 0.0, 1.0);
`;

/**
 * Pass 1 (splat): one instanced quad per particle into T0 (Σw·rgb, Σw) and T0a (Σw·a),
 * additive. A particle is a degenerate quad when its home is −1 or out of range, or its
 * element is not drawable (flags 0), at rest (D71-6) or has no mass.
 */
export const SPLAT_WGSL = /* wgsl */ `
${VIEW_WGSL}
${ELEMENT_WGSL}
${QUAD_WGSL}
const KERNEL_RADIUS_CAP_PX: f32 = ${f32(KERNEL_RADIUS_CAP_PX)};
const PI: f32 = 3.14159265358979;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> particles: array<vec2f>;
@group(0) @binding(2) var<storage, read> homes: array<i32>;
@group(0) @binding(3) var<storage, read> elements: array<Element>;

struct SplatVarying {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) kernel: vec2f,
  @location(2) @interpolate(flat) color: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatVarying {
  var out: SplatVarying;
  out.pos = DEGENERATE;
  out.local = vec2f(0.0, 0.0);
  out.kernel = vec2f(1.0, 0.0);
  out.color = vec4f(0.0, 0.0, 0.0, 0.0);
  let home = homes[ii];
  if (home < 0 || u32(home) >= arrayLength(&elements)) {
    return out;
  }
  let e = elements[u32(home)];
  if (e.flags < 0.5 || e.rest_alpha >= 1.0 || e.mass <= 0.0) {
    return out;
  }
  // Same floor as DensityGrid (at least one cell): at least one T0 texel, in CSS px.
  let texel_css = 1.0 / max(view.dpr * view.t0_scale, 1e-6);
  let r = min(max(e.kernel_r, texel_css), KERNEL_RADIUS_CAP_PX);
  let r2 = r * r;
  let corner = quad_corner(vi) * r;
  out.pos = css_to_clip(particles[ii] + corner, view.size_css);
  out.local = corner;
  out.kernel = vec2f(r2, e.mass / (PI * r2 / 3.0));
  out.color = e.color;
  return out;
}

struct SplatTargets {
  @location(0) acc: vec4f,
  @location(1) acc_alpha: f32,
}

@fragment
fn fs(in: SplatVarying) -> SplatTargets {
  let q = 1.0 - dot(in.local, in.local) / in.kernel.x;
  if (q <= 0.0) {
    discard;
  }
  let w = in.kernel.y * q * q;
  var out: SplatTargets;
  out.acc = vec4f(in.color.rgb * w, w);
  out.acc_alpha = w * in.color.a;
  return out;
}
`;

/**
 * Pass 2a (composite): a full-screen triangle. Coverage = smoothstep around the 0.5 threshold,
 * widened by fwidth; colour Σw·rgb/Σw and alpha coverage·Σw·a/Σw, premultiplied once here.
 */
export const COMPOSITE_WGSL = /* wgsl */ `
${VIEW_WGSL}
const DENSITY_THRESHOLD: f32 = ${f32(DENSITY_THRESHOLD)};
const EDGE_SOFTNESS: f32 = ${f32(EDGE_SOFTNESS)};
const EDGE_SOFTNESS_MAX: f32 = ${f32(EDGE_SOFTNESS_MAX)};
const SUM_W_EPS: f32 = 1e-4;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var t0: texture_2d<f32>;
@group(0) @binding(2) var t0_alpha: texture_2d<f32>;
@group(0) @binding(3) var t0_sampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[vi % 3u], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy / max(view.size_px, vec2f(1.0, 1.0));
  let acc = textureSample(t0, t0_sampler, uv);
  let acc_alpha = textureSample(t0_alpha, t0_sampler, uv).r;
  let sum_w = acc.a;
  let soft = clamp(0.75 * fwidth(sum_w), EDGE_SOFTNESS, EDGE_SOFTNESS_MAX);
  let coverage = smoothstep(DENSITY_THRESHOLD - soft, DENSITY_THRESHOLD + soft, sum_w);
  let inv = 1.0 / max(sum_w, SUM_W_EPS);
  let rgb = clamp(acc.rgb * inv, vec3f(0.0), vec3f(1.0));
  let alpha = coverage * clamp(acc_alpha * inv, 0.0, 1.0);
  return vec4f(rgb * alpha, alpha);
}
`;

/**
 * Pass 2b (rest overlay): one instanced quad per element, an analytic rounded-rect SDF with
 * one device px of anti-aliasing, alpha = coverage · restAlpha · colour alpha, premultiplied,
 * blended over the composite (one, one-minus-src-alpha).
 */
export const REST_WGSL = /* wgsl */ `
${VIEW_WGSL}
${ELEMENT_WGSL}
${QUAD_WGSL}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> elements: array<Element>;

struct RestVarying {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) shape: vec4f,
  @location(2) @interpolate(flat) color: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RestVarying {
  var out: RestVarying;
  out.pos = DEGENERATE;
  out.local = vec2f(0.0, 0.0);
  out.shape = vec4f(0.0, 0.0, 0.0, 0.0);
  out.color = vec4f(0.0, 0.0, 0.0, 0.0);
  let e = elements[ii];
  let rest_alpha = clamp(e.rest_alpha, 0.0, 1.0);
  if (e.flags < 0.5 || rest_alpha <= 0.0 || e.rect.z <= 0.0 || e.rect.w <= 0.0) {
    return out;
  }
  let half_size = e.rect.zw * 0.5;
  let centre = e.rect.xy + half_size;
  let pad = 1.0 / max(view.dpr, 1e-6);
  let corner = quad_corner(vi) * (half_size + vec2f(pad, pad));
  out.pos = css_to_clip(centre + corner, view.size_css);
  out.local = corner;
  out.shape = vec4f(half_size, clamp(e.radius, 0.0, min(half_size.x, half_size.y)), rest_alpha);
  out.color = e.color;
  return out;
}

@fragment
fn fs(in: RestVarying) -> @location(0) vec4f {
  let r = in.shape.z;
  let q = abs(in.local) - in.shape.xy + vec2f(r, r);
  let sd = length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
  let coverage = clamp(0.5 - sd * view.dpr, 0.0, 1.0);
  let alpha = coverage * in.shape.w * clamp(in.color.a, 0.0, 1.0);
  return vec4f(in.color.rgb * alpha, alpha);
}
`;
