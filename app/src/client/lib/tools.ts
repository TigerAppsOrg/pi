import { PI_APPS, toolOwner, type AppKey } from "../../shared/apps";

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
  // Fractional minutes appear when the engine mis-decodes TigerJunction's
  // 10-minute time units (see decodeCompressedTimes below).
  const m = label.trim().match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseFloat(m[2]);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** Minutes-since-midnight → "1:05 PM". */
export function fmtTime(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

/** Minutes → TJ-style in-block range label, "12:15-1:05". */
export function fmtRange(start: number, end: number): string {
  const short = (min: number) => {
    const h24 = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h24 % 12 || 12}:${String(m).padStart(2, "0")}`;
  };
  return `${short(start)}-${short(end)}`;
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

  // The deployed engine renders TigerJunction's Supabase times as if the
  // stored value were minutes-past-8am, but junction actually stores
  // 10-minute units (web convert.ts: hour = value/6 + 8). The tell: every
  // "time" lands before 10 AM, often with fractional minutes. Undo it:
  // real = (mislabeled - 480) * 10 + 480. Harmless once the engine is
  // fixed, because genuine schedules never trip the detector.
  const timed = raw.filter((r) => r.startMin != null);
  const compressed =
    timed.length > 0 &&
    timed.every(
      (r) => r.startMin! < 600 && (r.endMin == null || r.endMin < 600)
    );
  if (compressed) {
    for (const r of timed) {
      r.startMin = Math.round((r.startMin! - 480) * 10 + 480);
      if (r.endMin != null) r.endMin = Math.round((r.endMin - 480) * 10 + 480);
      r.startLabel = fmtTime(r.startMin);
      if (r.endMin != null) r.endLabel = fmtTime(r.endMin);
    }
  } else {
    // Normalize any fractional minutes either way.
    for (const r of timed) {
      r.startMin = Math.round(r.startMin!);
      if (r.endMin != null) r.endMin = Math.round(r.endMin);
    }
  }

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
  /** Students waiting for a seat, when the payload counts them. */
  waiting?: number;
  /** Deep link to this offering on PrincetonCourses, when derivable. */
  pcUrl?: string;
  /** Deep link to this course on TigerSnatch, as the payload gave it. */
  snatchUrl?: string;
};

const PC_HOME = PI_APPS.find((a) => a.key === "princetoncourses")!.home;

/**
 * PrincetonCourses keys courses by registrar guid = term + courseID
 * (e.g. 1264002051). The engine hands us "002051-1264" ids or
 * listingId + term pairs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pcCourseUrl(c: any): string | undefined {
  if (typeof c.id === "string") {
    const m = c.id.match(/^(\d{6})-(\d{4})$/);
    if (m) return `${PC_HOME}/course/${m[2]}${m[1]}`;
  }
  const listing = c.listingId ?? c.listing_id;
  const term = typeof c.term === "number" ? c.term : undefined;
  if (typeof listing === "string" && /^\d{6}$/.test(listing) && term) {
    return `${PC_HOME}/course/${term}${listing}`;
  }
  return undefined;
}

/**
 * The generic list treatment, used for every app's course payloads. `owner` is
 * the app whose data this is (see ownerOf): a count of students waiting for a
 * seat is a thing only TigerSnatch measures, so it's only read off a payload
 * that belongs to TigerSnatch. Any other app's `size` means something else
 * entirely, and printing it as "239 waiting" would be an invented number.
 */
export function extractCourses(
  data: unknown,
  owner: AppKey | null = null
): CourseRowData[] | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const list =
    d.courses ?? d.results ?? d.topCourses ?? d.trending ?? d.subscriptions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const rows: CourseRowData[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const code = c.code ?? c.courseCode ?? c.course ?? deptNum(c.deptnum);
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
    // "size" is TigerSnatch's word for the queue on a course: how many
    // students are waiting for a seat in it right now. Nobody else's payload
    // means that by it, so nobody else's is read for it.
    const waiting =
      owner === "snatch" ? firstNumber([c.size, c.subscribers]) : null;
    rows.push({
      code: String(code),
      title: String(c.title ?? c.name ?? ""),
      status: c.status ? String(c.status) : undefined,
      rating,
      meta: bits.join(" · ") || undefined,
      waiting: waiting ?? undefined,
      pcUrl: pcCourseUrl(c),
      snatchUrl: httpUrl(c.course_page_url) ?? undefined,
    });
  }
  return rows.length > 0 ? rows : null;
}

/* ── TigerSnatch extraction (seat watches, demand, history) ──────── */

/**
 * Everything below reads the engine's TigerSnatch payloads exactly as they
 * arrive. Each extractor returns null the moment the shape isn't the one it
 * knows, so a card never invents a field the payload didn't carry — an empty
 * watch list and "no TigerSnatch account yet" are different answers, and a
 * seat count PI didn't get is simply not drawn.
 */

export const SNATCH_HOME = PI_APPS.find((a) => a.key === "snatch")!.home;

/** "COS226" → "COS 226". Cross-listings keep their slash. */
export function deptNum(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  return text
    .split("/")
    .map((part) => {
      const m = part.trim().match(/^([A-Za-z]{2,4})\s*(\d{3}[A-Za-z]?)$/);
      return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : part.trim();
    })
    .join("/");
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function httpUrl(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

/** A whole number with thousands separators: 2781 → "2,781". */
export function count(n: number): string {
  return n.toLocaleString();
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Reads a percentage out of "66%", "232/350 (66%)", or a bare number. */
function pct(value: unknown): number | null {
  const direct = num(value);
  if (direct != null) return clampPct(direct);
  if (typeof value !== "string") return null;
  const percent = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) return clampPct(parseFloat(percent[1]));
  const ratio = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (ratio && Number(ratio[2]) > 0) {
    return clampPct((Number(ratio[1]) / Number(ratio[2])) * 100);
  }
  return null;
}

function ratioPct(taken: number | null, total: number | null): number | null {
  if (taken == null || total == null || total <= 0) return null;
  return clampPct((taken / total) * 100);
}

/**
 * The engine writes a verdict and its reason on one line, joined by a dash
 * ("Very Competitive — fills every term"). Cards set them on two lines
 * instead, so no dash ever reaches a student.
 */
function splitDash(text: string): [string, string | null] {
  const m = text.match(/^(.*?)\s*[—–]\s+(.+)$/s);
  return m ? [m[1].trim(), m[2].trim()] : [text.trim(), null];
}

/** "Growing (+20% capacity since Fall 2024)" → value and the aside. */
function splitParen(text: string): [string, string | null] {
  const m = text.match(/^([^(]+?)\s*\((.+)\)\s*$/s);
  return m ? [m[1].trim(), m[2].trim()] : [text.trim(), null];
}

/* — get_snatch_subscriptions — */

export type WatchRow = {
  code: string;
  name: string | null;
  section: string | null;
  /** The course's own page on TigerSnatch, when the payload linked it. */
  url: string | null;
};

export type WatchesView = {
  rows: WatchRow[];
  /** TigerSnatch puts the student back on the list after each alert. */
  autoResubscribe: boolean;
  /** No TigerSnatch account yet, which is not the same as watching nothing. */
  noAccount: boolean;
};

export function extractWatches(data: unknown): WatchesView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (!Array.isArray(d.subscriptions)) return null;

  const rows: WatchRow[] = [];
  for (const s of d.subscriptions) {
    if (!s || typeof s !== "object") continue;
    const code = deptNum(s.deptnum) ?? str(s.course) ?? str(s.code);
    if (!code) continue;
    rows.push({
      code,
      name: str(s.name) ?? str(s.title),
      section: str(s.section),
      url: httpUrl(s.course_page_url),
    });
  }
  // Rows that all failed to parse mean this isn't the payload we think it is.
  if (d.subscriptions.length > 0 && rows.length === 0) return null;

  const message = str(d.message);
  return {
    rows,
    autoResubscribe: d.autoResubscribe === true,
    noAccount:
      rows.length === 0 &&
      message != null &&
      /no tigersnatch account/i.test(message),
  };
}

/* — get_course_demand — */

export type DemandSection = {
  section: string;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  enrollment: number | null;
  capacity: number | null;
  fillPercent: number | null;
  isOpen: boolean | null;
  subscribers: number | null;
};

export type DemandView = {
  code: string;
  title: string | null;
  /** As the engine phrased it: "232/350 (66%)". */
  overallFill: string | null;
  overallPercent: number | null;
  hasReservedSeats: boolean;
  totalSubscribers: number | null;
  sections: DemandSection[];
};

export function extractDemand(data: unknown): DemandView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const code = deptNum(d.course) ?? str(d.course);
  if (!code || !Array.isArray(d.sections)) return null;
  // The tell against a schedule payload, which also carries `sections`:
  // demand counts seats.
  const isDemand =
    typeof d.overallFill === "string" ||
    typeof d.totalSubscribers === "number" ||
    typeof d.hasReservedSeats === "boolean";
  if (!isDemand) return null;

  const sections: DemandSection[] = [];
  for (const s of d.sections) {
    if (!s || typeof s !== "object") continue;
    const label = str(s.section);
    if (!label) continue;
    const enrollment = num(s.enrollment);
    const capacity = num(s.capacity);
    sections.push({
      section: label,
      days: str(s.days),
      startTime: str(s.startTime),
      endTime: str(s.endTime),
      enrollment,
      capacity,
      fillPercent: pct(s.fillPercent) ?? ratioPct(enrollment, capacity),
      isOpen: typeof s.isOpen === "boolean" ? s.isOpen : null,
      subscribers: num(s.subscribers),
    });
  }

  return {
    code,
    title: str(d.title),
    overallFill: str(d.overallFill),
    overallPercent: pct(d.overallFill),
    hasReservedSeats: d.hasReservedSeats === true,
    totalSubscribers: num(d.totalSubscribers),
    sections,
  };
}

/* — get_trending_courses — */

export type TrendingRow = {
  code: string;
  name: string | null;
  section: string | null;
  /** Students waiting for a seat (add/drop). */
  waiting: number | null;
  enrollment: number | null;
  capacity: number | null;
  fillPercent: number | null;
  url: string | null;
};

export type TrendingView = {
  term: string | null;
  /** Only set between semesters, with its explainer split onto a second line. */
  statusLead: string | null;
  statusNote: string | null;
  /** What the rows count: a queue for a seat, or the seats already taken. */
  mode: "waiting" | "enrolled";
  rows: TrendingRow[];
  /** Platform totals, already worded. Rendered as one quiet footer line. */
  stats: string[];
  lastUpdated: string | null;
};

export function extractTrending(data: unknown): TrendingView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const spiking = Array.isArray(d.trendingCourses) ? d.trendingCourses : null;
  const filled = Array.isArray(d.topEnrolled) ? d.topEnrolled : null;
  if (!spiking && !filled) return null;

  const rows: TrendingRow[] = [];
  for (const c of spiking ?? filled ?? []) {
    if (!c || typeof c !== "object") continue;
    const code = deptNum(c.deptnum) ?? str(c.course) ?? str(c.code);
    if (!code) continue;
    const enrollment = num(c.enrollment);
    const capacity = num(c.capacity);
    rows.push({
      code,
      name: str(c.name) ?? str(c.title),
      section: str(c.section),
      waiting: num(c.size) ?? num(c.subscribers),
      enrollment,
      capacity,
      fillPercent: pct(c.fillPercent) ?? ratioPct(enrollment, capacity),
      url: httpUrl(c.course_page_url),
    });
  }
  if (rows.length === 0) return null;

  const status = str(d.status);
  const [statusLead, statusNote] = status ? splitDash(status) : [null, null];
  return {
    term: str(d.term),
    statusLead,
    statusNote,
    mode: spiking ? "waiting" : "enrolled",
    rows,
    stats: platformStats(d.platformStats),
    lastUpdated: str(d.lastUpdated),
  };
}

/** Turns whichever totals the payload carries into plain phrases. */
function platformStats(raw: unknown): string[] {
  if (raw == null || typeof raw !== "object") return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = raw as any;
  const out: string[] = [];
  const watches = num(p.totalSubscriptions);
  const courses = num(p.subscribedCourses);
  const students = num(p.subscribedUsers);
  const sections = num(p.subscribedSections);
  if (watches != null) {
    out.push(
      courses != null
        ? `${count(watches)} seat watches across ${count(courses)} courses`
        : `${count(watches)} seat watches`
    );
  } else if (courses != null) {
    out.push(`${count(courses)} courses being watched`);
  }
  if (students != null) out.push(`${count(students)} students watching`);
  if (watches == null && sections != null) {
    out.push(`${count(sections)} sections`);
  }
  const everStudents = num(p.totalUsersAllTime);
  if (everStudents != null) {
    out.push(`${count(everStudents)} students have used TigerSnatch`);
  }
  const everAlerts = num(p.totalNotificationsAllTime);
  if (everAlerts != null) out.push(`${count(everAlerts)} seat alerts sent`);
  return out;
}

/* — get_course_historical_demand — */

export type HistoryTerm = {
  termName: string;
  courseStatus: string | null;
  totalEnrolled: number | null;
  totalCapacity: number | null;
  /** As the engine phrased it: "85%". */
  fillRate: string | null;
  fillPercent: number | null;
  sections: number | null;
  closedSections: number | null;
  canceledSections: number | null;
};

export type HistoryView = {
  code: string;
  title: string | null;
  /** "Very Competitive", with its reason on the second line. */
  competitiveness: string | null;
  competitivenessNote: string | null;
  averageFillRate: string | null;
  timesFullyClosed: string | null;
  timesWithClosedSections: string | null;
  /** "Growing", with "+20% capacity since Fall 2024" as the aside. */
  capacityTrend: string | null;
  capacityTrendNote: string | null;
  terms: HistoryTerm[];
};

export function extractHistory(data: unknown): HistoryView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const code = deptNum(d.course) ?? str(d.course);
  if (!code || !Array.isArray(d.history)) return null;
  const verdict = str(d.competitiveness);
  const trend = str(d.capacityTrend);
  const average = str(d.averageFillRate);
  const closed = str(d.timesFullyClosed);
  if (!verdict && !trend && !average && !closed) return null;

  const terms: HistoryTerm[] = [];
  for (const t of d.history) {
    if (!t || typeof t !== "object") continue;
    const termName =
      str(t.termName) ??
      (num(t.term) != null ? termCodeToName(num(t.term)!) : null) ??
      str(t.term);
    if (!termName) continue;
    const totalEnrolled = num(t.totalEnrolled);
    const totalCapacity = num(t.totalCapacity);
    terms.push({
      termName,
      courseStatus: str(t.courseStatus),
      totalEnrolled,
      totalCapacity,
      fillRate: str(t.fillRate),
      fillPercent: pct(t.fillRate) ?? ratioPct(totalEnrolled, totalCapacity),
      sections: num(t.sections),
      closedSections: num(t.closedSections),
      canceledSections: num(t.canceledSections),
    });
  }

  const [competitiveness, competitivenessNote] = verdict
    ? splitDash(verdict)
    : [null, null];
  const [capacityTrend, capacityTrendNote] = trend
    ? splitParen(trend)
    : [null, null];
  return {
    code,
    title: str(d.title),
    competitiveness,
    competitivenessNote,
    averageFillRate: average,
    timesFullyClosed: closed,
    timesWithClosedSections: str(d.timesWithClosedSections),
    capacityTrend,
    capacityTrendNote,
    terms,
  };
}

/* — subscribe_to_snatch / unsubscribe_from_snatch — */

export type SubscriptionChange = {
  /** True after subscribing, false after unsubscribing. */
  watching: boolean;
  code: string;
  title: string | null;
  section: string | null;
  message: string | null;
};

export function extractSubscriptionChange(
  data: unknown
): SubscriptionChange | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const watching =
    d.subscribed === true ? true : d.unsubscribed === true ? false : null;
  if (watching === null) return null;
  const course = str(d.course);
  if (!course) return null;
  // The engine hands back "COS 226 — Algorithms and Data Structures".
  const [rawCode, title] = splitDash(course);
  return {
    watching,
    code: deptNum(rawCode) ?? rawCode,
    title,
    section: str(d.section),
    message: str(d.message),
  };
}

/* — "which section?" — */

export type SectionOption = {
  section: string;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  /** "open" or "closed", as the payload said. */
  status: string | null;
  enrolled: number | null;
  capacity: number | null;
};

export type SectionChoice = {
  code: string;
  title: string | null;
  options: SectionOption[];
};

/**
 * A course with several sections and no section named comes back two ways
 * while the engine changes over: today as a tool error whose text lists the
 * sections, and soon as a plain `needsSection` result. Both land here so the
 * student sees the same rows either way.
 */
export function extractSectionChoice(
  data: unknown,
  errorText: string | null
): SectionChoice | null {
  if (data != null && typeof data === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    if (d.needsSection === true && Array.isArray(d.sections)) {
      const options: SectionOption[] = [];
      for (const s of d.sections) {
        if (!s || typeof s !== "object") continue;
        const label = str(s.title) ?? str(s.section);
        if (!label) continue;
        options.push({
          section: label,
          days: str(s.days),
          startTime: str(s.startTime),
          endTime: str(s.endTime),
          status: str(s.status)?.toLowerCase() ?? null,
          enrolled: num(s.enrolled),
          capacity: num(s.capacity),
        });
      }
      const code = deptNum(d.course) ?? str(d.course);
      if (code && options.length > 0) {
        return { code, title: str(d.title), options };
      }
    }
  }
  return parseSectionList(errorText);
}

/**
 * The legacy error text: "COS 226 has 4 sections. Please specify which one:".
 *
 * The sentence arrives wrapped — the AI SDK hands a thrown JSON-RPC error over
 * as "MCP error -32602: COS 226 has 4 sections. …" — so the course code is
 * matched by its own shape rather than by "everything before `has`", which
 * would swallow the transport's prefix and print it back at the student. Text
 * that doesn't hold a course code isn't this answer at all: return null and let
 * it fall through to the ordinary error chip.
 */
function parseSectionList(text: string | null): SectionChoice | null {
  if (!text) return null;
  const head = text.match(
    /([A-Za-z]{2,4}\s*\d{3}[A-Za-z]?)\s+has\s+\d+\s+sections?\.\s*Please specify which one:?/i
  );
  if (!head || head.index == null) return null;
  const code = deptNum(head[1]);
  if (!code) return null;

  const options: SectionOption[] = [];
  const rest = text.slice(head.index + head[0].length);
  for (const line of rest.split("\n")) {
    const row = line.trim().replace(/^[-•*]\s*/, "");
    if (!row) continue;
    const m = row.match(/^([A-Za-z]{0,2}\d{2,3}[A-Za-z]?)\s*(?:\((.*)\))?$/);
    if (!m) continue;
    options.push({ section: m[1], ...readSectionDetail(m[2] ?? null) });
  }
  return options.length > 0 ? { code, title: null, options } : null;
}

/** "TTh 1:20 PM–2:40 PM, open, 116/180 enrolled" → the fields it actually holds. */
function readSectionDetail(inner: string | null): Omit<SectionOption, "section"> {
  const detail: Omit<SectionOption, "section"> = {
    days: null,
    startTime: null,
    endTime: null,
    status: null,
    enrolled: null,
    capacity: null,
  };
  if (!inner) return detail;
  for (const raw of inner.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (/^(open|closed|canceled|cancelled)$/i.test(part)) {
      detail.status = part.toLowerCase();
      continue;
    }
    const seats = part.match(/^(\d+)\s*\/\s*(\d+)\b/);
    if (seats) {
      detail.enrolled = Number(seats[1]);
      detail.capacity = Number(seats[2]);
      continue;
    }
    const when = part.match(
      /^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[–—-]\s*(\d{1,2}:\d{2}\s*[AP]M)$/i
    );
    if (when) {
      detail.days = when[1];
      detail.startTime = when[2];
      detail.endTime = when[3];
      continue;
    }
    if (detail.days == null && /^(M|T|W|Th|F|Su|Sa)+$/.test(part)) {
      detail.days = part;
    }
  }
  return detail;
}

/** "TTh" + "1:20 PM" + "2:40 PM" → "TTh 1:20 PM–2:40 PM". */
export function meetingLabel(part: {
  days: string | null;
  startTime: string | null;
  endTime: string | null;
}): string | null {
  const time =
    part.startTime && part.endTime
      ? `${part.startTime}–${part.endTime}`
      : part.startTime;
  return [part.days, time].filter(Boolean).join(" ") || null;
}

/* ── evaluation extraction (PrincetonCourses evidence card) ──────── */

export type ReviewQuote = {
  text: string;
  /** Term or instructor the review is attached to, when the payload says. */
  from: string | null;
};

export type EvalLink = {
  /** Short badge text: "reviews", "QCR", "PDF". */
  label: string;
  href: string;
  /** Drives the badge colour. */
  kind: "reviews" | "qcr" | "pdf";
};

export type EvaluationView = {
  code: string | null;
  title: string | null;
  /** Out of 5, as PrincetonCourses reports it. */
  rating: number | null;
  /** Only set when the payload carries a real count — never inferred. */
  count: number | null;
  quotes: ReviewQuote[];
  links: EvalLink[];
};

/**
 * Recognizes a single-course evaluations payload: a rating and/or written
 * student reviews. Everything here is read straight off the payload — no
 * link is ever synthesized from a pattern the engine didn't hand us, apart
 * from the PrincetonCourses course page (which pcCourseUrl already derives
 * from the registrar guid).
 */
export function extractEvaluations(data: unknown): EvaluationView | null {
  if (data == null || typeof data !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  // The course itself may be the root, or nested one level down.
  const c = d.course ?? d.evaluation ?? d.evaluations ?? d;
  if (c == null || typeof c !== "object") return null;

  const quotes = readQuotes(d.reviews ?? d.comments ?? c.reviews ?? c.comments);
  const rating = firstNumber([
    c.rating,
    c.overallRating,
    c.score,
    d.rating,
    d.overallRating,
  ]);
  if (quotes.length === 0 && rating == null) return null;

  const links: EvalLink[] = [];
  const pc = pcCourseUrl(c) ?? pcCourseUrl(d);
  if (pc) links.push({ label: "reviews", href: pc, kind: "reviews" });
  const qcr = firstUrl([c.qcrUrl, c.evaluationUrl, d.qcrUrl, d.evaluationUrl]);
  if (qcr) links.push({ label: "QCR", href: qcr, kind: "qcr" });
  const pdf = firstUrl([c.pdfUrl, c.reportUrl, d.pdfUrl, d.reportUrl]);
  if (pdf) links.push({ label: "PDF", href: pdf, kind: "pdf" });

  const code = c.code ?? c.courseCode ?? c.course ?? d.code ?? null;
  return {
    code: code ? String(code) : null,
    title: c.title ?? c.name ? String(c.title ?? c.name) : null,
    rating,
    count: firstNumber([c.numRatings, c.reviewCount, c.ratingCount, d.count]),
    quotes: quotes.slice(0, 3),
    links,
  };
}

function readQuotes(list: unknown): ReviewQuote[] {
  if (!Array.isArray(list)) return [];
  const out: ReviewQuote[] = [];
  for (const item of list) {
    let text: string | null = null;
    let from: string | null = null;
    if (typeof item === "string") {
      text = item;
    } else if (item && typeof item === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = item as any;
      const raw = o.comment ?? o.text ?? o.review ?? o.body;
      if (typeof raw === "string") text = raw;
      const tag = o.termName ?? o.instructor ?? o.semester;
      if (typeof tag === "string" && tag.trim()) from = tag.trim();
      else if (typeof o.term === "number") from = termCodeToName(o.term);
    }
    const trimmed = text?.trim();
    if (!trimmed) continue;
    out.push({ text: trimmed, from });
  }
  return out;
}

function firstNumber(candidates: unknown[]): number | null {
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function firstUrl(candidates: unknown[]): string | null {
  for (const v of candidates) {
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
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
  gcal: "var(--hl-mint)",
};

/**
 * What to call the source of a tool call in front of a student. Tools PI
 * runs on its own (Think's file tools) belong to PI, not to a "workspace".
 */
export function appDisplayName(app: AppKey | null): string {
  return PI_APPS.find((a) => a.key === app)?.name ?? "PI's desk";
}

/**
 * Which app a tool call should be credited to. Not the same as the app whose
 * scope served it: with TigerJunction on, seat-watch tools arrive over the
 * junction connection but the data is still TigerSnatch's, and every surface
 * that names a source has to say so.
 */
export function ownerOf(view: { base: string; app: AppKey | null }): AppKey | null {
  return toolOwner(view.base, view.app);
}

/** The owning app's name, ready to print. */
export function ownerName(view: { base: string; app: AppKey | null }): string {
  return appDisplayName(ownerOf(view));
}

/** The owning app's highlighter, for dots and card spines. */
export function ownerInk(
  view: { base: string; app: AppKey | null },
  fallback = "var(--rule)"
): string {
  const owner = ownerOf(view);
  return owner ? APP_INK[owner] : fallback;
}

/* ── elicitation parts ───────────────────────────────────────────── */

/**
 * Two server tools render as UI instead of text. Their part types are
 * `tool-offer_choices` and `tool-request_app`; the shapes below must stay in
 * step with the zod schemas in src/server/pi.ts.
 */

export type ChoiceOption = { label: string; detail: string | null };

export type ChoicesAsk = {
  question: string;
  options: ChoiceOption[];
  multi: boolean;
  allowOther: boolean;
};

export type AppRequest = { app: AppKey; reason: string };

export const CHOICES_PART = "tool-offer_choices";
export const APP_REQUEST_PART = "tool-request_app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseChoicesAsk(part: any): ChoicesAsk | null {
  if (part?.type !== CHOICES_PART) return null;
  // A half-streamed input would flicker rows in and out as it arrives.
  if (part.state === "input-streaming") return null;
  const input = part.input;
  if (!input || typeof input !== "object") return null;
  const question = typeof input.question === "string" ? input.question : "";
  const options: ChoiceOption[] = [];
  if (Array.isArray(input.options)) {
    for (const o of input.options) {
      const label = typeof o?.label === "string" ? o.label.trim() : "";
      if (!label) continue;
      const detail = typeof o?.detail === "string" ? o.detail.trim() : "";
      options.push({ label, detail: detail || null });
    }
  }
  // A question with nothing to pick from is a text turn, not an ask.
  if (!question || options.length === 0) return null;
  return {
    question,
    options,
    multi: input.multi === true,
    allowOther: input.allowOther === true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAppRequest(part: any): AppRequest | null {
  if (part?.type !== APP_REQUEST_PART) return null;
  if (part.state === "input-streaming") return null;
  const input = part.input;
  if (!input || typeof input !== "object") return null;
  const app = PI_APPS.find((a) => a.key === input.app);
  if (!app) return null;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  return { app: app.key, reason };
}
