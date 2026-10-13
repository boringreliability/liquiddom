/**
 * W80 (D80-1 … D80-4): step 7 helpers. A scroll runs on the manual clock, one frame per position:
 * the page (or the container) is scrolled with `behavior: "instant"`, one frame runs, and the frame's
 * canvas snapshot (`pixels()`, W71 rule) is read against the DOM rects of that same moment.
 *
 * "Follows with no snap" is measured as the fill of each element's visible DOM shape (its rounded
 * rect inset by FILL_INSET_PX, clipped to the canvas) by its own colour or by liquid text (near
 * white): a liquid left behind by a scroll, or one that jumps after it, empties the shape. The
 * canvas is mapped through its own client rect, so a container canvas that is not on the
 * container's visible window (W80's transform) fails the fill as well.
 */
import type { Page } from "@playwright/test";

/** The acceptance scene's element colours (demo/scenes/acceptance.html). */
export const W80_COLOURS: Readonly<Record<string, readonly [number, number, number]>> = {
  "#splash": [0x2f, 0x6f, 0xde],
  "#split": [0xca, 0x4b, 0x20],
  "#merge": [0x1a, 0x83, 0x61],
  "#card": [0x26, 0x32, 0x38],
};
/** px inside the DOM shape that must be filled (the density edge is soft over a few px). */
export const FILL_INSET_PX = 4;
/** An element is judged only while at least this many px of its inset shape are visible. */
export const FILL_MIN_VISIBLE_PX = 8;
/**
 * D80-3 (gate 2026-10-13): the lowest fill a frame may show, min(0.9, W80.0's lowest browser fill of
 * the chosen inertia 0.02 / 30 − 0.05) = min(0.9, 0.908 − 0.05) → 0.85 (WebGPU, 10 px per frame).
 */
export const FILL_MIN = 0.85;

export interface FillFrame {
  /** The scroll position this frame ran at (px), read after the scroll. */
  scroll: number;
  /** The lowest fill over the judged elements (1 when none was visible). */
  min: number;
  /** Selector of that element ("" when none was judged). */
  worst: string;
}

export interface FillSpec {
  /** "__liquidTest" (acceptance scene) or "__scrollContainer" (W80 container scene). */
  hook: "__liquidTest" | "__scrollContainer";
  /** CSS selector of the liquid canvas whose client rect maps the snapshot. */
  canvas: string;
  /** null: the window scrolls; else the selector of the scrolled container. */
  scroller: string | null;
  colours: Readonly<Record<string, readonly [number, number, number]>>;
}

export const ACCEPTANCE_FILL: FillSpec = { hook: "__liquidTest", canvas: "canvas.liquid-canvas", scroller: null, colours: W80_COLOURS };

/**
 * Runs one frame per entry of `path` (inside the page, in one task per frame; `null` runs the frame
 * without scrolling, e.g. while a smooth scroll animates) and returns each frame's lowest fill. The fill of one element: pixels of its rounded DOM rect inset by
 * FILL_INSET_PX with alpha > 128 and either |rgb − colour|₁ < 60 or every channel ≥ 200 (liquid
 * text), over all pixels of that inset shape inside the canvas.
 */
export async function scrollPathFills(page: Page, spec: FillSpec, path: readonly (number | null)[]): Promise<FillFrame[]> {
  return page.evaluate(
    ([s, positions, inset, minVisible]) => {
      type Hook = { advance(n: number): void; pixels(): ImageData };
      const hook = (window as unknown as Record<string, Hook>)[s.hook];
      const scroller = s.scroller === null ? null : document.querySelector<HTMLElement>(s.scroller);
      const out: Array<{ scroll: number; min: number; worst: string }> = [];
      for (const y of positions) {
        if (y !== null && scroller) scroller.scrollTo({ top: y, behavior: "instant" });
        else if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
        hook.advance(1);
        const at = scroller ? scroller.scrollTop : window.scrollY;
        const img = hook.pixels();
        const canvas = document.querySelector<HTMLCanvasElement>(s.canvas)!;
        const cr = canvas.getBoundingClientRect();
        const kx = img.width / cr.width;
        const ky = img.height / cr.height;
        let min = 1;
        let worst = "";
        for (const [sel, [cr0, cg0, cb0]] of Object.entries(s.colours)) {
          const el = document.querySelector<HTMLElement>(sel)!;
          const r = el.getBoundingClientRect();
          const rad = Math.max(0, parseFloat(getComputedStyle(el).borderTopLeftRadius) - inset);
          const x0 = r.left + inset;
          const y0 = r.top + inset;
          const x1 = r.right - inset;
          const y1 = r.bottom - inset;
          const vx0 = Math.max(x0, cr.left);
          const vy0 = Math.max(y0, cr.top);
          const vx1 = Math.min(x1, cr.right);
          const vy1 = Math.min(y1, cr.bottom);
          if (vx1 - vx0 < minVisible || vy1 - vy0 < minVisible) continue;
          let inside = 0;
          let filled = 0;
          for (let py = Math.ceil(vy0); py < vy1; py++) {
            for (let px = Math.ceil(vx0); px < vx1; px++) {
              // Inside the rounded rect inset by `inset` (corner radius shrinks with it).
              const cx = Math.min(Math.max(px + 0.5, x0 + rad), x1 - rad);
              const cy = Math.min(Math.max(py + 0.5, y0 + rad), y1 - rad);
              if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 > rad * rad) continue;
              inside++;
              const ix = Math.floor((px - cr.left) * kx);
              const iy = Math.floor((py - cr.top) * ky);
              const o = (iy * img.width + ix) * 4;
              const d = img.data;
              if (d[o + 3] <= 128) continue;
              const colour = Math.abs(d[o] - cr0) + Math.abs(d[o + 1] - cg0) + Math.abs(d[o + 2] - cb0) < 60;
              const text = d[o] >= 200 && d[o + 1] >= 200 && d[o + 2] >= 200;
              if (colour || text) filled++;
            }
          }
          const fill = inside > 0 ? filled / inside : 1;
          if (fill < min) {
            min = fill;
            worst = sel;
          }
        }
        out.push({ scroll: at, min, worst });
      }
      return out;
    },
    [spec, path, FILL_INSET_PX, FILL_MIN_VISIBLE_PX] as const,
  );
}

/** Step 7's scroll positions at `step` px per frame: down to `distance`, then back to 0. */
export function scrollPath(distance: number, step: number): number[] {
  const n = Math.round(distance / step);
  const down = Array.from({ length: n }, (_, k) => (k + 1) * step);
  const back = Array.from({ length: n }, (_, k) => (n - 1 - k) * step);
  return [...down, ...back];
}

/** The frame with the lowest fill of a run. */
export function worstFrame(frames: readonly FillFrame[]): FillFrame {
  return frames.reduce((w, f) => (f.min < w.min ? f : w), { scroll: Number.NaN, min: 1, worst: "" });
}
