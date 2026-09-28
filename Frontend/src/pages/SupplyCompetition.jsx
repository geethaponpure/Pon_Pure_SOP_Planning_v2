import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import EChart from "../components/EChart.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { Boxes, Download, Factory, Layers, PartyPopper, ShieldCheck,
  TriangleAlert, Users } from "lucide-react";

// Supply Competition — Phase 2. Phase 1 asked whether a projection is backed by
// a firm order; this asks whether the STOCK will still be there if it isn't.
// Colleagues raising confirmed orders against the same item consume the same
// supply, so every item carries both a company-wide supply position and the
// slice of firm demand held by people outside the caller's own book.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  // keep the tooltip inside the chart box and let long hint text wrap instead of
  // stretching into one very wide line that escapes the card
  confine: true,
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;"
    + "max-width:300px;white-space:normal;line-height:1.45;",
};
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const abbr = (v) => {
  const n = Math.abs(v || 0);
  if (n >= 1e7) return ((v || 0) / 1e7).toFixed(n >= 1e8 ? 0 : 1) + "Cr";
  if (n >= 1e5) return ((v || 0) / 1e5).toFixed(n >= 1e6 ? 0 : 1) + "L";
  if (n >= 1e3) return ((v || 0) / 1e3).toFixed(0) + "K";
  return fmt.num(v || 0);
};
const CELL = { border: "1px solid var(--border)", padding: "7px 8px", verticalAlign: "middle" };
const HCELL = { ...CELL, background: "#f7fafc", fontSize: 12, color: "#414d55",
  fontWeight: 600, whiteSpace: "nowrap" };

// The supply-risk ladder, worst first. "Covered" is not a risk — it is the
// projection that already converted, kept in the donut so the slices add up.
const RISK = {
  critical: { label: "Critical", color: "#7b1d1d",
    hint: "Projected, no stock anywhere and nothing on the production plan" },
  high: { label: "High risk", color: "#c53030",
    hint: "Stock exists but firm orders have already claimed it, and no production is planned" },
  at_risk: { label: "At risk", color: "#b7791f",
    hint: "Short today, but the production plan makes more this cycle" },
  safe: { label: "Safe", color: "#2f855a",
    hint: "Supply is available after everyone else's firm orders and the safety level" },
  covered: { label: "Already firm", color: "#90a1ac",
    hint: "The projection is already backed by your own orders — nothing at risk" },
};
const RISK_ORDER = ["critical", "high", "at_risk", "safe", "covered"];

const SUPPLY_METRICS = [
  { id: "risk", label: "Risk", icon: ShieldCheck, title: "Supply risk on my projection" },
  { id: "balance", label: "Supply vs demand", icon: Layers, title: "Supply against claims" },
];
const HOLDER_METRICS = [
  { id: "collectors", label: "By collector", icon: Users, title: "Competing demand by collector" },
  { id: "mc", label: "By market circle", icon: Boxes, title: "Competing demand by market circle" },
  { id: "exposed", label: "Exposed items", icon: TriangleAlert, title: "Items where supply is at risk" },
];

function riskDonut(buckets) {
  const rows = (buckets || []).filter((b) => b.items > 0);
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (o) => {
        const b = rows[o.dataIndex] || {};
        return `${o.marker} ${o.name}<br/><b style="font-size:13px">${fmt.num(o.value)}</b> items · ${o.percent}%`
          + `<br/><span style="color:#90a1ac">${(RISK[b.key] || {}).hint || ""}</span>`;
      } },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    series: [{
      type: "pie", radius: ["54%", "77%"], center: ["50%", "43%"], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data: rows.map((b) => ({ value: b.items, name: (RISK[b.key] || {}).label || b.key,
        itemStyle: { color: (RISK[b.key] || {}).color } })),
    }],
  };
}

