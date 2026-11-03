/**
 * W89 (D89-6): Canvas2D's mixing report per slot. A slot turns on in the frame its cells at fade >
 * MIX_ENTER_FADE against another id reach MIX_ENTER_CELLS; it turns off after MIX_RELEASE_FRAMES
 * frames in a row under MIX_EXIT_CELLS cells at fade > MIX_EXIT_FADE, and at once when not eligible.
 * D89-11: the thresholds are tunable; the release stays 10 frames.
 */
export const MIX_ENTER_CELLS = 6;
export const MIX_ENTER_FADE = 0.3;
export const MIX_EXIT_CELLS = 1;
export const MIX_EXIT_FADE = 0.1;
export const MIX_RELEASE_FRAMES = 10;

export class MixReport {
  private onFlags = new Uint8Array(0);
  private quiet = new Uint8Array(0);

  private grow(id: number): void {
    if (id < this.onFlags.length) return;
    const n = Math.max(id + 1, this.onFlags.length * 2, 16);
    const on = new Uint8Array(n);
    const quiet = new Uint8Array(n);
    on.set(this.onFlags);
    quiet.set(this.quiet);
    this.onFlags = on;
    this.quiet = quiet;
  }

  /** Advances slot `id` by one frame; returns whether it is on after it. */
  step(id: number, eligible: boolean, enterCells: number, exitCells: number): boolean {
    this.grow(id);
    if (!eligible) {
      this.onFlags[id] = 0;
      this.quiet[id] = 0;
    } else if (!this.onFlags[id]) {
      if (enterCells >= MIX_ENTER_CELLS) {
        this.onFlags[id] = 1;
        this.quiet[id] = 0;
      }
    } else if (exitCells >= MIX_EXIT_CELLS) {
      this.quiet[id] = 0;
    } else if (++this.quiet[id]! >= MIX_RELEASE_FRAMES) {
      this.onFlags[id] = 0;
      this.quiet[id] = 0;
    }
    return this.onFlags[id] === 1;
  }

  /** Whether slot `id` is on (false for a slot never stepped). */
  on(id: number): boolean {
    return this.onFlags[id] === 1;
  }

  /** Every slot off. */
  reset(): void {
    this.onFlags.fill(0);
    this.quiet.fill(0);
  }
}
