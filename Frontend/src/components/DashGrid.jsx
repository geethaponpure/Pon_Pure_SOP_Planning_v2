import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Draggable + resizable card grid for dashboard pages.
//
// Each child must carry a stable `key` — that key is the layout id, so a card
// keeps its place across reloads (and across cards being added or removed).
// The saved arrangement lives in localStorage per `storageKey`, per breakpoint.
//
// Dragging is by a thin band around the card's EDGES only (the four strips
// below). Making the whole header a handle meant the move cursor followed the
// pointer over every title and number and text could not be selected or
// copied — so the card interior is now left completely alone.

const COLS = { lg: 12, md: 8, sm: 4, xs: 2 };
const BREAKPOINTS = { lg: 1280, md: 960, sm: 680, xs: 0 };
const HANDLE = ".dash-drag";

const keyOf = (child) => String(child.key ?? "").replace(/^\.\$/, "");

// Cards are often grouped inside fragments (e.g. everything behind one `p &&`
// guard). Flatten those so each CARD — not the fragment — becomes a grid item.
function flatten(nodes) {
  const out = [];
  React.Children.forEach(nodes, (c) => {
    if (!c || typeof c !== "object") return;
    if (c.type === React.Fragment) out.push(...flatten(c.props.children));
    else out.push(c);
  });
  return out;
}

// Reconcile a saved layout with the cards actually on screen, then apply any
// expansion. Pure and exported so the behaviour can be tested without a DOM:
// an expanded card takes the FULL row (x:0, w:cols) and the height its content
// needs, while every other card keeps its saved place.
export function computeLayout(arr, ids, defaults, cols, expandedH = {}) {
  const known = new Map((arr || []).map((l) => [l.i, l]));
  const kept = ids.filter((id) => known.has(id)).map((id) => known.get(id));
  const missing = ids.filter((id) => !known.has(id));
  const nextY = kept.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  const all = [
    ...kept,
    ...buildLayout(missing, defaults, cols).map((l) => ({ ...l, y: l.y + nextY })),
  ];

  // Expanding a card must KEEP IT IN ITS ROW and move its row-mate down. Doing
  // this explicitly matters for a right-hand card: widening it to the full row
  // puts it at x:0 on top of its left neighbour, and the grid's own collision
  // resolution is just as likely to push the EXPANDED card below the one the
  // user just clicked — so it would appear to jump rows.
  let out = all;
  for (const [id, want] of Object.entries(expandedH)) {
    const me = out.find((l) => l.i === id);
    if (!me) continue;
    const grown = { ...me, x: 0, w: cols, h: want || Math.max(me.h, 13) };
    const bottom = grown.y + grown.h;
    // Everything not entirely above the expanded card moves as ONE BLOCK, so
    // the rows below keep their spacing. (Clamping each card to `bottom`
    // instead would stack separate rows on top of each other.)
    const displaced = out.filter((l) => l.i !== id && l.y + l.h > grown.y);
    const delta = displaced.length
      ? bottom - Math.min(...displaced.map((l) => l.y)) : 0;
    out = out.map((l) => {
      if (l.i === id) return grown;
      if (l.y + l.h <= grown.y) return l;          // entirely above — untouched
      return { ...l, y: l.y + delta };             // in the row or below — shifts down
    });
  }
  return out;
}

function buildLayout(ids, defaults, cols) {
  // place anything without a default underneath, full width
  let y = 0;
  return ids.map((id) => {
    const d = defaults[id] || {};
    const w = Math.min(d.w ?? cols, cols);
    const h = d.h ?? 8;
    const item = { i: id, x: d.x ?? 0, y: d.y ?? y, w, h, minW: 3, minH: 4 };
    y = Math.max(y, item.y + h);
    return item;
  });
}