// `top` is the already-prepared, reversed row slice — the caller keeps the same
// array so a click can map dataIndex straight back to the row.
function exposureOption(top) {
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r.item || "—"}</b><br/>`
          + `my unprotected <b>${fmt.num(r.my_unprotected)}</b> KG<br/>`
          + `left for me after other orders <b>${fmt.num(r.atp_for_me)}</b> KG<br/>`
          + `<span style="color:#c53030">exposed <b>${fmt.num(r.exposure)}</b> KG</span>`
          + `<br/><span style="color:#90a1ac">click for the full supply picture</span>`;
      } },
    grid: { left: 8, right: 52, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => r.item),
      axisLabel: { color: "#414d55", fontSize: 11, width: 160, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18,
      itemStyle: { color: (o) => (RISK[top[o.dataIndex].risk] || {}).color || "#c53030",
        borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => abbr(o.value) },
      data: top.map((r) => Math.round(r.exposure)),
    }],
  };
}

// On-hand against the claims on it, for the items the caller is most exposed on.
function balanceOption(top) {
  const series = [
    { name: "On hand", key: "on_hand", color: "#2f855a" },
    { name: "Safety level", key: "msl", color: "#90a1ac" },
    { name: "Firm orders — others", key: "firm_others", color: "#c53030" },
    { name: "My unprotected projection", key: "my_unprotected", color: "#b7791f" },
    { name: "Incoming production", key: "incoming", color: "#3182ce" },
  ];
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r.item || "—"}</b><br/>`
          + ps.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt.num(x.value)}</b> KG`).join("<br/>")
          + `<br/><span style="color:#90a1ac">left for me ${fmt.num(r.atp_for_me)} KG`
          + ` · exposed ${fmt.num(r.exposure)} KG</span>`
          + `<br/><span style="color:#90a1ac">click for the full supply picture</span>`;
      } },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    grid: { left: 8, right: 16, top: 8, bottom: 34, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => r.item),
      axisLabel: { color: "#414d55", fontSize: 11, width: 150, overflow: "truncate" },
      axisTick: { show: false } },
    series: series.map((s) => ({
      name: s.name, type: "bar", barMaxWidth: 9, itemStyle: { color: s.color, borderRadius: [0, 3, 3, 0] },
      data: top.map((r) => Math.round(r[s.key] || 0)),
    })),
  };
}

function holderOption(rows, labelKey, color) {
  const top = (rows || []).slice(0, 14).slice().reverse();
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r[labelKey] || "—"}</b><br/>`
          + `committed <b>${fmt.num(r.balance)}</b> KG<br/>`
          + `<span style="color:#90a1ac">${fmt.num(r.lines)} order lines · `
          + `${fmt.num(r.customers)} customers · ${fmt.num(r.items)} items</span>`;
      } },
    grid: { left: 8, right: 52, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => String(r[labelKey] || "—")),
      axisLabel: { color: "#414d55", fontSize: 11, width: 150, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18, itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => abbr(o.value) },
      data: top.map((r) => Math.round(r.balance)),
    }],
  };
}

function AllClear({ icon: Icon, title, note, tone = "good" }) {
  const c = tone === "good" ? "#2f855a" : "#3182ce";
  return (
    <div className="commit-allclear">
      <span className="commit-allclear-badge" style={{ background: `${c}14`, color: c }}>
        <Icon size={30} strokeWidth={1.8} />
      </span>
      <span className="commit-allclear-title" style={{ color: c }}>{title}</span>
      <span className="commit-allclear-note">{note}</span>
    </div>
  );
}

// ── the item ledger table ────────────────────────────────────────────────────

