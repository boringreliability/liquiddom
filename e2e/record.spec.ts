/**
 * W69/W70: whole-picture recording of the acceptance scene (D69-2, D70-6); W72: one test per
 * renderer for the W72 gold GIFs.
 * - canvas2d runs in the local `record` project (`npm run whole-picture`, `npm run record:w72`);
 *   webgpu runs in the local `record-webgpu` project (hardware adapter, `npm run record:w72`).
 *   Neither ever runs in CI. Video comes from PROJECT_USE (e2e/projects.ts) via useFor().
 * - RAF clock (no ?clock=manual): a manual clock would record a frozen video (C6).
 * - Records steps 1–4, 6 and 8 (a ?rm=1 segment, D70-6). Step 5 (drag, slice 5) and 7 (scroll, slice 6) are ⏳.
 * - W76 (D76-1, slice 4): step 3b, a gentle card splash for the liquid text, and a live forced-colours
 *   switch mid-splash (S4 step 8), in both renderers (`npm run whole-picture`).
 * - W76 (D76-2): then the landing page (rest, hover and click "Start free", shake, re-form) in the same video.
 * - Re-form budgets are read from .wdd/NORTH-STAR.md (the D67-1 outcome), never hard-coded.
 *   They are reported, not asserted: acceptance.spec.ts and webgpu-robust.spec.ts assert them.
 * Timings are wall-clock (±50 ms) and go to the manifest for the status report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { errors, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { NORTH_STAR_PATH, reformBudgetMs } from "./north-star";

type SceneHook = {
  ready: Promise<void>;
  restAlpha(): number[];
  instance: { activeRenderer: string; shake(strength?: number): void; splash(el: Element, opts?: { strength?: number }): void };
};

const OUT_DIR = resolve(process.cwd(), "test-results/whole-picture");
const SHOTS_DIR = resolve(OUT_DIR, "shots");

/**
 * One recording per renderer. The canvas2d paths are W69's (the whole-picture script and the
 * slice-2 report use them). Videos live outside test-results at a stable, gitignored path:
 * Playwright moves its video only after the page closes, and parallel runs can wipe test-results.
 */
const RECORDINGS = [
  { renderer: "canvas2d", project: "record", manifest: "manifest.json", video: "tmp/whole-picture/slice-2.webm", shotPrefix: "s2" },
  { renderer: "webgpu", project: "record-webgpu", manifest: "manifest-webgpu.json", video: "tmp/whole-picture/webgpu.webm", shotPrefix: "webgpu" },
] as const;

const NORTH_STAR_MD = readFileSync(resolve(process.cwd(), NORTH_STAR_PATH), "utf8");
/** Step 3 budget = D67-1 outcome. Step 4 is the same splash at the centre, so it shares it. */
const SPLASH_BUDGET_MS = reformBudgetMs(NORTH_STAR_MD, 3);
const SHAKE_BUDGET_MS = reformBudgetMs(NORTH_STAR_MD, 6);
/** Wait long enough to measure an over-budget re-form instead of reporting null. */
const reformTimeout = (budgetMs: number): number => 2 * budgetMs + 1_000;

interface StepTiming {
  step: number;
  name: string;
  budgetMs: number | null;
  reactedMs: number | null;
  reformMs: number | null;
}

async function until(page: Page, kind: "allRest" | "anyMoving", timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (k) => {
        const a = (window as unknown as { __liquidTest: SceneHook }).__liquidTest.restAlpha();
        return k === "allRest" ? a.every((v) => v === 1) : a.some((v) => v < 1);
      },
      kind,
      { timeout: timeoutMs, polling: 16 },
    );
    return true;
  } catch (err) {
    if (err instanceof errors.TimeoutError) return false;
    throw err;
  }
}

/** A visible sweep: one pointermove per ~16 ms frame. */
async function sweep(page: Page, x0: number, x1: number, y: number, durationMs: number): Promise<void> {
  const n = Math.max(2, Math.round(durationMs / 16));
  for (let i = 0; i <= n; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / n, y);
    await page.waitForTimeout(16);
  }
}

