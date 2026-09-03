import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PI_APPS, type PiSettings } from "../../shared/apps";
import { IconChevron, IconExternal } from "../components/Icons";
import { friendlyError, rawError, useDesk } from "../lib/desk";
import {
  APP_INK,
  count,
  extractSchedule,
  extractTrending,
  extractWatches,
  fmtRange,
  tjColor,
  type ScheduleView,
  type TrendingRow,
} from "../lib/tools";
import "../styles/desk.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

/** Every card carries its own state, so no card ever borrows another's. */
type Load<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; err: unknown };

const JUNCTION = PI_APPS.find((a) => a.key === "junction")!;
const SNATCH = PI_APPS.find((a) => a.key === "snatch")!;

/** The teaser for TigerMenus: real halls, no invented menu. */
const DINING_HALLS = [
  { name: "RoMa", color: "var(--hl-mint)" },
  { name: "Yeh", color: "var(--hl-lemon)" },
  { name: "CJL", color: "var(--hl-orange)" },
  { name: "Whitman", color: "var(--hl-cyan)" },
  { name: "Forbes", color: "var(--hl-pink)" },
  { name: "Grad", color: "var(--rule)" },
];

function rowsOf(data: unknown, ...keys: string[]): AnyRow[] {
  if (data == null || typeof data !== "object") return [];
  const d = data as AnyRow;
  for (const k of keys) {
    if (Array.isArray(d[k])) return d[k];
  }
  return Array.isArray(data) ? (data as AnyRow[]) : [];
}

