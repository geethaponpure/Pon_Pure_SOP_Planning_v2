import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import EChart from "../components/EChart.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { useSort, SortTh } from "../components/SortTable.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { CalendarDays, CircleCheck, ClipboardList, Dna, Download, Eye, Package, Target, TrendingUp, TriangleAlert, Factory } from "lucide-react";

// My Dashboard — permission-scoped dispatch view. The backend resolves the
// user's CRM data grants (stg_user_scope) and returns a compact cube
// (JC × collector × segment) already filtered to their scope; every chart here
// derives from that cube, so the click-to-cross-filter stays instant.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const gradV = (c) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + "55" }, { offset: 1, color: c + "05" }] });
const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
const PAL = ["#2a9d8f", "#4880ff", "#b7791f", "#805ad5", "#2f855a", "#c53030", "#28b5e1", "#90a1ac",
  "#d69e2e", "#3182ce", "#38a169", "#e53e3e", "#718096"];
const SHAPE_DIST = [{ id: "donut", label: "Donut" }, { id: "pie", label: "Pie" }, { id: "bar", label: "Bar" }];

// The three cycle-by-cycle views share one card; this drives its filter.
const JC_VIEWS = [
  { id: "qty", label: "Quantity", title: "Total projection qty by JC", icon: <Package size={16} /> },
  { id: "accuracy", label: "Accuracy", title: "Projection accuracy by JC", icon: <Target size={16} /> },
  { id: "items", label: "Items", title: "Items projected · every JC", icon: <ClipboardList size={16} /> },
];

// Where each card sits until the user arranges the page themselves (12
// columns; one row unit is 30px + a 14px gutter). A saved layout wins.
const DASH_DEFAULTS = {
  byColl:     { x: 0, y: 0, w: 6, h: 8 },
  // the KPI table plus the gap breakdown beneath it
  projCanvas: { x: 0, y: 8, w: 12, h: 14 },
  jcTrend:    { x: 0, y: 18, w: 6, h: 9 },
  status:     { x: 6, y: 18, w: 6, h: 9 },
  compare:    { x: 0, y: 45, w: 12, h: 12 },
  // only rendered for Division Head / Business Head / Admin; the slot is simply
  // unused for everyone else
  rmImpact:   { x: 0, y: 57, w: 12, h: 12 },
  commercial: { x: 0, y: 69, w: 12, h: 16 },
};

// RM price impact: what a raw-material rise does to the finished goods that use
// it. Gated server-side — this only renders when the API says allowed.

