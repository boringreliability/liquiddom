// Ward 058: deploy workflow validation.
//
// Asserts `.github/workflows/deploy-site.yml` exists and contains the contract
// documented in spec §8. String-match based (no YAML parser dependency added).
// Red-phase: the workflow file does not exist yet — test fails on first assertion.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github/workflows/deploy-site.yml");

describe("Ward 058: deploy workflow", () => {
  it("deploy_workflow_exists_and_is_valid", () => {
    expect(existsSync(WORKFLOW_PATH), `${WORKFLOW_PATH} must exist`).toBe(true);

    const raw = readFileSync(WORKFLOW_PATH, "utf8");

    // Triggers on push to master only (no PR trigger — spec §8)
    expect(raw, "missing 'on: push' trigger").toMatch(/^on:\s*\n\s*push:/m);
    expect(raw, "must target master branch").toMatch(/branches:\s*\[\s*master\s*\]|-\s*master/);

    // Must NOT trigger on PRs (spec §8 + Must NOT)
    expect(raw, "deploy workflow must not trigger on pull_request").not.toMatch(/^\s*pull_request:/m);

    // Permissions for GitHub Pages
    expect(raw, "missing pages: write permission").toMatch(/pages:\s*write/);
    expect(raw, "missing id-token: write permission").toMatch(/id-token:\s*write/);

    // Path filter includes site/** (the obvious change-trigger)
    expect(raw, "path filter must include site/**").toContain("site/**");

    // Uses official deploy-pages action v4
    expect(raw, "must use actions/deploy-pages@v4").toContain("actions/deploy-pages@v4");

    // Builds the site
    expect(raw, "must build the site workspace").toMatch(/build\s+-w\s+@liquiddom\/site|@liquiddom\/site/);
  });
});
