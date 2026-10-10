//! W74 (D74-1, D74-3): the render-only deformation gradient F (spec §2 "Deformation
//! gradient F"): a closed-form 2×2 SVD, the σ clamp with det < 0 flipped to the nearest
//! proper matrix, and the per-substep update with the sticky `torn` hysteresis. Pure,
//! allocation-free and panic-free. Matrices are row-major `[m00, m01, m10, m11]`, like C.
//!
//! Closed form (J. Blinn, "Consider the lowly 2×2 matrix"): with E = (a + d)/2,
//! F = (a − d)/2, G = (c + b)/2, H = (c − b)/2, Q = √(E² + H²), R = √(F² + G²):
//! M = R(φ)·diag(Q + R, Q − R)·R(θ), φ = (atan2(H, E) + atan2(G, F))/2,
//! θ = (atan2(H, E) − atan2(G, F))/2, R(t) the rotation by t. Q − R < 0 ⇔ det M < 0.

use super::particles::IDENTITY;
use super::solver::SLIP_RATE_PER_S;

/// Spec §2: singular values outside [F_SIGMA_MIN, F_SIGMA_MAX] are clamped and tear the particle.
pub const F_SIGMA_MIN: f32 = 0.2;
pub const F_SIGMA_MAX: f32 = 5.0;
/// D74-3: a torn particle heals only once both singular values are back in this band.
pub const TORN_CLEAR_MIN: f32 = 0.67;
pub const TORN_CLEAR_MAX: f32 = 1.5;
/// D74-2: rest also needs, per element, max ‖F − I‖_F below this.
pub const F_REST_TOL: f32 = 0.05;
/// D74-2 (amended after W74.0, saga dec_f34db06a): F's own slip rate towards I, 1.5 × the
/// liquid's SLIP_RATE_PER_S, so F reaches F_REST_TOL no later than the positions reach rest
/// (the shared rate gave the strength-2 card splash 218 frames, budget 180). Only `update_f` uses it.
pub const F_SLIP_RATE_PER_S: f32 = 1.5 * SLIP_RATE_PER_S;

/// 2×2 product `m · n`, row-major.
#[inline]
pub fn mul2(m: [f32; 4], n: [f32; 4]) -> [f32; 4] {
    let [a, b, c, d] = m;
    let [e, f, g, h] = n;
    [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h]
}

/// Blinn's terms of `m`: (E, F, G, H, Q, R). `sqrt` instead of `hypot`: F stays within
/// σ ∈ [0.2, 5], far from overflow, and this runs per particle per substep.
#[inline]
fn blinn(m: [f32; 4]) -> (f32, f32, f32, f32, f32, f32) {
    let [a, b, c, d] = m;
    let e = 0.5 * (a + d);
    let f = 0.5 * (a - d);
    let g = 0.5 * (c + b);
    let h = 0.5 * (c - b);
    (e, f, g, h, (e * e + h * h).sqrt(), (f * f + g * g).sqrt())
}

/// (φ, θ) of the closed form.
#[inline]
fn angles(e: f32, f: f32, g: f32, h: f32) -> (f32, f32) {
    let (a1, a2) = (g.atan2(f), h.atan2(e));
    (0.5 * (a2 + a1), 0.5 * (a2 - a1))
}

/// R(t) = [[cos t, −sin t], [sin t, cos t]].
#[inline]
fn rot(t: f32) -> [f32; 4] {
    let (s, c) = t.sin_cos();
    [c, -s, s, c]
}

