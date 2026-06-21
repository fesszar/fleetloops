// Build entry — bundled into app.js (self-contained, no CDNs).
import React from "react";
import { createRoot } from "react-dom/client";
import FleetView from "../../FleetView.jsx";

class ErrBoundary extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  render() {
    if (this.state.e) {
      return React.createElement("pre", { style: { color: "#fca5a5", padding: "2rem", whiteSpace: "pre-wrap", font: "12px ui-monospace,monospace" } },
        "Render error:\n\n" + (this.state.e.stack || this.state.e.message || String(this.state.e)));
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  React.createElement(ErrBoundary, null, React.createElement(FleetView))
);
