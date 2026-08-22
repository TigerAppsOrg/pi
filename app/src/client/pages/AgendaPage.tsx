import { useEffect, useMemo, useState } from "react";
import type { PiSettings } from "../../shared/apps";
import { StatusPill } from "../components/ToolCards";
import { useDesk } from "../lib/desk";
import { extractSchedule, tjColor, type ScheduleView } from "../lib/tools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

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
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [watches, setWatches] = useState<AnyRow[] | null>(null);
  const [trending, setTrending] = useState<AnyRow[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const palette = useMemo(() => new Map<string, string>(), [schedule]);

  const junctionOn = settings.apps.includes("junction");

  useEffect(() => {
    let cancelled = false;
    setSchedule(null);
    setWatches(null);
    setTrending(null);
    setBlocked(null);

    if (!junctionOn) {
      setBlocked("TigerJunction is off — the agenda reads from it.");
      return;
    }

    (async () => {
      if (settings.netid) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = (await desk.callApp("junction", "get_user_schedules", {})) as any;
          const schedules: AnyRow[] = rowsOf(list, "schedules");
          if (schedules.length > 0 && !cancelled) {
            schedules.sort((a, b) => (b.term ?? 0) - (a.term ?? 0));
            const details = await desk.callApp(
              "junction",
              "get_schedule_details",
              { scheduleId: schedules[0].id }
            );
            if (!cancelled) setSchedule(extractSchedule(details));
          }
        } catch {
          /* personal data unavailable — sections below still load */
        }
        try {
          const subs = await desk.callApp(
            "junction",
            "get_snatch_subscriptions",
            {}
          );
          if (!cancelled) setWatches(rowsOf(subs, "subscriptions", "courses"));
        } catch {
          if (!cancelled) setWatches([]);
        }
      } else {
        setWatches([]);
      }
      try {
        const hot = await desk.callApp("junction", "get_trending_courses", {});
        if (!cancelled) setTrending(rowsOf(hot, "trending", "courses").slice(0, 8));
      } catch {
        if (!cancelled) setTrending([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [desk.settingsHash]);

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">Agenda</h1>
        <p className="page-sub">
          Everything on your plate, <span className="hand">at a glance</span>.
        </p>

        {blocked ? (
          <div className="empty-hand">
            {blocked}
            <br />
            <button className="cta" onClick={() => navigate("/apps")}>
              Turn it on in My apps →
            </button>
          </div>
        ) : (
          <>
            <div className="paper-card">
              <h3>This semester</h3>
              {schedule ? (
                <div>
                  {courseRows(schedule).map((c) => (
                    <div key={c.code} className="agenda-row">
                      <span
                        className="swatch"
                        style={{ background: tjColor(c.color) }}
                      />
                      <span className="code">{c.code}</span>
                      <span className="what">{c.times}</span>
                      {c.room && <span className="when">{c.room}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-hand">
                  {settings.netid
                    ? "nothing penciled in yet — ask PI to build you a schedule"
                    : "set your netid to see your courses here"}
                  <br />
                  <button
                    className="cta"
                    onClick={() => navigate(settings.netid ? "/" : "/apps")}
                  >
                    {settings.netid ? "Open chat →" : "My apps →"}
                  </button>
                </div>
              )}
            </div>

            <div className="paper-card">
              <h3>Seat watch</h3>
              {watches == null ? (
                <div className="empty-hand">checking…</div>
              ) : watches.length === 0 ? (
                <div className="empty-hand">
                  no seats being watched — ask PI to snatch one when it opens
                </div>
              ) : (
                watches.map((w, i) => (
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
                ))
              )}
            </div>

            <div className="paper-card">
              <h3>Trending on campus</h3>
              {trending == null ? (
                <div className="empty-hand">checking…</div>
              ) : trending.length === 0 ? (
                <div className="empty-hand">quiet week — nothing spiking</div>
              ) : (
                trending.map((t, i) => (
                  <div key={i} className="agenda-row">
                    <span
                      className="swatch"
                      style={{ background: "var(--hl-lemon)" }}
                    />
                    <span className="code">
                      {t.code ?? t.courseCode ?? "?"}
                    </span>
                    <span className="what">{t.title ?? t.name ?? ""}</span>
                    {(t.subscriptions ?? t.demand ?? t.count) != null && (
                      <span className="when">
                        {t.subscriptions ?? t.demand ?? t.count} watching
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function courseRows(schedule: ScheduleView) {
  return schedule.courses.map((c) => {
    const confirmed = schedule.meetings.filter(
      (m) => m.courseCode === c.code && m.confirmed
    );
    let times: string;
    if (confirmed.length > 0) {
      times = `${abbrevDays(confirmed)} ${confirmed[0].startLabel}–${confirmed[0].endLabel}`;
      if (c.pending.length > 0) times += ` · ${c.pending.join("/")} not picked`;
    } else if (c.pending.length > 0) {
      times = `${c.pending.join("/")} not picked yet`;
    } else {
      times = "time TBA";
    }
    return {
      code: c.code,
      color: c.color,
      times,
      room: confirmed[0]?.room ?? null,
    };
  });
}

function abbrevDays(meetings: { days: string[] }[]): string {
  const days = new Set<string>();
  for (const m of meetings) {
    for (const d of m.days) {
      const t = d.trim().toLowerCase();
      if (t.startsWith("m")) days.add("M");
      else if (t.startsWith("tu") || t === "t") days.add("T");
      else if (t.startsWith("w")) days.add("W");
      else if (t.startsWith("th")) days.add("Th");
      else if (t.startsWith("f")) days.add("F");
    }
  }
  return ["M", "T", "W", "Th", "F"].filter((d) => days.has(d)).join("");
}
