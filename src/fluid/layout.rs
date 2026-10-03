//! FFI layout (spec §2 "FFI contract", amended by plan resolution B14).
//! Mirrored in `packages/core/ts/src/fluid-layout.ts` and MUST stay in sync:
//! `packages/core/ts/__tests__/fluid-layout.test.ts` parses this file, so keep
//! one `pub const NAME: type = literal;` per line.

// 1. Element buffer, written by TS: 10 floats per element.
pub const ELEMENT_STRIDE: usize = 10;
pub const EL_X: usize = 0;
pub const EL_Y: usize = 1;
pub const EL_W: usize = 2;
pub const EL_H: usize = 3;
pub const EL_RADIUS: usize = 4;
pub const EL_INTERACTION: usize = 5;
pub const EL_HOME_DX: usize = 6;
pub const EL_HOME_DY: usize = 7;
pub const EL_VISCOSITY: usize = 8;
pub const EL_RECOVERY: usize = 9;

// 4. Element state view, written by Rust every step: 4 floats per element.
pub const STATE_STRIDE: usize = 4;
pub const ST_S: usize = 0;
pub const ST_MAX_DEV: usize = 1;
pub const ST_REST_ALPHA: usize = 2;
pub const ST_RESERVED: usize = 3;

// 2. Dynamic particle view (SoA, field stride = particle capacity), every tick.
pub const DYNAMIC_FIELDS: usize = 7;
pub const DYN_X: usize = 0;
pub const DYN_Y: usize = 1;
pub const DYN_F00: usize = 2;
pub const DYN_F01: usize = 3;
pub const DYN_F10: usize = 4;
pub const DYN_F11: usize = 5;
pub const DYN_FLAGS: usize = 6;

// 3. Static particle view (SoA), written at redistribution only.
pub const STATIC_FIELDS: usize = 3;
pub const STAT_HOME: usize = 0;
pub const STAT_REST_U: usize = 1;
pub const STAT_REST_V: usize = 2;

pub const HOME_NONE: f32 = -1.0;
pub const FLAG_TORN: u32 = 1;

pub const INTERACTION_IDLE: f32 = 0.0;
pub const INTERACTION_HOVER: f32 = 1.0;
pub const INTERACTION_FOCUSED: f32 = 2.0;
pub const INTERACTION_DRAGGED: f32 = 3.0;

// Plan resolution B1: the home rect swells by this fraction around its centre
// while hovered (never under reduced motion). TS draws the rest contour with it.
pub const HOVER_SWELL: f32 = 0.02;
