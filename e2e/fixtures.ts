import { test as base, expect, type ConsoleMessage } from "@playwright/test";

/** Rust panics surface as console text or as an `unreachable` RuntimeError (W61 RCA). */
export const PANIC_PATTERN = /panicked at|recursive use of an object|RuntimeError: unreachable|unreachable executed/i;

export interface PageProblem {
  readonly kind: "console.error" | "pageerror" | "panic";
  readonly text: string;
}

export function describeProblems(problems: readonly PageProblem[]): string {
  return problems.length === 0
    ? "no page problems"
    : problems.map((p, i) => `#${i + 1} [${p.kind}] ${p.text}`).join("\n");
}

/** Every spec imports `test` from here: any console.error, pageerror or panic fails the test at teardown. */
export const test = base.extend<{ guard: PageProblem[] }>({
  guard: [
    async ({ page }, use) => {
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
      await use(problems);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      expect(problems, describeProblems(problems)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
