import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const FILE = resolve(__dirname, "../../.github/workflows/deploy-site.yml");

describe("W86: deploy-site.yml (D86-7)", () => {
  it("given_deploy_site_yml_when_read_then_dispatch_only_and_it_builds_and_uploads_the_site", () => {
    const text = readFileSync(FILE, "utf-8");
    expect(text).not.toMatch(/FROZEN|slice 6|Do NOT dispatch/i);
    const doc = parse(text) as { on: Record<string, unknown>; jobs: { deploy: { steps: { run?: string; uses?: string; with?: Record<string, string> }[] } } };
    expect(Object.keys(doc.on)).toEqual(["workflow_dispatch"]);
    const steps = doc.jobs.deploy.steps;
    const runs = steps.map((s) => s.run ?? "");
    expect(runs).toContain("npm ci");
    expect(runs).toContain("npm run build:wasm");
    expect(runs).toContain("npm run e2e:site:build");
    const upload = steps.find((s) => s.uses?.startsWith("actions/upload-pages-artifact"));
    expect(upload?.with?.path).toBe("site/dist");
    expect(steps.some((s) => s.uses?.startsWith("actions/deploy-pages"))).toBe(true);
  });
});
