import React, { useMemo, useState, useCallback } from "react";
import EChart from "./EChart.jsx";
import SelectBox from "./SelectBox.jsx";
import SegTabs from "./SegTabs.jsx";
import { fmt } from "../api";
import { BarChart3 } from "lucide-react";

const ACTIVITY = {
  manufacturing: { label: "Manufacturing", color: "#2a9d8f" },
  repack_relabel: { label: "Repack / Relabel", color: "#4880ff" },
  trading: { label: "Trading", color: "#b7791f" },
  unclassified: { label: "Unclassified", color: "#90a1ac" },
};

const buyQty = (r) => {
  if (typeof r.to_buy === "number") return r.to_buy;
  const n = r.net_to_buy;
  if (n && typeof n === "object") return (n.current || 0) + (n.next1 || 0) + (n.next2 || 0);
  if (typeof n === "number") return n;
  return r.net_total || 0;
};

// shared tooltip look
const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
// horizontal left→right gradient (bar fill)
const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
// vertical top→bottom fade (line area fill) — 8-digit hex alpha
const gradV = (c) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + "55" }, { offset: 1, color: c + "05" }] });
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
// compact axis labels so big KG totals (e.g. 15,000,000) read as "15M" and don't collide
const abbr = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return (v / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return fmt.num(v);
};

const SHAPE_DIST = [{ id: "donut", label: "Donut" }, { id: "pie", label: "Pie" }, { id: "bar", label: "Bar" }];
const SHAPE_RANK = [{ id: "bar", label: "Bar" }, { id: "line", label: "Line" }];

