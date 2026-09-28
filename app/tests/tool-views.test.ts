import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCourses, extractSchedule } from "../src/client/lib/tools.ts";

const section = { id: 1, courseCode: "COS 126", sectionTitle: "L01", days: ["M", "W"], startTime: "8:30 AM", endTime: "9:20 AM" };
test("available sections are not treated as selected, even if only one exists", () => {
  const schedule = extractSchedule({ schedule: { title: "Fall" }, sections: [section] })!;
  assert.equal(schedule.selectionKnown, false);
  assert.equal(schedule.meetings.filter((m) => m.confirmed).length, 0);
  assert.deepEqual(schedule.courses[0].pending, ["L"]);
  assert.equal(schedule.meetings[0].startMin, 510);
});
test("selected section IDs and explicit selections render without other options", () => {
  const schedule = extractSchedule({ selectedSectionIds: [1], sections: [section, { ...section, id: 2, sectionTitle: "L02", startTime: "10:00 AM", endTime: "10:50 AM" }] })!;
  assert.equal(schedule.selectionKnown, true);
  assert.equal(schedule.meetings.filter((m) => m.confirmed).length, 1);
  assert.deepEqual(schedule.courses[0].pending, []);
});
test("only selected overlaps count as schedule conflicts", () => {
  const schedule = extractSchedule({ sections: [{ ...section, selected: true }, { ...section, courseCode: "MAT 104", selected: false }, { ...section, courseCode: "PHY 103", selected: true }] })!;
  assert.equal(schedule.conflicts.length, 1);
  assert.ok(!schedule.conflicts[0].includes("MAT 104"));
});
test("empty schedules remain valid views", () => {
  const schedule = extractSchedule({ schedule: { title: "Fall" }, courses: [], sections: [] })!;
  assert.equal(schedule.title, "Fall");
  assert.equal(schedule.meetings.length, 0);
});
test("course cards preserve real metadata and don't invent a rating", () => {
  const courses = extractCourses({ courses: [{ id: "002051-1272", code: "COS 126", title: "Computer Science", dists: ["QCR"], gradingBasis: "PDF", latestRating: 4.4 }, { code: "MAT 104", title: "Calculus" }] })!;
  assert.deepEqual(courses[0].distributions, ["QCR"]);
  assert.equal(courses[0].gradingBasis, "PDF");
  assert.equal(courses[0].rating, 4.4);
  assert.match(courses[0].pcUrl!, /1272002051$/);
  assert.equal(courses[1].rating, null);
  assert.equal(courses[1].gradingBasis, undefined);
});
