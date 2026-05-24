// Ward 059: extractSnippet utility tests.

import { describe, it, expect } from "vitest";
import { extractSnippet } from "../src/lib/snippet";

describe("Ward 059: extractSnippet", () => {
  it("extract_snippet_parses_marked_block", () => {
    const src = "// foo\n/* @snippet:start */\nconst x = 1;\n/* @snippet:end */\n// bar";
    expect(extractSnippet(src)).toBe("const x = 1;");
  });

  it("extract_snippet_throws_on_missing_markers", () => {
    expect(() => extractSnippet("no markers anywhere")).toThrow(/markers missing/);
  });
});
