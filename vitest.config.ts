import { defineConfig } from "vitest/config";

// Vitest 4 workspace via `test.projects`. Each path is a glob that points at
// the project's vitest config. Replaces the legacy `vitest.workspace.ts` API.
export default defineConfig({
  test: {
    projects: [
      "./packages/core",
      "./packages/react",
      "./packages/vue",
      "./site",
    ],
  },
});
