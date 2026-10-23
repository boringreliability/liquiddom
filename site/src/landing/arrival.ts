import type { LiquidDOMInstance } from "liquiddom";
import { ARRIVAL_STRENGTH, HINT_DELAY_MS, HINT_STRENGTH } from "./config";

export interface ArrivalOptions { reducedMotion: boolean; target?: Window }
const CANCEL_ON = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/** D86-4: splash every hero element at once; one hint shake after HINT_DELAY_MS without interaction. Returns cancel. */
export function startArrival(
  inst: Pick<LiquidDOMInstance, "splash" | "shake">,
  hero: readonly HTMLElement[],
  { reducedMotion, target = window }: ArrivalOptions,
): () => void {
  if (reducedMotion) return () => {};
  for (const el of hero) inst.splash(el, { strength: ARRIVAL_STRENGTH });
  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    target.clearTimeout(timer);
    for (const t of CANCEL_ON) target.removeEventListener(t, cancel, true);
  };
  const timer = target.setTimeout(() => {
    cancel();
    inst.shake(HINT_STRENGTH);
  }, HINT_DELAY_MS);
  for (const t of CANCEL_ON) target.addEventListener(t, cancel, { capture: true, passive: true });
  return cancel;
}
