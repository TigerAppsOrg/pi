import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /**
   * False for a boundary that already sits inside the page's <main>: a
   * document gets exactly one main landmark, and nesting a second one hides
   * the fallback from anyone navigating by landmark.
   */
  landmark?: boolean;
};
type State = { error: Error | null };

/**
 * The last stop before a white screen. React 19 unmounts the whole root when a
 * render throws — including a rejected `use()` promise from the chat history
 * fetch — so everything the app renders sits inside one of these.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("PI hit an unhandled render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const Frame = this.props.landmark === false ? "div" : "main";
    return (
      <Frame className="lost-thread">
        <div className="sheet">
          <h1>PI lost the thread</h1>
          <p>
            Something on this page stopped working partway through. Your saved
            chats are fine. A reload usually clears it.
          </p>
          <div className="row">
            <button
              className="btn btn-ink"
              onClick={() => location.reload()}
              type="button"
            >
              reload the page
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => this.setState({ error: null })}
              type="button"
            >
              try again
            </button>
          </div>
          <details>
            <summary>what broke</summary>
            <pre>{error.stack ?? String(error.message ?? error)}</pre>
          </details>
        </div>
      </Frame>
    );
  }
}