function ItemTable({ rows, total, onPick }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.item} ${r.item_code || ""} ${r.segment3 || ""}`
      .toLowerCase().includes(s));
  }, [rows, q]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 250 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search item or segment…" />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} of {fmt.num(total ?? rows.length)} items · click a row for the supply picture
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: "24%" }} /><col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="My approved projection for this cycle">My projection</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Projected quantity I have not converted to an order">Unprotected</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Sellable stock across the orgs that ship">On hand</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Live committed orders held by people outside my book">Others’ orders</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="On hand − others’ orders − safety level">Left for me</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Projected quantity with no supply left to cover it">Exposed</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Supply risk</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rk = RISK[r.risk] || RISK.covered;
              return (
                <tr key={r.key} style={{ cursor: "pointer" }} onClick={() => onPick && onPick(r)}
                  title="Open the full supply picture for this item">
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}
                    title={`${r.item_code || ""} ${r.item}`}>{r.item}</td>
                  <td style={{ ...CELL, textAlign: "right" }}
                    title={`${fmt.num(r.all_projection)} KG projected company-wide by `
                      + `${r.all_customers} customer${r.all_customers === 1 ? "" : "s"} across `
                      + `${r.all_collectors} collector${r.all_collectors === 1 ? "" : "s"}`}>
                    {fmt.num(r.my_projection)}
                    {r.all_projection > r.my_projection && (
                      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                        {" "}/ {abbr(r.all_projection)}
                      </span>
                    )}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 600,
                    color: r.my_unprotected > 0 ? "#b7791f" : "var(--muted)" }}>
                    {r.my_unprotected > 0 ? fmt.num(r.my_unprotected) : "0"}
                  </td>
                  <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.on_hand)}</td>
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.firm_others > 0 ? "#c53030" : "var(--muted)" }}
                    title={r.other_customers ? `${r.other_customers} other customers · ${r.other_lines} lines` : ""}>
                    {r.firm_others > 0 ? fmt.num(r.firm_others) : "—"}
                  </td>
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.atp_for_me < 0 ? "#c53030" : "#2f855a" }}>
                    {fmt.num(r.atp_for_me)}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                    color: r.exposure > 0 ? "#c53030" : "var(--muted)" }}>
                    {r.exposure > 0 ? fmt.num(r.exposure) : "0"}
                  </td>
                  <td style={{ ...CELL }} title={rk.hint}>
                    <span style={{ color: rk.color, fontWeight: 600, fontSize: 11.5 }}>● {rk.label}</span>
                    {r.incoming > 0 && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {" "}· makes {abbr(r.incoming)}{r.incoming_date ? ` by ${r.incoming_date}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={8} style={CELL}>No items match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HolderTable({ rows, labelKey, title }) {
  return (
    <div className="tbl-wrap">
      <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ ...HCELL, textAlign: "left" }}>{title}</th>
            <th style={{ ...HCELL, textAlign: "right" }}>Committed (KG)</th>
            <th style={{ ...HCELL, textAlign: "right" }}>Order lines</th>
            <th style={{ ...HCELL, textAlign: "right" }}>Customers</th>
            <th style={{ ...HCELL, textAlign: "right" }}>Items</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={i}>
              <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{r[labelKey] || "—"}</td>
              <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: "#c53030" }}>{fmt.num(r.balance)}</td>
              <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.lines)}</td>
              <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.customers)}</td>
              <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.items)}</td>
            </tr>
          ))}
          {!(rows || []).length && <tr><td colSpan={5} style={CELL}>No competing demand.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── the §7 drill-down ────────────────────────────────────────────────────────

function Fig({ label, value, unit = "KG", color, hint }) {
  return (
    <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 6,
      minWidth: 132, flex: "1 1 132px" }} title={hint || ""}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "#1f3a5f" }}>
        {typeof value === "number" ? fmt.num(value) : value}
        {typeof value === "number" && unit ? <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}> {unit}</span> : null}
      </div>
    </div>
  );
}

