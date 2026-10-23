import type { LiquidDOMInstance } from "liquiddom";
export type ObserverCtor = typeof IntersectionObserver;
export function pauseOffscreen(_i: Pick<LiquidDOMInstance, "pause" | "resume">, _el: Element, _Ctor?: ObserverCtor): () => void {
  return () => {};
}
