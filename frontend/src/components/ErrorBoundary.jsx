import { Component } from "react";

// App-wide safety net. React error boundaries must be class components.
// Without this, any uncaught render error blanks the whole page (white screen);
// with it, the user sees a recoverable message and the error is logged.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center px-5 bg-[var(--paper)]">
        <div className="nb-card p-8 max-w-md text-center">
          <h1 className="text-2xl font-black tracking-tight mb-2" style={{ fontFamily: "Outfit" }}>
            Something went wrong
          </h1>
          <p className="text-sm text-[var(--muted)] mb-6">
            The page hit an unexpected error. Reloading usually fixes it. If it
            keeps happening, please let us know.
          </p>
          <button
            className="nb-btn w-full justify-center"
            onClick={() => { window.location.href = "/"; }}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
