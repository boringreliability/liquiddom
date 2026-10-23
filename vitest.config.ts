import { defineConfig } from "vitest/config";

// Vitest 4 multi-project run.
// W86: the site is a project again (D86-8).
export default defineConfig({
  test: {
    projects: ["./packages/core", "./packages/react", "./packages/vue", "./site"],
  },
});
