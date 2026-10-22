/**
 * W69 (D69-6): browser smoke of the published core `dist` (project `dist`, blocking in CI).
 * - examples/react is built by Vite against the workspace-linked `liquiddom`, which
 *   resolves to packages/core (`exports` → ./dist/index.js). The test verifies that a
 *   Vite consumer resolves the copy-wasm-rewritten `./wasm/` URL and that the wasm is
 *   served as `application/wasm`. Vite re-emits the asset, so this does not claim that
 *   `dist/wasm/` itself is served (W66 ward-review carry, M4).
 * - Build first: `npm run e2e:dist:build` (core clean → tsc → copy-wasm, the React
 *   adapter, then the example with --ignore-scripts; pkg/ must exist).
 * - The spec owns its server (Vite preview API on DIST_PORT), so the canvas2d,
 *   webgpu and perf runs never need the example build.
 * - W72: 'auto' probes WebGPU; in the headless shell it falls back to Canvas2D (one console.info).
 * The W65 guard fixture fails the test on any console.error, pageerror or panic.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { preview, type PreviewServer } from "vite";
import { test, expect } from "./fixtures";
import { DIST_EXAMPLE_ROOT, DIST_PORT, DIST_VUE_EXAMPLE_ROOT, DIST_VUE_PORT } from "./projects";

const ROOT = process.cwd();
const EXAMPLE = resolve(ROOT, DIST_EXAMPLE_ROOT);
const DIST_URL = `http://localhost:${DIST_PORT}/`;
const FALLBACK_INFO_PREFIX = "[liquiddom] WebGPU is not available";
const BUILT = [
  "packages/core/dist/index.js",
  "packages/core/dist/wasm-loader.js",
  "packages/core/dist/wasm/liquiddom_bg.wasm",
  "packages/react/dist/index.js",
  `${DIST_EXAMPLE_ROOT}/dist/index.html`,
] as const;

let server: PreviewServer | null = null;

test.beforeAll(async () => {
  // Blocking smoke: a missing build is a failure with a fix, never a skip.
  for (const rel of BUILT) {
    if (!existsSync(resolve(ROOT, rel))) throw new Error(`missing ${rel}: run \`npm run e2e:dist:build\` first`);
  }
  server = await preview({
    root: EXAMPLE,
    configFile: resolve(EXAMPLE, "vite.config.ts"),
    logLevel: "warn",
    // The example's server.open is true and preview.open inherits it; never open a browser.
    preview: { port: DIST_PORT, strictPort: true, open: false },
  });
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

test("given the React example built against the published core dist when served by vite preview then create() resolves, canvas.liquid-canvas exists, the wasm is fetched and no console error occurs", async ({ page }, testInfo) => {
  const wasm: Array<{ url: string; status: number; type: string }> = [];
  // W72 red: approved-test change (Dennis approves at W72 red): fallback-info assertions added
  // W72 (D72-1): the example uses the default renderer 'auto'. The dist project runs the
  // headless shell (no hardware WebGPU), so the instance falls back to Canvas2D with one
  // console.info, and the fallback remount still leaves exactly one canvas.liquid-canvas.
  const fallbackInfos: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "info" && m.text().startsWith(FALLBACK_INFO_PREFIX)) fallbackInfos.push(m.text());
  });
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.endsWith(".wasm")) {
      wasm.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] ?? "" });
    }
  });

  await page.goto(DIST_URL);
  // App.tsx sets data-liquid-ready once useLiquid() returns the instance, i.e. after create() resolved.
  await expect(page.locator("main[data-liquid-ready='true']")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator("canvas.liquid-canvas")).toHaveCount(1);
  expect(fallbackInfos.length, `fallback infos: ${fallbackInfos.join(" | ")}`).toBeLessThanOrEqual(1);
  testInfo.annotations.push({ type: "renderer", description: fallbackInfos.length === 1 ? "canvas2d (auto fallback)" : "webgpu (hardware adapter)" });
  await expect(page.locator(".liquid-element")).toHaveCount(2); // useLiquidRef pill + LiquidElement pill
  // W85 red: approved-test change (D85-5): the LiquidElement pill has drag={false}; the built adapter passes it to observe().
  await expect(page.locator('.liquid-element[data-liquid-drag="off"]')).toHaveCount(1);
  await expect(page.locator("[drag]"), "drag is consumed, never an attribute").toHaveCount(0);

  expect(wasm.length, "the published dist fetched its .wasm at runtime").toBeGreaterThan(0);
  for (const w of wasm) {
    expect(w.status, w.url).toBe(200);
    expect(w.type, `${w.url} MIME (instantiateStreaming needs application/wasm)`).toContain("application/wasm");
  }

  // Let ~30 frames run: a frame that throws logs one console.error (runtime.ts), which the guard catches.
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("dist-react-example.png") });
});

// =============================================================================
// W85 (D85-5): the Vue example (render functions, no SFC plugin) built against the published core
// and @liquiddom/vue dist, served on its own port.
// =============================================================================
const VUE_EXAMPLE = resolve(ROOT, DIST_VUE_EXAMPLE_ROOT);
const DIST_VUE_URL = `http://localhost:${DIST_VUE_PORT}/`;
const BUILT_VUE = ["packages/vue/dist/index.js", `${DIST_VUE_EXAMPLE_ROOT}/dist/index.html`] as const;

test.describe("W85 – the Vue example (D85-5)", () => {
  let vueServer: PreviewServer | null = null;

  test.beforeAll(async () => {
    for (const rel of BUILT_VUE) {
      if (!existsSync(resolve(ROOT, rel))) throw new Error(`missing ${rel}: run \`npm run e2e:dist:build\` first`);
    }
    vueServer = await preview({
      root: VUE_EXAMPLE,
      configFile: resolve(VUE_EXAMPLE, "vite.config.ts"),
      logLevel: "warn",
      preview: { port: DIST_VUE_PORT, strictPort: true, open: false },
    });
  });

  test.afterAll(async () => {
    await vueServer?.close();
    vueServer = null;
  });

  test("given the Vue example built against the published core and @liquiddom/vue dist when served by vite preview then create() resolves, one canvas.liquid-canvas, two observed pills (one drag off), the wasm is application/wasm and no console error occurs", async ({ page }, testInfo) => {
    const wasm: Array<{ url: string; status: number; type: string }> = [];
    const fallbackInfos: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "info" && m.text().startsWith(FALLBACK_INFO_PREFIX)) fallbackInfos.push(m.text());
    });
    page.on("response", (r) => {
      if (new URL(r.url()).pathname.endsWith(".wasm")) {
        wasm.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] ?? "" });
      }
    });

    await page.goto(DIST_VUE_URL);
    // App.ts sets data-liquid-ready once useLiquid().value is the instance, i.e. after create() resolved.
    await expect(page.locator("main[data-liquid-ready='true']")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator("canvas.liquid-canvas")).toHaveCount(1);
    expect(fallbackInfos.length, `fallback infos: ${fallbackInfos.join(" | ")}`).toBeLessThanOrEqual(1);
    testInfo.annotations.push({ type: "renderer", description: fallbackInfos.length === 1 ? "canvas2d (auto fallback)" : "webgpu (hardware adapter)" });
    await expect(page.locator(".liquid-element")).toHaveCount(2); // useLiquidRef pill + LiquidElement pill
    await expect(page.locator('.liquid-element[data-liquid-drag="off"]')).toHaveCount(1);
    await expect(page.locator("[drag]"), "drag is a prop, never an attribute").toHaveCount(0);
    await expect(page.locator("[role='alert']"), "no error state").toHaveCount(0);

    expect(wasm.length, "the published dist fetched its .wasm at runtime").toBeGreaterThan(0);
    for (const w of wasm) {
      expect(w.status, w.url).toBe(200);
      expect(w.type, `${w.url} MIME (instantiateStreaming needs application/wasm)`).toContain("application/wasm");
    }

    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath("dist-vue-example.png") });
  });
});
