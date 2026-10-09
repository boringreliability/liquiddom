// e2e/global.d.ts
import type { LiquidTestHook, StressReport, WebGpuLiquidHook, WebGpuModesHook, WebGpuSmokeResult } from "../demo/test-hooks";

declare global {
  interface Window {
    __liquidTest?: LiquidTestHook;
    __stress?: StressReport;
    __webgpuSmoke?: Promise<WebGpuSmokeResult>;
    __webgpuLiquid?: WebGpuLiquidHook;
    __webgpuModes?: WebGpuModesHook;
  }
}

export {};
