import { test as plain, expect } from "@playwright/test";
import { test, attachGuard, assertNoProblems, GUARD_MARKER } from "./fixtures";

const PROBE = "<!doctype html><html><head><title>guard probe</title></head><body></body></html>";

/**
 * The self-tests use the un-guarded `plain` test plus attachGuard() directly, so the
 * assertion is on what the guard collected and on the error it throws (GUARD_MARKER),
 * not on "some failure happened".
 */
plain.describe("guard fixture (self-test)", () => {
  plain("given a page that logs console.error when the guard fixture runs then the test fails", async ({ page }) => {
    const { problems, detach } = attachGuard(page);
    await page.setContent(PROBE);
    const seen = page.waitForEvent("console", (m) => m.type() === "error");
    await page.evaluate(() => console.error("guard-probe: console.error"));
    await seen;
    detach();
    expect(problems.map((p) => p.kind)).toEqual(["console.error"]);
    expect(() => assertNoProblems(problems)).toThrow(GUARD_MARKER);
    expect(() => assertNoProblems(problems)).toThrow(/\[console\.error\] guard-probe: console\.error/);
  });

  plain("given a page throwing pageerror when the guard fixture runs then the test fails", async ({ page }) => {
    const { problems, detach } = attachGuard(page);
    await page.setContent(PROBE);
    const seen = page.waitForEvent("pageerror");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("guard-probe: pageerror");
      }, 0);
    });
    await seen;
    detach();
    expect(problems.map((p) => p.kind)).toEqual(["pageerror"]);
    expect(() => assertNoProblems(problems)).toThrow(GUARD_MARKER);
    expect(() => assertNoProblems(problems)).toThrow(/guard-probe: pageerror/);
  });

  plain("given a page that logs a Rust panic message at info level when the guard fixture runs then the test fails", async ({ page }) => {
    const { problems, detach } = attachGuard(page);
    await page.setContent(PROBE);
    const seen = page.waitForEvent("console", (m) => m.text().includes("panicked at"));
    await page.evaluate(() => console.info("panicked at src/fluid/api.rs:1:1: guard probe"));
    await seen;
    detach();
    expect(problems.map((p) => p.kind)).toEqual(["panic"]);
    expect(() => assertNoProblems(problems)).toThrow(GUARD_MARKER);
    expect(() => assertNoProblems(problems)).toThrow(/\[panic\] panicked at src\/fluid\/api\.rs/);
  });
});

test.describe("guard fixture (clean path)", () => {
  test("given a clean page when the guard fixture runs then the test passes", async ({ page, guard }) => {
    await page.setContent(PROBE);
    await page.evaluate(() => console.log("guard-probe: harmless log"));
    expect(guard).toEqual([]);
    expect(() => assertNoProblems(guard)).not.toThrow();
  });
});
