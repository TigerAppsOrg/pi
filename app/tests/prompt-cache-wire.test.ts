import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, tool, wrapLanguageModel } from "ai";
import { z } from "zod";
import { promptCache } from "../src/server/prompt-cache.ts";
import { PI_MODELS, type PiModel } from "../src/shared/apps.ts";
import { addStep, emptyTurnUsage } from "../src/server/usage.ts";

// The provider's request body, captured by a fake fetch, so the test proves the
// breakpoints reach Anthropic's wire format without touching the network.
async function capture(modelId: PiModel, run: (model: ReturnType<ReturnType<typeof createAnthropic>>) => Promise<unknown>) {
  let body: Record<string, unknown> | null = null;
  const anthropic = createAnthropic({
    apiKey: "test",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      if (body?.stream) {
        const usage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2_000, cache_creation_input_tokens: 1_000 };
        const events = [
          { type: "message_start", message: {
            id: "msg_1", type: "message", role: "assistant", model: modelId,
            content: [], stop_reason: null, stop_sequence: null, usage,
          } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
          { type: "message_stop" },
        ];
        return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: modelId,
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  });
  await run(wrapLanguageModel({ model: anthropic(modelId), middleware: promptCache }) as never);
  assert.ok(body, "the provider made a request");
  return body as unknown as {
    model: string;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    system?: Array<{ text: string; cache_control?: { type: string } }>;
    messages: Array<{ role: string; content: Array<{ type: string; cache_control?: { type: string } }> }>;
    tools?: Array<{ name: string; cache_control?: { type: string } }>;
  };
}

for (const { value: modelId } of PI_MODELS) {
  test(`${modelId}: system prompt and the last user message carry cache_control on the wire`, async () => {
    const body = await capture(modelId, (model) =>
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
    assert.equal(body.model, modelId);
    assert.equal(body.temperature, undefined);
    assert.equal(body.top_p, undefined);
    assert.equal(body.top_k, undefined);
    assert.deepEqual(body.system?.map((b) => b.cache_control?.type), ["ephemeral"]);
    const perMessage = body.messages.map((m) => m.content.map((c) => c.cache_control?.type));
    assert.deepEqual(perMessage, [[undefined], [undefined], ["ephemeral"]]);
  });

  test(`${modelId}: tools are covered by the system breakpoint`, async () => {
    const body = await capture(modelId, (model) =>
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

  test(`${modelId}: the rolling breakpoint reaches the last tool result`, async () => {
    const body = await capture(modelId, (model) =>
      generateText({
        model,
        system: "You are PI.",
        tools: { find: tool({ description: "find", inputSchema: z.object({ q: z.string() }) }) },
        messages: [
          { role: "user", content: "check COS 217 and COS 226" },
          { role: "assistant", content: [
            { type: "tool-call", toolCallId: "1", toolName: "find", input: { q: "COS 217" } },
            { type: "tool-call", toolCallId: "2", toolName: "find", input: { q: "COS 226" } },
          ] },
          { role: "tool", content: [
            { type: "tool-result", toolCallId: "1", toolName: "find", output: { type: "text", value: "COS 217" } },
            { type: "tool-result", toolCallId: "2", toolName: "find", output: { type: "text", value: "COS 226" } },
          ] },
        ],
      })
    );
    assert.deepEqual(body.system?.map((b) => b.cache_control?.type), ["ephemeral"]);
    assert.deepEqual(body.messages.at(-1)?.content.map((c) => [c.type, c.cache_control?.type]), [
      ["tool_result", undefined],
      ["tool_result", "ephemeral"],
    ]);
    assert.equal(body.messages.flatMap((m) => m.content).filter((c) => c.cache_control).length, 1);
  });

  test(`${modelId}: streaming requests preserve caching and reported cache usage`, async () => {
    const body = await capture(modelId, async (model) => {
      const result = streamText({ model, system: "You are PI.", prompt: "hello" });
      assert.equal(await result.text, "ok");
      const usage = addStep(emptyTurnUsage(), await result.usage);
      assert.equal(usage.input, 10);
      assert.equal(usage.cacheRead, 2_000);
      assert.equal(usage.cacheWrite5m, 1_000);
      assert.equal(usage.output, 1);
    });
    assert.equal(body.stream, true);
    assert.equal(body.model, modelId);
    assert.deepEqual(body.system?.map((b) => b.cache_control?.type), ["ephemeral"]);
    assert.deepEqual(body.messages.at(-1)?.content.map((c) => c.cache_control?.type), ["ephemeral"]);
  });
}
