// styles.css is imported first on purpose: everything below it in the module
// graph (each page's own stylesheet) is emitted after it, so lane-specific
// rules win ties against the design system instead of losing them.
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
