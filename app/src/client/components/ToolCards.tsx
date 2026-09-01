import { useState } from "react";
import { PI_APPS } from "../../shared/apps";
import {
  APP_INK,
  appDisplayName,
  extractCourses,
  extractEvaluations,
  extractSchedule,
  type EvaluationView,
  type ToolView,
} from "../lib/tools";
import { IconExternal } from "./Icons";
import { WeekGrid } from "./WeekGrid";

const MAX_ROWS = 8;

/**
 * Raw payloads are for `?debug=1` only. A student should never meet an MCP
 * tool name or a JSON dump inside an answer.
 */
const DEBUG =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("debug");

/**
 * Replaces raw tool calls with renders: a planner for schedules, an evidence
 * card for evaluations, rows for course lists, and a quiet chip otherwise.
 */
export function ToolRender({ view }: { view: ToolView }) {
  const running =
    view.state === "input-streaming" ||
    view.state === "input-available" ||
    view.state === "call" ||
    (view.data == null && view.errorText == null);

  if (view.errorText || view.state === "output-error") {
    const app = PI_APPS.find((a) => a.key === view.app);
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
        checking {appDisplayName(view.app)}…
      </ToolChip>
    );
  }

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
  const courses = extractCourses(view.data);
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
          {shown.map((c, i) => (
            <div key={i} className="course-row">
              {c.pcUrl ? (
                <a
                  className="course-link"
                  href={c.pcUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Ratings and reviews on PrincetonCourses"
                >
                  <span className="code">{c.code}</span>
                  <span className="ctitle">{c.title}</span>
                </a>
              ) : (
                <>
                  <span className="code">{c.code}</span>
                  <span className="ctitle">{c.title}</span>
                </>
              )}
              {c.meta && <span className="meta">{c.meta}</span>}
              {c.rating != null && (
                <span className="rating-chip">{c.rating.toFixed(2)}</span>
              )}
              {c.status && <StatusPill status={c.status} />}
            </div>
          ))}
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
      checked {appDisplayName(view.app)}
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

/** The wireframe's evidence treatment: what students actually wrote. */
function Evidence({ evaluation }: { evaluation: EvaluationView }) {
  const { code, title, rating, count, quotes, links } = evaluation;
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
      {count != null && (
        <p className="label-xs">{count} students rated it</p>
      )}
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

function AppDot({ view }: { view: ToolView }) {
  const app = PI_APPS.find((a) => a.key === view.app);
  if (app) {
    return <img className="app-logo-sm" src={app.logo} alt="" />;
  }
  return (
    <span
      className="app-dot"
      style={{
        background: view.app ? APP_INK[view.app] : "var(--rule)",
      }}
    />
  );
}

function cardLabel(view: ToolView, suffix?: string): string {
  return [`From ${appDisplayName(view.app)}`, suffix]
    .filter(Boolean)
    .join(" · ");
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
  return (
    <div className="tool-card">
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
