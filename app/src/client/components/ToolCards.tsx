import { useState } from "react";
import { PI_APPS } from "../../shared/apps";
import {
  APP_INK,
  SNATCH_HOME,
  appDisplayName,
  count,
  extractCourses,
  extractDemand,
  extractEvaluations,
  extractHistory,
  extractSchedule,
  extractSectionChoice,
  extractSubscriptionChange,
  extractTrending,
  extractWatches,
  meetingLabel,
  ownerName,
  ownerOf,
  type DemandView,
  type EvaluationView,
  type HistoryView,
  type SectionChoice,
  type SubscriptionChange,
  type ToolView,
  type TrendingView,
  type WatchesView,
} from "../lib/tools";
import { IconCheck, IconExternal, IconX } from "./Icons";
import { WeekGrid } from "./WeekGrid";
import "../styles/snatch.css";

const MAX_ROWS = 8;

/** A course rarely runs more sections than this; the rest are summarized. */
const MAX_SECTIONS = 12;

/**
 * Raw payloads are for `?debug=1` only. A student should never meet an MCP
 * tool name or a JSON dump inside an answer.
 */
const DEBUG =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("debug");

type SendHandler = (text: string) => void;

export type ToolRenderProps = {
  view: ToolView;
  /**
   * Sends a follow-up as the student's own next message. Cards that offer an
   * action (undo a watch, pick a section) go through this, the same path the
   * elicitation cards use — nothing here calls a tool behind their back.
   */
  onSend?: SendHandler;
  /** True once the student has spoken again, which retires a card's actions. */
  settled?: boolean;
};

/**
 * Replaces raw tool calls with renders: a planner for schedules, an evidence
 * card for evaluations, TigerSnatch's seat cards, rows for course lists, and
 * a quiet chip otherwise.
 */
