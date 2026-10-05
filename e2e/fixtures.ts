import { test as base, type ConsoleMessage, type Page } from "@playwright/test";

/** Rust panics surface as console text or as an `unreachable` RuntimeError (W61 RCA). */
export const PANIC_PATTERN = /panicked at|recursive use of an object|RuntimeError: unreachable|unreachable executed/i;

/** Prefix of the error the guard throws; the guard self-tests assert on it. */
export const GUARD_MARKER = "liquid-guard: page problems detected";

export interface PageProblem {
  readonly kind: "console.error" | "pageerror" | "panic";
  readonly text: string;
}

export function describeProblems(problems: readonly PageProblem[]): string {
  return problems.length === 0
    ? "no page problems"
    : problems.map((p, i) => `#${i + 1} [${p.kind}] ${p.text}`).join("\n");
}

/** Throws (with GUARD_MARKER) when any problem was collected. */
export function assertNoProblems(problems: readonly PageProblem[]): void {
  if (problems.length > 0) throw new Error(`${GUARD_MARKER}:\n${describeProblems(problems)}`);
}

/** Starts collecting console.error / pageerror / panic text on `page`. */
export function attachGuard(page: Page): { problems: PageProblem[]; detach: () => void } {
  const problems: PageProblem[] = [];
  const onConsole = (msg: ConsoleMessage): void => {
    const text = msg.text();
    if (PANIC_PATTERN.test(text)) problems.push({ kind: "panic", text });
    else if (msg.type() === "error") problems.push({ kind: "console.error", text });
  };
  const onPageError = (err: Error): void => {
    const text = err.stack ?? `${err.name}: ${err.message}`;
    problems.push({ kind: PANIC_PATTERN.test(text) ? "panic" : "pageerror", text });
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    problems,
    detach: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/** Every spec imports `test` from here: any console.error, pageerror or panic fails the test at teardown. */
export const test = base.extend<{ guard: PageProblem[] }>({
  guard: [
    async ({ page }, use) => {
      const { problems, detach } = attachGuard(page);
      await use(problems);
      detach();
      assertNoProblems(problems);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