function ItemModal({ target, idParams, onClose }) {
  const { data, loading, error } = useAsync(
    () => (target ? api.supplyCompetitionItem({ ...idParams, item: target.key })
      : Promise.resolve(null)), [target && target.key]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);
  if (!target) return null;
  const r = data && data.found ? data.row : null;
  const rk = r ? (RISK[r.risk] || RISK.covered) : null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-container" role="dialog" aria-modal="true"
        style={{ maxWidth: 900, width: "94vw" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title" style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
              <Layers size={16} style={{ flex: "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {target.item}
              </span>
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-container-body">
          {loading && <Loading what="supply picture" />}
          {error && <ErrorBox error={error} />}
          {data && !data.found && !loading && (
            <div className="banner warn">This item is no longer in your scope for this cycle.</div>
          )}
          {r && !loading && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ color: rk.color, fontWeight: 700, fontSize: 13 }}>● {rk.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{rk.hint}</span>
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>My requirement · {data.jc_label}</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <Fig label="Projected" value={r.my_projection} />
                <Fig label="Firm orders raised" value={r.my_firm} color="#2f855a" />
                <Fig label="Not yet converted" value={r.my_unprotected} color="#b7791f" />
                <Fig label="Customers projected for" value={r.my_customers} unit="" />
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Supply position</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <Fig label="On hand (sellable)" value={r.on_hand} />
                <Fig label="Safety level (MSL)" value={r.msl} color="#90a1ac" />
                <Fig label="Firm orders — everyone" value={r.firm_total} color="#c53030" />
                <Fig label="Held by others" value={r.firm_others} color="#c53030"
                  hint={`${r.other_customers} customers · ${r.other_lines} order lines outside your book`} />
                <Fig label="Left for me" value={r.atp_for_me}
                  color={r.atp_for_me < 0 ? "#c53030" : "#2f855a"}
                  hint="On hand minus everyone else's firm orders minus the safety level" />
                <Fig label="Incoming production" value={r.incoming} color="#3182ce"
                  hint={r.incoming_date ? `earliest available ${r.incoming_date}` : "no production planned this cycle"} />
              </div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Everyone chasing this item
                <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>
                  {" "}— total demand across the company, not just your book
                </span>
              </h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <Fig label="Projected by everyone" value={r.all_projection}
                  hint="Approved projection for this cycle across every executive" />
                <Fig label="Of that, yours" value={r.my_projection} />
                <Fig label="Firm orders against it" value={r.firm_total} color="#3182ce" />
                <Fig label="Still unfirm company-wide" value={r.all_unprotected} color="#b7791f"
                  hint="Projected but not yet converted to an order by anyone — this is what competes for the same supply" />
                <Fig label="Customers projecting" value={r.all_customers} unit="" />
                <Fig label="Collectors projecting" value={r.all_collectors} unit="" />
              </div>

              {r.exposure > 0 && (
                <div className="banner warn" style={{ marginBottom: 16 }}>
                  <b>{fmt.num(r.exposure)} KG of your projection is exposed.</b>{" "}
                  You have {fmt.num(r.my_unprotected)} KG still to convert and only{" "}
                  {fmt.num(Math.max(0, r.atp_for_me))} KG is left after other confirmed orders
                  {r.incoming > 0
                    ? `. Production makes another ${fmt.num(r.incoming)} KG${r.incoming_date ? ` from ${r.incoming_date}` : ""}.`
                    : " and no production is planned for it this cycle."}
                  {" "}Raise the order or revise the customer commitment.
                </div>
              )}
              {r.stale > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>
                  A further {fmt.num(r.stale)} KG sits on orders overdue by more than 90 days.
                  Those are treated as uncleared paperwork and do not consume supply here.
                </div>
              )}

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Who holds the committed supply
                {!data.show_names && (
                  <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>
                    {" "}— customers outside your scope are grouped by collector
                  </span>
                )}
              </h4>
              <div className="tbl-wrap" style={{ maxHeight: 240, marginBottom: 16 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Customer / group</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>Collector</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>MC</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Committed (KG)</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.holders || []).map((h, i) => (
                      <tr key={`h${i}`} style={h.mine ? { background: "#F3F9F4" } : undefined}>
                        <td style={{ ...CELL, fontWeight: 600, color: h.mine ? "#2f855a" : "#1f3a5f" }}>
                          {h.customer_name}{h.mine ? " (yours)" : ""}
                        </td>
                        <td style={{ ...CELL }}>{h.collector || "—"}</td>
                        <td style={{ ...CELL }}>{h.mc_code || "—"}</td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(h.balance)}</td>
                        <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap" }}>{h.due || "—"}</td>
                      </tr>
                    ))}
                    {(data.grouped || []).map((g, i) => (
                      <tr key={`g${i}`}>
                        <td style={{ ...CELL, color: "var(--muted)", fontStyle: "italic" }}>
                          {fmt.num(g.customers)} other customer{g.customers === 1 ? "" : "s"}
                        </td>
                        <td style={{ ...CELL }}>{g.collector || "—"}</td>
                        <td style={{ ...CELL }}>{g.mc_code || "—"}</td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(g.balance)}</td>
                        <td style={{ ...CELL, textAlign: "right", color: "var(--muted)" }}>{fmt.num(g.lines)} lines</td>
                      </tr>
                    ))}
                    {!(data.holders || []).length && !(data.grouped || []).length && (
                      <tr><td colSpan={5} style={CELL}>No live committed orders on this item.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Where the stock sits</h4>
              <div className="tbl-wrap" style={{ maxHeight: 200 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Organization</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>On hand (KG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.by_org || []).map((o, i) => (
                      <tr key={i}>
                        <td style={{ ...CELL }}>{o.org}</td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(o.qty)}</td>
                      </tr>
                    ))}
                    {!(data.by_org || []).length && (
                      <tr><td colSpan={2} style={CELL}>No sellable stock anywhere.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>, document.body);
}

function ExportBtn({ section, idParams }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn secondary dash-export" title="Download this table as Excel"
      disabled={busy} aria-label="Download this table as Excel"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await api.supplyCompetitionExport({ ...idParams, section }); } catch { /* surfaced by the browser */ }
        setBusy(false);
      }}>
      <Download size={14} />
    </button>
  );
}

