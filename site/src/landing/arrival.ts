import type { LiquidDOMInstance } from "liquiddom";
export interface ArrivalOptions { reducedMotion: boolean; target?: Window }
export function startArrival(_i: Pick<LiquidDOMInstance, "splash" | "shake">, _hero: readonly HTMLElement[], _o: ArrivalOptions): () => void {
  return () => {};
}
