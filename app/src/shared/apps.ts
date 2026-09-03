/**
 * The catalog of TigerApps that PI can connect to. Each app maps 1:1 to a
 * scoped MCP endpoint served by the junction engine. Shared by the server
 * (connection management) and the client (the "My apps" page).
 */

export type AppKey = "junction" | "princetoncourses" | "path" | "snatch" | "gcal";

export type PiApp = {
  key: AppKey;
  name: string;
  /** Path appended to the engine base URL. */
  mcpPath: string;
  /** Absolute MCP URL for servers that don't live on the engine. */
  mcpUrl?: string;
  /** The app's own front door, for link-outs and friendly error CTAs. */
  home: string;
  /** Two-letter mark shown when the logo can't load. */
  glyph: string;
  /** Path to the app's official logo (served from /public). */
  logo: string;
  tagline: string;
  detail: string;
  /**
   * Highlighter color for this app, as the suffix of a `--hl-*` token. One
   * app is one color everywhere, so this must stay in step with APP_INK in
   * client/lib/tools.ts, which paints the same apps in chat and on the agenda.
   */
  ink: "cyan" | "orange" | "violet" | "pink" | "mint";
  /** Whether tools need to know who the user is to be useful. */
  personal: boolean;
  /** Which section of My apps this belongs under. */
  kind: "app" | "calendar";
};

export const PI_APPS: PiApp[] = [
  {
    key: "junction",
    home: "https://junction.tigerapps.org",
    logo: "/logos/tigerjunction.png",
    glyph: "TJ",
    name: "TigerJunction",
    mcpPath: "/junction/mcp",
    tagline: "build & edit your schedule",
    detail:
      "Draft next semester before it drafts you. Search the catalog, move sections around, and catch the clashes early.",
    ink: "cyan",
    personal: true,
    kind: "app",
  },
  {
    key: "princetoncourses",
    home: "https://courses.tigerapps.org",
    logo: "/logos/princetoncourses.png",
    glyph: "PC",
    name: "PrincetonCourses",
    mcpPath: "/princetoncourses/mcp",
    tagline: "ratings & what people actually said",
    detail:
      "What do Princeton students really think of their classes? Ratings, instructor history, and the reviews in their own words.",
    ink: "orange",
    personal: false,
    kind: "app",
  },
  {
    key: "path",
    home: "https://www.tigerpath.io",
    logo: "/logos/tigerpath.png",
    glyph: "TP",
    name: "TigerPath",
    mcpPath: "/path/mcp",
    tagline: "your 4-year plan & what's left",
    detail:
      "Where your degree actually stands. Requirement trees, a four-year plan, and the boxes still waiting to be ticked.",
    ink: "violet",
    personal: true,
    kind: "app",
  },
  {
    key: "snatch",
    home: "https://tigersnatch.com",
    logo: "/logos/tigersnatch.svg",
    glyph: "TS",
    name: "TigerSnatch",
    mcpPath: "/snatch/mcp",
    tagline: "a seat when one opens",
    detail:
      "Course registration did you dirty? Watch a full section and hear about it the moment a spot opens up.",
    ink: "pink",
    personal: true,
    kind: "app",
  },
  {
    key: "gcal",
    home: "https://calendar.google.com",
    logo: "/logos/googlecalendar.svg",
    glyph: "GC",
    name: "Google Calendar",
    mcpPath: "",
    mcpUrl: "https://calendarmcp.googleapis.com/mcp/v1",
    tagline: "your real calendar, read-only",
    detail:
      "The rest of your week, so a class never lands on top of practice. PI can read this calendar and can never change it.",
    ink: "mint",
    personal: true,
    kind: "calendar",
  },
];

/**
 * Rows the app library shows but PI cannot talk to yet. Client-only on
 * purpose: the server iterates PI_APPS to open connections, and nothing here
 * has an endpoint to open. Keep it that way until an app ships an MCP.
 */
export type SoonApp = {
  key: string;
  name: string;
  /** Stands in for a logo we don't have a licensed asset for yet. */
  lettermark: string;
  blurb: string;
  /** Highlighter token for the lettermark tile. */
  ink: string;
  kind: "app" | "calendar";
};

export const COMING_SOON: SoonApp[] = [
  {
    key: "tigermenus",
    name: "TigerMenus",
    lettermark: "TM",
    blurb: "Browse the daily offerings from Princeton's dining halls.",
    ink: "var(--hl-mint)",
    kind: "app",
  },
  {
    key: "tigerfoodies",
    name: "TigerFoodies",
    lettermark: "TF",
    blurb:
      "Good food and better people. Meet friends of friends at Princeton and beyond.",
    ink: "var(--hl-lemon)",
    kind: "app",
  },
  {
    key: "applecal",
    name: "Apple Calendar (iCloud)",
    lettermark: "AC",
    blurb: "The same read-only look at your week, for everyone on iCloud.",
    ink: "var(--hl-violet)",
    kind: "calendar",
  },
];

