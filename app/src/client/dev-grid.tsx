import { createRoot } from "react-dom/client";
import { WeekGrid } from "./components/WeekGrid";
import { extractSchedule } from "./lib/tools";
import fixture from "./real-fixture.json";
import "./styles.css";

const view = extractSchedule(fixture)!;
createRoot(document.getElementById("root")!).render(
  <div className="paper-card"><WeekGrid schedule={view} /></div>
);
