import { routeCourseConnector } from "../../src/server/course-oauth";
import { handleAuth } from "../../src/server/auth";

// The production routing order, without loading unrelated chat Durable Objects.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return await routeCourseConnector(request, env, ctx)
      ?? await handleAuth(request, env)
      ?? new Response("Not found", { status: 404 });
  },
};
