import { z } from "zod";

const CS = "https://www.cs.princeton.edu/courses/schedule";
const PRINCE = "https://www.dailyprincetonian.com";
const term = z.number().int().min(1000).max(1999).refine(n => [2, 4].includes(n % 10));
const definitions = {
  get_cs_course_schedule: { description: "Read the official CS department schedule for an explicit term, directly from Princeton. Includes published course-level times and instructors, not a complete precept/lab schedule. Independent of TigerJunction's database.", schema: z.object({ term }) },
  search_prince_articles: { description: "Search the Daily Princetonian public website for recent or historical campus reporting. Returns dated, linked article excerpts. This is public Prince search, not Clio or an exhaustive archive. Reporting is not authoritative course scheduling or degree policy.", schema: z.object({ query: z.string().trim().min(2).max(150), page: z.number().int().min(1).max(50).default(1) }) },
};
export const PUBLIC_COURSE_TOOLS = Object.entries(definitions).map(([name, d]) => ({ name, description: d.description, inputSchema: z.toJSONSchema(d.schema) as { type: "object"; [key: string]: unknown }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }));
export function publicCourseData(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { text: string; fetchedAt: string; expires: number }>();
  async function read(url: string) {
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) return hit;
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "PI-TigerApps-CourseConnector/1.0", accept: "text/html, application/json" } });
    if (!response.ok || !response.body) throw new Error("Source unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) throw new Error("Source too large");
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = { text: new TextDecoder().decode(bytes), fetchedAt: new Date().toISOString(), expires: Date.now() + 300_000 };
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(url, value);
    return value;
  }
  async function csSchedule(termCode: number) {
    const semester = `${termCode % 10 === 2 ? "fall" : "spring"}${String(Math.floor(termCode / 10) - (termCode % 10 === 2 ? 1 : 0)).slice(-2)}`;
    const sourceUrl = `${CS}?semester=${semester}`;
    const page = await read(sourceUrl);
    const options = [...page.text.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find(o => /\bselected(?:\s|=|$)/i.test(o[1]));
    if (!selected || !new RegExp(`\\bvalue=["']${semester}["']`).test(selected[1])) throw new Error("Source selected another term");
    const table = page.text.match(/<table\b[^>]*class="[^"]*course-schedule__table[^"]*"[^>]*>([\s\S]*?)<\/table>/)?.[1];
    if (!table) throw new Error("Schedule missing");
    const courses = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(row => {
      const cell = (field: string) => row[1].match(new RegExp(`<td\\b[^>]*class="[^"]*course-schedule__${field}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1];
      const code = plain(cell("number") ?? "");
      if (!/^COS\s*\d{3}[A-Z]?$/i.test(code)) return [];
      return [{ code, title: plain(cell("title") ?? ""), instructors: plain(cell("instructors") ?? "") || null, publishedMeeting: plain(cell("time") ?? "") || null }];
    });
    if (!courses.length) throw new Error("No parseable courses");
    return { source: "Princeton CS department", sourceUrl, fetchedAt: page.fetchedAt, cacheMaxAgeSeconds: 300, term: termCode, coverage: "COS_course_level_schedule_only", courses, warning: "Times are reproduced as published in America/New_York. Do not infer missing AM/PM, precepts, labs, seats or completed prerequisites. Use official course sections before validating a full schedule." };
  }
  async function prince(query: string, pageNumber: number) {
    const params = new URLSearchParams({ a: "1", s: query, ty: "article", o: "date", page: String(pageNumber), per_page: "10" });
    const sourceUrl = `${PRINCE}/search?${params}`;
    const result = await read(`${PRINCE}/search.json?${params}`);
    const parsed = JSON.parse(result.text);
    if (!Array.isArray(parsed.items)) throw new Error("Invalid Prince response");
    const articles = parsed.items.filter((i: any) => i && typeof i.id === "string" && typeof i.slug === "string" && /^[a-z0-9-]+$/i.test(i.slug) && /^\d{4}-\d{2}-\d{2}/.test(i.published_at)).slice(0, 10).map((i: any) => ({
      source_type: "prince_public_article", source_id: i.id, title: plain(i.headline ?? ""), published_at: i.published_at,
      url: `${PRINCE}/article/${i.published_at.slice(0, 4)}/${i.published_at.slice(5, 7)}/${i.slug}`, excerpt: plain(i.abstract ?? "").slice(0, 600),
    }));
    return { source: "Daily Princetonian public search (not Clio)", sourceUrl, fetchedAt: result.fetchedAt, cacheMaxAgeSeconds: 300, coverage: "search_page_only", query, page: pageNumber, articles, newest_published_at: articles.reduce((latest: string | null, a: { published_at: string }) => !latest || a.published_at > latest ? a.published_at : latest, null), latest_successful_ingestion: null, corpus_range: null, warning: "No local archive ingestion. Fetch time does not establish article revision freshness. Search coverage and publication timestamps come from the public site; results may be partial." };
  }
  return {
    csSchedule,
    async call(name: string, args: Record<string, unknown>) {
      if (name === "get_cs_course_schedule") return csSchedule(definitions.get_cs_course_schedule.schema.parse(args).term);
      if (name === "search_prince_articles") { const a = definitions.search_prince_articles.schema.parse(args); return prince(a.query, a.page); }
      throw new Error("Unknown public tool");
    },
  };
}
export function plain(html: string): string {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" })[name as string] ?? " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "; }).replace(/\s+/g, " ").trim();
}
