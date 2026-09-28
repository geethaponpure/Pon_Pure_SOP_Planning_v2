import React from "react";

// Stops one broken page from blanking the whole app. Without this, any render-time
// throw unmounts the React tree and leaves a white screen with no clue what failed.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Page crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="banner warn" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <b>This page hit an error and could not be displayed.</b>
        <code style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}
        </code>
        <button className="btn secondary" onClick={() => this.setState({ err: null })}>Try again</button>
      </div>
    );
  }
}
