//! Panic-free slice access (plan resolution B7: `clippy::indexing_slicing` is
//! denied in `src/fluid`). Out-of-range reads return the fallback and
//! out-of-range writes are dropped. TS validates every input first, so these
//! fallbacks are the last line of defence, not control flow.

#[inline]
pub fn rd(buf: &[f32], i: usize) -> f32 {
    buf.get(i).copied().unwrap_or(0.0)
}

#[inline]
pub fn rd_or(buf: &[f32], i: usize, fallback: f32) -> f32 {
    buf.get(i).copied().unwrap_or(fallback)
}

#[inline]
pub fn wr(buf: &mut [f32], i: usize, v: f32) {
    if let Some(slot) = buf.get_mut(i) {
        *slot = v;
    }
}

#[inline]
pub fn add(buf: &mut [f32], i: usize, v: f32) {
    if let Some(slot) = buf.get_mut(i) {
        *slot += v;
    }
}

#[inline]
pub fn rd_u32(buf: &[u32], i: usize) -> u32 {
    buf.get(i).copied().unwrap_or(0)
}

#[inline]
pub fn wr_u32(buf: &mut [u32], i: usize, v: u32) {
    if let Some(slot) = buf.get_mut(i) {
        *slot = v;
    }
}

#[inline]
pub fn rd4(buf: &[[f32; 4]], i: usize, fallback: [f32; 4]) -> [f32; 4] {
    buf.get(i).copied().unwrap_or(fallback)
}

#[inline]
pub fn wr4(buf: &mut [[f32; 4]], i: usize, v: [f32; 4]) {
    if let Some(slot) = buf.get_mut(i) {
        *slot = v;
    }
}

#[inline]
pub fn finite_or(v: f32, fallback: f32) -> f32 {
    if v.is_finite() { v } else { fallback }
}

#[inline]
pub fn positive(v: f32) -> bool {
    v.is_finite() && v > 0.0
}
