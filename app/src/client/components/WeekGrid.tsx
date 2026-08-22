import type { Meeting, ScheduleView } from "../lib/tools";
import { tjColor } from "../lib/tools";

const DAY_COLUMNS = [
  ["Monday", "M"],
  ["Tuesday", "T"],
  ["Wednesday", "W"],
  ["Thursday", "Th"],
  ["Friday", "F"],
] as const;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const START = 8 * 60; // 8:00 AM

function onDay(m: Meeting, full: string, short: string): boolean {
  return m.days.some((d) => {
    const t = d.trim().toLowerCase();
    return (
      t === full.toLowerCase() ||
      t === short.toLowerCase() ||
      t === full.slice(0, 3).toLowerCase()
    );
  });
}

type Placed = { meeting: Meeting; col: number; cols: number };

/** Lay out one day's blocks, splitting overlapping meetings into columns. */
function layoutDay(meetings: Meeting[]): Placed[] {
  const sorted = [...meetings].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin
  );
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = Math.max(...cluster.map((p) => p.col + 1), 1);
    for (const p of cluster) p.cols = cols;
    placed.push(...cluster);
    cluster = [];
  };

  for (const m of sorted) {
    if (cluster.length > 0 && m.startMin >= clusterEnd) flush();
    const busy = new Set(
      cluster
        .filter((p) => p.meeting.endMin > m.startMin)
        .map((p) => p.col)
    );
    let col = 0;
    while (busy.has(col)) col++;
    cluster.push({ meeting: m, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, m.endMin);
  }
  if (cluster.length > 0) flush();
  return placed;
}

/** TigerJunction-style week calendar: solid course colors, striped options. */
export function WeekGrid({
  schedule,
  compact = false,
}: {
  schedule: ScheduleView;
  compact?: boolean;
}) {
  // Extend the day to fit evening sections (at least 8a–6p, at most 8a–11p).
  const latest = Math.max(18 * 60, ...schedule.meetings.map((m) => m.endMin));
  const END = Math.min(23 * 60, Math.ceil(latest / 60) * 60);
  const SPAN = END - START;
  const hours = SPAN / 60;

  const ticks: number[] = [];
  for (let h = START / 60; h <= END / 60; h += 2) ticks.push(h);

  const hasOptions = schedule.meetings.some((m) => !m.confirmed);

  return (
    <div>
      <div
        className={compact ? "week compact" : "week"}
        style={{ "--rows": hours } as React.CSSProperties}
      >
        <div className="axis" aria-hidden>
          <div className="day-name">&nbsp;</div>
          <div className="axis-col">
            {ticks.map((h) => (
              <span
                key={h}
                className="tick"
                style={{ top: `${((h * 60 - START) / SPAN) * 100}%` }}
              >
                {h > 12 ? h - 12 : h}
                {h >= 12 ? "p" : "a"}
              </span>
            ))}
          </div>
        </div>
        {DAY_COLUMNS.map(([full, short], di) => (
          <div key={full} className="day">
            <div className="day-name">{DAY_LABELS[di]}</div>
            <div className="day-col">
              {layoutDay(
                schedule.meetings.filter((m) => onDay(m, full, short))
              ).map(({ meeting: m, col, cols }, i) => {
                const top = ((m.startMin - START) / SPAN) * 100;
                const height = Math.max(
                  ((m.endMin - m.startMin) / SPAN) * 100,
                  3.5
                );
                const width = 98 / cols;
                const duration = m.endMin - m.startMin;
                const cls = [
                  "block",
                  m.confirmed ? "" : "option",
                  m.conflicted ? "conflicted" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={`${m.courseCode}-${m.label}-${i}`}
                    className={cls}
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      left: `${1 + col * width}%`,
                      width: `${width - (cols > 1 ? 1 : 0)}%`,
                      backgroundColor: tjColor(m.color),
                      borderLeftColor: tjColor(m.color, m.confirmed ? 40 : 20),
                      color: tjColor(m.color, 60),
                      animationDelay: `${(di * 3 + i) * 0.02}s`,
                    }}
                    title={`${m.courseCode} ${m.label} · ${m.startLabel}–${m.endLabel}${m.room ? ` · ${m.room}` : ""}${m.confirmed ? "" : " · option — pick in TigerJunction"}`}
                  >
                    {!compact && duration >= 60 && cols <= 2 && (
                      <div className="btime">
                        {m.startLabel.replace(" ", "")}–
                        {m.endLabel.replace(" ", "")}
                      </div>
                    )}
                    <div className="bcode">
                      {m.courseCode}
                      {!compact && cols <= 3 ? ` ${m.label}` : ""}
                    </div>
                    {!compact && duration >= 80 && cols === 1 && m.room && (
                      <div className="bwhere">{m.room}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!compact && schedule.courses.length > 0 && (
        <div className="cal-legend">
          {schedule.courses.map((c) => (
            <span key={c.code} className="legend-chip">
              <span
                className="legend-swatch"
                style={{
                  background: tjColor(c.color),
                  borderColor: tjColor(c.color, 40),
                }}
              />
              {c.code}
              {c.pending.length > 0 && (
                <em className="legend-pending">
                  {c.pending.join("/")} not picked
                </em>
              )}
            </span>
          ))}
        </div>
      )}

      {schedule.tba.length > 0 && (
        <p className="tba-note">Time TBA: {schedule.tba.join(", ")}</p>
      )}

      {schedule.conflicts.length > 0 && (
        <div className="conflict-note">
          <span className="lead">heads up — </span>
          {schedule.conflicts.join("; ")}
        </div>
      )}

      {!compact && hasOptions && (
        <p className="tba-note">
          Striped blocks are section options you haven't locked in —{" "}
          <a
            href="https://junction.tigerapps.org"
            target="_blank"
            rel="noreferrer"
          >
            pick them in TigerJunction ↗
          </a>
        </p>
      )}
    </div>
  );
}
