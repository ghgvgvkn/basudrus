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

    // Stale-deploy chunk-load failures: when Vercel ships a new build,
    // any user with the old index.js cached will fail on the next
    // lazy import. safeLazy() in App.tsx already self-heals via a
    // location.reload(), but if the failure escaped that wrapper
    // (e.g. an eager import down the tree), reload here as a
    // last-ditch fix. SessionStorage flag prevents loops.
    const message = err.message || String(err);
    const isChunkLoadFailure =
      /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
        .test(message);
    if (isChunkLoadFailure && typeof window !== "undefined") {
      try {
        const RELOAD_KEY = "bu:chunk-reload-attempt";
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          return; // navigating; skip the report
        }
      } catch { /* sessionStorage unavailable */ }
    }

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
            We hit a snag — usually this means your browser cached an old
            version of the app. Reloading fixes it 99% of the time.
          </p>
          <button
            type="button"
            onClick={() => {
              // Clear the stale-deploy retry flag so the safeLazy
              // wrapper can try the auto-reload path again on next
              // chunk failure.
              try { sessionStorage.removeItem("bu:chunk-reload-attempt"); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="h-10 px-5 rounded-full bg-ink-1 text-surface-0 font-medium text-sm"
          >
            Reload the page
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
