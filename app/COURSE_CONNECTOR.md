# Princeton course connector

PI can supply Princeton course tools to a student's existing assistant through
authenticated remote MCP at `/mcp`. The assistant runs the conversation and
model inference under its own account limits. This path does not use PI's
Anthropic key, import memories, or share PI chat history.

## Student setup

After deployment, open **My apps → Use Princeton course tools in Claude** in PI.
Add the URL shown there as a custom connector in Claude, then complete Princeton
sign-in and consent. On the normal production origin the URL is
`https://pi.tigerapps.org/mcp`. That address is a deployment target, not a claim
that this branch is already live.

The default permission reads courses, sections, reviews, requirements, and the
student's saved TigerJunction and TigerPath plans. A separate, unchecked option
allows saved-plan changes. Grants can be disconnected at `/connect`.
PI's existing app switches govern PI chat. Connector grants are managed
separately, and signing out of PI does not revoke them.

Example request

> Help me choose courses for next semester. I'm a COS student in the class of
> 2029 interested in systems and quant development. Ask which degree I'm pursuing
> and which prerequisites I've completed. Compare available courses, workload,
> reviews, requirements, and section times. Give me alternatives before saving
> anything.

An optional `plan_semester` MCP prompt accepts the student's goal and constraints.
Claude's current remote-connector instructions and account restrictions are
documented in its [custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
Compatibility with other MCP clients must be tested individually.

## What is exposed

The connector filters live tool definitions through an explicit allowlist.
Overlapping upstream tool catalogs cannot change a tool's designated source.

| Source | Read access | Optional changes |
| --- | --- | --- |
| TigerJunction | Catalog search, details, sections, terms, departments, comparisons, enrollment statistics, own schedules, upstream schedule screening | Create or rename a saved schedule, add or remove a course |
| PrincetonCourses | Course evaluations, review summaries, instructor information | None |
| TigerPath | Degree requirement trees, aggregate planning statistics, own four-year plan | Add or remove a course in a semester |

The baseline engine provides 24 allowlisted read tools and 5 optional write tools.
With the published-data engine extension and three local public/coverage tools,
the connector offers up to 30 read tools. Whole-schedule
deletion, seat alerts, TigerHub registration, Canvas, calendar access, and PI
workspaces are excluded. A saved plan is not a transcript or actual enrollment.

The upstream `verify_schedule` tool screens a proposed course set. It does not
prove that a complete combination of lecture, precept, and lab sections is
feasible, verify completed prerequisites, or certify degree completion. The
assistant instructions explicitly preserve those distinctions.

## Authentication and deployment

The existing CAS login establishes the NetID. The connector adds OAuth
authorization code flow with required PKCE S256, dynamic client registration,
audience-bound access tokens, refresh, and revocation through
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider).
Consent uses the library's browser-bound transaction plus a signed binding to
the displayed CAS identity. An account switch cannot silently authorize the
old consent page as a different student.

Required deployment configuration

- `SESSION_SECRET` must be the existing PI signing secret.
- `APP_ORIGIN` must be the canonical HTTPS origin, also allowed by Princeton CAS.
- `OAUTH_KV` stores client registrations, grants, and tokens. The Wrangler config
  declares a draft binding. Before the first production deployment, provision
  or select the production namespace and record its ID in `wrangler.jsonc`.
  Wrangler also supports provisioning at deployment when the deploy credential
  has the required KV permissions. Reuse the namespace on later deploys.
- `ENGINE_MCP_BASE` selects the trusted TigerApps backend. `ENGINE_MCP_TOKEN` is
  sent only to that backend. Production must enforce its service credential
  before trusting `x-user-netid`, and must enforce ownership for schedule IDs.
  This connector authenticates its own callers. It does not secure a separately
  exposed engine that accepts arbitrary identity headers.

The Worker routes `/mcp`, `/connect/*`, and OAuth discovery before SPA assets.
Ordinary PI routes do not depend on connector KV lookups. MCP requests never
forward a caller's cookies, bearer token, or identity headers to the engine.
Upstream sessions are per operation and deleted after use. Redirects are rejected.

