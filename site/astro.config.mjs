import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "https://liquiddom.vsplat.io",
  base: "/",
  trailingSlash: "always",
  markdown: { shikiConfig: { theme: "github-dark" } },
  vite: { plugins: [tailwindcss()], optimizeDeps: { exclude: ["liquiddom"] } },
});
