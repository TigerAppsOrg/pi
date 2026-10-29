# TIG-289: PI Cloudflare cost under traffic estimates

Measurement note, 2026-10-29. Author: Aikhan Jumashukurov. Status: model, synthetic test and 30 days of live Cloudflare analytics done (section 7). Claude spend is still unmeasured because the Anthropic key on hand is a user key, not an Admin key (section 7.4).

Headline: the account is on the **Workers Free plan**, PI has used about 0.06% of one day's free Worker quota and 0.0004% of one day's free Durable Object duration over the whole month, and the Cloudflare bill at 10,000 monthly users would still be about $5 to $31. Claude API tokens are the real cost, 5 to 1,700× larger in every scenario.

Everything in this note is reproducible from `docs/cost/cost_model.py` and the commands in section 8. Each number is tagged **M** (measured), **C** (read from code or config), or **A** (assumption to be replaced by a measurement).

## 1. What the deployed system actually bills for

Read from `app/wrangler.jsonc`, `app/src/server/*.ts`, and the `agents` 0.21.0 / `@cloudflare/think` 0.16.0 packages.

- One Worker (`pi`) serves the SPA and the API. Static assets (`/`, `/assets/*`, fonts, icons) are served from the Workers Assets cache and are **free and unlimited**. Only `/agents/*`, `/auth/*`, `/oauth/*`, `/api/*` run the Worker (`run_worker_first`). **C**, confirmed **M** by `cf-cache-status: HIT` on `/` and `/assets/index-*.js`.
- **Two Durable Objects per user, not one.** Every chat is a `Pi` DO named `u-<netid>-<chatId>`, and every user also has a `u-<netid>-desk` DO that holds workspaces, Google Calendar tokens, the weekly spend ledger and the MCP connections for the planner and agenda pages. The client opens a WebSocket to the desk on every page and a second one to the chat on chat pages. **C**
- **WebSockets hibernate.** The agents SDK sets `Agent.options = { hibernate: true }`, so an open tab costs no DO duration while idle. Duration is billed only while a turn runs. **C**
- **Keep-alive alarms during turns.** While a turn is running the SDK schedules an alarm every 5 s (`keepAliveIntervalMs: 5000`). Each alarm is one DO request and one row written. A 30 s turn is 6 extra DO requests. **C**
- **MCP connections are opened per turn and released after it** (`releaseIdleMcp`), so DOs can hibernate between turns. The ticket's architecture line about persistent MCP connections is out of date. **C**
- **Workers AI is not used.** The `AI` binding is still declared in `wrangler.jsonc`, but the Campus model was retired on 2026-09-01 (commit d4fbae7) and nothing in `src/` references `env.AI`. Workers AI spend is $0. The binding can be deleted. **C**
- **Claude spend is only logged on an unmerged branch.** `feat/weekly-usage-limit` (commits 0c15eee, bfbc63a) adds one `pi.usage` JSON log line per turn with token counts and USD, plus a $3 + $1 weekly per-student budget. Production (`main` at ba172c3, deployed 2026-09-28) has neither. Until that branch ships, Claude spend can only be read from the Anthropic console, not from Workers Logs. **C**
- `observability.enabled: true`, so every Worker invocation and every `console.log` is a Workers Logs event (20M/month included on Paid). **C**
- Ticket correction: the account ID appears twice in the ticket with different spellings. The one from Wrangler, `e2744783298a24185adfbc07174ba2ae`, is the one to use. The second (`...adfbc0714ba2ae`) is missing a character.

## 2. Conversation scenarios

Per-scenario counts of what Cloudflare bills. Worker requests exclude static assets.

| Scenario | Worker requests | DO requests | DO active time | Rows written | Notes |
|---|---|---|---|---|---|
| First load + auth (new 7-day session) | 2 login (`/auth/login`, `/auth/callback`) + 5 (`/auth/me`, `/api/workspaces`, desk WS, chat WS, get-messages) | 3 (desk connect, chat connect, get-messages) | under 1 s | 0 | CAS validation is a subrequest, free. Login is once per 7 days per device. **C** |
| Short chat turn | 1 incoming WS message (billed as 1/20 DO request) | 1/20 + 2 desk RPCs (branch only) + 2 alarms | 8 s **A** | 8 + 2 alarms **A** | 1 to 2 model steps, no tools |
| Long streaming chat turn | same | 1/20 + 2 + 9 alarms | 45 s **A** | 8 + 9 | Outgoing stream chunks are free. `chatStreamStallTimeoutMs` caps a stuck turn at 120 s |
| Reconnect / history | 2 (WS upgrade, get-messages) | 2 | under 1 s | 0 | Rows read = messages in the chat |
| MCP-heavy turn | same as a turn | 1/20 + 2 + 6 alarms | 30 s **A** | 8 + 6 | MCP calls to TigerJunction are subrequests, free, limit 1,000 per invocation. `maxSteps = 12` bounds the worst case |

