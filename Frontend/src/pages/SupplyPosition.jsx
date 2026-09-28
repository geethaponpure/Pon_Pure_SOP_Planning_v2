import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import EChart from "../components/EChart.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import SegTabs from "../components/SegTabs.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { ArrowRight, Boxes, CircleAlert, Download, FileCheck2, Hourglass,
  Layers, PartyPopper, ShieldAlert, ShieldCheck, TriangleAlert,
  Users } from "lucide-react";

// My Supply Position — a headline strip over the customer x item action list.
// Clicking a line opens the "why is my item at risk" drill-down: the full
// derivation from projection down to the promised date, ending in the action.
// No draggable cards here; this is a fixed dashboard meant to be read top down.

// DashGrid slot geometry — the arrangement everyone starts from. Users drag and
// resize from here and can save their own; an admin can save a new app default.
// (the headline strip and the action list render outside the grid — they are
//  fixed, not movable/resizable; only the cards below are arrangeable)
// The three chart cards (exposure / supply / competing) are parked for now:
// flip this to true to bring the whole grid back, nothing else was removed.
const SHOW_CHART_CARDS = false;
const DASH_DEFAULTS = {
  exposure: { x: 0, y: 0, w: 6, h: 11 },
  supply: { x: 6, y: 0, w: 6, h: 11 },
  competing: { x: 0, y: 11, w: 12, h: 10 },
};

const CELL = { border: "1px solid var(--border)", padding: "7px 9px", verticalAlign: "middle" };
const HCELL = { ...CELL, background: "#f7fafc", fontSize: 12, color: "#414d55",
  fontWeight: 600, whiteSpace: "nowrap" };

const RISK = {
  critical: { dot: "🔴", label: "Critical", color: "#c53030",
    hint: "No supply left and nothing planned or in transit to close the gap" },
  watch: { dot: "🟡", label: "At risk", color: "#b7791f",
    hint: "Supply can close the gap, but it is short today or arrives late" },
  safe: { dot: "🟢", label: "Safe", color: "#2f855a",
    hint: "Covered by your own orders, or supply is available in time" },
};

// The headline decomposes the projection completely: protected + at risk +
// critical add back to it, so the five tiles read left to right as one sentence.
const TILES = [
  { id: "projection", label: "Projection", sub: "Total demand", color: "#1f3a5f" },
  { id: "soc", label: "SOC", sub: "Firm demand", color: "#3182ce" },
  { id: "protected", label: "Protected", sub: "Covered qty", color: "#2f855a" },
  { id: "at_risk", label: "At Risk", sub: "Exposure", color: "#b7791f" },
  { id: "critical", label: "Critical", sub: "Shortage", color: "#c53030" },
];

const abbr = (v) => {
  const n = Math.abs(v || 0);
  if (n >= 1e7) return ((v || 0) / 1e7).toFixed(n >= 1e8 ? 0 : 1) + "Cr";
  if (n >= 1e5) return ((v || 0) / 1e5).toFixed(n >= 1e6 ? 0 : 1) + "L";
  if (n >= 1e3) return ((v || 0) / 1e3).toFixed(0) + "K";
  return fmt.num(v || 0);
};

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const PCT_COLOR = (v) => (v == null ? "var(--muted)" : v >= 70 ? "#2f855a" : v >= 40 ? "#b7791f" : "#c53030");

// Where the exposure sits — the same ledger the action list is built from,
// rolled up by collector, by item, or by the customers nothing has been raised for.
const EXPOSURE_METRICS = [
  { id: "collectors", label: "By collector", icon: Users,
    title: "Unprotected projection by collector",
    sub: "where the exposure sits — a low protected % means demand was projected but never converted" },
  { id: "items", label: "By item", icon: FileCheck2,
    title: "Unprotected projection by item",
    sub: "the products carrying the most projected-but-unconverted volume this cycle" },
  { id: "silent", label: "Nothing raised", icon: ShieldAlert,
    title: "Nothing raised yet",
    sub: "projection lines with no order and nothing shipped — still entirely on paper" },
];