export function AgendaPage({
  settings,
  navigate,
}: {
  settings: PiSettings;
  navigate: (path: string) => void;
}) {
  const desk = useDesk(settings);
  const [today, setToday] = useState<Load<ScheduleView | null>>({
    kind: "loading",
  });
  const [watches, setWatches] = useState<Load<WatchView>>({ kind: "loading" });
  const [trending, setTrending] = useState<Load<TrendView>>({
    kind: "loading",
  });
  const [registration, setRegistration] = useState<Countdown | null>(null);

  const junctionOn = settings.apps.includes("junction");
  // A student's toggles are consent, and the two are independent: TigerSnatch's
  // tools ride in over the junction connection when TigerJunction is on (its
  // own endpoint is never opened then), and over /snatch/mcp when it isn't.
  const snatchOn = settings.apps.includes("snatch");
  const snatchVia = junctionOn ? "junction" : "snatch";
  // One generation per card, bumped when its load starts and when the page
  // goes away, so a slow answer can never overwrite what's on screen now and
  // retrying one card doesn't strand the others in their loading state.
  const gen = useRef({ today: 0, watches: 0, trending: 0, registration: 0 });

  const loadToday = useCallback(async () => {
    const id = ++gen.current.today;
    setToday({ kind: "loading" });
    try {
      const list = (await desk.callApp(
        "junction",
        "get_user_schedules",
        {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any;
      const schedules: AnyRow[] = rowsOf(list, "schedules");
      if (schedules.length === 0) {
        if (gen.current.today === id) setToday({ kind: "ready", data: null });
        return;
      }
      schedules.sort((a, b) => (b.term ?? 0) - (a.term ?? 0));
      const details = await desk.callApp("junction", "get_schedule_details", {
        scheduleId: schedules[0].id,
      });
      if (gen.current.today === id) {
        setToday({ kind: "ready", data: extractSchedule(details) });
      }
    } catch (err) {
      if (gen.current.today === id) setToday({ kind: "error", err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  const loadWatches = useCallback(async () => {
    const id = ++gen.current.watches;
    setWatches({ kind: "loading" });
    try {
      const subs = await desk.callApp(
        snatchVia,
        "get_snatch_subscriptions",
        {}
      );
      if (gen.current.watches === id) {
        setWatches({ kind: "ready", data: readWatches(subs) });
      }
    } catch (err) {
      if (gen.current.watches === id) setWatches({ kind: "error", err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  const loadTrending = useCallback(async () => {
    const id = ++gen.current.trending;
    setTrending({ kind: "loading" });
    try {
      const hot = await desk.callApp(snatchVia, "get_trending_courses", {});
      if (gen.current.trending === id) {
        setTrending({ kind: "ready", data: readTrending(hot) });
      }
    } catch (err) {
      if (gen.current.trending === id) setTrending({ kind: "error", err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  // The countdown is the one thing on this page that must never be guessed:
  // if the engine doesn't hand back a real registration date, no callout.
  const loadRegistration = useCallback(async () => {
    const id = ++gen.current.registration;
    try {
      const terms = await desk.callApp("junction", "list_terms", {});
      const found = findRegistration(terms);
      if (found && gen.current.registration === id) setRegistration(found);
    } catch {
      /* no date, no countdown */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  useEffect(() => {
    const stop = () => {
      const g = gen.current;
      g.today += 1;
      g.watches += 1;
      g.trending += 1;
      g.registration += 1;
    };
    // Whatever the last settings asked for is stale the moment they change.
    stop();
    // Each app answers for its own module: a student with TigerSnatch on and
    // TigerJunction off still gets their seat watches, and one with TigerSnatch
    // off is never asked for them.
    const snatchWork = () => {
      if (!snatchOn) return;
      void loadWatches();
      void loadTrending();
    };
    if (!junctionOn) {
      snatchWork();
      return stop;
    }
    setRegistration(null);
    // Today's classes are what the page is for, so they go to the desk first;
    // the rest follow together rather than queueing behind each other's render.
    void loadToday().finally(() => {
      snatchWork();
      void loadRegistration();
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const dateLabel = now.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });

  return (
    <div className="page">
      <div className="page-inner">
        <div className="agenda-top">
          <button className="btn btn-ink btn-sm" onClick={() => navigate("/")}>
            <IconChevron size={14} className="icon back-arrow" />
            back to chats
          </button>
          <h1 className="page-title">
            Daily <span className="ink-word swipe v2">Summary</span>
          </h1>
          <div className="sticky-note agenda-note">
            A campus-wide summary of today's updates,
            <span className="lead">curated for you.</span>
          </div>
        </div>

        <div className="module-grid">
          {!junctionOn ? (
            // Only the junction modules go dark: the rest of the page has its
            // own apps to answer for.
            <div className="module is-wide">
              <div className="empty-hand">
                TigerJunction is switched off, and that's where your day comes
                from.
                <br />
                <button className="cta" onClick={() => navigate("/apps")}>
                  Turn it on in My apps
                  <IconChevron size={13} />
                </button>
              </div>
            </div>
          ) : (
            <Module name="TigerJunction" dot={APP_INK.junction} wide>
              <p className="module-q">What's on your schedule today?</p>
              <p className="module-date">
                {weekday}, <span className="day-hand">{dateLabel}</span>
              </p>

              {today.kind === "loading" && (
                <ul className="day-blocks" aria-busy="true">
                  <li className="skel skel-block" />
                  <li className="skel skel-block" />
                  <li className="skel skel-block" />
                  <span className="sr-only">reading today's schedule</span>
                </ul>
              )}

              {today.kind === "error" && (
                <CardError
                  err={today.err}
                  subject="your schedule"
                  onRetry={loadToday}
                />
              )}

              {today.kind === "ready" && today.data == null && (
                <p className="module-empty">
                  nothing penciled in yet. build a schedule in TigerJunction, or
                  ask PI to start one.
                  <br />
                  <button className="cta" onClick={() => navigate("/")}>
                    Ask PI to draft one
                    <IconChevron size={13} />
                  </button>
                </p>
              )}

              {today.kind === "ready" && today.data != null && (
                <TodayBlocks schedule={today.data} now={now} />
              )}

              {registration && <RegistrationCallout reg={registration} />}

              <div className="module-foot">
                <span className="hand-line">
                  let's work together to make a draft schedule.
                </span>
                <span className="module-actions">
                  <button
                    className="btn btn-quiet btn-sm"
                    onClick={() => navigate("/planner")}
                  >
                    See the whole week
                  </button>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={JUNCTION.home}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Take me to TigerJunction
                    <IconExternal size={14} />
                  </a>
                </span>
              </div>
            </Module>
          )}

          <Module name="TigerSnatch" dot={APP_INK.snatch}>
            <div className="agenda-snatch">
              {!snatchOn ? (
                // Consent, said quietly and in this module only: the seat data
                // is TigerSnatch's, whichever connection it would arrive over.
                <p className="off-line">
                  TigerSnatch is switched off.
                  <button className="cta" onClick={() => navigate("/apps")}>
                    Turn it on in My apps
                    <IconChevron size={13} />
                  </button>
                </p>
              ) : (
                <>
                  <h3 className="module-q">Seats you're watching</h3>
                  {watches.kind === "loading" && <RowSkeleton rows={2} />}
                  {watches.kind === "error" && (
                    <CardError
                      err={watches.err}
                      subject="your seat watches"
                      onRetry={loadWatches}
                    />
                  )}
                  {watches.kind === "ready" && <Watches view={watches.data} />}

                  <div className="list-head">
                    {/* between semesters the rows aren't a trend at all —
                        they're last term's enrollment, with no queue behind
                        them — so the loudest line on the module says so */}
                    <h3 className="module-q">
                      {trending.kind === "ready" &&
                      trending.data.mode === "enrolled"
                        ? "Filled up last term"
                        : "Trending on campus"}
                    </h3>
                    {trending.kind === "ready" && trending.data.term && (
                      <span className="label-xs">{trending.data.term}</span>
                    )}
                  </div>
                  {trending.kind === "loading" && <RowSkeleton rows={3} />}
                  {trending.kind === "error" && (
                    <CardError
                      err={trending.err}
                      subject="what's trending"
                      onRetry={loadTrending}
                    />
                  )}
                  {trending.kind === "ready" && (
                    <Trending view={trending.data} />
                  )}
                </>
              )}
            </div>
          </Module>

          <Module name="TigerMenus" dot="var(--hl-mint)" soon>
            <p>
              Browse the daily offerings from Princeton's dining halls, right
              here, once PI can read them.
            </p>
            <ul className="hall-tags">
              {DINING_HALLS.map((h) => (
                <li key={h.name}>
                  <span
                    className="hall-tag"
                    style={{ "--tag-color": h.color } as React.CSSProperties}
                  >
                    {h.name}
                  </span>
                </li>
              ))}
            </ul>
          </Module>

          <Module name="The Forum" dot="var(--hl-violet)" soon>
            <p>
              What's happening tonight, the listservs you never read, and the
              free food attached to them.
            </p>
            <ul className="ghost-rows" aria-hidden>
              <li className="ghost-row" />
              <li className="ghost-row" />
              <li className="ghost-row" />
            </ul>
          </Module>
        </div>
      </div>
    </div>
  );
}

/** One app's slice of the day, headed the way the wireframe heads them. */
function Module({
  name,
  dot,
  soon = false,
  wide = false,
  children,
}: {
  name: string;
  dot: string;
  soon?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  // A sheet for real data, a dashed outline for a teaser: different materials
  // so nothing that isn't shipped can be mistaken for something that is.
  const cls = soon
    ? "module is-soon"
    : `module paper-card${wide ? " is-wide" : ""}`;
  return (
    <section className={cls}>
      <h2 className="module-head">
        <span className="module-dot" style={{ background: dot }} aria-hidden />
        From {name}
        {soon && <span className="soon-chip">coming soon</span>}
      </h2>
      {children}
    </section>
  );
}

/** Today's meetings, lifted off the week grid as time blocks. */
function TodayBlocks({
  schedule,
  now,
}: {
  schedule: ScheduleView;
  now: Date;
}) {
  const code = DAY_CODES[now.getDay()];
  const meetings = schedule.meetings
    .filter((m) => m.days.some((d) => dayCode(d) === code))
    .sort((a, b) => a.startMin - b.startMin);

  if (meetings.length === 0) {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    return (
      <p className="module-empty">
        {weekend
          ? "nothing meets on a weekend, and that's the point."
          : "no classes today, which is its own kind of luck."}
      </p>
    );
  }

  return (
    <ul className="day-blocks">
      {meetings.map((m, i) => (
        <li
          key={`${m.courseCode}-${m.label}-${i}`}
          className={m.confirmed ? "day-block" : "day-block is-option"}
          style={{
            background: tjColor(m.color),
            borderLeftColor: tjColor(m.color, m.confirmed ? 40 : 20),
            color: tjColor(m.color, 60),
          }}
          title={
            m.confirmed
              ? undefined
              : "a section option you haven't locked in yet"
          }
        >
          <span className="btime">{fmtRange(m.startMin, m.endMin)}</span>
          <span className="bcode">
            {m.courseCode} {m.label}
          </span>
          {m.room && <span className="bwhere">{m.room}</span>}
        </li>
      ))}
    </ul>
  );
}

function RegistrationCallout({ reg }: { reg: Countdown }) {
  return (
    <div className="reg-callout">
      <span className="reg-num">{reg.days === 0 ? "today" : reg.days}</span>
      <span>
        <span className="reg-what">
          {reg.days === 0
            ? "course registration opens today"
            : `${reg.days === 1 ? "day" : "days"} left until course registration`}
        </span>
        <span className="timestamp">{reg.label}</span>
      </span>
    </div>
  );
}

/* ── TigerSnatch: seats on watch, and what campus is chasing ──────── */

type WatchRow = {
  /** Formatted for reading: "COS 226", not "COS226". */
  code: string;
  name: string;
  section: string | null;
  /** The course's own page on TigerSnatch, when the payload carries one. */
  url: string | null;
};

type WatchView = {
  rows: WatchRow[];
  /** The engine's answer for a student who has never used TigerSnatch. */
  noAccount: boolean;
  autoResubscribe: boolean;
};

type TrendRow = {
  code: string;
  title: string;
  section: string | null;
  /** "239 waiting" during add/drop; "232/350 · 66% full" between semesters. */
  meta: string | null;
  url: string | null;
};

type TrendView = {
  /** Add/drop ranks by who's waiting; between semesters, by who got in. */
  mode: "waiting" | "enrolled";
  term: string | null;
  status: string | null;
  rows: TrendRow[];
  /** Campus-wide totals and the engine's own timestamp, as one line. */
  foot: string | null;
};

function Watches({ view }: { view: WatchView }) {
  if (view.noAccount) {
    return (
      <p className="module-empty">
        you don't have a TigerSnatch account yet.
        <br />
        <a className="cta" href={SNATCH.home} target="_blank" rel="noreferrer">
          Start one at tigersnatch.com
          <IconExternal size={13} />
        </a>
      </p>
    );
  }
  if (view.rows.length === 0) {
    return (
      <p className="module-empty">
        no seats on watch. ask PI to grab one when it opens.
      </p>
    );
  }
  return (
    <>
      <ul className="list">
        {view.rows.map((w, i) => (
          <li key={`${w.code}-${w.section ?? ""}-${i}`}>
            <SnatchRow
              lead={<span className="tab" aria-hidden />}
              code={w.code}
              what={w.name}
              section={w.section}
              url={w.url}
              linkTitle={`Open ${w.code} on TigerSnatch`}
            />
          </li>
        ))}
      </ul>
      {view.autoResubscribe && (
        <p className="label-xs note">
          auto re-subscribe is on, so you stay on the list after each alert.
        </p>
      )}
    </>
  );
}

function Trending({ view }: { view: TrendView }) {
  return (
    <>
      {view.status && <p className="status">{view.status}</p>}
      {view.rows.length === 0 ? (
        <p className="module-empty">
          {view.mode === "enrolled"
            ? "nothing to rank until the term gets going."
            : "quiet week, nothing spiking."}
        </p>
      ) : (
        <ol className="list">
          {view.rows.map((t, i) => (
            <li key={`${t.code}-${i}`}>
              <SnatchRow
                lead={
                  <span className="rank" aria-hidden>
                    {i + 1}
                  </span>
                }
                code={t.code}
                what={t.title}
                section={t.section}
                meta={t.meta}
                url={t.url}
                linkTitle={`Open ${t.code} on TigerSnatch`}
              />
            </li>
          ))}
        </ol>
      )}
      {view.foot && <p className="label-xs foot">{view.foot}</p>}
    </>
  );
}

/** One line of the module: a mark, a code, a title, and a way through. */
function SnatchRow({
  lead,
  code,
  what,
  section,
  meta,
  url,
  linkTitle,
}: {
  lead: ReactNode;
  code: string;
  what: string;
  section: string | null;
  meta?: string | null;
  url: string | null;
  linkTitle: string;
}) {
  const inner = (
    <>
      {lead}
      <span className="code">{code}</span>
      <span className="what">{what}</span>
      {section && <span className="sect">{section}</span>}
      {meta && <span className="count">{meta}</span>}
      {url && <IconExternal size={12} className="icon go" />}
    </>
  );
  return url ? (
    <a
      className="row"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={linkTitle}
    >
      {inner}
    </a>
  ) : (
    <div className="row">{inner}</div>
  );
}

/* Both TigerSnatch payloads are read by lib/tools' extractors — the same ones
   the chat cards use — and only shaped into this page's row types below. One
   payload, one reading: a cross-listed code, a "no account" message and a fill
   percentage can't mean one thing on the agenda and another in a chat. */

/**
 * get_snatch_subscriptions, in its two shapes: a student's watch list, or the
 * "no account yet" note that comes back with an empty list. They read very
 * differently to a student, so they never share an empty state.
 */
function readWatches(data: unknown): WatchView {
  const view = extractWatches(data);
  // Not the payload we know: say nothing is on watch rather than guessing at
  // a shape. "No account yet" is a claim, and it needs the engine to make it.
  if (!view) return { rows: [], noAccount: false, autoResubscribe: false };
  return {
    rows: view.rows.map((r) => ({
      code: r.code,
      name: r.name ?? "",
      section: r.section,
      url: r.url,
    })),
    noAccount: view.noAccount,
    autoResubscribe: view.autoResubscribe,
  };
}

/**
 * get_trending_courses, which answers with `trendingCourses` while add/drop is
 * running and `topEnrolled` between semesters. Both are ranked lists of
 * courses, so they render as one list with a different measure beside it.
 */
function readTrending(data: unknown): TrendView {
  const view = extractTrending(data);
  if (!view) {
    return { mode: "waiting", term: null, status: null, rows: [], foot: null };
  }
  // The engine joins a status and its reason with a dash; this page writes in
  // commas, so no dash reaches a student.
  const status =
    [view.statusLead, view.statusNote].filter(Boolean).join(", ") || null;
  const foot =
    [...view.stats, stamp(view.lastUpdated)].filter(Boolean).join(" · ") ||
    null;
  return {
    mode: view.mode,
    term: view.term,
    status,
    rows: view.rows.slice(0, 6).map((r) => ({
      code: r.code,
      title: r.name ?? "",
      section: r.section,
      meta: trendMeta(r),
      url: r.url,
    })),
    foot,
  };
}

/** What a row is measured by: students waiting, or seats taken. */
function trendMeta(row: TrendingRow): string | null {
  if (row.waiting != null) return `${count(row.waiting)} waiting`;
  if (row.enrollment == null || row.capacity == null) return null;
  const fill =
    row.fillPercent != null ? ` · ${Math.round(row.fillPercent)}% full` : "";
  return `${count(row.enrollment)}/${count(row.capacity)}${fill}`;
}

function stamp(value: string | null): string {
  return value ? `updated ${value}` : "";
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <div className="row-skel" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skel skel-line" />
      ))}
      <span className="sr-only">still reading</span>
    </div>
  );
}

/** Failure copy a student can act on; the machine text stays in the title. */
function CardError({
  err,
  subject,
  onRetry,
}: {
  err: unknown;
  subject: string;
  onRetry: () => void;
}) {
  return (
    <div className="card-error" title={rawError(err)}>
      <p>{friendlyError(err, subject)}</p>
      <button className="btn btn-ghost btn-sm" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/* ── today, and the registration date ─────────────────────────────── */

const DAY_CODES = ["su", "m", "t", "w", "th", "f", "sa"];

/** "Thursday" / "Th" / "R" style day tokens → one comparable code. */
function dayCode(day: string): string {
  const t = day.trim().toLowerCase();
  if (t.startsWith("th")) return "th";
  if (t.startsWith("su")) return "su";
  if (t.startsWith("sa")) return "sa";
  if (t.startsWith("m")) return "m";
  if (t.startsWith("t")) return "t";
  if (t.startsWith("w")) return "w";
  if (t.startsWith("f")) return "f";
  return t;
}

type Countdown = { days: number; label: string };

/** Local-midnight parse, so an ISO date doesn't slip a day in a US timezone. */
function parseDate(value: string): Date | null {
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Walks whatever `list_terms` hands back looking for the date registration
 * OPENS. The shape isn't contracted, so this stays suspicious: the key has to
 * name an opening and not a closing (once registration is running, its start
 * is in the past and a close date would be the soonest hit — counting down to
 * "registration" that already began), and the hit has to be a real date, in
 * the future, and inside a year. Anything else means no callout: a countdown
 * is worse than useless if the number belongs to another event.
 */
function findRegistration(data: unknown): Countdown | null {
  const found: Date[] = [];
  const visit = (node: unknown, depth: number) => {
    if (node == null || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 40)) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        typeof value === "string" &&
        /reg/i.test(key) &&
        /start|open|begin/i.test(key) &&
        !/end|clos|deadline|last|stop|final/i.test(key)
      ) {
        const parsed = parseDate(value);
        if (parsed) found.push(parsed);
        continue;
      }
      visit(value, depth + 1);
    }
  };
  visit(data, 0);
  if (found.length === 0) return null;

  const today = new Date();
  const midnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  const upcoming = found
    .map((d) => ({
      date: d,
      days: Math.round(
        (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
          midnight) /
          86_400_000
      ),
    }))
    .filter((x) => x.days >= 0 && x.days <= 365)
    .sort((a, b) => a.days - b.days);
  if (upcoming.length === 0) return null;

  const next = upcoming[0];
  return {
    days: next.days,
    label: next.date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  };
}
