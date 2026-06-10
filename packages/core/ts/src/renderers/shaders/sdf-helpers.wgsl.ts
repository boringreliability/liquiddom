// Ward 038 — WGSL SDF helper functions, extracted so W40 refraction can
// reuse them without retrofitting. Concatenated into the blob-sdf module
// via TypeScript string composition (WGSL has no preprocessor #include).
//
// Functions:
//   sdSegment(p, a, b)        → unsigned distance from point to line segment
//   sdPolygon(p, base, count) → signed distance to polygon defined by
//                                particles[base..base+count]. Negative inside,
//                                positive outside. Uses Jordan-curve even/odd
//                                crossing rule (correct for simple polygons).
//   sdRoundedRect(p, rect, r) → signed distance to rounded rectangle.
//   sdCircle(p, center, r)    → analytical signed distance to a circle.
//                                Added in W62 for FreeDrop kind=1 dispatch
//                                (analytical circle instead of 16-gon polygon
//                                approximation). 5 ALU ops vs ~160 for polygon.
//
// `count` is a compile-time `const` injected by the consuming shader so the
// loop unrolls cleanly. blob-sdf passes PARTICLES_PER_BODY (16).
export const SDF_HELPERS_WGSL = /* wgsl */ `
fn sdSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sdPolygon(p: vec2<f32>, base: u32, count: u32) -> f32 {
  var d = dot(p - particles[base], p - particles[base]);
  var s = 1.0;
  var j = count - 1u;
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    let a = particles[base + j];
    let b = particles[base + i];
    let e = b - a;
    let w = p - a;
    let bb = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    let q = w - e * bb;
    d = min(d, dot(q, q));
    // Jordan-curve even/odd crossing rule (NOT a winding number — flips sign
    // on each edge crossing). Correct for simple polygons; self-intersecting
    // polygons during fast deformation produce visible tears (R2 in W38).
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

fn sdRoundedRect(p: vec2<f32>, rect: vec4<f32>, r: f32) -> f32 {
  // rect.xy = origin, rect.zw = size. r = corner radius (CPU-clamped to
  // min(w, h) / 2 per Decision §6 / R3 — prevents negative half-extent).
  let center = rect.xy + rect.zw * 0.5;
  let half_size = rect.zw * 0.5 - vec2<f32>(r);
  let d = abs(p - center) - half_size;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, center: vec2<f32>, radius: f32) -> f32 {
  return length(p - center) - radius;
}
`;
