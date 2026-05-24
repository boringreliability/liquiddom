// Ward 059: extract a marked block from a TypeScript source string.
//
// Used to display the "user-facing" portion of a showcase module on its
// page — the part between `/* @snippet:start */` and `/* @snippet:end */`
// markers. The page imports the module's source via Vite's `?raw` suffix
// and passes it here; the extracted text feeds Shiki at build time.
//
// Single source of truth: the displayed code IS the executed code. Markers
// rotting away or pointing at the wrong block is caught by the integrity
// test in `site/__tests__/showcase-build.test.ts`.

export function extractSnippet(src: string): string {
  const m = src.match(/\/\*\s*@snippet:start\s*\*\/([\s\S]*?)\/\*\s*@snippet:end\s*\*\//);
  if (!m) throw new Error("@snippet:start/@snippet:end markers missing");
  return m[1]!.trim();
}
