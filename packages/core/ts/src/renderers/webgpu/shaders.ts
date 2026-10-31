/**
 * W71: WGSL for the WebGPU liquid (slice-3 design §2) as TS string constants (no bundler
 * plugin). The kernel cap, threshold and edge softness are interpolated from kernel-params.ts,
 * so both renderers put the 0.5 threshold on the rect edge the same way (D71-5). The structs
 * mirror gpu-buffers.ts (`Element`, 64 bytes, ELEMENT_GPU_FLOATS) and webgpu-renderer.ts
 * (`View`, 32 bytes, VIEW_UNIFORM_FLOATS). W74 adds the text pass (TEXT_WGSL into T1/T1w) and the
 * text composite (TEXT_COMPOSITE_WGSL); the splat reads the 32-byte particle record. W88 adds the
 * shadow shaders (SHADOW_DENSITY/RESOLVE/BLUR/KNOCKOUT/COMPOSITE_WGSL, shadow-passes.ts).
 */
import { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX } from "../kernel-params";
import { FLAG_TORN } from "../../fluid-layout";

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

/** W74 (D74-4): one particle record, 32 bytes (gpu-buffers.ts PARTICLE_GPU_FLOATS). */
const PARTICLE_WGSL = /* wgsl */ `
struct Particle {
  a: vec4f, // x, y, f00, f01
  b: vec4f, // f10, f11, flags, pad
}
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
${PARTICLE_WGSL}
const KERNEL_RADIUS_CAP_PX: f32 = ${f32(KERNEL_RADIUS_CAP_PX)};
const PI: f32 = 3.14159265358979;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
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
  out.pos = css_to_clip(particles[ii].a.xy + corner, view.size_css);
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

/** W74 (D74-4): the norm clamp of F⁻¹ (spec §3 "Liquid text: the formula", amended 2026-10-10). */
export const FINV_NORM_CLAMP = 2;
/** W74 (D74-4): text coverage is 0 below this |det F|. */
export const TEXT_DET_EPS = 1e-4;

/**
 * Pass 1b (text, W74, D74-4): one instanced quad per particle of a moving element with atlas
 * text, with the liquid's kernel (radius, T0-texel floor and mass as in SPLAT_WGSL, so Σw lines
 * up with T0), into T1 (Σw·text_rgba_premul) and T1w (Σw) at 1× the backing size, additive.
 * uv = rest_uv + diag(1/w_rest, 1/h_rest)·F⁻¹·(frag − x_p), ‖F⁻¹‖ clamped to FINV_NORM_CLAMP;
 * coverage 0 when torn, |det F| < TEXT_DET_EPS or uv ∉ [0,1]². Such particles still add Σw, so
 * their neighbours' text fades there instead of spreading into a tear.
 * W79 (D79-1): every covered fragment also writes (id, −id) of its element into the id target
 * (rg16float, min blending), so per texel r is the smallest and −g the largest element id whose
 * liquid carries text there.
 */
export const TEXT_WGSL = /* wgsl */ `
${VIEW_WGSL}
${ELEMENT_WGSL}
${QUAD_WGSL}
${PARTICLE_WGSL}
const KERNEL_RADIUS_CAP_PX: f32 = ${f32(KERNEL_RADIUS_CAP_PX)};
const PI: f32 = 3.14159265358979;
const FINV_NORM_CLAMP: f32 = ${f32(FINV_NORM_CLAMP)};
const TEXT_DET_EPS: f32 = ${f32(TEXT_DET_EPS)};
const FLAG_TORN: u32 = ${FLAG_TORN}u;