function rmBarOption(fgs, tt, anim) {
  const top = fgs.filter((r) => r.impact_pct != null).slice(0, 12).slice().reverse();
  return {
    ...anim,
    tooltip: { ...tt, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r.item}</b>`
          + (r.segment3 || r.segment2 ? `<br/>${r.segment3 || r.segment2}` : "")
          + `<br/><b>${r.impact_pct}%</b> cost impact`;
      } },
    grid: { left: 8, right: 54, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: "{value}%" },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => r.item),
      axisLabel: { color: "#414d55", fontSize: 11, width: 170, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18,
      itemStyle: { borderRadius: [0, 4, 4, 0],
        color: (o) => { const v = top[o.dataIndex].impact_pct;
          return v > 5 ? "#c53030" : v > 3 ? "#b7791f" : v > 1 ? "#3182ce" : "#90a1ac"; } },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => `${o.value}%` },
      data: top.map((r) => r.impact_pct),
    }],
  };
}

const abbr = (v) => {
  const n = Math.abs(v);
  if (n >= 1e7) return (v / 1e7).toFixed(n >= 1e8 ? 0 : 1) + "Cr";
  if (n >= 1e5) return (v / 1e5).toFixed(n >= 1e6 ? 0 : 1) + "L";
  if (n >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return fmt.num(v);
};

// projection-accuracy flags (same ±20% band the RM plan uses)
const FLAGS = {
  ontrack: { label: "On-track", color: "#2f855a" },
  over: { label: "Over-projected", color: "#b7791f" },
  under: { label: "Under-projected", color: "#3182ce" },
  none: { label: "No projection", color: "#c53030" },
  new: { label: "New (no sales yet)", color: "#90a1ac" },
};

function distOption(rows, { shape, unit, center, selected }) {
  const data = rows.map((r, i) => ({
    value: r.value, name: r.name,
    itemStyle: {
      color: r.color || PAL[i % PAL.length],
      opacity: selected && selected !== r.name ? 0.28 : 1,
    },
  }));
  if (shape === "bar") {
    const rev = [...data].reverse();
    return {
      ...ANIM, grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
      tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (ps) => `${ps[0].name}<br/><b>${fmt.num(ps[0].value)}</b> ${unit}` },
      xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
        axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true },
        axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "category", data: rev.map((d) => d.name),
        axisLabel: { color: "#414d55", fontSize: 11, width: 110, overflow: "truncate", hideOverlap: true },
        axisTick: { show: false }, axisLine: { show: false } },
      series: [{ type: "bar", barWidth: "56%", itemStyle: { borderRadius: [0, 6, 6, 0] }, data: rev }],
    };
  }
  const inner = shape === "pie" ? "0%" : "54%";
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (p) => `${p.marker} ${p.name}<br/><b style="font-size:13px">${fmt.num(p.value)}</b> ${unit} · ${p.percent}%` },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    ...(shape === "donut" ? {
      title: { text: abbr(rows.reduce((a, d) => a + d.value, 0)), subtext: center,
        left: "center", top: "34%",
        textStyle: { fontSize: 20, fontWeight: 700, color: "#1f3a5f" },
        subtextStyle: { fontSize: 11, color: "#90a1ac" } },
    } : {}),
    series: [{
      type: "pie", radius: [inner, "76%"], center: ["50%", shape === "donut" ? "42%" : "45%"],
      avoidLabelOverlap: true, itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data,
    }],
  };
}

// Projection-vs-sales as a bordered GRID: every data point in its own cell,
// mini bars kept for the visual ratio. Rows click through to the item's
// JC-wise trend popup.
const CELL = { border: "1px solid var(--border)", padding: "8px 10px", verticalAlign: "middle" };
const HCELL = { ...CELL, background: "#f7fafc", fontSize: 12, color: "#414d55",
  fontWeight: 600, whiteSpace: "nowrap" };

function MiniBar({ label, value, max, color }) {
  const pct = Math.max(value > 0 ? 3 : 0, Math.round((value / (max || 1)) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10, color: "var(--muted)", width: 32, flex: "none" }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: "#eef2f7", borderRadius: 4, overflow: "hidden" }}>
        <i style={{ display: "block", height: "100%", width: "100%", background: color,
          borderRadius: 4, transform: `scaleX(${pct / 100})`, transformOrigin: "left",
          transition: "transform .45s cubic-bezier(.2,.7,.3,1)" }} />
      </div>
    </div>
  );
}

// Proj % and Status are worked out while rendering, so the sorter needs its own
// readers for them; Status ranks by the FLAGS order (on-track → new), not A-Z.
const PROJ_SORT_GET = {
  pct: (r) => (r.avg3 > 0 ? r.proj / r.avg3 : null),
  flag: (r) => Object.keys(FLAGS).indexOf(r.flag),
};
// same idea for the item-group roll-up and the RM-impact list
const RM_SORT_GET = { segment: (r) => r.segment3 || r.segment2 || "" };
// the two header styles the card tables use, spelled once
const GH_L = { ...HCELL, textAlign: "left" };
const GH_R = { ...HCELL, textAlign: "right" };

function ProjCompareTable({ rows, onItem, jc }) {
  const s = useSort(rows, { key: null, dir: "desc" }, PROJ_SORT_GET);
  const th = s.th;
  return (
    <div className="tbl-wrap">
      <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <colgroup>
          <col style={{ width: "27%" }} /><col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} /><col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} /><col style={{ width: "11%" }} />
          <col style={{ width: "7%" }} /><col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr>
            <SortTh label="Item" k="name" dir0="asc" {...th} style={{ ...HCELL, textAlign: "left" }} />
            <th style={{ ...HCELL, textAlign: "left" }} title={`3-JC average sales vs the JC${jc} projection`}>Sales vs Proj</th>
            <SortTh label="Avg sales" k="avg3" {...th} style={{ ...HCELL, textAlign: "right" }}
              title="3-JC average sales (KG) · click to sort" />
            <SortTh label={`JC${jc}`} k="proj" {...th} style={{ ...HCELL, textAlign: "right" }}
              title={`Projection for the current cycle, JC${jc} (KG) · click to sort`} />
            <SortTh label="Next JC" k="next1" {...th} style={{ ...HCELL, textAlign: "right" }}
              title="Projection for the next cycle (KG) · click to sort" />
            <SortTh label="JC after" k="next2" {...th} style={{ ...HCELL, textAlign: "right" }}
              title="Projection for the cycle after next (KG) · click to sort" />
            <SortTh label="Proj %" k="pct" {...th} style={{ ...HCELL, textAlign: "right" }}
              title="Projection as a % of 3-JC average sales · click to sort" />
            <SortTh label="Status" k="flag" {...th} style={{ ...HCELL, textAlign: "center" }} />
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r, i) => {
            const f = FLAGS[r.flag] || FLAGS.ontrack;
            const max = Math.max(r.avg3, r.proj);
            const acc = r.avg3 > 0 ? Math.round((r.proj / r.avg3) * 100) : null;
            return (
              <tr key={i} onClick={() => onItem(r)} style={{ cursor: "pointer" }}
                title="Click to see this item's JC-wise graph">
                <td style={{ ...CELL, maxWidth: 260 }}>
                  <div title={r.name} style={{ fontWeight: 600, color: "#1f3a5f", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{r.code || "—"}</div>
                </td>
                <td style={CELL}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <MiniBar label="Sales" value={r.avg3} max={max} color="#2a9d8f" />
                    <MiniBar label="Proj" value={r.proj} max={max} color="#4880ff" />
                  </div>
                </td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.avg3)}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.proj)}</td>
                <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.next1 || 0)}</td>
                <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.next2 || 0)}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600,
                  color: acc == null ? "var(--muted)" : f.color }}>
                  {acc == null ? "—" : `${acc}%`}
                </td>
                <td style={{ ...CELL, textAlign: "center" }} title={f.label}>
                  <span className="proj-pill" style={{ color: f.color, background: f.color + "16" }}>
                    {f.label}
                  </span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} style={CELL}>No items match the search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// popup: one item's dispatched KG per JC (scoped) + projection reference lines
// Which raw materials moved, by how much, and what each contributes to this
// product's cost — the brief's section 5 drill-down.
// One bucket of the projection gap, item by item. The rows add up to the
// bucket's own figure, so the modal can be reconciled against the card.
function GapDrill({ part, cycle, cycles, onClose }) {
  const [q, setQ] = useState("");
  // The modal stays mounted between opens, so the search text outlives the
  // bucket it was typed in: a query from one bucket would filter the next one
  // to nothing while its header still showed that bucket's totals. Its own
  // effect, because onClose is a fresh arrow on every render and folding this
  // into the key-handler effect below would clear the box as you type.
  useEffect(() => { setQ(""); }, [part]);
  useEffect(() => {
    if (!part) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [part, onClose]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = part?.rows || [];
    if (!t) return all;
    return all.filter((r) => (r.item || "").toLowerCase().includes(t)
      || (r.customer || "").toLowerCase().includes(t)
      || (r.seg || "").toLowerCase().includes(t));
  }, [part, q]);
  if (!part) return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-container" role="dialog" aria-modal="true"
        style={{ maxWidth: 1180, width: "96vw", maxHeight: "90vh" }}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title" style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7,
              overflow: "hidden" }}>
              <Target size={16} style={{ flex: "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap" }}>{part.label}</span>
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-container-body gap-drill-body">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12,
            padding: "10px 12px", marginBottom: 12, borderRadius: 6, background: "#f7fafc",
            border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums",
              color: part.kg < 0 ? "#c53030" : "#3182ce" }}>
              {part.kg > 0 ? "+" : ""}{fmt.num(part.kg)} kg
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {fmt.num(part.row_items ?? part.items)}{" "}
              item{(part.row_items ?? part.items) === 1 ? "" : "s"} across{" "}
              {fmt.num(part.row_count ?? (part.rows || []).length)} customer line
              {(part.row_count ?? (part.rows || []).length) === 1 ? "" : "s"} · their share of
              the projection gap · <b>{cycle}</b> projection against the {cycles} average
            </span>
          </div>
          {part.rows_kg != null
            && Math.abs(part.rows_kg - part.kg) > Math.max(2, Math.abs(part.kg) * 0.005) && (
            <div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 6,
              background: "#FFF8EC", border: "1px solid #f0dcc0", fontSize: 12,
              color: "#7a5b1e" }}>
              These lines add up to <b>{part.rows_kg > 0 ? "+" : ""}{fmt.num(part.rows_kg)} kg</b>,
              not the {fmt.num(part.kg)} kg above. The cycle projection is recorded against
              the whole collector, while the lines below are only the customers inside your
              scope — so the two do not reconcile for your role.
            </div>
          )}
          <div className="pagebar" style={{ marginBottom: 10 }}>
            <SmoothInput className="searchbox" placeholder="Search item / customer / segment…"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              {fmt.num(rows.length)} of {fmt.num((part.rows || []).length)}
            </span>
          </div>
          <div className="tbl-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
                  <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
                  <th style={{ ...HCELL, textAlign: "left" }}>Segment</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>SOC (KG)</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Open quote (KG)</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Annual potential (KG)</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Annual budget (KG)</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>{cycle} projection</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>3-cycle avg dispatch</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.item}|${r.customer}|${i}`}>
                    <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{r.item}</td>
                    <td style={{ ...CELL }}>{r.customer}</td>
                    <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>
                      {r.seg || "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                      {r.soc ? fmt.num(r.soc) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right",
                      color: r.quote ? "#3182ce" : "var(--muted)" }}>
                      {r.quote ? fmt.num(r.quote) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right" }}>
                      {r.potential ? fmt.num(r.potential) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                      {r.budget ? fmt.num(r.budget) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right" }}>
                      {r.projection ? fmt.num(r.projection) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right" }}>
                      {r.dispatch ? fmt.num(r.dispatch) : "—"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: r.diff < 0 ? "#c53030" : "#3182ce" }}>
                      {r.diff > 0 ? "+" : ""}{fmt.num(r.diff)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={10} style={CELL}>Nothing matches that search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(part.rows || []).length < (part.row_count ?? 0) && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#b7791f" }}>
              Showing the {fmt.num((part.rows || []).length)} biggest contributors of{" "}
              {fmt.num(part.row_count)} — the header total counts them all.
            </div>
          )}
        </div>
      </div>
    </div>, document.body);
}

