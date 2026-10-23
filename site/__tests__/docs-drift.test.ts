import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { OPTION_KEYS } from "../../packages/core/ts/src/options";

const SITE = resolve(__dirname, "..");
const DOCS = resolve(SITE, "src/pages/docs");
const INTERNAL_OPTIONS = ["testBackend", "loader", "clock", "webgpuT0Scale"];
const read = (p: string) => readFileSync(p, "utf-8");

function instanceMembers(): string[] {
  const src = read(resolve(SITE, "../packages/core/ts/src/index.ts"));
  const body = src.slice(src.indexOf("export interface LiquidDOMInstance {"));
  const block = body.slice(0, body.indexOf("\n}\n"));
  return [...block.matchAll(/^ {2}(?:readonly )?(\w+)[(:?]/gm)].map((m) => m[1]);
}

describe("W86: docs (D86-6)", () => {
  it("given_the_api_page_when_read_then_every_public_create_option_is_documented", () => {
    const api = read(resolve(DOCS, "api.md"));
    for (const key of OPTION_KEYS.filter((k) => !INTERNAL_OPTIONS.includes(k))) expect(api, key).toContain("`" + key + "`");
  });

  it("given_the_api_page_when_read_then_every_instance_member_is_documented", () => {
    const api = read(resolve(DOCS, "api.md"));
    const members = instanceMembers();
    expect(members).toEqual(expect.arrayContaining(["observe", "splash", "setGravity", "requestOrientationPermission", "activeRenderer"]));
    for (const m of members) expect(api, m).toContain("`" + m);
  });

  it("given_the_docs_folder_when_listed_then_five_pages_with_layout_and_title", () => {
    const pages = readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();
    expect(pages).toEqual(["accessibility.md", "adapters.md", "api.md", "getting-started.md", "limitations.md"]);
    for (const p of pages) {
      const fm = read(resolve(DOCS, p)).split("---")[1] ?? "";
      expect(fm, p).toMatch(/^layout: \.\.\/\.\.\/layouts\/DocsLayout\.astro$/m);
      expect(fm, p).toMatch(/^title: .+$/m);
    }
  });
});
