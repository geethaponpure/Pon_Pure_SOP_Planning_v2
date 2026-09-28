import React, { useMemo, useState } from "react";
import EChart from "./EChart.jsx";
import SegTabs from "./SegTabs.jsx";
import { fmt } from "../api";

// summary charts for the "RM Plan — Data" page. Self-contained (small echart
// helpers copied) so it does not couple to SupplyDashboard. All series drop
// zero-value entries; each chart's shape is user-switchable.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
const gradV = (c) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + "55" }, { offset: 1, color: c + "05" }] });
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
// compact axis labels so big KG totals (e.g. 15,000,000) read as "15M" and don't overlap
const abbr = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return (v / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return fmt.num(v);
};
const SHAPE_DIST = [{ id: "donut", label: "Donut" }, { id: "pie", label: "Pie" }, { id: "bar", label: "Bar" }];
const SHAPE_RANK = [{ id: "bar", label: "Bar" }, { id: "line", label: "Line" }];

const buyQty = (r) => {
  if (typeof r.to_buy === "number") return r.to_buy;
  const n = r.net_to_buy;
  if (n && typeof n === "object") return (n.current || 0) + (n.next1 || 0) + (n.next2 || 0);
  if (typeof n === "number") return n;
  return r.net_total || 0;
};

const FLAG = {
  over: { label: "Over-projected", color: "#c53030" },
  under: { label: "Under-projected", color: "#b7791f" },
  ontrack: { label: "On track", color: "#2f855a" },
  new: { label: "New", color: "#4880ff" },
};

// distribution chart: donut | pie | bar
function distOption(rows, { shape, unit, center }) {
  if (shape === "bar") {
    return {
      ...ANIM, grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
      tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `${ps[0].name}<br/><b>${fmt.num(ps[0].value)}</b> ${unit}` },
      xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
      series: [{ type: "bar", barWidth: "56%", itemStyle: { borderRadius: [0, 6, 6, 0] }, data: rows.map((r) => ({ value: r.value, name: r.name, itemStyle: { color: r.color } })) }],
    };
  }
  const inner = shape === "pie" ? "0%" : "54%";
  return {
    ...ANIM, color: rows.map((r) => r.color),
    tooltip: { ...TT, trigger: "item", formatter: (p) => `${p.marker} ${p.name}<br/><b style="font-size:13px">${fmt.num(p.value)}</b> ${unit} · ${p.percent}%` },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: "#414d55", fontSize: 12 } },
    ...(shape === "donut" ? {
      title: { text: fmt.num(rows.reduce((a, d) => a + d.value, 0)), subtext: center, left: "center", top: "34%",
        textStyle: { fontSize: 20, fontWeight: 700, color: "#1f3a5f" }, subtextStyle: { fontSize: 11, color: "#90a1ac" } },
    } : {}),
    series: [{
      type: "pie", radius: [inner, "76%"], center: ["50%", shape === "donut" ? "42%" : "45%"], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 }, label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data: rows.map((r) => ({ value: r.value, name: r.name })),
    }],
  };
}