function ItemGraphModal({ target, idParams, onClose }) {
  const { data, loading, error } = useAsync(
    () => (target ? api.myDashboardItem({ ...idParams, item: target.name, code: target.code || "" })
      : Promise.resolve(null)),
    [target && target.name, target && target.code]
  );
  useEffect(() => {
    if (!target) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  const opt = useMemo(() => {
    if (!data) return null;
    const marks = [];
    if (data.proj > 0) marks.push({ yAxis: data.proj, lineStyle: { color: "#4880ff" },
      label: { formatter: `Projection ${abbr(data.proj)}`, color: "#4880ff", fontSize: 11 } });
    if (data.avg3 > 0) marks.push({ yAxis: data.avg3, lineStyle: { color: "#2a9d8f" },
      label: { formatter: `3-JC avg ${abbr(data.avg3)}`, color: "#2a9d8f", fontSize: 11 } });
    return {
      ...ANIM, grid: { left: 8, right: 90, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (ps) => {
          const j = (data.jcs || [])[ps[0].dataIndex] || {};
          const d = j.from ? `<br/><span style="color:#90a1ac;font-size:11px">${j.from} → ${j.to}</span>` : "";
          return `${ps[0].name}${d}<br/><b>${fmt.num(ps[0].value)}</b> KG despatched`;
        } },
      xAxis: { type: "category", data: (data.jcs || []).map((j) => j.label),
        axisTick: { show: false }, axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
        axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
      series: [{ type: "bar", barWidth: "55%", data: data.qty || [],
        itemStyle: { borderRadius: [5, 5, 0, 0], color: "#7aa7ff" },
        markLine: marks.length ? { symbol: "none", lineStyle: { type: "dashed", width: 1.6 },
          data: marks } : undefined }],
    };
  }, [data]);

  if (!target) return null;
  const f = data ? (FLAGS[data.flag] || FLAGS.ontrack) : null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-container" role="dialog" aria-modal="true"
        style={{ maxWidth: 780, width: "94vw" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title" style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
              <TrendingUp size={16} style={{ flex: "none" }} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target.name}</span>
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
          {loading && <Loading what="item trend" />}
          {error && <ErrorBox msg={error} />}
          {data && !loading && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
                marginBottom: 10, fontSize: 12 }}>
                {f && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: f.color,
                    background: f.color + "16", padding: "3px 9px", borderRadius: 999 }}>{f.label}</span>
                )}
                <span style={{ color: "var(--muted)" }}>
                  Projection JC{data.plan_jc}: <b style={{ color: "#1f3a5f" }}>{fmt.num(data.proj)}</b> ·
                  Next JC: <b style={{ color: "#1f3a5f" }}>{fmt.num(data.next1)}</b> ·
                  JC after next: <b style={{ color: "#1f3a5f" }}>{fmt.num(data.next2)}</b> ·
                  3-JC avg sales: <b style={{ color: "#1f3a5f" }}>{fmt.num(data.avg3)}</b> KG
                  {data.basis === "collector" ? " · projections for your collectors"
                    : data.basis === "customer" ? " · projections for your own customers" : ""}
                </span>
              </div>
              <EChart option={opt} height={300} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                Despatched KG per job cycle within your scope · dashed lines mark the JC{data.plan_jc}
                projection and your 3-JC sales average.
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// the 3-cycle projection pipeline: current JC + the two after it
function pipeOption(pipe) {
  const COLORS = ["#4880ff", "#7aa7ff", "#b9cdfd"];
  return {
    ...ANIM, grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const b = pipe[ps[0].dataIndex] || {};
        return `${b.label}<br/><b>${fmt.num(b.kg)}</b> KG projected` +
          `<br/><span style="color:#90a1ac">${fmt.num(b.items)} items with a projection</span>`;
      } },
    xAxis: { type: "category", data: pipe.map((b) => b.label), axisTick: { show: false },
      axisLabel: { color: "#414d55", fontSize: 11 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
    series: [{ type: "bar", barWidth: "48%",
      label: { show: true, position: "top", fontSize: 12, fontWeight: 600,
        color: "#1f3a5f", formatter: (o) => abbr(o.value) },
      data: pipe.map((b, i) => ({ value: b.kg,
        itemStyle: { color: COLORS[i % 3], borderRadius: [6, 6, 0, 0] } })) }],
  };
}

// The three single-number projection metrics share one canvas: pick the metric,
// then read it as a chart or as the table behind it.
const PROJ_METRICS = [
  { id: "accuracy", label: "Projection", icon: Target,
    title: "Upcoming projection vs recent dispatch" },
  { id: "items", label: "Missing", icon: TriangleAlert, title: "Items with no projection" },
];

// Colour band shared by the per-cycle accuracy figures.
const accColor = (v) => (v == null ? "#90a1ac" : v < 40 ? "#c53030" : v < 70 ? "#b7791f" : "#2f855a");

// The upcoming plan against how we have actually been selling, stated as the five
// figures a planner reads directly — no score, no WMAPE. The band follows the
// plan's own +/-20% tolerance (planning_filter._proj_flag), so "in line" here
// means the same thing it means everywhere else in the tool.
const upliftColor = (u) => (u == null ? "#90a1ac"
  : Math.abs(u) <= 20 ? "#2f855a" : Math.abs(u) <= 50 ? "#b7791f" : "#c53030");

function ProjectionKpis({ f, onPick }) {
  if (!f) {
    return <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--muted)" }}>
      No completed cycle to compare against yet.
    </div>;
  }
  const kg = (v) => (v == null ? "—" : `${fmt.num(v)} kg`);
  const signedKg = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt.num(v)} kg`);
  const pct = (v) => (v == null ? "—" : `${v}%`);
  const signedPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
  const n = f.n_cycles || 3;
  const cycles = (f.dispatch_jcs || []).join(" + ");
  const c = upliftColor(f.uplift_pct);
  const rows = [
    ["Upcoming Projection", `Executive input · ${f.label}`, kg(f.projection_kg), "#1f3a5f", true],
    [`${n}-cycle Avg Dispatch`, `(${cycles}) ÷ ${n}`, kg(f.dispatch_avg_kg), "#1f3a5f", false],
    ["Projection vs Avg", "Projection ÷ Avg × 100", pct(f.ratio_pct), c, true],
    ["Projection Uplift %", "(Projection − Avg) ÷ Avg × 100", signedPct(f.uplift_pct), c, true],
    ["Projection Gap", "Projection − Avg", signedKg(f.gap_kg), c, false],
  ];
  return (
    // card-scroll: this body is several stacked blocks, so it needs the shrink
    // -and-scroll behaviour a lone .tbl-wrap gets from the grid CSS
    <div className="card-scroll">
      <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>KPI</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Formula</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, formula, value, color, strong]) => (
              <tr key={label}>
                <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{label}</td>
                <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>{formula}</td>
                <td style={{ ...CELL, textAlign: "right", color,
                  fontWeight: strong ? 700 : 600, fontSize: strong ? 14 : 13,
                  fontVariantNumeric: "tabular-nums" }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(f.parts || []).some((x) => x.kg) && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1f3a5f", marginBottom: 6 }}>
            Where the gap comes from
          </div>
          <div className="tbl-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {f.parts.map((x) => (
                  <tr key={x.key}
                    onClick={() => x.items && onPick && onPick(x)}
                    style={{ cursor: x.items ? "pointer" : "default" }}
                    title={x.items ? "Click to see the items behind this" : ""}>
                    <td style={{ ...CELL }}>{x.label}</td>
                    <td style={{ ...CELL, textAlign: "right", color: "var(--muted)",
                      fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {fmt.num(x.items)} item{x.items === 1 ? "" : "s"}
                    </td>
                    <td style={{ ...CELL, textAlign: "right", fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      color: x.kg < 0 ? "#c53030" : x.kg > 0 ? "#3182ce" : "var(--muted)" }}>
                      {x.kg > 0 ? "+" : ""}{fmt.num(x.kg)} kg
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ ...CELL, background: "#f7fafc", fontWeight: 700 }}>
                    Projection Gap
                  </td>
                  <td style={{ ...CELL, background: "#f7fafc", textAlign: "right",
                    fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    color: upliftColor(f.uplift_pct) }}>
                    {f.gap_kg > 0 ? "+" : ""}{fmt.num(f.gap_kg)} kg
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
        {f.in_last_week
          ? `${f.current_label} ends in ${f.days_left} day${f.days_left === 1 ? "" : "s"}, so ${f.label} — the next cycle — is the plan shown.`
          : `We are inside ${f.current_label}, so its own plan is shown.`}
        {" "}{fmt.num(f.items_projected)} items carry a projection; {fmt.num(f.items_sold)} sold
        in {cycles}.
      </div>
    </div>
  );
}


// Donut for a two-way split (projected vs not), with the share in the middle.

// ── projection analytics charts (JC trend / accuracy / items / item group) ────

// Projected KG per JC (bars) against actual sales (line on its own axis) — the
// two live on very different scales, so a shared axis would flatten one of them.
function jcQtyOption(trend) {
  return {
    ...ANIM, grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
      textStyle: { color: "#414d55", fontSize: 11 } },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const t = trend[ps[0].dataIndex] || {};
        const when = t.from ? `<span style="color:#90a1ac;font-size:11px"> ${t.from} → ${t.to}</span>` : "";
        if (!t.done) {
          return `<b>${t.label}</b>${when}<br/>Projected: <b>${fmt.num(t.proj)}</b> KG` +
            `<br/><span style="color:#90a1ac">planning cycle — not dispatched yet</span>`;
        }
        return `<b>${t.label}</b>${when}` +
          `<br/>Projected: <b>${fmt.num(t.proj)}</b> KG` +
          `<br/>Actual sales: <b>${fmt.num(t.actual)}</b> KG` +
          `<br/><span style="color:#90a1ac">${t.items_projected} of ${t.items_sold} selling items projected</span>`;
      } },
    xAxis: { type: "category", data: trend.map((t) => t.label), axisTick: { show: false },
      axisLabel: { color: "#414d55", fontSize: 11 } },
    yAxis: [
      { type: "value", name: "Projected", nameTextStyle: { color: "#90a1ac", fontSize: 10 },
        splitLine: { lineStyle: { color: "#eef1f5" } },
        axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
      { type: "value", name: "Actual", nameTextStyle: { color: "#90a1ac", fontSize: 10 },
        splitLine: { show: false },
        axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
    ],
    series: [
      { name: "Projected KG", type: "bar", barWidth: "48%", yAxisIndex: 0,
        data: trend.map((t) => ({ value: t.proj,
          itemStyle: { borderRadius: [5, 5, 0, 0], color: t.done ? "#4880ff" : "#b9cdfd" } })) },
      { name: "Actual sales KG", type: "line", yAxisIndex: 1, smooth: true,
        symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#2a9d8f" },
        itemStyle: { color: "#2a9d8f" }, data: trend.map((t) => t.actual) },
    ],
  };
}

// Accuracy (100 - WMAPE) on the items that WERE projected, plus how much of the
// scope's sales volume carried a projection at all.
function jcAccOption(trend) {
  return {
    ...ANIM, grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
      textStyle: { color: "#414d55", fontSize: 11 } },
    tooltip: { ...TT, trigger: "axis",
      formatter: (ps) => {
        const t = trend[ps[0].dataIndex] || {};
        return `<b>${t.label}</b>` +
          `<br/>Accuracy on projected items: <b>${t.accuracy_proj == null ? "—" : t.accuracy_proj + "%"}</b>` +
          `<br/>Sales volume projected: <b>${t.coverage_pct == null ? "—" : t.coverage_pct + "%"}</b>` +
          `<br/><span style="color:#90a1ac">incl. unprojected items: ${t.accuracy == null ? "—" : t.accuracy + "%"}</span>`;
      } },
    xAxis: { type: "category", data: trend.map((t) => t.label), axisTick: { show: false },
      axisLabel: { color: "#414d55", fontSize: 11 } },
    yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: (v) => `${v}%` } },
    series: [
      { name: "Accuracy (projected items)", type: "line", smooth: true, symbol: "circle",
        symbolSize: 8, lineStyle: { width: 3, color: "#2f855a" }, itemStyle: { color: "#2f855a" },
        areaStyle: { color: gradV("#2f855a") },
        data: trend.map((t) => t.accuracy_proj) },
      { name: "Sales volume projected", type: "line", smooth: true, symbol: "circle",
        symbolSize: 6, lineStyle: { width: 2, type: "dashed", color: "#b7791f" },
        itemStyle: { color: "#b7791f" }, data: trend.map((t) => t.coverage_pct) },
    ],
  };
}

// How many items carried a projection each JC, against how many actually sold.
function jcItemsOption(trend) {
  return {
    ...ANIM, grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10,
      textStyle: { color: "#414d55", fontSize: 11 } },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const t = trend[ps[0].dataIndex] || {};
        if (!t.done) {
          return `<b>${t.label}</b><br/>Items with a projection: <b>${fmt.num(t.items_projected)}</b>` +
            `<br/><span style="color:#90a1ac">planning cycle — not dispatched yet</span>`;
        }
        const pct = t.items_sold ? Math.round((t.items_projected / t.items_sold) * 100) : null;
        return `<b>${t.label}</b><br/>Items with a projection: <b>${fmt.num(t.items_projected)}</b>` +
          `<br/>Items that sold: <b>${fmt.num(t.items_sold)}</b>` +
          (pct == null ? "" : `<br/><span style="color:#90a1ac">${pct}% of selling items projected</span>`);
      } },
    xAxis: { type: "category", data: trend.map((t) => t.label), axisTick: { show: false },
      axisLabel: { color: "#414d55", fontSize: 11 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
    series: [
      { name: "Items projected", type: "bar", barWidth: "48%",
        data: trend.map((t) => ({ value: t.items_projected,
          itemStyle: { borderRadius: [5, 5, 0, 0], color: t.done ? "#805ad5" : "#cdbdf0" } })) },
      { name: "Items sold", type: "line", smooth: true, symbol: "circle", symbolSize: 7,
        lineStyle: { width: 3, color: "#90a1ac" }, itemStyle: { color: "#90a1ac" },
        data: trend.map((t) => t.items_sold) },
    ],
  };
}


// Unprojected selling items, biggest first — the action list.
function missingOption(rows, total, color = "#c53030", byProj = false) {
  const rev = [...rows].reverse();
  return {
    ...ANIM, grid: { left: 8, right: 26, top: 12, bottom: 8, containLabel: true },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const m = rev[ps[0].dataIndex] || {};
        const share = total ? ((m.avg3 / total) * 100).toFixed(1) : null;
        return `<b>${m.name}</b>` + (m.code ? `<br/><span style="color:#90a1ac;font-size:11px">${m.code}</span>` : "") +
          `<br/><b>${fmt.num(m.avg3)}</b> KG ${byProj ? "projected / JC" : "avg / JC sold"}` +
          (share ? `<br/><span style="color:${color}">${share}% of this group</span>` : "") +
          (byProj ? "" : `<br/><span style="color:#90a1ac">projection ${fmt.num(m.proj || 0)} KG</span>`);
      } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true },
      axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: rev.map((m) => m.name),
      axisLabel: { color: "#414d55", fontSize: 11, width: 190, overflow: "truncate", hideOverlap: true },
      axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", barWidth: "58%",
      itemStyle: { borderRadius: [0, 6, 6, 0], color: grad(color + "66", color) },
      data: rev.map((m) => m.avg3) }],
  };
}

// The cycle-by-cycle numbers behind every "by JC" view — shown both as the
// detail under the accuracy gauge and as the table of the JC-trend card.
// The cycle-by-cycle numbers behind every "by JC" view. The columns follow the
// metric being looked at — showing all of them under every filter made the
// filter look broken, since three different questions got one identical table.
// `cell` formats for the screen, `val` hands the sorter the raw number behind it
// (sorting "1,20,000" as text would order it next to "12").
const JC_COLUMNS = {
  qty: [
    { head: "Projected (KG)", key: "proj", num: true, strong: true,
      cell: (t) => fmt.num(t.proj), val: (t) => t.proj },
    { head: "Actual sales (KG)", key: "actual", num: true,
      cell: (t) => (t.actual == null ? null : fmt.num(t.actual)), val: (t) => t.actual },
    { head: "Variance (KG)", key: "variance", num: true,
      cell: (t) => (t.actual == null ? null : fmt.num(t.proj - t.actual)),
      val: (t) => (t.actual == null ? null : t.proj - t.actual),
      color: (t) => (t.actual == null ? undefined : t.proj > t.actual ? "#b7791f" : "#3182ce") },
  ],
  accuracy: [
    { head: "Accuracy (projected items)", key: "accuracy_proj", num: true, strong: true,
      cell: (t) => (t.accuracy_proj == null ? null : `${t.accuracy_proj}%`), val: (t) => t.accuracy_proj,
      color: (t) => (t.accuracy_proj == null ? undefined : accColor(t.accuracy_proj)) },
    { head: "Accuracy (all items)", key: "accuracy", num: true, muted: true,
      cell: (t) => (t.accuracy == null ? null : `${t.accuracy}%`), val: (t) => t.accuracy },
    { head: "Volume projected", key: "coverage_pct", num: true,
      cell: (t) => (t.coverage_pct == null ? null : `${t.coverage_pct}%`), val: (t) => t.coverage_pct },
  ],
  items: [
    { head: "Items projected", key: "items_projected", num: true, strong: true,
      cell: (t) => fmt.num(t.items_projected), val: (t) => t.items_projected },
    { head: "Items sold", key: "items_sold", num: true,
      cell: (t) => (t.items_sold == null ? null : fmt.num(t.items_sold)), val: (t) => t.items_sold },
    { head: "Selling items projected", key: "items_ratio", num: true,
      cell: (t) => (t.items_sold ? `${Math.round((t.items_projected / t.items_sold) * 100)}%` : null),
      val: (t) => (t.items_sold ? t.items_projected / t.items_sold : null) },
  ],
};

function JcTrendTable({ p, metric = "accuracy" }) {
  const rows = p.jc_trend || [];
  const cols = JC_COLUMNS[metric] || JC_COLUMNS.accuracy;
  const done = rows.filter((t) => t.done);
  // cycles start in their own chronological order; a click re-ranks them
  const get = useMemo(() => {
    const g = { jc: (t) => t.jc ?? t.label };
    cols.forEach((c) => { g[c.key] = c.val; });
    return g;
  }, [cols]);
  const s = useSort(rows, { key: null, dir: "desc" }, get);
  const foot = metric === "qty"
    ? ["Total", fmt.num(rows.reduce((a, t) => a + (t.proj || 0), 0)),
       fmt.num(done.reduce((a, t) => a + (t.actual || 0), 0)), ""]
    : metric === "accuracy"
      ? [`Hindsight · average of the last ${(p.accuracy_jcs || []).length} cycles`,
         p.overall_accuracy_proj == null ? "—" : `${p.overall_accuracy_proj}%`,
         p.overall_accuracy == null ? "—" : `${p.overall_accuracy}%`, `${p.coverage_pct}%`]
      : null;

  return (
    <div className="tbl-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <SortTh label="Job cycle" k="jc" dir0="asc" {...s.th}
              style={{ ...HCELL, textAlign: "left" }} />
            <th style={{ ...HCELL, textAlign: "left" }}>Period</th>
            {cols.map((c) => (
              <SortTh key={c.head} label={c.head} k={c.key} {...s.th}
                style={{ ...HCELL, textAlign: c.num ? "right" : "left" }} />
            ))}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((t, i) => (
            <tr key={i}>
              <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>
                {t.label}{!t.done && <span style={{ fontSize: 10.5, color: "var(--muted)",
                  fontWeight: 400 }}> · planning</span>}
              </td>
              <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {t.from ? `${t.from} → ${t.to}` : "—"}
              </td>
              {cols.map((c) => {
                const v = c.cell(t);
                return (
                  <td key={c.head} style={{
                    ...CELL, textAlign: c.num ? "right" : "left",
                    fontWeight: c.strong && v != null ? 600 : 400,
                    color: v == null ? "var(--muted)" : (c.color && c.color(t)) || (c.muted ? "var(--muted)" : undefined),
                  }}>
                    {v == null ? (t.done ? "—" : "not dispatched yet") : v}
                  </td>
                );
              })}
            </tr>
          ))}
          {foot && (
            <tr>
              {foot.map((v, i) => (
                <td key={i} colSpan={i === 0 ? 2 : 1}
                  style={{ ...CELL, background: "#f7fafc", fontWeight: 700,
                    textAlign: i === 0 ? "left" : "right",
                    color: i === 1 && metric === "accuracy" ? accColor(p.overall_accuracy_proj) : undefined }}>
                  {v}
                </td>
              ))}
            </tr>
          )}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length + 2} style={CELL}>No completed cycles yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Small Excel download, pinned to a card's top-right corner. Sits outside the
// header so it never disturbs the title/toggle layout, and stopPropagation keeps
// a click from starting a card drag.
function ExportBtn({ section, idParams, fn, label = "Download this table as Excel" }) {
  const call = fn || api.myDashboardExport;
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn secondary dash-export" title={label}
      disabled={busy} aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await call({ ...idParams, section }); } catch { /* surfaced by the browser */ }
        setBusy(false);
      }}>
      <Download size={14} />
    </button>
  );
}

export default function Dashboard({ session, isAdmin }) {
  const u = session?.user || {};

  // admin "View as" switcher — preview any persona / mapped user's dashboard
  const [viewAs, setViewAs] = useState({ persona: "", username: "" });
  const personas = useAsync(() => (isAdmin ? api.myDashboardPersonas() : Promise.resolve(null)), []);
  const plist = personas.data?.personas || [];
  const pickPersona = (e) => {
    const p = e.target.value;
    const first = plist.find((x) => x.persona === p)?.users?.[0]?.username || "";
    setViewAs({ persona: p, username: p ? first : "" });
  };
  const pickUser = (e) => setViewAs((v) => ({ ...v, username: e.target.value }));

  const { data, loading, error } = useAsync(
    () => api.myDashboard(viewAs.username
      ? { username: viewAs.username, persona: viewAs.persona }
      : { username: u.username || u.user_code || "", email: u.email || "", admin: isAdmin ? 1 : 0 }),
    [viewAs.username, viewAs.persona]
  );

  const [metric, setMetric] = useState("qty");           // qty (KG) | value (₹)
  const [shape, setShape] = useState({ coll: "bar" });
  const setSh = (k) => (v) => setShape((s) => ({ ...s, [k]: v }));
  const [sel, setSel] = useState({ collector: null });   // cross-filter
  const toggle = (k) => (name) => setSel((s) => ({ ...s, [k]: s[k] === name ? null : name }));
  useEffect(() => { setSel({ collector: null }); }, [viewAs.username, viewAs.persona]);

  const viewUsers = plist.find((x) => x.persona === viewAs.persona)?.users || [];
  const switcher = isAdmin && plist.length > 0 && (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
      padding: "10px 16px", marginBottom: 14, background: viewAs.username ? "#FFF9EF" : undefined }}>
      <b style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}><Eye size={15} /> View as</b>
      <SelectBox className="searchbox" style={{ maxWidth: 250 }} value={viewAs.persona} onChange={pickPersona}>
        <option value="">Myself (Admin — all data)</option>
        {plist.map((p) => (
          <option key={p.persona} value={p.persona}>{p.persona} ({p.users.length} users)</option>
        ))}
      </SelectBox>
      {viewAs.persona && (
        <SelectBox className="searchbox" style={{ maxWidth: 280 }} value={viewAs.username} onChange={pickUser}>
          {viewUsers.map((us) => (
            <option key={us.username} value={us.username}>{us.user_name} — {us.username}</option>
          ))}
        </SelectBox>
      )}
      {viewAs.username && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          previewing this user’s dashboard — exactly what they see
        </span>
      )}
    </div>
  );

  const cube = data?.cube || [];
  const unit = metric === "qty" ? "KG" : "₹";

  // each dist chart respects only the OTHER cross-filter's selection
  // (Power BI behaviour: its own selection just highlights).
  const byColl = useMemo(() => {
    const m = {};
    cube.forEach((r) => { m[r.collector] = (m[r.collector] || 0) + r[metric]; });
    return Object.entries(m).map(([name, v]) => ({ name, value: Math.round(v) }))
      .filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  }, [cube, metric]);


  const collEvents = useMemo(() => ({ click: (p) => { if (p.name) toggle("collector")(p.name); } }), []);


  const collOpt = useMemo(() => distOption(byColl, { shape: shape.coll, unit, center: unit, selected: sel.collector }),
    [byColl, shape.coll, unit, sel.collector]);


  // ── projection accuracy (plan-table projection vs scoped 3-JC avg sales) ──
  const p = data?.projection;
  const pipeOpt = useMemo(() => pipeOption(p?.pipeline || []), [p]);

  // click-to-drill: which item's JC graph is open, and the identity the popup
  // fetch must use (respects the admin View-as impersonation)
  const [itemPop, setItemPop] = useState(null);
  const [dlAll, setDlAll] = useState(false);   // whole-workbook download in flight

  // pipeline detail table (row per product) with a chart/table toggle + search
  const [pipeView, setPipeView] = useState("chart");
  const [pipeQ, setPipeQ] = useState("");
  useEffect(() => {
    setPipeView("chart"); setPipeQ(""); setItemPop(null);
    setStatusFlag(null); setStatusView("chart"); setStatusQ("");
    setProjMetric("accuracy"); setCommQ(""); setGapPick(null);
    setJcMetric("qty"); setJcView("chart");
  }, [viewAs.username, viewAs.persona]);

  // Personal arrangements are per LOGGED-IN USER (and per browser, since they
  // live in localStorage) — two people sharing a machine keep their own.
  const layoutKey = `mydash_layout_v1:${u.user_code || u.username || "anon"}`;
  // both layers in one call: the app-level default + this user's own arrangement
  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("mydash", me), [me]);
  // Purchase prices are not part of the sales permission model, so this is gated
  // server-side: everyone outside Division Head / Business Head / Admin gets
  // allowed:false and the card is never rendered.
  const rm = useAsync(() => api.myDashboardRmImpact(idParams),
    [viewAs.username, viewAs.persona]);
  const rmData = rm.data && rm.data.allowed ? rm.data : null;
  const rmSort = useSort(rmData?.fgs, { key: null, dir: "desc" }, RM_SORT_GET);
  const [rmView, setRmView] = useState("chart");
  useEffect(() => { setRmView("chart"); }, [viewAs.username, viewAs.persona]);

  const idParams = useMemo(() => (viewAs.username
    ? { username: viewAs.username, persona: viewAs.persona }
    : { username: u.username || u.user_code || "", email: u.email || "", admin: isAdmin ? 1 : 0 }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [viewAs.username, viewAs.persona, isAdmin]);
  const pipeRows = useMemo(() => {
    const src = p?.pipeline_rows || [];
    const q = pipeQ.trim().toLowerCase();
    if (!q) return src;
    return src.filter((r) => (r.name || "").toLowerCase().includes(q) ||
      (r.code || "").toLowerCase().includes(q));
  }, [p, pipeQ]);
  const statusRows = useMemo(() => (p?.summary || []).map((s) => ({
    name: FLAGS[s.flag]?.label || s.flag, value: s.items, color: FLAGS[s.flag]?.color })), [p]);
  // the commercial table: annual plan against what is actually committed
  const comm = data?.commercial || null;
  const [commQ, setCommQ] = useState("");
  const [gapPick, setGapPick] = useState(null);
  const commAll = useMemo(() => (comm?.rows || []), [comm]);
  const commRows = useMemo(() => {
    const q = commQ.trim().toLowerCase();
    if (!q) return commAll;
    return commAll.filter((r) => (r.item || "").toLowerCase().includes(q)
      || (r.customer || "").toLowerCase().includes(q)
      || (r.seg || "").toLowerCase().includes(q));
  }, [commAll, commQ]);
  const cm = useSort(commRows, { key: null, dir: "desc" },
    (r, k) => (["item", "customer", "seg"].includes(k) ? (r[k] || "") : r[k]));

  // Which figure the projection card shows: the plan-vs-dispatch KPIs, or the
  // items with no projection at all. The card is a table either way.
  const [projMetric, setProjMetric] = useState("accuracy");
  // the Projection-by-JC card keeps its own metric and chart/table switch
  const [jcMetric, setJcMetric] = useState("qty");
  const [jcView, setJcView] = useState("chart");
  // Projection status is donut-only — no shape switch on this card.
  const statusOpt = useMemo(() => distOption(statusRows, { shape: "donut", unit: "items", center: "items" }),
    [statusRows]);
  // The accuracy headline is a FORWARD check: the plan in front of us against
  // how we have actually been selling. Which plan depends on where we are in the
  // cycle — inside its last week the current one is spent, so the next is scored.
  const fwd = p?.forward || null;
  // the cycles the per-JC table's own average covers
  const histWindow = useMemo(() => {
    const j = p?.accuracy_jcs || [];
    if (!j.length) return "";
    return j.length === 1 ? j[0] : `${j[0]}–${j[j.length - 1]}`;
  }, [p]);
  const lastDoneJc = useMemo(() => {
    const done = (p?.jc_trend || []).filter((t) => t.done);
    return done.length ? done[done.length - 1].jc : "—";
  }, [p]);
  const jcQtyOpt = useMemo(() => jcQtyOption(p?.jc_trend || []), [p]);
  const jcAccOpt = useMemo(() => jcAccOption(p?.jc_trend || []), [p]);
  const jcItemsOpt = useMemo(() => jcItemsOption(p?.jc_trend || []), [p]);

  // Items selling with no projection at all — the submission gaps, item by item.
  const [missQ, setMissQ] = useState("");
  const missingAll = useMemo(() => (p?.missing_all || []), [p]);
  const missingRows = useMemo(() => {
    const q = missQ.trim().toLowerCase();
    if (!q) return missingAll;
    return missingAll.filter((m) => (m.name || "").toLowerCase().includes(q)
      || (m.code || "").toLowerCase().includes(q)
      || (m.seg || "").toLowerCase().includes(q));
  }, [missingAll, missQ]);
  const miss = useSort(missingRows, { key: null, dir: "desc" },
    (r, k) => (k === "name" || k === "code" || k === "seg" ? (r[k] || "") : r[k]));

  // Projection status drills down: click a slice to see the items behind it.
  const [statusFlag, setStatusFlag] = useState(null);
  const [statusView, setStatusView] = useState("chart");
  const [statusQ, setStatusQ] = useState("");
  const statusEvents = useMemo(() => ({
    click: (e) => {
      const flag = Object.keys(FLAGS).find((f) => FLAGS[f].label === e.name);
      if (flag) { setStatusFlag(flag); setStatusView("chart"); setStatusQ(""); }
    },
  }), []);
  const flagItems = useMemo(
    () => (statusFlag ? (p?.items_by_flag?.[statusFlag] || []) : []), [p, statusFlag]);
  const flagRows = useMemo(() => {
    const q = statusQ.trim().toLowerCase();
    const src = flagItems.map((m, i) => ({ ...m, rank: i + 1 }));
    if (!q) return src;
    return src.filter((m) => (m.name || "").toLowerCase().includes(q) ||
      (m.code || "").toLowerCase().includes(q));
  }, [flagItems, statusQ]);
  // # keeps the original ranking even after another column is sorted on
  const flg = useSort(flagRows, { key: null, dir: "desc" });
  const flagOpt = useMemo(() => {
    // rank by what the status is about: sales for the ones that sell, projected
    // volume for items that were projected but have not sold
    const byProj = statusFlag === "new";
    const top = flagItems.slice(0, 15).map((m) => ({ ...m, avg3: byProj ? m.proj : m.avg3 }));
    const total = top.reduce((a, m) => a + (m.avg3 || 0), 0);
    return missingOption(top, total, (FLAGS[statusFlag] || FLAGS.none).color, byProj);
  }, [flagItems, statusFlag]);

  // A card showing its TABLE takes the full row, sized to the rows it actually
  // has. One grid unit is 30px plus a 14px gutter, so h units == 44h - 14 px.
  // Long tables stop growing at MAX_ROWS and scroll inside the card instead.
  const MAX_ROWS = 12;
  const fitRows = (rows, toolbar = false) => {
    const px = 76                       // card header (title + sub + toggles + its gap)
      + (toolbar ? 46 : 0)              // search / segment bar, when present
      + 38                              // table header
      + Math.min(rows, MAX_ROWS) * 37   // body rows
      + 42;                             // card padding + breathing room
    return Math.max(5, Math.ceil((px + 14) / 44));
  };
  const expandedCards = useMemo(() => {
    const out = {};
    // projCanvas and commercial are NOT listed here on purpose: their body is
    // always a table, so they take a default height and the user resizes them.
    // DashGrid discards a resize of an expanded card, so listing them would
    // silently undo every drag of the bottom edge.
    if (pipeView === "table") out.compare = fitRows(pipeRows.length, true);
    if (jcView === "table") out.jcTrend = fitRows((p?.jc_trend?.length || 0) + 1);
    // only the drill-down has a table view now; the card itself is always the donut
    if (statusView === "table" && statusFlag) out.status = fitRows(flagRows.length, true);
    if (rmView === "table" && rmData) out.rmImpact = fitRows(rmData.fgs.length) + 3;  // + the KPI strip
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeView, jcView, statusView, statusFlag, flagRows.length,
      p, pipeRows.length, rmView, rmData]);

  if (loading && !data) return <Loading what="your dashboard" />;
  if (error) return <>{switcher}<ErrorBox msg={error} /></>;

  const k = data.kpis;
  if (!data.persona || !k) {
    const who = viewAs.username || u.username || "";
    return (
      <>
        {switcher}
        <div className="banner warn">
          No data scope is mapped to {viewAs.username ? "this account" : "your account"}
          {who ? ` (${who})` : ""}. The CRM role-to-data mapping (market circle / collector /
          customer / segment) hasn’t been set up{viewAs.username ? "." : " — please contact your administrator."}
        </div>
      </>
    );
  }

  const syncedAt = data.last_sync?.finished_at ? String(data.last_sync.finished_at).slice(0, 16) : null;

  return (
    <>
      {switcher}
      <div style={{ opacity: loading ? 0.55 : 1, pointerEvents: loading ? "none" : "auto", transition: "opacity .2s" }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 14 }}>
        <span className="chip" style={{ cursor: "default", background: "#EEF6FF", fontWeight: 600 }}>
          {data.persona}
        </span>
        {viewAs.username && data.user_name && (
          <span className="chip" style={{ cursor: "default", background: "#FFF3E8", fontWeight: 600 }}>
            {data.user_name.trim()}
          </span>
        )}
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {(data.scope || []).join(" · ") || "—"}
        </span>
        {data.scopes && (
          <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center",
            gap: 8, fontSize: 12 }}
            title={data.scopes.note}>
            <span className="chip" style={{ cursor: "default", background: "#F1F5F9" }}>
              Budget &amp; quotation scope: <b>{fmt.num(data.scopes.commercial_items)}</b> products
            </span>
            <span className="chip" style={{ cursor: "default", background: "#F1F5F9" }}>
              Dispatch scope: <b>{fmt.num(data.scopes.dispatch_items)}</b> products
            </span>
            <span style={{ color: "var(--muted)" }}>
              two different product sets — not meant to match
            </span>
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          Last 13 JCs{syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <SegTabs size="sm" value={metric} onChange={setMetric}
          tabs={[{ id: "qty", label: "KG" }, { id: "value", label: "₹ Value" }]} />
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel workbook: every chart on the first sheet, each table on its own sheet"
          disabled={dlAll}
          onClick={async () => {
            setDlAll(true);
            try { await api.myDashboardExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDlAll(false);
          }}>
          <Download size={15} /> {dlAll ? "Preparing…" : "Download dashboard"}
        </button>
      </div>

      {sel.collector && (
        <div className="pagebar" style={{ marginTop: 12, gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Filtered:</span>
          {sel.collector && (
            <button className="chip" onClick={() => setSel((s) => ({ ...s, collector: null }))}>
              {sel.collector} ✕
            </button>
          )}
        </div>
      )}

      <DashGrid storageKey={layoutKey} defaults={DASH_DEFAULTS}
        expanded={expandedCards} renames={{ jcTrend: ["jcQty", "jcAcc", "jcItems"] }}
        remoteLayouts={savedLayout.data?.layouts || null}
        userLayouts={savedLayout.data?.user_layouts || null}
        canSaveDefault={isAdmin}
        onSaveDefault={(l) => api.saveDashboardLayout("mydash", l)}
        onSaveUser={me ? (l) => api.saveDashboardLayout("mydash", l, me) : undefined}>
        {byColl.length > 1 && (
          <div key="byColl" className="card">
              <ExportBtn section="collector" idParams={idParams} />
            <div className="supply-dash-cardhead">
              <div><h3>By collector</h3>
                <div className="sub">click a {shape.coll === "bar" ? "bar" : "slice"} to cross-filter</div></div>
              <SegTabs size="sm" value={shape.coll} onChange={setSh("coll")} tabs={SHAPE_DIST} />
            </div>
            <EChart className="echart-fill" option={collOpt} height="100%" onEvents={collEvents} />
          </div>
        )}


      {p && (
        <>
          <div key="projCanvas" className="card">
              <ExportBtn section={projMetric === "accuracy" ? "forward" : "missing"} idParams={idParams} />
            <div className="supply-dash-cardhead">
              <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>{(() => { const M = PROJ_METRICS.find((m) => m.id === projMetric); const I = M?.icon; return <>{I && <I size={16} />} {M?.title}</>; })()}</h3>
                <div className="sub">
                  {projMetric === "accuracy" && (fwd
                    ? <>what <b>{fwd.label}</b> is planned to sell, against the average of{" "}
                      {(fwd.dispatch_jcs || []).join(", ")} — the last {fwd.n_cycles} completed
                      cycles</>
                    : <>the upcoming plan against the average of the last completed cycles</>)}
                  {projMetric === "volume" && <>share of your 3-JC average sales that carries a JC{p.jc} projection</>}
                  {projMetric === "items" && <>items that are selling but carry no JC{p.jc} projection
                    at all — ranked by the volume at stake</>}
                </div></div>
              <div className="card-filters">
                <SegTabs size="sm" value={projMetric} onChange={setProjMetric}
                  tabs={PROJ_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              </div>
            </div>

            {projMetric === "accuracy" ? (
              <ProjectionKpis f={fwd} onPick={setGapPick} />
            ) : (
              <>
                <div className="pagebar" style={{ marginBottom: 10 }}>
                  <SmoothInput className="searchbox" placeholder="Search item code / name / segment…"
                    value={missQ} onChange={(e) => setMissQ(e.target.value)} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                    {fmt.num(missingRows.length)} of {fmt.num(p.missing_total || 0)} items
                    {" · "}{fmt.num(p.missing_kg || 0)} KG a cycle with no projection
                  </span>
                </div>
                <div className="tbl-wrap">
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <SortTh label="Item code" k="code" dir0="asc" {...miss.th} style={GH_L} />
                        <SortTh label="Item" k="name" dir0="asc" {...miss.th} style={GH_L} />
                        <SortTh label="Segment" k="seg" dir0="asc" {...miss.th} style={GH_L} />
                        <SortTh label="3-JC avg sales (KG)" k="avg3" {...miss.th} style={GH_R} />
                        <th style={GH_R}>Share of the gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {miss.rows.map((m, i) => {
                        const share = p.missing_kg ? (m.avg3 / p.missing_kg) * 100 : null;
                        return (
                          <tr key={`${m.code || ""}|${m.name}|${i}`}>
                            <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)",
                              whiteSpace: "nowrap" }}>{m.code || "—"}</td>
                            <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{m.name}</td>
                            <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>
                              {m.seg || "—"}
                            </td>
                            <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                              {fmt.num(m.avg3)}
                            </td>
                            <td style={{ ...CELL, textAlign: "right",
                              color: share && share >= 5 ? "#c53030" : "var(--muted)",
                              fontWeight: share && share >= 5 ? 600 : 400 }}>
                              {share == null ? "—" : `${share.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                      {miss.rows.length === 0 && (
                        <tr><td colSpan={5} style={CELL}>
                          {missingAll.length ? "No items match that search."
                            : "Every selling item in your scope carries a projection."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {missingAll.length >= 500 && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "#b7791f" }}>
                    Showing the 500 biggest of {fmt.num(p.missing_total || 0)} — download for the rest.
                  </div>
                )}
              </>
            )}
          </div>
            {p.jc_trend.length > 0 && (
              <div key="jcTrend" className="card">
              <ExportBtn section="jc_trend" idParams={idParams} />
                <div className="supply-dash-cardhead">
                  <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {JC_VIEWS.find((v) => v.id === jcMetric)?.icon} {JC_VIEWS.find((v) => v.id === jcMetric)?.title}</h3>
                    <div className="sub">
                      {jcMetric === "qty" && <>projected KG per job cycle vs actual sales · {p.acc_year} · the pale bar is the planning JC{p.jc}</>}
                      {jcMetric === "accuracy" && <>100 − WMAPE per item · the last {(p.accuracy_jcs || []).length} cycles{histWindow ? ` (${histWindow})` : ""} average <b>{p.overall_accuracy_proj == null ? "—" : `${p.overall_accuracy_proj}%`}</b> on projected items</>}
                      {jcMetric === "items" && <>items carrying a projection each cycle vs items that actually sold · the pale bar is the planning JC (not dispatched yet)</>}
                    </div></div>
                  <div className="card-filters">
                    <SegTabs size="sm" value={jcMetric} onChange={setJcMetric}
                      tabs={JC_VIEWS.map((v) => ({ id: v.id, label: v.label }))} />
                    <SegTabs size="sm" value={jcView} onChange={setJcView}
                      tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
                  </div>
                </div>
                {jcView === "table" ? <JcTrendTable p={p} metric={jcMetric} /> : (
                  <EChart className="echart-fill" height="100%"
                    option={jcMetric === "qty" ? jcQtyOpt : jcMetric === "accuracy" ? jcAccOpt : jcItemsOpt} />
                )}
              </div>
            )}

            <div key="status" className="card">
              <ExportBtn section={statusFlag ? "items" : "status"} idParams={idParams} />
              <div className="supply-dash-cardhead">
                <div>
                  <h3>{statusFlag ? (FLAGS[statusFlag] || {}).label : "Projection status"}</h3>
                  <div className="sub">
                    {statusFlag
                      ? <>{fmt.num(flagItems.length)} item{flagItems.length === 1 ? "" : "s"} · {statusFlag === "new"
                          ? <>projected for JC{p.jc} but no sales in the last 3 JCs</>
                          : <>ranked by 3-JC average sales</>}</>
                      : <>items by flag · same ±20% band as the RM plan · click a slice for the items</>}
                  </div>
                </div>
                {/* the top level is a plain donut — no shape / chart-table switches.
                    The toggles belong to the drill-down, where the item list matters. */}
                {statusFlag && (
                  <div className="card-filters">
                    <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => { setStatusFlag(null); setStatusView("chart"); }}>
                      ← All statuses
                    </button>
                    <SegTabs size="sm" value={statusView} onChange={setStatusView}
                      tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
                  </div>
                )}
              </div>
              {!statusFlag ? (
                <EChart className="echart-fill" option={statusOpt} height="100%" onEvents={statusEvents} />
              ) : statusView === "chart" ? (
                <EChart className="echart-fill" option={flagOpt} height="100%" />
              ) : (
                <>
                  <div className="pagebar" style={{ marginBottom: 10 }}>
                    <SmoothInput className="searchbox" placeholder="Search item code / name…"
                      value={statusQ} onChange={(e) => setStatusQ(e.target.value)} />
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                      {flagRows.length} of {flagItems.length} items
                    </span>
                  </div>
                  <div className="tbl-wrap">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <SortTh label="#" k="rank" dir0="asc" {...flg.th}
                            style={{ ...HCELL, textAlign: "left", width: 56 }} />
                          <SortTh label="Item Code" k="code" dir0="asc" {...flg.th} style={GH_L} />
                          <SortTh label="Item Name" k="name" dir0="asc" {...flg.th} style={GH_L} />
                          <SortTh label="3-JC avg sales (KG)" k="avg3" {...flg.th} style={GH_R} />
                          <SortTh label="Projection (KG)" k="proj" {...flg.th} style={GH_R} />
                        </tr>
                      </thead>
                      <tbody>
                        {flg.rows.map((m, i) => (
                          <tr key={i} onClick={() => setItemPop({ name: m.name, code: m.code })}
                            style={{ cursor: "pointer" }} title="Click to see this item's JC-wise graph">
                            <td style={{ ...CELL, color: "var(--muted)" }}>{m.rank}</td>
                            <td style={{ ...CELL, fontSize: 12, whiteSpace: "nowrap" }}>{m.code || "—"}</td>
                            <td title={m.name} style={{ ...CELL, maxWidth: 380, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "#1f3a5f" }}>
                              {m.name}
                            </td>
                            <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(m.avg3)}</td>
                            <td style={{ ...CELL, textAlign: "right",
                              color: m.proj ? undefined : "#c53030", fontWeight: 600 }}>
                              {fmt.num(m.proj)}
                            </td>
                          </tr>
                        ))}
                        {flg.rows.length === 0 && (
                          <tr><td colSpan={5} style={CELL}>No items match the search.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>


            <div key="compare" className="card">
              <ExportBtn section="pipeline" idParams={idParams} />
              <div className="supply-dash-cardhead">
                <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Target size={16} /> Projection vs 3-JC avg sales</h3>
                  <div className="sub">
                    {pipeView === "chart"
                      ? <>projected KG for JC{p.jc} and the two cycles after it · {p.basis === "collector" ? "your collectors"
                        : p.basis === "customer" ? "your own customers"
                        : "per item, company-wide"}</>
                      : <>each item's 3-JC average sales against its projection for the next three cycles · ±20% band · <b>{p.coverage_pct}%</b> of your sales volume has a projection</>}
                  </div></div>
                <SegTabs size="sm" value={pipeView} onChange={setPipeView}
                  tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
              </div>
              {pipeView === "chart" ? (
                <EChart className="echart-fill" option={pipeOpt} height="100%" />
              ) : (
                <>
                  <div className="pagebar" style={{ marginBottom: 10 }}>
                    <SmoothInput className="searchbox" placeholder="Search item code / name…"
                      value={pipeQ} onChange={(e) => setPipeQ(e.target.value)} />
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                      {pipeRows.length} of {(p.pipeline_rows || []).length} products
                      {(p.pipeline_rows || []).length >= 200 ? " (top 200 by sales or projection)" : ""}
                    </span>
                  </div>
                  <ProjCompareTable rows={pipeRows} jc={p.jc}
                    onItem={(r) => setItemPop({ name: r.name, code: r.code })} />
                </>
              )}
            </div>


        </>
      )}

        {rmData && (
          <div key="rmImpact" className="card">
            <ExportBtn idParams={idParams} fn={api.myDashboardRmExport}
              label="Download every impacted product and the raw materials behind them" />
            <div className="supply-dash-cardhead">
              <div>
                <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Factory size={16} /> RM price impact on FG
                </h3>
              </div>
              <div className="card-filters">
                <SegTabs size="sm" value={rmView} onChange={setRmView}
                  tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
              gap: 8, marginBottom: 12 }}>
              {[
                ["FG products impacted", fmt.num(rmData.kpis.fgs_impacted), "#1f3a5f",
                  `${fmt.num(rmData.kpis.with_cost)} carry a unit cost, so the rest show the rupee increase only`],
                ["Avg FG cost impact", rmData.kpis.avg_impact_pct == null ? "—"
                  : `+${rmData.kpis.avg_impact_pct}%`, "#b7791f",
                  "weighted by dispatch volume, not a plain average"],
                ["Cost exposure / cycle", abbr(rmData.kpis.exposure_per_cycle), "#c53030",
                  "added material cost on the recent 3-cycle dispatch run rate"],
                ["Margin erosion", rmData.kpis.margin_erosion_pts == null ? "—"
                  : `${rmData.kpis.margin_erosion_pts} pts`, "#c53030",
                  `against ${abbr(rmData.kpis.revenue_per_cycle)} of revenue per cycle on those products`],
              ].map(([label, value, color, hint]) => (
                <div key={label} title={hint}
                  style={{ padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color,
                    fontVariantNumeric: "tabular-nums" }}>{value}</div>
                </div>
              ))}
            </div>

            {rmData.kpis.fgs_impacted === 0 ? (
              <div style={{ padding: "26px 16px", textAlign: "center", color: "#2f855a" }}>
                <CircleCheck size={26} strokeWidth={1.8} />
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>
                  No raw-material rise reaches your products
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                  Nothing that went up in the last {rmData.window_days} days appears in a BOM
                  for anything in your scope.
                </div>
              </div>
            ) : rmView === "chart" ? (
              <EChart className="echart-fill" height="100%"
                option={rmBarOption(rmData.fgs, TT, ANIM)} />
            ) : (
              <div className="tbl-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <SortTh label="Finished good" k="item" dir0="asc" {...rmSort.th} style={GH_L} />
                      <SortTh label="Segment" k="segment" dir0="asc" {...rmSort.th} style={GH_L} />
                      <SortTh label="Impact %" k="impact_pct" {...rmSort.th} style={GH_R}
                        title="Extra material cost as a share of the product's own unit cost · click to sort" />
                    </tr>
                  </thead>
                  <tbody>
                    {rmSort.rows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{r.item}</td>
                        <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>
                          {r.segment3 || r.segment2 || "—"}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                          color: r.impact_pct == null ? "var(--muted)"
                            : r.impact_pct > 5 ? "#c53030" : r.impact_pct > 3 ? "#b7791f" : "#3182ce" }}>
                          {r.impact_pct == null ? "—" : `+${r.impact_pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rmData.total_fgs > rmData.fgs.length && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
                Showing the {fmt.num(rmData.fgs.length)} most impacted of {fmt.num(rmData.total_fgs)}.
              </div>
            )}
          </div>
        )}

        {/* The "Annual plan vs live demand" card is hidden at the user's request.
            Its data still ships in the payload (data.commercial), still feeds the
            Budget & quotation scope chip, and still exports as its own sheet — so
            re-showing it is putting this block back, nothing more. */}
      </DashGrid>
      </div>

      <GapDrill part={gapPick} cycle={p?.forward?.label || ""}
        cycles={(p?.forward?.dispatch_jcs || []).join("/")}
        onClose={() => setGapPick(null)} />
      <ItemGraphModal target={itemPop} idParams={idParams} onClose={() => setItemPop(null)} />
    </>
  );
}
