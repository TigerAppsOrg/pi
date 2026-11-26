export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type TimeSlot = { days: number; start: number; end: number };
export type Section = {
  id: string;
  title: string;
  meetings: TimeSlot[];
  selected: boolean;
  status: "open" | "closed" | "canceled";
  room?: string;
};
export type SectionGroup = {
  id: string;
  course: string;
  courseTitle?: string;
  category: string;
  options: Section[];
};
export type ScheduleProblem = {
  title: string;
  term: string;
  source: "sample" | "junction";
  groups: SectionGroup[];
};
export type Constraints = {
  earliest: number;
  latest: number;
  offDays: number;
  locks: Record<string, string>;
  busy: Array<TimeSlot & { id: string; label: string }>;
  objective: "compact" | "changes" | "late";
  allowClosed: boolean;
};
export const DEFAULT_CONSTRAINTS: Constraints = {
  earliest: 8 * 60,
  latest: 20 * 60,
  offDays: 0,
  locks: {},
  busy: [],
  objective: "compact",
  allowClosed: false,
};
export type Plan = {
  score: number;
  gaps: number;
  days: number;
  earliest: number;
  changes: number;
  latest: number;
  picks: Record<string, string>;
};
export type SolveResult = {
  status: "optimal" | "infeasible" | "limited";
  plans: Plan[];
  nodes: number;
  solveMs: number;
};
export type Relaxation = { label: string; constraints: Constraints };
export type Diagnosis = {
  groups: string[];
  minimal: boolean;
  relaxations: Relaxation[];
};
export function timeLabel(minutes: number) {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return `${h % 12 || 12}${m ? `.${String(m).padStart(2, "0")}` : ""}${h >= 12 && h < 24 ? "pm" : "am"}`;
}
export function dayLabel(mask: number) {
  return DAYS.filter((_, i) => mask & (1 << i)).join(" / ");
}
export function overlaps(a: TimeSlot, b: TimeSlot) {
  return !!(a.days & b.days) && a.start < b.end && b.start < a.end;
}
