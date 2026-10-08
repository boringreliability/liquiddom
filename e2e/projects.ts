/**
 * W65: Playwright project routing, per-project `use` overrides and the web
 * server. Kept free of @playwright/test imports so vitest can assert it
 * (packages/core/__tests__/e2e-harness.test.ts); playwright.config.ts only wires it.
 */
export const VIEWPORT = { width: 1280, height: 800 } as const;

/** D65-2: fixed port for the e2e Vite server (the dev server keeps :3000). */
export const PORT = 4173;
export const BASE_URL = `http://localhost:${PORT}`;

/** W72 (harness): the page e2e/global-setup.ts loads before any test, so Vite's dependency optimiser runs first. */
export const WARMUP_PATH = "/scenes/acceptance.html?test=1&seed=1&renderer=canvas2d&clock=manual";
/** Loads of WARMUP_PATH before the warm-up gives up (only a navigation race is retried). */
export const WARMUP_ATTEMPTS = 3;
/** How long the warmed page must stay put (no optimiser reload) before the run starts. */
export const WARMUP_SETTLE_MS = 1_000;

/** True for the errors a page reload causes mid-call (Vite's optimiser reload); the warm-up retries only these. */
export function isNavigationRace(message: string): boolean {
  return /execution context was destroyed|frame was detached|net::ERR_ABORTED/i.test(message);
}
/** D65-2: demo/vite.config.ts unchanged; --strictPort fails fast instead of drifting to another port. */
export const WEB_SERVER_COMMAND = `npx vite --config demo/vite.config.ts demo --port ${PORT} --strictPort`;

/**
 * D65-2: environment for the web server. demo/vite.config.ts has `server.open: true`;
 * BROWSER=none stops Vite from opening a browser. Unset entries are dropped
 * (Playwright's webServer.env is Record<string, string>).
 */
export function webServerEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  env.BROWSER = "none";
  return env;
}

/** Spec §6 / D65-5: Chromium new headless + SwiftShader WebGPU. */
export const WEBGPU_LAUNCH_ARGS: readonly string[] = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-webgpu-adapter=swiftshader",
];

/** W71: Chromium on the machine's own GPU (Metal on Dennis' Mac); no SwiftShader flag. Local only, never in CI (`npm run e2e:webgpu-hw`). */
export const WEBGPU_HW_LAUNCH_ARGS: readonly string[] = ["--enable-unsafe-webgpu"];

/**
 * W71 (D71-1): the W71.0 SwiftShader spike answer (ward-071.md "Spike W71.0 result"), written
 * once here. true: CI's soft `webgpu` step runs every spec routed to `webgpu`; false (fallback
 * B): CI runs only the smoke and the liquid specs run locally in `webgpu-hw`. W72 routes its
 * robust spec by it; e2e-harness.test.ts ties it to the CI webgpu step.
 */
export const SWIFTSHADER_RUNS_LIQUID: boolean = false;

export const SMOKE_SPEC = /webgpu-smoke\.spec\.ts$/;
export const PERF_SPEC = /perf\.spec\.ts$/;
/** W69 (D69-2): local-only whole-picture recording; never run in CI. */
export const RECORD_SPEC = /record\.spec\.ts$/;
/** W69 (D69-6): browser smoke of the published core dist via examples/react (blocking). */
export const DIST_SPEC = /dist\.spec\.ts$/;
/** W71 (D71-3, Review Focus 4): the WebGPU liquid check page; webgpu project only. */
export const WEBGPU_LIQUID_SPEC = /webgpu-liquid\.spec\.ts$/;
/** W71 (D71-2): the webgpu project runs acceptance (steps 1–3 under renderer=webgpu), the liquid checks and the smoke. */
export const WEBGPU_PROJECT_SPEC = /(?:acceptance|webgpu-liquid|webgpu-smoke)\.spec\.ts$/;
/** W69 (D69-6): vite preview port for the dist smoke. 4173 is the demo server (D65-2) and Vite preview's default. */
export const DIST_PORT = 4174;
/** W69 (D69-6): the example whose `dist/` the dist smoke serves. */
export const DIST_EXAMPLE_ROOT = "examples/react";
/** Playwright's default testMatch restricted to this repo's convention. */
export const DEFAULT_SPEC = /\.spec\.ts$/;
/** W72 (D72-1 … D72-4): WebGPU by default, robust — steps 4, 6, 8 + device.lost under renderer=webgpu, and the auto probe. */
export const WEBGPU_ROBUST_SPEC = /webgpu-robust\.spec\.ts$/;

/** One RegExp matching any of `patterns` (ProjectFiles.testMatch takes a single RegExp). */
export function anyOf(...patterns: readonly RegExp[]): RegExp {
  return new RegExp(patterns.map((p) => `(?:${p.source})`).join("|"));
}

export type ProjectName = "canvas2d" | "webgpu" | "webgpu-hw" | "perf" | "record" | "dist" | "record-webgpu";
/** W71 (D71-2): the renderer a scene runs with. */
export type SceneRenderer = "canvas2d" | "webgpu";

