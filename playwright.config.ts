import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import {
  BASE_URL,
  PROJECT_FILES,
  PROJECT_USE,
  VIEWPORT,
  WEB_SERVER_COMMAND,
  webServerEnv,
  type ProjectName,
} from "./e2e/projects";

/** CI runs each project in its own invocation (D65-3); E2E_SUITE keeps outputs apart. */
const SUITE = process.env.E2E_SUITE ?? "local";

const desktopChrome = {
  ...devices["Desktop Chrome"],
  viewport: { ...VIEWPORT },
  deviceScaleFactor: 1,
};

/** Desktop Chrome plus the per-project overrides asserted in e2e/projects.ts (D65-5). */
function useFor(name: ProjectName): NonNullable<PlaywrightTestConfig["use"]> {
  const o = PROJECT_USE[name];
  return {
    ...desktopChrome,
    ...(o.channel ? { channel: o.channel } : {}),
    ...(o.launchArgs ? { launchOptions: { args: [...o.launchArgs] } } : {}),
    // W69 (D69-2): record project only; the video has the viewport size.
    ...(o.video ? { video: { mode: o.video, size: { ...VIEWPORT } } } : {}),
  };
}

export default defineConfig({
  testDir: "e2e",
  outputDir: `test-results/${SUITE}`,
  // D65-2: Linux-only baselines, one directory per spec file.
  snapshotPathTemplate: "e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide", scale: "css" },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: `playwright-report/${SUITE}` }]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", colorScheme: "light" },
  webServer: {
    // D65-2: --strictPort and BROWSER=none (demo/vite.config.ts has `open: true`).
    command: WEB_SERVER_COMMAND,
    url: `${BASE_URL}/scenes/acceptance.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: webServerEnv(process.env),
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: PROJECT_FILES.map((p) => ({
    name: p.name,
    ...(p.testMatch ? { testMatch: p.testMatch } : {}),
    ...(p.testIgnore ? { testIgnore: [...p.testIgnore] } : {}),
    use: useFor(p.name),
  })),
});
