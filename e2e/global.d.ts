// e2e/global.d.ts
import type { LiquidTestHook, LongPageHook, ScrollContainerHook, ShadowsHook, StressReport, TiltHook, UnderPageHook, WebGpuLiquidHook, WebGpuModesHook, WebGpuSmokeResult } from "../demo/test-hooks";

declare global {
  interface Window {
    __liquidTest?: LiquidTestHook;
    __stress?: StressReport;
    __webgpuSmoke?: Promise<WebGpuSmokeResult>;
    __webgpuLiquid?: WebGpuLiquidHook;
    __webgpuModes?: WebGpuModesHook;
    __scrollContainer?: ScrollContainerHook;
    __longPage?: LongPageHook;
    __underPage?: UnderPageHook;
    __tilt?: TiltHook;
    __shadows?: ShadowsHook;
  }
}

export {};
