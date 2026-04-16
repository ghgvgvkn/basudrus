import React from "react";
import { logError } from "@/services/analytics";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorCount: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(_error: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError("ErrorBoundary", error);
    if (info.componentStack) {
      logError("ErrorBoundary:stack", info.componentStack.slice(0, 500));
    }
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      errorCount: prev.errorCount + 1,
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
    return this.props.children;
  }
}