export default function DashGrid({
  storageKey, defaults = {}, children,
  // Cards to blow up to the full row (e.g. a table view). Either a list of ids,
  // or {id: rowUnits} to also give the card a height that fits its content.
  expanded = [],
  // {newId: [oldId, ...]} — a card that replaced others takes over their slot
  // so a layout saved before the merge keeps its shape.
  renames = {},
  remoteLayouts = null,   // the app-level default, once it arrives
  userLayouts = null,     // this user's own saved arrangement, once it arrives
  canSaveDefault = false,
  onSaveDefault,          // (layouts) => save the app-level default  [admin]
  onSaveUser,             // (layouts) => save THIS user's own arrangement
}) {
  const items = useMemo(() => flatten(children).filter((c) => c.key != null), [children]);
  // `children` is a fresh array on every render, so key the id list by VALUE —
  // otherwise the memoised layout below would be rebuilt each render and the
  // grid could fight itself over positions.
  const idKey = items.map(keyOf).join("|");
  const ids = useMemo(() => idKey.split("|").filter(Boolean), [idKey]);

  // null = this user has not arranged the page, so fall back to the saved
  // default (or the built-in one) and keep following it.
  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && typeof saved === "object") return saved;
    } catch { /* first visit, or storage blocked */ }
    return null;
  });
  const [savedDefault, setSavedDefault] = useState("idle");
  // The prop only carries what was on the server at PAGE LOAD. Keep it in state
  // so that saving a new default takes effect for "Reset layout" right away
  // instead of falling through to the built-in arrangement.
  const [serverDefault, setServerDefault] = useState(remoteLayouts);
  useEffect(() => { if (remoteLayouts) setServerDefault(remoteLayouts); }, [remoteLayouts]);
  // this user's own arrangement, adopted once it arrives from the server (their
  // local copy, if any, already won — it is the same thing, only faster)
  const [mine, setMine] = useState(userLayouts);
  useEffect(() => { if (userLayouts) setMine(userLayouts); }, [userLayouts]);
  // memoised so the fallback keeps a stable identity — a fresh object every
  // render would rebuild the layout and make the grid fight itself.
  const fallback = useMemo(() => ({ lg: buildLayout(ids, defaults, COLS.lg) }), [ids, defaults]);
  const base = layouts || mine || serverDefault || fallback;

  const expKey = Array.isArray(expanded) ? expanded.join("|") : JSON.stringify(expanded);
  const expandedH = useMemo(() => (Array.isArray(expanded)
    ? Object.fromEntries(expanded.map((id) => [id, 0]))
    : (expanded || {})), [expKey]);              // eslint-disable-line react-hooks/exhaustive-deps
  const expandedSet = useMemo(() => new Set(Object.keys(expandedH)), [expandedH]);
  useEffect(() => { setSavedDefault("idle"); }, [expKey]);

  // keep the saved arrangement in step with the cards actually rendered:
  // drop layout entries for cards that disappeared, append newly added ones.
  const shown = useMemo(() => {
    const out = {};
    for (const [bp, arr] of Object.entries(base || {})) {
      const cols = COLS[bp] || COLS.lg;
      const known = new Map((arr || []).map((l) => [l.i, l]));
      for (const [now, before] of Object.entries(renames)) {
        if (known.has(now)) continue;
        const from = (Array.isArray(before) ? before : [before]).find((b) => known.has(b));
        if (from) known.set(now, { ...known.get(from), i: now });
      }
      out[bp] = computeLayout([...known.values()], ids, defaults, cols, expandedH);
    }
    return out;
  }, [base, ids, defaults, expandedH, renames]);

  const pending = React.useRef(null);
  const save = useCallback((_cur, all) => {
    // A temporarily expanded card (table view) must never bake its blown-up
    // geometry into the arrangement — but the user's OTHER moves still count,
    // so swap the expanded items back to their un-expanded geometry and save.
    // (Skipping the save entirely froze layouts on pages whose cards default
    // to table view, and permanently disabled "Save as default".)
    let next = all;
    if (expandedSet.size) {
      next = {};
      for (const [bp, arr] of Object.entries(all || {})) {
        const clean = new Map((((base || {})[bp]) || []).map((l) => [l.i, l]));
        next[bp] = (arr || []).map((l) =>
          (expandedSet.has(l.i) && clean.has(l.i) ? { ...clean.get(l.i) } : l));
      }
    }
    setLayouts(next);
    setMine(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
    // persist to this user's own server slot so their layout follows them to
    // another browser or machine; debounced so a drag is one write, not thirty
    if (onSaveUser) {
      clearTimeout(pending.current);
      pending.current = setTimeout(() => { onSaveUser(next).catch(() => {}); }, 1200);
    }
  }, [storageKey, expandedSet, onSaveUser, base]);
  useEffect(() => () => clearTimeout(pending.current), []);

  const saveDefault = useCallback(async () => {
    if (!onSaveDefault) return;
    setSavedDefault("saving");
    try {
      await onSaveDefault(base);
      setServerDefault(base);      // Reset now returns to what was just saved
      setSavedDefault("saved");
    } catch {
      setSavedDefault("failed");
    }
  }, [onSaveDefault, base]);

  const reset = useCallback(() => {
    // drop only this user's layer — the app-level default shows through again
    clearTimeout(pending.current);
    setLayouts(null);
    setMine(null);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    if (onSaveUser) onSaveUser({}).catch(() => {});
  }, [storageKey, onSaveUser]);

  // v2 measures its own container instead of the old WidthProvider HOC
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  return (
    <>
      <div className="dash-grid-bar">
        <span>
          Drag a card by its edges to move it · drag its bottom-right corner to resize ·
          your arrangement saves automatically
        </span>
        {canSaveDefault && (
          <button type="button" className="btn secondary" onClick={saveDefault}
            style={{ marginLeft: "auto" }}
            disabled={savedDefault === "saving"}
            title="Make this arrangement the default everyone starts from">
            {savedDefault === "saving" ? "Saving…"
              : savedDefault === "saved" ? "✓ Saved as default"
                : savedDefault === "failed" ? "Save failed — retry" : "Save as default"}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={reset}
          title="Discard your own arrangement and go back to the app default"
          style={canSaveDefault ? undefined : { marginLeft: "auto" }}>Reset to app default</button>
      </div>
      <div ref={containerRef}>
      {mounted && (
      <ResponsiveGridLayout
        className="dash-grid"
        width={width}
        layouts={shown}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={30}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        draggableHandle={HANDLE}
        onLayoutChange={save}
        useCSSTransforms
      >
        {items.map((child) => (
          <div key={keyOf(child)} className="dash-item">
            {/* the only draggable surface: a narrow band on each edge, sitting
                inside the card's padding so it never covers content or text */}
            <span className="dash-drag dash-drag-t" aria-hidden />
            <span className="dash-drag dash-drag-r" aria-hidden />
            <span className="dash-drag dash-drag-b" aria-hidden />
            <span className="dash-drag dash-drag-l" aria-hidden />
            {child}
          </div>
        ))}
      </ResponsiveGridLayout>
      )}
      </div>
    </>
  );
}