function rankOption(rows, { labelKey, valueKey = "unprotected", color }) {
  const top = rows.slice(0, 14).slice().reverse();
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r[labelKey] || "—"}</b><br/>`
          + `projected <b>${fmt.num(r.projected)}</b> KG<br/>`
          + `protected <b>${fmt.num(r.protected)}</b> KG${r.pct == null ? "" : ` · ${r.pct}%`}<br/>`
          + `<span style="color:#c53030">unprotected <b>${fmt.num(r.unprotected)}</b> KG</span>`;
      } },
    grid: { left: 8, right: 46, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => String(r[labelKey] || "—")),
      axisLabel: { color: "#414d55", fontSize: 11, width: 150, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18, itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => abbr(o.value) },
      data: top.map((r) => Math.round(r[valueKey] || 0)),
    }],
  };
}

function CoverBar({ pct }) {
  const v = Math.max(0, Math.min(100, pct == null ? 0 : pct));
  return (
    <div title={`${pct == null ? "—" : pct + "%"} protected`}
      style={{ height: 7, background: "#edf2f7", borderRadius: 4, overflow: "hidden", minWidth: 44 }}>
      <div style={{ width: `${v}%`, height: "100%", background: PCT_COLOR(pct), borderRadius: 4 }} />
    </div>
  );
}

function GroupTable({ rows, label, title, extraCol }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => String(r[label] || "").toLowerCase().includes(t));
  }, [rows, q, label]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 240 }} value={q} onChange={setQ}
          placeholder={`Search ${title.toLowerCase()}…`} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} {title.toLowerCase()}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>{title}</th>
              {extraCol && <th style={{ ...HCELL, textAlign: "left" }}>{extraCol.head}</th>}
              <th style={{ ...HCELL, textAlign: "right" }}>Projected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Protected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Unprotected</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Protected</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Lines with no order and nothing shipped">Silent</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }} title={r[label]}>{r[label] || "—"}</td>
                {extraCol && <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>{extraCol.get(r) || "—"}</td>}
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.projected)}</td>
                <td style={{ ...CELL, textAlign: "right", color: "#2f855a" }}>{fmt.num(r.protected)}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: "#c53030" }}>{fmt.num(r.unprotected)}</td>
                <td style={{ ...CELL }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <CoverBar pct={r.pct} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: PCT_COLOR(r.pct), minWidth: 32 }}>
                      {r.pct == null ? "—" : `${r.pct}%`}
                    </span>
                  </div>
                </td>
                <td style={{ ...CELL, textAlign: "right", fontSize: 11.5, color: "var(--muted)" }}>
                  {fmt.num(r.silent_lines)} / {fmt.num(r.lines)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={extraCol ? 7 : 6} style={CELL}>Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SilentTable({ rows, onPick }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.item} ${r.customer} ${r.collector || ""}`
      .toLowerCase().includes(t));
  }, [rows, q]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 240 }} value={q} onChange={setQ}
          placeholder="Search item or customer…" />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} lines · click one to see why
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Projected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Unprotected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>ATP</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Collector</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rk = RISK[r.risk] || RISK.safe;
              return (
                <tr key={r.key} onClick={() => onPick(r)} style={{ cursor: "pointer" }}
                  title="Show why this line is at risk">
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{r.item}</td>
                  <td style={{ ...CELL }}>{r.customer}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.projection)}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: "#c53030" }}>{fmt.num(r.unprotected)}</td>
                  <td style={{ ...CELL, textAlign: "right", color: r.atp < 0 ? "#c53030" : "#2f855a" }}>{fmt.num(r.atp)}</td>
                  <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>{r.collector || "—"}</td>
                  <td style={{ ...CELL }} title={rk.hint}>
                    <span style={{ color: rk.color, fontWeight: 600, fontSize: 11.5 }}>{rk.dot} {rk.label}</span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={7} style={CELL}>No lines match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExposureCard({ data, rows, idParams, onPick, metric, setMetric, view, setView }) {
  const [busy, setBusy] = useState(false);
  const M = EXPOSURE_METRICS.find((x) => x.id === metric) || EXPOSURE_METRICS[0];
  const Icon = M.icon;
  const silent = useMemo(() => rows.filter((r) => r.silent), [rows]);
  const collOpt = useMemo(() => rankOption(data.by_collector || [],
    { labelKey: "collector", color: "#c53030" }), [data]);
  const itemOpt = useMemo(() => rankOption(data.by_item || [],
    { labelKey: "item", color: "#b7791f" }), [data]);
  const custOpt = useMemo(() => rankOption(
    (data.by_customer || []).filter((c) => c.silent_lines > 0),
    { labelKey: "customer", color: "#805ad5" }), [data]);
  const list = metric === "collectors" ? (data.by_collector || [])
    : metric === "items" ? (data.by_item || []) : silent;

  return (
    <div className="card">
      <button type="button" className="btn secondary dash-export"
        title="Download this table as Excel" aria-label="Download this table as Excel"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await api.supplyPositionExport({ ...idParams, section: metric }); } catch { /* surfaced by the browser */ }
          setBusy(false);
        }}>
        <Download size={14} />
      </button>
      <div className="supply-dash-cardhead">
        <div>
          <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon size={16} /> {M.title}
          </h3>
          <div className="sub">{M.sub}</div>
        </div>
        <div className="card-filters">
          <SegTabs size="sm" value={metric} onChange={setMetric}
            tabs={EXPOSURE_METRICS.map((x) => ({ id: x.id, label: x.label }))} />
          <SegTabs size="sm" value={view} onChange={setView}
            tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
        </div>
      </div>
      {list.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", color: "#2f855a" }}>
          <ShieldCheck size={26} strokeWidth={1.8} />
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>Nothing unprotected</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Every projected line here is already covered by an order.
          </div>
        </div>
      ) : view === "chart" ? (
        <EChart className="echart-fill" height="100%"
          option={metric === "collectors" ? collOpt : metric === "items" ? itemOpt : custOpt} />
      ) : metric === "collectors" ? (
        <GroupTable rows={data.by_collector} label="collector" title="Collector" />
      ) : metric === "items" ? (
        <GroupTable rows={data.by_item} label="item" title="Item"
          extraCol={{ head: "Segment", get: (r) => r.segment3 }} />
      ) : (
        <SilentTable rows={silent} onPick={onPick} />
      )}
    </div>
  );
}

const SUPPLY_METRICS = [
  { id: "supply", label: "Supply vs claims", icon: Layers,
    title: "What the supply is up against",
    sub: "on hand against every claim on it, for the items you are most exposed on" },
  { id: "runout", label: "Days to risk", icon: Hourglass,
    title: "When the stock runs out",
    sub: "the date committed orders across the company exhaust what is on hand — "
      + "\"today\" means the overdue book already consumes it" },
];
const COMPETING_METRICS = [
  { id: "collector", label: "By collector", icon: Users,
    title: "Competing demand by collector",
    sub: "firm orders on your exposed items held by customers outside your book" },
  { id: "mc", label: "By market circle", icon: Boxes,
    title: "Competing demand by market circle",
    sub: "the same competing demand, grouped by market circle" },
];
const SOURCE_MIX = {
  production: { label: "Production job", color: "#3182ce" },
  inbound: { label: "Inbound purchase (estimated)", color: "#805ad5" },
  stock: { label: "Stock on hand only", color: "#2f855a" },
  none: { label: "No forward supply", color: "#c53030" },
};

