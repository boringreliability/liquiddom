/**
 * W89 (Epic 16): acceptance-scene helpers for e2e/ink.spec.ts (canvas2d) and the W89 block of
 * webgpu-robust.spec.ts (webgpu-hw). Manual frames; pixels from __liquidTest.pixels() (W71 rule).
 */
import type { Page } from "@playwright/test";

export const INK_HOLD_FRAMES = 90; // D79-4's merge hold
export const INK_LONG_HOLD_FRAMES = 300; // D89-6: the no-flicker hold
export const INK_REFORM_FRAMES = 180; // NORTH-STAR step 5: re-form within 3 s
export const INK_TEXT_MIN = 200; // a canvas text pixel: every channel and alpha ≥ this
export const INK_CARD_TEXT_PX_MIN = 40; // the card's text box holds far more while the canvas draws it
export const MERGE_INDEX = 2;
export const CARD_INDEX = 3;
const PARK = { x: 1279, y: 799 } as const; // far from every element: no hover swell

export async function inkAdvance(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__liquidTest!.advance(n), frames);
}

/** Frames until every restAlpha is 1 (−1 past `max`). */
export async function inkUntilRest(page: Page, max: number): Promise<number> {
  return page.evaluate((m) => {
    const t = window.__liquidTest!;
    for (let f = 1; f <= m; f++) {
      t.advance(1);
      if (t.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, max);
}

/** The acceptance scene on the manual clock, pointer parked, at rest. */
export async function inkOpen(page: Page, renderer: "canvas2d" | "webgpu"): Promise<void> {
  await page.goto(`/scenes/acceptance.html?seed=1&renderer=${renderer}&clock=manual&test=1`);
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(PARK.x, PARK.y);
  if ((await inkUntilRest(page, 120)) < 0) throw new Error("W89: the scene did not rest after 2 s");
  await inkAdvance(page, 2);
}

/** Presses Merge and moves it to the card's centre in 10 frames; the button stays down. */
export async function inkDragMergeIntoCard(page: Page): Promise<void> {
  const centre = async (sel: string): Promise<{ x: number; y: number }> => {
    const b = await page.locator(sel).boundingBox();
    if (!b) throw new Error(`W89: ${sel} has no box`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const [from, to] = [await centre("#merge"), await centre("#card")];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    await inkAdvance(page, 1);
  }
}

/** Releases, parks the pointer and waits for rest (frames, −1 past 3 s). */
export async function inkReleaseAndRest(page: Page): Promise<number> {
  await page.mouse.up();
  await page.mouse.move(PARK.x, PARK.y);
  return inkUntilRest(page, INK_REFORM_FRAMES);
}

export async function cardTextHidden(page: Page): Promise<boolean> {
  return page.locator("#card").evaluate((el) => el.classList.contains("liquid-text"));
}

export async function anyTextHidden(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector("[data-liquid].liquid-text") !== null);
}

/** Canvas text pixels inside the card's h2 and p rects: from the last advance()'s snapshot, or (`live`) from the Canvas2D canvas now. */
export async function cardTextPx(page: Page, live = false): Promise<number> {
  return page.evaluate(
    ([min, now]) => {
      const c = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!c) throw new Error("W89: no liquid canvas");
      const img = now ? c.getContext("2d")!.getImageData(0, 0, c.width, c.height) : window.__liquidTest!.pixels();
      const cr = c.getBoundingClientRect();
      const [sx, sy] = [img.width / cr.width, img.height / cr.height];
      let n = 0;
      for (const el of Array.from(document.querySelectorAll("#card h2, #card p"))) {
        const r = el.getBoundingClientRect();
        for (let py = Math.floor((r.top - cr.top) * sy); py < Math.ceil((r.bottom - cr.top) * sy); py++) {
          for (let px = Math.floor((r.left - cr.left) * sx); px < Math.ceil((r.right - cr.left) * sx); px++) {
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
            const o = (py * img.width + px) * 4;
            if (img.data[o + 3]! >= min && img.data[o]! >= min && img.data[o + 1]! >= min && img.data[o + 2]! >= min) n++;
          }
        }
      }
      return n;
    },
    [INK_TEXT_MIN, live] as const,
  );
}

/** FNV-1a (hex) of the last advance()'s canvas snapshot. */
export async function inkCanvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = window.__liquidTest!.pixels().data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 0x01000193) >>> 0;
    return h.toString(16);
  });
}

/** D89-3: Merge loses its text (its box keeps its size), then the scene rests again. */
export async function inkBlankMerge(page: Page): Promise<void> {
  await page.locator("#merge").evaluate((el) => {
    const r = el.getBoundingClientRect();
    Object.assign((el as HTMLElement).style, { width: `${r.width}px`, height: `${r.height}px` });
    el.textContent = "";
  });
  if ((await inkUntilRest(page, 120)) < 0) throw new Error("W89: the scene did not rest after Merge lost its text");
  await inkAdvance(page, 2);
}

/** Lengths of the runs of `true` that end before the last frame. */
export function closedRuns(frames: readonly boolean[]): number[] {
  const runs: number[] = [];
  let n = 0;
  for (const on of frames) {
    if (on) n += 1;
    else if (n > 0) runs.push(n), (n = 0);
  }
  return runs;
}

/** How often the value changes between consecutive frames. */
export function transitions(frames: readonly boolean[]): number {
  return frames.reduce((n, v, i) => (i > 0 && v !== frames[i - 1] ? n + 1 : n), 0);
}
