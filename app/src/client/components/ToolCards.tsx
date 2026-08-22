import { useState } from "react";
import { PI_APPS } from "../../shared/apps";
import {
  APP_INK,
  extractCourses,
  extractSchedule,
  type ToolView,
} from "../lib/tools";
import { WeekGrid } from "./WeekGrid";

const MAX_ROWS = 8;

/**
 * Replaces raw tool calls with renders: a planner for schedules, rows for
 * course lists, and a quiet chip for everything else.
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
            Open {app.name} ↗
          </a>
        )}
      </ToolChip>
    );
  }

  if (running) {
    return (
      <ToolChip view={view} running>
        checking…
      </ToolChip>
    );
  }

  const schedule = extractSchedule(view.data);
  if (schedule) {
    return (
      <ToolCard view={view} label={cardLabel(view, schedule.termName)}>
        {schedule.title && (
          <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: 14 }}>
            {schedule.title}
            {schedule.termName ? ` · ${schedule.termName}` : ""}
          </p>
        )}
        <WeekGrid schedule={schedule} compact />
      </ToolCard>
    );
  }

  const courses = extractCourses(view.data);
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
                  title="Ratings & reviews on PrincetonCourses ↗"
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
            +{courses.length - shown.length} more — ask PI to narrow it down
          </div>
        )}
      </ToolCard>
    );
  }

  return <ToolChip view={view} running={false} />;
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

function AppDot({ view }: { view: ToolView }) {
  const app = PI_APPS.find((a) => a.key === view.app);
  if (app) {
    return <img className="app-logo-sm" src={app.logo} alt={app.name} />;
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

function appName(view: ToolView): string {
  return PI_APPS.find((a) => a.key === view.app)?.name ?? "workspace";
}

function cardLabel(view: ToolView, suffix?: string): string {
  return [appName(view), suffix].filter(Boolean).join(" · ");
}

function shortError(text: string | null): string {
  if (!text) return "that didn't work";
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function ToolCard({
  view,
  label,
  children,
}: {
  view: ToolView;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tool-card">
      <div className="card-head">
        <AppDot view={view} />
        <span>{label}</span>
        <span className="spacer" />
        <span className="tname">{view.base}</span>
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
  const expandable = !running && view.data != null;
  return (
    <div>
      <div
        className={`tool-chip${running ? " running" : ""}${error ? " error" : ""}`}
      >
        <AppDot view={view} />
        <span className="tname">{view.base}</span>
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
