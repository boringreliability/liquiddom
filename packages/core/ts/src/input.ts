/**
 * Click and keyboard splash input (W67, spec §2 "Interaction", §4 "Keyboard").
 *
 * - A pointer click (`event.detail ≥ 1`) splashes at the pointer.
 * - Keyboard activation (Enter/Space on a focusable element; `event.detail === 0`)
 *   splashes at the rect centre.
 * - Native activation is never prevented and propagation is never stopped.
 * - One splash per click event: the innermost observed element wins (D67-9).
 *
 * W68 extends this module with the pointer tracker, hover/focus listeners and the
 * reduced-motion input gating (D68-5).
 */

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

/** `at` is client px, or null for "the rect centre". */
export type SplashHandler = (el: HTMLElement, at: ClientPoint | null) => void;

export function rectCentre(el: HTMLElement): ClientPoint {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export class SplashInput {
  private readonly onSplash: SplashHandler;
  private readonly listeners = new Map<HTMLElement, (ev: MouseEvent) => void>();
  private readonly handled = new WeakSet<Event>();

  constructor(onSplash: SplashHandler) {
    this.onSplash = onSplash;
  }

  /** Idempotent. */
  attach(el: HTMLElement): void {
    if (this.listeners.has(el)) return;
    const listener = (ev: MouseEvent): void => {
      if (this.handled.has(ev)) return; // an inner observed element already splashed
      this.handled.add(ev);
      const at = ev.detail === 0 ? null : { x: ev.clientX, y: ev.clientY };
      this.onSplash(el, at);
    };
    this.listeners.set(el, listener);
    el.addEventListener("click", listener);
  }

  detach(el: HTMLElement): void {
    const listener = this.listeners.get(el);
    if (!listener) return;
    el.removeEventListener("click", listener);
    this.listeners.delete(el);
  }

  destroy(): void {
    for (const [el, listener] of this.listeners) el.removeEventListener("click", listener);
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
