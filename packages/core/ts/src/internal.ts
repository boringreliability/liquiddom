/**
 * @internal W66 (D66-5). Maps a public LiquidDOMInstance to its FluidRuntime
 * so the demo scenes' test hooks can read element state and reach the core
 * (perf probe, stress report). Never exported from index.ts; the scenes import
 * this file by relative source path.
 */
import type { FluidRuntime } from "./runtime";

const runtimes = new WeakMap<object, FluidRuntime>();

export function bindRuntime(instance: object, runtime: FluidRuntime): void {
  runtimes.set(instance, runtime);
}

export function runtimeOf(instance: object): FluidRuntime | undefined {
  return runtimes.get(instance);
}