function supplyOption(items) {
  const top = items.filter((r) => r.exposure > 0).slice(0, 12).slice().reverse();
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
          + `<br/><span style="color:#90a1ac">left for me ${fmt.num(r.atp)} KG`
          + ` · exposed ${fmt.num(r.exposure)} KG</span>`;
      } },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    grid: { left: 8, right: 16, top: 8, bottom: 34, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => r.item),
      axisLabel: { color: "#414d55", fontSize: 11, width: 150, overflow: "truncate" },
      axisTick: { show: false } },
    series: series.map((x) => ({
      name: x.name, type: "bar", barMaxWidth: 9,
      itemStyle: { color: x.color, borderRadius: [0, 3, 3, 0] },
      data: top.map((r) => Math.round(r[x.key] || 0)),
    })),
  };
}

const runColor = (d) => (d <= 7 ? "#c53030" : d <= 30 ? "#b7791f" : "#3182ce");

// Most items run out on day 0 (overdue orders are consumed today), and a bar of
// length zero draws nothing. A dot on a day axis still marks zero clearly.
function runoutOption(items) {
  const top = items.filter((r) => r.days_to_risk != null)
    .slice()
    // soonest first; among the many that run out today, biggest exposure first
    .sort((a, b) => a.days_to_risk - b.days_to_risk || b.my_unprotected - a.my_unprotected)
    .slice(0, 14).reverse();
  const maxD = Math.max(7, ...top.map((r) => r.days_to_risk));
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r.item}</b><br/>committed orders exhaust the stock on <b>${r.risk_date}</b>`
          + `<br/>${r.days_to_risk === 0 ? "already exhausted today" : `${r.days_to_risk} days from today`}`
          + `<br/><span style="color:#90a1ac">on hand ${fmt.num(r.on_hand)} KG`
          + ` · your unprotected ${fmt.num(r.my_unprotected)} KG</span>`;
      } },
    grid: { left: 8, right: 78, top: 10, bottom: 8, containLabel: true },
    xAxis: { type: "value", min: 0, max: maxD, name: "days from today",
      nameLocation: "middle", nameGap: 26,
      nameTextStyle: { color: "#90a1ac", fontSize: 10 },
      axisLabel: { color: "#90a1ac", fontSize: 10 },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => r.item),
      axisLabel: { color: "#414d55", fontSize: 11, width: 160, overflow: "truncate" },
      axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: "#f4f7f9" } } },
    series: [
      // a faint stem so the eye can travel from the item to its dot
      { type: "bar", barWidth: 2, silent: true, z: 1,
        itemStyle: { color: "#e6ecf1" },
        data: top.map((r) => r.days_to_risk) },
      { type: "scatter", symbolSize: 13, z: 2,
        itemStyle: { color: (o) => runColor(top[o.dataIndex].days_to_risk),
          borderColor: "#fff", borderWidth: 1.5 },
        label: { show: true, position: "right", distance: 8, fontSize: 10.5,
          color: "#414d55", fontWeight: 600,
          formatter: (o) => (o.value === 0 ? "today" : `${o.value}d`) },
        data: top.map((r) => r.days_to_risk) },
    ],
  };
}

function competingOption(rows, labelKey, color) {
  const top = (rows || []).slice(0, 14).slice().reverse();
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r[labelKey] || "—"}</b><br/>committed <b>${fmt.num(r.balance)}</b> KG<br/>`
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

function Empty({ title, note, tone = "#2f855a" }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center", color: tone }}>
      <ShieldCheck size={26} strokeWidth={1.8} />
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, maxWidth: "52ch",
        margin: "4px auto 0" }}>{note}</div>
    </div>
  );
}

function CardShell({ icon: Icon, title, sub, section, idParams, tabs, metric, setMetric,
  view, setView, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <button type="button" className="btn secondary dash-export"
        title="Download this table as Excel" aria-label="Download this table as Excel"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await api.supplyPositionExport({ ...idParams, section }); } catch { /* surfaced by the browser */ }
          setBusy(false);
        }}>
        <Download size={14} />
      </button>
      <div className="supply-dash-cardhead">
        <div>
          <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon size={16} /> {title}
          </h3>
          <div className="sub">{sub}</div>
        </div>
        <div className="card-filters">
          {tabs && <SegTabs size="sm" value={metric} onChange={setMetric} tabs={tabs} />}
          <SegTabs size="sm" value={view} onChange={setView}
            tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
        </div>
      </div>
      {children}
    </div>
  );
}