Weighted turn used in the model (60% short, 25% MCP-heavy, 15% long): 19.1 s active, 1.9 model steps, 4.05 keep-alive alarms.

Traffic grid: 100 / 1,000 / 10,000 monthly active users with 5 / 20 / 100 turns per user per month, 4 turns per session, 30 days.

## 3. Synthetic test (bounded, non-destructive)

Run 2026-10-29 18:04 UTC from a laptop whose nearest Cloudflare edge was LHR/CDG. Sequential requests, 250 ms apart, no auth cookie, so no Durable Object was created and nothing was written. Raw samples are in `docs/cost/raw/`.

| Path | n | Status | Serves from | TTFB median | TTFB p95 | TTFB max |
|---|---|---|---|---|---|---|
| `/` | 30 | 200 | asset cache (HIT), free | 362 ms | 461 ms | 475 ms |
| `/assets/index-BpSCtlsg.js` | 5 | 200 | asset cache (HIT), free | 366 ms | 426 ms | 426 ms |
| `/auth/me` | 30 | 401 | Worker, billed | 579 ms | 1,227 ms | 1,369 ms |
| `/api/workspaces` | 20 | 401 | Worker, billed | 381 ms | 1,000 ms | 1,227 ms |
| `/agents/pi/u-zzz-probe` | 1 | 401 | Worker, billed | 765 ms | | |

What it shows: the SPA shell and bundles never touch the Worker. The 401 paths are the Worker alone (cookie check, no DO), and their p95 above 1 s is worth a look in Workers Logs once the token exists, since those requests do almost no work. Total requests sent: 86.

## 4. Prices used

Cloudflare, read 2026-10-29 from the Workers and Durable Objects pricing pages.

| Item | Free plan | Workers Paid ($5/month minimum) |
|---|---|---|
| Worker requests | 100,000/day | 10M/month included, then $0.30 per million |
| Worker CPU | 10 ms per invocation | 30M CPU-ms/month included, then $0.02 per million CPU-ms |
| Static asset requests | free | free |
| DO requests | 100,000/day | 1M/month included, then $0.15 per million |
| DO duration | 13,000 GB-s/day | 400,000 GB-s/month included, then $12.50 per million GB-s, overage rounded up to the next million |
| DO SQLite storage | 5 GB total | 5 GB-month included, then $0.20 per GB-month |
| DO rows written | 100,000/day | 50M/month included, then $1.00 per million |
| DO rows read | 5M/day | 25B/month included, then $0.001 per million |
| Workers Logs | 200,000 events/day, 3-day retention | 20M/month included, then $0.60 per million, 7-day retention |

Billing rules that matter here: duration is wall-clock seconds while the DO is active, at 128 MB regardless of real memory, so GB-s = seconds × 0.125. Hibernated objects are not billed. Incoming WebSocket messages count as 1/20 of a request, outgoing messages are free. Each `setAlarm` is one row written and each alarm firing is one request. Every RPC call to a DO stub is one request.

Claude, USD per million tokens, from `app/src/server/usage.ts`: Opus 5 input 5 / output 25 / cache read 0.5. Sonnet 5 input 2 / output 10 / cache read 0.2.

## 5. Formulas

For MAU users, t turns per user per month, T = MAU × t turns, S = MAU × max(1, t / 4) sessions, L = MAU × 5 logins:

