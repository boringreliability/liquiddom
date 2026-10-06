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

interface MutableSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
}

export class PointerTracker {
  /**
   * W68 perf: `sample()` fills and returns this one object every frame (no per-frame
   * allocation). Callers read it within the frame and never keep it: the next
   * `sample()` overwrites it.
   */
  private readonly out: MutableSample = { x: 0, y: 0, vx: 0, vy: 0, active: false };
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

  /**
   * Called once per frame with the runtime clock's time and the buffer-space offset.
   * Returns the tracker's reused sample object: valid until the next `sample()` call.
   */
  sample(nowMs: number, offset: { readonly x: number; readonly y: number }): PointerSample {
    const out = this.out;
    if (!this.inside) {
      out.x = 0;
      out.y = 0;
      out.vx = 0;
      out.vy = 0;
      out.active = false;
      return out;
    }
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
      // Known limitation (D68-4 notes): the ×0.8 is applied per sampled frame, not per unit
      // of time, so the idle tail is display-rate dependent: at 120 Hz it decays twice as
      // fast in wall time as at 60 Hz. The 120 ms hold before it is time-based.
      this.vx *= POINTER_IDLE_DECAY;
      this.vy *= POINTER_IDLE_DECAY;
    }
    out.x = this.cx - offset.x;
    out.y = this.cy - offset.y;
    out.vx = this.vx;
    out.vy = this.vy;
    out.active = true;
    return out;
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
