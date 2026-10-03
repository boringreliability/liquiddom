/**
 * The acceptance scene (spec §6; `.wdd/NORTH-STAR.md` is canonical).
 * W64: liquid at rest through the internal runtime (decision D64-8).
 * W65 adds the ?seed / ?clock / ?test hooks, W66 switches to the public
 * LiquidDOM.create() and drops the interim `.scene-liquid` CSS (D64-9).
 */
import { createFluidRuntime } from "../../packages/core/ts/src/runtime";

const SCENE_SEED = 1;

async function main(): Promise<void> {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));
  const runtime = await createFluidRuntime({
    particles: 8000,
    maxElements: 32,
    seed: SCENE_SEED,
    initialElements: elements,
  });
  for (const el of elements) {
    runtime.observe(el); // snapshots background + text colour first…
    el.classList.add("scene-liquid"); // …then the DOM background goes transparent (D64-9)
  }
  if (new URLSearchParams(location.search).has("debug")) {
    (window as unknown as { __liquidRuntime: unknown }).__liquidRuntime = runtime;
  }
}

main().catch((err: unknown) => {
  document.documentElement.dataset.liquidError = err instanceof Error ? err.message : String(err);
  console.error(err);
});
