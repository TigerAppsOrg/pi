#!/usr/bin/env python3
"""TIG-289: Cloudflare + Claude cost model for PI.

Every constant below is an assumption or a measurement. Change the ones at the
top and rerun; the tables regenerate. Prices are from
developers.cloudflare.com/workers/platform/pricing and
developers.cloudflare.com/durable-objects/platform/pricing (read 2026-10-29)
and app/src/server/usage.ts (Anthropic list prices the app itself bills with).
"""
import math

# ---- Cloudflare prices (Workers Paid, Standard usage model) ----------------
PAID_BASE_USD = 5.00
WORKER_REQ_INCL, WORKER_REQ_USD_PER_M = 10_000_000, 0.30
WORKER_CPU_MS_INCL, WORKER_CPU_USD_PER_M_MS = 30_000_000, 0.02
DO_REQ_INCL, DO_REQ_USD_PER_M = 1_000_000, 0.15
DO_GBS_INCL, DO_GBS_USD_PER_M = 400_000, 12.50
DO_STORAGE_GB_INCL, DO_STORAGE_USD_PER_GB = 5, 0.20
DO_ROWS_W_INCL, DO_ROWS_W_USD_PER_M = 50_000_000, 1.00
DO_ROWS_R_INCL, DO_ROWS_R_USD_PER_M = 25_000_000_000, 0.001
LOGS_INCL, LOGS_USD_PER_M = 20_000_000, 0.60
DO_MEMORY_GB = 0.125  # 128 MB billed per active DO regardless of use

# ---- Free plan daily limits -------------------------------------------------
FREE_WORKER_REQ_DAY = 100_000
FREE_DO_REQ_DAY = 100_000
FREE_DO_GBS_DAY = 13_000
FREE_DO_ROWS_W_DAY = 100_000
FREE_DO_STORAGE_GB = 5

# ---- Per-scenario constants (A = assumption, M = measured, C = from code) ---
# Worker requests that actually invoke the Worker. Static assets (/, js, css,
# fonts) are served from the asset cache and are free + unlimited (M: cf-cache-status HIT).
SESSION_WORKER_REQ = 5      # C: /auth/me, /api/workspaces, desk WS upgrade, chat WS upgrade, get-messages
SESSION_DO_REQ = 3          # C: desk WS connect, chat WS connect, get-messages fetch
SESSION_ROWS_READ = 60      # A: history + state + workspace rows on load
LOGIN_WORKER_REQ = 2        # C: /auth/login + /auth/callback, once per 7-day session cookie
TURNS_PER_SESSION = 4       # A
DAYS_PER_MONTH = 30

# Turn mix. Durations are wall-clock seconds the chat DO is active (A, to be
# replaced by durableObjectsPeriodicGroups once the token exists).
TURN_MIX = {
    # name: (share, active_seconds, model_steps)
    "short chat":          (0.60, 8.0, 1.2),
    "mcp-heavy chat":      (0.25, 30.0, 3.5),
    "long streaming chat": (0.15, 45.0, 2.0),
}
KEEPALIVE_S = 5             # C: agents keepAliveIntervalMs=5000, alarm while a turn runs
DESK_RPC_PER_TURN = 2       # C (branch feat/weekly-usage-limit only): usageStatus + usageRecord
WS_IN_PER_TURN = 1          # C: one incoming message per turn; outgoing stream is free
WS_BILL_RATIO = 20          # Cloudflare: incoming WS messages billed 20:1
ROWS_W_PER_TURN = 8         # A: 2 messages + tool parts + state + stream metadata + usage row
ROWS_R_PER_TURN = 80        # A: history reload + config + mcp rows per step
STORED_KB_PER_TURN = 6      # A: messages + tool results kept in the chat DO's SQLite
WORKER_CPU_MS_PER_REQ = 2   # A: cookie HMAC + routing; well under the 10 ms free-plan cap
LOG_EVENTS_PER_TURN = 6     # A: invocation logs + console lines + pi.usage line

# ---- Claude prices, USD per million tokens (C: usage.ts MODEL_PRICES) ------
CLAUDE = {
    "claude-opus-5":   dict(input=5, output=25, cacheRead=0.5),
    "claude-sonnet-5": dict(input=2, output=10, cacheRead=0.2),
}
# Per model step (A): 10k input tokens of which 70% hit the prompt cache, 400 output.
STEP_INPUT, STEP_CACHE_SHARE, STEP_OUTPUT = 10_000, 0.70, 400
WEEKLY_BUDGET_USD = 3 + 1   # C: USAGE_TIER1_USD + USAGE_TIER2_USD (branch only)


def turn_profile():
    secs = sum(s * d for s, d, _ in TURN_MIX.values())
    steps = sum(s * n for s, _, n in TURN_MIX.values())
    alarms = sum(s * math.ceil(d / KEEPALIVE_S) for s, d, _ in TURN_MIX.values())
    return secs, steps, alarms


