/**
 * W69 (D69-2): scene-step budgets read from the canonical scene, .wdd/NORTH-STAR.md.
 * The step-3 re-form budget is the D67-1 outcome (3 s under options 1/2,
 * 1.5 s under options 3/4), so the recording and the whole-picture report never
 * hard-code it. Pure string parsing: no fs and no @playwright/test, so vitest
 * (whole-picture-tooling.test.ts, wdd-docs.test.ts) imports it as well.
 */
export const NORTH_STAR_PATH = ".wdd/NORTH-STAR.md";

/** NORTH-STAR uses a heading; spec §6 uses a bold label before the same list. */
const STEP_LIST_STARTS: readonly string[] = ["### Scene steps", "**Scene steps:**"];
/** The first bold seconds value after "within" in a step line, e.g. "within **3 s**". */
const BUDGET = /within \*\*(\d+(?:\.\d+)?) s\*\*/;

/** The `N. …` line of scene step `step`, from the first scene-steps list in `md`. */
export function sceneStepLine(md: string, step: number): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => STEP_LIST_STARTS.includes(l.trim()));
  if (start === -1) throw new Error("no scene steps list (### Scene steps / **Scene steps:**)");
  const prefix = `${step}. `;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.startsWith(prefix)) return line;
  }
  throw new Error(`scene step ${step} not found`);
}

/** Re-form budget of a scene step in milliseconds. Throws when the step names none. */
export function reformBudgetMs(md: string, step: number): number {
  const line = sceneStepLine(md, step);
  const seconds = Number(BUDGET.exec(line)?.[1] ?? Number.NaN);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`scene step ${step} has no re-form budget: ${line}`);
  }
  return Math.round(seconds * 1000);
}