struct TextInfo {
  atlas: vec4f, // u0, v0, us, vs of the border box in the atlas (0–1)
  size: vec4f, // w_rest, h_rest (CSS px), valid, pad
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> homes: array<i32>;
@group(0) @binding(3) var<storage, read> elements: array<Element>;
@group(0) @binding(4) var<storage, read> rest_uv: array<vec2f>;
@group(0) @binding(5) var<storage, read> text_info: array<TextInfo>;
@group(0) @binding(6) var atlas: texture_2d<f32>;
@group(0) @binding(7) var atlas_sampler: sampler;

struct TextVarying {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) kernel: vec2f,
  @location(2) @interpolate(flat) inv: vec4f,
  @location(3) @interpolate(flat) uv0: vec2f,
  @location(4) @interpolate(flat) size: vec2f,
  @location(5) @interpolate(flat) arect: vec4f,
  @location(6) @interpolate(flat) valid: f32,
  @location(7) @interpolate(flat) id: f32,
}

// Smallest singular value of F = (f00, f01, f10, f11) by the closed form (fmath.rs).
fn sigma_min(f: vec4f) -> f32 {
  let e = 0.5 * (f.x + f.w);
  let fh = 0.5 * (f.x - f.w);
  let g = 0.5 * (f.z + f.y);
  let h = 0.5 * (f.z - f.y);
  return abs(sqrt(e * e + h * h) - sqrt(fh * fh + g * g));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TextVarying {
  var out: TextVarying;
  out.pos = DEGENERATE;
  out.local = vec2f(0.0, 0.0);
  out.kernel = vec2f(1.0, 0.0);
  out.inv = vec4f(1.0, 0.0, 0.0, 1.0);
  out.uv0 = vec2f(0.0, 0.0);
  out.size = vec2f(1.0, 1.0);
  out.arect = vec4f(0.0, 0.0, 0.0, 0.0);
  out.valid = 0.0;
  out.id = 0.0;
  let home = homes[ii];
  if (home < 0 || u32(home) >= arrayLength(&elements) || u32(home) >= arrayLength(&text_info)) {
    return out;
  }
  let e = elements[u32(home)];
  if (e.flags < 0.5 || e.rest_alpha >= 1.0 || e.mass <= 0.0) {
    return out;
  }
  let info = text_info[u32(home)];
  if (info.size.z < 0.5) {
    return out;
  }
  let p = particles[ii];
  let f = vec4f(p.a.z, p.a.w, p.b.x, p.b.y);
  let det = f.x * f.w - f.y * f.z;
  let torn = (u32(p.b.z) & FLAG_TORN) != 0u;
  var valid = 1.0;
  if (torn || abs(det) < TEXT_DET_EPS) {
    valid = 0.0;
  } else {
    // F⁻¹ = adj(F) / det; its norm is 1/σmin(F), clamped to FINV_NORM_CLAMP (no minification).
    out.inv = vec4f(f.w, -f.y, -f.z, f.x) / det;
    let smin = sigma_min(f);
    if (smin * FINV_NORM_CLAMP < 1.0) {
      out.inv = out.inv * (smin * FINV_NORM_CLAMP);
    }
  }
  let texel_css = 1.0 / max(view.dpr * view.t0_scale, 1e-6);
  let r = min(max(e.kernel_r, texel_css), KERNEL_RADIUS_CAP_PX);
  let r2 = r * r;
  let corner = quad_corner(vi) * r;
  out.pos = css_to_clip(p.a.xy + corner, view.size_css);
  out.local = corner;
  out.kernel = vec2f(r2, e.mass / (PI * r2 / 3.0));
  out.uv0 = rest_uv[ii];
  out.size = max(info.size.xy, vec2f(1e-3, 1e-3));
  out.arect = info.atlas;
  out.valid = valid;
  out.id = f32(home);
  return out;
}

struct TextTargets {
  @location(0) acc: vec4f,
  @location(1) acc_w: f32,
  @location(2) id: vec2f,
}

@fragment
fn fs(in: TextVarying) -> TextTargets {
  let q = 1.0 - dot(in.local, in.local) / in.kernel.x;
  if (q <= 0.0) {
    discard;
  }
  let w = in.kernel.y * q * q;
  let d = in.local;
  let uv = in.uv0 + vec2f(in.inv.x * d.x + in.inv.y * d.y, in.inv.z * d.x + in.inv.w * d.y) / in.size;
  let inside = all(uv >= vec2f(0.0, 0.0)) && all(uv <= vec2f(1.0, 1.0));
  let coverage = select(0.0, in.valid, inside);
  let texel = textureSampleLevel(atlas, atlas_sampler, in.arect.xy + clamp(uv, vec2f(0.0), vec2f(1.0)) * in.arect.zw, 0.0);
  var out: TextTargets;
  out.acc = texel * (w * coverage);
  out.acc_w = w;
  out.id = vec2f(in.id, -in.id);
  return out;
}
`;

/**
 * Pass 2c (text composite, W74, D74-4): drawn after the rest SDF so the text never blinks at the
 * cross-fade. T1/T1w thresholded at 0.5 with the liquid's fwidth edge; colour T1/T1w (the
 * atlas is premultiplied, so the result is too), blended over.
 * W79 (D79-1): coverage 0 wherever the id target's bilinear footprint holds two element ids
 * (smallest < largest): where two elements' liquids meet, neither shows text, so no pixel ever
 * carries the text of both. textureGather reads the 2×2 neighbourhood around the sample.
 */
export const TEXT_COMPOSITE_WGSL = /* wgsl */ `
${VIEW_WGSL}
const DENSITY_THRESHOLD: f32 = ${f32(DENSITY_THRESHOLD)};
const EDGE_SOFTNESS: f32 = ${f32(EDGE_SOFTNESS)};
const EDGE_SOFTNESS_MAX: f32 = ${f32(EDGE_SOFTNESS_MAX)};
const SUM_W_EPS: f32 = 1e-4;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var t1: texture_2d<f32>;
@group(0) @binding(2) var t1_weight: texture_2d<f32>;
@group(0) @binding(3) var t1_sampler: sampler;
@group(0) @binding(4) var t1_id: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[vi % 3u], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy / max(view.size_px, vec2f(1.0, 1.0));
  let acc = textureSample(t1, t1_sampler, uv);
  let sum_w = textureSample(t1_weight, t1_sampler, uv).r;
  let soft = clamp(0.75 * fwidth(sum_w), EDGE_SOFTNESS, EDGE_SOFTNESS_MAX);
  // W79 (D79-1): r = smallest, −g = largest element id per texel (TEXT_ID_EMPTY where no text splat).
  let lo4 = textureGather(0, t1_id, t1_sampler, uv);
  let nhi4 = textureGather(1, t1_id, t1_sampler, uv);
  let lo = min(min(lo4.x, lo4.y), min(lo4.z, lo4.w));
  let hi = -min(min(nhi4.x, nhi4.y), min(nhi4.z, nhi4.w));
  let mixed = lo + 0.5 < hi;
  let coverage = select(smoothstep(DENSITY_THRESHOLD - soft, DENSITY_THRESHOLD + soft, sum_w), 0.0, mixed);
  let text = clamp(acc / max(sum_w, SUM_W_EPS), vec4f(0.0), vec4f(1.0));
  return text * coverage;
}
`;

// ---- W88 (D88-6, D88-10, D88-11, D88-13): shadows -----------------------------------------------

/** W88: the blur loop's cap, in taps per side. */
export const SHADOW_MAX_TAPS = 64;

/**
 * W88 (D88-11): one 128-byte record per shadow pass at a 256-byte dynamic offset
 * (shadow-passes.ts SHADOW_PASS_FLOATS, SP): blur taps, the density source, the knockout's closing
 * distance and channel masks, the composite's accumulator flags.
 */
const SHADOW_PASS_WGSL = /* wgsl */ `
struct ShadowPass {
  target_px: vec2f,
  dir: vec2f,
  sigma: f32,
  taps: f32,
  element: f32,
  kernel_r: f32,
  weight: f32,
  close: f32,
  layers: f32,
  flags: f32,
  mask: vec4f,
  masks: array<vec4f, 4>,
}
`;

const FULL_TRIANGLE_WGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[vi % 3u], 0.0, 1.0);
}
`;

