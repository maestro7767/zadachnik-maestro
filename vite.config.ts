import { defineConfig } from "vite";

// base "./" нужен, чтобы сборка работала и в корне домена, и в подпапке GitHub Pages.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
