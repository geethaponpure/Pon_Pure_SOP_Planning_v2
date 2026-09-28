import React, { useState } from "react";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Factory, FlaskConical, BarChart3, Hourglass, CalendarDays } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";
import ProductionGantt from "../components/ProductionGantt.jsx";

// priority -> colour + label (SOC scenario x RM availability) + start-date basis
const PRIO = {
  1: { c: "#1a7d4f", label: "P1 · Pending SOC + RM available", d: "start = JC start" },
  2: { c: "#2a9d8f", label: "P2 · Future SOC + RM available", d: "start = Future SOC schedule date" },
  3: { c: "#d68910", label: "P3 · Pending SOC + RM not available", d: "start = today + RM lead time" },
  4: { c: "#e67e22", label: "P4 · Future SOC + RM not available", d: "start = later of SOC date / (today + lead)" },
  5: { c: "#1768c4", label: "P5 · No SOC + RM available", d: "start = JC start" },
  6: { c: "#c0392b", label: "P6 · No SOC + RM not available", d: "start = today + RM lead time" },
};
const D = (s) => new Date(s + "T00:00:00");
const dayDiff = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const fmtD = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function ProductionSchedule() {
  const [planId, setPlanId] = useState("");
  const { data, loading, error } = useAsync(() => api.productionSchedule(planId || null), [planId]);
  const [view, setView] = useState("month");
  const [sort, setSort] = useState({ key: "priority", dir: "asc" });
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState("");
  const [equip, setEquip] = useState("");
  if (loading) return <Loading what="Production Schedule" />;
  if (error) return <ErrorBox msg={error} />;

  const s = data.summary || {};
  const plans = data.jc_plans || [];
  const ql = q.trim().toLowerCase();
  const matches = (data.jobs || []).filter((j) =>
    (!ql || (j.item || "").toLowerCase().includes(ql)) && (!equip || j.equipment === equip));
  const jobs = [...matches].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === "desc" ? -c : c;
  });

  return (
    <>
      <PageInfo title="Production Job Scheduling">
        For a chosen <b>JC plan</b>, each confirmed FG quantity is split into
        <b> Pending SOC</b> (schedule ≤ JC start), <b>Future SOC</b> (schedule &gt; JC start) and <b>No SOC</b> (projection balance),
        checked for <b>RM availability</b> (Supply-RM stock logic), sized into batches via <code>vessel_product_mapping</code>
        (batch size + cycle time) and placed on the equipment calendar by a <b>6-level priority</b> (start date driven by JC start /
        SOC schedule date / RM lead time).
      </PageInfo>

      <div className="pagebar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
          JC Plan:
          <SelectBox className="searchbox" style={{ maxWidth: 360 }} value={planId || data.selected_plan_id || ""} onChange={(e) => setPlanId(e.target.value)}>
            {plans.length === 0 && <option value="">No plans saved</option>}
            {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>#{p.plan_id} · JC{p.jc_number} · {p.plan_type} · {p.plan_datetime}{(p.planned_fg_qty || 0) > 0 ? "" : " · (empty)"}</option>)}
          </SelectBox>
        </label>
        <SmoothInput className="searchbox" style={{ maxWidth: 220 }} placeholder="Search item…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {ql && <span style={{ fontSize: 12, color: "var(--muted)" }}>{matches.length} job(s) match</span>}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {data.plan ? `JC start ${data.jc_start} · today ${data.today}` : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <SegTabs value={view} onChange={setView} tabs={[{ id: "month", label: "Month" }, { id: "week", label: "Week" }]} />
          <button className="btn" disabled={exporting || !(s.scheduled_jobs > 0)}
            onClick={async () => { setExporting(true); try { await api.productionScheduleExport(planId || data.selected_plan_id); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
            {exporting ? "Exporting…" : "⤓ Download (Excel)"}
          </button>
        </div>
      </div>

      {data.note && <div className="banner warn">{data.note}</div>}
      {!data.vessel_ready && <div className="banner warn">vessel_product_mapping table not found — load the vessel data first.</div>}

      {s.manufacturing_only && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <Factory size={15} style={{ verticalAlign: "-2px" }} /> <b>Manufacturing only.</b> Only Manufacturing-class FGs are scheduled here.
          Skipped this plan: <b>{fmt.num(s.skipped_non_manufacturing)}</b> repack/relabel & <b>{fmt.num(s.skipped_no_bom)}</b> no-BOM items.
          Jobs are load-balanced across a product's candidate vessels (finish-earliest) — see equipment utilisation below.
        </div>
      )}

      <div className="grid cols-4">
        <div className="card statcard"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.scheduled_jobs)} label="Manufacturing jobs" /></div>
        <div className="card statcard blue"><div className="ic"><FlaskConical size={22} /></div><Stat value={fmt.num(s.total_batches)} label="Total batches" /></div>
        <div className="card statcard" style={{ borderTop: `3px solid ${s.utilisation_pct >= 85 ? "#c0392b" : s.utilisation_pct >= 60 ? "#d68910" : "#1a7d4f"}` }}>
          <div className="ic"><BarChart3 size={22} /></div><Stat value={`${fmt.num(s.utilisation_pct)}%`} label={`Plant utilisation (${fmt.num(s.equipment_used)} equip · ${fmt.num(s.horizon_days)} d)`} /></div>
        <div className="card statcard amber"><div className="ic"><Hourglass size={22} /></div><Stat value={fmt.num(s.unscheduled_jobs)} label="Unscheduled (no vessel)" /></div>
      </div>

      {data.utilisation && data.utilisation.length > 0 && (
        <div className="card">
          <div className="sub" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span><b>Equipment utilisation</b> over the {fmt.num(s.horizon_days)}-day horizon — planned busy time ÷ available time. <b>Click an equipment</b> to view its jobs.</span>
            {equip && <span className="chip" style={{ background: "#eef3fb", borderColor: "#1f3a5f", color: "#1f3a5f", fontWeight: 700 }}>
              Showing {equip} — {matches.length} job(s) <span style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setEquip("")}>✕</span>
            </span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.utilisation.map((u) => {
              const col = u.util_pct >= 85 ? "#c0392b" : u.util_pct >= 60 ? "#d68910" : "#1a7d4f";
              const active = equip === u.equipment;
              return (
                <div key={u.equipment} title={`${u.jobs} jobs · ${u.fgs ?? "?"} unique FG · ${fmt.num(u.busy_hours)} h · ${u.busy_days} days — click to view`}
                  onClick={() => setEquip(active ? "" : u.equipment)}
                  style={{ minWidth: 128, flex: "0 0 auto", cursor: "pointer",
                    border: active ? "2px solid #1f3a5f" : "1px solid var(--line, #e3e3e8)",
                    background: active ? "#eef3fb" : "#fff", borderRadius: 6, padding: "5px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <b>{u.equipment}</b><span style={{ color: col, fontWeight: 700 }}>{fmt.num(u.util_pct)}%</span>
                  </div>
                  <div style={{ height: 6, background: "#eee", borderRadius: 3, marginTop: 4 }}>
                    <div style={{ width: `${Math.min(100, u.util_pct)}%`, height: 6, background: col, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{u.jobs} jobs · {u.fgs != null ? `${u.fgs} FG · ` : ""}{u.busy_days} d</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          <b style={{ color: "var(--ink, #1f3a5f)" }}>Priority legend</b> — each shows the <b>date reference</b> that drives the job's start.
          {" "}<b>Pending SOC</b> = order scheduled <b>on/before JC start</b> ({fmtD(data.jc_start)}); <b>Future SOC</b> = scheduled <b>after JC start</b>;
          {" "}<b>No SOC</b> = projection balance (no order). RM-not-available jobs wait <b>today ({fmtD(data.today)}) + RM lead time</b>.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(PRIO).map(([p, v]) => (
            <div key={p} style={{ minWidth: 200, flex: "0 0 auto", border: "1px solid var(--line, #e3e3e8)", borderLeft: `4px solid ${v.c}`, borderRadius: 6, padding: "6px 9px" }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{v.label} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({s.by_priority?.[p] ?? 0})</span></div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarDays size={14} /> {v.d}</div>
            </div>
          ))}
        </div>
      </div>

      {s.date_from ? (
        <>
          <div className="section-title" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 14 }}>
            <span>Production calendar ({fmtD(s.date_from)} → {fmtD(s.date_to)})</span>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
              <span style={{ borderLeft: "2px solid #1a7d4f", paddingLeft: 4 }}>JC start</span>{"   "}
              <span style={{ borderLeft: "2px solid #c0392b", paddingLeft: 4, marginLeft: 8 }}>Today</span>{"   "}
              <span style={{ marginLeft: 8 }}>dashed border = RM via lead time · hover a bar for details</span>
            </span>
          </div>
          <ProductionGantt jobs={matches} view={view} today={data.today} jcStart={data.jc_start} prio={PRIO} />

          <div className="section-title" style={{ marginTop: 16, marginBottom: 6 }}>Scheduled jobs ({jobs.length}{(ql || equip) ? ` of ${(data.jobs || []).length}${equip ? ` · ${equip}` : ""}` : ""})</div>
          <div className="tbl-wrap" style={{ maxHeight: "50vh" }}>
            <table>
              <thead><tr>
                {[["priority", "Prio"], ["item", "Item"], ["organization", "Org"], ["product_type", "Type"],
                  ["equipment", "Equip"], ["scenario", "Scenario"], ["qty", "Qty (Kg)"], ["batches", "Batches"],
                  ["batch_size", "Batch"], ["cycle_hrs", "Cycle h"], ["lead_days", "Lead d"], ["start", "Start"], ["end", "End"]].map(([k, l]) => (
                  <th key={k} className={["qty", "batches", "batch_size", "cycle_hrs", "lead_days", "priority"].includes(k) ? "num" : ""}
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    onClick={() => setSort((o) => (o.key === k ? { key: k, dir: o.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }))}>
                    {l}{sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={i}>
                    <td className="num"><span className="chip" style={{ cursor: "default", background: PRIO[j.priority].c, color: "#fff", borderColor: "transparent" }}>P{j.priority}</span></td>
                    <td><b>{j.item}</b></td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{j.organization}</td>
                    <td style={{ fontSize: 11 }}>{j.product_type}</td>
                    <td>{j.equipment}</td>
                    <td style={{ color: PRIO[j.priority].c, fontWeight: 600 }}>{j.scenario}{j.rm_available ? "" : " ·noRM"}</td>
                    <td className="num">{fmt.num(j.qty)}</td>
                    <td className="num">{j.batches}</td>
                    <td className="num">{fmt.num(j.batch_size)}</td>
                    <td className="num">{j.cycle_hrs}</td>
                    <td className="num">{j.rm_available ? "—" : j.lead_days}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtD(j.start)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtD(j.end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.unscheduled?.length > 0 && (
            <div className="sub" style={{ marginTop: 8 }}>
              <b>{data.unscheduled.length} demand segments not scheduled</b> — no vessel/batch mapping in <code>vessel_product_mapping</code>
              (e.g. {data.unscheduled.slice(0, 5).map((u) => u.item).join(", ")}…). Add those products to the vessel table to schedule them.
            </div>
          )}
        </>
      ) : !data.note && <div className="banner info">No schedulable jobs for this plan (no items matched vessel mapping).</div>}
    </>
  );
}