/**
 * Shadow pass 1 (W88, D88-11): one density splat per source (element and distinct spread), without
 * an offset, into its channel of a shadow density layer (rgba16float, half resolution, additive). The
 * kernel is the liquid's (spread 0) or the widened, mass-scaled one of shadow-plan.ts spreadKernel;
 * a particle of another element is a degenerate quad. Parked particles were packed off-screen.
 */
export const SHADOW_DENSITY_WGSL = /* wgsl */ `
${VIEW_WGSL}
${QUAD_WGSL}
${PARTICLE_WGSL}
${SHADOW_PASS_WGSL}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<uniform> sp: ShadowPass;
@group(0) @binding(2) var<storage, read> particles: array<Particle>;
@group(0) @binding(3) var<storage, read> homes: array<i32>;

struct DensityVarying {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DensityVarying {
  var out: DensityVarying;
  out.pos = DEGENERATE;
  out.local = vec2f(0.0, 0.0);
  if (homes[ii] != i32(sp.element)) {
    return out;
  }
  let corner = quad_corner(vi) * sp.kernel_r;
  out.pos = css_to_clip(particles[ii].a.xy + corner, view.size_css);
  out.local = corner;
  return out;
}

@fragment
fn fs(in: DensityVarying) -> @location(0) vec4f {
  let q = 1.0 - dot(in.local, in.local) / max(sp.kernel_r * sp.kernel_r, 1e-6);
  if (q <= 0.0) {
    discard;
  }
  return sp.mask * (sp.weight * q * q);
}
`;