```
worker_requests = 5 S + 2 L + T
worker_cpu_ms   = 2 × worker_requests                       (A)
do_requests     = 3 S + T × (1/20 + 2 + alarms)             alarms = 4.05 weighted
do_gb_s         = T × 19.1 s × 0.125
rows_written    = T × (8 + alarms)
rows_read       = 80 T + 60 S
storage_added   = T × 6 KB                                  (accumulates month over month)
log_events      = 6 T + worker_requests

cloudflare_usd  = 5 + overage(worker_requests, 10M, 0.30/M)
                    + overage(worker_cpu_ms, 30M, 0.02/M)
                    + overage(do_requests, 1M, 0.15/M)
                    + ceil_to_million(overage(do_gb_s, 400k)) × 12.50/M
                    + max(0, storage_gb − 5) × 0.20
                    + overage(rows_written, 50M, 1.00/M)
                    + overage(rows_read, 25B, 0.001/M)
                    + overage(log_events, 20M, 0.60/M)

claude_usd_per_turn = steps × (3,000 × input + 7,000 × cache_read + 400 × output) / 1e6
                    = $0.054 on Opus 5, $0.022 on Sonnet 5 at 1.9 steps      (A: 10k input/step, 70% cached, 400 output)
budget_cap_usd      = MAU × $4/week × 30/7                    (C, branch only)
```

## 6. Results

Output of `python3 docs/cost/cost_model.py`:

| MAU | turns/user | Worker req | DO req | DO GB-s | rows written | storage added | fits Free? | Cloudflare $/mo | Claude $ (all Opus) | Claude $ (all Sonnet) | weekly-budget cap $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 5 | 2,125 | 3,425 | 1,191 | 6,025 | 0.00 GB | yes | 5.00 | 27 | 11 | 1,714 |
| 100 | 20 | 5,500 | 13,700 | 4,762 | 24,100 | 0.01 GB | yes | 5.00 | 108 | 43 | 1,714 |
| 100 | 100 | 23,500 | 68,500 | 23,812 | 120,500 | 0.06 GB | yes | 5.00 | 540 | 216 | 1,714 |
| 1,000 | 5 | 21,250 | 34,250 | 11,906 | 60,250 | 0.03 GB | yes | 5.00 | 270 | 108 | 17,143 |
| 1,000 | 20 | 55,000 | 137,000 | 47,625 | 241,000 | 0.12 GB | yes | 5.00 | 1,080 | 432 | 17,143 |
| 1,000 | 100 | 235,000 | 685,000 | 238,125 | 1,205,000 | 0.60 GB | yes | 5.00 | 5,401 | 2,160 | 17,143 |
| 10,000 | 5 | 212,500 | 342,500 | 119,062 | 602,500 | 0.30 GB | yes | 5.00 | 2,700 | 1,080 | 171,429 |
| 10,000 | 20 | 550,000 | 1,370,000 | 476,250 | 2,410,000 | 1.20 GB | no (duration) | 17.56 | 10,802 | 4,321 | 171,429 |
| 10,000 | 100 | 2,350,000 | 6,850,000 | 2,381,250 | 12,050,000 | 6.00 GB | no | 31.08 | 54,008 | 21,603 | 171,429 |

Reading the table:

- Cloudflare is flat $5/month for every scenario up to about 1,000 MAU at 100 turns, and $31/month at the top of the grid. The first thing that leaves the included quota is **DO duration** (keep-alive alarms and the 128 MB-per-active-second rule), then DO requests. Worker requests and CPU never get close to their quotas because the SPA is served from the asset cache.
- "Fits Free?" uses monthly averages. Princeton traffic is spiky (course selection, midterms), so a day with 3 to 5× the average load will hit the free plan's 13,000 GB-s/day duration cap at roughly 300 to 1,000 concurrent heavy users. On the free plan an exceeded cap means failed requests, not a bill.
- **Claude spend is 5 to 1,700× Cloudflare spend** in every cell. It is the only number that matters for budgeting. Prompt caching share and model choice swing it 2.5× (Opus vs Sonnet). The weekly per-student budget on `feat/weekly-usage-limit` caps the worst case at $17.14 per student per month, which is what actually bounds the bill.
- Storage accumulates. 10,000 MAU at 100 turns adds 6 GB per month, so the 5 GB-month included allowance is passed in month one and costs $0.20 per extra GB-month after that. Cheap, but worth a retention policy for old chats eventually.

## 7. Measured account usage, 30 days (2026-09-29 to 2026-10-29)

Read with the `aikhan-read-key` Cloudflare token (expires 2027-01-06) through the GraphQL Analytics API and the REST API. Raw responses are in `docs/cost/raw/cloudflare-analytics-2026-10-29.json`. Worker and DO invocation datasets are sampled ("Adaptive"), so those sums are estimates; the periodic DO dataset is exact.

### 7.1 What PI used

