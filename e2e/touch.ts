/**
 * W84 (D84-1, D84-2): touch helpers for the acceptance scene on the RAF clock, driven by CDP
 * `Input.dispatchTouchEvent` in a `hasTouch` context.
 *
 * Harness rules from spike W84.0: never `page.waitForFunction` and never CDP `Log.enable` here (both
 * register document-wide touch handlers, every touch sequence then blocks on the main thread and a
 * strategy that leaves `touchmove` uncancelable would pass); poll with `page.evaluate` /
 * `expect.poll`; read Chromium's interventions with a `ReportingObserver` from an init script.
 * Chromium's touch emulation never fires `contextmenu` on a hold, so D84-5 is checked in jsdom and
 * on a phone, not here.
 */
import { expect, type CDPSession, type Page } from "@playwright/test";
import type { SceneSlot } from "../demo/test-hooks";
import type { SceneRenderer } from "./projects";

/** DOM index of each [data-liquid] element in `__liquidTest.slots()`. */
export const SLOT = { splash: 0, split: 1, merge: 2, card: 3 } as const;
/** Slot 5's DRAGGED (fluid-layout.ts `Interaction.DRAGGED`). */
export const DRAGGED = 3;
/** D84-1's 350 ms plus a margin for the CDP round trips. */
export const HOLD_MS = 450;
/** One finger step of the long-press drag (px, upward: a finger moving up would scroll the page down). */
export const STEP_PX = -10;
export const STEPS = 12;

/** What the init script counts (document capture phase; no touch listener, so no blocking region). */
export interface TouchProbe {
  cancels: number;
  clicks: number;
  interventions: string[];
}

/** Installs `window.__w84` before any page script. */
export async function installTouchProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { cancels: 0, clicks: 0, interventions: [] as string[] };
    (window as unknown as { __w84: typeof probe }).__w84 = probe;
    document.addEventListener("pointercancel", () => {
      probe.cancels += 1;
    }, true);
    document.addEventListener("click", () => {
      probe.clicks += 1;
    }, true);
    type Report = { type: string; body?: { message?: string } };
    type RO = new (cb: (reports: Report[]) => void, opts: { types: string[]; buffered: boolean }) => { observe(): void; takeRecords(): Report[] };
    const Observer = (window as unknown as { ReportingObserver?: RO }).ReportingObserver;
    if (Observer) {
      const push = (reports: Report[]) => {
        for (const r of reports) probe.interventions.push(r.body?.message ?? r.type);
      };
      const observer = new Observer(push, { types: ["intervention"], buffered: true });
      observer.observe();
      // probe() flushes the queue, so a report not yet delivered to the callback still counts.
      (window as unknown as { __w84Flush: () => void }).__w84Flush = () => push(observer.takeRecords());
    }
  });
}

export async function probe(page: Page): Promise<TouchProbe> {
  return page.evaluate(() => {
    (window as unknown as { __w84Flush?: () => void }).__w84Flush?.();
    const p = (window as unknown as { __w84: TouchProbe }).__w84;
    return { cancels: p.cancels, clicks: p.clicks, interventions: [...p.interventions] };
  });
}

/** The acceptance scene on the RAF clock (live, as on a phone), with the probe; `extra` is appended to the query. */
export async function gotoTouchScene(page: Page, renderer: SceneRenderer, extra = ""): Promise<CDPSession> {
  await installTouchProbe(page);
  await page.goto(`/scenes/acceptance.html?test=1&seed=1&renderer=${renderer}${extra}`);
  await expect.poll(() => page.evaluate(() => window.__liquidTest !== undefined), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => window.scrollY), "the scene starts at the top").toBe(0);
  return page.context().newCDPSession(page);
}

export async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector);
}

export async function slots(page: Page): Promise<SceneSlot[]> {
  return page.evaluate(() => window.__liquidTest!.slots!());
}

export async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

type TouchType = "touchStart" | "touchMove" | "touchEnd";

export async function touch(cdp: CDPSession, type: TouchType, x = 0, y = 0): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
}

export interface LongPressRun {
  /** scrollY after each move. */
  scroll: number[];
  /** The slots read after the last move, before the release. */
  mid: SceneSlot[];
  /** True when any slot read between the moves showed DRAGGED for `index`. */
  draggedSeen: boolean;
}

/**
 * touchStart at `at`, a still hold, then `steps` moves of `stepPx` (y) 16 ms apart; the finger stays down.
 * `expectDrag`: the finger holds still until slot `index` shows DRAGGED (D84-1's fire, D84-4's hold is the
 * feedback) and the run polls the last offset in, so a late timer or a slow frame on a CI runner cannot
 * turn the press into a swipe or read a stale offset (W84.1 review I1). Without it the finger holds a
 * fixed `holdMs` (past the 350 ms) and nothing is awaited: the opt-out run must prove nothing happens.
 */
export async function longPressMove(page: Page, cdp: CDPSession, at: { x: number; y: number }, index: number, expectDrag: boolean, holdMs = HOLD_MS, steps = STEPS, stepPx = STEP_PX): Promise<LongPressRun> {
  const scroll: number[] = [];
  let draggedSeen = false;
  await touch(cdp, "touchStart", at.x, at.y);
  if (expectDrag) {
    await expect.poll(async () => (await slots(page))[index]!.interaction, { message: "the long-press fires while the finger holds still", timeout: 3_000, intervals: [16] }).toBe(DRAGGED);
  } else {
    await page.waitForTimeout(holdMs);
  }
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, "touchMove", at.x, at.y + stepPx * i);
    await page.waitForTimeout(16);
    scroll.push(await scrollY(page));
    if ((await slots(page))[index]!.interaction === DRAGGED) draggedSeen = true;
  }
  if (expectDrag) {
    await expect.poll(async () => (await slots(page))[index]!.homeDy, { message: "the last offset reaches the slot", timeout: 2_000, intervals: [16] }).toBe(stepPx * steps);
  } else {
    await page.waitForTimeout(50);
  }
  return { scroll, mid: await slots(page), draggedSeen };
}

/** A quick swipe: `steps` moves of `stepPx` (y) 16 ms apart starting at `at`, then the release. */
export async function swipe(page: Page, cdp: CDPSession, at: { x: number; y: number }, steps = 6, stepPx = -5): Promise<void> {
  await touch(cdp, "touchStart", at.x, at.y);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, "touchMove", at.x, at.y + stepPx * i);
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd");
}
