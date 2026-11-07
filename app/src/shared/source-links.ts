/** Internal TigerDraw provenance should lead students to the public website. */
export function studentSourceLink(href: string): {
  href: string;
  label?: string;
} {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const api =
      host === "draw.tigerapps.org" &&
      (path === "/api" ||
        path.startsWith("/api/") ||
        ["/room_images", "/get_reviews"].includes(path.replace(/\/$/, "")));
    const repo =
      ["github.com", "www.github.com", "raw.githubusercontent.com"].includes(
        host,
      ) && /^\/tigerappsorg\/tigerdraw(?:\/|$)/.test(path);
    if (api || repo)
      return { href: "https://draw.tigerapps.org", label: "Open TigerDraw" };
  } catch {
    /* Preserve existing handling for other links. */
  }
  return { href };
}