function SupplyCard({ items, idParams, onPick, metric, setMetric, view, setView,
  totalItems = 0 }) {
  const M = SUPPLY_METRICS.find((x) => x.id === metric) || SUPPLY_METRICS[0];
  const supOpt = useMemo(() => supplyOption(items || []), [items]);
  const runOpt = useMemo(() => runoutOption(items || []), [items]);
  const runList = useMemo(() => (items || []).filter((r) => r.days_to_risk != null)
    .slice().sort((a, b) => a.days_to_risk - b.days_to_risk), [items]);
  const exposed = useMemo(() => (items || []).filter((r) => r.exposure > 0), [items]);

  const body = () => {
    if (metric === "supply") {
      if (!exposed.length) {
        return <Empty title="Nothing is exposed"
          note="Every item you projected has supply available after the other confirmed orders." />;
      }
      return view === "chart"
        ? <EChart className="echart-fill" height="100%" option={supOpt}
            onEvents={{ click: (e) => {
              const hit = exposed.slice(0, 12).slice().reverse()[e.dataIndex];
              if (hit) onPick(hit);
            } }} />
        : <ItemSupplyTable rows={exposed} onPick={onPick} totalItems={totalItems} />;
    }
    if (metric === "runout") {
      if (!runList.length) {
        return <Empty title="No item runs out"
          note="Committed orders stay within available supply right across the horizon." />;
      }
      return view === "chart"
        ? <EChart className="echart-fill" height="100%" option={runOpt}
            onEvents={{ click: (e) => {
              const hit = runList.slice(0, 14).slice().reverse()[e.dataIndex];
              if (hit) onPick(hit);
            } }} />
        : <ItemSupplyTable rows={runList} onPick={onPick} totalItems={totalItems} />;
    }
    return <Empty title="Nothing in scope" note="No items to date for this cycle." />;
  };

  return (
    <CardShell icon={M.icon} title={M.title} sub={M.sub} section="supply" idParams={idParams}
      tabs={SUPPLY_METRICS.map((x) => ({ id: x.id, label: x.label }))}
      metric={metric} setMetric={setMetric} view={view} setView={setView}>
      {body()}
    </CardShell>
  );
}

