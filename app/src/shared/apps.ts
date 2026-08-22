/**
 * The catalog of TigerApps that PI can connect to. Each app maps 1:1 to a
 * scoped MCP endpoint served by the junction engine. Shared by the server
 * (connection management) and the client (the "My apps" page).
 */

export type AppKey = "junction" | "princetoncourses" | "path" | "snatch";

export type PiApp = {
  key: AppKey;
  name: string;
  /** Path appended to the engine base URL. */
  mcpPath: string;
  /** The app's own front door, for link-outs and friendly error CTAs. */
  home: string;
  /** Two-letter mark shown when the logo can't load. */
  glyph: string;
  /** Path to the app's official logo (served from /public). */
  logo: string;
  tagline: string;
  detail: string;
  /** Highlighter color token used across the UI for this app. */
  ink: "cyan" | "orange" | "violet" | "pink";
  /** Whether tools need to know who the user is to be useful. */
  personal: boolean;
};

export const PI_APPS: PiApp[] = [
  {
    key: "junction",
    home: "https://junction.tigerapps.org",
    logo: "/logos/tigerjunction.png",
    glyph: "TJ",
    name: "TigerJunction",
    mcpPath: "/junction/mcp",
    tagline: "Course planning & schedules",
    detail:
      "Search the catalog, build and edit ReCal schedules, check conflicts, and watch course demand.",
    ink: "cyan",
    personal: true,
  },
  {
    key: "princetoncourses",
    home: "https://courses.tigerapps.org",
    logo: "/logos/princetoncourses.png",
    glyph: "PC",
    name: "PrincetonCourses",
    mcpPath: "/princetoncourses/mcp",
    tagline: "Ratings & evaluations",
    detail:
      "Course evaluations, instructor history, top-rated courses, and review summaries.",
    ink: "orange",
    personal: false,
  },
  {
    key: "path",
    home: "https://www.tigerpath.io",
    logo: "/logos/tigerpath.png",
    glyph: "TP",
    name: "TigerPath",
    mcpPath: "/path/mcp",
    tagline: "Degree requirements",
    detail:
      "Major requirement trees, four-year plans, and what's left to satisfy your degree.",
    ink: "violet",
    personal: true,
  },
  {
    key: "snatch",
    home: "https://tigersnatch.com",
    logo: "/logos/tigersnatch.svg",
    glyph: "TS",
    name: "TigerSnatch",
    mcpPath: "/snatch/mcp",
    tagline: "Seat alerts & demand",
    detail:
      "Subscribe to full sections, get notified when seats open, and see trending courses.",
    ink: "pink",
    personal: true,
  },
];

export const DEFAULT_APPS: AppKey[] = ["junction"];

export const DEFAULT_ENGINE_BASE = "https://junction-engine.tigerapps.org";

/** Models the switcher offers. Claude models fall back to campus without a key. */
export type PiModel = "claude-opus-5" | "claude-sonnet-5" | "campus";

export const PI_MODELS: Array<{ value: PiModel; label: string }> = [
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "campus", label: "Campus" },
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
