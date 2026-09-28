import React, { useMemo, useState } from "react";
import EChart from "./EChart.jsx";
import SegTabs from "./SegTabs.jsx";
import { fmt } from "../api";

// Summary charts for the MFG-Org Stock page. Reflect the CURRENTLY FILTERED rows
// (so search / division / org / segment filters update them). Self-contained echart
// helpers; every series drops zero-value entries; each chart's shape is switchable.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
const gradV = (c) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + "55" }, { offset: 1, color: c + "05" }] });
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const SHAPE_DIST = [{ id: "donut", label: "Donut" }, { id: "pie", label: "Pie" }, { id: "bar", label: "Bar" }];
const SHAPE_RANK = [{ id: "bar", label: "Bar" }, { id: "line", label: "Line" }];
const PAL = ["#2a9d8f", "#4880ff", "#b7791f", "#805ad5", "#2f855a", "#c53030", "#28b5e1", "#90a1ac"];
const abbr = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return (v / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return fmt.num(v);
};

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
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: "#414d55", fontSize: 11 }, type: "scroll" },
    ...(shape === "donut" ? {
      title: { text: abbr(rows.reduce((a, d) => a + d.value, 0)), subtext: center, left: "center", top: "34%",
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

function rankedOption(rows, { shape, c1, c2, unit }) {
  const base = { ...ANIM, tooltip: { ...TT, trigger: "axis", axisPointer: { type: shape === "line" ? "line" : "shadow" }, formatter: (ps) => `${ps[0].name}<br/><b>${fmt.num(ps[0].value)}</b> ${unit}` } };
  if (shape === "line") {
    return { ...base, grid: { left: 8, right: 18, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: "category", data: rows.map((r) => r.name), axisTick: { show: false }, axisLabel: { color: "#414d55", fontSize: 10, rotate: 30, hideOverlap: true, width: 90, overflow: "truncate" } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
      series: [{ type: "line", smooth: true, symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: c2 }, itemStyle: { color: c2 }, areaStyle: { color: gradV(c2) }, data: rows.map((r) => r.value) }] };
  }
  return { ...base, grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", barWidth: "56%", itemStyle: { borderRadius: [0, 6, 6, 0], color: grad(c1, c2) }, emphasis: { itemStyle: { color: grad(c2, c1) } }, data: rows.map((r) => r.value) }] };
}

export default function MfgStockCharts({ rows }) {
  const [shape, setShape] = useState({ org: "bar", seg: "donut", age: "donut" });
  const setSh = (k) => (v) => setShape((s) => ({ ...s, [k]: v }));

  // 1) on-hand by MFG organization (top 12)
  const byOrg = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { const k = r.org || "—"; m[k] = (m[k] || 0) + (r.qty || 0); });
    return Object.entries(m).map(([name, v]) => ({ name, value: Math.round(v) }))
      .filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 12).reverse();
  }, [rows]);

  // 2) stock by segment (donut)
  const bySeg = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { const k = r.segment2 || "—"; m[k] = (m[k] || 0) + (r.qty || 0); });
    return Object.entries(m).map(([name, v], i) => ({ name, value: Math.round(v), color: PAL[i % PAL.length] }))
      .filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  }, [rows]);

  // 3) stock age profile (Fresh / Aging / Old)
  const byAge = useMemo(() => {
    let fresh = 0, aging = 0, old = 0;
    (rows || []).forEach((r) => { const a = r.age_days || 0, q = r.qty || 0; if (a >= 180) old += q; else if (a >= 90) aging += q; else fresh += q; });
    return [
      { name: "Fresh (<90d)", value: Math.round(fresh), color: "#2f855a" },
      { name: "Aging (90–179d)", value: Math.round(aging), color: "#b7791f" },
      { name: "Old (≥180d)", value: Math.round(old), color: "#c53030" },
    ].filter((d) => d.value > 0);
  }, [rows]);

  const orgOpt = useMemo(() => rankedOption(byOrg, { shape: shape.org, c1: "#7aa7ff", c2: "#4880ff", unit: "KG" }), [byOrg, shape.org]);
  const segOpt = useMemo(() => distOption(bySeg, { shape: shape.seg, unit: "KG", center: "KG" }), [bySeg, shape.seg]);
  const ageOpt = useMemo(() => distOption(byAge, { shape: shape.age, unit: "KG", center: "KG" }), [byAge, shape.age]);

  if (!rows || !rows.length) return null;

  return (
    <div className="grid cols-3" style={{ margin: "14px 0 20px" }}>
      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>On-hand by MFG org</h3><div className="sub">top organizations · KG</div></div>
          <SegTabs size="sm" value={shape.org} onChange={setSh("org")} tabs={SHAPE_RANK} />
        </div>
        <EChart option={orgOpt} height={250} />
      </div>

      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>Stock by segment</h3><div className="sub">on-hand KG by Segment 2</div></div>
          <SegTabs size="sm" value={shape.seg} onChange={setSh("seg")} tabs={SHAPE_DIST} />
        </div>
        <EChart option={segOpt} height={250} />
      </div>

      <div className="card">
        <div className="supply-dash-cardhead">
          <div><h3>Stock age profile</h3><div className="sub">KG by lot age band</div></div>
          <SegTabs size="sm" value={shape.age} onChange={setSh("age")} tabs={SHAPE_DIST} />
        </div>
        <EChart option={ageOpt} height={250} />
      </div>
    </div>
  );
}
