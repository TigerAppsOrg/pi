# PI — your Princeton desk

A lightweight Princeton chat agent with a stationery-themed UI (highlighters,
sticky notes, ink pens · Notion × Apple). One Cloudflare Worker serves both the
React app and the agent; there are no containers and no servers to warm up.

## Architecture

```
browser (React + useAgentChat over WebSocket)
   └─ Cloudflare Worker  (static assets + routeAgentRequest)
        └─ Pi Durable Object        · one instance per conversation
             extends @cloudflare/think  (agent loop, streaming, SQLite
             persistence, resumable streams, MCP tool auto-merge)
             └─ MCP v2 stateless streamable HTTP
                  └─ TigerApps junction engine (ENGINE_MCP_BASE)
                       /junction/mcp  /princetoncourses/mcp  /path/mcp  /snatch/mcp
```

- **Agent**: `src/server/pi.ts` — a `Think` subclass (from the
  [cloudflare/computer](https://github.com/cloudflare/computer) family; modeled
  on the `think` example minus its container backend). Workspace bash is off;
  chat history lives in each conversation's DO SQLite.
- **MCP**: each toggle on the *My apps* page maps 1:1 to a scoped engine
  endpoint. Connections use the MCP v2 client (`@modelcontextprotocol/client`
  2.x, stateless streamable HTTP). Identity travels as `x-user-netid` headers
  set per connection; changing netid reconnects everything.
- **Models**: Claude Opus 5 by default, with Sonnet 5 and a Workers AI
  fallback ("Campus") in the switcher. Claude models require the
  `ANTHROPIC_API_KEY` secret; without it every choice falls back to Campus.
- **Identity**: Princeton sign-in via Microsoft Entra ID (`src/server/auth.ts`
  — OIDC auth code + PKCE, confidential client, signed HttpOnly session
  cookie). netid is derived from the account email's local part; there is no
  way to choose one. Every agent Durable Object is named `u-<netid>-…` and
  the Worker rejects any request whose session doesn't own that prefix, so
  chats (messages *and* workspace files) are strictly per user. Requires the
  `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` vars plus `ENTRA_CLIENT_SECRET` and
  `SESSION_SECRET` secrets, and an app-registration redirect URI of
  `<origin>/auth/callback` for every origin the app is served from.
- **Planner**: mirrors TigerJunction's ReCal calendar — its default color
  palette, solid blocks with an ink left border for locked-in sections, and
  striped translucent blocks for section options not picked yet. The engine
  returns every section of every course, so the client merges duplicate
  times, marks single-time section types as confirmed, and recomputes
  conflicts among confirmed sections only.
- **UI**: `src/client/` — chat with inline tool renders, message actions
  (copy / rewind / fork / retry), a model switcher in the composer, a
  full-page weekly Planner, an Agenda, and My apps. Design system in
  `src/client/styles.css`; official TigerApps logos in `public/logos/`.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in secrets as needed
npm run dev
```

`npm run typecheck` needs `worker-configuration.d.ts` — generate it with
`npx wrangler types` (CI does this automatically).

The Workers AI "Campus" model runs remotely even in dev, so wrangler needs
Cloudflare credentials (`wrangler login`, or `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID`). The Claude path only needs `ANTHROPIC_API_KEY` in
`.dev.vars`.

## Deploy

Pushes to `main` deploy automatically via GitHub Actions
(`.github/workflows/ci.yml`), which expects `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets. Manual deploys:

```bash
npm run deploy
npx wrangler secret put ANTHROPIC_API_KEY    # enables the Claude models
npx wrangler secret put ENTRA_CLIENT_SECRET  # Entra app registration secret
npx wrangler secret put SESSION_SECRET       # any long random string
```

Config knobs (in `wrangler.jsonc`): `ENGINE_MCP_BASE` (engine base URL) and
the optional `ENGINE_MCP_TOKEN` secret if the engine ever requires a bearer
token.

## Notes

- `turndown` is aliased to a stub in `vite.config.ts` — it top-level-requires
  a CJS DOM shim that fails Workers validation, and it's only reachable
  through just-bash's `html-to-markdown`, which PI doesn't use (bash is
  disabled).
- Stage-3 decorators (`@callable`) need `esbuild.target: "es2022"` so dev
  matches the production transform.
- `useAgentChat` suspends while loading history — keep chat pages under a
  `<Suspense>` boundary.
