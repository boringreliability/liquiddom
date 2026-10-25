/**
 * W88 (D88-4, D88-5, D88-10, D88-12, D88-14): Canvas2D shadows. W88.1 stub: the shared interface
 * only; W88.3 fills it.
 */
import type { RenderFrame } from "./frame";

export const MASK_MAX_CELLS = 2048;
const S = Math.SQRT1_2;
export const DILATE_DIRS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1], [S, S], [S, -S], [-S, S], [-S, -S],
]);

export class ShadowCanvas2D {
  drawn(_id: number): boolean {
    return false;
  }

  draw(_ctx: CanvasRenderingContext2D, _frame: RenderFrame, _cellPx: number, _gridW: number, _gridH: number): void {}

  destroy(): void {}
}
