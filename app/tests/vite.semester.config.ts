import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react()],
  worker: { format: "iife" },
  build: {
    outDir: "dist/semester-preview",
    assetsInlineLimit: 1000000,
    rollupOptions: {
      input: "tests/semester-lab.html",
      output: { inlineDynamicImports: true },
    },
  },
});
