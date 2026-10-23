/**
 * W86 (D86-2 … D86-9): the built site, served from site/dist on SITE_PORT with Vite's preview().
 * Canvas2D (the project renders canvas2d in the headless shell). Public API only.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { preview, type PreviewServer } from "vite";
import { test, expect } from "./fixtures";
import { SITE_PORT, SITE_ROOT } from "./projects";

const ROOT = resolve(process.cwd(), SITE_ROOT); // the root package is ESM: no __dirname (as dist.spec.ts)
const URL = `http://localhost:${SITE_PORT}`;
const DOCS = ["getting-started", "api", "adapters", "accessibility", "limitations"];
const PURPLE = [83, 52, 131];
let server: PreviewServer | undefined;

test.beforeAll(async () => {
  if (!existsSync(resolve(ROOT, "dist/index.html"))) throw new Error("site/dist missing: run `npm run e2e:site:build` first");
  server = await preview({ root: ROOT, configFile: false, logLevel: "warn", build: { outDir: "dist" }, preview: { port: SITE_PORT, strictPort: true, open: false } });
});
test.afterAll(async () => {
  await server?.close();
});

/** RGBA at the client point (x, y) of the canvas that is a direct child of `scope` (Canvas2D only). */
async function liquidPixel(page: import("@playwright/test").Page, scope: string, x: number, y: number) {
  return page.evaluate(([s, px, py]) => {
    const c = document.querySelector<HTMLCanvasElement>(`${s} > canvas.liquid-canvas`)!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return Array.from(c.getContext("2d")!.getImageData(Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1).data);
  }, [scope, x, y] as const);
}

/** The sRGB value the browser paints for a CSS custom property's colour. */
async function paintedVar(page: import("@playwright/test").Page, name: string) {
  return page.evaluate((n) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, name);
}

const near = (a: number[], b: number[], tol = 6) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

test("given the landing when it loads then one liquid canvas under the page, nine chapters and no liquiddom warning", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
  await page.goto(`${URL}/`);
  await expect(page.locator("body > canvas.liquid-canvas")).toHaveCount(1);
  expect(await page.locator("body > canvas.liquid-canvas").evaluate((c) => getComputedStyle(c).zIndex)).toBe("-1");
  await expect(page.locator("section[data-chapter]")).toHaveCount(9);
  expect(warnings.filter((w) => w.includes("[liquiddom]"))).toEqual([]);
});

test("given chapters 3 and 7 when scrolled into view then three and two container canvases and their buttons work", async ({ page }) => {
  await page.goto(`${URL}/`);
  await page.locator('section[data-chapter="3"]').scrollIntoViewIfNeeded();
  await expect(page.locator(".pool[data-preset] > canvas.liquid-canvas")).toHaveCount(3);
  await page.locator("#shake-all").click();
  await page.locator('section[data-chapter="7"]').scrollIntoViewIfNeeded();
  await expect(page.locator(".pool[data-calm] > canvas.liquid-canvas")).toHaveCount(2);
  await page.locator("#splash-both").click();
  await expect(page.locator("[data-liquid-stopped]")).toBeHidden();
});

test("given the last chapter 6 card when scrolled to then its liquid appears at rest", async ({ page }) => {
  await page.goto(`${URL}/`);
  await expect(page.locator("body > canvas.liquid-canvas")).toHaveCount(1);
  const card = page.locator(".run-card").last();
  await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const tone = await card.getAttribute("data-tone");
  const want = await paintedVar(page, `--liquid-${tone}`);
  const box = (await card.boundingBox())!;
  await expect.poll(async () => near(await liquidPixel(page, "body", box.x + box.width / 2, box.y + box.height - 6), want), { timeout: 1000 }).toBe(true);
  expect((await liquidPixel(page, "body", box.x - 8, box.y + box.height / 2))[3]).toBe(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("given reduced motion when the landing rests then the hero drop's liquid has its oklch colour, not the default purple", async ({ page }) => {
    await page.goto(`${URL}/`);
    await expect(page.locator("body > canvas.liquid-canvas")).toHaveCount(1);
    const drop = page.locator("#drop-cyan");
    const box = (await drop.boundingBox())!;
    const want = await paintedVar(page, "--liquid-cyan");
    expect(near(want, PURPLE, 20)).toBe(false);
    await expect.poll(async () => near(await liquidPixel(page, "body", box.x + box.width / 2, box.y + box.height / 2), want), { timeout: 1000 }).toBe(true);
  });
});

test("given the playground when the honey preset is applied and the page reloaded then the material is restored from liquiddom-playground-v3 and v1/v2 are gone", async ({ page }) => {
  await page.addInitScript(() => {
    // Before EVERY load (no once-guard): the null checks below prove the page removes both legacy keys (W69 ward review).
    localStorage.setItem("liquiddom-playground-v1", JSON.stringify({ schema: 1, liquidType: "water" }));
    localStorage.setItem("liquiddom-playground-v2", JSON.stringify({ schema: 2 }));
  });
  type Handle = { instance: { getMaterial(): Record<string, number> }; presets: Record<string, Record<string, number>>; applyPreset(n: string): void };
  const handle = () => page.waitForFunction(() => (window as unknown as { liquiddom?: Handle }).liquiddom?.instance !== undefined);
  await page.goto(`${URL}/playground/`);
  await handle();
  expect(await page.evaluate(() => [localStorage.getItem("liquiddom-playground-v1"), localStorage.getItem("liquiddom-playground-v2")])).toEqual([null, null]);
  await expect(page.locator("#tweak-mount > *")).not.toHaveCount(0);
  await page.evaluate(() => (window as unknown as { liquiddom: Handle }).liquiddom.applyPreset("honey"));
  const honey = await page.evaluate(() => (window as unknown as { liquiddom: Handle }).liquiddom.presets.honey);
  const material = () => page.evaluate(() => (window as unknown as { liquiddom: Handle }).liquiddom.instance.getMaterial());
  expect(await material(), "applyPreset(honey) reaches the instance").toEqual(honey);
  await page.waitForFunction(() => localStorage.getItem("liquiddom-playground-v3") !== null);
  await page.reload();
  await handle();
  expect(await page.evaluate(() => [localStorage.getItem("liquiddom-playground-v1"), localStorage.getItem("liquiddom-playground-v2")]), "v1 and v2 removed after reload").toEqual([null, null]);
  expect(await material(), "honey restored after reload").toEqual(honey);
});

test("given every docs page when loaded then it has its title and no liquid canvas", async ({ page }) => {
  for (const p of DOCS) {
    await page.goto(`${URL}/docs/${p}/`);
    await expect(page.locator("main h1"), p).toHaveCount(1);
    await expect(page.locator("canvas.liquid-canvas"), p).toHaveCount(0);
  }
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("given a 390 px phone viewport when the landing loads then nothing scrolls sideways", async ({ page }) => {
    await page.goto(`${URL}/`);
    await expect(page.locator("body > canvas.liquid-canvas")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