/** The bottom "bring your own" row. Separate: it isn't one named app. */
export const CUSTOM_APP_SOON: SoonApp = {
  key: "custom",
  name: "Connect your Notion, Asana, or custom-made app",
  lettermark: "+",
  blurb: "Anything that speaks the same language as a TigerApp will plug in.",
  ink: "var(--hl-cyan)",
  kind: "app",
};

/**
 * The wireframe switches TigerApps' own apps on by default; a student can
 * flip any of them off. Google Calendar stays off until its consent round-trip.
 */
export const DEFAULT_APPS: AppKey[] = [
  "junction",
  "princetoncourses",
  "path",
  "snatch",
];

/**
 * What the master switch on My apps puts back when it has no record of what
 * the student had switched on. Deliberately NOT DEFAULT_APPS: that's the
 * starting hand for someone who has never chosen, while this fires for someone
 * who chose to switch everything off. One switch can't stand in for four
 * separate yeses, so it restores the one app the rest of the desk is built
 * around and leaves the others to their own toggles.
 */
export const MASTER_RESTORE_APPS: AppKey[] = ["junction"];

/**
 * The engine's /junction/mcp scope registers every tool these apps' own
 * scopes do, so when TigerJunction is on their endpoints are never opened —
 * their tools arrive through the junction connection instead. Which app a
 * tool *belongs* to (for consent and attribution) is TOOL_OWNERS' job.
 */
export const COVERED_BY_JUNCTION: AppKey[] = [
  "princetoncourses",
  "snatch",
  "path",
];

/**
 * Data provenance per engine tool, independent of which scope served the
 * call: seat-watch data is TigerSnatch's whether it came over /snatch/mcp or
 * /junction/mcp. Used by the server to drop tools whose owner is switched
 * off, and by the client to say "Worked from TigerSnatch" truthfully. Tools
 * not listed belong to the scope that served them.
 */
export const TOOL_OWNERS: Record<string, AppKey> = {
  get_snatch_subscriptions: "snatch",
  subscribe_to_snatch: "snatch",
  unsubscribe_from_snatch: "snatch",
  get_course_demand: "snatch",
  get_trending_courses: "snatch",
  get_course_historical_demand: "snatch",
  get_requirement_tree: "path",
  get_requirement_node: "path",
  course_timing_distribution: "path",
  major_schedule_overview: "path",
  course_popularity: "path",
  get_major_stats: "path",
  get_user_schedule: "path",
  update_user_schedule: "path",
  get_course_evaluations: "princetoncourses",
  find_top_rated_courses: "princetoncourses",
  summarize_course_reviews: "princetoncourses",
  get_instructor: "princetoncourses",
  search_instructors: "princetoncourses",
  get_instructor_courses: "princetoncourses",
};

/**
 * A safety net under TOOL_OWNERS, for the engine tools it hasn't caught up
 * with: a rename, a versioned alias, a new sibling. Falling back to "whoever
 * served it" would hand every one of those to TigerJunction — which both
 * defeats the consent gate (a student with TigerSnatch off would get seat
 * tools anyway) and puts the wrong app's name on the card. Each fragment is
 * either an app's own name or a phrase TOOL_OWNERS already assigns to it, so
 * no other app on the engine names a tool this way.
 *
 * This can't catch a genuinely new tool under a new name; ownership is only
 * ever as good as this file, and a new engine tool still belongs in
 * TOOL_OWNERS above.
 */
const OWNER_HINTS: Array<[AppKey, RegExp]> = [
  ["snatch", /snatch|seat_watch|course_demand|trending_course|historical_demand/],
  ["path", /requirement_(tree|node)|major_stats|major_schedule/],
  ["princetoncourses", /evaluation|instructor|course_reviews/],
];

/** Which app a tool's data belongs to, given the app whose scope served it. */
export function toolOwner(base: string, servedBy: AppKey | null): AppKey | null {
  const named = TOOL_OWNERS[base];
  if (named) return named;
  for (const [app, pattern] of OWNER_HINTS) {
    if (pattern.test(base)) return app;
  }
  return servedBy;
}

/**
 * Apps PI can genuinely read right now. Google Calendar counts only once its
 * consent round-trip has finished, so no surface claims a connection the
 * student hasn't granted yet.
 */
export function countConnected(
  apps: AppKey[],
  opts: { gcalReady?: boolean } = {}
): number {
  return apps.filter((a) => a !== "gcal" || opts.gcalReady === true).length;
}

export const DEFAULT_ENGINE_BASE = "https://junction-engine.tigerapps.org";

/** Models the switcher offers. */
export type PiModel = "claude-opus-5" | "claude-sonnet-5";

export const PI_MODELS: Array<{ value: PiModel; label: string }> = [
  { value: "claude-opus-5", label: "Opus 5, sharpest" },
  { value: "claude-sonnet-5", label: "Sonnet 5, quicker" },
];

/** Settings the client pushes to a Pi agent instance. */
export type PiSettings = {
  netid: string;
  apps: AppKey[];
  model: PiModel;
};

export const DEFAULT_SETTINGS: PiSettings = {
  netid: "",
  apps: DEFAULT_APPS,
  model: "claude-opus-5",
};
