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

export const DEFAULT_APPS: AppKey[] = ["junction"];

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