/// Closed-form 2×2 SVD: `F = U·diag(σ)·Vᵀ`, σ = [σ1, σ2] with σ1 ≥ σ2 ≥ 0. U is a rotation;
/// V is a rotation when det F ≥ 0 and a reflection when det F < 0. No allocation.
pub fn svd2(f: [f32; 4]) -> ([f32; 4], [f32; 2], [f32; 4]) {
    let (e, ff, g, h, q, r) = blinn(f);
    let (phi, theta) = angles(e, ff, g, h);
    let sy = q - r;
    // Vᵀ = diag(1, sign(sy))·R(θ), so U·diag(σ1, |sy|)·Vᵀ = R(φ)·diag(σ1, sy)·R(θ) = F.
    let [t0, t1, t2, t3] = rot(theta);
    let s = if sy < 0.0 { -1.0 } else { 1.0 };
    (rot(phi), [q + r, sy.abs()], [t0, s * t2, t1, s * t3])
}

/// Spec §2 safety clamp: F is returned unchanged when σ1 ≤ F_SIGMA_MAX and the signed
/// σ2 ≥ F_SIGMA_MIN (which implies det F > 0). Otherwise both singular values are clamped into
/// the band and a negative det is flipped to the nearest proper matrix (σ2 changes sign);
/// `hit_clamp` is true.
pub fn clamp_f(f: [f32; 4]) -> ([f32; 4], bool) {
    let (e, ff, g, h, q, r) = blinn(f);
    let (sx, sy) = (q + r, q - r);
    if sx <= F_SIGMA_MAX && sy >= F_SIGMA_MIN {
        return (f, false);
    }
    (clamped(e, ff, g, h, sx, sy), true)
}

/// `R(φ)·diag(clamp(sx), clamp(|sy|))·R(θ)` from Blinn's terms without trigonometry (a clamped
/// particle is re-clamped on every substep, so this is hot): F is the sum of its conformal part
/// Q = [[E, −H], [H, E]] (= q·R(φ+θ)) and its anticonformal part A = [[F, G], [G, −F]]
/// (= r·R(φ)·diag(1, −1)·R(θ)), so scaling them by q'/q and r'/r with q' = (σ1' + σ2')/2 and
/// r' = (σ1' − σ2')/2 gives the clamped matrix. Only q ≈ 0 (a pure reflection-scale, where
/// R(φ+θ) is undefined) takes the angle path. Plan validation 2026-10-10: the native F-cost
/// ratio fell from 1.31 (angles) to 1.22.
#[inline]
fn clamped(e: f32, ff: f32, g: f32, h: f32, sx: f32, sy: f32) -> [f32; 4] {
    let s1 = sx.clamp(F_SIGMA_MIN, F_SIGMA_MAX);
    let s2 = sy.abs().clamp(F_SIGMA_MIN, F_SIGMA_MAX);
    let q = 0.5 * (sx + sy);
    let r = 0.5 * (sx - sy);
    if q <= 1e-6 {
        let (phi, theta) = angles(e, ff, g, h);
        return mul2(mul2(rot(phi), [s1, 0.0, 0.0, s2]), rot(theta));
    }
    let kq = 0.5 * (s1 + s2) / q;
    let ka = if r > 1e-6 { 0.5 * (s1 - s2) / r } else { 0.0 };
    [
        kq * e + ka * ff,
        ka * g - kq * h,
        kq * h + ka * g,
        kq * e - ka * ff,
    ]
}

/// ‖F − I‖ (Frobenius), D74-2's rest measure.
#[inline]
pub fn f_dev(f: [f32; 4]) -> f32 {
    let [a, b, c, d] = f;
    ((a - 1.0) * (a - 1.0) + b * b + c * c + (d - 1.0) * (d - 1.0)).sqrt()
}

