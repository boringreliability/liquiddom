// Ward 059: capability indicator for the renderer toggle.
//
// Listens to `liquiddom:renderer-resolved` events dispatched by DemoEmbed (+
// future LiveHero in W60). Updates the `[data-renderer-active]` element's
// text to reflect what the demo actually got — which may differ from the
// user's preference (e.g., user picked WebGPU on Firefox; demo resolved to
// canvas2d via W41 auto-fallback).
//
// Returns a cleanup function that removes the event listener.

import type { RendererPreference } from "./renderer-store";

export interface CapabilityIndicatorOptions {
  /** Reads the user's current toggle preference. The indicator phrases
   *  the message differently when resolved matches vs mismatches this. */
  getCurrentPreference: () => RendererPreference;
}

const EVENT_NAME = "liquiddom:renderer-resolved";

export function wireCapabilityIndicator(
  root: HTMLElement,
  opts: CapabilityIndicatorOptions,
): () => void {
  if (typeof window === "undefined") return () => {};

  const indicator = root.querySelector<HTMLElement>("[data-renderer-active]");
  if (!indicator) return () => {};

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ resolved: "canvas2d" | "webgpu" }>).detail;
    const resolved = detail.resolved;
    const pref = opts.getCurrentPreference();
    // "auto" always counts as a match — the user explicitly opted in to
    // whatever auto-fallback picks.
    const matches = pref === "auto" || pref === resolved;
    indicator.textContent = matches
      ? `Active: ${resolved}`
      : `Active: ${resolved} (WebGPU unavailable)`;
    indicator.dataset.match = matches ? "true" : "false";
    indicator.hidden = false;
  };

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
