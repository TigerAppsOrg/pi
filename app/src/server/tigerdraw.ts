/** TigerDraw reads public data; never send Junction credentials or NetID headers. */
export function tigerDrawConnection(env: object): {
  url: string;
  headers: Record<string, string>;
} {
  const config = env as {
    TIGERDRAW_MCP_URL?: string;
    TIGERDRAW_MCP_TOKEN?: string;
  };
  const url = new URL(
    config.TIGERDRAW_MCP_URL || "https://draw.tigerapps.org/mcp",
  );
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid TigerDraw MCP endpoint");
  const token = config.TIGERDRAW_MCP_TOKEN?.trim();
  return {
    url: url.href,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

export async function tigerDrawConnectionKey(
  connection: ReturnType<typeof tigerDrawConnection>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(connection)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
