import type { ConsentDescription, GrantSummary } from "@cloudflare/workers-oauth-provider";
import { COURSE_READ, PLAN_WRITE } from "./course-mcp";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function connectorPage(title: string, body: string, headers = new Headers(), status = 200, redirectUri?: string): Response {
  const callback = redirectUri ? new URL(redirectUri) : undefined;
  // Chromium applies form-action to the OAuth redirect too. Include only the
  // registered callback's HTTP(S) origin, never raw client text in the policy.
  const callbackSource = callback && /^https?:$/.test(callback.protocol) && /^[a-z\d.:[\]-]+$/i.test(callback.host) ? ` ${callback.origin}` : "";
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  // Keep Origin on same-origin form POSTs for CSRF checks, without sending
  // consent URLs as referrers to the external assistant.
  headers.set("referrer-policy", "same-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callbackSource}; frame-ancestors 'none'; base-uri 'none'`);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · PI</title>
<style>body{margin:0;background:#f6f3ed;color:#242521;font:16px/1.55 system-ui,sans-serif}main{max-width:620px;margin:6vh auto;padding:32px}h1{font:600 34px/1.15 Georgia,serif}h2{font-size:20px;margin-top:32px}a{color:#305a4b}label{display:block;padding:18px 0;border-top:1px solid #ccc}input{margin-right:8px;accent-color:#305a4b}button{padding:12px 20px;font:inherit;border:1px solid #305a4b;border-radius:8px;background:#305a4b;color:white;cursor:pointer}button.secondary{background:transparent;color:#305a4b}small{display:block;color:#595b54}code{overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.grant{padding:18px 0;border-top:1px solid #ccc}.eyebrow{font-weight:600;color:#305a4b}p,li{overflow-wrap:anywhere}</style></head><body><main><a href="/apps">PI / My apps</a><p class="eyebrow">Princeton Courses by TigerApps</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, { headers, status });
}

export function consentPage(details: ConsentDescription, handle: string, netid: string, subjectProof: string, headers: Headers): Response {
  const name = escapeHtml(details.clientName);
  return connectorPage("Connect your course assistant", `
<p><strong>${name}</strong> wants to use Princeton course tools as <strong>${escapeHtml(netid)}</strong>.</p>
<p>Authorization returns to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
<small>${details.clientDomain ? `Client domain verified as ${escapeHtml(details.clientDomain)}.` : "The application name is supplied by the client. Check the destination before connecting."}${details.redirectIsLoopback ? " This destination is a local app. Another local process could be listening there." : ""}</small>
<form method="post" action="/connect/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}"><input type="hidden" name="subject" value="${escapeHtml(subjectProof)}">
<label><input type="checkbox" checked disabled>Read course information and my saved plans<input type="hidden" name="scope" value="${COURSE_READ}"><small>Courses, sections, reviews, degree requirements, and your TigerJunction and TigerPath plans. Data requested by the assistant is sent to ${name}.</small></label>
<label><input type="checkbox" name="scope" value="${PLAN_WRITE}">Allow changes to my saved plans<small>Optional. Create, rename, add, or remove courses in TigerJunction and TigerPath when you ask. This does not register you for courses.</small></label>
<p>Your conversation stays in your assistant. This connection does not import memories, PI chats, Canvas, or calendars.</p>
<small>Access can renew for up to 30 days. Disconnect any time at PI / My apps / Course connector.</small>
<div class="actions"><button name="decision" value="approve">Connect</button><button class="secondary" name="decision" value="deny">Cancel</button></div></form>`, headers, 200, details.redirectUri);
}

export function connectionsPage(origin: string, netid: string, grants: GrantSummary[], cursor?: string): Response {
  return connectorPage("Your course connector", `
<p>Use your existing Claude account to research courses, compare reviews, check degree requirements, and plan your semester.</p>
<ol><li>In Claude, open Settings, then Connectors, then add a custom connector.</li><li>Use this server URL. <code>${escapeHtml(origin)}/mcp</code></li><li>Sign in with Princeton and choose the permissions to grant.</li></ol>
<p>Try asking, “Help me choose next semester's courses for my degree and interests. Compare workload and section times, then show me alternatives before saving.”</p>
<small>Connector availability depends on your assistant's plan and workspace settings. Your assistant handles model usage under its own limits. PI provides the course tools.</small>
<h2>Connected as ${escapeHtml(netid)}</h2>
${grants.length ? grants.map((grant) => `<section class="grant"><strong>${escapeHtml(typeof grant.metadata?.clientName === "string" ? grant.metadata.clientName : grant.clientId)}</strong><p>${grant.scope.includes(PLAN_WRITE) ? "Read courses and edit saved plans" : "Read courses and saved plans"}</p><form method="post" action="/connect/revoke"><input type="hidden" name="grant" value="${escapeHtml(grant.id)}"><button class="secondary">Disconnect</button></form></section>`).join("") : "<p>No connections on this page.</p>"}
${cursor ? `<p><a href="/connect?cursor=${encodeURIComponent(cursor)}">More connections</a></p>` : ""}
<small>Disconnecting stops future access as revocation propagates. It cannot erase data already sent to an assistant.</small>`);
}
