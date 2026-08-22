import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Transpile stage-3 decorators (used by agents' `@callable`) in dev too —
  // workerd can't parse the raw syntax.
  esbuild: { target: "es2022" },
  resolve: {
    alias: {
      // turndown top-level-requires a CJS dom shim, which fails Workers
      // validation. Only reachable via just-bash, and PI disables bash.
      turndown: fileURLToPath(
        new URL("./src/server/turndown-stub.ts", import.meta.url)
      ),
    },
  },
});
