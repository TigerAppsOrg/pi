import { EMPTY_WORKSPACES, WorkspaceError, editWorkspaces, workspaceActionSchema, type WorkspaceState } from "../shared/workspaces";

export const WORKSPACE_KEY = "pi_workspaces_v1";

export async function handleWorkspaceRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (request.method === "GET") {
    return Response.json((await storage.get<WorkspaceState>(WORKSPACE_KEY)) ?? EMPTY_WORKSPACES, { headers });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...headers, allow: "GET, POST" } });
  try {
    const body = await request.text();
    if (body.length > 20000) return Response.json({ error: "That edit is too large." }, { status: 413, headers });
    const parsed = workspaceActionSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return Response.json({ error: "Check the workspace name, context, and link." }, { status: 400, headers });
    const state = await storage.transaction(async (txn) => {
      const prev = (await txn.get<WorkspaceState>(WORKSPACE_KEY)) ?? EMPTY_WORKSPACES;
      const next = editWorkspaces(prev, parsed.data);
      await txn.put(WORKSPACE_KEY, next);
      return next;
    });
    return Response.json(state, { headers });
  } catch (error) {
    if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    throw error;
  }
}