/**
 * Shadow pass 2 (W88, D88-11): one scissored pass per radius group. One quad per layer record; the
 * layer's offset is applied here, by sampling its source's density at (position − offset), and the
 * 0.5 threshold with the liquid's edge gives the coverage; premultiplied colour, blended over.
 */
export const SHADOW_RESOLVE_WGSL = /* wgsl */ `
${VIEW_WGSL}
${QUAD_WGSL}
const DENSITY_THRESHOLD: f32 = ${f32(DENSITY_THRESHOLD)};
const EDGE_SOFTNESS: f32 = ${f32(EDGE_SOFTNESS)};

struct ShadowRecord {
  rect: vec4f,
  offset: vec2f,
  src: vec2f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> records: array<ShadowRecord>;
@group(0) @binding(2) var density: texture_2d_array<f32>;
@group(0) @binding(3) var density_sampler: sampler;

struct ResolveVarying {
  @builtin(position) pos: vec4f,
  @location(0) css: vec2f,
  @location(1) @interpolate(flat) index: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ResolveVarying {
  var out: ResolveVarying;
  let r = records[ii];
  let t = quad_corner(vi) * 0.5 + vec2f(0.5, 0.5);
  let p = mix(r.rect.xy, r.rect.zw, t);
  out.pos = css_to_clip(p, view.size_css);
  out.css = p;
  out.index = ii;
  return out;
}

@fragment
fn fs(in: ResolveVarying) -> @location(0) vec4f {
  let r = records[in.index];
  let uv = (in.css - r.offset) / max(view.size_css, vec2f(1.0, 1.0));
  let d4 = textureSampleLevel(density, density_sampler, uv, i32(r.src.x), 0.0);
  let d = d4[min(u32(r.src.y), 3u)];
  let coverage = smoothstep(DENSITY_THRESHOLD - EDGE_SOFTNESS, DENSITY_THRESHOLD + EDGE_SOFTNESS, d);
  return r.color * coverage;
}
`;

/**
 * Shadow pass 3 (W88, D88-6): a separable gaussian, σ = blur / 2 CSS px (the CSS definition) in the
 * group target's px, one direction per pass (dir), at most SHADOW_MAX_TAPS taps per side; the
 * horizontal pass writes the temporary target, the vertical one blends over into the accumulator.
 */
