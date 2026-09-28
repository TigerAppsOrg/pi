import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_WORKSPACES, editWorkspaces, workspaceActionSchema, workspaceContext } from "../src/shared/workspaces.ts";
import { handleWorkspaceRequest } from "../src/server/workspaces.ts";

test("workspaces persist context and sources only for their assigned chats", () => {
  let state = editWorkspaces(EMPTY_WORKSPACES, { type: "create", name: "Fall courses", color: "cyan" }, 100);
  const id = state.workspaces[0].id;
  state = editWorkspaces(state, { type: "update", id, name: "Fall courses", color: "cyan", context: "Keep Friday free", updatedAt: 100 }, 200);
  state = editWorkspaces(state, { type: "assign", chatId: "chat-a", workspaceId: id, title: "Course choices", at: 250 });
  state = editWorkspaces(state, { type: "save", id, code: "COS 126", title: "Computer Science", url: "https://www.princetoncourses.com/course/1272002051" });
  assert.match(workspaceContext(state, "chat-a"), /Keep Friday free/);
  assert.match(workspaceContext(state, "chat-a"), /COS 126/);
  assert.equal(workspaceContext(state, "chat-b"), "");
  assert.deepEqual(EMPTY_WORKSPACES, { workspaces: [], chats: [] });
  const unassigned = editWorkspaces(state, { type: "assign", chatId: "chat-a", workspaceId: null, title: "Course choices", at: 300 });
  assert.equal(workspaceContext(unassigned, "chat-a"), "");
});

test("stale edits and assignments to deleted workspaces fail", () => {
  const state = editWorkspaces(EMPTY_WORKSPACES, { type: "create", name: "Research", color: "violet" }, 100);
  const id = state.workspaces[0].id;
  assert.throws(() => editWorkspaces(state, { type: "update", id, name: "Research", color: "pink", context: "stale", updatedAt: 99 }), /another tab/);
  assert.throws(() => editWorkspaces(state, { type: "assign", chatId: "chat-a", workspaceId: "missing", title: "Chat", at: 100 }), /no longer exists/);
});

test("delete removes workspace membership, never deletes transcripts", () => {
  let state = editWorkspaces(EMPTY_WORKSPACES, { type: "create", name: "Research", color: "violet" });
  const id = state.workspaces[0].id;
  state = editWorkspaces(state, { type: "assign", chatId: "chat-a", workspaceId: id, title: "Chat", at: 100 });
  state = editWorkspaces(state, { type: "delete", id });
  assert.deepEqual(state, EMPTY_WORKSPACES);
  assert.equal(workspaceContext(state, "chat-a"), "");
});

test("saving a source is idempotent and rejects unsafe URLs", () => {
  let state = editWorkspaces(EMPTY_WORKSPACES, { type: "create", name: "Research", color: "yellow" });
  const id = state.workspaces[0].id;
  const action = { type: "save", id, title: "Course", url: "https://princetoncourses.com/course/1272002051" } as const;
  state = editWorkspaces(editWorkspaces(state, action), action);
  assert.equal(state.workspaces[0].sources.length, 1);
  assert.equal(workspaceActionSchema.safeParse({ ...action, url: "javascript:alert(1)" }).success, false);
  assert.equal(workspaceActionSchema.safeParse({ type: "create", name: " ", color: "cyan" }).success, false);
  assert.equal(workspaceActionSchema.safeParse({ type: "assign", chatId: "desk", workspaceId: id, title: "Chat", at: 1 }).success, false);
  state = editWorkspaces(state, { type: "unsave", id, sourceId: state.workspaces[0].sources[0].id });
  assert.equal(state.workspaces[0].sources.length, 0);
});

function storage() {
  const data = new Map<string, unknown>();
  const api = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, transaction: async (fn: (txn: unknown) => Promise<unknown>) => fn(api) };
  return api as unknown as DurableObjectStorage;
}

test("workspace API survives rereads and different account stores stay separate", async () => {
  const first = storage(), second = storage();
  const create = new Request("https://pi.tigerapps.org/api/workspaces", { method: "POST", body: JSON.stringify({ type: "create", name: "Fall", color: "green" }) });
  assert.equal((await handleWorkspaceRequest(create, first)).status, 200);
  const read = () => new Request("https://pi.tigerapps.org/api/workspaces");
  const saved = await (await handleWorkspaceRequest(read(), first)).json();
  const isolated = await (await handleWorkspaceRequest(read(), second)).json();
  assert.equal(saved.workspaces[0].name, "Fall");
  assert.equal(isolated.workspaces.length, 0);
  const bad = await handleWorkspaceRequest(new Request(read(), { method: "POST", body: "bad json" }), first);
  assert.equal(bad.status, 400);
  assert.equal((await handleWorkspaceRequest(new Request(read(), { method: "DELETE" }), first)).status, 405);
});