Access tokens last one hour. Refresh grants expire after 30 days. Revocation
uses Workers KV and is subject to its propagation delay. It cannot remove data
already received by a third-party assistant. CIMD is explicitly disabled for
this first version. OAuth dynamic registration is supported instead.

## Verification

Run the repository's normal checks from `app`

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler types
npm run typecheck
npm test
npm run build
```

Do not overwrite an existing configured `.dev.vars` file. The copy step above
is for a fresh checkout. Local development uses local KV and a separate session
secret, with `APP_ORIGIN` matching the local server.

`course-mcp.test.ts` uses actual MCP clients and transports. `course-oauth.test.ts`
runs the production connector handlers in workerd via Miniflare with local KV
and a mocked engine, covering sign-in return, consent, PKCE, scope enforcement,
refresh, identity isolation, revocation ownership, and upstream session cleanup.
It does not contact student accounts or modify real plans.

A read-only live smoke check on November 19, 2026 discovered all 24 read tools,
read the COS-BSE class-of-2029 requirement tree, and retrieved COS 217 evaluations
and Fall 2026 sections.
The live catalog listed terms only through Fall 2026. Spring 2027 COS 217 search
returned no courses and its sections lookup returned an explicit missing-course
error despite the tool descriptions mentioning Spring 2027. Missing coverage is
not proof that the course will not be offered. The connector's instructions
require the assistant to report that gap instead of substituting an older term.

Production CAS-to-Claude authorization, real personal-plan ownership enforcement,
and saved-plan changes still require an authorized staging check. No production
deployment or real plan mutation is part of these local checks.

## Published data and coverage

The connector now includes three local read tools independently of engine catalog
availability. `get_course_data_status(term)` checks the imported catalog, the live
published-term source and the CS department fallback. It does not read a student's
plans. `get_cs_course_schedule(term)` reads the official department page for that
exact semester, and rejects a page that silently selects a different term.
`search_prince_articles(query, page)` searches the Daily Princetonian public site,
returning bounded excerpts with source identity, article dates and canonical URLs.
This is not Clio and does not access its database, newsletters, retrieval service,
credentials or chats. Publication date, fetch time and unknown ingestion history
are separate fields. Public fetches send neither NetID nor session credentials.

A companion engine change exposes `list_published_terms`,
`search_published_courses` and `get_published_course` on the junction MCP scope.
These read Princeton's authenticated OIT course API directly and do not require a
completed database import. Deploy that change and configure the engine's existing
`CONSUMER_KEY`/`CONSUMER_SECRET` (preferred) or `API_ACCESS_TOKEN`. PI does not receive
those credentials. Without that deployment/configuration, only the CS fallback
and public Prince search are independently available. Imported search results and
saved-plan validation may still be stale. Do not claim the database was refreshed.

Successful public reads are cached for at most five minutes per process/isolate,
with fetch timestamps and bounded cache sizes. Errors are not empty catalogs.
A working source is not proof it covers every department or the requested term.
The CS page provides course-level meetings, not every precept or lab; missing or
ambiguous times stay unknown. Prince reporting cannot establish degree policy or
current section availability. Ratings remain historical and a saved plan is not
a transcript. No automatic import, production mutation or registration is added.

Local live checks on November 26, 2026 retrieved Spring 2027 COS 217 with
`MW 10:40 - 11:30` and dated Prince search results. The existing production engine
still returned only seven terms through Fall 2026 and no Spring 2027 COS results.
The authenticated engine reads have fixture tests, but require a deployed smoke
check with valid OIT credentials before university-wide coverage can be claimed.

Reproduce the read-only live public-source check from `app` with
`npx tsx scripts/smoke-current-course-data.ts 1274`. It uses the real MCP transport
with a local test identity, without production sessions or saved-plan writes.

### PI-only requests

The MCP instructions tell the host assistant to honor a student's PI-only request,
use the connector's own source tools and report gaps instead of silently switching
to web search or browser control. Official pages fetched server-side by PI remain
PI tool calls. An absent saved plan is not an empty transcript. These are assistant
instructions, not an access-control mechanism for the host's other tools. PI
cannot disable a separately enabled Chrome connector or verify that the host
complied. Strict tool isolation must be enforced in the host client.