export default function SupplyDashboard({ data }) {
  const products = data.products || [];
  const rms = data.consolidated_rm || [];

  // ── cross-filter (Power BI style): a shared selection across the product charts
  const [sel, setSel] = useState({ seg2: "", activity: "" });
  const toggle = useCallback((dim, val) => {
    setSel((s) => ({ ...s, [dim]: s[dim] === val ? "" : val }));
  }, []);
  const clearSel = useCallback(() => setSel({ seg2: "", activity: "" }), []);
  const hasSel = !!(sel.seg2 || sel.activity);

  const [metric, setMetric] = useState("count");
  // per-chart shape (user-switchable)
  const [shape, setShape] = useState({ activity: "donut", seg: "bar", rm: "bar", coverage: "donut" });
  const setShapeFor = (k) => (v) => setShape((s) => ({ ...s, [k]: v }));

  const seg2opts = useMemo(() => [...new Set(products.map((p) => p.segment2).filter(Boolean))].sort(), [products]);

  // Power BI semantics: a visual filters the OTHERS, not itself. So the activity
  // chart is scoped by the segment selection (and highlights the chosen activity),
  // and the segment chart is scoped by the activity selection (highlights the segment).
  const bySeg2 = useMemo(
    () => (sel.seg2 ? products.filter((p) => (p.segment2 || "—") === sel.seg2) : products),
    [products, sel.seg2]);
  const byActivity = useMemo(
    () => (sel.activity ? products.filter((p) => (p.bom_class || "unclassified") === sel.activity) : products),
    [products, sel.activity]);
  const scoped = useMemo(
    () => products.filter((p) => (!sel.seg2 || (p.segment2 || "—") === sel.seg2)
      && (!sel.activity || (p.bom_class || "unclassified") === sel.activity)),
    [products, sel]);

  // 1) activity mix — scoped by segment selection; drop zero
  const activity = useMemo(() => {
    const c = {};
    bySeg2.forEach((p) => { const k = p.bom_class || "unclassified"; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c)
      .map(([k, v]) => ({ key: k, value: v, name: (ACTIVITY[k] || {}).label || k, color: (ACTIVITY[k] || {}).color || "#90a1ac" }))
      .filter((d) => d.value > 0);
  }, [bySeg2]);
  const actNameToKey = useMemo(() => Object.fromEntries(activity.map((d) => [d.name, d.key])), [activity]);

  // 2) products by Segment 2 — scoped by activity selection; drop zero; top 8
  const segRows = useMemo(() => {
    const m = {};
    byActivity.forEach((p) => {
      const k = p.segment2 || "—";
      if (!m[k]) m[k] = { name: k, count: 0, producible: 0 };
      m[k].count += 1; m[k].producible += p.producible_qty || 0;
    });
    return Object.values(m).filter((r) => r[metric] > 0).sort((a, b) => b[metric] - a[metric]).slice(0, 8).reverse();
  }, [byActivity, metric]);

  // 3) top RMs to buy (top 12) — RM-level (no product dimension), drop zero
  const topRms = useMemo(() => rms
    .map((r) => ({ name: r.rm_desc || r.rm_code, buy: buyQty(r), available: r.available || 0, in_transit: r.in_transit || 0 }))
    .filter((x) => x.buy > 0).sort((a, b) => b.buy - a.buy).slice(0, 12).reverse(), [rms]);

  // 4) RM sourcing coverage — drop zero (already)
  const coverage = useMemo(() => {
    let onhand = 0, transit = 0, buy = 0;
    rms.forEach((r) => { onhand += r.available || 0; transit += r.in_transit || 0; buy += buyQty(r); });
    return [
      { name: "On hand", value: Math.round(onhand), color: "#2f855a" },
      { name: "In-transit", value: Math.round(transit), color: "#b7791f" },
      { name: "To buy", value: Math.round(buy), color: "#c53030" },
    ].filter((d) => d.value > 0);
  }, [rms]);

  // ── option builders ─────────────────────────────────────────────────────────
  // categorical distribution: donut | pie | bar. `selKey` dims the non-selected.
  const distOption = (rows, { shape, unit, center, selKey }) => {
    if (shape === "bar") {
      return {
        ...ANIM, grid: { left: 8, right: 26, top: 12, bottom: 8, containLabel: true },
        tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
          formatter: (ps) => `${ps[0].name}<br/><b>${fmt.num(ps[0].value)}</b> ${unit}` },
        xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
        series: [{ type: "bar", barWidth: "58%", itemStyle: { borderRadius: [0, 6, 6, 0] },
          data: rows.map((r) => ({ value: r.value, name: r.name,
            itemStyle: { color: r.color, opacity: selKey && r.key !== selKey ? 0.3 : 1 } })) }],
      };
    }
    const inner = shape === "pie" ? "0%" : "54%";
    return {
      ...ANIM,
      tooltip: { ...TT, trigger: "item", formatter: (p) => `${p.marker} ${p.name}<br/><b style="font-size:13px">${fmt.num(p.value)}</b> ${unit} · ${p.percent}%` },
      legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: "#414d55", fontSize: 12 } },
      ...(shape === "donut" ? {
        title: { text: fmt.num(rows.reduce((a, d) => a + d.value, 0)), subtext: center, left: "center", top: "36%",
          textStyle: { fontSize: 22, fontWeight: 700, color: "#1f3a5f" }, subtextStyle: { fontSize: 11, color: "#90a1ac" } },
      } : {}),
      series: [{
        type: "pie", radius: [inner, "78%"], center: ["50%", shape === "donut" ? "44%" : "46%"], avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 }, label: { show: false }, labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
        data: rows.map((r) => ({ value: r.value, name: r.name, key: r.key,
          itemStyle: { color: r.color, opacity: selKey && r.key !== selKey ? 0.35 : 1 } })),
      }],
    };
  };

  // ranked horizontal chart: bar | line. `selName` dims the non-selected (bar).
  const rankedOption = (rows, { shape, key, c1, c2, unit, selName, extraTip, zoom }) => {
    const base = {
      ...ANIM,
      tooltip: { ...TT, trigger: "axis", axisPointer: { type: shape === "line" ? "line" : "shadow" },
        formatter: (ps) => { const p = ps[0]; return `${p.name}<br/><b>${fmt.num(p.value)}</b> ${unit}${extraTip ? extraTip(p.dataIndex) : ""}`; } },
    };
    if (shape === "line") {
      return { ...base,
        grid: { left: 8, right: 20, top: 16, bottom: 46, containLabel: true },
        xAxis: { type: "category", data: rows.map((r) => r.name), axisTick: { show: false },
          axisLabel: { color: "#414d55", fontSize: 10, rotate: 30, hideOverlap: true, width: 90, overflow: "truncate" } },
        yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
        series: [{ type: "line", smooth: true, symbol: "circle", symbolSize: 7,
          lineStyle: { width: 3, color: c2 }, itemStyle: { color: c2 }, areaStyle: { color: gradV(c2) },
          data: rows.map((r) => r[key]) }],
      };
    }
    const o = { ...base,
      grid: { left: 8, right: zoom ? 34 : 26, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } }, axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "category", data: rows.map((r) => r.name), axisLabel: { color: "#414d55", fontSize: 11, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
      series: [{ type: "bar", barWidth: "58%",
        itemStyle: { borderRadius: [0, 6, 6, 0] },
        emphasis: { itemStyle: { color: grad(c2, c1) } },
        data: rows.map((r) => ({ value: r[key],
          itemStyle: { color: grad(c1, c2), opacity: selName && r.name !== selName ? 0.3 : 1 } })) }],
    };
    if (zoom && rows.length > 7) {
      o.dataZoom = [{ type: "inside", yAxisIndex: 0, startValue: rows.length - 7, endValue: rows.length - 1 },
        { type: "slider", yAxisIndex: 0, width: 8, right: 6, startValue: rows.length - 7, endValue: rows.length - 1, showDetail: false, brushSelect: false }];
    }
    return o;
  };

  const activityOpt = useMemo(() => distOption(activity, { shape: shape.activity, unit: "products", center: "products", selKey: sel.activity }), [activity, shape.activity, sel.activity]);
  const coverageOpt = useMemo(() => distOption(coverage, { shape: shape.coverage, unit: "KG", center: "KG total" }), [coverage, shape.coverage]);
  const segOpt = useMemo(() => rankedOption(segRows, { shape: shape.seg, key: metric, c1: "#7aa7ff", c2: "#4880ff", unit: metric === "count" ? "products" : "KG", selName: sel.seg2 }), [segRows, shape.seg, metric, sel.seg2]);
  const rmOpt = useMemo(() => rankedOption(topRms, { shape: shape.rm, key: "buy", c1: "#f08b84", c2: "#c53030", unit: "KG", zoom: true,
    extraTip: (i) => `<br/><span style="color:#90a1ac">on hand ${fmt.num(topRms[i].available)} · in-transit ${fmt.num(topRms[i].in_transit)}</span>` }), [topRms, shape.rm]);

  // ── click-to-cross-filter ─────────────────────────────────────────────────
  const activityEvents = useMemo(() => ({
    click: (p) => { const k = (p.data && p.data.key) || actNameToKey[p.name]; if (k) toggle("activity", k); },
  }), [actNameToKey, toggle]);
  const segEvents = useMemo(() => ({ click: (p) => { if (p.name) toggle("seg2", p.name); } }), [toggle]);

  return (
    <div className="supply-dash">
      <div className="supply-dash-head">
        <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><BarChart3 size={16} /> Plan dashboard</h3>
        <SelectBox className="searchbox" style={{ maxWidth: 200 }} value={sel.seg2} onChange={(e) => setSel((s) => ({ ...s, seg2: e.target.value }))}>
          <option value="">All Segment 2</option>
          {seg2opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        {hasSel && (
          <button type="button" className="btn" onClick={clearSel} style={{ marginLeft: 8 }}>
            ✕ Clear filter{sel.seg2 && sel.activity ? "s" : ""}
            {sel.seg2 ? ` · ${sel.seg2}` : ""}{sel.activity ? ` · ${(ACTIVITY[sel.activity] || {}).label || sel.activity}` : ""}
          </button>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="supply-dash-cardhead">
            <div><h3>Product mix by activity{sel.seg2 ? ` · ${sel.seg2}` : ""}</h3>
              <div className="sub">{scoped.length} products · click a slice to cross-filter</div></div>
            <SegTabs size="sm" value={shape.activity} onChange={setShapeFor("activity")} tabs={SHAPE_DIST} />
          </div>
          <EChart option={activityOpt} height={280} onEvents={activityEvents} />
        </div>

        <div className="card">
          <div className="supply-dash-cardhead">
            <div><h3>Products by Segment 2</h3><div className="sub">top segments · click a bar to cross-filter</div></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SegTabs size="sm" value={metric} onChange={setMetric}
                tabs={[{ id: "count", label: "Products" }, { id: "producible", label: "Producible KG" }]} />
              <SegTabs size="sm" value={shape.seg} onChange={setShapeFor("seg")} tabs={SHAPE_RANK} />
            </div>
          </div>
          <EChart option={segOpt} height={280} onEvents={segEvents} />
        </div>

        <div className="card">
          <div className="supply-dash-cardhead">
            <div><h3>Top RMs to buy</h3><div className="sub">by net-to-buy (KG) · scroll to see more</div></div>
            <SegTabs size="sm" value={shape.rm} onChange={setShapeFor("rm")} tabs={SHAPE_RANK} />
          </div>
          <EChart option={rmOpt} height={320} />
        </div>

        <div className="card">
          <div className="supply-dash-cardhead">
            <div><h3>RM sourcing coverage</h3><div className="sub">how total RM demand is met (KG)</div></div>
            <SegTabs size="sm" value={shape.coverage} onChange={setShapeFor("coverage")} tabs={SHAPE_DIST} />
          </div>
          <EChart option={coverageOpt} height={280} />
        </div>
      </div>
    </div>
  );
}
