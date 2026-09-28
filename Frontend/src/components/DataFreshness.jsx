import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

// "2026-08-31 14:48:03" -> "3 min ago"
function relTime(s) {
  if (!s) return "never";
  const t = new Date(String(s).replace(" ", "T"));
  if (isNaN(t.getTime())) return String(s);
  const secs = Math.floor((Date.now() - t.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return t.toLocaleString();
}

// "Data as of…" pill + Refresh-now button. Polls /api/sync-status; the worker
// (worker.py) does the actual CRM sync — this only reports freshness + queues a
// refresh request.
export default function DataFreshness() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSt(await api.syncStatus()); } catch (_) { /* leave prior state */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  // hide when there is no staging data at all (e.g. synthetic mode / DB down)
  if (!st || (!st.last_synced && !st.context)) return null;

  const syncing = busy || st.syncing;
  const color = st.any_error ? "#d9534f" : syncing ? "#f0ad4e" : "#5cb85c";
  const label = `Data as of ${relTime(st.last_synced)}`;
  const ctx = st.context || {};
  const title = [
    ctx.plan_jc ? `Planning JC${ctx.plan_jc} · ${ctx.acc_year}` : null,
    st.any_error ? "⚠ last sync had errors" : null,
    "",
    ...st.sources.map((s) => `${s.source}: ${s.status || "—"}${s.row_count != null ? ` (${s.row_count})` : ""}`),
  ].filter((x) => x !== null).join("\n");

  async function refresh() {
    setBusy(true);
    try {
      await api.refreshData();
      for (let i = 0; i < 30; i++) {                 // wait for the worker (~30s drain)
        await new Promise((r) => setTimeout(r, 3000));
        const s = await api.syncStatus();
        setSt(s);
        if (!s.syncing && !s.pending_requests) break;
      }
    } catch (_) { /* ignore */ }
    setBusy(false);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="pill" title={title}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
        {label}
      </span>
      <button
        type="button"
        className={`refresh-btn ${syncing ? "is-syncing" : ""}`}
        onClick={refresh}
        disabled={syncing}
        title="Refresh CRM data now"
      >
        <svg className="refresh-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <span className="refresh-label">{syncing ? "Refreshing…" : "Refresh"}</span>
      </button>
    </span>
  );
}
