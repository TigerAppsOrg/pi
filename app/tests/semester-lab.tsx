import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SemesterLab } from "../src/client/components/SemesterLab";
import { impossible, semester } from "./fixtures/semester";
import "../src/client/styles.css";
import "./semester-lab-demo.css";

function Demo() {
  const [scenario, setScenario] = useState<"semester" | "impossible">(
    "semester",
  );
  const [version, setVersion] = useState(0);
  return (
    <div className="lab-demo-shell">
      <div className="lab-demo-bar">
        <a
          href="https://github.com/TigerAppsOrg/pi"
          target="_blank"
          rel="noreferrer"
          aria-label="PI on GitHub"
        >
          <span className="lab-demo-pi">π</span>
          <strong>PI</strong>
          <span>TigerApps</span>
        </a>
        <div>
          <span className="lab-demo-label">
            WORKING PROTOTYPE · SAMPLE DATA
          </span>
          <button
            type="button"
            onClick={() => {
              setScenario(scenario === "semester" ? "impossible" : "semester");
              setVersion((v) => v + 1);
            }}
          >
            {scenario === "semester"
              ? "Try an impossible week"
              : "Back to the semester"}
          </button>
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Reset
          </button>
        </div>
      </div>
      <SemesterLab
        key={`${scenario}-${version}`}
        problem={scenario === "semester" ? semester : impossible}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
