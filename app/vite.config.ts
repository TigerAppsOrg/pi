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
  environments: {
    // Client only. The worker build is left entirely to the Cloudflare plugin:
    // splitting that bundle would break the Durable Object entrypoint.
    client: {
      build: {
        target: "es2022",
        rollupOptions: {
          output: {
            // React barely changes between deploys; keeping it in its own
            // chunk means a route split (React.lazy in the pages) only ever
            // invalidates the small chunk that actually changed.
            manualChunks(id: string) {
              if (
                /node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)
              ) {
                return "react";
              }
              return undefined;
            },
          },
        },
      },
    },
  },
});