for (const r of RECORDINGS) {
  // W72 red: approved-test change (Dennis approves at W72 red): W69/W70's canvas2d recording becomes one test per renderer (canvas2d assertions and paths kept)
  test(`whole picture – acceptance steps 1-4, 6 and 8 recorded in ${r.renderer}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== r.project, `the ${r.renderer} recording runs only in the ${r.project} project`);
    test.setTimeout(180_000); // W76: the slice-4 segments and the landing page roughly double the recording
    mkdirSync(SHOTS_DIR, { recursive: true });
    const timings: StepTiming[] = [];
    const shots: string[] = [];
    const SCENE_URL = `/scenes/acceptance.html?seed=1&renderer=${r.renderer}&test=1`;
    /** D70-6: step 8, the same scene in reduced motion (forceReducedMotion via ?rm=1). */
    const RM_SCENE_URL = `${SCENE_URL}&rm=1`;
    /** D76-2: the landing page, same seed, renderer, hook and RAF clock as the acceptance scene. */
    const LANDING_URL = `/scenes/landing.html?seed=1&renderer=${r.renderer}&test=1`;
    const VIDEO_PATH = resolve(process.cwd(), r.video);

    const shot = async (name: string): Promise<void> => {
      const path = resolve(SHOTS_DIR, `${r.shotPrefix}-${name}.png`);
      await page.screenshot({ path });
      shots.push(path);
    };
    /** Runs `act`, then measures reaction (any restAlpha < 1) and re-form (all = 1) from the act. */
    const measure = async (
      act: () => Promise<unknown>,
      midShot: { name: string; afterMs: number },
      reformTimeoutMs: number,
    ): Promise<{ reactedMs: number | null; reformMs: number | null }> => {
      const t0 = Date.now();
      await act();
      const reacted = await until(page, "anyMoving", 500);
      const reactedMs = reacted ? Date.now() - t0 : null;
      const wait = midShot.afterMs - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await shot(midShot.name);
      const reformed = await until(page, "allRest", reformTimeoutMs);
      return { reactedMs, reformMs: reformed ? Date.now() - t0 : null };
    };

    await page.goto(SCENE_URL);
    await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.ready);
    const activeRenderer = await page.evaluate(
      () => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.instance.activeRenderer,
    );
    expect(activeRenderer).toBe(r.renderer);
    const adapter = await page.evaluate(async () => {
      type Info = { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Info } | null> } }).gpu;
      const a = gpu ? await gpu.requestAdapter() : null;
      return a?.info ? { vendor: a.info.vendor ?? "", architecture: a.info.architecture ?? "", isFallbackAdapter: a.info.isFallbackAdapter ?? null } : null;
    });
    await page.mouse.move(4, 4);

    // Step 1 – idle 2 s at rest.
    const t1 = Date.now();
    const rest1 = await until(page, "allRest", 3_000);
    timings.push({ step: 1, name: "idle", budgetMs: null, reactedMs: null, reformMs: rest1 ? Date.now() - t1 : null });
    await page.waitForTimeout(2_000);
    await shot("step1-idle");

    // Step 2 – pointer sweep across the three buttons and back.
    const splash = page.getByRole("button", { name: "Splash", exact: true });
    const merge = page.getByRole("button", { name: "Merge", exact: true });
    const a = await splash.boundingBox();
    const c = await merge.boundingBox();
    if (a === null || c === null) throw new Error("acceptance scene buttons are not laid out");
    const y = a.y + a.height / 2;
    await page.mouse.move(a.x - 60, y);
    await sweep(page, a.x - 60, c.x + c.width + 60, y, 1_200);
    await shot("step2-sweep");
    await sweep(page, c.x + c.width + 60, a.x - 60, y, 1_200);
    await page.mouse.move(4, 4, { steps: 10 });
    const t2 = Date.now();
    const rest2 = await until(page, "allRest", 5_000);
    timings.push({ step: 2, name: "pointer sweep", budgetMs: null, reactedMs: null, reformMs: rest2 ? Date.now() - t2 : null });

    // Step 3 – click "Splash" (splash at the pointer), then park the pointer far from any
    // liquid, as acceptance.spec does (W68: pointer field and hover swell on the clicked pill).
    const s3 = await measure(
      async () => {
        await splash.click();
        await page.mouse.move(1279, 799);
      },
      { name: "step3-splash-150ms", afterMs: 150 },
      reformTimeout(SPLASH_BUDGET_MS),
    );
    await shot("step3-reformed");
    timings.push({ step: 3, name: 'click "Splash"', budgetMs: SPLASH_BUDGET_MS, ...s3 });

    // Step 3b (S4, W76) – a gentle API splash on the card, the element with the most text: under
    // WebGPU its heading and paragraph should stretch with their liquid (W74), under Canvas2D the
    // DOM text keeps its halo (W75). An API splash changes no hover or focus state.
    const s3b = await measure(
      () =>
        page.evaluate(() => {
          const card = document.querySelector<HTMLElement>("#card");
          if (!card) throw new Error("W76: #card not found");
          (window as unknown as { __liquidTest: SceneHook }).__liquidTest.instance.splash(card, { strength: 0.5 });
        }),
      { name: "step3-card-text-250ms", afterMs: 250 },
      reformTimeout(SPLASH_BUDGET_MS),
    );
    await shot("step3-card-reformed");
    timings.push({ step: 3, name: "card splash at strength 0.5 (liquid text)", budgetMs: SPLASH_BUDGET_MS, ...s3b });

    // Step 4 – Tab to "Split", Enter (click detail 0 → centre). Focus ring visible throughout.
    await page.mouse.click(4, 4);
    let focused = false;
    for (let i = 0; i < 12 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim() === "Split");
    }
    expect(focused, "Tab never reached the Split button").toBe(true);
    await page.waitForTimeout(400);
    await shot("step4-focus");
    const s4 = await measure(() => page.keyboard.press("Enter"), { name: "step4-splash-150ms", afterMs: 150 }, reformTimeout(SPLASH_BUDGET_MS));
    await shot("step4-reformed");
    timings.push({ step: 4, name: 'Tab + Enter on "Split"', budgetMs: SPLASH_BUDGET_MS, ...s4 });

    // Step 6 – shake everything.
    const s6 = await measure(
      () => page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.instance.shake()),
      { name: "step6-shake-200ms", afterMs: 200 },
      reformTimeout(SHAKE_BUDGET_MS),
    );
    await shot("step6-reformed");
    timings.push({ step: 6, name: "shake", budgetMs: SHAKE_BUDGET_MS, ...s6 });

    // Hold the final rest frame for the GIF.
    await page.waitForTimeout(1_500);

    // S4 step 8 (W76) – forced colours switched on live mid-splash: the canvas hides and the DOM
    // text shows at once (W75), then forced colours go off and the liquid re-forms.
    await page.getByRole("button", { name: "Splash", exact: true }).click();
    await page.mouse.move(1279, 799);
    await page.waitForTimeout(150);
    // W74 (D74-6) hides the glyphs with -webkit-text-fill-color, not `color` (forced colours always
    // force `color` to CanvasText), so the fill is what shows whether the DOM text is visible.
    const fillBeforeForced = await page.evaluate(
      () => getComputedStyle(document.querySelector("#splash")!).webkitTextFillColor,
    );
    await page.emulateMedia({ forcedColors: "active" });
    const forced = await page.evaluate(() => ({
      fill: getComputedStyle(document.querySelector("#splash")!).webkitTextFillColor,
      canvas: getComputedStyle(document.querySelector("canvas.liquid-canvas")!).display,
    }));
    await shot("step8-forced-colors-mid-splash");
    expect(forced.canvas, "forced colours hide the liquid canvas").toBe("none");
    expect(forced.fill, "forced colours show the DOM text at once").not.toBe("rgba(0, 0, 0, 0)");
    await page.waitForTimeout(600);
    await page.emulateMedia({ forcedColors: "none" });
    const t8f = Date.now();
    const rest8f = await until(page, "allRest", reformTimeout(SPLASH_BUDGET_MS));
    await shot("step8-forced-colors-after");
    timings.push({
      step: 8,
      name: `forced colours on live mid-splash, then off (#splash text fill before ${fillBeforeForced}, during ${forced.fill})`,
      budgetMs: null,
      reactedMs: null,
      reformMs: rest8f ? Date.now() - t8f : null,
    });
    await page.waitForTimeout(1_000);

    // Step 8 – reduced motion (?rm=1, D70-6): the same scene with forceReducedMotion. A click on
    // "Splash" and a shake must show no motion: every restAlpha stays 1 and the scene stays crisp.
    await page.goto(RM_SCENE_URL);
    await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.ready);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1_000);
    await shot("step8-rm-idle");
    const t8 = Date.now();
    await page.getByRole("button", { name: "Splash", exact: true }).click();
    await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.instance.shake());
    await page.mouse.move(1279, 799);
    const moved8 = await until(page, "anyMoving", 1_000);
    await shot("step8-rm-after-click-and-shake");
    timings.push({
      step: 8,
      name: "reduced motion (?rm=1): click + shake",
      budgetMs: null,
      reactedMs: moved8 ? Date.now() - t8 : null,
      reformMs: null,
    });
    expect(moved8, "step 8: under ?rm=1 a click and a shake must not move the liquid").toBe(false);
    await page.waitForTimeout(1_500);

    // Landing (D76-2, W76) – an ordinary one-screen SaaS page in the same recording: rest, hover
    // the "Start free" CTA (author CSS changes its background-color with a transition), click it
    // (splash at the pointer), shake everything, wait for the re-form. Findings go to the report.
    await page.goto(LANDING_URL);
    await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.ready);
    await page.mouse.move(4, 4);
    const tl = Date.now();
    const restL = await until(page, "allRest", 3_000);
    const landingIdleMs = restL ? Date.now() - tl : null;
    await page.waitForTimeout(1_500);
    await shot("landing-rest");
    const startFree = page.getByRole("button", { name: "Start free", exact: true });
    await startFree.hover();
    await page.waitForTimeout(600);
    await shot("landing-hover");
    const splashL = await measure(
      async () => {
        await startFree.click();
        await page.mouse.move(1279, 799);
      },
      { name: "landing-splash-150ms", afterMs: 150 },
      reformTimeout(SPLASH_BUDGET_MS),
    );
    const shakeL = await measure(
      () => page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.instance.shake()),
      { name: "landing-shake-200ms", afterMs: 200 },
      reformTimeout(SHAKE_BUDGET_MS),
    );
    // measure() has already waited for every restAlpha = 1 after the shake: its reformMs is the
    // landing's end state, so there is no second wait.
    const reformedAtEnd = shakeL.reformMs !== null;
    await shot("landing-reformed");
    const landing = {
      scene: LANDING_URL,
      idleRestMs: landingIdleMs,
      reformedAtEnd,
      timings: [
        { name: 'click "Start free"', budgetMs: SPLASH_BUDGET_MS, ...splashL },
        { name: "shake", budgetMs: SHAKE_BUDGET_MS, ...shakeL },
      ],
    };
    await page.waitForTimeout(1_500);

    const video = page.video();
    expect(video, `video recording is not enabled (PROJECT_USE["${r.project}"])`).not.toBeNull();
    mkdirSync(dirname(VIDEO_PATH), { recursive: true });
    // The video is only finalised once the page is closed; saveAs then copies it to the stable path.
    await page.close();
    await video?.saveAs(VIDEO_PATH);
    writeFileSync(
      resolve(OUT_DIR, r.manifest),
      JSON.stringify(
        {
          scene: SCENE_URL,
          renderer: activeRenderer,
          adapter,
          clock: "raf",
          viewport: "1280x800",
          budgetsFrom: NORTH_STAR_PATH,
          budgetsMs: { splash: SPLASH_BUDGET_MS, shake: SHAKE_BUDGET_MS },
          recordedAt: new Date().toISOString(),
          video: VIDEO_PATH,
          timings,
          landing,
          shots,
        },
        null,
        2,
      ),
    );
    // Asserted after the manifest is written, so a failing run still leaves its timings. The budgets
    // stay reported, not asserted; the gate is only that the landing page settles at all.
    expect(reformedAtEnd, `landing: every element at rest within ${reformTimeout(SHAKE_BUDGET_MS)} ms of the shake`).toBe(true);
  });
}
