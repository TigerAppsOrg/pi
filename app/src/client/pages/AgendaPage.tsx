import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PI_APPS, type PiSettings } from "../../shared/apps";
import { IconChevron, IconExternal } from "../components/Icons";
import { StatusPill } from "../components/ToolCards";
import { friendlyError, rawError, useDesk } from "../lib/desk";
import {
  APP_INK,
  extractSchedule,
  fmtRange,
  tjColor,
  type ScheduleView,
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
  const [watches, setWatches] = useState<Load<AnyRow[]>>({ kind: "loading" });
  const [trending, setTrending] = useState<Load<AnyRow[]>>({ kind: "loading" });
  const [registration, setRegistration] = useState<Countdown | null>(null);

  const junctionOn = settings.apps.includes("junction");
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
        "junction",
        "get_snatch_subscriptions",
        {}
      );
      if (gen.current.watches === id) {
        setWatches({
          kind: "ready",
          data: rowsOf(subs, "subscriptions", "courses"),
        });
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
      const hot = await desk.callApp("junction", "get_trending_courses", {});
      if (gen.current.trending === id) {
        setTrending({
          kind: "ready",
          data: rowsOf(hot, "trending", "courses").slice(0, 6),
        });
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
    if (!junctionOn) {
      stop();
      return;
    }
    setRegistration(null);
    // Today's classes are what the page is for, so they go to the desk first;
    // the rest follow together rather than queueing behind each other's render.
    void loadToday().finally(() => {
      void loadWatches();
      void loadTrending();
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

        {!junctionOn ? (
          <div className="empty-hand">
            TigerJunction is switched off, and that's where your day comes from.
            <br />
            <button className="cta" onClick={() => navigate("/apps")}>
              Turn it on in My apps
              <IconChevron size={13} />
            </button>
          </div>
        ) : (
          <div className="module-grid">
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

            <Module name="TigerSnatch" dot={APP_INK.snatch}>
              {/* The disclosure goes above the data, not under it: this is
                  TigerSnatch's data arriving through TigerJunction's scope,
                  and a student with TigerSnatch switched off should read that
                  before they read their own seat watches. */}
              <p className="label-xs module-source">
                PI reads these through your TigerJunction connection —
                TigerSnatch itself doesn't have to be on.
              </p>
              <h3 className="module-q">Seats you're watching</h3>
              {watches.kind === "loading" && <RowSkeleton rows={2} />}
              {watches.kind === "error" && (
                <CardError
                  err={watches.err}
                  subject="your seat watches"
                  onRetry={loadWatches}
                />
              )}
              {watches.kind === "ready" && watches.data.length === 0 && (
                <p className="module-empty">
                  no seats on watch. ask PI to grab one when it opens.
                </p>
              )}
              {watches.kind === "ready" &&
                watches.data.map((w, i) => (
                  <div key={i} className="agenda-row">
                    <span
                      className="swatch"
                      style={{ background: "var(--hl-pink)" }}
                    />
                    <span className="code">
                      {w.courseCode ?? w.code ?? w.course ?? "?"}
                    </span>
                    <span className="what">
                      {w.sectionTitle ?? w.section ?? w.title ?? "section"}
                    </span>
                    {w.status && <StatusPill status={String(w.status)} />}
                  </div>
                ))}

              <h3 className="module-q module-q-2">Trending on campus</h3>
              {trending.kind === "loading" && <RowSkeleton rows={3} />}
              {trending.kind === "error" && (
                <CardError
                  err={trending.err}
                  subject="what's trending"
                  onRetry={loadTrending}
                />
              )}
              {trending.kind === "ready" && trending.data.length === 0 && (
                <p className="module-empty">quiet week, nothing spiking.</p>
              )}
              {trending.kind === "ready" &&
                trending.data.map((t, i) => (
                  <div key={i} className="agenda-row">
                    <span
                      className="swatch"
                      style={{ background: "var(--hl-lemon)" }}
                    />
                    <span className="code">{t.code ?? t.courseCode ?? "?"}</span>
                    <span className="what">{t.title ?? t.name ?? ""}</span>
                    {(t.subscriptions ?? t.demand ?? t.count) != null && (
                      <span className="when">
                        {t.subscriptions ?? t.demand ?? t.count} watching
                      </span>
                    )}
                  </div>
                ))}
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
        )}
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
