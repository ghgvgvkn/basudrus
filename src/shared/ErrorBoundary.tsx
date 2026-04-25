import { Component, type ReactNode, type ErrorInfo } from "react";
import { reportError } from "./errorReporter";

/**
 * Root error boundary. Logs to console + ships the error to the
 * Supabase `client_errors` table via the in-app reporter, so we
 * can audit real user crashes without a third-party SaaS.
 */
interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
    void reportError({
      type: "ErrorBoundary",
      message: err.message,
      stack: err.stack,
      context: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="min-h-dvh grid place-items-center p-8 bg-surface-0">
        <div className="bu-card max-w-md w-full p-8 text-center">
          <div className="serif text-3xl text-ink-1 mb-2">Something broke.</div>
          <p className="text-ink-3 text-sm mb-6">
            The page hit an error and couldn't recover. Reload to try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 px-5 rounded-full bg-ink-1 text-surface-0 font-medium text-sm"
          >
            Reload
          </button>
          <details className="mt-6 text-start">
            <summary className="text-xs text-ink-4 cursor-pointer">Error details</summary>
            <pre className="mt-2 text-[11px] text-ink-3 whitespace-pre-wrap break-words">
              {this.state.err.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
