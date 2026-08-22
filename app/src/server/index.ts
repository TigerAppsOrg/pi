import { routeAgentRequest } from "agents";
import { getSession, handleAuth, userPrefix } from "./auth";

export { Pi } from "./pi";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const auth = await handleAuth(request, env);
    if (auth) return auth;

    // Every agent route belongs to exactly one signed-in user: instance
    // names are `u-<netid>-…`, and only that netid's session may reach them.
    if (url.pathname.startsWith("/agents/")) {
      const session = await getSession(request, env);
      if (!session) {
        return new Response("Sign in first.", { status: 401 });
      }
      const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      if (!name.startsWith(userPrefix(session.netid))) {
        return new Response("That conversation isn't yours.", { status: 403 });
      }
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
