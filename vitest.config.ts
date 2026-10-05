import { defineConfig } from "vitest/config";

// Vitest 4 multi-project run. `./site` is frozen during the fluid rewrite
// (W66, spec §5) and comes back in slice 6.
export default defineConfig({
  test: {
    projects: ["./packages/core", "./packages/react", "./packages/vue"],
  },
});