// ranked chart: bar | line
function rankedOption(rows, { shape, c1, c2, unit }) {
  const base = { ...ANIM, tooltip: { ...TT, trigger: "axis", axisPointer: { type: shape === "line" ? "line" : "shadow" }, formatter: (ps) => `${ps[0].name}<br/><b>${fmt.num(ps[0].value)}</b> ${unit}` } };
  if (shape === "line") {
    return { ...base, grid: { left: 8, right: 18, top: 16, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: rows.map((r) => r.name), axisTick: { show: false }, axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
      series: [{ type: "line", smooth: true, symbol: "circle", symbolSize: 8, lineStyle: { width: 3, color: c2 }, itemStyle: { color: c2 }, areaStyle: { color: gradV(c2) }, data: rows.map((r) => r.value) }] };
  }
  return { ...base, grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", barWidth: "56%", itemStyle: { borderRadius: [0, 6, 6, 0], color: grad(c1, c2) }, emphasis: { itemStyle: { color: grad(c2, c1) } }, data: rows.map((r) => r.value) }] };
}

export default function RMDataCharts({ data }) {
  const products = data.products || [];
  const [shape, setShape] = useState({ horizon: "bar", status: "donut", activity: "donut" });
  const setSh = (k) => (v) => setShape((s) => ({ ...s, [k]: v }));

  // 1) demand horizon — total Current / Next1 / Next2 projection (KG)
  const horizon = useMemo(() => {
    let cur = 0, n1 = 0, n2 = 0;
    products.forEach((p) => { const pr = p.projection || {}; cur += pr.current_target ?? pr.current ?? 0; n1 += pr.next1 || 0; n2 += pr.next2 || 0; });
    return [
      { name: "Current JC", value: Math.round(cur), color: "#2a9d8f" },
      { name: "Next JC 1", value: Math.round(n1), color: "#4880ff" },
      { name: "Next JC 2", value: Math.round(n2), color: "#805ad5" },
    ].filter((d) => d.value > 0);
  }, [products]);

  // 2) sales projection status (uses sales_flag) — drop zero / "none"
  const status = useMemo(() => {
    const c = {};
    products.forEach((p) => { const f = p.proj_flag; if (f && f !== "none") c[f] = (c[f] || 0) + 1; });
    return Object.entries(c).map(([k, v]) => ({ key: k, value: v, name: (FLAG[k] || {}).label || k, color: (FLAG[k] || {}).color || "#90a1ac" })).filter((d) => d.value > 0);
  }, [products]);

  // 3) RM net-to-buy by activity (from the per-activity consolidated lists)
  const activity = useMemo(() => ([
    ["Manufacturing", "#2a9d8f", data.consolidated_rm_manufacturing],
    ["Repack / Relabel", "#4880ff", data.consolidated_rm_repack],
    ["Packing", "#b7791f", data.consolidated_rm_packing],
  ].map(([name, color, list]) => ({ name, color, value: Math.round((list || []).reduce((a, r) => a + buyQty(r), 0)) }))
    .filter((d) => d.value > 0)), [data]);

  const horizonOpt = useMemo(() => rankedOption(horizon, { shape: shape.horizon, c1: "#7fd0c6", c2: "#2a9d8f", unit: "KG" }), [horizon, shape.horizon]);
  const statusOpt = useMemo(() => distOption(status, { shape: shape.status, unit: "products", center: "flagged" }), [status, shape.status]);
  const activityOpt = useMemo(() => distOption(activity, { shape: shape.activity, unit: "KG", center: "KG to buy" }), [activity, shape.activity]);

  if (!products.length) return null;
  const hasStatus = status.length > 0;
  const hasActivity = activity.length > 0;

  return (
    <div className="grid cols-3" style={{ marginBottom: 12 }}>
      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>Demand horizon (KG)</h3><div className="sub">Current vs next 2 JCs · projected</div></div>
          <SegTabs size="sm" value={shape.horizon} onChange={setSh("horizon")} tabs={SHAPE_RANK} />
        </div>
        <EChart option={horizonOpt} height={240} />
      </div>

      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>Sales projection status</h3><div className="sub">{status.reduce((a, d) => a + d.value, 0)} flagged products</div></div>
          <SegTabs size="sm" value={shape.status} onChange={setSh("status")} tabs={SHAPE_DIST} />
        </div>
        {hasStatus ? <EChart option={statusOpt} height={240} /> : <div className="sub" style={{ padding: 24, textAlign: "center" }}>No sales-flag data.</div>}
      </div>

      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>RM net-to-buy by activity</h3><div className="sub">KG to purchase</div></div>
          <SegTabs size="sm" value={shape.activity} onChange={setSh("activity")} tabs={SHAPE_DIST} />
        </div>
        {hasActivity ? <EChart option={activityOpt} height={240} /> : <div className="sub" style={{ padding: 24, textAlign: "center" }}>Nothing to buy.</div>}
      </div>
    </div>
  );
}
