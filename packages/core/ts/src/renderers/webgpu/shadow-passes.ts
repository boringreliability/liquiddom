/**
 * W88 (D88-6, D88-10, D88-11): the WebGPU shadow passes. W88.1 stub: the shared record layout only;
 * W88.4 fills it.
 */

/** Floats per ShadowPass record (WGSL `struct ShadowPass`, 128 bytes) and per 256-byte slot. */
export const SHADOW_PASS_FLOATS = 32;
export const SHADOW_SLOT_FLOATS = 64;
export const SHADOW_SLOT_BYTES = SHADOW_SLOT_FLOATS * 4;
export const SHADOW_MAX_SLOTS = 64;
/** Offsets in a ShadowPass record. */
export const SP = {
  TARGET_W: 0, TARGET_H: 1, DIR_X: 2, DIR_Y: 3, SIGMA: 4, TAPS: 5, ELEMENT: 6, KERNEL_R: 7, WEIGHT: 8, CLOSE: 9, LAYERS: 10, FLAGS: 11, MASK: 12, MASKS: 16,
} as const;
export const SHADOW_RECORD_FLOATS = 12;
export const SHADOW_MAX_RECORDS = 64;
