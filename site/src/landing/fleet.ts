/**
 * The landing's instances as one unit (D86-3, D85-1): when any of them stops, every one is destroyed,
 * so no element stays decorated on a dead canvas, and the page says so once.
 */
export interface Destroyable { destroy(): void }

export interface Fleet {
  readonly stopped: boolean;
  /**
   * Tracks an instance that is still being created. Resolves to it, or to null when the fleet stopped
   * before it arrived (it is then destroyed on arrival). A create() rejection propagates.
   */
  add<T extends Destroyable>(pending: Promise<T>): Promise<T | null>;
  /** Runs once on stop, before the instances are destroyed (observers, timers). Runs at once if already stopped. */
  onStop(cleanup: () => void): void;
  /** Idempotent: runs the cleanups, destroys every arrived instance, then calls `onStopped` once. */
  stop(): void;
}

function quietly(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("[site] cleanup after a stop failed", err);
  }
}

export function createFleet(onStopped: () => void): Fleet {
  const live = new Set<Destroyable>();
  const cleanups: (() => void)[] = [];
  let stopped = false;
  return {
    get stopped() {
      return stopped;
    },
    async add<T extends Destroyable>(pending: Promise<T>): Promise<T | null> {
      const inst = await pending;
      if (stopped) {
        quietly(() => inst.destroy());
        return null;
      }
      live.add(inst);
      return inst;
    },
    onStop(cleanup) {
      if (stopped) quietly(cleanup);
      else cleanups.push(cleanup);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const c of cleanups.splice(0)) quietly(c);
      for (const inst of live) quietly(() => inst.destroy());
      live.clear();
      onStopped();
    },
  };
}
