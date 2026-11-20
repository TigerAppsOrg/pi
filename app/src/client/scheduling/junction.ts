import type { ScheduleProblem, SectionGroup, TimeSlot } from "./model";

const clock = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const h = Number(match[1]),
    m = Number(match[2]);
  if (h < 1 || h > 12 || m > 59) return null;
  return ((h % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + m;
};
const aliases: Record<string, number> = {
  m: 1,
  mon: 1,
  monday: 1,
  t: 2,
  tue: 2,
  tuesday: 2,
  w: 4,
  wed: 4,
  wednesday: 4,
  th: 8,
  thu: 8,
  thursday: 8,
  f: 16,
  fri: 16,
  friday: 16,
  s: 32,
  sat: 32,
  saturday: 32,
  su: 64,
  sun: 64,
  sunday: 64,
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Junction did not return a complete schedule.");
  return value as Record<string, unknown>;
};
const codeKey = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** Decode the raw tool payload. Never use the calendar's merged display rows. */
export function fromJunction(value: unknown): ScheduleProblem {
  const data = record(value),
    schedule = record(data.schedule);
  if (
    !Array.isArray(data.sections) ||
    !data.sections.length ||
    !Array.isArray(data.courses) ||
    !data.courses.length
  )
    throw new Error(
      "Add courses with section times in Junction to open the planning lab.",
    );
  const courses = new Map(
    data.courses.map((c) => {
      const row = record(c);
      if (typeof row.code !== "string" || !row.code.trim())
        throw new Error("A course identifier is missing.");
      return [
        codeKey(row.code),
        {
          code: row.code,
          title: typeof row.title === "string" ? row.title : undefined,
        },
      ];
    }),
  );
  const groups = new Map<string, SectionGroup>();
  for (const raw of data.sections) {
    const row = record(raw);
    if (
      typeof row.courseCode !== "string" ||
      typeof row.sectionTitle !== "string"
    )
      throw new Error("Junction did not provide section identifiers.");
    const course = courses.get(codeKey(row.courseCode));
    if (!course)
      throw new Error("Junction returned a section without its course.");
    const category =
      typeof row.category === "string" && /^[A-Z]+$/i.test(row.category)
        ? row.category.toUpperCase()
        : row.sectionTitle.match(/^([A-Za-z]+)\d/)?.[1].toUpperCase();
    if (!category)
      throw new Error(
        `${course.code} ${row.sectionTitle} has an unknown section type.`,
      );
    const rawDays = Array.isArray(row.days)
      ? row.days
      : typeof row.days === "string"
        ? row.days.split(/[,\s]+/).filter(Boolean)
        : [];
    let days = 0;
    for (const day of rawDays) {
      const bit =
        typeof day === "string" ? aliases[day.toLowerCase()] : undefined;
      if (!bit)
        throw new Error(
          `${course.code} ${row.sectionTitle} has an unknown meeting day.`,
        );
      days |= bit;
    }
    const start = clock(row.startTime),
      end = clock(row.endTime);
    if (!days || start == null || end == null || start >= end)
      throw new Error(
        `${course.code} ${row.sectionTitle} needs complete meeting times before PI can check it.`,
      );
    if (!["open", "closed", "canceled"].includes(String(row.status)))
      throw new Error(
        `${course.code} ${row.sectionTitle} is missing availability information.`,
      );
    const id = `${codeKey(course.code)}|${category}`,
      optionId = `${id}|${row.sectionTitle}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        course: course.code,
        courseTitle: course.title,
        category,
        options: [],
      };
      groups.set(id, group);
    }
    const slot: TimeSlot = { days, start, end };
    const existing = group.options.find((o) => o.id === optionId);
    if (existing) {
      if (
        existing.status !== row.status ||
        existing.selected !== (row.selected === true)
      )
        throw new Error(
          `${course.code} ${row.sectionTitle} has inconsistent meeting records.`,
        );
      if (
        !existing.meetings.some(
          (m) => m.days === days && m.start === start && m.end === end,
        )
      )
        existing.meetings.push(slot);
    } else
      group.options.push({
        id: optionId,
        title: row.sectionTitle,
        meetings: [slot],
        selected: row.selected === true,
        status: row.status as "open" | "closed" | "canceled",
        room: typeof row.room === "string" ? row.room : undefined,
      });
  }
  for (const course of courses.values())
    if (
      ![...groups.values()].some(
        (g) => codeKey(g.course) === codeKey(course.code),
      )
    )
      throw new Error(
        `${course.code} has no section data. PI cannot check the complete schedule yet.`,
      );
  return {
    title: typeof schedule.title === "string" ? schedule.title : "My schedule",
    term:
      typeof schedule.termName === "string"
        ? schedule.termName
        : String(schedule.term ?? ""),
    source: "junction",
    groups: [...groups.values()],
  };
}
