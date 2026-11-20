import { AuthorizationError, OAuthProvider, insufficientScope, type OAuthHelpers, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { getSession, handleAuth } from "./auth";
import { connectionsPage, consentPage, connectorPage } from "./course-consent";
import { COURSE_READ, PLAN_WRITE, courseUpstream, handleCourseMcp } from "./course-mcp";

type ConnectorEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
const propsSchema = z.object({ netid: z.string().regex(/^[a-z][a-z0-9]{0,63}$/) });

// The library binds consent to this browser. Also bind the displayed identity
// to the handle, so switching CAS accounts in another tab cannot change who
// grants access when an already-open consent form is submitted.
async function subjectKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function subjectBytes(netid: string, handle: string) {
  return new TextEncoder().encode(JSON.stringify(["pi-course-consent", netid, handle]));
}
async function signSubject(netid: string, handle: string, secret: string) {
  const sig = await crypto.subtle.sign("HMAC", await subjectKey(secret), subjectBytes(netid, handle));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function verifySubject(proof: string, netid: string, handle: string, secret: string) {
  try {
    return await crypto.subtle.verify("HMAC", await subjectKey(secret), Uint8Array.from(atob(proof), c => c.charCodeAt(0)), subjectBytes(netid, handle));
  } catch { return false; }
}

export function createCourseOAuthProvider(origin: string) {
  return new OAuthProvider<ConnectorEnv>({
    apiRoute: "/mcp",
    apiHandler: {
      async fetch(request, env, context) {
        const ctx = context as OAuthResourceContext<unknown>;
        const props = propsSchema.safeParse(ctx.props);
        if (!props.success || ctx.auth.userId !== props.data.netid) return new Response("Invalid identity", { status: 401 });
        if (!ctx.auth.scope.includes(COURSE_READ)) return insufficientScope(ctx.auth, [COURSE_READ]);
        const requestOrigin = request.headers.get("origin");
        if (requestOrigin && ![origin, "https://claude.ai", "https://chatgpt.com"].includes(requestOrigin)) {
          return new Response("Forbidden origin", { status: 403 });
        }
        return handleCourseMcp(request, { netid: props.data.netid, scope: ctx.auth.scope }, courseUpstream(env, props.data.netid));
      },
    },
    authorizeEndpoint: "/connect/authorize",
    tokenEndpoint: "/connect/token",
    clientRegistrationEndpoint: "/connect/register",
    // Claude supports dynamic registration. CIMD can be added separately with
    // the required public-only fetch compatibility flag and its own tests.
    clientIdMetadataDocumentEnabled: false,
    scopesSupported: [COURSE_READ, PLAN_WRITE, "offline_access"],
    requiredScopes: [COURSE_READ],
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 60 * 60,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Princeton Courses by TigerApps" },
    defaultHandler: {
      async fetch(request, env) {
        const auth = await handleAuth(request, env);
        if (auth) return auth;
        const url = new URL(request.url);
        if (!["/connect", "/connect/authorize", "/connect/revoke"].includes(url.pathname)) return new Response("Not found", { status: 404 });
        if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
        if (request.method === "POST" && request.headers.get("origin") !== origin) return new Response("Forbidden origin", { status: 403 });
        const session = await getSession(request, env);
        if (!session) {
          if (request.method !== "GET") return new Response("Sign in again and restart the connection.", { status: 401 });
          const login = new URL("/auth/login", origin);
          login.searchParams.set("returnTo", url.pathname + url.search);
          return Response.redirect(login.href, 302);
        }
        const oauth = env.OAUTH_PROVIDER;
        try {
          if (url.pathname === "/connect" && request.method === "GET") {
            const grants = await oauth.listUserGrants(session.netid, { limit: 50, cursor: url.searchParams.get("cursor") ?? undefined });
            return connectionsPage(origin, session.netid, grants.items, grants.cursor);
          }
          if (url.pathname === "/connect/revoke" && request.method === "POST") {
            const form = await request.formData();
            const grant = String(form.get("grant") ?? "");
            if (!grant || grant.length > 256) return new Response("Invalid grant", { status: 400 });
            await oauth.revokeGrant(grant, session.netid);
            return Response.redirect(`${origin}/connect`, 303);
          }
          if (url.pathname !== "/connect/authorize") return new Response("Method not allowed", { status: 405 });
          if (request.method === "GET") {
            const authRequest = await oauth.parseAuthRequest(request);
            // Require PKCE even for confidential clients. Never issue a code
            // that can be redeemed without the initiating client's verifier.
            if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") return new Response("PKCE S256 is required.", { status: 400 });
            const details = await oauth.describeConsent(authRequest);
            const consent = await oauth.beginConsent(authRequest);
            return consentPage(details, consent.handle, session.netid, await signSubject(session.netid, consent.handle, env.SESSION_SECRET), consent.headers);
          }
          const form = await request.formData();
          const handle = String(form.get("handle") ?? "");
          if (!await verifySubject(String(form.get("subject") ?? ""), session.netid, handle, env.SESSION_SECRET)) {
            return new Response("Your account changed or this consent form expired. Start the connection again.", { status: 400 });
          }
          if (form.get("decision") !== "approve") {
            const denied = await oauth.denyConsent(request, handle);
            return new Response(null, { status: 302, headers: denied.headers });
          }
          const scope = [COURSE_READ, "offline_access"];
          if (form.getAll("scope").includes(PLAN_WRITE)) scope.push(PLAN_WRITE);
          const approved = await oauth.approveConsent(request, handle, { scope });
          const details = await oauth.describeConsent(approved.request);
          const { redirectTo } = await oauth.completeAuthorization({
            request: approved.request, userId: session.netid, scope: approved.request.scope,
            props: { netid: session.netid }, metadata: { clientName: details.clientName },
          });
          approved.headers.set("location", redirectTo);
          return new Response(null, { status: 302, headers: approved.headers });
        } catch (error) {
          if (error instanceof AuthorizationError) {
            if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
            return new Response("Invalid or expired authorization request. Start the connection again.", { status: 400 });
          }
          return connectorPage("Connection unavailable", "<p>The course connector could not complete this request. Try again shortly.</p>", undefined, 503);
        }
      },
    },
  });
}

/** Keep existing PI routes independent of OAuth storage and metadata. */
export async function routeCourseConnector(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (!(url.pathname === "/mcp" || url.pathname.startsWith("/mcp/") || url.pathname === "/connect" || url.pathname.startsWith("/connect/") || url.pathname.startsWith("/.well-known/oauth-"))) return null;
  if (!env.OAUTH_KV || !env.SESSION_SECRET) return new Response("Course connector is not configured.", { status: 503 });
  const origin = new URL(env.APP_ORIGIN || url.origin).origin;
  if (origin !== url.origin) return new Response("Use the configured PI origin for the course connector.", { status: 400 });
  return createCourseOAuthProvider(origin).fetch(request, env as ConnectorEnv, ctx);
}