export interface ProjectFiles {
  readonly name: ProjectName;
  readonly testMatch?: RegExp;
  readonly testIgnore?: readonly RegExp[];
  /** Blocking in CI (D65-3). */
  readonly blocking: boolean;
}

export const PROJECT_FILES: readonly ProjectFiles[] = [
  { name: "canvas2d", testIgnore: [SMOKE_SPEC, WEBGPU_LIQUID_SPEC, WEBGPU_ROBUST_SPEC, PERF_SPEC, RECORD_SPEC, DIST_SPEC], blocking: true },
  // W71 (D71-1, D71-2): acceptance steps 1–3 under renderer=webgpu, the liquid checks and the smoke.
  // Soft until 10 green CI runs in a row (spec §6); see the W71.0 spike result in ward-071.md.
  // W72: plus the robust spec when SwiftShader runs the liquid (W71.0 spike "yes"); soft until 10 green CI runs.
  { name: "webgpu", testMatch: SWIFTSHADER_RUNS_LIQUID ? anyOf(WEBGPU_PROJECT_SPEC, WEBGPU_ROBUST_SPEC) : WEBGPU_PROJECT_SPEC, blocking: false },
  // W71: the same specs on the machine's own GPU (Metal locally); local only, CI never names it.
  // W72: the robust spec always, and the webgpu perf log (D72-4); local only.
  { name: "webgpu-hw", testMatch: anyOf(WEBGPU_PROJECT_SPEC, WEBGPU_ROBUST_SPEC, PERF_SPEC), blocking: false },
  // C1 / D65-8: non-blocking perf recording (canvas2d renderer, RAF clock).
  { name: "perf", testMatch: PERF_SPEC, blocking: false },
  // W69 (D69-2): whole-picture recording, local only (`npm run whole-picture`).
  // CI never passes --project=record (whole-picture-tooling.test.ts).
  { name: "record", testMatch: RECORD_SPEC, blocking: false },
  // W69 (D69-6): published-dist smoke; the spec serves examples/react/dist on DIST_PORT.
  { name: "dist", testMatch: DIST_SPEC, blocking: true },
  // W72: local only, never in CI: the gold recording in WebGPU on the hardware adapter (`npm run record:w72`).
  { name: "record-webgpu", testMatch: RECORD_SPEC, blocking: false },
];

export interface ProjectUse {
  readonly channel?: "chromium";
  readonly launchArgs?: readonly string[];
  /** W69 (D69-2): Playwright video mode; set only for the local record project. */
  readonly video?: "on";
  /** W72: `false` runs headed (only if new headless gives no hardware adapter, W72.5 Step 8). */
  readonly headless?: boolean;
}

/** Per-project overrides on top of Desktop Chrome (playwright.config.ts `useFor`). */
export const PROJECT_USE: Readonly<Record<ProjectName, ProjectUse>> = {
  canvas2d: {},
  // D65-5: channel "chromium" = new headless (the default is headless-shell, which has no WebGPU).
  webgpu: { channel: "chromium", launchArgs: WEBGPU_LAUNCH_ARGS },
  // W71: new headless Chromium on the hardware adapter (no SwiftShader flag).
  "webgpu-hw": { channel: "chromium", launchArgs: WEBGPU_HW_LAUNCH_ARGS },
  // W72: the WebGPU gold recording, same flags as webgpu-hw, with video.
  "record-webgpu": { channel: "chromium", launchArgs: WEBGPU_HW_LAUNCH_ARGS, video: "on" },
  perf: {},
  // W69 (D69-2): video of every test; viewport and DPR stay desktopChrome (1280x800, DPR 1).
  record: { video: "on" },
  // W69 (D69-6): plain Desktop Chrome (headless shell); the dist smoke needs no WebGPU.
  dist: {},
};

/** W71 (D71-2): the renderer the scenes use in each project; only the webgpu project renders webgpu. */
export const PROJECT_RENDERER: Readonly<Record<ProjectName, SceneRenderer>> = {
  canvas2d: "canvas2d",
  webgpu: "webgpu",
  "webgpu-hw": "webgpu",
  perf: "canvas2d",
  record: "canvas2d",
  dist: "canvas2d",
  "record-webgpu": "webgpu",
};

/** Renderer for `test.info().project.name`; throws for a project this file does not define. */
export function rendererForProject(name: string): SceneRenderer {
  if (!Object.hasOwn(PROJECT_RENDERER, name)) throw new Error(`[e2e] unknown Playwright project "${name}"`);
  return PROJECT_RENDERER[name as ProjectName];
}

/** Which projects run a given spec file (same rules Playwright applies to testMatch/testIgnore). */
export function projectsForSpec(file: string): ProjectName[] {
  return PROJECT_FILES.filter((p) => {
    const match = p.testMatch ?? DEFAULT_SPEC;
    if (!match.test(file)) return false;
    return !(p.testIgnore ?? []).some((re) => re.test(file));
  }).map((p) => p.name);
}
