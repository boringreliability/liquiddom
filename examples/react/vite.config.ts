import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    open: true,
  },
  optimizeDeps: {
    // Don't pre-bundle the core liquiddom module — it loads WASM dynamically.
    exclude: ["liquiddom"],
  },
});
