import type { LiquidDOMInstance } from "liquiddom";

export type ObserverCtor = typeof IntersectionObserver;

/** D86-3: a container instance runs only while its pool is in the viewport. Returns a disconnect. */
export function pauseOffscreen(
  inst: Pick<LiquidDOMInstance, "pause" | "resume">,
  el: Element,
  Ctor: ObserverCtor = IntersectionObserver,
): () => void {
  const io = new Ctor((entries) => {
    const visible = entries[entries.length - 1]?.isIntersecting ?? false;
    if (visible) inst.resume();
    else inst.pause();
  });
  io.observe(el);
  return () => io.disconnect();
}
