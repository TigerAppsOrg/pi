import React from "react";
import { createRoot } from "react-dom/client";
import { ToolRender } from "../src/client/components/ToolCards";
import { WorkspaceProvider } from "../src/client/lib/workspaces";
import type { ToolView } from "../src/client/lib/tools";
import "../src/client/styles.css";
import "../src/client/styles/workspaces.css";

const views: ToolView[] = [
  { toolName: "tool_junction_get_schedule_details", base: "get_schedule_details", app: "junction", state: "output-available", input: {}, errorText: null, data: { schedule: { title: "Fall semester", termName: "Fall 2026" }, sections: [
    { courseCode: "PHY 103", sectionTitle: "C04", days: ["M", "W", "F"], startTime: "8:30 AM", endTime: "9:20 AM", selected: true },
    { courseCode: "MAT 104", sectionTitle: "C04", days: ["M", "W"], startTime: "2:55 PM", endTime: "4:15 PM", selected: true },
    { courseCode: "COS 126", sectionTitle: "L01", days: ["M", "W"], startTime: "1:20 PM", endTime: "2:40 PM", selected: true },
    { courseCode: "COS 126", sectionTitle: "P01", days: ["T"], startTime: "10:00 AM", endTime: "10:50 AM", selected: false },
    { courseCode: "COS 126", sectionTitle: "P02", days: ["Th"], startTime: "11:00 AM", endTime: "11:50 AM", selected: false },
  ] } },
  { toolName: "tool_princetoncourses_search_courses", base: "search_courses", app: "princetoncourses", state: "output-available", input: {}, errorText: null, data: { courses: [
    { id: "002051-1272", code: "COS 126", title: "Computer Science: An Interdisciplinary Approach", dists: ["QCR"], gradingBasis: "PDF", rating: 4.32 },
    { id: "002100-1272", code: "COS 226", title: "Algorithms and Data Structures", dists: ["QCR"], rating: 4.48 },
    { id: "004200-1272", code: "MAT 104", title: "Calculus", dists: ["QCR"], gradingBasis: "PDF" },
    { id: "006300-1272", code: "PHY 103", title: "General Physics I", dists: ["SEL"], rating: 4.12 },
  ] } },
  { toolName: "tool_junction_get_schedule_details", base: "get_schedule_details", app: "junction", state: "output-available", input: {}, errorText: null, data: { schedule: { title: "Unpicked sections" }, sections: [
    { courseCode: "COS 126", sectionTitle: "L01", days: ["M", "W"], startTime: "1:20 PM", endTime: "2:40 PM", selected: false },
    { courseCode: "COS 126", sectionTitle: "L02", days: ["T", "Th"], startTime: "1:20 PM", endTime: "2:40 PM", selected: false },
  ] } },
];
createRoot(document.getElementById("root")!).render(<WorkspaceProvider netid="pipreview"><main style={{ maxWidth: 940, margin: "0 auto", padding: "24px 16px" }}>{views.map((view, i) => <section key={i} style={{ marginBottom: 28 }}><ToolRender view={view} /></section>)}</main></WorkspaceProvider>);