export function ToolRender({ view, onSend, settled = false }: ToolRenderProps) {
  const running =
    view.state === "input-streaming" ||
    view.state === "input-available" ||
    view.state === "call" ||
    (view.data == null && view.errorText == null);

  if (view.errorText || view.state === "output-error") {
    // Today "which section did you mean?" arrives as a tool error whose text
    // lists the sections. That's an answer, not a failure, so it renders as
    // the pick card instead of a red chip.
    const choice = extractSectionChoice(view.data, view.errorText);
    if (choice) {
      return (
        <SectionPickCard
          view={view}
          choice={choice}
          onSend={onSend}
          settled={settled}
        />
      );
    }
    const app = PI_APPS.find((a) => a.key === ownerOf(view));
    return (
      <ToolChip view={view} running={false} error>
        <span title={shortError(view.errorText)}>
          {app ? `${app.name} couldn't answer that` : "that didn't work"}
        </span>
        {app && (
          <a
            className="chip-link"
            href={app.home}
            target="_blank"
            rel="noreferrer"
          >
            Open {app.name} <IconExternal size={12} />
          </a>
        )}
      </ToolChip>
    );
  }

  if (running) {
    return (
      <ToolChip view={view} running>
        checking {ownerName(view)}…
      </ToolChip>
    );
  }

  // TigerSnatch's payloads are read first: several of them carry a `sections`
  // or a `subscriptions` array that the schedule and course-row branches
  // below would otherwise claim and render as the wrong thing.
  const snatch = snatchCard({ view, onSend, settled });
  if (snatch) return snatch;

  const schedule = extractSchedule(view.data);
  if (schedule) {
    const junction = PI_APPS.find((a) => a.key === "junction")!;
    return (
      <ToolCard
        view={view}
        label={cardLabel(view, schedule.termName)}
        link={{
          href: `${junction.home}/recalplus`,
          label: "Open in TigerJunction",
        }}
      >
        {schedule.title && (
          <p className="card-title">
            {schedule.title}
            {schedule.termName ? ` · ${schedule.termName}` : ""}
          </p>
        )}
        <WeekGrid schedule={schedule} compact />
      </ToolCard>
    );
  }

  // Evidence is read off the payload, never off which app ran the tool: with
  // TigerJunction on, its scope serves the evaluation tools and PrincetonCourses
  // never connects (see setup in server/pi.ts), so an app gate here would hide
  // the card from every student on the default apps. A list of courses is rows,
  // not evidence, so that shape wins.
  const courses = extractCourses(view.data, ownerOf(view));
  if (!courses) {
    const evaluation = extractEvaluations(view.data);
    if (evaluation) {
      return (
        <ToolCard view={view} label={cardLabel(view)}>
          <Evidence evaluation={evaluation} />
        </ToolCard>
      );
    }
  }

  if (courses) {
    const shown = courses.slice(0, MAX_ROWS);
    return (
      <ToolCard view={view} label={cardLabel(view)}>
        <div className="course-rows">
          {shown.map((c, i) => {
            const name = (
              <>
                <span className="code">{c.code}</span>
                <span className="ctitle">{c.title}</span>
              </>
            );
            return (
              <div key={i} className="course-row">
                {c.pcUrl ? (
                  <a
                    className="course-link"
                    href={c.pcUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Ratings and reviews on PrincetonCourses"
                  >
                    {name}
                  </a>
                ) : c.snatchUrl ? (
                  <a
                    className="course-link"
                    href={c.snatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="This course on TigerSnatch"
                  >
                    {name}
                  </a>
                ) : (
                  name
                )}
                {c.meta && <span className="meta">{c.meta}</span>}
                {c.waiting != null && (
                  <span className="meta">{count(c.waiting)} waiting</span>
                )}
                {c.rating != null && (
                  <span className="rating-chip">{c.rating.toFixed(2)}</span>
                )}
                {c.status && <StatusPill status={c.status} />}
              </div>
            );
          })}
        </div>
        {courses.length > shown.length && (
          <div className="card-more">
            {courses.length - shown.length} more. Ask PI to narrow it down.
          </div>
        )}
      </ToolCard>
    );
  }

  return (
    <ToolChip view={view} running={false}>
      checked {ownerName(view)}
    </ToolChip>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = s.includes("open")
    ? "open"
    : s.includes("closed") || s.includes("full")
      ? "closed"
      : s.includes("wait")
        ? "waitlist"
        : "other";
  return <span className={`pill ${cls}`}>{status}</span>;
}

/* ── TigerSnatch ─────────────────────────────────────────────────── */

/** Whichever seat card this payload is, or null if it isn't one. */
function snatchCard({
  view,
  onSend,
  settled,
}: {
  view: ToolView;
  onSend?: SendHandler;
  settled: boolean;
}): React.ReactElement | null {
  const choice = extractSectionChoice(view.data, null);
  if (choice) {
    return (
      <SectionPickCard
        view={view}
        choice={choice}
        onSend={onSend}
        settled={settled}
      />
    );
  }

  const change = extractSubscriptionChange(view.data);
  if (change) {
    return (
      <ToolCard view={view} label={cardLabel(view)}>
        <WatchChange change={change} onSend={onSend} settled={settled} />
      </ToolCard>
    );
  }

  const watches = extractWatches(view.data);
  if (watches) {
    return (
      <ToolCard
        view={view}
        label={cardLabel(view)}
        link={
          watches.rows.length > 0
            ? { href: SNATCH_HOME, label: "Open in TigerSnatch" }
            : undefined
        }
      >
        <Watches watches={watches} />
      </ToolCard>
    );
  }

  const demand = extractDemand(view.data);
  if (demand) {
    return (
      <ToolCard
        view={view}
        label={cardLabel(view)}
        link={{ href: SNATCH_HOME, label: "Open in TigerSnatch" }}
      >
        <Demand demand={demand} />
      </ToolCard>
    );
  }

  const trending = extractTrending(view.data);
  if (trending) {
    return (
      <ToolCard
        view={view}
        label={cardLabel(view)}
        link={{ href: SNATCH_HOME, label: "Open in TigerSnatch" }}
      >
        <Trending trending={trending} />
      </ToolCard>
    );
  }

  const history = extractHistory(view.data);
  if (history) {
    return (
      <ToolCard view={view} label={cardLabel(view)}>
        <History history={history} />
      </ToolCard>
    );
  }

  return null;
}

/** The sections a student is on the list for. */
function Watches({ watches }: { watches: WatchesView }) {
  const { rows, autoResubscribe, noAccount } = watches;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="snatch-watches">
      {noAccount ? (
        <p className="snatch-none">
          no TigerSnatch account yet, so there&rsquo;s nothing on watch.
          <br />
          <a
            className="cta"
            href={SNATCH_HOME}
            target="_blank"
            rel="noreferrer"
          >
            make a TigerSnatch account
            <IconExternal size={12} />
          </a>
        </p>
      ) : rows.length === 0 ? (
        <p className="snatch-none">
          nothing on watch right now. ask PI to watch a section and TigerSnatch
          will tell you the moment a seat opens.
        </p>
      ) : (
        <ul className="watch-list">
          {shown.map((r, i) => (
            <li className="watch-row" key={`${r.code}-${r.section ?? i}`}>
              <span className="code">{r.code}</span>
              {r.section && <span className="sec">{r.section}</span>}
              {r.name && <span className="name">{r.name}</span>}
              {r.url && (
                <a
                  className="out"
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  open on TigerSnatch
                  <IconExternal size={11} />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <div className="card-more">
          {rows.length - shown.length} more on watch.
        </div>
      )}
      {autoResubscribe && rows.length > 0 && (
        <p className="snatch-note">
          Auto re-subscribe is on, so a watch starts again after TigerSnatch
          tells you about a seat.
        </p>
      )}
    </div>
  );
}

/** How full a course is, section by section. */
function Demand({ demand }: { demand: DemandView }) {
  const shown = demand.sections.slice(0, MAX_SECTIONS);
  return (
    <div className="snatch-demand">
      <div className="snatch-head">
        <span className="snatch-chip">{demand.code}</span>
        {demand.title && <span className="snatch-title">{demand.title}</span>}
      </div>

      {demand.overallFill && (
        <div className="overall">
          <span className="cap">seats taken</span>
          <span className="figure">{demand.overallFill}</span>
          <FillBar
            percent={demand.overallPercent}
            label={`${demand.code} overall: ${demand.overallFill} taken`}
          />
        </div>
      )}

      {/* the caveat belongs with the number it qualifies, not in a footnote */}
      {demand.hasReservedSeats && (
        <p className="snatch-note is-lede">
          Some seats here are reserved, so an open count can still be out of
          reach.
        </p>
      )}

      {demand.totalSubscribers != null && (
        <p className="queue">
          {count(demand.totalSubscribers)} waiting for a seat
        </p>
      )}

      {shown.length > 0 && (
        <div className="rows">
          {shown.map((s) => {
            const when = meetingLabel(s);
            return (
              <div className="row" key={s.section}>
                <span className="sec">{s.section}</span>
                <span className="when">{when ?? "time not set"}</span>
                {s.enrollment != null && s.capacity != null && (
                  <span className="seats">
                    {s.enrollment}/{s.capacity}
                  </span>
                )}
                {s.isOpen != null && (
                  <StatusPill status={s.isOpen ? "open" : "closed"} />
                )}
                <FillBar
                  percent={s.fillPercent}
                  label={
                    s.enrollment != null && s.capacity != null
                      ? `${s.section}: ${s.enrollment} of ${s.capacity} seats taken`
                      : `${s.section} seats taken`
                  }
                />
                {s.subscribers != null && s.subscribers > 0 && (
                  <span className="subs">{count(s.subscribers)} waiting</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {demand.sections.length > shown.length && (
        <div className="card-more">
          {demand.sections.length - shown.length} more sections.
        </div>
      )}
    </div>
  );
}

/** What everyone is queueing for, or what filled up last term. */
function Trending({ trending }: { trending: TrendingView }) {
  const shown = trending.rows.slice(0, MAX_ROWS);
  // The swipe behind each row is that row against the busiest one, so the
  // ranking reads before the numbers do.
  const top = shown.reduce((max, r) => {
    const v = trending.mode === "waiting" ? r.waiting : r.fillPercent;
    return v != null && v > max ? v : max;
  }, 0);

  return (
    <div className="snatch-trending">
      {(trending.term || trending.statusLead) && (
        <p className="term">
          {trending.term && <span>{trending.term}</span>}
          {trending.statusLead && (
            <span className="status">{trending.statusLead}</span>
          )}
        </p>
      )}
      {trending.statusNote && (
        <p className="snatch-note is-lede">{trending.statusNote}</p>
      )}

      <ul className="list">
        {shown.map((r, i) => {
          const value =
            trending.mode === "waiting" ? r.waiting : r.fillPercent;
          const swipe = top > 0 && value != null ? (value / top) * 100 : 0;
          // Between semesters the list is per section, so two rows can share a
          // course code and a title; without the section they read as
          // duplicates with different numbers.
          const name = (
            <>
              <span className="code">{r.code}</span>
              {r.section && <span className="sect">{r.section}</span>}
              {r.name && <span className="name">{r.name}</span>}
            </>
          );
          return (
            <li
              className="row"
              key={`${r.code}-${i}`}
              style={{ "--swipe": `${swipe}%` } as React.CSSProperties}
            >
              {r.url ? (
                <a
                  className="link"
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  title="This course on TigerSnatch"
                >
                  {name}
                </a>
              ) : (
                name
              )}
              {trending.mode === "waiting"
                ? r.waiting != null && (
                    <span className="n">{count(r.waiting)} waiting</span>
                  )
                : r.enrollment != null &&
                  r.capacity != null && (
                    <span className="n">
                      {r.enrollment}/{r.capacity}
                    </span>
                  )}
              {trending.mode === "enrolled" && r.fillPercent != null && (
                <span className="of">{Math.round(r.fillPercent)}%</span>
              )}
            </li>
          );
        })}
      </ul>
      {trending.rows.length > shown.length && (
        <div className="card-more">
          {trending.rows.length - shown.length} more on the list.
        </div>
      )}

      {(trending.stats.length > 0 || trending.lastUpdated) && (
        <p className="foot">
          {trending.stats.join(" · ")}
          {trending.lastUpdated && (
            <span className="when">
              TigerSnatch counted as of {trending.lastUpdated}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** How a course has gone term by term. */
function History({ history }: { history: HistoryView }) {
  const terms = history.terms.filter((t) => t.fillPercent != null);
  return (
    <div className="snatch-history">
      <div className="snatch-head">
        <span className="snatch-chip">{history.code}</span>
        {history.title && <span className="snatch-title">{history.title}</span>}
      </div>

      {history.competitiveness && (
        <p className="verdict">
          <span className="lead">{history.competitiveness}</span>
          {history.competitivenessNote && (
            <span className="why">{history.competitivenessNote}</span>
          )}
        </p>
      )}

      {(history.averageFillRate ||
        history.timesFullyClosed ||
        history.capacityTrend) && (
        <div className="stats">
          {history.averageFillRate && (
            <Stat k="average fill" v={history.averageFillRate} />
          )}
          {history.timesFullyClosed && (
            <Stat k="fully closed" v={history.timesFullyClosed} />
          )}
          {history.capacityTrend && (
            <Stat
              k="capacity"
              v={history.capacityTrend}
              n={history.capacityTrendNote}
            />
          )}
        </div>
      )}

      {terms.length > 0 && (
        // The strip scrolls sideways once a course has more than about five
        // terms behind it, and its bars aren't focusable, so the container
        // takes the tab stop — otherwise a keyboard can never reach the older
        // terms (WCAG 2.1.1).
        <div
          className="strip"
          tabIndex={0}
          role="group"
          aria-label={`${history.code} fill rate by term`}
        >
          {terms.map((t, i) => {
            const closed = /clos|full/i.test(t.courseStatus ?? "");
            const seats =
              t.totalEnrolled != null && t.totalCapacity != null
                ? `${t.totalEnrolled} of ${t.totalCapacity} seats`
                : null;
            return (
              <div
                className={`term${closed ? " is-closed" : ""}`}
                key={`${t.termName}-${i}`}
                title={[t.termName, seats, t.fillRate]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span className="rate">{t.fillRate ?? ""}</span>
                <span className="bar">
                  <span style={{ height: `${Math.round(t.fillPercent!)}%` }} />
                </span>
                <span className="name">{t.termName}</span>
                {closed && <span className="flag">closed</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* the stats above count every term on record, so say when the strip is
          drawing fewer of them rather than letting a term quietly vanish */}
      {terms.length < history.terms.length && (
        <p className="snatch-note">
          Only {terms.length} of {history.terms.length} terms have enrollment on
          record, so the rest aren&rsquo;t drawn.
        </p>
      )}

      {history.timesWithClosedSections && (
        <p className="snatch-note">
          Sections closed in {history.timesWithClosedSections}.
        </p>
      )}
    </div>
  );
}

function Stat({ k, v, n }: { k: string; v: string; n?: string | null }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {n && <span className="n">{n}</span>}
    </div>
  );
}

/** A watch just switched on or off, with the way back. */
function WatchChange({
  change,
  onSend,
  settled,
}: {
  change: SubscriptionChange;
  onSend?: SendHandler;
  settled: boolean;
}) {
  const where = [change.code, change.section].filter(Boolean).join(" ");
  const undo = change.watching
    ? `Stop watching ${where}.`
    : `Watch ${where} again.`;
  return (
    <div className={`snatch-change${change.watching ? "" : " is-off"}`}>
      <span className="mark" aria-hidden>
        {change.watching ? <IconCheck size={14} /> : <IconX size={14} />}
      </span>
      <div className="body">
        <p className="lead">
          <span>{change.watching ? "You’re watching" : "No longer watching"}</span>
          <span className="snatch-chip">{change.code}</span>
          {change.section && <span className="sec">{change.section}</span>}
        </p>
        {change.title && <p className="said">{change.title}</p>}
        {change.message && <p className="said">{change.message}</p>}
      </div>
      {onSend && !settled && (
        <button
          className="btn btn-ghost btn-sm undo"
          onClick={() => onSend(undo)}
          title={undo}
        >
          undo
        </button>
      )}
    </div>
  );
}

/** One course, several sections: the student picks which one to watch. */
function SectionPickCard({
  view,
  choice,
  onSend,
  settled,
}: {
  view: ToolView;
  choice: SectionChoice;
  onSend?: SendHandler;
  settled: boolean;
}) {
  // The same "which one?" comes back from both directions, so the row has to
  // send the request the student was actually making.
  const dropping = /unsubscribe|unwatch/.test(view.base);
  return (
    <ToolCard
      view={view}
      label={cardLabel(view)}
      link={{ href: SNATCH_HOME, label: "Open in TigerSnatch" }}
    >
      <div className="snatch-pick">
        <p className="ask">
          {dropping
            ? `Which section of ${choice.code} do you want off?`
            : `Which section of ${choice.code}?`}
        </p>
        {choice.title && <p className="snatch-note is-lede">{choice.title}</p>}
        <ul className="list">
          {choice.options.map((o) => {
            const when = meetingLabel(o);
            const ask = dropping
              ? `Stop watching ${choice.code} ${o.section}.`
              : `Watch ${choice.code} ${o.section}.`;
            return (
              <li key={o.section}>
                <button
                  type="button"
                  className="row"
                  title={ask}
                  disabled={!onSend || settled}
                  onClick={() => onSend?.(ask)}
                >
                  <span className="sec">{o.section}</span>
                  {when && <span className="when">{when}</span>}
                  {o.status && <StatusPill status={o.status} />}
                  {o.enrolled != null && o.capacity != null && (
                    <span className="seats">
                      {o.enrolled}/{o.capacity}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {settled && <p className="settled">answered</p>}
      </div>
    </ToolCard>
  );
}

function FillBar({
  percent,
  label,
}: {
  percent: number | null;
  label: string;
}) {
  if (percent == null) {
    return <span className="fill-bar is-unknown" title="seats not counted" />;
  }
  const full = percent >= 100;
  return (
    <span
      className={`fill-bar${full ? " is-full" : ""}`}
      role="img"
      aria-label={label}
    >
      <span className="fill" style={{ width: `${Math.min(100, percent)}%` }} />
    </span>
  );
}

/* ── PrincetonCourses ────────────────────────────────────────────── */

/** The wireframe's evidence treatment: what students actually wrote. */
function Evidence({ evaluation }: { evaluation: EvaluationView }) {
  const { code, title, rating, count: rated, quotes, links } = evaluation;
  return (
    <div className="evidence">
      <div className="head-line">
        {code && (
          <span className="course-chip">
            {code}
            {title && <span className="of">{title}</span>}
          </span>
        )}
        {rating != null && (
          <span className="rating-pill">
            {rating.toFixed(2)}
            <span className="out-of">out of 5</span>
          </span>
        )}
        {links.length > 0 && (
          <span className="eval-links">
            {links.map((l) => (
              <a
                key={l.href}
                className={`eval-link ${l.kind}`}
                href={l.href}
                target="_blank"
                rel="noreferrer"
              >
                {l.label}
                <IconExternal size={11} />
              </a>
            ))}
          </span>
        )}
      </div>
      {rated != null && <p className="label-xs">{rated} students rated it</p>}
      {quotes.length > 0 && (
        <div className="quotes">
          {quotes.map((q, i) => (
            <blockquote key={i} className="quote">
              <span className="mark" aria-hidden>
                &ldquo;
              </span>
              <span className="said">
                {q.text}
                {q.from && <span className="from">{q.from}</span>}
              </span>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── card furniture ──────────────────────────────────────────────── */

function AppDot({ view }: { view: ToolView }) {
  // The owning app, not the one that served the call: seat data wears
  // TigerSnatch's mark even when it arrived over TigerJunction's connection.
  const owner = ownerOf(view);
  const app = PI_APPS.find((a) => a.key === owner);
  if (app) {
    return <img className="app-logo-sm" src={app.logo} alt="" />;
  }
  return (
    <span
      className="app-dot"
      style={{ background: owner ? APP_INK[owner] : "var(--rule)" }}
    />
  );
}

function cardLabel(view: ToolView, suffix?: string): string {
  return [`From ${ownerName(view)}`, suffix].filter(Boolean).join(" · ");
}

function shortError(text: string | null): string {
  if (!text) return "that didn't work";
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function ToolCard({
  view,
  label,
  link,
  children,
}: {
  view: ToolView;
  label: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const owner = ownerOf(view);
  return (
    <div
      className="tool-card"
      style={
        owner
          ? ({ "--card-accent": APP_INK[owner] } as React.CSSProperties)
          : undefined
      }
    >
      <div className="card-head">
        <AppDot view={view} />
        <span>{label}</span>
        <span className="spacer" />
        {link && (
          <a
            className="card-link"
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            {link.label} <IconExternal size={12} />
          </a>
        )}
        {DEBUG && <span className="tname">{view.base}</span>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function ToolChip({
  view,
  running,
  error = false,
  children,
}: {
  view: ToolView;
  running: boolean;
  error?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = DEBUG && !running && view.data != null;
  return (
    <div>
      <div
        className={`tool-chip${running ? " running" : ""}${error ? " error" : ""}`}
      >
        <AppDot view={view} />
        {DEBUG && <span className="tname">{view.base}</span>}
        {children && <span>{children}</span>}
        {expandable && (
          <button onClick={() => setOpen(!open)}>
            {open ? "hide" : "peek"}
          </button>
        )}
      </div>
      {open && (
        <pre className="tool-raw">{JSON.stringify(view.data, null, 2)}</pre>
      )}
    </div>
  );
}
