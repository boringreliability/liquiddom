/**
 * Shared `?test=1` hook for demo scenes (W69), shape per skeleton §3.5:
 * window.__liquidTest = { ready, restAlpha, advance, cellPx, instance }.
 * These scenes run on the RAF clock; `advance` exists only for shape parity.
 * `cellPx` is the D69-5 ring-density read (grid cell px; ring spacing = cell / 2).
 *
 * The hook must exist synchronously at module evaluation (the e2e helper polls
 * `window.__liquidTest !== undefined`, then awaits `ready`), while the instance
 * only exists after the async `LiquidDOM.create()`. `installPendingSceneTestHook`
 * installs the hook up front and binds it when `started` resolves; before that,
 * `restAlpha()` is `[]` and `cellPx()` is NaN. `ready` rejects if `started` does.
 */
import type { LiquidDOMInstance } from "liquiddom";
import { cellPxOf, restAlphaOf } from "./_rest-state";

export interface SceneTestHook {
  ready: Promise<void>;
  restAlpha(): number[];
  advance(frames: number): void;
  cellPx(): number;
  instance: LiquidDOMInstance;
}

export interface SceneBinding {
  instance: LiquidDOMInstance;
  elements: readonly HTMLElement[];
}

export function installPendingSceneTestHook(started: Promise<SceneBinding>, sceneName: string): SceneTestHook {
  let bound: SceneBinding | undefined;
  // Two RAFs after binding: the first frame after create() has been ticked and rendered.
  const ready = started.then((b) => {
    bound = b;
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const hook = {
    ready,
    restAlpha: () => (bound === undefined ? [] : bound.elements.map((el) => restAlphaOf(bound!.instance, el))),
    advance: () => {
      throw new Error(`[${sceneName}] advance() needs ?clock=manual, which this scene does not support`);
    },
    cellPx: () => (bound === undefined ? Number.NaN : cellPxOf(bound.instance)),
    get instance(): LiquidDOMInstance {
      if (bound === undefined) throw new Error(`[${sceneName}] instance read before ready`);
      return bound.instance;
    },
  } satisfies SceneTestHook;
  (window as unknown as { __liquidTest: SceneTestHook }).__liquidTest = hook;
  return hook;
}

/** Install the hook for an already-created instance. */
export function installSceneTestHook(
  instance: LiquidDOMInstance,
  elements: readonly HTMLElement[],
  sceneName: string,
): SceneTestHook {
  return installPendingSceneTestHook(Promise.resolve({ instance, elements }), sceneName);
}
