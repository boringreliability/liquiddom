/**
 * W69: demo scenes in a real browser (canvas2d project, blocking in CI).
 * The W65 guard fixture fails the test on any console.error, pageerror or panic.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

type SceneHook = {
  ready: Promise<void>;
  restAlpha(): number[];
  cellPx(): number;
  elementOptionsOf(el: HTMLElement): { viscosity: number; recovery: number } | null;
  instance: unknown;
};
type MaterialShape = { viscosity: number; cohesion: number; recovery: number };
type PlaygroundHandle = {
  instance: { getMaterial(): MaterialShape };
  presets: Record<"water" | "honey" | "jelly", MaterialShape>;
  applyPreset(name: "water" | "honey" | "jelly"): void;
};

const SPLASH_URL = "/scenes/splash.html?test=1&seed=1&renderer=canvas2d";
const REFORM_TIMEOUT_MS = 15_000;

async function restAlpha(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.restAlpha());
}

async function waitAllRest(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.restAlpha().every((a) => a === 1),
    undefined,
    { timeout: timeoutMs, polling: 50 },
  );
}

async function waitAnyMoving(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.restAlpha().some((a) => a < 1),
    undefined,
    { timeout: timeoutMs, polling: 16 },
  );
}

async function waitMoving(page: Page, index: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    (i) => {
      const a = (window as unknown as { __liquidTest: SceneHook }).__liquidTest.restAlpha();
      return (a[i] ?? 1) < 1;
    },
    index,
    { timeout: timeoutMs, polling: 16 },
  );
}

/** Click the empty top-left corner (canvas is pointer-events:none → body), then Tab to a drop. */
async function tabToDrop(page: Page, drop: string): Promise<void> {
  await page.mouse.click(4, 4);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => document.activeElement?.getAttribute("data-drop") ?? null);
    if (at === drop) return;
  }
  throw new Error(`Tab never reached [data-drop="${drop}"]`);
}

