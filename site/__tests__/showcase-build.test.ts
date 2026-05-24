// Ward 059: showcase pages build output structure.
//
// Reuses the W58 pattern: one beforeAll that runs `astro build`, then assertions
// against the produced HTML. Red-phase: showcase pages don't exist yet, so the
// build SUCCEEDS (W58 pages still build) but the new routes are missing — each
// route-existence check fails individually.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE_ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(SITE_ROOT, "dist");

let buildSucceeded = false;
let buildError = "";

// File-level beforeAll: runs ONCE per worker process, before any describe.
// Both the W59 showcase tests AND the W60 landing tests below depend on the
// same dist/ output — sharing the build keeps the test suite fast.
beforeAll(() => {
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE_ROOT, stdio: "pipe" });
    buildSucceeded = true;
  } catch (e) {
    buildError = e instanceof Error ? e.message : String(e);
  }
}, 60_000);

describe("Ward 059: showcase build output", () => {
  it("site_builds_with_showcase_routes", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    expect(existsSync(resolve(DIST, "showcases/squish/index.html")), "squish page missing").toBe(true);
    expect(existsSync(resolve(DIST, "showcases/fusion/index.html")), "fusion page missing").toBe(true);
  });

  it("showcase_pages_have_demo_embed", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    for (const page of ["showcases/squish/index.html", "showcases/fusion/index.html"]) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      expect(html, `${page} missing data-demo-embed`).toContain("data-demo-embed");
    }
  });

  it("demo_embed_renders_shiki_highlighted_code", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    // Shiki always wraps the rendered code in a `<pre>` with class `astro-code`
    // (Astro's bundled highlighter) or `shiki` (raw shiki). Either marker
    // confirms syntax highlighting actually ran at build time. Searching raw
    // HTML string is robust against future token re-wrapping in inner spans.
    for (const page of ["showcases/squish/index.html", "showcases/fusion/index.html"]) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      expect(html, `${page} missing Shiki <pre> marker`).toMatch(
        /<pre[^>]*class="[^"]*(?:astro-code|shiki)[^"]*"/,
      );
    }
  });

  it("demo_embed_renders_powered_by_badge", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    for (const page of ["showcases/squish/index.html", "showcases/fusion/index.html"]) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      expect(html, `${page} missing data-powered-by`).toContain("data-powered-by");
    }
  });

  it("demo_embed_renders_reset_button", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    for (const page of ["showcases/squish/index.html", "showcases/fusion/index.html"]) {
      const html = readFileSync(resolve(DIST, page), "utf8");
      expect(html, `${page} missing data-demo-reset`).toContain("data-demo-reset");
    }
  });

  it("snippet_in_dist_html_contains_expected_identifiers", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    // Guard file existence first so red-phase failure mode is a named Vitest
    // assertion rather than a noisy ENOENT exception from readFileSync.
    const squishPath = resolve(DIST, "showcases/squish/index.html");
    const fusionPath = resolve(DIST, "showcases/fusion/index.html");
    expect(existsSync(squishPath), "squish page missing").toBe(true);
    expect(existsSync(fusionPath), "fusion page missing").toBe(true);

    // Shiki wraps each token in `<span>` elements AND in TS grammar splits
    // `LiquidDOM.create` into two spans on the `.` token boundary. So a raw
    // substring search against the HTML fails. Strip tags first; then the
    // plain text reads as the canonical source code.
    const stripTags = (html: string): string => html.replace(/<[^>]+>/g, "");

    const squishText = stripTags(readFileSync(squishPath, "utf8"));
    expect(squishText, "squish missing LiquidDOM.create").toContain("LiquidDOM.create");
    expect(squishText, "squish missing impulse").toContain("impulse");

    const fusionText = stripTags(readFileSync(fusionPath, "utf8"));
    expect(fusionText, "fusion missing LiquidDOM.create").toContain("LiquidDOM.create");
    expect(fusionText, "fusion missing fusionRadius").toContain("fusionRadius");
  });
});

// ── Ward 060 landing-page build assertions ──
//
// Lives in this file (not a new one) so we share the W59 `beforeAll` astro
// build. With `fileParallelism: false` in `site/vitest.config.ts`, multiple
// test files each running their own `astro build` would serialize but still
// duplicate the work — costly. Same file → same beforeAll → one build.
describe("Ward 060: landing build output", () => {
  it("landing_has_live_hero", () => {
    expect(buildSucceeded, `build failed: ${buildError}`).toBe(true);
    const landingPath = resolve(DIST, "index.html");
    expect(existsSync(landingPath), "landing page missing").toBe(true);
    const html = readFileSync(landingPath, "utf8");
    // Marker for the LiveHero component's root element
    expect(html, "landing missing data-live-hero").toContain("data-live-hero");
    // Behind-content positioning: -z-10 class or equivalent negative z-index
    expect(html, "live hero must sit behind hero text (-z-10)").toMatch(/-z-10|z-index:\s*-/);
  });

  // Note: `landing_has_try_it_now` test was REMOVED in W60 r3 (post-gold-vision).
  // Two simultaneous `LiquidDOM` instances on the landing trigger a wasm-bindgen
  // recursion panic from the Rust core. TryItNow disabled until the multi-instance
  // bug is fixed (W61). Re-introduce this test when TryItNow is re-enabled.
});
