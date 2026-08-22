import { PI_APPS, type AppKey } from "../../shared/apps";

/**
 * Helpers for turning raw tool-call message parts (including MCP tools,
 * whose results arrive as MCP content envelopes) into renderable data.
 */

export type ToolView = {
  /** Full AI SDK tool name, e.g. `tool_junction_get_schedule_details`. */
  toolName: string;
  /** Bare MCP tool name, e.g. `get_schedule_details`. */
  base: string;
  app: AppKey | null;
  state: string;
  input: unknown;
  /** Parsed JSON payload from the tool result, when there is one. */
  data: unknown;
  errorText: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseToolPart(part: any): ToolView | null {
  let toolName: string;
  if (part?.type === "dynamic-tool" && typeof part.toolName === "string") {
    toolName = part.toolName;
  } else if (
    typeof part?.type === "string" &&
    part.type.startsWith("tool-")
  ) {
    toolName = part.type.slice("tool-".length);
  } else {
    return null;
  }

  let base = toolName;
  let app: AppKey | null = null;
  const namespaced = toolName.match(/^tool_([a-z0-9]+)_(.+)$/);
  if (namespaced) {
    base = namespaced[2];
    const found = PI_APPS.find(
      (a) => a.key.replace(/-/g, "") === namespaced[1]
    );
    app = found?.key ?? null;
  }

  const output = part.output ?? part.result;
  const { data, errorText } = extractPayload(output);

  return {
    toolName,
    base,
    app,
    state: typeof part.state === "string" ? part.state : "unknown",
    input: part.input,
    data,
    errorText: part.errorText ?? errorText,
  };
}

/** Digs the JSON payload out of an MCP result envelope (or plain output). */
function extractPayload(output: unknown): {
  data: unknown;
  errorText: string | null;
} {
  if (output == null) return { data: null, errorText: null };
  if (typeof output === "string") {
    return { data: tryJson(output), errorText: null };
  }
  if (typeof output === "object") {
    const o = output as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    if (Array.isArray(o.content)) {
      const text = o.content
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      if (o.isError) return { data: null, errorText: text || "Tool failed" };
      return { data: tryJson(text), errorText: null };
    }
    return { data: output, errorText: null };
  }
  return { data: output, errorText: null };
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/* ── schedule extraction (planner card) ──────────────────────────── */

export type Meeting = {
  courseCode: string;
  /** Section label, e.g. "L01" or "P01/P01A". */
  label: string;
  /** Section category letter — L, P, S, C, U, B… */
  category: string;
  days: string[];
  startMin: number;
  endMin: number;
  startLabel: string;
  endLabel: string;
  room: string | null;
  /**
   * TigerJunction semantics: a section type with exactly one meeting time is
   * locked in; multiple times means the student hasn't picked yet, and those
   * render as striped "options".
   */
  confirmed: boolean;
  conflicted: boolean;
  /** Index into TJ_CAL_COLORS, one per course. */
  color: number;
};

export type CourseLegend = {
  code: string;
  color: number;
  /** Section categories still offering multiple time options. */
  pending: string[];
};

export type ScheduleView = {
  title?: string;
  termName?: string;
  meetings: Meeting[];
  /** Unique course codes with untimed (TBA) sections. */
  tba: string[];
  /** Overlaps among confirmed sections only, computed client-side. */
  conflicts: string[];
  courses: CourseLegend[];
};

/**
 * TigerJunction's default ReCal calendar palette (apps/web styles.ts),
 * so PI's planner reads like the real thing.
 */
export const TJ_CAL_COLORS: Array<[number, number, number]> = [
  [120, 52, 75], // green
  [35, 99, 65], // orange
  [197, 34, 72], // steel blue
  [60, 95, 74], // yellow
  [330, 100, 80], // pink
  [305, 33, 70], // purple
  [1, 100, 69], // red
];

export function tjColor(index: number, darken = 0): string {
  const [h, s, l] = TJ_CAL_COLORS[index % TJ_CAL_COLORS.length];
  return `hsl(${h}, ${s}%, ${Math.max(0, Math.min(100, l - darken))}%)`;
}

export function parseTime(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/**
 * Recognizes get_schedule_details / verify_schedule–shaped payloads.
 *
 * The engine returns EVERY section of every course (all precept options,
 * duplicates and all), so this does what TigerJunction's calendar does:
 * merge sections that share a course + type + meeting time, treat a type
 * with one time as locked in, and everything else as options.
 */
export function extractSchedule(data: unknown): ScheduleView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const sections = d.sections ?? d.meetings;
  if (!Array.isArray(sections) || sections.length === 0) return null;

  type Raw = {
    courseCode: string;
    title: string;
    category: string;
    days: string[];
    startMin: number | null;
    endMin: number | null;
    startLabel: string;
    endLabel: string;
    room: string | null;
  };
  const raw: Raw[] = [];
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const courseCode = String(s.courseCode ?? s.code ?? s.course ?? "?");
    const title = String(s.sectionTitle ?? s.section ?? "");
    const days = Array.isArray(s.days)
      ? s.days.map(String)
      : typeof s.days === "string"
        ? s.days.split(/[,\s]+/).filter(Boolean)
        : [];
    const startLabel = String(s.startTime ?? "TBA");
    const endLabel = String(s.endTime ?? "TBA");
    raw.push({
      courseCode,
      title,
      category: (title.match(/^[A-Za-z]/)?.[0] ?? "L").toUpperCase(),
      days,
      startMin: parseTime(startLabel),
      endMin: parseTime(endLabel),
      startLabel,
      endLabel,
      room: s.room ?? null,
    });
  }
  if (raw.length === 0) return null;

  // One palette color per course, in order of first appearance.
  const colorOf = new Map<string, number>();
  for (const r of raw) {
    if (!colorOf.has(r.courseCode)) colorOf.set(r.courseCode, colorOf.size);
  }

  // Merge identical meeting times (e.g. P01 and P01A at the same slot).
  const merged = new Map<string, Raw & { titles: string[] }>();
  const tbaCodes = new Set<string>();
  for (const r of raw) {
    if (r.startMin == null || r.days.length === 0) {
      tbaCodes.add(r.courseCode);
      continue;
    }
    const key = [
      r.courseCode,
      r.category,
      [...r.days].sort().join(","),
      r.startMin,
      r.endMin,
    ].join("|");
    const hit = merged.get(key);
    if (hit) {
      if (!hit.titles.includes(r.title)) hit.titles.push(r.title);
    } else {
      merged.set(key, { ...r, titles: [r.title] });
    }
  }

  // A course's section type is confirmed when it has exactly one time slot.
  const slotsPerType = new Map<string, number>();
  for (const m of merged.values()) {
    const k = `${m.courseCode}|${m.category}`;
    slotsPerType.set(k, (slotsPerType.get(k) ?? 0) + 1);
  }

  const meetings: Meeting[] = [...merged.values()].map((m) => {
    const label =
      m.titles.length <= 2
        ? m.titles.join("/")
        : `${m.titles[0]} +${m.titles.length - 1}`;
    return {
      courseCode: m.courseCode,
      label,
      category: m.category,
      days: m.days,
      startMin: m.startMin!,
      endMin: m.endMin ?? m.startMin! + 50,
      startLabel: m.startLabel,
      endLabel: m.endLabel,
      room: m.room,
      confirmed: (slotsPerType.get(`${m.courseCode}|${m.category}`) ?? 1) === 1,
      conflicted: false,
      color: colorOf.get(m.courseCode) ?? 0,
    };
  });

  // Conflicts among confirmed sections only — the engine's list also pits
  // unpicked options against each other, which is just noise.
  const conflicts: string[] = [];
  const confirmed = meetings.filter((m) => m.confirmed);
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      const a = confirmed[i];
      const b = confirmed[j];
      if (a.courseCode === b.courseCode) continue;
      const sharedDay = a.days.some((day) =>
        b.days.some((other) => sameDay(day, other))
      );
      if (!sharedDay) continue;
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        a.conflicted = true;
        b.conflicted = true;
        conflicts.push(
          `${a.courseCode} (${a.label}) overlaps ${b.courseCode} (${b.label})`
        );
      }
    }
  }

  const courses: CourseLegend[] = [...colorOf.entries()].map(
    ([code, color]) => {
      const pending = new Set<string>();
      for (const [key, count] of slotsPerType) {
        const [c, cat] = key.split("|");
        if (c === code && count > 1) pending.add(cat);
      }
      return { code, color, pending: [...pending].sort() };
    }
  );

  if (meetings.length === 0 && tbaCodes.size === 0) return null;

  return {
    title: d.schedule?.title,
    termName: d.schedule?.termName,
    meetings,
    tba: [...tbaCodes].sort(),
    conflicts,
    courses,
  };
}

