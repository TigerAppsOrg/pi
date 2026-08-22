import { useEffect, useState } from "react";
import type { PiSettings } from "../../shared/apps";
import { WeekGrid } from "../components/WeekGrid";
import { useDesk } from "../lib/desk";
import { extractSchedule, type ScheduleView } from "../lib/tools";

type SchedMeta = { id: number; title: string; term: number; termName?: string };

type Load =
  | { kind: "loading" }
  | { kind: "blocked"; reason: string; cta: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; schedules: SchedMeta[] };

export function PlannerPage({
  settings,
  navigate,
}: {
  settings: PiSettings;
  navigate: (path: string) => void;
}) {
  const desk = useDesk(settings);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [term, setTerm] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const junctionOn = settings.apps.includes("junction");

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setSchedule(null);
    setSelected(null);

    if (!settings.netid) {
      setLoad({
        kind: "blocked",
        reason: "PI doesn't know who you are yet.",
        cta: "Set your netid on My apps",
      });
      return;
    }
    if (!junctionOn) {
      setLoad({
        kind: "blocked",
        reason: "TigerJunction is switched off, so there's no schedule to draw.",
        cta: "Turn it on in My apps",
      });
      return;
    }

    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await desk.callApp(
          "junction",
          "get_user_schedules",
          {}
        )) as any;
        if (cancelled) return;
        const schedules: SchedMeta[] = Array.isArray(data?.schedules)
          ? data.schedules
          : [];
        if (schedules.length === 0) {
          setLoad({
            kind: "blocked",
            reason: "No schedules in TigerJunction yet.",
            cta: "Ask PI to start one for you",
          });
          return;
        }
        schedules.sort((a, b) => b.term - a.term);
        setLoad({ kind: "ready", schedules });
        setTerm(schedules[0].term);
        setSelected(schedules[0].id);
      } catch (err) {
        if (!cancelled) {
          setLoad({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [desk.settingsHash]);

  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    setSchedule(null);
    setDetailError(null);
    (async () => {
      try {
        const data = await desk.callApp("junction", "get_schedule_details", {
          scheduleId: selected,
        });
        if (cancelled) return;
        const view = extractSchedule(data);
        if (view) setSchedule(view);
        else setDetailError("This schedule has no scheduled meetings yet.");
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, desk.settingsHash]);

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">Planner</h1>
        <p className="page-sub">
          Your week, <span className="hand">in highlighter</span> — straight
          from TigerJunction.
        </p>

        {load.kind === "loading" && (
          <div className="empty-hand">fetching your week…</div>
        )}

        {load.kind === "blocked" && (
          <div className="empty-hand">
            {load.reason}
            <br />
            <button
              className="cta"
              onClick={() =>
                navigate(load.cta.includes("Ask PI") ? "/" : "/apps")
              }
            >
              {load.cta} →
            </button>
          </div>
        )}

        {load.kind === "error" && (
          <div className="empty-hand">
            TigerJunction didn't answer: {load.message}
            <br />
            <button className="cta" onClick={() => navigate("/apps")}>
              Check your connections →
            </button>
          </div>
        )}

        {load.kind === "ready" && (
          <>
            <div className="sched-tabs" role="tablist">
              <select
                className="term-select"
                aria-label="Term"
                value={term ?? undefined}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setTerm(t);
                  const first = load.schedules.find((s) => s.term === t);
                  if (first) setSelected(first.id);
                }}
              >
                {[...new Map(load.schedules.map((s) => [s.term, s])).values()].map(
                  (s) => (
                    <option key={s.term} value={s.term}>
                      {s.termName ?? s.term}
                    </option>
                  )
                )}
              </select>
              {load.schedules
                .filter((s) => s.term === term)
                .map((s) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={s.id === selected}
                    className={
                      s.id === selected ? "sched-tab active" : "sched-tab"
                    }
                    onClick={() => setSelected(s.id)}
                  >
                    {s.title || `Schedule ${s.id}`}
                  </button>
                ))}
            </div>
            <div className="paper-card">
              {schedule ? (
                <WeekGrid schedule={schedule} />
              ) : detailError ? (
                <div className="empty-hand">{detailError}</div>
              ) : (
                <div className="empty-hand">inking it in…</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