| Metric | 30-day total | Source |
|---|---|---|
| Worker requests (Worker-invoked only) | ~550 (530 success, 20 client disconnected), 0 errors | `workersInvocationsAdaptive` |
| Worker subrequests | ~90 | same |
| Worker CPU per request | p50 0.4 to 2.5 ms, p99 up to 5.5 ms | same |
| DO requests | 186 (152 success, 33 client disconnected, 1 stream disconnected) | `durableObjectsInvocationsAdaptiveGroups` |
| DO active time | 11.07 s total = **1.38 GB-s** | `durableObjectsPeriodicGroups` |
| DO CPU time | 1.53 s | same |
| DO WebSocket messages | 341 outbound, 0 inbound counted, max 2 concurrent connections | same |
| DO errors (CPU, memory, fatal) | 0 | same |
| Durable Objects in the `pi_Pi` namespace | **209**, all with stored data | REST `durable_objects/namespaces/.../objects` |
| Stored bytes | not reported (storage dataset returned no rows; row read/write units reported as 0) | `durableObjectsStorageGroups` |
| Days with any DO activity | 3 (Sep 29, Oct 8, Oct 10) | periodic dataset |
| Live deployment | 100% on `1f195035-8a7c-49dc-aa02-d8aeb6a2a412`, created 2026-09-28T17:53Z, confirms the ticket | `wrangler deployments list` |
| Plan | **Workers Free**. The account's subscriptions are Teams Free plus four zone Free plans; there is no Workers Paid subscription | REST `accounts/.../subscriptions` |

Oct 8 is the day Ibraheem and I tested the app (127 DO requests, 7.2 s active). Every other day is near zero. The 209 objects are roughly 150 to 200 chats plus one desk per user who has signed in, so the stored-data footprint is in the low megabytes at most.

