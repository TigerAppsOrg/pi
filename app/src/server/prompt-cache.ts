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
 *    the tool definitions and the system prompt. Reused while the entire
 *    prefix is unchanged, including the student's identity and workspace.
 * 2. The last message. The next step (tool result) or the next turn extends
 *    the conversation, so the previous breakpoint can become a cache read and the
 *    new last message takes over. Anthropic looks back up to 20 blocks for a
 *    matching breakpoint. Changes to earlier content or the model, expiry,
 *    and growth beyond that window can cause a miss.
 *
 * The default cache TTL is five minutes. Prompts under the model's minimum
 * are silently not cached (512 tokens on Sonnet 5.5 and Haiku 5.5).
 * Verify reuse through cacheRead in pi.usage rather than assuming a hit.
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
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
