// Ward 060: LiveHero mount helper.
//
// Encapsulates the lifecycle so it can be unit-tested without Astro:
// - Checks prefers-reduced-motion → short-circuits without creating LiquidDOM
//   AND without dispatching `renderer-resolved` (honest accessibility behavior)
// - Otherwise: invokes the hero-blobs factory, dispatches the resolved event
//   for the W59 capability indicator, subscribes to renderer-change for
//   live-swap (destroy + remount + redispatch)
// - Returns a cleanup function (callers wire it to `beforeunload`)

import {
  subscribePreference,
  type RendererPreference,
} from "./renderer-store";
import type { HeroBlobsHandle } from "../showcases/hero-blobs";

const RESOLVED_EVENT = "liquiddom:renderer-resolved";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface LiveHeroStore {
  getPreference(): RendererPreference;
}

export type HeroFactory = (
  root: HTMLElement,
  renderer: RendererPreference,
) => Promise<HeroBlobsHandle>;

export async function mountLiveHero(
  root: HTMLElement,
  factory: HeroFactory,
  store: LiveHeroStore,
): Promise<{ destroy: () => void }> {
  if (typeof window === "undefined") return { destroy: () => {} };

  // Reduced-motion short-circuit. The CSS gradient (already present in the
  // <LiveHero> markup) stays as the visible hero. No event dispatch —
  // capability indicator stays hidden, honestly reflecting "nothing rendering."
  if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return { destroy: () => {} };
  }

  let handle: HeroBlobsHandle | null = null;
  let mounting = false;
  let pending: RendererPreference | null = null;

  function dispatchResolved(value: "canvas2d" | "webgpu"): void {
    window.dispatchEvent(
      new CustomEvent<{ resolved: "canvas2d" | "webgpu" }>(RESOLVED_EVENT, {
        detail: { resolved: value },
      }),
    );
  }

  async function startMount(pref: RendererPreference): Promise<void> {
    if (mounting) {
      pending = pref;
      return;
    }
    mounting = true;
    try {
      if (handle) {
        handle.destroy();
        handle = null;
      }
      handle = await factory(root, pref);
      dispatchResolved(handle.activeRenderer);
      // Drain queued preference (W59 last-writer-wins pattern).
      while (pending !== null) {
        const next = pending;
        pending = null;
        handle.destroy();
        handle = await factory(root, next);
        dispatchResolved(handle.activeRenderer);
      }
    } finally {
      mounting = false;
    }
  }

  // Subscribe BEFORE the initial mount: if the user toggles the renderer
  // during the ~100ms boot window (between `await initWasm()` and the first
  // tick), the event reaches the subscriber, which sets `pending` and the
  // drain loop inside startMount picks it up immediately after the initial
  // mount completes. Without this ordering, mid-boot toggles are lost.
  const unsubscribe = subscribePreference((newPref) => {
    void startMount(newPref);
  });

  // Initial mount.
  await startMount(store.getPreference());

  return {
    destroy() {
      unsubscribe();
      if (handle) {
        handle.destroy();
        handle = null;
      }
    },
  };
}
