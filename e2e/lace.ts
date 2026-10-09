/**
 * W73 (D73-3): card "lace" metric — tear pixels inside the card's liquid.
 *
 * Port of the W73 investigation's `analyze.tears` (closing radius 4):
 *   card  = canvas pixels with alpha > 128 and |rgb − #263238|₁ < 60
 *   tears = binary_closing(card, disk r = 4) ∧ ¬(alpha > 128)
 * i.e. background (non-opaque) pixels inside gaps ≤ 2r wide that the card's own liquid
 * encloses; liquid of another colour is not a tear. scipy pads the mask by r + 1 before the
 * closing (border value 0), so the closing never sees the canvas edge; the port crops to the
 * card's bounding box grown by r + 1 (the closing is empty outside it), with the same border.
 * Reads the frame of the last advance() through __liquidTest.pixels() (W71 rule).
 */
import type { Page } from "@playwright/test";

/** The card's background colour in demo/scenes/acceptance.html (`.card { background: #263238 }`). */
export const LACE_CARD_RGB: readonly [number, number, number] = [0x26, 0x32, 0x38];
/** Closing radius of the investigation's metric (`analyze.tears`, r = 4). */
export const LACE_CLOSING_RADIUS_PX = 4;

export async function cardTearPixels(page: Page): Promise<number> {
  return page.evaluate(
    ([[cr, cg, cb], r]) => {
      const img = window.__liquidTest!.pixels();
      const { width: W, height: H, data } = img;
      const opaque = (x: number, y: number): boolean => data[(y * W + x) * 4 + 3] > 128;
      const isCard = (x: number, y: number): boolean => {
        const o = (y * W + x) * 4;
        if (data[o + 3] <= 128) return false;
        return Math.abs(data[o] - cr) + Math.abs(data[o + 1] - cg) + Math.abs(data[o + 2] - cb) < 60;
      };
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isCard(x, y)) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) throw new Error("lace: no card-coloured liquid on the canvas");
      // Working box: the card bbox grown by r + 1 (may extend past the canvas; outside = not card).
      const bx = x0 - r - 1, by = y0 - r - 1;
      const bw = x1 - x0 + 1 + 2 * (r + 1), bh = y1 - y0 + 1 + 2 * (r + 1);
      const m = new Uint8Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        const y = by + j;
        if (y < 0 || y >= H) continue;
        for (let i = 0; i < bw; i++) {
          const x = bx + i;
          if (x >= 0 && x < W && isCard(x, y)) m[j * bw + i] = 1;
        }
      }
      // Disk structuring element: dx² + dy² ≤ r² (symmetric, so dilation needs no reflection).
      const offs: Array<[number, number]> = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
      const dil = new Uint8Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) {
          for (const [dx, dy] of offs) {
            const ii = i + dx, jj = j + dy;
            if (ii >= 0 && ii < bw && jj >= 0 && jj < bh && m[jj * bw + ii]) {
              dil[j * bw + i] = 1;
              break;
            }
          }
        }
      }
      let tears = 0;
      for (let j = 0; j < bh; j++) {
        const y = by + j;
        if (y < 0 || y >= H) continue;
        for (let i = 0; i < bw; i++) {
          const x = bx + i;
          if (x < 0 || x >= W) continue;
          // Erosion with border value 0 outside the box.
          let all = true;
          for (const [dx, dy] of offs) {
            const ii = i + dx, jj = j + dy;
            if (ii < 0 || ii >= bw || jj < 0 || jj >= bh || !dil[jj * bw + ii]) {
              all = false;
              break;
            }
          }
          if (!all) continue;
          // Only canvas pixels count (scipy crops the padding off again).
          if (x >= 0 && x < W && y >= 0 && y < H && !opaque(x, y)) tears++;
        }
      }
      return tears;
    },
    [LACE_CARD_RGB, LACE_CLOSING_RADIUS_PX] as const,
  );
}