The Worker request days after Oct 10 with zero DO requests are unauthenticated hits (bots, health checks, and this note's 86 probes on Oct 29), which the Worker answers with a 401 before any DO is touched.

### 7.2 Remaining quota

Against the Workers Free plan the account is actually on, per day, using the busiest day in the window (Oct 8):

| Quota | Free daily cap | Busiest day | Used |
|---|---|---|---|
| Worker requests | 100,000 | ~90 | 0.09% |
| Worker CPU per invocation | 10 ms | p99 5.5 ms | fine, but 55% of the cap on the worst request |
| DO requests | 100,000 | 127 | 0.13% |
| DO duration | 13,000 GB-s | 0.90 GB-s | 0.007% |
| DO rows written | 100,000 | not reported | unknown, certainly under 1% |
| SQLite storage | 5 GB total | not reported, 209 objects | unknown, estimated under 50 MB |

Against the Workers Paid monthly allowances, had the account been on Paid: 0.006% of the 10M requests, 0.02% of the 1M DO requests, 0.0003% of the 400,000 GB-s. In other words the entire month fits in the included quota about 5,000 times over.

### 7.3 Refitting the model

The sample is too small to refit the per-turn constants: 186 DO requests over three days of activity is a handful of conversations, and the periodic dataset does not split active time per turn. Two things it does confirm: DO active time per DO request averages 60 ms (11.07 s / 186), which means most DO requests are connects, history loads and alarms rather than long model streams, and the Worker's own CPU cost is 1 to 2 ms per request as assumed. The **A** constants in `cost_model.py` stay as the planning numbers until conversation tests generate a real sample; refit with `active seconds per turn = activeTime / turns` and `alarms per turn = DO requests / turns − 2.05` from the same two queries.

### 7.4 Claude spend: still unmeasured

The Anthropic key shared on 2026-10-08 authenticates as the TigerApps organization but is a user API key. The usage and cost report endpoints (`/v1/organizations/usage_report/messages`, `/v1/organizations/cost_report`) answer `401 The Admin API requires an Admin API key or an organization-scoped API key`. To read spend for the PI key we need either an Admin API key (`sk-ant-admin…`, created under Organization settings → Admin keys) or a screenshot of the console's Usage page filtered to the PI key. The branch's `pi.usage` log line is the long-term answer.

### 7.5 Token notes

- The Cloudflare token is not least-privilege. Its first policy includes `Workers Admin`, `Workers Scripts Write`, `Workers Editor`, `Workers Observability Write` and more. It can deploy. This note only used it for reads. Recommend replacing it with a token holding exactly: Account → Workers Scripts: Read, Account → Account Analytics: Read, Account → Workers Observability: Read, Account → Workers Tail: Read. Billing: Read is not needed; the subscriptions endpoint answered without it.
- Both tokens were pasted in a Discord DM. They should be rotated after this ticket closes.

### 7.6 Queries used

```bash
export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=e2744783298a24185adfbc07174ba2ae
cd app && npx wrangler deployments list --name pi && npx wrangler versions list --name pi
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/durable_objects/namespaces/25152952642f43d79bea3c4bec4b7450/objects?limit=1000" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/subscriptions" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

GraphQL at `https://api.cloudflare.com/client/v4/graphql`, header `Authorization: Bearer $CLOUDFLARE_API_TOKEN`. Note that `durableObjectsPeriodicGroups` and `durableObjectsStorageGroups` take `date_geq` and do not accept `scriptName`:

```graphql
{ viewer { accounts(filter: {accountTag: "e2744783298a24185adfbc07174ba2ae"}) {
  workersInvocationsAdaptive(filter: {scriptName: "pi", datetime_geq: "2026-09-29T00:00:00Z"}, limit: 1000, orderBy: [date_ASC])
    { dimensions { date } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 } }
  durableObjectsInvocationsAdaptiveGroups(filter: {scriptName: "pi", datetime_geq: "2026-09-29T00:00:00Z"}, limit: 1000)
    { dimensions { date namespaceId status } sum { requests errors responseBodySize } quantiles { wallTimeP50 wallTimeP99 } }
  durableObjectsPeriodicGroups(filter: {date_geq: "2026-09-29"}, limit: 1000, orderBy: [date_ASC])
    { dimensions { date namespaceId } sum { activeTime cpuTime storageReadUnits storageWriteUnits inboundWebsocketMsgCount outboundWebsocketMsgCount exceededCpuErrors exceededMemoryErrors fatalInternalErrors } max { activeWebsocketConnections } }
  durableObjectsStorageGroups(filter: {date_geq: "2026-09-29"}, limit: 1000) { dimensions { date } max { storedBytes } }
} } }
```

`activeTime` and `cpuTime` are microseconds. DO GB-s = activeTime / 1e6 × 0.125.

## 8. Reproduce

```bash
# model
python3 docs/cost/cost_model.py

# synthetic probe (bounded, unauthenticated, no DO is touched)
O=https://pi.tigerapps.org
for p in / /auth/me /api/workspaces; do for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code} %{time_starttransfer} %{time_total}\n" "$O$p"; sleep 0.25; done; done
curl -sI $O/ | grep -i cf-cache-status      # expect HIT: asset, free
```

## 9. Recommendation

**Stay on Workers Free for the conversation tests, move to Workers Paid at $5/month before any real launch.** Today the account is on Free and is using well under 1% of every daily cap, so the planned conversation tests cost nothing and cannot hit a limit unless they run thousands of long turns in one day. Free stops being safe at launch because of the daily caps, not the monthly totals: a burst of long turns during a busy week trips the 13,000 GB-s per day Durable Object duration cap (about 1,000 concurrent heavy users for an hour) and the 100,000 rows-written-per-day cap, and on Free that means dropped turns rather than a bill. Paid removes the daily caps, lifts the 10 ms CPU limit the Worker's p99 already sits halfway to, extends Workers Logs retention from 3 to 7 days (needed to actually read `pi.usage`), and stays at the $5 minimum until roughly 1,000 MAU at 100 turns.

Before scaling conversation tests:

1. Merge `feat/weekly-usage-limit`. It is the only thing that bounds the real bill (Claude), and it is what makes Claude spend measurable per turn in Workers Logs.
2. Get an Anthropic Admin API key or a console screenshot for the PI key (section 7.4) so the Claude side of the budget has a measured baseline. Everything on the Cloudflare side is now measured.
3. After the conversation tests, rerun the two DO queries in 7.6 and replace the **A** constants in `cost_model.py` with the observed active seconds per turn, alarms per turn, and stored bytes per chat.
4. Decide whether a 5 s keep-alive alarm is needed. It is the single largest DO request and row-write driver (4 of every 6 DO requests per turn). Raising `keepAliveIntervalMs` to 15 s cuts DO requests and rows written by about half with no effect on streaming.
5. Remove the unused `AI` binding from `wrangler.jsonc`, replace the broad `aikhan-read-key` token with the four read scopes in 7.5, and rotate both keys that were shared over Discord.
