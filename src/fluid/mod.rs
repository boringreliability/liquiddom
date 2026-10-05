//! MLS-MPM fluid engine (spec 2026-10-02 §2). W64: the at-rest core
//! (sampling, home spring, reduced-motion pin) behind the full FFI surface.
//!
//! Plan resolution B7: no panicking indexing, no unwrap/expect/panic in
//! non-test code. Tests may index freely.
#![cfg_attr(
    not(test),
    deny(
        clippy::indexing_slicing,
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic
    )
)]

pub mod access;
pub mod api;
pub mod clock;
pub mod elements;
pub mod grid;
pub mod interaction;
pub mod layout;
pub mod material;
pub mod particles;
pub mod pool;
pub mod rng;
pub mod sampling;
pub mod solver;
pub mod views;

#[cfg(test)]
mod scenario_tests;

pub use api::FluidCore;
