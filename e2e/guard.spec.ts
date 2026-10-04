import { test, expect } from "./fixtures";

const PROBE = "<!doctype html><html><head><title>guard probe</title></head><body></body></html>";

test.describe("guard fixture (self-test)", () => {
  test("given a page that logs console.error when the guard fixture runs then the test fails", async ({ page }) => {
    test.fail(true, "the guard must turn a console.error into a failure at teardown");
    await page.setContent(PROBE);
    const seen = page.waitForEvent("console", (m) => m.type() === "error");
    await page.evaluate(() => console.error("guard-probe: console.error"));
    await seen;
  });

  test("given a page throwing pageerror when the guard fixture runs then the test fails", async ({ page }) => {
    test.fail(true, "the guard must turn an uncaught page error into a failure at teardown");
    await page.setContent(PROBE);
    const seen = page.waitForEvent("pageerror");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("guard-probe: pageerror");
      }, 0);
    });
    await seen;
  });

  test("given a page that logs a Rust panic message at info level when the guard fixture runs then the test fails", async ({ page }) => {
    test.fail(true, "panic text must fail the test even when it is not console.error");
    await page.setContent(PROBE);
    const seen = page.waitForEvent("console", (m) => m.text().includes("panicked at"));
    await page.evaluate(() => console.info("panicked at src/fluid/api.rs:1:1: guard probe"));
    await seen;
  });

  test("given a clean page when the guard fixture runs then the test passes", async ({ page, guard }) => {
    await page.setContent(PROBE);
    await page.evaluate(() => console.log("guard-probe: harmless log"));
    expect(guard).toEqual([]);
  });
});