/// One substep of the render-only F (spec §2, D74-1, D74-3): `F ← (I + dt·C)·F`, the slip
/// `F ← F + k·(I − F)` with `k = clamp(dt·F_SLIP_RATE_PER_S·s², 0, 1)` (s clamped to [0, 1],
/// non-finite → 1), then `clamp_f`. `torn` is sticky: set when the clamp hits, cleared only
/// when both singular values of the new F lie in [TORN_CLEAR_MIN, TORN_CLEAR_MAX]. A
/// non-finite intermediate F (from F, C or dt) gives `(I, true)`.
pub fn update_f(f: [f32; 4], c: [f32; 4], dt: f32, stiffness: f32, torn: bool) -> ([f32; 4], bool) {
    let [c00, c01, c10, c11] = c;
    let mut g = mul2([1.0 + dt * c00, dt * c01, dt * c10, 1.0 + dt * c11], f);
    let s = if stiffness.is_finite() {
        stiffness.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let k = (dt * F_SLIP_RATE_PER_S * s * s).clamp(0.0, 1.0);
    for (gi, id) in g.iter_mut().zip(IDENTITY) {
        *gi += k * (id - *gi);
    }
    if !g.iter().all(|v| v.is_finite()) {
        return (IDENTITY, true);
    }
    // `clamp_f` inlined so Blinn's terms are computed once per particle and substep (hot path).
    let (e, ff, gg, h, q, r) = blinn(g);
    let (sx, sy) = (q + r, q - r);
    if sx <= F_SIGMA_MAX && sy >= F_SIGMA_MIN {
        let healed = sy >= TORN_CLEAR_MIN && sx <= TORN_CLEAR_MAX;
        return (g, torn && !healed);
    }
    (clamped(e, ff, gg, h, sx, sy), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::solver::SLIP_RATE_PER_S;

    const DT: f32 = 1.0 / 480.0;
    /// Identity, a rotation, mild deformations, a strong stretch, det < 0 and near-singular.
    const CASES: [[f32; 4]; 8] = [
        [1.0, 0.0, 0.0, 1.0],
        [0.0, -1.0, 1.0, 0.0],
        [1.2, 0.1, -0.2, 0.9],
        [3.0, 2.5, 0.1, 0.2],
        [1.0, 0.0, 0.0, -0.5],
        [-1.96, 1.07, -0.56, 1.93],
        [7.0, 0.0, 0.0, 1.0],
        [0.4, 1.3, -0.7, 0.05],
    ];

    fn transpose(m: [f32; 4]) -> [f32; 4] {
        [m[0], m[2], m[1], m[3]]
    }

    fn det(m: [f32; 4]) -> f32 {
        m[0] * m[3] - m[1] * m[2]
    }

    fn rot(t: f32) -> [f32; 4] {
        let (s, c) = t.sin_cos();
        [c, -s, s, c]
    }

    fn diag(a: f32, b: f32) -> [f32; 4] {
        [a, 0.0, 0.0, b]
    }

    fn close(a: [f32; 4], b: [f32; 4], tol: f32) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol)
    }

    /// (σ1, σ2), σ1 ≥ σ2 ≥ 0, from the eigenvalues of FᵀF (independent of `svd2`).
    fn sigmas(m: [f32; 4]) -> (f32, f32) {
        let p = mul2(transpose(m), m);
        let half_tr = 0.5 * (p[0] + p[3]);
        let disc = (half_tr * half_tr - det(p)).max(0.0).sqrt();
        ((half_tr + disc).sqrt(), (half_tr - disc).max(0.0).sqrt())
    }

    #[test]
    fn given_2x2_matrices_when_svd2_then_u_sigma_vt_reconstructs_f_with_sigma_descending_non_negative_and_orthogonal_u_v()
     {
        for f in CASES {
            let (u, [s1, s2], v) = svd2(f);
            assert!(s1 >= s2 && s2 >= 0.0, "{f:?}: σ = ({s1}, {s2})");
            let (e1, e2) = sigmas(f);
            assert!(
                (s1 - e1).abs() < 1e-4 && (s2 - e2).abs() < 1e-4,
                "{f:?}: σ ({s1}, {s2}) vs ({e1}, {e2})"
            );
            let back = mul2(mul2(u, diag(s1, s2)), transpose(v));
            assert!(close(back, f, 1e-4), "{f:?} → U·Σ·Vᵀ = {back:?}");
            assert!(
                close(mul2(u, transpose(u)), IDENTITY, 1e-5),
                "{f:?}: U orthogonal"
            );
            assert!(
                close(mul2(v, transpose(v)), IDENTITY, 1e-5),
                "{f:?}: V orthogonal"
            );
            assert!(det(u) > 0.0, "{f:?}: U is a rotation");
        }
    }

    #[test]
    fn given_f_inside_the_clamp_band_with_det_above_0_when_clamp_f_then_bit_identical_and_no_hit() {
        for f in [
            IDENTITY,
            rot(0.7),
            [1.2, 0.1, -0.2, 0.9],
            mul2(rot(-0.4), diag(1.4, 0.8)),
            mul2(mul2(rot(0.2), diag(4.9, 0.21)), rot(1.0)),
        ] {
            assert_eq!(clamp_f(f), (f, false), "{f:?}");
        }
    }

    #[test]
    fn given_singular_values_beyond_5_or_below_0_2_when_clamp_f_then_clamped_into_the_band_rotations_kept_and_hit()
     {
        let (out, hit) = clamp_f(mul2(rot(0.3), diag(7.0, 1.0)));
        assert!(hit);
        assert!(close(out, mul2(rot(0.3), diag(5.0, 1.0)), 1e-4), "{out:?}");
        let squashed = mul2(mul2(rot(1.1), diag(1.0, 0.05)), rot(-0.4));
        let (out, hit) = clamp_f(squashed);
        assert!(hit);
        assert!(
            close(out, mul2(mul2(rot(1.1), diag(1.0, 0.2)), rot(-0.4)), 1e-4),
            "{out:?}"
        );
        let (out, hit) = clamp_f([3.0, 2.5, 0.1, 0.2]); // σ ≈ (3.91, 0.0895)
        let (s1, s2) = sigmas(out);
        assert!(
            hit && (s1 - 3.910_497).abs() < 1e-3 && (s2 - F_SIGMA_MIN).abs() < 1e-4,
            "σ ({s1}, {s2})"
        );
    }

    #[test]
    fn given_det_below_0_when_clamp_f_then_det_above_0_with_the_same_singular_values_and_hit_d74_3()
    {
        let (out, hit) = clamp_f([1.0, 0.0, 0.0, -0.5]);
        assert!(hit);
        assert!(
            close(out, [1.0, 0.0, 0.0, 0.5], 1e-5),
            "nearest proper matrix: {out:?}"
        );
        let f = [-1.96, 1.07, -0.56, 1.93];
        assert!(det(f) < 0.0);
        let (out, hit) = clamp_f(f);
        let (a1, a2) = sigmas(f);
        let (b1, b2) = sigmas(out);
        assert!(hit && det(out) > 0.0, "det {}", det(out));
        assert!(
            (a1 - b1).abs() < 1e-4 && (a2 - b2).abs() < 1e-4,
            "σ ({a1}, {a2}) → ({b1}, {b2})"
        );
    }

    #[test]
    fn given_identity_and_a_velocity_gradient_when_update_f_then_f_is_i_plus_dt_c_times_f() {
        let (f, torn) = update_f(IDENTITY, [0.0, 2.0, 0.0, 0.0], DT, 0.0, false);
        assert!(!torn);
        assert!(close(f, [1.0, 2.0 * DT, 0.0, 1.0], 1e-7), "{f:?}");
        let (f, _) = update_f(diag(1.5, 1.0), [1.0, 0.0, 0.0, 0.0], DT, 0.0, false);
        assert!(
            close(f, diag(1.5 * (1.0 + DT), 1.0), 1e-7),
            "(I + dt·C)·F, not F·(I + dt·C): {f:?}"
        );
        let (f, _) = update_f([1.0, 0.5, 0.0, 1.0], [0.0, 0.0, 3.0, 0.0], DT, 0.0, false);
        assert!(
            close(f, [1.0, 0.5, 3.0 * DT, 1.0 + 1.5 * DT], 1e-6),
            "{f:?}"
        );
    }

    #[test]
    fn given_s_1_and_a_stretched_f_when_update_f_for_1_s_then_f_relaxes_towards_i_at_f_slip_rate_4_5_times_s_squared()
     {
        for (s, rate) in [(1.0f32, F_SLIP_RATE_PER_S), (0.5, F_SLIP_RATE_PER_S * 0.25)] {
            let mut f = diag(1.4, 1.0);
            for _ in 0..480 {
                f = update_f(f, [0.0; 4], DT, s, false).0;
            }
            let expected = 0.4 * (1.0 - DT * rate).powi(480);
            assert!(
                (f[0] - 1.0 - expected).abs() < 1e-4,
                "s = {s}: f00 − 1 = {} vs {expected}",
                f[0] - 1.0
            );
            assert_eq!([f[1], f[2], f[3]], [0.0, 0.0, 1.0]);
        }
    }

    #[test]
    fn given_a_torn_particle_when_update_f_then_torn_clears_only_with_both_singular_values_in_0_67_to_1_5_d74_3()
     {
        let keep = |f: [f32; 4], torn: bool| update_f(f, [0.0; 4], 0.0, 1.0, torn);
        assert!(keep(diag(1.6, 1.0), true).1, "σ1 = 1.6 > 1.5: stays torn");
        assert!(keep(diag(1.0, 0.6), true).1, "σ2 = 0.6 < 0.67: stays torn");
        assert!(!keep(diag(1.4, 0.7), true).1, "both in [0.67, 1.5]: heals");
        assert!(
            !keep(diag(1.6, 1.0), false).1,
            "inside the clamp band: never torn by itself"
        );
        let (f, torn) = keep(diag(6.0, 1.0), false);
        assert!(torn, "the clamp tears");
        assert!(close(f, diag(5.0, 1.0), 1e-4), "{f:?}");
    }

    #[test]
    fn given_non_finite_f_or_c_when_update_f_then_identity_and_torn() {
        assert_eq!(
            update_f([f32::NAN, 0.0, 0.0, 1.0], [0.0; 4], DT, 1.0, false),
            (IDENTITY, true)
        );
        assert_eq!(
            update_f(IDENTITY, [f32::INFINITY, 0.0, 0.0, 0.0], DT, 1.0, false),
            (IDENTITY, true)
        );
        assert_eq!(
            update_f(IDENTITY, [1.0, 0.0, 0.0, 0.0], f32::NAN, 1.0, false),
            (IDENTITY, true)
        );
        let (f, torn) = update_f(IDENTITY, [0.0; 4], DT, f32::NAN, false);
        assert_eq!(
            (f, torn),
            (IDENTITY, false),
            "a NaN stiffness counts as 1 (slip towards I is a no-op on I)"
        );
    }

    #[test]
    fn given_the_d74_constants_when_read_then_0_2_5_0_67_1_5_and_0_05() {
        assert_eq!(
            (
                F_SIGMA_MIN,
                F_SIGMA_MAX,
                TORN_CLEAR_MIN,
                TORN_CLEAR_MAX,
                F_REST_TOL
            ),
            (0.2, 5.0, 0.67, 1.5, 0.05)
        );
        assert!(
            (f_dev([1.03, 0.0, 0.04, 1.0]) - 0.05).abs() < 1e-6,
            "‖F − I‖ is the Frobenius norm"
        );
        assert_eq!(f_dev(IDENTITY), 0.0);
    }

    #[test]
    fn given_d74_2_amended_when_reading_the_f_slip_rate_then_it_is_1_5_times_the_liquid_slip_rate()
    {
        assert_eq!(
            F_SLIP_RATE_PER_S,
            1.5 * SLIP_RATE_PER_S,
            "D74-2 amended: F-only slip 1.5×"
        );
        assert_eq!(F_SLIP_RATE_PER_S, 4.5);
    }
}