test("given the splash scene when buttons are clicked and keyboard-activated then no console error and every element re-forms to restAlpha 1", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(SPLASH_URL);
  await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.ready);
  await waitAllRest(page, 5_000);
  expect(await restAlpha(page)).toHaveLength(4); // thin, medium, thick, pool
  // D69-3/D69-5: autoObserve false → no area hint → CELL_MAX_PX (B5); pins the hook's cellPx().
  expect(await page.evaluate(() => (window as unknown as { __liquidTest: SceneHook }).__liquidTest.cellPx())).toBe(8);
  await page.screenshot({ path: testInfo.outputPath("splash-rest.png") });

  // D69-3: per-element material options. W69.4: each [data-drop] button carries
  // data-viscosity / data-recovery, and splash.ts passes exactly those values to observe().
  const options = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-drop]")].map((el) => ({
      drop: el.getAttribute("data-drop"),
      viscosity: Number(el.getAttribute("data-viscosity")),
      recovery: Number(el.getAttribute("data-recovery")),
    })),
  );
  expect(options).toEqual([
    { drop: "thin", viscosity: 0.1, recovery: 0.4 },
    { drop: "medium", viscosity: 0.5, recovery: 0.7 },
    { drop: "thick", viscosity: 0.9, recovery: 1.2 },
  ]);
  // W69 ward review: the attributes alone prove nothing about observe(). Read back what
  // reached the runtime: element buffer slots 8/9 (viscosity, recovery). The registry
  // stores the values unclamped (the facade range-checks and throws); Float32 → toBeCloseTo.
  const reached = await page.evaluate(() => {
    const hook = (window as unknown as { __liquidTest: SceneHook }).__liquidTest;
    return [...document.querySelectorAll<HTMLElement>("[data-drop]"), document.getElementById("pool")!].map((el) =>
      hook.elementOptionsOf(el),
    );
  });
  const expected = [
    { viscosity: 0.1, recovery: 0.4 },
    { viscosity: 0.5, recovery: 0.7 },
    { viscosity: 0.9, recovery: 1.2 },
  ];
  expect(reached).toHaveLength(4);
  expected.forEach((want, i) => {
    const got = reached[i];
    expect(got, `drop ${i} read-back`).not.toBeNull();
    expect(got!.viscosity, `drop ${i} viscosity`).toBeCloseTo(want.viscosity, 5);
    expect(got!.recovery, `drop ${i} recovery`).toBeCloseTo(want.recovery, 5);
  });
  // The pool is observed without options: NaN in both slots (engine default).
  expect(reached[3]).not.toBeNull();
  expect(Number.isNaN(reached[3]!.viscosity) && Number.isNaN(reached[3]!.recovery), "pool uses the defaults").toBe(true);

  // The pool is pointer-only (spec §4): no tabindex, and Tab never lands on it.
  expect(await page.locator("#pool").getAttribute("tabindex")).toBeNull();
  await page.mouse.click(4, 4);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id ?? ""), "Tab must never focus #pool").not.toBe("pool");
  }

  // A. Pointer clicks on every liquid element: splash at the pointer, strength 1 (W67 click wiring).
  for (const selector of ['[data-drop="thin"]', '[data-drop="medium"]', '[data-drop="thick"]', "#pool"]) {
    await page.locator(selector).click();
  }
  await waitAnyMoving(page, 1_000);
  await page.waitForTimeout(150);
  await page.screenshot({ path: testInfo.outputPath("splash-after-clicks.png") });
  await page.mouse.move(4, 4);
  await waitAllRest(page, REFORM_TIMEOUT_MS);

  // B. Keyboard: Enter on Thin, Space on Medium (click with detail 0 → rect centre).
  await tabToDrop(page, "thin");
  await page.keyboard.press("Enter");
  await waitMoving(page, 0, 1_000);
  await waitAllRest(page, REFORM_TIMEOUT_MS);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-drop") ?? null)).toBe("medium");
  await page.screenshot({ path: testInfo.outputPath("splash-focus-medium.png") });
  await page.keyboard.press("Space");
  await waitMoving(page, 1, 1_000);
  await waitAllRest(page, REFORM_TIMEOUT_MS);

  // C. Non-liquid controls: Splash all at strength 2, then Shake.
  await page.locator("#strength").fill("2");
  await expect(page.locator("#strength-out")).toHaveText("2.0");
  await page.locator("#splash-all").click();
  await waitAnyMoving(page, 1_000);
  await page.locator("#shake").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath("splash-after-shake.png") });
  await page.mouse.move(4, 4);
  await waitAllRest(page, REFORM_TIMEOUT_MS);
  await page.screenshot({ path: testInfo.outputPath("splash-reformed.png") });
  expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);
});

test("given the playground when the honey preset is applied and the page reloaded then no console error and the material is restored from liquiddom-playground-v2", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  // W69 ward review: seed the legacy v1 key before every load, so the null checks below
  // prove the playground removes it (an unseeded key is null whatever the code does).
  await page.addInitScript(() => {
    localStorage.setItem("liquiddom-playground-v1", JSON.stringify({ schema: 1, liquidType: "water" }));
  });
  await page.goto("/scenes/playground.html");
  await page.waitForFunction(() => (window as unknown as { __playground?: unknown }).__playground !== undefined, undefined, {
    timeout: 10_000,
  });
  expect(await page.evaluate(() => localStorage.getItem("liquiddom-playground-v1")), "v1 removed on first load").toBeNull();
  await expect(page.locator("#tweak-mount > *")).not.toHaveCount(0);

  const honey = await page.evaluate(() => {
    const p = (window as unknown as { __playground: PlaygroundHandle }).__playground;
    p.applyPreset("honey");
    return { applied: p.instance.getMaterial(), expected: { ...p.presets.honey } };
  });
  expect(honey.applied).toEqual(honey.expected);

  await page.waitForFunction((key) => localStorage.getItem(key) !== null, "liquiddom-playground-v2", { timeout: 2_000 });
  await page.screenshot({ path: testInfo.outputPath("playground-honey.png") });
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __playground?: unknown }).__playground !== undefined, undefined, {
    timeout: 10_000,
  });
  const restored = await page.evaluate(() =>
    (window as unknown as { __playground: PlaygroundHandle }).__playground.instance.getMaterial(),
  );
  expect(restored).toEqual(honey.expected);
  expect(await page.evaluate(() => localStorage.getItem("liquiddom-playground-v1")), "v1 removed after reload").toBeNull();
});
