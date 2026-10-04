/**
 * W66 (D66-12): drives runtime.frame through a FrameClock. User pause and
 * hidden-tab pause are independent; the loop runs only when neither holds.
 */
import type { FrameClock } from "./clock";

export class LoopController {
  private handle: number | null = null;
  private userPaused = false;
  private hidden: boolean;
  private started = false;
  private destroyed = false;
  private readonly onVisibility = (): void => {
    this.hidden = this.doc.visibilityState === "hidden";
    this.reconcile();
  };
  private readonly step = (tMs: number): void => {
    this.handle = null;
    if (this.destroyed || this.isPaused) return;
    this.onFrame(tMs);
    this.reconcile();
  };

  constructor(
    private readonly clock: FrameClock,
    private readonly onFrame: (tMs: number) => void,
    private readonly doc: Document = document,
  ) {
    this.hidden = doc.visibilityState === "hidden";
    doc.addEventListener("visibilitychange", this.onVisibility);
  }

  get isPaused(): boolean {
    return this.userPaused || this.hidden;
  }

  start(): void {
    this.started = true;
    this.reconcile();
  }

  pause(): void {
    this.userPaused = true;
    this.reconcile();
  }

  resume(): void {
    this.userPaused = false;
    this.reconcile();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.handle !== null) this.clock.cancel(this.handle);
    this.handle = null;
    this.doc.removeEventListener("visibilitychange", this.onVisibility);
  }

  private reconcile(): void {
    if (this.destroyed || !this.started) return;
    if (this.isPaused) {
      if (this.handle !== null) {
        this.clock.cancel(this.handle);
        this.handle = null;
      }
    } else if (this.handle === null) {
      this.handle = this.clock.request(this.step);
    }
  }
}