export const SHADOW_BLUR_WGSL = /* wgsl */ `
${SHADOW_PASS_WGSL}
const MAX_TAPS: i32 = ${SHADOW_MAX_TAPS};

@group(0) @binding(0) var<uniform> sp: ShadowPass;
@group(0) @binding(1) var source: texture_2d<f32>;
${FULL_TRIANGLE_WGSL}
@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(source));
  let p = vec2i(frag.xy);
  let n = min(i32(sp.taps), MAX_TAPS);
  let s2 = max(sp.sigma * sp.sigma, 1e-6);
  let axis = vec2i(sp.dir);
  var acc = vec4f(0.0, 0.0, 0.0, 0.0);
  var wsum = 0.0;
  for (var i = -n; i <= n; i++) {
    let f = f32(i);
    let w = exp(-0.5 * f * f / s2);
    let q = clamp(p + axis * i, vec2i(0, 0), size - vec2i(1, 1));
    acc += textureLoad(source, q, 0) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-6);
}
`;

/**
 * Shadow pass 4 (W88, D88-10): the knockout. Per texel the closed coverage of the spread-0 density
 * channels (each element's own liquid): its coverage, or the smaller of two coverages at ± the
 * closing distance (and half of it) along four axes, so a hole narrower than about twice that
 * distance counts as covered while a straight outer edge stays where it is. r8unorm, half resolution.
 */
export const SHADOW_KNOCKOUT_WGSL = /* wgsl */ `
${SHADOW_PASS_WGSL}
const DENSITY_THRESHOLD: f32 = ${f32(DENSITY_THRESHOLD)};
const EDGE_SOFTNESS: f32 = ${f32(EDGE_SOFTNESS)};

@group(0) @binding(0) var<uniform> sp: ShadowPass;
@group(0) @binding(1) var density: texture_2d_array<f32>;
${FULL_TRIANGLE_WGSL}
fn coverage(p: vec2i, size: vec2i, layer: i32) -> vec4f {
  if (any(p < vec2i(0, 0)) || any(p >= size)) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }
  let lo = vec4f(DENSITY_THRESHOLD - EDGE_SOFTNESS);
  let hi = vec4f(DENSITY_THRESHOLD + EDGE_SOFTNESS);
  return smoothstep(lo, hi, textureLoad(density, p, layer, 0));
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(density).xy);
  let p = vec2i(frag.xy);
  let d_full = max(i32(sp.close), 1);
  let d_half = max(d_full / 2, 1);
  var axes = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(1, 1), vec2i(1, -1));
  var k = 0.0;
  let n = min(i32(sp.layers), 4);
  for (var l = 0; l < n; l++) {
    var best = coverage(p, size, l);
    for (var a = 0; a < 4; a++) {
      let ax = axes[a];
      best = max(best, min(coverage(p + ax * d_full, size, l), coverage(p - ax * d_full, size, l)));
      best = max(best, min(coverage(p + ax * d_half, size, l), coverage(p - ax * d_half, size, l)));
    }
    let m = best * sp.masks[l];
    k = max(k, max(max(m.x, m.y), max(m.z, m.w)));
  }
  return vec4f(k, 0.0, 0.0, 1.0);
}
`;

/**
 * Shadow pass 5 (W88, D88-4, D88-10): the first draw of the screen pass, under all liquid: the half-
 * and quarter-resolution accumulators (flags bit 0 and bit 1: written this frame), over each other,
 * times 1 − knockout; blended over. The liquid composite after it blends over too (D88-13).
 */
export const SHADOW_COMPOSITE_WGSL = /* wgsl */ `
${VIEW_WGSL}
${SHADOW_PASS_WGSL}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<uniform> sp: ShadowPass;
@group(0) @binding(2) var half_acc: texture_2d<f32>;
@group(0) @binding(3) var quarter_acc: texture_2d<f32>;
@group(0) @binding(4) var knockout: texture_2d<f32>;
@group(0) @binding(5) var shadow_sampler: sampler;
${FULL_TRIANGLE_WGSL}
@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy / max(view.size_px, vec2f(1.0, 1.0));
  let flags = u32(sp.flags);
  let h = textureSample(half_acc, shadow_sampler, uv) * f32(flags & 1u);
  let q = textureSample(quarter_acc, shadow_sampler, uv) * f32((flags >> 1u) & 1u);
  let shadow = h + q * (1.0 - h.a);
  let k = textureSample(knockout, shadow_sampler, uv).r;
  return shadow * (1.0 - k);
}
`;
