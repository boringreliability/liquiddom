/**
 * W71 ward-review M3: a manual clock whose `advance(n)` returns how many frames actually ran.
 *
 * The runtime's LoopController re-requests the next frame at the end of a frame it ran
 * (`onFrame` then `reconcile`). It does not re-request when it skipped the frame (user pause,
 * hidden tab) or when the frame failed (the runtime destroys the loop). So a callback that
 * requested its successor ran and rendered a frame; the scenes' pixels() snapshots only then,
 * because a WebGPU canvas read outside the task that rendered it comes back cleared.
 */
import type { FrameClock, ManualClock } from "../packages/core/ts/src/clock";

export interface RenderCountingClock extends FrameClock {
  /** Runs `frames` manual frames of 1000/60 ms; returns how many of them rendered. */
  advance(frames: number): number;
}

export function createRenderCountingClock(manual: ManualClock): RenderCountingClock {
  let current: { requested: boolean } | null = null;
  let rendered = 0;
  return {
    now: () => manual.now(),
    request(cb) {
      if (current) current.requested = true;
      return manual.request((tMs) => {
        const outer = current;
        const mark = { requested: false };
        current = mark;
        try {
          cb(tMs);
        } finally {
          current = outer;
        }
        if (mark.requested) rendered += 1;
      });
    },
    cancel: (handle) => manual.cancel(handle),
    advance(frames) {
      const before = rendered;
      manual.advance(frames);
      return rendered - before;
    },
  };
}
