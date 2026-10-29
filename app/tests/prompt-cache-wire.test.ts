import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool, wrapLanguageModel } from "ai";
import { z } from "zod";
import { promptCache } from "../src/server/prompt-cache.ts";

// The provider's request body, captured by a fake fetch, so the test proves the
// breakpoints reach Anthropic's wire format without touching the network.
async function capture(run: (model: ReturnType<ReturnType<typeof createAnthropic>>) => Promise<unknown>) {
  let body: Record<string, unknown> | null = null;
  const anthropic = createAnthropic({
    apiKey: "test",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  });
  await run(wrapLanguageModel({ model: anthropic("claude-sonnet-5"), middleware: promptCache }) as never);
  assert.ok(body, "the provider made a request");
  return body as unknown as {
    system?: Array<{ text: string; cache_control?: { type: string } }>;
    messages: Array<{ role: string; content: Array<{ type: string; cache_control?: { type: string } }> }>;
    tools?: Array<{ name: string; cache_control?: { type: string } }>;
  };
}

test("system prompt and the last user message carry cache_control on the wire", async () => {
  const body = await capture((model) =>
    generateText({
      model,
      system: "You are PI, the TigerApps assistant.",
      messages: [
        { role: "user", content: "what's due" },
        { role: "assistant", content: "Nothing today." },
        { role: "user", content: "and tomorrow?" },
      ],
    })
  );
  assert.deepEqual(body.system?.map((b) => b.cache_control?.type), ["ephemeral"]);
  const perMessage = body.messages.map((m) => m.content.map((c) => c.cache_control?.type));
  assert.deepEqual(perMessage, [[undefined], [undefined], ["ephemeral"]]);
});

test("with tools, the system breakpoint still covers them and no tool gets its own", async () => {
  const body = await capture((model) =>
    generateText({
      model,
      system: "You are PI.",
      tools: { find: tool({ description: "find", inputSchema: z.object({ q: z.string() }) }) },
      messages: [{ role: "user", content: "search" }],
    })
  );
  assert.equal(body.tools?.length, 1);
  assert.equal(body.tools?.[0].cache_control, undefined);
  assert.deepEqual(body.system?.map((b) => b.cache_control?.type), ["ephemeral"]);
  assert.deepEqual(body.messages.at(-1)?.content.map((c) => c.cache_control?.type), ["ephemeral"]);
});
