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

// =============================================================================
// W77 (D77-1, D77-2): the same metric on a region of a wider page, and the neighbour-speck count.
// =============================================================================

/** The landing page's dark colour (`--dark: #111827`, demo/scenes/landing.html): `.card--dark` and `.btn--dark`. */
export const LANDING_DARK_RGB: readonly [number, number, number] = [0x11, 0x18, 0x27];
/**
 * W77.0: the region is the element's client rect grown by 40 px on every side (the spike's `H.tears`
 * used 80 px; on the landing page 80 px reaches the corner of "Book a demo", the same #111827,
 * 48 px from the dark card).
 */
export const LACE_REGION_MARGIN_PX = 40;
/** W77 spike (`H.inside`): the speck window is the rect inset by 6 px, minus a h/2 band at each end (the rounded caps). */
export const SPECK_INSET_PX = 6;

/**
 * W77 guard bounds (W77.0, seed 1, manual clock, 1280×800; ward-077.md ## Specification).
 * Acceptance card (`cardTearPixels`) at f10 and f20 after `shake()`: today canvas2d 1175 / 831,
 * webgpu 972 / 573; the W77 spike's combined levers 99 / 176 (canvas2d).
 */
export const W77_CARD_LACE_MAX_TEAR = 300;
/**
 * Landing dark card (`regionTearPixels`, #card-ops, LANDING_DARK_RGB, margin 40) at f10 and f20
 * after `shake()`: today canvas2d 5232 / 1805, webgpu 3938 / 1316; the spike's combined levers
 * 8 / 40 (canvas2d, margin 80). 400 leaves room for D77-1's coarser Canvas2D grid on this page
 * (3.5 px cells for the pills' R 13.04 px, not in the spike) and is 7.6 % / 22 % of today's.
 */
export const W77_LANDING_LACE_MAX_TEAR = 400;
/** Frames after the shake at which the landing lace is read (the acceptance guard's frames). */
export const W77_LACE_FRAMES: readonly [number, number] = [10, 20];
/**
 * "Book a demo" specks (`specksInside`) after a splash on "Start free", peak over frames 1–60:
 * today canvas2d 307 (Σ 11,542, last speck at f46), webgpu 238 (Σ 8,947, f46); the spike with
 * cap 16 measured 0. 16 px allows a stray antialiased pixel row, not a visible speck.
 */
export const W77_SPECK_MAX_PX = 16;
/** Frames after the splash over which the specks are counted (the last speck today is f46). */
export const W77_SPECK_FRAMES = 60;

export interface ClientRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The client rect of `selector` (throws when it is missing). */
export async function clientRectOf(page: Page, selector: string): Promise<ClientRect> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`lace: ${sel} missing`);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

/**
 * W77 (D77-2): `cardTearPixels` restricted to a region: pixels of colour `rgb` (alpha > 128,
 * |rgb − colour|₁ < 60) inside `rect` grown by `margin` (client px, mapped onto the canvas by its
 * CSS rect) form the mask; tears = closing(mask, disk r) ∧ ¬opaque, counted inside the region.
 * Mask pixels outside the region count as not-colour, with the same r + 1 padding as the card
 * metric, so another element of the same colour outside the region never closes a gap in it.
 */
