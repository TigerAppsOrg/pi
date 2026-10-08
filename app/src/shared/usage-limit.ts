/**
 * Each student's weekly model budget, in dollars. The tiers are copied from
 * PrincetonCourses' ask gateway (tiger-junction, apps/ask-gateway/app/
 * usage_tracker.py): $3.00 of Opus 5, then Sonnet 5 for another $1.00, then
 * nothing until spend frees up. PrincetonCourses resets every 8 hours; PI
 * keeps one rolling 7-day window instead, so each turn's cost stops counting
 * exactly a week after it was spent.
 */

export type Budget = {
  /** Spend allowed on any model, Opus included. */
  tier1Usd: number;
  /** Further spend allowed on Sonnet only, once tier 1 is used up. */
  tier2Usd: number;
  windowMs: number;
};

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_BUDGET: Budget = { tier1Usd: 3, tier2Usd: 1, windowMs: WEEK_MS };

/** The model a student drops to once their Opus budget is spent. */
export const TIER2_MODEL = "claude-sonnet-5";

/**
 * The dollar amounts can be changed per deploy (Worker vars) without a code
 * change. Anything unset, empty or not a non-negative number keeps the default.
 */
export function budgetFrom(env: {
  USAGE_TIER1_USD?: string;
  USAGE_TIER2_USD?: string;
}): Budget {
  const usd = (raw: string | undefined, fallback: number) => {
    const value = raw?.trim() ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    tier1Usd: usd(env.USAGE_TIER1_USD, DEFAULT_BUDGET.tier1Usd),
    tier2Usd: usd(env.USAGE_TIER2_USD, DEFAULT_BUDGET.tier2Usd),
    windowMs: WEEK_MS,
  };
}

/** One turn's model spend. */
export type Spend = { at: number; usd: number };

export type UsageStatus = {
  spentUsd: number;
  limitUsd: number;
  /** 1: any model. 2: Opus budget spent, Sonnet only. Exhausted: nothing left. */
  tier: 1 | 2 | "exhausted";
  blocked: boolean;
  percentUsed: number;
  /**
   * When enough old spend ages out to lift the student back up a tier (ms
   * since epoch), or null when nothing is being held back.
   */
  resetAt: number | null;
};

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

export function usageStatus(
  spends: Spend[],
  now: number,
  budget: Budget = DEFAULT_BUDGET
): UsageStatus {
  const live = spends
    .filter((s) => s.at > now - budget.windowMs && s.at <= now)
    .sort((a, b) => a.at - b.at);
  const spent = live.reduce((total, s) => total + s.usd, 0);
  const limit = budget.tier1Usd + budget.tier2Usd;
  const tier: UsageStatus["tier"] =
    spent < budget.tier1Usd ? 1 : spent < limit ? 2 : "exhausted";

  // The next tier up comes back once enough of the oldest spend has aged out
  // to drop the total below that tier's ceiling.
  const ceiling = tier === 2 ? budget.tier1Usd : tier === "exhausted" ? limit : null;
  let resetAt: number | null = null;
  if (ceiling !== null) {
    let remaining = spent;
    for (const s of live) {
      remaining -= s.usd;
      if (remaining < ceiling) {
        resetAt = s.at + budget.windowMs;
        break;
      }
    }
  }

  return {
    spentUsd: round(spent, 4),
    limitUsd: limit,
    tier,
    blocked: tier === "exhausted",
    percentUsed: limit > 0 ? Math.min(100, round((spent / limit) * 100, 1)) : 100,
    resetAt,
  };
}

/** "Tue, Oct 14, 3:10 PM", in Princeton's time zone. */
export function formatReset(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** What a student reads when a limit changes how PI answers them. */
export function limitNote(status: UsageStatus): string | null {
  const when = status.resetAt == null ? null : formatReset(status.resetAt);
  if (status.blocked) {
    return when
      ? `You've used this week's PI allowance. It frees up ${when}.`
      : "You've used this week's PI allowance.";
  }
  if (status.tier === 2) {
    return when
      ? `You've used this week's Opus budget, so PI is answering with Sonnet 5 until ${when}.`
      : "You've used this week's Opus budget, so PI is answering with Sonnet 5 for now.";
  }
  return null;
}
