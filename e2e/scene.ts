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

/** Alpha of a computed CSS colour as Chromium serialises it: `rgb(r, g, b)` or `rgba(r, g, b, a)`. */
export function cssAlpha(color: string): number {
  const m = /^rgba?\(([^)]*)\)$/.exec(color.trim());
  if (!m) throw new Error(`cssAlpha: unsupported colour "${color}"`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}
