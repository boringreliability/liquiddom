/**
 * Ward 069: fluid splash scene (replaces the soft-body splash-buttons scene, spec §5).
 * Three focusable drops with per-element ElementOptions (D69-3), a pointer-only
 * pool card, and non-liquid controls for strength / Splash all / Shake.
 * Each drop's options live in its `data-viscosity` / `data-recovery` attributes.
 * Params: ?seed=<u32>&renderer=auto|canvas2d|webgpu&test=1
 */
import { LiquidDOM, type ElementOptions, type LiquidDOMInstance, type LiquidOptions } from "liquiddom";
import { installPendingSceneTestHook, type SceneBinding } from "./_test-hook";

interface SceneParams {
  seed: number | undefined;
  renderer: "auto" | "canvas2d" | "webgpu";
  test: boolean;
}

function readParams(): SceneParams {
  const p = new URLSearchParams(window.location.search);
  const rawSeed = p.get("seed");
  const seedNum = rawSeed !== null && /^\d+$/.test(rawSeed) ? Number(rawSeed) : Number.NaN;
  const seed = Number.isSafeInteger(seedNum) && seedNum <= 0xffff_ffff ? seedNum : undefined;
  const r = p.get("renderer");
  const renderer = r === "canvas2d" || r === "webgpu" || r === "auto" ? r : "auto";
  return { seed, renderer, test: p.get("test") === "1" };
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`[splash] ${selector} not found`);
  return el;
}

function dropOptions(el: HTMLElement): ElementOptions {
  const viscosity = Number(el.dataset.viscosity);
  const recovery = Number(el.dataset.recovery);
  if (!Number.isFinite(viscosity) || !Number.isFinite(recovery)) {
    throw new Error(`[splash] data-drop "${el.dataset.drop ?? ""}" needs numeric data-viscosity and data-recovery`);
  }
  return { viscosity, recovery };
}

async function build(params: SceneParams): Promise<SceneBinding> {
  const options: LiquidOptions = { autoObserve: false, renderer: params.renderer };
  if (params.seed !== undefined) options.seed = params.seed;
  const liquid: LiquidDOMInstance = await LiquidDOM.create(options);

  const observed: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-drop]")) {
    liquid.observe(el, dropOptions(el));
    observed.push(el);
  }
  const pool = requireElement<HTMLElement>("#pool");
  liquid.observe(pool);
  observed.push(pool);

  const strength = requireElement<HTMLInputElement>("#strength");
  const strengthOut = requireElement<HTMLOutputElement>("#strength-out");
  const currentStrength = (): number => Math.min(2, Math.max(0, Number(strength.value)));
  strength.addEventListener("input", () => {
    strengthOut.textContent = currentStrength().toFixed(1);
  });

  // Controls are not observed, so their own clicks never splash (W67 click
  // wiring only listens on observed elements).
  requireElement<HTMLButtonElement>("#splash-all").addEventListener("click", () => {
    const s = currentStrength();
    for (const el of observed) liquid.splash(el, { strength: s });
  });
  requireElement<HTMLButtonElement>("#shake").addEventListener("click", () => {
    liquid.shake(currentStrength());
  });

  (window as unknown as { liquid: LiquidDOMInstance }).liquid = liquid;
  return { instance: liquid, elements: observed };
}

const params = readParams();
const started = build(params);
// The hook exists synchronously; it binds once the instance is created.
if (params.test) installPendingSceneTestHook(started, "splash").ready.catch(() => {});
started.catch((err: unknown) => {
  console.error("[splash] bootstrap failed:", err);
});
