import type { LanguageModelMiddleware } from "ai";

/**
 * Anthropic prompt caching for every Claude call PI makes.
 *
 * Each step of a turn resends the tool definitions, the system prompt and the
 * whole conversation. Without cache breakpoints Anthropic bills all of it at
 * the full input price every time (measured 2026-10-29: zero cache reads on
 * the production key). Two breakpoints fix that:
 *
 * 1. The last system message. Anthropic caches the prefix up to a breakpoint,
 *    and the prefix is tools, then system, then messages, so this one covers
 *    the tool definitions and the system prompt. Stable across every student's
 *    turns in a chat, and across students with the same apps connected.
 * 2. The last message. The next step (tool result) or the next turn extends
 *    the conversation, so the previous breakpoint becomes a cache read and the
 *    new last message takes over. Anthropic looks back up to 20 blocks for a
 *    matching breakpoint, so the rolling one keeps hitting.
 *
 * Cache reads cost a tenth of uncached input, writes cost 1.25x, so the
 * second step of any turn already pays for itself. Prompts under the model's
 * minimum (1,024 tokens on Opus and Sonnet) are silently not cached.
 */

type Params = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];
export type Prompt = Params["prompt"];
type Message = Prompt[number];

const EPHEMERAL = { cacheControl: { type: "ephemeral" } } as const;

/** True when the message already carries an Anthropic cache breakpoint, ours or anyone's. */
function hasBreakpoint(message: Message): boolean {
  const anthropic = message.providerOptions?.anthropic as Record<string, unknown> | undefined;
  return Boolean(anthropic && (anthropic.cacheControl || anthropic.cache_control));
}

function withBreakpoint(message: Message): Message {
  return {
    ...message,
    providerOptions: {
      ...(message.providerOptions ?? {}),
      anthropic: { ...((message.providerOptions?.anthropic as Record<string, unknown>) ?? {}), ...EPHEMERAL },
    },
  } as Message;
}

/**
 * The prompt with the two breakpoints above. Pure, so it can be tested
 * without a model: never adds a breakpoint a message already has, never
 * marks the same message twice, and leaves an empty prompt alone.
 */
export function withCacheBreakpoints(prompt: Prompt): Prompt {
  if (prompt.length === 0) return prompt;
  const out = [...prompt];
  let lastSystem = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].role === "system") lastSystem = i;
  }
  if (lastSystem >= 0 && !hasBreakpoint(out[lastSystem])) {
    out[lastSystem] = withBreakpoint(out[lastSystem]);
  }
  const last = out.length - 1;
  if (last !== lastSystem && !hasBreakpoint(out[last])) {
    out[last] = withBreakpoint(out[last]);
  }
  return out;
}

/** Wrap an Anthropic model with `wrapLanguageModel({ model, middleware: promptCache })`. */
export const promptCache: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({ ...params, prompt: withCacheBreakpoints(params.prompt) }),
};
