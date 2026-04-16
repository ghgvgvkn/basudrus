import React from "react";
import { logError } from "@/services/analytics";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError("ErrorBoundary", error);
    if (info.componentStack) {
      logError("ErrorBoundary:stack", info.componentStack.slice(0, 500));
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F4F0", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😔</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1f36", marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 14, color: "#5A6370", marginBottom: 24 }}>An unexpected error occurred. Please reload the page.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#0F1B2D", color: "#F5F4F0", border: "none", padding: "13px 28px", borderRadius: 99, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
