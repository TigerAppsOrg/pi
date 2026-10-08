import type { LanguageModel } from "ai";

/** Model id logged for turns the notice model answered. */
export const NOTICE_MODEL_ID = "pi-notice";

const NO_TOKENS = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * A stand-in model that answers with a fixed note and never calls a provider,
 * so a turn it handles costs nothing. Used when a student is out of budget:
 * the note arrives as an ordinary assistant message, in the same chat.
 */
export function noticeModel(text: string): Exclude<LanguageModel, string> {
  return {
    specificationVersion: "v4",
    provider: "pi",
    modelId: NOTICE_MODEL_ID,
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: NO_TOKENS,
        warnings: [],
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "notice" });
            controller.enqueue({ type: "text-delta", id: "notice", delta: text });
            controller.enqueue({ type: "text-end", id: "notice" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: NO_TOKENS,
            });
            controller.close();
          },
        }),
      };
    },
  };
}
