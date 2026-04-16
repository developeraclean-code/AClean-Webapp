import { Component } from "react";
import { cs } from "../theme/cs.js";

export default class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ViewErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: 300, gap: 16, padding: 32,
          color: cs.text
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Terjadi kesalahan di halaman ini</div>
          <div style={{
            fontSize: 12, color: cs.muted, background: cs.surface,
            border: "1px solid " + cs.border, borderRadius: 8,
            padding: "8px 14px", maxWidth: 480, wordBreak: "break-word", textAlign: "center"
          }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: cs.accent + "22", border: "1px solid " + cs.accent + "55",
              color: cs.accent, padding: "8px 20px", borderRadius: 8,
              cursor: "pointer", fontWeight: 600, fontSize: 13
            }}>
            🔄 Coba Lagi
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
