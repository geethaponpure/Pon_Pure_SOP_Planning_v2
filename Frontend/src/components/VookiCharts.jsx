import React, { useMemo } from "react";
import EChart from "./EChart.jsx";
import { fmt } from "../api";

const C = { ready: "#1a7d4f", partial: "#c8891f", blocked: "#b23b3b", now: "#e5484d", soon: "#e0a53b", routine: "#2f6fb0", block: "#7b2d8e", ink: "#45566b", grid: "#eef1f5" };
const nf = (v) => fmt.num(Math.round(v || 0));
const clip = (s, n = 18) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const urgColor = (net, lead) => (net <= 0 ? C.ready : lead == null ? C.routine : lead >= 60 ? C.now : lead >= 30 ? C.soon : C.routine);

// horizontal bar (top-N), biggest on top
function barOption({ rows, valKey, colorFn, unit }) {
  const top = rows.slice(0, 8).reverse();
  return {
    grid: { left: 4, right: 48, top: 6, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `<b>${top[ps[0].dataIndex]._full}</b><br/>${ps[0].value}${unit}` },
    xAxis: { type: "value", axisLabel: { fontSize: 9, color: "#9aa7b5", formatter: (v) => (v >= 1000 ? v / 1000 + "k" : v) }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: "category", data: top.map((r) => r._label), axisLabel: { fontSize: 9.5, color: C.ink }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 16,
      data: top.map((r) => ({ value: Math.round(r[valKey]), itemStyle: { color: colorFn(r), borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: "right", fontSize: 9.5, fontWeight: 700, color: C.ink, formatter: (p) => nf(p.value) + unit },
    }],
  };
}

const Empty = ({ msg }) => <div className="empty">{msg}</div>;

export default function VookiCharts({ buy, bottlenecks, readyCounts, plannedCount, decode }) {
  const lbl = (r) => ({ ...r, _label: clip(decode ? r.rm_desc || r.rm_code : r.rm_code), _full: decode ? r.rm_desc || r.rm_code : r.rm_code });

  const readyOpt = useMemo(() => {
    const d = [
      { name: "Ready", value: readyCounts.ready, itemStyle: { color: C.ready } },
      { name: "Partial", value: readyCounts.partial, itemStyle: { color: C.partial } },
      { name: "Blocked", value: readyCounts.blocked, itemStyle: { color: C.blocked } },
    ].filter((x) => x.value > 0);
    return {
      tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/><b>${p.value}</b> product${p.value > 1 ? "s" : ""} (${p.percent}%)` },
      legend: { bottom: 0, left: "center", itemWidth: 9, itemHeight: 9, itemGap: 12, textStyle: { fontSize: 9.5, color: C.ink } },
      series: [{
        type: "pie", radius: ["52%", "74%"], center: ["50%", "44%"], avoidLabelOverlap: false,
        itemStyle: { borderColor: "#fff", borderWidth: 2 }, labelLine: { show: false },
        label: { show: true, position: "center", formatter: `{v|${readyCounts.ready}/${readyCounts.total}}\n{l|ready}`, rich: {
          v: { fontSize: 22, fontWeight: 800, color: C.ready, lineHeight: 26 }, l: { fontSize: 10, color: "#8a97a6" } } },
        data: d,
      }],
    };
  }, [readyCounts]);

  const buyOpt = useMemo(() => barOption({ rows: buy.map(lbl), valKey: "net_to_buy", colorFn: (r) => urgColor(r.net_to_buy, r.lead), unit: " KG" }), [buy, decode]);
  const blkOpt = useMemo(() => barOption({ rows: bottlenecks.map((b) => ({ ...b, _label: clip(b.rm), _full: b.rm })), valKey: "fg_count", colorFn: () => C.block, unit: " FG" }), [bottlenecks]);

  return (
    <div className="vk-charts">
      <div className="vk-chart">
        <div className="vk-chart-title">Production readiness</div>
        {plannedCount > 0 ? <EChart option={readyOpt} height={200} /> : <Empty msg="Enter plan quantities to see readiness" />}
      </div>
      <div className="vk-chart">
        <div className="vk-chart-title">Top RMs to buy — <span style={{ color: C.now }}>red</span>/<span style={{ color: C.soon }}>amber</span> = longer lead</div>
        {buy.length > 0 ? <EChart option={buyOpt} height={200} /> : <Empty msg="Enter plan quantities to see the purchase list" />}
      </div>
      <div className="vk-chart">
        <div className="vk-chart-title">Top bottleneck RMs — FGs each one limits</div>
        {bottlenecks.length > 0 ? <EChart option={blkOpt} height={200} /> : <Empty msg="No limiting raw materials found" />}
      </div>
    </div>
  );
}
