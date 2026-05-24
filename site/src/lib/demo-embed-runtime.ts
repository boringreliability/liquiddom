// Ward 059: DemoEmbed runtime lifecycle helper.
//
// Each showcase page imports this + its factory, then on DOMContentLoaded
// passes the demo-embed root element + factory here. The helper owns the
// full lifecycle: initial mount, renderer-change destroy+recreate, reset
// button wiring, beforeunload cleanup, powered-by badge population, and
// `liquiddom:renderer-resolved` event dispatch (consumed by the capability
// indicator on the RendererToggle).

import {
  getPreference,
  subscribePreference,
  type RendererPreference,
} from "./renderer-store";
import type { Showcase, ShowcaseFactory } from "../showcases/types";

const RESOLVED_EVENT = "liquiddom:renderer-resolved";

export async function wireDemoEmbed(
  root: HTMLElement,
  factory: ShowcaseFactory,
): Promise<() => void> {
  // The demo area is a slot inside the root; the factory creates
  // its own canvas inside this container per W41's mechanism.
  const stage = root.querySelector<HTMLElement>("[data-demo-stage]") ?? root;
  const poweredBy = root.querySelector<HTMLElement>("[data-powered-by]");
  const resetBtn = root.querySelector<HTMLButtonElement>("[data-demo-reset]");

  let handle: Showcase | null = null;

  async function mount(pref: RendererPreference): Promise<void> {
    handle = await factory(stage, pref);
    if (poweredBy) poweredBy.textContent = handle.activeRenderer;
    window.dispatchEvent(
      new CustomEvent<{ resolved: "canvas2d" | "webgpu" }>(RESOLVED_EVENT, {
        detail: { resolved: handle.activeRenderer },
      }),
    );
  }

  function destroy(): void {
    if (handle) {
      handle.destroy();
      handle = null;
    }
  }

  await mount(getPreference());

  // Renderer toggle: destroy + recreate. LiquidDOM owns its canvas via
  // the `container` param (W41) so a fresh canvas is produced on each
  // create — no manual canvas management needed here.
  //
  // Rapid-toggle semantics: last-writer-wins. If a mount is still in flight
  // when a new preference arrives, store it as `pending`; when the in-flight
  // mount completes, immediately start a new mount with `pending`. This
  // guarantees the final preference is what the user sees, even on
  // bursts of clicks faster than the WASM init cycle.
  let mounting = false;
  let pending: RendererPreference | null = null;

  async function startMount(pref: RendererPreference): Promise<void> {
    if (mounting) {
      pending = pref;
      return;
    }
    mounting = true;
    try {
      destroy();
      await mount(pref);
      // Drain any preference that arrived while we were mounting.
      while (pending !== null) {
        const next = pending;
        pending = null;
        destroy();
        await mount(next);
      }
    } finally {
      mounting = false;
    }
  }

  const unsubscribePref = subscribePreference((newPref) => {
    void startMount(newPref);
  });

  // Reset button: destroy + remount at current preference.
  const onReset = () => {
    void startMount(getPreference());
  };
  resetBtn?.addEventListener("click", onReset);

  // Cleanup on full page unload. `beforeunload` fires when the page enters
  // BFCache on most browsers — meaning back-button restore returns to a
  // dead canvas (instance destroyed, RAF loop stopped, last frame frozen
  // on screen until full reload). Acceptable trade-off for v1; revisit in
  // W62 polish if user telemetry shows BFCache returns are common.
  const onUnload = () => destroy();
  window.addEventListener("beforeunload", onUnload);

  return () => {
    unsubscribePref();
    resetBtn?.removeEventListener("click", onReset);
    window.removeEventListener("beforeunload", onUnload);
    destroy();
  };
}
