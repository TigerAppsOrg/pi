/**
 * What a chat turn costs in model spend. One turn is several model calls (one
 * per agent step), each resending the system prompt, the tool definitions and
 * the history, so the turn's bill is the sum over its steps. Pi adds each
 * step up as it finishes and logs one `pi.usage` line per turn, which is what
 * the cost analysis reads (Workers Logs parses JSON lines into fields).
 */

/** USD per million tokens, from Anthropic's price list. */
type Price = {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes, 1.25x input. */
  cacheWrite5m: number;
  /** 1-hour cache writes, 2x input. */
  cacheWrite1h: number;
};

export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
};

/** Anthropic's server-side web search: $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01;

/** Token counts summed over one turn's steps. */
export type TurnUsage = {
  steps: number;
  /** Input tokens billed at the full rate (not read from or written to cache). */
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** All output tokens, reasoning included. */
  output: number;
  reasoning: number;
  webSearches: number;
};

export function emptyTurnUsage(): TurnUsage {
  return {
    steps: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    output: 0,
    reasoning: 0,
    webSearches: 0,
  };
}

/**
 * The part of the AI SDK's step usage this reads. With the Anthropic
 * provider, `noCacheTokens`, `cacheReadTokens` and `cacheWriteTokens` are
 * Anthropic's `input_tokens`, `cache_read_input_tokens` and
 * `cache_creation_input_tokens`, and `raw` is Anthropic's own usage object.
 */
export type StepUsage = {
  inputTokens?: number | undefined;
  inputTokenDetails?: {
    noCacheTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  outputTokens?: number | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined };
  raw?: unknown;
};

const n = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Adds one finished step to the turn's running total. */
export function addStep(total: TurnUsage, usage: StepUsage | undefined): TurnUsage {
  const raw = (usage?.raw ?? {}) as {
    server_tool_use?: { web_search_requests?: unknown };
    cache_creation?: { ephemeral_1h_input_tokens?: unknown };
  };
  const cacheRead = n(usage?.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = n(usage?.inputTokenDetails?.cacheWriteTokens);
  // Anthropic splits cache writes by TTL only in its raw usage; anything it
  // doesn't mark as 1-hour is priced as the default 5-minute write.
  const cacheWrite1h = Math.min(cacheWrite, n(raw.cache_creation?.ephemeral_1h_input_tokens));
  const noCache = usage?.inputTokenDetails?.noCacheTokens;
  const input =
    noCache !== undefined
      ? n(noCache)
      : Math.max(0, n(usage?.inputTokens) - cacheRead - cacheWrite);
  return {
    steps: total.steps + 1,
    input: total.input + input,
    cacheRead: total.cacheRead + cacheRead,
    cacheWrite5m: total.cacheWrite5m + cacheWrite - cacheWrite1h,
    cacheWrite1h: total.cacheWrite1h + cacheWrite1h,
    output: total.output + n(usage?.outputTokens),
    reasoning: total.reasoning + n(usage?.outputTokenDetails?.reasoningTokens),
    webSearches: total.webSearches + n(raw.server_tool_use?.web_search_requests),
  };
}

/**
 * The turn's model spend in USD, or null for a model missing from
 * MODEL_PRICES, so an unpriced model shows up as a gap rather than as $0.
 */
export function costUsd(model: string, usage: TurnUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const tokens =
    usage.input * price.input +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite5m * price.cacheWrite5m +
    usage.cacheWrite1h * price.cacheWrite1h +
    usage.output * price.output;
  return tokens / 1_000_000 + usage.webSearches * WEB_SEARCH_USD;
}

/**
 * A stable, non-reversible id for a student in the logs, so the analysis can
 * see how usage spreads across people without the logs carrying NetIDs. Keyed
 * with a server secret because NetIDs are short enough to guess and hash.
 */
export async function pseudonym(netid: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || "pi-dev"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(netid)));
  return [...sig.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
