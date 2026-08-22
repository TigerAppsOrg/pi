import { useEffect, useState } from "react";
import { PI_APPS, type PiSettings } from "../../shared/apps";
import { WeekGrid } from "../components/WeekGrid";
import { useDesk } from "../lib/desk";
import { extractSchedule, type ScheduleView } from "../lib/tools";

type SchedMeta = { id: number; title: string; term: number; termName?: string };

type Load =
  | { kind: "loading" }
  | { kind: "blocked"; reason: string; cta: string }
  | { kind: "fresh" }
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
          setLoad({ kind: "fresh" });
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

        {(load.kind === "error" || load.kind === "fresh") && (
          <div className="empty-hand">
            {load.kind === "fresh"
              ? "Your TigerJunction shelf is empty — build a schedule there and it shows up here."
              : "PI couldn't open your TigerJunction schedules — you may just not have visited TigerJunction yet."}
            <br />
            <a
              className="cta"
              href={PI_APPS.find((a) => a.key === "junction")!.home}
              target="_blank"
              rel="noreferrer"
            >
              Open TigerJunction ↗
            </a>
            <button
              className="cta"
              style={{ marginLeft: 18 }}
              onClick={() => navigate("/")}
            >
              Ask PI instead →
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
