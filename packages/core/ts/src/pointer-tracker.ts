/**
 * Pointer tracker for the soft pointer field (Ward 068, D68-4 / D68-7).
 *
 * Positions are kept in client px and converted to buffer space at sample time
 * (container offset). Velocity is estimated once per frame from the runtime
 * clock, never from event timestamps, so a manual clock gives deterministic input:
 *   v ← 0.5·v + 0.5·Δpos/Δt   when the pointer moved since the last moving sample
 *   v ← 0.8·v                 when it has not moved for more than 120 ms
 *   v unchanged               otherwise (held between sparse events)
 * Δt is floored at 1/240 s. Rust sanitises and clamps again (POINTER_VMAX_PX_S).
 */
export const POINTER_SMOOTHING = 0.5;
export const POINTER_IDLE_MS = 120;
export const POINTER_IDLE_DECAY = 0.8;
export const POINTER_MIN_DT_S = 1 / 240;

export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly active: boolean;
}

const INACTIVE: PointerSample = Object.freeze({ x: 0, y: 0, vx: 0, vy: 0, active: false });

export class PointerTracker {
  private inside = false;
  private moved = false;
  private hasSample = false;
  private cx = 0;
  private cy = 0;
  private sx = 0;
  private sy = 0;
  private sampleT = 0;
  private vx = 0;
  private vy = 0;

  /** Record the latest client position. Non-finite coordinates are ignored. */
  move(clientX: number, clientY: number): void {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    this.cx = clientX;
    this.cy = clientY;
    this.inside = true;
    this.moved = true;
  }

  /** The pointer left (or can no longer hover): field off, velocity reset. */
  leave(): void {
    this.inside = false;
    this.moved = false;
    this.hasSample = false;
    this.vx = 0;
    this.vy = 0;
  }

  /** Called once per frame with the runtime clock's time and the buffer-space offset. */
  sample(nowMs: number, offset: { readonly x: number; readonly y: number }): PointerSample {
    if (!this.inside) return INACTIVE;
    const now = Number.isFinite(nowMs) ? nowMs : this.sampleT;
    if (this.moved) {
      this.moved = false;
      if (this.hasSample) {
        const dtS = Math.max((now - this.sampleT) / 1000, POINTER_MIN_DT_S);
        const ix = (this.cx - this.sx) / dtS;
        const iy = (this.cy - this.sy) / dtS;
        this.vx = POINTER_SMOOTHING * this.vx + (1 - POINTER_SMOOTHING) * ix;
        this.vy = POINTER_SMOOTHING * this.vy + (1 - POINTER_SMOOTHING) * iy;
      }
      this.sx = this.cx;
      this.sy = this.cy;
      this.sampleT = now;
      this.hasSample = true;
    } else if (now - this.sampleT > POINTER_IDLE_MS) {
      this.vx *= POINTER_IDLE_DECAY;
      this.vy *= POINTER_IDLE_DECAY;
    }
    return { x: this.cx - offset.x, y: this.cy - offset.y, vx: this.vx, vy: this.vy, active: true };
  }

  /** Wire document/window input (spec §3.5, D68-7). Returns the detach function. */
  attach(doc: Document, win: Window): () => void {
    const onMove = (e: PointerEvent): void => this.move(e.clientX, e.clientY);
    const onLeave = (): void => this.leave();
    // D68-7 (ruling 2026-10-06): relatedTarget null = the pointer left the window.
    // A pointerout to another element bubbles here too and must not switch the field off.
    const onOut = (e: PointerEvent): void => {
      if (e.relatedTarget === null) this.leave();
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerType === "touch") this.leave();
    };
    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerout", onOut);
    doc.addEventListener("pointercancel", onLeave);
    doc.addEventListener("pointerup", onUp);
    win.addEventListener("blur", onLeave);
    return () => {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerout", onOut);
      doc.removeEventListener("pointercancel", onLeave);
      doc.removeEventListener("pointerup", onUp);
      win.removeEventListener("blur", onLeave);
    };
  }
}
