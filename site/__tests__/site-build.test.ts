// Ward 058: build-output structure tests.
//
// Runs `astro build` once in beforeAll, then asserts the dist/ structure
// matches the spec. Red-phase: the build is expected to FAIL (astro not
// installed yet). Each test will surface the build error in its message,
// which is the right red signal.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE_ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(SITE_ROOT, "dist");

let buildSucceeded = false;
let buildError = "";

describe("Ward 058: site build output", () => {
  beforeAll(() => {
    try {
      execFileSync("npm", ["run", "build"], { cwd: SITE_ROOT, stdio: "pipe" });
      buildSucceeded = true;
    } catch (e) {
      buildError = e instanceof Error ? e.message : String(e);
    }
  }, 60_000);

  it("astro_site_builds", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    expect(existsSync(resolve(DIST, "index.html")), "index.html missing").toBe(true);
    expect(existsSync(resolve(DIST, "docs/index.html")), "docs/index.html missing").toBe(true);
    expect(existsSync(resolve(DIST, "docs/getting-started/index.html")), "getting-started missing").toBe(true);
    expect(existsSync(resolve(DIST, "docs/core-concepts/index.html")), "core-concepts missing").toBe(true);
  });

  it("landing_has_hero_and_install", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    // Hero headline (spec §5: "Physical DOM, without sacrificing accessibility")
    expect(html, "hero headline missing").toMatch(/Physical DOM/i);
    // Install snippet section
    expect(html, "install snippet missing").toContain("npm install");
    // References all three packages
    expect(html, "install snippet missing liquiddom").toContain("liquiddom");
    expect(html, "install snippet missing @liquiddom/react").toContain("@liquiddom/react");
    expect(html, "install snippet missing @liquiddom/vue").toContain("@liquiddom/vue");
  });

  it("every_page_has_renderer_toggle_markup", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    const pages = [
      "index.html",
      "docs/index.html",
      "docs/getting-started/index.html",
      "docs/core-concepts/index.html",
    ];
    for (const page of pages) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      expect(html, `${page} missing renderer toggle marker`).toContain("data-renderer-toggle");
    }
  });

  it("docs_pages_contain_zero_demo_markers", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    const docsPages = [
      "docs/index.html",
      "docs/getting-started/index.html",
      "docs/core-concepts/index.html",
    ];
    for (const page of docsPages) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      // W58 docs are demo-free by design — DemoEmbed lands in W59
      expect(html, `${page} should not contain demo markers in W58`).not.toMatch(
        /data-demo-embed|<demo-embed/i,
      );
    }
  });
});
