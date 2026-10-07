// e2e/global.d.ts
import type { LiquidTestHook, StressReport, WebGpuLiquidHook, WebGpuSmokeResult } from "../demo/test-hooks";

declare global {
  interface Window {
    __liquidTest?: LiquidTestHook;
    __stress?: StressReport;
    __webgpuSmoke?: Promise<WebGpuSmokeResult>;
    __webgpuLiquid?: WebGpuLiquidHook;
  }
}

export {};
