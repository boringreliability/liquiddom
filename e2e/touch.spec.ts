/**
 * W84 "Touch and opt-out" (canvas2d, blocking; the default testMatch routes this file to canvas2d only).
 * D84-1: a 350 ms long-press on an observed element drags its liquid with the finger and the page
 * does not scroll (no pointercancel, no intervention); a quick swipe starting on it still scrolls
 * and drags nothing; a tap is one click. D84-2: `?nodrag=split` observes Split with
 * `{ drag: false }`: neither a long-press nor a mouse drag moves its liquid, and the page scrolls
 * under the finger. Acceptance scene on the RAF clock, seed 1, 1280×800, `hasTouch`, CDP touches
 * (e2e/touch.ts: no waitForFunction, no Log.enable).
 */
import { test, expect } from "./fixtures";
import { VIEWPORT } from "./projects";
import { DRAGGED, HOLD_MS, SLOT, STEPS, STEP_PX, centreOf, gotoTouchScene, longPressMove, probe, scrollY, slots, swipe, touch } from "./touch";

test.use({ viewport: { ...VIEWPORT }, hasTouch: true });

test.describe("W84 – touch and opt-out (canvas2d)", () => {
  test("D84-1 – given the Split pill when a finger holds it 350 ms and moves 120 px up then its liquid follows the finger, the page does not scroll, no pointercancel or intervention, and the release lets it go without a click", async ({ page }) => {
    const cdp = await gotoTouchScene(page, "canvas2d");
    const at = await centreOf(page, "#split");
    const run = await longPressMove(page, cdp, at, SLOT.split, true);
    console.log(`W84 long-press (canvas2d): scroll ${run.scroll.join(",")}; split ${JSON.stringify(run.mid[SLOT.split])}`);
    expect(run.mid[SLOT.split]!.interaction, "Split is dragged").toBe(DRAGGED);
    expect(run.mid[SLOT.split]!.homeDx).toBe(0);
    expect(run.mid[SLOT.split]!.homeDy, "the liquid follows the finger from where it rested").toBe(STEP_PX * STEPS);
    expect(Math.max(...run.scroll), "the page never scrolls during the drag").toBe(0);
    await touch(cdp, "touchEnd");
    await expect.poll(async () => (await slots(page))[SLOT.split]!.interaction, { timeout: 2_000 }).not.toBe(DRAGGED);
    await page.waitForTimeout(100);
    const p = await probe(page);
    expect(p.cancels, "the browser never took the gesture over").toBe(0);
    expect(p.interventions, "every touchmove was cancelable").toEqual([]);
    expect(p.clicks, "the release of a drag is no click").toBe(0);
    expect(await scrollY(page)).toBe(0);
  });

  test("D84-1 – given the card's heading when a finger holds it 350 ms and moves 120 px up then the card (its observed ancestor) is dragged and stays dragged until the release", async ({ page }) => {
    const cdp = await gotoTouchScene(page, "canvas2d");
    const at = await centreOf(page, "#card h2");
    const run = await longPressMove(page, cdp, at, SLOT.card, true);
    console.log(`W84 long-press on the card's heading (canvas2d): card ${JSON.stringify(run.mid[SLOT.card])}`);
    expect(run.mid[SLOT.card]!.interaction, "the heading's implicit touch capture moving to the card does not cancel the drag").toBe(DRAGGED);
    expect(run.mid[SLOT.card]!.homeDy).toBe(STEP_PX * STEPS);
    expect(Math.max(...run.scroll)).toBe(0);
    await touch(cdp, "touchEnd");
    await expect.poll(async () => (await slots(page))[SLOT.card]!.interaction, { timeout: 2_000 }).not.toBe(DRAGGED);
    expect((await probe(page)).cancels).toBe(0);
  });

  test("D84-1 – given the Split pill when a finger swipes 30 px up within 100 ms then the page scrolls and nothing is dragged, also after the long-press time", async ({ page }) => {
    const cdp = await gotoTouchScene(page, "canvas2d");
    const at = await centreOf(page, "#split");
    await swipe(page, cdp, at);
    await page.waitForTimeout(HOLD_MS + 200);
    const y = await scrollY(page);
    console.log(`W84 swipe (canvas2d): scrollY ${y}`);
    expect(y, "a swipe that starts on an observed element still scrolls").toBeGreaterThan(0);
    expect((await slots(page)).map((s) => s.interaction), "no drag").not.toContain(DRAGGED);
  });

  test("D84-1 – given the Splash pill when a finger taps it then exactly one click arrives and nothing is dragged", async ({ page }) => {
    const cdp = await gotoTouchScene(page, "canvas2d");
    const at = await centreOf(page, "#splash");
    await touch(cdp, "touchStart", at.x, at.y);
    await page.waitForTimeout(60);
    await touch(cdp, "touchEnd");
    await expect.poll(async () => (await probe(page)).clicks, { timeout: 2_000 }).toBe(1);
    await page.waitForTimeout(HOLD_MS);
    expect((await probe(page)).clicks, "one click (the splash)").toBe(1);
    expect((await slots(page)).map((s) => s.interaction)).not.toContain(DRAGGED);
  });

  test("D84-2 – given Split observed with drag false when a finger holds it and moves or the mouse drags it then its liquid never moves and the finger scrolls the page", async ({ page }) => {
    const cdp = await gotoTouchScene(page, "canvas2d", "&nodrag=split");
    expect(await page.evaluate(() => document.querySelector("#split")!.getAttribute("data-liquid-drag")), "the callout rule skips it (D84-5)").toBe("off");
    expect(await page.evaluate(() => document.querySelector("#merge")!.hasAttribute("data-liquid-drag"))).toBe(false);
    const at = await centreOf(page, "#split");
    const run = await longPressMove(page, cdp, at, SLOT.split, false);
    await touch(cdp, "touchEnd");
    console.log(`W84 drag false (canvas2d): scroll ${run.scroll.join(",")}`);
    expect(run.draggedSeen, "no touch drag").toBe(false);
    expect(Math.max(...run.scroll), "the browser scrolls under the finger as on any other element").toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => scrollY(page)).toBe(0);
    const c = await centreOf(page, "#split");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - 30, { steps: 5 });
    await page.waitForTimeout(50);
    const mid = await slots(page);
    await page.mouse.up();
    expect(mid[SLOT.split]!.interaction, "no mouse drag").not.toBe(DRAGGED);
  });
});
