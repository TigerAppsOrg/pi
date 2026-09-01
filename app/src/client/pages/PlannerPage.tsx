import { useCallback, useEffect, useRef, useState } from "react";
import { PI_APPS, type PiSettings } from "../../shared/apps";
import { IconChevron, IconExternal } from "../components/Icons";
import { WeekGrid } from "../components/WeekGrid";
import { friendlyError, rawError, useDesk } from "../lib/desk";
import { extractSchedule, type ScheduleView } from "../lib/tools";
import "../styles/desk.css";

type SchedMeta = { id: number; title: string; term: number; termName?: string };

type Load =
  | { kind: "loading" }
  | { kind: "blocked" }
  | { kind: "fresh" }
  | { kind: "error"; err: unknown }
  | { kind: "ready"; schedules: SchedMeta[] };

type Detail =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; err: unknown }
  | { kind: "ready"; schedule: ScheduleView };

const JUNCTION = PI_APPS.find((a) => a.key === "junction")!;

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
  const [detail, setDetail] = useState<Detail>({ kind: "loading" });

  const junctionOn = settings.apps.includes("junction");
  const gen = useRef({ list: 0, detail: 0 });

  const loadSchedules = useCallback(async () => {
    const id = ++gen.current.list;
    setLoad({ kind: "loading" });
    setDetail({ kind: "loading" });
    setSelected(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await desk.callApp(
        "junction",
        "get_user_schedules",
        {}
      )) as any;
      if (gen.current.list !== id) return;
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
      if (gen.current.list === id) setLoad({ kind: "error", err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  const loadDetail = useCallback(
    async (scheduleId: number) => {
      const id = ++gen.current.detail;
      setDetail({ kind: "loading" });
      try {
        const data = await desk.callApp("junction", "get_schedule_details", {
          scheduleId,
        });
        if (gen.current.detail !== id) return;
        const view = extractSchedule(data);
        setDetail(view ? { kind: "ready", schedule: view } : { kind: "empty" });
      } catch (err) {
        if (gen.current.detail === id) setDetail({ kind: "error", err });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desk.settingsHash]
  );

  useEffect(() => {
    if (!junctionOn) {
      gen.current.list += 1;
      gen.current.detail += 1;
      setLoad({ kind: "blocked" });
      return;
    }
    void loadSchedules();
    return () => {
      gen.current.list += 1;
      gen.current.detail += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  useEffect(() => {
    // Wait for the list: on a settings change `selected` still holds the old
    // schedule for one render, and fetching it would be a wasted round trip.
    if (selected == null || load.kind !== "ready") return;
    void loadDetail(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, desk.settingsHash]);

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">
          My <span className="ink-word swipe v3">Planner</span>
        </h1>
        <p className="page-sub">
          Straight from TigerJunction, <span className="hand">in highlighter</span>.
        </p>

        {load.kind === "loading" && (
          <div className="paper-card sheet-skel" aria-busy="true">
            <span className="skel skel-line" />
            <span className="skel skel-line" />
            <span className="skel skel-line" />
            <span className="skel skel-line" />
            <span className="sr-only">fetching your week</span>
          </div>
        )}

        {load.kind === "blocked" && (
          <div className="empty-hand">
            TigerJunction is switched off, so there's no week to draw.
            <br />
            <button className="cta" onClick={() => navigate("/apps")}>
              Turn it on in My apps
              <IconChevron size={13} />
            </button>
          </div>
        )}

        {load.kind === "fresh" && (
          <div className="empty-hand">
            your TigerJunction shelf is empty. build a schedule there and it
            shows up here.
            <br />
            <a
              className="cta"
              href={JUNCTION.home}
              target="_blank"
              rel="noreferrer"
            >
              Open TigerJunction
              <IconExternal size={13} />
            </a>
            <button className="cta" onClick={() => navigate("/")}>
              Ask PI instead
              <IconChevron size={13} />
            </button>
          </div>
        )}

        {load.kind === "error" && (
          <div className="card-error" title={rawError(load.err)}>
            <p>{friendlyError(load.err, "TigerJunction")}</p>
            <button className="btn btn-ghost btn-sm" onClick={loadSchedules}>
              Try again
            </button>
          </div>
        )}

        {load.kind === "ready" && (
          <>
            <div className="picker">
              <label className="picker-label" htmlFor="planner-term">
                Term
              </label>
              <select
                id="planner-term"
                className="term-select"
                value={term ?? undefined}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setTerm(t);
                  const first = load.schedules.find((s) => s.term === t);
                  if (first) setSelected(first.id);
                }}
              >
                {[
                  ...new Map(load.schedules.map((s) => [s.term, s])).values(),
                ].map((s) => (
                  <option key={s.term} value={s.term}>
                    {s.termName ?? s.term}
                  </option>
                ))}
              </select>
              {load.schedules
                .filter((s) => s.term === term)
                .map((s) => (
                  <button
                    key={s.id}
                    aria-pressed={s.id === selected}
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
              {detail.kind === "ready" && (
                <div className="week-scroll">
                  <WeekGrid schedule={detail.schedule} />
                </div>
              )}
              {detail.kind === "loading" && (
                <div className="empty-hand">inking it in…</div>
              )}
              {detail.kind === "empty" && (
                <div className="empty-hand">
                  this one has no meeting times yet.
                  <br />
                  <a
                    className="cta"
                    href={JUNCTION.home}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pick sections in TigerJunction
                    <IconExternal size={13} />
                  </a>
                </div>
              )}
              {detail.kind === "error" && (
                <div className="card-error" title={rawError(detail.err)}>
                  <p>{friendlyError(detail.err, "that schedule")}</p>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => selected != null && loadDetail(selected)}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>

            <p className="footnote">
              PI reads this from TigerJunction. Changes you make there show up
              the next time you open this page.{" "}
              <a
                className="week-link"
                href={JUNCTION.home}
                target="_blank"
                rel="noreferrer"
              >
                Open TigerJunction
                <IconExternal size={13} />
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