function sameDay(a: string, b: string): boolean {
  const norm = (d: string) => {
    const t = d.trim().toLowerCase();
    if (t.startsWith("th")) return "th";
    if (t.startsWith("m")) return "m";
    if (t.startsWith("t")) return "t";
    if (t.startsWith("w")) return "w";
    if (t.startsWith("f")) return "f";
    return t;
  };
  return norm(a) === norm(b);
}

/* ── course list extraction ──────────────────────────────────────── */

export type CourseRowData = {
  code: string;
  title: string;
  status?: string;
  rating?: number | null;
  meta?: string;
};

export function extractCourses(data: unknown): CourseRowData[] | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const list =
    d.courses ?? d.results ?? d.topCourses ?? d.trending ?? d.subscriptions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const rows: CourseRowData[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const code = c.code ?? c.courseCode ?? c.course ?? null;
    if (!code) continue;
    const rating =
      typeof c.rating === "number"
        ? c.rating
        : typeof c.score === "number"
          ? c.score
          : typeof c.overallRating === "number"
            ? c.overallRating
            : null;
    const bits: string[] = [];
    if (typeof c.dist === "string" && c.dist) bits.push(c.dist);
    if (Array.isArray(c.dists)) bits.push(c.dists.join(", "));
    if (typeof c.termName === "string") bits.push(c.termName);
    else if (typeof c.term === "number") {
      const name = termCodeToName(c.term);
      if (name) bits.push(name);
    }
    if (typeof c.instructor === "string") bits.push(c.instructor);
    rows.push({
      code: String(code),
      title: String(c.title ?? c.name ?? ""),
      status: c.status ? String(c.status) : undefined,
      rating,
      meta: bits.join(" · ") || undefined,
    });
  }
  return rows.length > 0 ? rows : null;
}

/** Princeton term code → name, e.g. 1272 → "Fall 2026", 1274 → "Spring 2027". */
export function termCodeToName(code: number): string | null {
  const s = String(code);
  if (!/^1\d{2}[24]$/.test(s)) return null;
  const yearEnd = 2000 + parseInt(s.slice(1, 3), 10);
  return s.endsWith("2") ? `Fall ${yearEnd - 1}` : `Spring ${yearEnd}`;
}

/** Highlighter rotation for planner blocks and swatches. */
export const HIGHLIGHTERS = [
  "var(--hl-cyan)",
  "var(--hl-pink)",
  "var(--hl-lemon)",
  "var(--hl-violet)",
  "var(--hl-mint)",
  "var(--hl-orange)",
];

export function highlighterFor(code: string, palette: Map<string, string>) {
  if (!palette.has(code)) {
    palette.set(code, HIGHLIGHTERS[palette.size % HIGHLIGHTERS.length]);
  }
  return palette.get(code)!;
}

export const APP_INK: Record<AppKey, string> = {
  junction: "var(--hl-cyan)",
  princetoncourses: "var(--hl-orange)",
  path: "var(--hl-violet)",
  snatch: "var(--hl-pink)",
};
