/**
 * W72 (harness, no decision): warms the e2e Vite server before any test. On a cold server the
 * first scene load can trigger Vite's dependency optimiser, which reloads the page and fails the
 * first test with "Execution context was destroyed" (W71 gold notes). Playwright starts the
 * webServer (or reuses a running one, reuseExistingServer) before globalSetup; this loads the
 * acceptance scene, retries a navigation race, and waits until the page stays put.
 * Best effort: a failed warm-up only warns; the tests report real problems themselves.
 */
import { chromium } from "@playwright/test";
import { BASE_URL, WARMUP_ATTEMPTS, WARMUP_PATH, WARMUP_SETTLE_MS, isNavigationRace } from "./projects";

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt++) {
      try {
        await page.goto(`${BASE_URL}${WARMUP_PATH}`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 30_000 });
        await page.evaluate(() => window.__liquidTest!.ready);
        // A late optimiser reload destroys this context; the second evaluate then throws a navigation race.
        await page.waitForTimeout(WARMUP_SETTLE_MS);
        await page.evaluate(() => window.__liquidTest!.ready);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isNavigationRace(message) || attempt === WARMUP_ATTEMPTS) {
          console.warn(`[e2e warm-up] ${message.split("\n")[0]} (attempt ${attempt}); continuing without a warmed server`);
          return;
        }
      }
    }
  } finally {
    await browser.close();
  }
}
