/**
 * W65 (D65-1): frame scheduling seam.
 *
 * The runtime never calls requestAnimationFrame directly; it asks a FrameClock.
 * `rafClock` is the production clock. `createManualClock()` runs frames only
 * when `advance()` is called, at a fixed dt, so Playwright visual tests and
 * vitest get bit-identical frames regardless of machine speed.
 */
export interface FrameClock {
  now(): number;
  request(cb: (tMs: number) => void): number;
  cancel(handle: number): void;
}

/** requestAnimationFrame-backed clock. Globals are read lazily (SSR-safe import). */
export const rafClock: FrameClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export const DEFAULT_FRAME_MS = 1000 / 60;

export interface ManualClock extends FrameClock {
  /** Runs `frames` frames, each `dtMs` (default 1000/60) after the previous one. */
  advance(frames: number, dtMs?: number): void;
}

export function createManualClock(startMs = 0): ManualClock {
  if (!Number.isFinite(startMs)) {
    throw new TypeError(`[liquiddom] createManualClock: startMs must be finite, got ${startMs}`);
  }
  let nowMs = startMs;
  let nextHandle = 1;
  let pending = new Map<number, (tMs: number) => void>();
  let running: Map<number, (tMs: number) => void> | null = null;

  return {
    now: () => nowMs,
    request(cb) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
      // RAF semantics: cancelling a callback of the frame being run skips it.
      running?.delete(handle);
    },
    advance(frames, dtMs = DEFAULT_FRAME_MS) {
      if (!Number.isInteger(frames) || frames < 0) {
        throw new TypeError(`[liquiddom] ManualClock.advance: frames must be a non-negative integer, got ${frames}`);
      }
      if (!Number.isFinite(dtMs) || dtMs < 0) {
        throw new TypeError(`[liquiddom] ManualClock.advance: dtMs must be finite and >= 0, got ${dtMs}`);
      }
      for (let f = 0; f < frames; f += 1) {
        nowMs += dtMs;
        // Callbacks requested during this frame run on the next one (RAF semantics).
        running = pending;
        pending = new Map();
        try {
          // Map iteration skips entries deleted before they are visited.
          for (const cb of running.values()) cb(nowMs);
        } finally {
          running = null;
        }
      }
    },
  };
}
