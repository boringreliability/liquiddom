/**
 * W89 (D89-6): Canvas2D's mixing report per slot. A slot turns on in the frame its cells at fade >
 * MIX_ENTER_FADE against another id reach MIX_ENTER_CELLS; it turns off after MIX_RELEASE_FRAMES
 * frames in a row under MIX_EXIT_CELLS cells at fade > MIX_EXIT_FADE, and at once when not eligible.
 * D89-11: the thresholds are tunable; the release stays 10 frames. W89.1 red: inert; W89.4 replaces it.
 */
export const MIX_ENTER_CELLS = 6;
export const MIX_ENTER_FADE = 0.3;
export const MIX_EXIT_CELLS = 1;
export const MIX_EXIT_FADE = 0.1;
export const MIX_RELEASE_FRAMES = 10;

export class MixReport {
  /** Advances slot `id` by one frame; returns whether it is on after it. */
  step(_id: number, _eligible: boolean, _enterCells: number, _exitCells: number): boolean {
    return false;
  }

  /** Whether slot `id` is on (false for a slot never stepped). */
  on(_id: number): boolean {
    return false;
  }

  /** Every slot off. */
  reset(): void {}
}
