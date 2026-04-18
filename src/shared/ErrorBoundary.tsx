import React from "react";
import { logError } from "@/services/analytics";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorCount: number;
  autoRecoverKey: number; // bump to force re-mount after silent auto-recovery
}

// Errors that almost always come from browser extensions (Google Translate,
// Dark Reader, ad blockers) fighting React's virtual DOM. The app itself is
// fine — we silently re-mount instead of showing a scary "Something went wrong"
// screen to the user.
const AUTO_RECOVER_PATTERNS = [
  /Failed to execute 'removeChild'/i,
  /Failed to execute 'insertBefore'/i,
  /The node to be removed is not a child of this node/i,
  /The node before which the new node is to be inserted is not a child of this node/i,
  /NotFoundError.*The object can not be found here/i,
];

function isAutoRecoverable(msg: string): boolean {
  return AUTO_RECOVER_PATTERNS.some(re => re.test(msg));
}

export class ErrorBoundary extends React.Component<Props, State> {
  private autoRecoverCount = 0;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0, autoRecoverKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // For benign browser-extension DOM conflicts, stay "not errored" — we'll
    // bump the remount key in componentDidCatch and React will retry the tree.
    if (isAutoRecoverable(error.message)) {
      return {};
    }
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isAutoRecoverable(error.message)) {
      // Log it but don't surface to the user — cap at 3 silent recoveries so we
      // don't get stuck in a loop if the root cause is real.
      this.autoRecoverCount++;
      logError("ErrorBoundary:auto_recover", {
        message: error.message,
        recovery_count: this.autoRecoverCount,
      });
      if (this.autoRecoverCount <= 3) {
        this.setState(prev => ({ autoRecoverKey: prev.autoRecoverKey + 1 }));
        return;
      }
      // Too many auto-recoveries — bail out to the normal error screen
      this.setState({ hasError: true });
    }
    logError("ErrorBoundary", error);
    if (info.componentStack) {
      logError("ErrorBoundary:stack", info.componentStack.slice(0, 500));
    }
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      errorCount: prev.errorCount + 1,
      autoRecoverKey: prev.autoRecoverKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F4F0", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😔</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1f36", marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 14, color: "#5A6370", marginBottom: 24 }}>An unexpected error occurred. Try again or reload the page.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              {this.state.errorCount < 2 && (
                <button
                  onClick={this.handleRetry}
                  style={{ background: "#0F1B2D", color: "#F5F4F0", border: "none", padding: "13px 28px", borderRadius: 99, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
                >
                  Try Again
                </button>
              )}
              <button
                onClick={() => window.location.reload()}
                style={{ background: this.state.errorCount >= 2 ? "#0F1B2D" : "transparent", color: this.state.errorCount >= 2 ? "#F5F4F0" : "#0F1B2D", border: this.state.errorCount >= 2 ? "none" : "1.5px solid #0F1B2D", padding: "13px 28px", borderRadius: 99, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    // The `key` prop forces React to unmount and remount the subtree, which
    // reconciles any mid-render DOM conflicts introduced by browser extensions.
    return <React.Fragment key={this.state.autoRecoverKey}>{this.props.children}</React.Fragment>;
  }
}