const DASH_DEFAULTS = {
  supplyCanvas: { x: 0, y: 0, w: 12, h: 12 },
  holderCanvas: { x: 0, y: 12, w: 12, h: 12 },
};

export default function SupplyCompetition({ session, isAdmin }) {
  const u = session?.user || {};

  const [viewAs, setViewAs] = useState({ persona: "", username: "" });
  const personas = useAsync(() => (isAdmin ? api.myDashboardPersonas() : Promise.resolve(null)), []);
  const plist = personas.data?.personas || [];
  const pickPersona = (e) => {
    const pn = e.target.value;
    const first = plist.find((x) => x.persona === pn)?.users?.[0]?.username || "";
    setViewAs({ persona: pn, username: pn ? first : "" });
  };
  const viewUsers = plist.find((x) => x.persona === viewAs.persona)?.users || [];

  const [jc, setJc] = useState(0);
  const idParams = useMemo(() => ({
    ...(viewAs.username
      ? { username: viewAs.username, persona: viewAs.persona }
      : { username: u.username || u.user_code || "", email: u.email || "", admin: isAdmin ? 1 : 0 }),
    jc,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [viewAs.username, viewAs.persona, isAdmin, jc]);

  const { data, loading, error } = useAsync(
    () => api.supplyCompetition(idParams), [viewAs.username, viewAs.persona, jc]);

  const [supMetric, setSupMetric] = useState("risk");
  const [holdMetric, setHoldMetric] = useState("collectors");
  const [supView, setSupView] = useState("chart");
  const [holdView, setHoldView] = useState("chart");
  const [riskSel, setRiskSel] = useState(null);
  const [pick, setPick] = useState(null);
  const [dlAll, setDlAll] = useState(false);
  useEffect(() => {
    setRiskSel(null); setPick(null);
    setSupMetric("risk"); setHoldMetric("collectors");
    setSupView("chart"); setHoldView("chart");
  }, [viewAs.username, viewAs.persona, jc]);
  const pickSupMetric = (m) => { setSupMetric(m); setRiskSel(null); };

  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("supplycomp", me), [me]);

  const rows = data?.rows || [];
  const k = data?.kpis;
  const riskRows = useMemo(
    () => (riskSel ? rows.filter((r) => r.risk === riskSel) : []), [rows, riskSel]);
  const exposedRows = useMemo(() => rows.filter((r) => r.exposure > 0), [rows]);

  // the exact row slices the charts draw — reused by the click handlers so a
  // clicked bar maps back to its item
  const expTop = useMemo(() => exposedRows.slice(0, 14).slice().reverse(), [exposedRows]);
  const balTop = useMemo(() => exposedRows.slice(0, 12).slice().reverse(), [exposedRows]);

  const riskOpt = useMemo(() => riskDonut(k?.buckets), [k]);
  const expOpt = useMemo(() => exposureOption(expTop), [expTop]);
  const balOpt = useMemo(() => balanceOption(balTop), [balTop]);
  const collOpt = useMemo(() => holderOption(data?.by_collector, "collector", "#c53030"), [data]);
  const mcOpt = useMemo(() => holderOption(data?.by_mc, "mc_code", "#805ad5"), [data]);

  const fitRows = (n, toolbar = true) => {
    const px = 76 + (toolbar ? 46 : 0) + 38 + Math.min(n, 12) * 34 + 42;
    return Math.max(5, Math.ceil((px + 14) / 44));
  };
  const expandedCards = useMemo(() => {
    const out = {};
    if (supView === "table") {
      out.supplyCanvas = fitRows(
        supMetric === "risk" ? (riskSel ? riskRows.length : rows.length) : exposedRows.length);
    }
    if (holdView === "table") {
      out.holderCanvas = fitRows(
        holdMetric === "collectors" ? (data?.by_collector || []).length
          : holdMetric === "mc" ? (data?.by_mc || []).length : exposedRows.length);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supView, holdView, supMetric, holdMetric, riskSel, riskRows.length,
    rows.length, exposedRows.length, data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  if (!data.persona || !k) {
    const who = viewAs.username || u.username || "";
    return (
      <div className="banner warn">
        No data scope is mapped to {viewAs.username ? "this account" : "your account"}
        {who ? ` (${who})` : ""} — the CRM role-to-data mapping hasn’t been set up.
      </div>
    );
  }
  const syncedAt = data.last_sync?.finished_at ? String(data.last_sync.finished_at).slice(0, 16) : null;
  const SM = SUPPLY_METRICS.find((m) => m.id === supMetric) || SUPPLY_METRICS[0];
  const HM = HOLDER_METRICS.find((m) => m.id === holdMetric) || HOLDER_METRICS[0];
  const SIcon = SM.icon;
  const HIcon = HM.icon;

  return (
    <>
      {isAdmin && plist.length > 0 && (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          padding: "10px 16px", marginBottom: 14, background: viewAs.username ? "#FFF9EF" : undefined }}>
          <b style={{ fontSize: 13 }}>👁 View as</b>
          <SelectBox className="searchbox" style={{ maxWidth: 250 }} value={viewAs.persona} onChange={pickPersona}>
            <option value="">Myself (Admin — all data)</option>
            {plist.map((pp) => <option key={pp.persona} value={pp.persona}>{pp.persona} ({pp.users.length} users)</option>)}
          </SelectBox>
          {viewAs.persona && (
            <SelectBox className="searchbox" style={{ maxWidth: 280 }} value={viewAs.username}
              onChange={(e) => setViewAs((v) => ({ ...v, username: e.target.value }))}>
              {viewUsers.map((us) => <option key={us.username} value={us.username}>{us.user_name} — {us.username}</option>)}
            </SelectBox>
          )}
        </div>
      )}

      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
        padding: "12px 16px", marginBottom: 14 }}>
        <span className="chip" style={{ cursor: "default", background: "#EEF6FF", fontWeight: 600 }}>{data.persona}</span>
        <SelectBox className="searchbox" style={{ maxWidth: 150 }} value={String(data.jc)}
          title="Which journey cycle to measure" onChange={(e) => setJc(Number(e.target.value) || 0)}>
          {(data.jcs || []).map((j) => <option key={j.jc} value={j.jc}>{j.label}</option>)}
        </SelectBox>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{(data.scope || []).join(" · ") || "—"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(k.items)} items · <b style={{ color: k.exposure > 0 ? "#c53030" : "#2f855a" }}>
            {abbr(k.exposure)} KG exposed</b> across {fmt.num(k.exposed_items)} items
          {syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel workbook: charts on the first sheet, every table on its own sheet"
          disabled={dlAll}
          onClick={async () => {
            setDlAll(true);
            try { await api.supplyCompetitionExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDlAll(false);
          }}>
          <Download size={15} /> {dlAll ? "Preparing…" : "Download page"}
        </button>
      </div>

      <div className="banner" style={{ marginBottom: 14, fontSize: 12.5 }}>
        Supply is measured across the {data.sell_orgs} orgs that actually ship, after the{" "}
        <b>{data.msl_ref || "MSL"}</b> safety level and everyone’s live committed orders. Orders
        overdue by more than {data.stale_days} days are excluded as uncleared paperwork
        ({abbr(k.stale)} KG). Incoming production comes from saved plan{" "}
        <b>{data.plan_id || "—"}</b> and covers manufactured items only — traded goods carry no
        production job, so they show none.
      </div>

      <DashGrid storageKey={`supplycomp_layout_v1:${me || "anon"}`} defaults={DASH_DEFAULTS}
        expanded={expandedCards}
        remoteLayouts={savedLayout.data?.layouts || null}
        userLayouts={savedLayout.data?.user_layouts || null}
        canSaveDefault={isAdmin}
        onSaveDefault={(l) => api.saveDashboardLayout("supplycomp", l)}
        onSaveUser={me ? (l) => api.saveDashboardLayout("supplycomp", l, me) : undefined}>

        <div key="supplyCanvas" className="card">
          <ExportBtn idParams={idParams}
            section={supMetric === "risk" && !riskSel ? "risk" : "exposed"} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <SIcon size={16} /> {riskSel ? `${(RISK[riskSel] || {}).label} items` : SM.title}
              </h3>
              <div className="sub">
                {supMetric === "risk" && (riskSel
                  ? <>{fmt.num(riskRows.length)} item{riskRows.length === 1 ? "" : "s"} · {(RISK[riskSel] || {}).hint}</>
                  : <>{data.jc_label} · will the stock still be there for the projection you have not
                    converted yet · click a slice for the items</>)}
                {supMetric === "balance" &&
                  <>on-hand against the claims on it, for the items you are most exposed on ·
                    click a bar for the full supply picture</>}
              </div>
            </div>
            <div className="card-filters">
              {supMetric === "risk" && riskSel && (
                <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setRiskSel(null)}>← All risks</button>
              )}
              <SegTabs size="sm" value={supMetric} onChange={pickSupMetric}
                tabs={SUPPLY_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={supView} onChange={setSupView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {k.items === 0 ? (
            <AllClear icon={PartyPopper} tone="calm" title={`Nothing projected for ${data.jc_label}`}
              note="There is no projection in your scope for this cycle, so nothing is competing for supply." />
          ) : supMetric === "risk" ? (
            supView === "chart" ? (
              riskSel ? <ItemTable rows={riskRows} total={riskRows.length} onPick={setPick} />
                : <div className="echart-fill" style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
                    <EChart option={riskOpt} height="100%"
                      onEvents={{ click: (p) => {
                        const hit = RISK_ORDER.find((key) => RISK[key].label === p.name);
                        if (hit) setRiskSel(hit);
                      } }} />
                  </div>
            ) : (
              <ItemTable rows={riskSel ? riskRows : rows} total={riskSel ? riskRows.length : data.total_rows}
                onPick={setPick} />
            )
          ) : k.exposed_items === 0 ? (
            <AllClear icon={ShieldCheck} title="Nothing is exposed"
              note="Every item you projected has supply available after the other confirmed orders." />
          ) : supView === "chart" ? (
            <EChart className="echart-fill" option={balOpt} height="100%"
              onEvents={{ click: (p) => {
                const hit = balTop[p.dataIndex];
                if (hit) setPick(hit);
              } }} />
          ) : (
            <ItemTable rows={exposedRows} total={exposedRows.length} onPick={setPick} />
          )}
        </div>

        <div key="holderCanvas" className="card">
          <ExportBtn section={holdMetric} idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <HIcon size={16} /> {HM.title}
              </h3>
              <div className="sub">
                {holdMetric === "collectors" &&
                  <>live committed orders held outside your book on the items you are exposed on</>}
                {holdMetric === "mc" &&
                  <>the same competing demand, grouped by market circle</>}
                {holdMetric === "exposed" &&
                  <>{fmt.num(k.exposed_items)} items where your unconverted projection has no supply
                    left · click one for the full picture</>}
              </div>
            </div>
            <div className="card-filters">
              <SegTabs size="sm" value={holdMetric} onChange={setHoldMetric}
                tabs={HOLDER_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={holdView} onChange={setHoldView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {holdMetric === "exposed" ? (
            k.exposed_items === 0 ? (
              <AllClear icon={ShieldCheck} title="Nothing is exposed"
                note="Every item you projected has supply available after the other confirmed orders." />
            ) : holdView === "chart" ? (
              <EChart className="echart-fill" option={expOpt} height="100%"
                onEvents={{ click: (p) => {
                  const hit = expTop[p.dataIndex];
                  if (hit) setPick(hit);
                } }} />
            ) : (
              <ItemTable rows={exposedRows} total={exposedRows.length} onPick={setPick} />
            )
          ) : (holdMetric === "collectors" ? data.by_collector : data.by_mc || []).length === 0 ? (
            <AllClear icon={Factory} tone="calm" title="No competing demand"
              note="Nobody outside your book holds live committed orders on the items you are exposed on." />
          ) : holdView === "chart" ? (
            <EChart className="echart-fill" option={holdMetric === "collectors" ? collOpt : mcOpt} height="100%" />
          ) : holdMetric === "collectors" ? (
            <HolderTable rows={data.by_collector} labelKey="collector" title="Collector" />
          ) : (
            <HolderTable rows={data.by_mc} labelKey="mc_code" title="Market circle" />
          )}
        </div>

      </DashGrid>

      <ItemModal target={pick} idParams={idParams} onClose={() => setPick(null)} />
    </>
  );
}