def claude_cost_per_turn(model, steps):
    p = CLAUDE[model]
    fresh = STEP_INPUT * (1 - STEP_CACHE_SHARE)
    cached = STEP_INPUT * STEP_CACHE_SHARE
    per_step = (fresh * p["input"] + cached * p["cacheRead"] + STEP_OUTPUT * p["output"]) / 1e6
    return per_step * steps


def over(x, incl, usd_per_m, round_up_m=False):
    extra = max(0, x - incl)
    if round_up_m:
        extra = math.ceil(extra / 1e6) * 1e6
    return extra / 1e6 * usd_per_m


def month(mau, turns):
    secs, steps, alarms = turn_profile()
    T = mau * turns
    sessions = mau * max(1, turns / TURNS_PER_SESSION)
    logins = mau * math.ceil(DAYS_PER_MONTH / 7)
    worker_req = sessions * SESSION_WORKER_REQ + logins * LOGIN_WORKER_REQ + T * WS_IN_PER_TURN
    worker_cpu_ms = worker_req * WORKER_CPU_MS_PER_REQ
    do_req = (sessions * SESSION_DO_REQ
              + T * (WS_IN_PER_TURN / WS_BILL_RATIO + DESK_RPC_PER_TURN + alarms))
    do_gbs = T * secs * DO_MEMORY_GB
    rows_w = T * (ROWS_W_PER_TURN + alarms)   # each setAlarm is one row written
    rows_r = T * ROWS_R_PER_TURN + sessions * SESSION_ROWS_READ
    storage_gb = T * STORED_KB_PER_TURN / 1e6   # added this month, accumulates
    logs = T * LOG_EVENTS_PER_TURN + worker_req
    cf = (PAID_BASE_USD
          + over(worker_req, WORKER_REQ_INCL, WORKER_REQ_USD_PER_M)
          + over(worker_cpu_ms, WORKER_CPU_MS_INCL, WORKER_CPU_USD_PER_M_MS)
          + over(do_req, DO_REQ_INCL, DO_REQ_USD_PER_M)
          + over(do_gbs, DO_GBS_INCL, DO_GBS_USD_PER_M, round_up_m=True)
          + max(0, storage_gb - DO_STORAGE_GB_INCL) * DO_STORAGE_USD_PER_GB
          + over(rows_w, DO_ROWS_W_INCL, DO_ROWS_W_USD_PER_M)
          + over(rows_r, DO_ROWS_R_INCL, DO_ROWS_R_USD_PER_M)
          + over(logs, LOGS_INCL, LOGS_USD_PER_M))
    free_ok = (worker_req / DAYS_PER_MONTH <= FREE_WORKER_REQ_DAY
               and do_req / DAYS_PER_MONTH <= FREE_DO_REQ_DAY
               and do_gbs / DAYS_PER_MONTH <= FREE_DO_GBS_DAY
               and rows_w / DAYS_PER_MONTH <= FREE_DO_ROWS_W_DAY
               and storage_gb <= FREE_DO_STORAGE_GB)
    opus = T * claude_cost_per_turn("claude-opus-5", steps)
    sonnet = T * claude_cost_per_turn("claude-sonnet-5", steps)
    cap = mau * WEEKLY_BUDGET_USD * DAYS_PER_MONTH / 7
    return dict(mau=mau, turns=turns, worker_req=worker_req, do_req=do_req, do_gbs=do_gbs,
                rows_w=rows_w, rows_r=rows_r, storage_gb=storage_gb, logs=logs, cf=cf,
                free_ok=free_ok, opus=opus, sonnet=sonnet, cap=cap)


if __name__ == "__main__":
    secs, steps, alarms = turn_profile()
    print(f"Weighted turn: {secs:.1f} s active, {steps:.2f} model steps, {alarms:.2f} keep-alive alarms")
    print(f"Claude per turn: opus ${claude_cost_per_turn('claude-opus-5', steps):.4f}, "
          f"sonnet ${claude_cost_per_turn('claude-sonnet-5', steps):.4f}\n")
    hdr = ("MAU", "turns/u", "Worker req", "DO req", "DO GB-s", "rows W", "+GB/mo", "Free?", "CF $/mo", "Claude opus $", "Claude sonnet $", "budget cap $")
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for mau in (100, 1_000, 10_000):
        for turns in (5, 20, 100):
            r = month(mau, turns)
            print(f"| {r['mau']:,} | {r['turns']} | {r['worker_req']:,.0f} | {r['do_req']:,.0f} | {r['do_gbs']:,.0f} | "
                  f"{r['rows_w']:,.0f} | {r['storage_gb']:.2f} | {'yes' if r['free_ok'] else 'no'} | "
                  f"{r['cf']:.2f} | {r['opus']:,.0f} | {r['sonnet']:,.0f} | {r['cap']:,.0f} |")
