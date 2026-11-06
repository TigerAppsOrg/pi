import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_CONSTRAINTS,
  DAYS,
  dayLabel,
  timeLabel,
  type Constraints,
  type Diagnosis,
  type Plan,
  type ScheduleProblem,
  type SectionGroup,
} from "../scheduling/model";
import { useSolver } from "../scheduling/useSolver";
import "../styles/semester-lab.css";

const COLORS = [
  "#c8e2cb",
  "#f2d3ab",
  "#c9e1ec",
  "#ddd1ee",
  "#f0ced8",
  "#e7e2ad",
];
const kind = (g: SectionGroup) =>
  ({
    L: "Lecture",
    P: "Precept",
    B: "Lab",
    LA: "Lab",
    S: "Seminar",
    C: "Class",
  })[g.category] ?? g.category;
const hours = Array.from({ length: 15 }, (_, i) => (i + 7) * 60);
const minutes = (n: number) =>
  n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`;
const samePicks = (a: Plan, b: Plan) =>
  Object.keys(a.picks).every((id) => a.picks[id] === b.picks[id]);

function Mark({
  type,
  size = 16,
}: {
  type: "lock" | "undo" | "pin" | "check" | "arrow" | "x";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </>
      ) : type === "undo" ? (
        <>
          <path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12" />
        </>
      ) : type === "pin" ? (
        <>
          <path d="m8 3 8 0-1 7 4 4H5l4-4-1-7ZM12 14v7" />
        </>
      ) : type === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : type === "arrow" ? (
        <path d="M4 12h16m-5-5 5 5-5 5" />
      ) : (
        <path d="m6 6 12 12M18 6 6 18" />
      )}
    </svg>
  );
}

export function SemesterLab({ problem }: { problem: ScheduleProblem }) {
  const [constraints, setConstraints] = useState<Constraints>(() => ({
    ...DEFAULT_CONSTRAINTS,
    objective: "changes",
    locks: {},
    busy: [],
  }));
  const [history, setHistory] = useState<Constraints[]>([]);
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState<Plan | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockDay, setBlockDay] = useState(1);
  const [blockStart, setBlockStart] = useState(16 * 60);
  const [blockEnd, setBlockEnd] = useState(18 * 60);
  const search = useSolver(problem, constraints);
  const courses = useMemo(
    () => [...new Set(problem.groups.map((g) => g.course))],
    [problem],
  );
  const color = (course: string) =>
    COLORS[courses.indexOf(course) % COLORS.length];
  const result = search.kind === "done" ? search.result : null;
  const plan =
    result?.plans[Math.min(active, Math.max(0, result.plans.length - 1))] ??
    null;
  const previousPlan = useRef<Plan | null>(null);
  if (plan) previousPlan.current = plan;
  const displayPlan =
    plan ?? (search.kind === "loading" ? previousPlan.current : null);
  const changed =
    pinned && plan
      ? problem.groups.filter((g) => pinned.picks[g.id] !== plan.picks[g.id])
      : [];

  const change = useCallback(
    (next: Constraints) => {
      setHistory((h) => [...h.slice(-29), constraints]);
      setConstraints(next);
      setActive(0);
      setCopied(false);
      setCopyError(false);
    },
    [constraints],
  );
  const undo = useCallback(() => {
    if (!history.length) return;
    setConstraints(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setActive(0);
  }, [history]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z" ||
        event.shiftKey
      )
        return;
      if (
        (event.target as HTMLElement)?.closest(
          "input,select,textarea,[contenteditable=true]",
        )
      )
        return;
      if (history.length) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [history.length, undo]);
  const toggleLock = (group: SectionGroup, optionId: string) => {
    const locks = { ...constraints.locks };
    if (locks[group.id] === optionId) delete locks[group.id];
    else locks[group.id] = optionId;
    change({ ...constraints, locks });
  };
  const copy = async () => {
    if (!plan) return;
    const lines = [
      problem.title,
      problem.source === "sample"
        ? "SAMPLE DATA. These section times are synthetic."
        : problem.term,
    ];
    for (const group of problem.groups) {
      const option = group.options.find((o) => o.id === plan.picks[group.id])!;
      lines.push(
        `${group.course} ${option.title}. ${option.meetings.map((m) => `${dayLabel(m.days)} ${timeLabel(m.start)} to ${timeLabel(m.end)}`).join(", ")}`,
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };
  const focused = problem.groups.find((g) => g.id === focusGroup);
  const combinations = problem.groups.reduce((n, g) => n * g.options.length, 1);

  return (
    <section className="semester-lab" aria-label="Interactive semester planner">
      <header className="lab-header">
        <div>
          <div className="lab-eyebrow">PI / SEMESTER LAB</div>
          <h2>
            Your week, <span>with room to breathe.</span>
          </h2>
          <p>Keep what matters. See what moves.</p>
        </div>
        <div className="lab-header-actions">
          <button
            type="button"
            className="lab-button"
            onClick={undo}
            disabled={!history.length}
            title="Undo the last constraint change. Command or Control Z."
          >
            <Mark type="undo" />
            Undo
          </button>
          <button
            type="button"
            className="lab-button"
            disabled={!plan}
            onClick={() => plan && setPinned(plan)}
          >
            <Mark type="pin" />
            {pinned && plan && samePicks(pinned, plan)
              ? "Pinned"
              : "Pin comparison"}
          </button>
        </div>
      </header>

      <div className="lab-layout">
        <aside className="lab-controls">
          <details className="lab-mobile-controls" open>
            <summary>
              Shape your week <span>{courses.length} courses</span>
            </summary>
            <div className="lab-control-content">
              <div className="lab-section-label">MAKE ROOM</div>
              <label className="lab-field">
                <span>Start no earlier than</span>
                <select
                  aria-label="Start no earlier than"
                  value={constraints.earliest}
                  onChange={(e) =>
                    change({
                      ...constraints,
                      earliest: Number(e.target.value),
                      latest: Math.max(
                        Number(e.target.value),
                        constraints.latest,
                      ),
                    })
                  }
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {timeLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lab-field">
                <span>Finish by</span>
                <select
                  aria-label="Finish by"
                  value={constraints.latest}
                  onChange={(e) =>
                    change({
                      ...constraints,
                      latest: Number(e.target.value),
                      earliest: Math.min(
                        Number(e.target.value),
                        constraints.earliest,
                      ),
                    })
                  }
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {timeLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="lab-days">
                <legend>Keep a day free</legend>
                {DAYS.slice(0, 5).map((day, d) => (
                  <button
                    type="button"
                    key={day}
                    aria-pressed={!!(constraints.offDays & (1 << d))}
                    aria-label={`Keep ${day} free`}
                    onClick={() =>
                      change({
                        ...constraints,
                        offDays: constraints.offDays ^ (1 << d),
                      })
                    }
                  >
                    {day}
                  </button>
                ))}
              </fieldset>
              <label className="lab-objective">
                <span>Find me</span>
                <select
                  value={constraints.objective}
                  onChange={(e) =>
                    change({
                      ...constraints,
                      objective: e.target.value as Constraints["objective"],
                    })
                  }
                >
                  <option value="changes">The fewest section changes</option>
                  <option value="compact">A compact week</option>
                  <option value="late">The latest first class</option>
                </select>
              </label>

              <div className="lab-section-label lab-course-heading">
                YOUR COURSES{" "}
                <span>{problem.groups.length} required section groups</span>
              </div>
              {courses.map((course) => (
                <div className="lab-course" key={course}>
                  <div className="lab-course-name">
                    <span
                      className="lab-course-dot"
                      style={{ background: color(course) }}
                    />
                    <strong>{course}</strong>
                    <span>
                      {
                        problem.groups.find((g) => g.course === course)
                          ?.courseTitle
                      }
                    </span>
                  </div>
                  {problem.groups
                    .filter((g) => g.course === course)
                    .map((group) => (
                      <div
                        key={group.id}
                        className={`lab-section-choice${constraints.locks[group.id] ? " locked" : ""}`}
                      >
                        <label>
                          <span>{kind(group)}</span>
                          <select
                            aria-label={`${group.course} ${kind(group)} choice`}
                            value={constraints.locks[group.id] ?? ""}
                            onChange={(e) => {
                              const locks = { ...constraints.locks };
                              if (e.target.value)
                                locks[group.id] = e.target.value;
                              else delete locks[group.id];
                              change({ ...constraints, locks });
                            }}
                          >
                            <option value="">Let PI choose</option>
                            {group.options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.title} ·{" "}
                                {option.meetings
                                  .map(
                                    (m) =>
                                      `${dayLabel(m.days)} ${timeLabel(m.start)}`,
                                  )
                                  .join(", ")}
                                {option.status !== "open"
                                  ? ` · ${option.status}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        {constraints.locks[group.id] && (
                          <button
                            type="button"
                            aria-label={`Unlock ${group.course} ${kind(group)}`}
                            onClick={() =>
                              toggleLock(group, constraints.locks[group.id])
                            }
                          >
                            <Mark type="lock" size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ))}

              <details className="lab-protect">
                <summary>
                  Protect time for something else <span>+</span>
                </summary>
                <div className="lab-protect-fields">
                  <label>
                    Day
                    <select
                      aria-label="Protected time day"
                      value={blockDay}
                      onChange={(e) => setBlockDay(Number(e.target.value))}
                    >
                      {DAYS.map((d, i) => (
                        <option value={1 << i} key={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From
                    <select
                      aria-label="Protected time start"
                      value={blockStart}
                      onChange={(e) => setBlockStart(Number(e.target.value))}
                    >
                      {hours.map((h) => (
                        <option value={h} key={h}>
                          {timeLabel(h)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Until
                    <select
                      aria-label="Protected time end"
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(Number(e.target.value))}
                    >
                      {hours.map((h) => (
                        <option value={h} key={h}>
                          {timeLabel(h)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="lab-button"
                    disabled={
                      blockStart >= blockEnd || constraints.busy.length >= 64
                    }
                    onClick={() =>
                      change({
                        ...constraints,
                        busy: [
                          ...constraints.busy,
                          {
                            id: crypto.randomUUID(),
                            label: `${dayLabel(blockDay)} ${timeLabel(blockStart)} to ${timeLabel(blockEnd)}`,
                            days: blockDay,
                            start: blockStart,
                            end: blockEnd,
                          },
                        ],
                      })
                    }
                  >
                    Protect this time
                  </button>
                </div>
              </details>
              {!!constraints.busy.length && (
                <ul className="lab-busy-list">
                  {constraints.busy.map((b) => (
                    <li key={b.id}>
                      {b.label}
                      <button
                        type="button"
                        aria-label={`Remove protected time ${b.label}`}
                        onClick={() =>
                          change({
                            ...constraints,
                            busy: constraints.busy.filter((x) => x.id !== b.id),
                          })
                        }
                      >
                        <Mark type="x" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="lab-checkbox">
                <input
                  type="checkbox"
                  checked={constraints.allowClosed}
                  onChange={(e) =>
                    change({ ...constraints, allowClosed: e.target.checked })
                  }
                />
                Include full sections
              </label>
            </div>
          </details>
        </aside>

        <div className="lab-workspace">
          <div
            className="lab-result-heading"
            aria-live="polite"
            aria-atomic="true"
          >
            <div>
              <span
                className={`lab-signal ${result?.status === "infeasible" || search.kind === "error" ? "no-fit" : ""}`}
              />
              <strong>
                {search.kind === "loading"
                  ? displayPlan
                    ? "Updating. Previous timetable shown…"
                    : "Finding room…"
                  : search.kind === "error"
                    ? "More data needed"
                    : result?.status === "infeasible"
                      ? "These constraints don't fit"
                      : result?.status === "limited"
                        ? "Search limit reached"
                        : "A complete week. Every section fits."}
              </strong>
            </div>
            {result && (
              <span className="lab-timing">
                {result.solveMs < 1 ? "<1" : result.solveMs.toFixed(1)} ms on
                this device
              </span>
            )}
          </div>
          {search.kind === "error" && (
            <p className="lab-message" role="alert">
              {search.message}
            </p>
          )}
          {result?.status === "limited" && (
            <p className="lab-message">
              {plan
                ? "These schedules fit. The search stopped before proving they are the best. Lock a section to narrow the search."
                : "The search stopped before finding a complete schedule. This does not mean your request is impossible. Try locking a section to narrow the search."}
            </p>
          )}
          {result?.status === "infeasible" && search.kind === "done" && (
            <ConflictExplanation
              problem={problem}
              diagnosis={search.diagnosis}
              onRelax={change}
            />
          )}

          {result?.status !== "infeasible" && search.kind !== "error" && (
            <div
              className={`lab-calendar-sheet${search.kind === "loading" ? " searching" : ""}`}
              aria-busy={search.kind === "loading"}
            >
              <div className="lab-sheet-top">
                <div>
                  <strong>{problem.title}</strong>
                  <span>{problem.term}</span>
                </div>
                <span className="lab-hand-note">
                  make space for the good stuff
                </span>
              </div>
              <Calendar
                problem={problem}
                constraints={constraints}
                plan={displayPlan}
                pinned={pinned}
                color={color}
                pending={search.kind === "loading"}
                onPick={(id) => setFocusGroup(id)}
              />
              {focused && plan && (
                <div className="lab-meeting-detail">
                  <div>
                    <strong>
                      {focused.course} {kind(focused)}
                    </strong>
                    <span>
                      {
                        focused.options.find(
                          (o) => o.id === plan.picks[focused.id],
                        )?.title
                      }
                      .{" "}
                      {constraints.locks[focused.id]
                        ? "This section is locked."
                        : "Keep this section while PI moves the others."}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="lab-button"
                    onClick={() => toggleLock(focused, plan.picks[focused.id])}
                  >
                    <Mark type="lock" />
                    {constraints.locks[focused.id] ? "Unlock" : "Lock section"}
                  </button>
                  <button
                    type="button"
                    className="lab-icon-button"
                    aria-label="Close section details"
                    onClick={() => setFocusGroup(null)}
                  >
                    <Mark type="x" />
                  </button>
                </div>
              )}
              <div className="lab-calendar-key">
                {courses.map((course) => (
                  <span key={course}>
                    <i style={{ background: color(course) }} />
                    {course}
                  </span>
                ))}
                {pinned && (
                  <span className="lab-pinned-key">
                    <i />
                    Pinned position
                  </span>
                )}
                <span className="lab-key-hint">
                  Click a class to lock its section
                </span>
                <span className="lab-swipe-hint">
                  Scroll across to see every day
                </span>
              </div>
            </div>
          )}

          {search.kind === "loading" && (
            <div
              className="lab-alternatives lab-search-placeholder"
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </div>
          )}
          {!!result?.plans.length && (
            <div
              className="lab-alternatives"
              aria-label="Ranked schedule alternatives"
            >
              {result.plans.map((candidate, i) => (
                <button
                  type="button"
                  key={i}
                  className={`lab-alternative${i === Math.min(active, result.plans.length - 1) ? " active" : ""}`}
                  aria-pressed={i === Math.min(active, result.plans.length - 1)}
                  onClick={() => {
                    setActive(i);
                    setCopied(false);
                  }}
                >
                  <span className="lab-plan-number">0{i + 1}</span>
                  <div>
                    <strong>
                      {i === 0
                        ? result.status === "optimal"
                          ? "Best fit"
                          : "Best found"
                        : `Alternative ${i + 1}`}
                    </strong>
                    <span>
                      {candidate.changes} section{" "}
                      {candidate.changes === 1 ? "change" : "changes"} ·{" "}
                      {minutes(candidate.gaps)} between classes
                    </span>
                  </div>
                  <MiniWeek problem={problem} plan={candidate} color={color} />
                  <span className="lab-choice-mark">
                    {i === Math.min(active, result.plans.length - 1) ? (
                      <Mark type="check" />
                    ) : (
                      <Mark type="arrow" />
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          {pinned && plan && (
            <div className="lab-comparison">
              <Mark type="pin" />
              <div>
                <strong>
                  {changed.length
                    ? `${changed.length} ${changed.length === 1 ? "section moved" : "sections moved"} from your pinned version`
                    : "Matches your pinned version"}
                </strong>
                {changed.length > 0 && (
                  <span>
                    {changed
                      .map(
                        (g) =>
                          `${g.course} ${g.options.find((o) => o.id === pinned.picks[g.id])?.title} → ${g.options.find((o) => o.id === plan.picks[g.id])?.title}`,
                      )
                      .join(" · ")}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="lab-icon-button"
                aria-label="Remove pinned comparison"
                onClick={() => setPinned(null)}
              >
                <Mark type="x" />
              </button>
            </div>
          )}

          <div className="lab-bottom-row">
            <span>
              {plan
                ? `${plan.days} class days. First class ${timeLabel(plan.earliest)}. Last finish ${timeLabel(plan.latest)}.`
                : "Complete schedules account for every required section group."}
            </span>
            <button
              type="button"
              className="lab-copy"
              disabled={!plan}
              onClick={() => void copy()}
            >
              {copied ? "Copied" : "Copy section list"}
              <Mark type={copied ? "check" : "arrow"} />
            </button>
          </div>
          {copyError && (
            <p className="lab-message" role="alert">
              Clipboard access was blocked. Select the section details to copy
              them manually.
            </p>
          )}
          <p className="lab-scope">
            {problem.source === "sample"
              ? "Sample data. These section times are synthetic. "
              : "Based on this Junction snapshot. "}
            Checks meeting times and listed availability. Prerequisites and
            registration eligibility are not checked. Your saved schedule stays
            unchanged.
          </p>
          <details
            className="lab-engine"
            open={detailsOpen}
            onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
          >
            <summary>How this was checked</summary>
            <div>
              <p>
                A C++ constraint solver runs as WebAssembly on your device. It
                picks one option for every section group, checks every meeting,
                then ranks complete schedules.
              </p>
              <dl>
                <div>
                  <dt>Possible section combinations</dt>
                  <dd>
                    {Number.isSafeInteger(combinations)
                      ? combinations.toLocaleString()
                      : ">9 quadrillion"}
                  </dd>
                </div>
                <div>
                  <dt>Search nodes visited</dt>
                  <dd>{result?.nodes.toLocaleString() ?? "—"}</dd>
                </div>
                <div>
                  <dt>Search result</dt>
                  <dd>
                    {result?.status === "optimal"
                      ? "Ranking proved"
                      : result?.status === "infeasible"
                        ? "No solution proved"
                        : result?.status === "limited"
                          ? "Incomplete"
                          : "Running"}
                  </dd>
                </div>
              </dl>
              <p>
                {constraints.objective === "compact"
                  ? "Compact week minimizes gap minutes plus 30 minutes per class day."
                  : constraints.objective === "changes"
                    ? "Fewest changes preserves current section picks first, then minimizes gaps."
                    : "Latest first class maximizes the earliest start across your week, then minimizes gaps."}{" "}
                Timing measures the local solve, excluding engine loading and
                conflict explanation.
              </p>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function ConflictExplanation({
  problem,
  diagnosis,
  onRelax,
}: {
  problem: ScheduleProblem;
  diagnosis?: Diagnosis;
  onRelax: (constraints: Constraints) => void;
}) {
  const groups = problem.groups.filter((g) => diagnosis?.groups.includes(g.id));
  const slots = new Set(
    groups.flatMap((g) =>
      g.options.flatMap((o) =>
        o.meetings.map((m) => `${m.days}|${m.start}|${m.end}`),
      ),
    ),
  );
  const bottleneck =
    groups.length > slots.size &&
    groups.every((g) => g.options.every((o) => o.meetings.length === 1));
  return (
    <div className="lab-conflict" role="status">
      <div className="lab-conflict-mark">!</div>
      <div>
        <h3>
          {groups.length === 1
            ? `${groups[0].course} has no section that fits.`
            : bottleneck
              ? `${groups.length} required groups. Only ${slots.size} distinct time slots.`
              : "Something has to give."}
        </h3>
        <p>
          {bottleneck
            ? "At least two required sections must overlap. Changing their order cannot make this timetable work."
            : "No complete combination satisfies all of the current constraints."}
        </p>
        <div className="lab-conflict-options">
          {groups.map((g) => (
            <div key={g.id}>
              <strong>
                {g.course} <span>{kind(g)}</span>
              </strong>
              <div>
                {g.options.slice(0, 6).map((o) => (
                  <span key={o.id}>
                    {o.title} ·{" "}
                    {o.meetings
                      .map((m) => `${dayLabel(m.days)} ${timeLabel(m.start)}`)
                      .join(", ")}
                  </span>
                ))}
                {g.options.length > 6 && (
                  <span>+{g.options.length - 6} more sections</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {!!diagnosis?.relaxations.length && (
          <div className="lab-relaxations">
            <span>These changes each make a complete schedule possible</span>
            {diagnosis.relaxations.map((r, i) => (
              <button
                type="button"
                key={i}
                onClick={() => onRelax(r.constraints)}
              >
                {r.label}
                <Mark type="arrow" size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Calendar({
  problem,
  constraints,
  plan,
  pinned,
  color,
  pending,
  onPick,
}: {
  problem: ScheduleProblem;
  constraints: Constraints;
  plan: Plan | null;
  pinned: Plan | null;
  color: (course: string) => string;
  pending: boolean;
  onPick: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, DOMRect>());
  const slots = problem.groups.flatMap((g) =>
    g.options.flatMap((o) => o.meetings),
  );
  const dayCount = [...slots, ...constraints.busy].some((m) => m.days & 96)
    ? 7
    : 5;
  const start = Math.min(
    8 * 60,
    ...slots.map((m) => Math.floor(m.start / 60) * 60),
  );
  const end = Math.max(
    18 * 60,
    ...slots.map((m) => Math.ceil(m.end / 60) * 60),
  );
  const span = end - start;
  const height = Math.max(440, (span / 60) * 48);
  useLayoutEffect(() => {
    if (!root.current) return;
    const next = new Map<string, DOMRect>();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    root.current
      .querySelectorAll<HTMLElement>("[data-meeting]")
      .forEach((element) => {
        const key = element.dataset.meeting!,
          rect = element.getBoundingClientRect(),
          old = previous.current.get(key);
        if (old && !reduced && (old.x !== rect.x || old.y !== rect.y))
          element.animate(
            [
              {
                transform: `translate(${old.x - rect.x}px,${old.y - rect.y}px)`,
                opacity: 0.65,
              },
              { transform: "translate(0,0)", opacity: 1 },
            ],
            { duration: 360, easing: "cubic-bezier(.16,1,.3,1)" },
          );
        next.set(key, rect);
      });
    if (plan) previous.current = next;
  }, [plan]);
  return (
    <div
      className="lab-calendar-scroll"
      tabIndex={0}
      role="region"
      aria-label={
        pending ? "Previous weekly timetable. Updating." : "Weekly timetable"
      }
      inert={pending || undefined}
    >
      <div
        className="lab-calendar"
        ref={root}
        style={
          {
            "--lab-days": dayCount,
            "--lab-grid-height": `${height}px`,
            "--lab-hour-height": `${height / (span / 60)}px`,
          } as React.CSSProperties
        }
      >
        <div className="lab-day-header">
          <span />
          {DAYS.slice(0, dayCount).map((d, i) => (
            <div
              key={d}
              className={constraints.offDays & (1 << i) ? "is-free" : ""}
            >
              {d}
              <small>{constraints.offDays & (1 << i) ? "YOURS" : ""}</small>
            </div>
          ))}
        </div>
        <div className="lab-grid-body">
          <div className="lab-time-axis">
            {Array.from(
              { length: Math.floor(span / 60) + 1 },
              (_, i) => start + i * 60,
            ).map((t) => (
              <span key={t} style={{ top: `${((t - start) / span) * 100}%` }}>
                {timeLabel(t)}
              </span>
            ))}
          </div>
          <div className="lab-grid-days">
            {DAYS.slice(0, dayCount).map((d, i) => (
              <div
                className={`lab-day-column${constraints.offDays & (1 << i) ? " is-free" : ""}`}
                key={d}
                style={{
                  left: `${(i / dayCount) * 100}%`,
                  width: `${100 / dayCount}%`,
                }}
              >
                {constraints.offDays & (1 << i) ? (
                  <span className="lab-free-note">all yours</span>
                ) : null}
              </div>
            ))}
            {constraints.busy.flatMap((b) =>
              DAYS.slice(0, dayCount).flatMap((_, d) =>
                b.days & (1 << d)
                  ? [
                      <div
                        key={`${b.id}-${d}`}
                        className="lab-protected-block"
                        style={{
                          left: `${(d / dayCount) * 100}%`,
                          width: `${100 / dayCount}%`,
                          top: `${Math.max(0, (b.start - start) / span) * 100}%`,
                          height: `${Math.max(0, (Math.min(end, b.end) - Math.max(start, b.start)) / span) * 100}%`,
                        }}
                      >
                        Protected
                      </div>,
                    ]
                  : [],
              ),
            )}
            {pinned &&
              plan &&
              problem.groups.flatMap((g) => {
                if (pinned.picks[g.id] === plan.picks[g.id]) return [];
                const option = g.options.find(
                  (o) => o.id === pinned.picks[g.id],
                );
                return (
                  option?.meetings.flatMap((m, mi) =>
                    DAYS.slice(0, dayCount).flatMap((_, d) =>
                      m.days & (1 << d)
                        ? [
                            <div
                              key={`old-${g.id}-${mi}-${d}`}
                              className="lab-ghost-block"
                              aria-hidden="true"
                              style={{
                                left: `calc(${(d / dayCount) * 100}% + 3px)`,
                                width: `calc(${100 / dayCount}% - 6px)`,
                                top: `${((m.start - start) / span) * 100}%`,
                                height: `${((m.end - m.start) / span) * 100}%`,
                              }}
                            />,
                          ]
                        : [],
                    ),
                  ) ?? []
                );
              })}
            {plan &&
              problem.groups.flatMap((g) => {
                const option = g.options.find(
                  (o) => o.id === plan.picks[g.id],
                )!;
                return option.meetings.flatMap((m, mi) =>
                  DAYS.slice(0, dayCount).flatMap((_, d) =>
                    m.days & (1 << d)
                      ? [
                          <button
                            type="button"
                            key={`${g.id}-${mi}-${d}`}
                            data-meeting={`${g.id}-${mi}-${d}`}
                            className={`lab-class-block${constraints.locks[g.id] ? " is-locked" : ""}`}
                            style={{
                              left: `calc(${(d / dayCount) * 100}% + 4px)`,
                              width: `calc(${100 / dayCount}% - 8px)`,
                              top: `${((m.start - start) / span) * 100}%`,
                              height: `${((m.end - m.start) / span) * 100}%`,
                              background: color(g.course),
                            }}
                            onClick={() => onPick(g.id)}
                            aria-label={`${g.course} ${option.title}, ${DAYS[d]} ${timeLabel(m.start)} to ${timeLabel(m.end)}${constraints.locks[g.id] ? ", locked" : ""}. Open section controls.`}
                          >
                            <span className="lab-block-time">
                              {timeLabel(m.start)}
                              {constraints.locks[g.id] && (
                                <Mark type="lock" size={10} />
                              )}
                            </span>
                            <strong>{g.course}</strong>
                            <span className="lab-block-section">
                              {option.title}
                              {option.status === "closed" ? " · full" : ""}
                            </span>
                          </button>,
                        ]
                      : [],
                  ),
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniWeek({
  problem,
  plan,
  color,
}: {
  problem: ScheduleProblem;
  plan: Plan;
  color: (course: string) => string;
}) {
  return (
    <span className="lab-mini-week" aria-hidden="true">
      {problem.groups.flatMap((g) =>
        g.options
          .find((o) => o.id === plan.picks[g.id])!
          .meetings.flatMap((m, mi) =>
            DAYS.flatMap((_, d) =>
              m.days & (1 << d)
                ? [
                    <i
                      key={`${g.id}-${mi}-${d}`}
                      style={{
                        left: `${(d / 7) * 100}%`,
                        width: "12%",
                        top: `${((m.start - 420) / 900) * 100}%`,
                        height: `${((m.end - m.start) / 900) * 100}%`,
                        background: color(g.course),
                      }}
                    />,
                  ]
                : [],
            ),
          ),
      )}
    </span>
  );
}
