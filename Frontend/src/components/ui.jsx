import React, { useEffect, useRef, useState, useCallback } from "react";
import { TriangleAlert } from "lucide-react";
import { fmt } from "../api";

// Abbreviate a KPI value when it is a plain number (or a ₹-prefixed number), so
// large totals don't overflow the card. Percentages, composite strings ("12 · 34",
// "12 FGs"), already-abbreviated values, and JSX are left untouched.
function compactStat(v) {
  if (typeof v === "number") return fmt.compact(v);
  if (typeof v === "string") {
    const m = v.match(/^(₹\s*)?(-?[\d,]+(?:\.\d+)?)$/);
    if (m) return (m[1] || "") + fmt.compact(Number(m[2].replace(/,/g, "")));
  }
  return v;
}

// Small data-fetching hook with refresh support.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: error.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, refresh: run };
}

// Fade the top/bottom edges of a scroll container — but only on the side that
// still has hidden content, so nothing is masked at rest. Returns a ref to put
// on the scrollable element; it drives the --fade-top / --fade-bottom vars the
// element's CSS mask reads. Pass deps that change its content/size.
export function useScrollFade(deps = []) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const FADE = 24; // px of fade at each active edge
    // The nav resizes on every frame of the sidebar collapse animation. Reading
    // scroll metrics + writing custom props inline would thrash layout (and repaint
    // the mask) each frame, so batch into one rAF and only write on a real change.
    let raf = 0, lastTop = null, lastBottom = null;
    const apply = () => {
      raf = 0;
      const top = el.scrollTop > 2 ? FADE : 0;
      const bottom =
        el.scrollHeight - el.clientHeight - el.scrollTop > 2 ? FADE : 0;
      if (top !== lastTop) { el.style.setProperty("--fade-top", `${top}px`); lastTop = top; }
      if (bottom !== lastBottom) { el.style.setProperty("--fade-bottom", `${bottom}px`); lastBottom = bottom; }
    };
    const update = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// Modern centered animated spinner
export function Spinner({ size = 56 }) {
  return (
    <div className="spinner-wrap" style={{ width: size, height: size }}>
      <svg className="spinner-svg" viewBox="0 0 50 50" aria-hidden="true">
        <circle
          className="spinner-track"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4"
        />
        <circle
          className="spinner-circle"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="spinner-pulse" />
    </div>
  );
}

export function Loading({ what = "data" }) {
  // Clean up any verbose strings, stripping dashes, parentheses or time notes
  let cleanName = String(what || "data")
    .split(/—|-|\(/)[0]
    .trim();
  if (!cleanName) cleanName = "data";

  return (
    <div className="loading-container" role="status" aria-live="polite">
      <div className="loading-card">
        <Spinner size={54} />
        <div className="loading-content">
          <h3 className="loading-title">Loading {cleanName}…</h3>
          <div className="loading-bar">
            <div className="loading-bar-fill" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ msg }) {
  return <div className="banner err" style={{ display: "flex", alignItems: "center", gap: 7 }}><TriangleAlert size={16} style={{ flex: "none" }} /> {msg}</div>;
}

export function Tag({ kind, children }) {
  const cls = String(kind || "").toLowerCase().replace(/[^a-z-]/g, "");
  return <span className={`tag ${cls}`}>{children}</span>;
}

export function StatusDot({ status }) {
  const map = { on_target: "dot-on", watch: "dot-watch", off_target: "dot-off", info: "dot-info" };
  return <span className={`status-dot ${map[status] || "dot-info"}`} />;
}

// Card UI kit stat widget: uppercase label, large display value, optional footer.
export function KitStat({ label, value, foot }) {
  return (
    <div className="kit-stat">
      {label && <div className="kit-label">{label}</div>}
      <div className="kit-value">{value}</div>
      {foot && <div className="kit-foot">{foot}</div>}
    </div>
  );
}

export function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="v">{compactStat(value)}</div>
      <div className="l">{label}</div>
    </div>
  );
}
