import type { Page } from "@playwright/test";

export interface SceneQuery {
  seed?: number;
  clock?: "raf" | "manual";
  rm?: boolean;
  perf?: boolean;
}

/** D65-2: pixel baselines exist for Linux (pinned image) only. */
export const VISUAL_ENABLED = process.platform === "linux";
export const VISUAL_SKIP_REASON =
  "Linux-only baselines (D65-2): run `npm run e2e:docker -- --project=canvas2d` or the e2e-update-baselines CI job";
/** Scene step 1: 2 s idle at the fixed 60 Hz manual clock. */
export const IDLE_2S_FRAMES = 120;

export function sceneUrl(q: SceneQuery = {}): string {
  const p = new URLSearchParams({ test: "1", seed: String(q.seed ?? 1) });
  if (q.clock === "manual") p.set("clock", "manual");
  if (q.rm) p.set("rm", "1");
  if (q.perf) p.set("perf", "1");
  return `/scenes/acceptance.html?${p.toString()}`;
}

export async function gotoScene(page: Page, q: SceneQuery = {}): Promise<void> {
  await page.goto(sceneUrl(q));
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function advance(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__liquidTest!.advance(n), frames);
}

export async function restAlpha(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__liquidTest!.restAlpha());
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface MoveResult {
  oldRect: { x: number; y: number; width: number; height: number };
  newRect: { x: number; y: number; width: number; height: number };
}

/**
 * Perturbation for the reduced-motion specs (W65 has no pointer field or splash yet):
 * move #card by 80 px so a motion-free implementation must show it at the new rect at once.
 */
export async function moveCard(page: Page, dy = 80): Promise<MoveResult> {
  return page.evaluate((delta) => {
    const card = document.querySelector<HTMLElement>("#card")!;
    const r0 = card.getBoundingClientRect();
    card.style.transform = `translateY(${delta}px)`;
    const r1 = card.getBoundingClientRect();
    const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    return { oldRect: box(r0), newRect: box(r1) };
  }, dy);
}

/** Canvas pixel at a viewport (client) coordinate; the canvas is mapped by its CSS rect. */
export async function canvasPixelAt(page: Page, clientX: number, clientY: number): Promise<Rgba> {
  return page.evaluate(
    ([cx, cy]) => {
      const canvas = document.querySelector("canvas")!;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((cx - rect.left) * canvas.width) / rect.width);
      const y = Math.floor(((cy - rect.top) * canvas.height) / rect.height);
      const d = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    [clientX, clientY],
  );
}

/** True when any canvas pixel has non-zero alpha. */
export async function canvasHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  });
}

export function rgbaDiffers(a: Rgba, b: Rgba, tol = 8): boolean {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a)) > tol;
}

/** Alpha of a computed CSS colour as Chromium serialises it: `rgb(r, g, b)` or `rgba(r, g, b, a)`. */
export function cssAlpha(color: string): number {
  const m = /^rgba?\(([^)]*)\)$/.exec(color.trim());
  if (!m) throw new Error(`cssAlpha: unsupported colour "${color}"`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}
