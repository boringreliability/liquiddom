import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "site",
    environment: "jsdom",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 60_000,  // build tests run astro build — give it room
  },
});