export async function regionTearPixels(
  page: Page,
  rgb: readonly [number, number, number] | null,
  rect: ClientRect,
  margin: number = LACE_REGION_MARGIN_PX,
  r: number = LACE_CLOSING_RADIUS_PX,
): Promise<number> {
  return page.evaluate(
    ([colour, box, m, rad]) => {
      const img = window.__liquidTest!.pixels();
      const { width: W, height: H, data } = img;
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!canvas) throw new Error("lace: canvas.liquid-canvas missing");
      const c = canvas.getBoundingClientRect();
      const sx = W / c.width;
      const sy = H / c.height;
      const X0 = Math.max(0, Math.floor((box.x - m - c.x) * sx));
      const Y0 = Math.max(0, Math.floor((box.y - m - c.y) * sy));
      const X1 = Math.min(W - 1, Math.ceil((box.x + box.width + m - c.x) * sx));
      const Y1 = Math.min(H - 1, Math.ceil((box.y + box.height + m - c.y) * sy));
      if (X1 < X0 || Y1 < Y0) return 0;
      const isC = (x: number, y: number): boolean => {
        const o = (y * W + x) * 4;
        if (data[o + 3] <= 128) return false;
        if (colour === null) return true; // W79: any opaque liquid (regionHolePixels)
        return Math.abs(data[o] - colour[0]) + Math.abs(data[o + 1] - colour[1]) + Math.abs(data[o + 2] - colour[2]) < 60;
      };
      const bx = X0 - rad - 1;
      const by = Y0 - rad - 1;
      const bw = X1 - X0 + 1 + 2 * (rad + 1);
      const bh = Y1 - Y0 + 1 + 2 * (rad + 1);
      const mk = new Uint8Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        const y = by + j;
        if (y < Y0 || y > Y1) continue;
        for (let i = 0; i < bw; i++) {
          const x = bx + i;
          if (x >= X0 && x <= X1 && isC(x, y)) mk[j * bw + i] = 1;
        }
      }
      const offs: Array<[number, number]> = [];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) offs.push([dx, dy]);
      const dil = new Uint8Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) {
          for (const [dx, dy] of offs) {
            const ii = i + dx, jj = j + dy;
            if (ii >= 0 && ii < bw && jj >= 0 && jj < bh && mk[jj * bw + ii]) {
              dil[j * bw + i] = 1;
              break;
            }
          }
        }
      }
      let tears = 0;
      for (let j = 0; j < bh; j++) {
        const y = by + j;
        if (y < Y0 || y > Y1) continue;
        for (let i = 0; i < bw; i++) {
          const x = bx + i;
          if (x < X0 || x > X1) continue;
          let all = true;
          for (const [dx, dy] of offs) {
            const ii = i + dx, jj = j + dy;
            if (ii < 0 || ii >= bw || jj < 0 || jj >= bh || !dil[jj * bw + ii]) {
              all = false;
              break;
            }
          }
          if (all && data[(y * W + x) * 4 + 3] <= 128) tears++;
        }
      }
      return tears;
    },
    [rgb, rect, margin, r] as const,
  );
}

/**
 * W77 (D77-1): neighbour specks. Non-opaque canvas pixels (alpha ≤ 128) inside `rect` inset by
 * `inset` px, between x + h/2 and x + w − h/2 (the straight part of a pill: the rounded caps
 * never count). While the element is at rest or merely nudged its liquid covers this window, so
 * every such pixel is the page showing through a speck.
 */
export async function specksInside(page: Page, rect: ClientRect, inset: number = SPECK_INSET_PX): Promise<number> {
  return page.evaluate(
    ([box, ins]) => {
      const img = window.__liquidTest!.pixels();
      const { width: W, height: H, data } = img;
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!canvas) throw new Error("lace: canvas.liquid-canvas missing");
      const c = canvas.getBoundingClientRect();
      const sx = W / c.width;
      const sy = H / c.height;
      const y0 = Math.max(0, Math.ceil((box.y + ins - c.y) * sy));
      const y1 = Math.min(H, Math.floor((box.y + box.height - ins - c.y) * sy));
      const x0 = Math.max(0, Math.ceil((box.x + box.height / 2 - c.x) * sx));
      const x1 = Math.min(W, Math.floor((box.x + box.width - box.height / 2 - c.x) * sx));
      let holes = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * W + x) * 4 + 3] <= 128) holes++;
      return holes;
    },
    [rect, inset] as const,
  );
}

// =============================================================================
// W79 (step 5): one closed region where "Merge" is dragged into the card.
// =============================================================================

/** W79: the region is the card's client rect grown by this many px ("Merge"'s dragged home lies inside it). */
export const MERGE_REGION_MARGIN_PX = 16;

/**
 * W79: `regionTearPixels` with every opaque pixel as the mask, whatever its colour: non-opaque
 * canvas pixels inside `rect` grown by `margin` that closing(opaque, disk r) fills, i.e. gaps at
 * most 2r wide between or inside liquids. A drag that only presses "Merge" against the card leaves
 * a seam between the two liquids; a displacement merge leaves none.
 */
export async function regionHolePixels(
  page: Page,
  rect: ClientRect,
  margin: number = MERGE_REGION_MARGIN_PX,
  r: number = LACE_CLOSING_RADIUS_PX,
): Promise<number> {
  return regionTearPixels(page, null, rect, margin, r);
}
