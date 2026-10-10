/**
 * W75 test helper: a thin adapter over W74's `TestFluidCore.forceRestAlpha`
 * (`_fluid-test-backend.ts`), so a runtime test can hold an element "moving" without reaching
 * for the core: the override applies to every core of the backend and survives ticks and
 * redistributes (W74's `pin()` reads it).
 */
import { createTestBackend, type TestBackend } from "./_fluid-test-backend";

export interface MovingBackend {
  readonly backend: TestBackend;
  /** `null` hands the element back to the test backend (restAlpha 1 while it has a rect). */
  setRestAlpha(id: number, value: number | null): void;
}

export function movingBackend(): MovingBackend {
  const backend = createTestBackend();
  return {
    backend,
    setRestAlpha(id, value) {
      for (const core of backend.cores) core.forceRestAlpha(id, value);
    },
  };
}
