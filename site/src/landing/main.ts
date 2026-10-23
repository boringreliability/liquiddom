/** The landing's boot script: wires the landing modules to liquiddom's public API (D86-1 … D86-4). */
import { LiquidDOM, presets, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import { BODY_OPTIONS, POOL_OPTIONS } from "./config";
import { startArrival } from "./arrival";
import { pauseOffscreen } from "./offscreen";
import { showStopped } from "./stopped";
import { dialVector } from "../lib/dial";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const stop = () => showStopped(document);
const $ = <T extends Element>(s: string) => document.querySelector<T>(s);
const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];

async function pool(el: HTMLElement, extra: Partial<LiquidOptions>): Promise<LiquidDOMInstance> {
  const inst = await LiquidDOM.create({ ...POOL_OPTIONS, container: el, autoObserve: false, onError: stop, ...extra });
  for (const card of el.querySelectorAll<HTMLElement>("[data-pool-el]")) inst.observe(card);
  pauseOffscreen(inst, el);
  return inst;
}

async function boot(): Promise<void> {
  // Drag-off elements are observed first (observe is idempotent; the first options win).
  const body = await LiquidDOM.create({ ...BODY_OPTIONS, autoObserve: false, onError: stop });
  for (const el of $$<HTMLElement>("[data-liquid-drag-off]")) body.observe(el, { drag: false });
  for (const el of $$<HTMLElement>("[data-liquid]")) body.observe(el);
  startArrival(body, $$<HTMLElement>("[data-hero]"), { reducedMotion: reduced });

  $("#hero-splash")?.addEventListener("click", () => $$<HTMLElement>("[data-hero]").forEach((el) => body.splash(el)));
  $("#poke-all")?.addEventListener("click", () => {
    const strength = Number($<HTMLInputElement>("#poke-strength")?.value ?? 1);
    $$<HTMLElement>('[data-chapter="2"] [data-liquid]').forEach((el) => body.splash(el, { strength }));
  });
  $("#tilt-dial")?.addEventListener("input", (e) => {
    body.setGravity({ source: "fixed", vector: dialVector(Number((e.target as HTMLInputElement).value)) });
  });
  const tilt = $<HTMLButtonElement>("#tilt-device");
  if (tilt && "DeviceOrientationEvent" in window && matchMedia("(pointer: coarse)").matches) {
    tilt.hidden = false;
    tilt.addEventListener("click", async () => {
      if (await body.requestOrientationPermission()) body.setGravity({ source: "orientation" });
    });
  }

  const pools = await Promise.all(
    $$<HTMLElement>(".pool[data-preset]").map((el) => pool(el, { material: presets[el.dataset.preset as keyof typeof presets] })),
  );
  $("#shake-all")?.addEventListener("click", () => pools.forEach((p) => p.shake(1)));
  const liveEl = $<HTMLElement>('.pool[data-calm="live"]');
  const stillEl = $<HTMLElement>('.pool[data-calm="still"]');
  if (!liveEl || !stillEl) return;
  const calm: [LiquidDOMInstance, HTMLElement][] = [
    [await pool(liveEl, {}), liveEl],
    [await pool(stillEl, { forceReducedMotion: true }), stillEl],
  ];
  $("#splash-both")?.addEventListener("click", () => {
    for (const [inst, el] of calm) for (const card of el.querySelectorAll<HTMLElement>("[data-pool-el]")) inst.splash(card);
  });
}

/** Chapter 8: the Vanilla / React / Vue tabs (WAI-ARIA tabs, arrow keys move between them). No liquid. */
function tabs(): void {
  const list = $$<HTMLButtonElement>('[role="tab"]');
  const select = (tab: HTMLButtonElement) => {
    for (const t of list) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !on;
    }
  };
  list.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      const next = list[(i + step + list.length) % list.length];
      if (next) {
        select(next);
        next.focus();
      }
    });
  });
}

/** Chapter 8: copy the install line. No liquid. */
function copyInstall(): void {
  const btn = $<HTMLButtonElement>("#install-copy");
  const line = $("#install-line")?.textContent ?? "";
  btn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(line);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select and copy";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
}

tabs();
copyInstall();
boot().catch((err) => {
  console.warn("[site] the liquid could not start", err);
  stop();
});
