/**
 * W65: Playwright project routing, per-project `use` overrides and the web
 * server. Kept free of @playwright/test imports so vitest can assert it
 * (packages/core/__tests__/e2e-harness.test.ts); playwright.config.ts only wires it.
 */
export const VIEWPORT = { width: 1280, height: 800 } as const;

/** D65-2: fixed port for the e2e Vite server (the dev server keeps :3000). */
export const PORT = 4173;
export const BASE_URL = `http://localhost:${PORT}`;
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

export const SMOKE_SPEC = /webgpu-smoke\.spec\.ts$/;
export const PERF_SPEC = /perf\.spec\.ts$/;
/** W69 (D69-2): local-only whole-picture recording; never run in CI. */
export const RECORD_SPEC = /record\.spec\.ts$/;
/** W69 (D69-6): browser smoke of the published core dist via examples/react (blocking). */
export const DIST_SPEC = /dist\.spec\.ts$/;
/** W69 (D69-6): vite preview port for the dist smoke. 4173 is the demo server (D65-2) and Vite preview's default. */
export const DIST_PORT = 4174;
/** W69 (D69-6): the example whose `dist/` the dist smoke serves. */
export const DIST_EXAMPLE_ROOT = "examples/react";
/** Playwright's default testMatch restricted to this repo's convention. */
export const DEFAULT_SPEC = /\.spec\.ts$/;

export type ProjectName = "canvas2d" | "webgpu" | "perf" | "record" | "dist";

export interface ProjectFiles {
  readonly name: ProjectName;
  readonly testMatch?: RegExp;
  readonly testIgnore?: readonly RegExp[];
  /** Blocking in CI (D65-3). */
  readonly blocking: boolean;
}

export const PROJECT_FILES: readonly ProjectFiles[] = [
  { name: "canvas2d", testIgnore: [SMOKE_SPEC, PERF_SPEC, RECORD_SPEC, DIST_SPEC], blocking: true },
  // C8 / D65-5: smoke only until slice 3 ships a WebGPU fluid renderer.
  { name: "webgpu", testMatch: SMOKE_SPEC, blocking: false },
  // C1 / D65-8: non-blocking perf recording (canvas2d renderer, RAF clock).
  { name: "perf", testMatch: PERF_SPEC, blocking: false },
  // W69 (D69-2): whole-picture recording, local only (`npm run whole-picture`).
  // CI never passes --project=record (whole-picture-tooling.test.ts).
  { name: "record", testMatch: RECORD_SPEC, blocking: false },
  // W69 (D69-6): published-dist smoke; the spec serves examples/react/dist on DIST_PORT.
  { name: "dist", testMatch: DIST_SPEC, blocking: true },
];

export interface ProjectUse {
  readonly channel?: "chromium";
  readonly launchArgs?: readonly string[];
  /** W69 (D69-2): Playwright video mode; set only for the local record project. */
  readonly video?: "on";
}

/** Per-project overrides on top of Desktop Chrome (playwright.config.ts `useFor`). */
export const PROJECT_USE: Readonly<Record<ProjectName, ProjectUse>> = {
  canvas2d: {},
  // D65-5: channel "chromium" = new headless (the default is headless-shell, which has no WebGPU).
  webgpu: { channel: "chromium", launchArgs: WEBGPU_LAUNCH_ARGS },
  perf: {},
  // W69 (D69-2): video of every test; viewport and DPR stay desktopChrome (1280x800, DPR 1).
  record: { video: "on" },
  // W69 (D69-6): plain Desktop Chrome (headless shell); the dist smoke needs no WebGPU.
  dist: {},
};

/** Which projects run a given spec file (same rules Playwright applies to testMatch/testIgnore). */
export function projectsForSpec(file: string): ProjectName[] {
  return PROJECT_FILES.filter((p) => {
    const match = p.testMatch ?? DEFAULT_SPEC;
    if (!match.test(file)) return false;
    return !(p.testIgnore ?? []).some((re) => re.test(file));
  }).map((p) => p.name);
}
