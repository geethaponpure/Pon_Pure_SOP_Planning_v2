import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Package, Calculator, CircleCheck } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const fmtD = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

// window key -> soft colour, so W1..W4 read as buckets in the table
const WCOL = { W1: "#1a7d4f", W2: "#1768c4", W3: "#d68910", W4: "#8e44ad" };

export default function ItemReceiptSchedule() {
  const [planId, setPlanId] = useState("");
  const [region, setRegion] = useState("South");
  const [q, setQ] = useState("");
  const [view, setView] = useState("branch"); // "branch" | "warehouse"
  const { data, loading, error } = useAsync(
    () => api.itemReceiptSchedule(planId || null, region), [planId, region]);

  const ql = q.trim().toLowerCase();
  const items = ((data && data.items) || []).filter((r) => !ql || (r.item || "").toLowerCase().includes(ql));
  const pg = usePagination(items, [q, planId, region, view]);

  if (loading) return <Loading what="Item Receipt Schedule" />;
  if (error) return <ErrorBox msg={error} />;

  const s = data.summary || {};
  const plans = data.jc_plans || [];
  const windows = data.windows || [];
  const regions = data.regions || {};
  const regionStates = data.region_states || {};
  const wKey = view === "branch" ? "branch_window" : "warehouse_window";
  const dKey = view === "branch" ? "branch_date" : "warehouse_date";
  const byWindow = view === "branch" ? (s.branch_by_window || {}) : (s.warehouse_by_window || {});

  return (
    <>
      <PageInfo title="Item Receipt Schedule">
        For a chosen <b>JC plan</b>, each planned FG's <b>warehouse-available date</b> =
        manufacturing completion <b>+ {data.std_lead_days} days</b> standard lead time (and whether its <b>material is available</b>).
        For <b>branches</b>, the <b>receipt date</b> adds the region's <b>logistic lead time</b>
        {region ? <> (<b>{region} = {data.logistic_lead_days} day{data.logistic_lead_days === 1 ? "" : "s"}</b>)</> : null}.
        Each item is placed in one of the four JC windows <b>W1–W4</b>.
      </PageInfo>

      <div className="pagebar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
          JC Plan:
          <SelectBox className="searchbox" style={{ maxWidth: 340 }} value={planId || data.selected_plan_id || ""} onChange={(e) => setPlanId(e.target.value)}>
            {plans.length === 0 && <option value="">No plans saved</option>}
            {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>#{p.plan_id} · JC{p.jc_number} · {p.plan_type} · {p.plan_datetime}{(p.planned_fg_qty || 0) > 0 ? "" : " · (empty)"}</option>)}
          </SelectBox>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
          Branch region:
          <SelectBox className="searchbox" style={{ maxWidth: 260 }} value={region} onChange={(e) => setRegion(e.target.value)}>
            {Object.keys(regions).map((rg) => (
              <option key={rg} value={rg} title={(regionStates[rg] || []).join(", ")}>
                {rg} (+{regions[rg]}d)
              </option>
            ))}
          </SelectBox>
        </label>
        <SmoothInput className="searchbox" style={{ maxWidth: 220 }} placeholder="Search item…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {ql && <span style={{ fontSize: 12, color: "var(--muted)" }}>{items.length} item(s) match</span>}
        <div style={{ marginLeft: "auto", display: "inline-flex", background: "#eef2f7", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 2 }}>
          {[{ id: "branch", label: `Branch (${region})` }, { id: "warehouse", label: "Warehouse" }].map((t) => {
            const active = view === t.id;
            return (
              <button key={t.id} onClick={() => setView(t.id)}
                style={{ border: "none", cursor: "pointer", borderRadius: 7, whiteSpace: "nowrap", padding: "7px 15px",
                  fontSize: 13, fontWeight: active ? 700 : 500, background: active ? "#fff" : "transparent",
                  color: active ? "var(--navy)" : "var(--muted)", boxShadow: active ? "0 1px 3px rgba(15,23,42,.14)" : "none" }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {data.note && <div className="banner warn">{data.note}</div>}

      {/* window summary cards W1..W4 */}
      {windows.length > 0 && (
        <div className={`grid cols-${Math.min(4, windows.length)}`}>
          {windows.map((w) => (
            <div key={w.key} className="card statcard" style={{ borderTop: `3px solid ${WCOL[w.key] || "#1f3a5f"}` }}>
              <div className="ic"><Package size={22} /></div>
              <Stat value={fmt.num(byWindow[w.key] || 0)} label={`${w.key} · ${w.jc} (${fmtD(w.from)} → ${fmtD(w.to)})`} />
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 4 }}>
        <div className="card statcard blue"><div className="ic"><Calculator size={22} /></div><Stat value={fmt.num(s.total_items)} label="Planned items" /></div>
        <div className="card statcard"><div className="ic"><CircleCheck size={22} /></div><Stat value={fmt.num(s.rm_available_items)} label="Material available in warehouse" /></div>
      </div>

      {(data.items || []).length > 0 ? (
        <>
          <div className="section-title" style={{ marginTop: 16, marginBottom: 6 }}>
            Receipt schedule — {view === "branch" ? `${region} branch` : "warehouse"} ({items.length}{ql ? ` of ${(data.items || []).length}` : ""})
          </div>
          <div className="tbl-wrap" style={{ maxHeight: "56vh" }}>
            <table>
              <thead><tr>
                <th>Item</th>
                <th>Org</th>
                <th className="num">Qty (Kg)</th>
                <th>Material avail.</th>
                <th style={{ whiteSpace: "nowrap" }}>Mfg complete</th>
                <th style={{ whiteSpace: "nowrap" }}>+{data.std_lead_days}d → Warehouse</th>
                {view === "branch" && <th style={{ whiteSpace: "nowrap" }}>+{data.logistic_lead_days}d → {region}</th>}
                <th>Window</th>
              </tr></thead>
              <tbody>
                {pg.pageRows.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.item}</b></td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.organization}</td>
                    <td className="num">{fmt.num(r.qty, 2)}</td>
                    <td>{r.rm_available
                      ? <span className="chip" style={{ background: "#e7f6ee", color: "#1a7d4f", borderColor: "transparent" }}>✔ available</span>
                      : <span className="chip" style={{ background: "#fdecea", color: "#c0392b", borderColor: "transparent" }}>✖ awaiting RM</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtD(r.mfg_end)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtD(r.warehouse_date)}</td>
                    {view === "branch" && <td style={{ whiteSpace: "nowrap" }}>{fmtD(r.branch_date)}</td>}
                    <td>
                      <span className="chip" style={{ cursor: "default", background: WCOL[r[wKey]] || "#64748b", color: "#fff", borderColor: "transparent" }}>
                        {r[wKey]}
                      </span>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={view === "branch" ? 8 : 7} style={{ color: "var(--muted)" }}>No items match.</td></tr>}
              </tbody>
            </table>
            <Pagination {...pg} />
          </div>
        </>
      ) : !data.note && <div className="banner info">No planned items for this plan yet — save/generate a JC plan and its production schedule first.</div>}
    </>
  );
}