function ItemSupplyTable({ rows, onPick, totalItems = 0 }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.item} ${r.item_code || ""}`.toLowerCase().includes(t));
  }, [rows, q]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 240 }} value={q} onChange={setQ}
          placeholder="Search item…" />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} items · click one for its supply picture
          {totalItems > rows.length && (
            <b style={{ color: "#b7791f" }}> · search covers the {fmt.num(rows.length)} shown
              of {fmt.num(totalItems)}</b>
          )}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "right" }}>On hand</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Minimum stock level held back">Safety</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Firm orders held outside your book">Others</th>
              <th style={{ ...HCELL, textAlign: "right" }}>My unprotected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Incoming</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Runs out</th>
              <th style={{ ...HCELL, textAlign: "left" }} title="What a commit date on this item would rest on">Dated from</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} onClick={() => onPick && onPick(r)}
                style={{ cursor: onPick ? "pointer" : "default" }}
                title="Show this item's supply picture">
                <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }} title={r.item_code || ""}>{r.item}</td>
                <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.on_hand)}</td>
                <td style={{ ...CELL, textAlign: "right", color: "var(--muted)" }}>{fmt.num(r.msl)}</td>
                <td style={{ ...CELL, textAlign: "right", color: r.firm_others > 0 ? "#c53030" : "var(--muted)" }}>
                  {r.firm_others > 0 ? fmt.num(r.firm_others) : "—"}
                </td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600, color: "#b7791f" }}>{fmt.num(r.my_unprotected)}</td>
                <td style={{ ...CELL, textAlign: "right", color: r.incoming > 0 ? "#3182ce" : "var(--muted)" }}
                  title={r.incoming_date ? `from ${r.incoming_date}` : ""}>
                  {r.incoming > 0 ? fmt.num(r.incoming) : "—"}
                </td>
                <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap",
                  color: r.days_to_risk != null && r.days_to_risk <= 14 ? "#c53030" : "var(--muted)" }}>
                  {r.risk_date ? `${r.risk_date} (${r.days_to_risk}d)` : "—"}
                </td>
                <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>
                  {(r.sources || []).length
                    ? (r.sources || []).map((x) => (SOURCE_MIX[x] || {}).label || x).join(", ")
                    : r.on_hand > 0 ? "stock on hand only" : "no forward supply"}
                  {r.estimated ? " ~" : ""}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} style={CELL}>No items match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CompetingCard({ data, idParams, metric, setMetric, view, setView }) {
  const M = COMPETING_METRICS.find((x) => x.id === metric) || COMPETING_METRICS[0];
  const rows = metric === "collector" ? (data.competing_by_collector || []) : (data.competing_by_mc || []);
  const key = metric === "collector" ? "collector" : "mc_code";
  const opt = useMemo(() => competingOption(rows, key, metric === "collector" ? "#c53030" : "#805ad5"),
    [rows, key, metric]);
  return (
    <CardShell icon={M.icon} title={M.title} sub={M.sub} section="competing" idParams={idParams}
      tabs={COMPETING_METRICS.map((x) => ({ id: x.id, label: x.label }))}
      metric={metric} setMetric={setMetric} view={view} setView={setView}>
      {rows.length === 0 ? (
        <Empty title="No competing demand"
          note="Nobody outside your book holds firm orders on the items you are exposed on — either nothing is exposed, or your scope already covers every order on those items." />
      ) : view === "chart" ? (
        <EChart className="echart-fill" height="100%" option={opt} />
      ) : (
        <div className="tbl-wrap">
          <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...HCELL, textAlign: "left" }}>{metric === "collector" ? "Collector" : "Market circle"}</th>
                <th style={{ ...HCELL, textAlign: "right" }}>Committed (KG)</th>
                <th style={{ ...HCELL, textAlign: "right" }}>Order lines</th>
                <th style={{ ...HCELL, textAlign: "right" }}>Customers</th>
                <th style={{ ...HCELL, textAlign: "right" }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{r[key] || "—"}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: "#c53030" }}>{fmt.num(r.balance)}</td>
                  <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.lines)}</td>
                  <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.customers)}</td>
                  <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(r.items)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

function Headline({ k, jcLabel, jcFrom, jcTo }) {
  const b = k.book || {};
  // SOC only counts orders committed INSIDE the cycle, so a book of overdue
  // lines reads as "no orders" unless the rest of it is shown alongside.
  const tip = (id) => {
    if (id === "soc") {
      return `${fmt.num(k.soc || 0)} KG committed inside ${jcFrom} to ${jcTo}`
        + `\nYour open book: ${fmt.num(b.in_cycle || 0)} KG in this cycle`
        + ` (${fmt.num(b.in_cycle_lines || 0)} lines), ${fmt.num(b.overdue || 0)} KG overdue`
        + ` (${fmt.num(b.overdue_lines || 0)}), ${fmt.num(b.later || 0)} KG later`;
    }
    return `${fmt.num(k[id] || 0)} KG`;
  };
  return (
    <div className="card" style={{ padding: "18px 20px 16px" }}>
      <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, letterSpacing: ".06em",
        textTransform: "uppercase", color: "#1f3a5f", marginBottom: 16 }}>
        My {jcLabel} Supply Position
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {TILES.map((t) => (
          <div key={t.id} style={{ textAlign: "center", padding: "4px 6px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: ".04em" }}>{t.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: t.color, lineHeight: 1.25,
              fontVariantNumeric: "tabular-nums" }}
              title={tip(t.id)}>
              {abbr(k[t.id])}
            </div>
            <div style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1 }}>↑</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, textAlign: "center", fontSize: 11.5, color: "var(--muted)" }}>
        Protected + At Risk + Critical = Projection · SOC counts orders committed
        <b> inside {jcFrom} to {jcTo}</b> plus anything already shipped in it
        {b.overdue > 0 && (
          <>
            <br />
            Your book also holds <b>{fmt.num(b.overdue)} KG</b> on {fmt.num(b.overdue_lines)} line
            {b.overdue_lines === 1 ? "" : "s"} committed <b>before</b> this cycle — still owed, but
            they cannot protect a cycle they predate.
          </>
        )}
      </div>
    </div>
  );
}

function ActionTable({ rows, total, onPick }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const shown = useMemo(() => {
    let out = rows;
    if (only !== "all") out = out.filter((r) => r.risk === only);
    const s = q.trim().toLowerCase();
    if (s) {
      out = out.filter((r) => `${r.item} ${r.customer} ${r.item_code || ""} ${r.collector || ""}`
        .toLowerCase().includes(s));
    }
    return out;
  }, [rows, q, only]);

  return (
    <div className="card" style={{ padding: "14px 16px 16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14,
          fontWeight: 700, color: total ? "#b7791f" : "#2f855a" }}>
          <TriangleAlert size={16} />
          {total ? `${fmt.num(total)} line${total === 1 ? "" : "s"} require action` : "Nothing requires action"}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          click a line to see why
        </span>
        <div className="card-filters" style={{ marginLeft: "auto" }}>
          <SegTabs size="sm" value={only} onChange={setOnly}
            tabs={[{ id: "all", label: "All" }, { id: "critical", label: "🔴 Critical" },
              { id: "watch", label: "🟡 At risk" }]} />
          <SmoothInput className="searchbox" style={{ maxWidth: 230 }} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search item or customer…" />
        </div>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 420 }}>
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: "20%" }} /><col style={{ width: "20%" }} />
            <col style={{ width: "9%" }} /><col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} /><col style={{ width: "11%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Your approved projection for this customer and item">Projection</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Your firm demand — open orders plus what has already shipped">SOC</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Firm orders on this item held by customers outside your book">Other SOC</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Available to promise on this item after everyone else's firm orders and the safety level">ATP</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Earliest date supply covers what you still have to convert">Commit date</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rk = RISK[r.risk] || RISK.safe;
              return (
                <tr key={r.key} onClick={() => onPick(r)} style={{ cursor: "pointer" }}
                  title="Show why this line is at risk">
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}
                    title={`${r.item_code || ""} ${r.item}`}>{r.item}</td>
                  <td style={{ ...CELL }} title={`${r.customer} · ${r.collector || ""}`}>{r.customer}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.projection)}</td>
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.soc > 0 ? "#3182ce" : "var(--muted)" }}
                    title={r.backlog > 0
                      ? `${fmt.num(r.soc)} KG committed inside this cycle. A further `
                        + `${fmt.num(r.backlog)} KG is on orders committed BEFORE it — owed, `
                        + "but not protection for this cycle."
                      : "Open orders committed inside this cycle, plus anything already shipped in it"}>
                    {fmt.num(r.soc)}
                    {r.backlog > 0 && (
                      <span style={{ fontSize: 10.5, color: "#b7791f" }}> +{abbr(r.backlog)}</span>
                    )}
                  </td>
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.other_soc > 0 ? "#c53030" : "var(--muted)" }}
                    title={r.other_customers ? `${r.other_customers} customers outside your book` : ""}>
                    {r.other_soc > 0 ? fmt.num(r.other_soc) : "—"}
                  </td>
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.atp < 0 ? "#c53030" : "#2f855a" }}
                    title={r.atp < 0
                      ? "On hand minus everyone else's firm orders minus the safety level. "
                        + "Negative usually means stock is below the safety level rather than "
                        + "sold out — a date can still be promised by dipping into it."
                      : "On hand minus everyone else's firm orders minus the safety level"}>
                    {fmt.num(r.atp)}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap",
                    color: r.commit_date ? (r.delay_days > 0 ? "#c53030" : "#2f855a") : "var(--muted)",
                    fontWeight: r.commit_date ? 600 : 400 }}
                    title={r.commit_date
                      ? (r.delay_days > 0 ? `${r.delay_days} days after it is needed` : "in time")
                        + (r.breaches_msl
                          ? " — but only by taking stock below the safety level, which is why ATP reads negative"
                          : "")
                      : "no production job and no open PO — no date can be given"}>
                    {r.commit_date || "no date"}
                    {r.commit_date && r.breaches_msl && (
                      <span style={{ color: "#b7791f", fontWeight: 700 }}
                        title="Meeting this dips below the safety level"> *</span>
                    )}
                  </td>
                  <td style={{ ...CELL }} title={rk.hint}>
                    <span style={{ color: rk.color, fontWeight: 600, fontSize: 11.5 }}>
                      {rk.dot} {rk.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={8} style={CELL}>No lines match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#b7791f", fontWeight: 600 }}>
          Showing the {fmt.num(rows.length)} most exposed of {fmt.num(total)} lines — the search
          and risk filters above only look at these {fmt.num(rows.length)}. Download for the
          complete list.
        </div>
      )}
    </div>
  );
}

function Line({ label, value, unit = "KG", strong, color, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0",
      borderBottom: "1px solid var(--border)" }} title={hint || ""}>
      <span style={{ fontSize: 13, color: strong ? "#1f3a5f" : "var(--muted)",
        fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ flex: 1, borderBottom: "1px dotted #dfe6ec", margin: "0 4px" }} />
      <span style={{ fontSize: 14, fontWeight: 700, color: color || "#1f3a5f",
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {typeof value === "number" ? fmt.num(value) : (value || "—")}
        {typeof value === "number" && unit
          ? <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}> {unit}</span>
          : null}
      </span>
    </div>
  );
}

// Compact stat used by the item drill-down (the why-panel uses Line instead,
// which is a label/value row rather than a tile).
function Fig({ label, value, unit = "KG", color, hint }) {
  return (
    <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 6,
      minWidth: 130, flex: "1 1 130px" }} title={hint || ""}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#1f3a5f" }}>
        {typeof value === "number" ? fmt.num(value) : (value || "—")}
        {typeof value === "number" && unit
          ? <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}> {unit}</span>
          : null}
      </div>
    </div>
  );
}

function ItemModal({ target, idParams, onClose }) {
  const { data, loading, error } = useAsync(
    () => (target ? api.supplyPositionItem({ ...idParams, item: target.key })
      : Promise.resolve(null)), [target && target.key]);
  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);
  if (!target) return null;
  const r = data && data.found ? data.row : null;

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
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>The supply position</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <Fig label="On hand (sellable)" value={r.on_hand} />
                <Fig label="Safety level" value={r.msl} color="#90a1ac" />
                <Fig label="Firm orders — others" value={r.firm_others} color="#c53030" />
                <Fig label="My unprotected" value={r.my_unprotected} color="#b7791f" />
                <Fig label="Left for me" value={r.atp} color={r.atp < 0 ? "#c53030" : "#2f855a"} />
                <Fig label="Incoming production" value={r.incoming} color="#3182ce"
                  hint={r.incoming_date ? `earliest ${r.incoming_date}` : "none planned this cycle"} />
                <Fig label="Stock runs out" value={r.risk_date || "—"} unit=""
                  color={r.days_to_risk != null && r.days_to_risk <= 14 ? "#c53030" : undefined}
                  hint={r.days_to_risk != null ? `${r.days_to_risk} days from today` : ""} />
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Where the supply comes from</h4>
              <div className="tbl-wrap" style={{ maxHeight: 190, marginBottom: 16 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Available</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>Source</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Quantity (KG)</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ ...CELL, fontWeight: 600 }}>{data.today}</td>
                      <td style={{ ...CELL }}>Stock on hand</td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.on_hand)}</td>
                      <td style={{ ...CELL, color: "var(--muted)", fontSize: 11.5 }}>
                        sellable stock across the orgs that ship
                      </td>
                    </tr>
                    {(data.sources || []).map((x, i) => (
                      <tr key={i}>
                        <td style={{ ...CELL, fontWeight: 600 }}>{x.date}{x.estimate ? " ~" : ""}</td>
                        <td style={{ ...CELL, fontWeight: 600,
                          color: (SOURCE_MIX[x.source] || {}).color }}>
                          {(SOURCE_MIX[x.source] || {}).label || x.source}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(x.qty)}</td>
                        <td style={{ ...CELL, color: "var(--muted)", fontSize: 11.5 }}>{x.note}</td>
                      </tr>
                    ))}
                    {!(data.sources || []).length && (
                      <tr><td colSpan={4} style={{ ...CELL, color: "var(--muted)" }}>
                        No production job and no open purchase order — nothing dated to promise from.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Running balance
                <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>
                  {" "}— committed orders across the company burning it down
                </span>
              </h4>
              <div className="tbl-wrap" style={{ maxHeight: 200, marginBottom: 16 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Date</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Supply in</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Orders out</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ladder || []).map((x, i) => (
                      <tr key={i} style={x.balance < 0 ? { background: "#FDF3F3" } : undefined}>
                        <td style={{ ...CELL, fontWeight: 600 }}>{x.date}</td>
                        <td style={{ ...CELL, textAlign: "right", color: x.in > 0 ? "#2f855a" : "var(--muted)" }}>
                          {x.in > 0 ? `+${fmt.num(x.in)}` : "—"}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", color: x.out > 0 ? "#c53030" : "var(--muted)" }}>
                          {x.out > 0 ? `−${fmt.num(x.out)}` : "—"}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                          color: x.balance < 0 ? "#c53030" : "inherit" }}>{fmt.num(x.balance)}</td>
                      </tr>
                    ))}
                    {!(data.ladder || []).length && (
                      <tr><td colSpan={4} style={CELL}>No dated events in the horizon.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {(data.my_lines || []).length > 0 && (
                <>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Your customers on this item</h4>
                  <div className="tbl-wrap" style={{ maxHeight: 180, marginBottom: 16 }}>
                    <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
                          <th style={{ ...HCELL, textAlign: "right" }}>Projection</th>
                          <th style={{ ...HCELL, textAlign: "right" }}>SOC</th>
                          <th style={{ ...HCELL, textAlign: "right" }}>Unprotected</th>
                          <th style={{ ...HCELL, textAlign: "right" }}>Commit date</th>
                          <th style={{ ...HCELL, textAlign: "left" }}>Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.my_lines || []).map((x, i) => {
                          const rk = RISK[x.risk] || RISK.safe;
                          return (
                            <tr key={i}>
                              <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{x.customer}</td>
                              <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(x.projection)}</td>
                              <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(x.soc)}</td>
                              <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: "#b7791f" }}>
                                {fmt.num(x.unprotected)}
                              </td>
                              <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap" }}>
                                {x.commit_date || "no date"}
                              </td>
                              <td style={{ ...CELL, color: rk.color, fontWeight: 600, fontSize: 11.5 }}>
                                {rk.dot} {rk.label}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Who holds the committed supply
                {!data.show_names && (
                  <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>
                    {" "}— customers outside your scope are grouped by collector
                  </span>
                )}
              </h4>
              <div className="tbl-wrap" style={{ maxHeight: 200, marginBottom: 16 }}>
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
              <div className="tbl-wrap" style={{ maxHeight: 180 }}>
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

function WhyModal({ r, onClose }) {
  useEffect(() => {
    if (!r) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [r, onClose]);
  if (!r) return null;
  const rk = RISK[r.risk] || RISK.safe;
  const late = r.delay_days > 0;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-container" role="dialog" aria-modal="true"
        style={{ maxWidth: 860, width: "94vw" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title" style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
              <TriangleAlert size={16} style={{ flex: "none", color: rk.color }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Why is my item at risk?
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
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10,
        marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#1f3a5f" }}>{r.item}</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{r.customer}</span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: rk.color }}>
          {rk.dot} {rk.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "0 32px" }}>
        <div>
          <Line label="Your Projection" value={r.projection} strong />
          <Line label="Your SOC" value={r.soc}
            hint="Open committed orders plus what has already shipped this cycle" />
          <Line label="Unprotected" value={r.unprotected} color="#b7791f" strong />
          <Line label="Other Executive SOC" value={r.other_soc} color="#c53030"
            hint={`Firm orders on this item from ${r.other_customers} customers outside your book`} />
        </div>
        <div>
          <Line label="Available after firm commitments" value={r.atp}
            color={r.atp < 0 ? "#c53030" : "#2f855a"}
            hint="On hand across the orgs that ship, minus everyone else's firm orders, minus the safety level" />
          <Line label="Expected shortage" value={r.shortfall} color="#c53030" strong />
          <Line label="Required Date" value={r.required} unit=""
            hint="The half of the cycle this quantity was projected for — a projection carries no day-level date" />
          <Line label="Expected Commitment Date" value={r.commit_date || "no dated supply"} unit=""
            color={r.commit_date ? (late ? "#c53030" : "#2f855a") : "#c53030"} />
          <Line label="Potential Delay"
            value={r.delay_days == null ? "—" : `${r.delay_days} days`} unit=""
            color={late ? "#c53030" : "#2f855a"} strong />
        </div>
      </div>

      <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 6,
        background: r.risk === "critical" ? "#FDF3F3" : "#FFF9EF",
        border: `1px solid ${r.risk === "critical" ? "#f3c9c9" : "#f0dcb6"}`,
        display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ArrowRight size={16} style={{ color: rk.color, flex: "none", marginTop: 2 }} />
        <div style={{ fontSize: 13 }}>
          <b style={{ color: rk.color }}>ACTION: </b>
          {r.unprotected <= 0 ? (
            <>Nothing to do — this line is already fully covered by your own orders.</>
          ) : !r.commit_date ? (
            <>Raise the SOC to claim a place in the queue, and flag the item to planning:
              there is no production job and no open purchase order, so no date can be
              promised today.</>
          ) : late ? (
            <>Raise SOC for {fmt.num(r.unprotected)} KG now, and revise the customer date —
              supply lands {r.delay_days} days after this cycle needs it.</>
          ) : r.shortfall > 0 ? (
            <>Raise SOC for {fmt.num(r.unprotected)} KG now. Only {fmt.num(Math.max(0, r.atp))} KG
              is uncommitted, so {fmt.num(r.shortfall)} KG depends on supply arriving by {r.commit_date}.</>
          ) : (
            <>Raise SOC for {fmt.num(r.unprotected)} KG to protect it — supply is available,
              but nothing is holding it for this customer until the order exists.</>
          )}
        </div>
      </div>

      {r.incoming > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>
          Production makes another {fmt.num(r.incoming)} KG
          {r.incoming_date ? ` from ${r.incoming_date}` : ""}.
          {r.risk_date ? ` Committed orders exhaust the current stock on ${r.risk_date}.` : ""}
        </div>
      )}
        </div>
      </div>
    </div>, document.body);
}

export default function SupplyPosition({ session, isAdmin }) {
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
    () => api.supplyPosition(idParams), [viewAs.username, viewAs.persona, jc]);

  const [sel, setSel] = useState(null);
  const [item, setItem] = useState(null);          // item supply drill-down
  const [expMetric, setExpMetric] = useState("collectors");
  const [expView, setExpView] = useState("chart");
  const [supMetric, setSupMetric] = useState("supply");
  const [supView, setSupView] = useState("chart");
  const [cmpMetric, setCmpMetric] = useState("collector");
  const [cmpView, setCmpView] = useState("chart");
  const [dl, setDl] = useState(false);
  useEffect(() => {
    setSel(null); setItem(null);
    setExpMetric("collectors"); setExpView("chart");
    setSupMetric("supply"); setSupView("chart");
    setCmpMetric("collector"); setCmpView("chart");
  }, [viewAs.username, viewAs.persona, jc]);

  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("supplypos", me), [me]);

  // a card switched to its table grows to fit the rows, like the other pages
  const fitRows = (n, toolbar = true) => {
    const px = 76 + (toolbar ? 46 : 0) + 38 + Math.min(n, 12) * 34 + 42;
    return Math.max(5, Math.ceil((px + 14) / 44));
  };

  const rows = data?.rows || [];
  const items = data?.items || [];
  const expandedCards = useMemo(() => {
    const out = {};
    if (expView === "table") {
      out.exposure = fitRows(
        expMetric === "collectors" ? (data?.by_collector || []).length
          : expMetric === "items" ? (data?.by_item || []).length
            : rows.filter((r) => r.silent).length);
    }
    if (supView === "table") {
      out.supply = fitRows(supMetric === "runout"
        ? items.filter((r) => r.days_to_risk != null).length
        : items.filter((r) => r.exposure > 0).length);
    }
    if (cmpView === "table") {
      out.competing = fitRows((cmpMetric === "collector"
        ? data?.competing_by_collector : data?.competing_by_mc || []).length);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expView, expMetric, supView, supMetric, cmpView, cmpMetric, data, rows, items]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const k = data.kpis;
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
        padding: "10px 16px", marginBottom: 14 }}>
        <span className="chip" style={{ cursor: "default", background: "#EEF6FF", fontWeight: 600 }}>{data.persona}</span>
        <SelectBox className="searchbox" style={{ maxWidth: 140 }} value={String(data.jc)}
          title="Which journey cycle" onChange={(e) => setJc(Number(e.target.value) || 0)}>
          {(data.jcs || []).map((j) => <option key={j.jc} value={j.jc}>{j.label}</option>)}
        </SelectBox>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{(data.scope || []).join(" · ") || "—"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {data.jc_from} → {data.jc_to}{syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel: headline, the full action list, and the derivation behind each line"
          disabled={dl}
          onClick={async () => {
            setDl(true);
            try { await api.supplyPositionExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDl(false);
          }}>
          <Download size={15} /> {dl ? "Preparing…" : "Download"}
        </button>
      </div>

      {k.action_lines === 0 ? (
        <div className="card" style={{ padding: "34px 20px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 62, height: 62, borderRadius: "50%", background: "#2f855a14",
            color: "#2f855a", marginBottom: 10 }}>
            <PartyPopper size={30} strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#2f855a" }}>
            Nothing requires action
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
            Every projected line in your scope is either already ordered or has supply
            available in time.
          </div>
        </div>
      ) : (
        <>
          {/* fixed section — deliberately OUTSIDE the grid so these two cannot be
              dragged or resized; the movable cards start below them */}
          <div style={{ marginBottom: 14 }}>
            <Headline k={k} jcLabel={data.jc_label}
              jcFrom={data.jc_from} jcTo={data.jc_to} />
          </div>
          <div style={{ marginBottom: SHOW_CHART_CARDS ? 14 : 0 }}>
            <ActionTable rows={rows} total={data.total_rows} onPick={setSel} />
          </div>

          {SHOW_CHART_CARDS && (
          <DashGrid storageKey={`supplypos_layout_v1:${me || "anon"}`} defaults={DASH_DEFAULTS}
            expanded={expandedCards}
            remoteLayouts={savedLayout.data?.layouts || null}
            userLayouts={savedLayout.data?.user_layouts || null}
            canSaveDefault={isAdmin}
            onSaveDefault={(l) => api.saveDashboardLayout("supplypos", l)}
            onSaveUser={me ? (l) => api.saveDashboardLayout("supplypos", l, me) : undefined}>

          {/* the card must be the DIRECT grid child: every sizing rule is
              .dash-item > .card, so an extra wrapper stops the card (and with it
              the chart inside) from stretching to the resized slot */}
          <ExposureCard key="exposure" data={data} rows={rows} idParams={idParams}
            onPick={setSel} metric={expMetric} setMetric={setExpMetric}
            view={expView} setView={setExpView} />
          <SupplyCard key="supply" items={items} idParams={idParams} onPick={setItem}
            totalItems={data.total_items || items.length}
            metric={supMetric} setMetric={setSupMetric} view={supView} setView={setSupView} />
          <CompetingCard key="competing" data={data} idParams={idParams}
            metric={cmpMetric} setMetric={setCmpMetric} view={cmpView} setView={setCmpView} />
          </DashGrid>
          )}
        </>
      )}
      <WhyModal r={sel} onClose={() => setSel(null)} />
      <ItemModal target={item} idParams={idParams} onClose={() => setItem(null)} />

      <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
        <CircleAlert size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Other SOC, ATP and the commit date are the <b>item's</b> figures — every customer
        projecting that item is competing for the same pool, so the headline counts each
        item's available supply once. Commit dates built on an open purchase order are
        estimated from its order date plus our own average lead time; CRM holds no expected
        arrival date. Required dates are accurate to a half-cycle. A commit date marked
        <b> *</b> can only be met by taking stock below the safety level — that is usually why
        ATP reads negative on the same row.
      </div>
    </>
  );
}
