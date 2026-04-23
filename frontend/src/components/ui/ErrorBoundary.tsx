import { Component, type ErrorInfo, type ReactNode } from "react";
import { T } from "../../theme/tokens";

interface ErrorBoundaryProps {
  label?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catch render-time crashes inside a subtree so one broken feature does
 * not take down the whole app. Wrap each top-level feature in its own
 * boundary.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep console visibility even when the UI is replaced by a fallback.
    console.error(
      "[ErrorBoundary]",
      this.props.label || "unlabeled",
      error,
      info,
    );
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            margin: "24px auto",
            maxWidth: 560,
            padding: 20,
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 10,
            color: T.textSoft,
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: T.red,
              marginBottom: 8,
              fontSize: 16,
            }}
          >
            {this.props.label || "Something went wrong in this section."}
          </div>
          <pre
            style={{
              margin: "8px 0 12px",
              padding: 10,
              background: T.bgCard,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              fontFamily: T.mono,
              fontSize: 12,
              color: T.textMute,
              whiteSpace: "pre-wrap",
              overflow: "auto",
              maxHeight: 140,
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: "8px 14px",
              fontSize: 14,
              color: T.bgCard,
              background: T.accent,
              border: "none",
              borderRadius: 6,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
