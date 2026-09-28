import React, { useMemo } from "react";
import EChart from "./EChart.jsx";
import { fmt } from "../api";

// Palette tuned to the app (teal/navy family + buy-red / covered-green)
const C = {
  add: "#2f6fb0", cut: "#12805c", total: "#087f8c",
  covered: "#35a173", later: "#e0a53b", buy: "#e5484d", ink: "#45566b", grid: "#eef1f5",
};
const nf = (v) => fmt.num(Math.round(v || 0));

// ── 1. Demand build-up as a waterfall (mirrors the build-up table) ───────────
function waterfallOption({ pr, wh, br, pjc }) {
  const steps = [
    { name: `JC${pjc} base`, delta: pr.current_target || 0 },
    { name: "+ MFG SOC", delta: pr.mfg_soc || 0 },
    { name: `+ JC${pjc + 1}`, delta: pr.next1 || 0 },
    { name: `+ JC${pjc + 2}`, delta: pr.next2 || 0 },
    { name: "+ MSL", delta: pr.msl || 0 },
    { name: "− On-hand FG", delta: -((wh || 0) + (br || 0)) },
  ];
  const cats = [], base = [], up = [], down = [], tot = [];
  let run = 0;
  steps.forEach((s) => {
    cats.push(s.name);
    if (s.delta >= 0) { base.push(run); up.push(s.delta); down.push("-"); tot.push("-"); run += s.delta; }
    else { run += s.delta; base.push(Math.max(0, run)); up.push("-"); down.push(-s.delta); tot.push("-"); }
  });
  cats.push("Mfg req");
  base.push(0); up.push("-"); down.push("-"); tot.push(Math.max(0, run));

  return {
    grid: { left: 4, right: 10, top: 16, bottom: 6, containLabel: true },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const p = ps.find((x) => x.seriesName !== "base" && x.value !== "-");
        return p ? `${p.name}<br/><b>${nf(p.value)}</b> KG` : "";
      },
    },
    xAxis: {
      type: "category", data: cats,
      axisLabel: { fontSize: 9, color: C.ink, interval: 0, rotate: 22 },
      axisTick: { show: false }, axisLine: { lineStyle: { color: "#d7dee7" } },
    },
    yAxis: {
      type: "value", axisLabel: { fontSize: 9, color: "#9aa7b5", formatter: (v) => (v >= 1000 ? v / 1000 + "k" : v) },
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      { name: "base", type: "bar", stack: "w", itemStyle: { color: "transparent" }, data: base, silent: true },
      { name: "up", type: "bar", stack: "w", itemStyle: { color: C.add, borderRadius: [3, 3, 0, 0] }, data: up },
      { name: "down", type: "bar", stack: "w", itemStyle: { color: C.cut, borderRadius: [3, 3, 0, 0] }, data: down },
      { name: "total", type: "bar", stack: "w", itemStyle: { color: C.total, borderRadius: [3, 3, 0, 0] },
        data: tot, label: { show: true, position: "top", fontSize: 10, fontWeight: 700, color: C.total, formatter: (p) => nf(p.value) } },
    ],
  };
}

// Split each component's gross requirement into three reconciling buckets:
//   in-stock (real availability) · later cycles (shortfall deferred by lead time)
//   · buy-now (net_total). They always sum to gross, so the bar & donut agree.
function splitComponent(c) {
  const gross = c.gross_total || 0;
  const nb = c.net_to_buy || {};
  const shortfall = Math.max(0, (nb.current || 0) + (nb.next1 || 0) + (nb.next2 || 0)); // total 3-JC gap
  const buy = Math.max(0, c.net_total || 0);          // planned this run (lead-time buckets)
  const later = Math.max(0, shortfall - buy);          // real shortfall we're not buying yet
  const stock = Math.max(0, gross - shortfall);        // met from on-hand + in-transit
  return { gross, stock, later, buy };
}

// ── 2. RM coverage: where each material's requirement stands (100% bars) ──────
function coverageOption({ bom, decode }) {
  const rows = bom.components
    .map((c) => {
      const s = splitComponent(c);
      const pct = (v) => (s.gross > 0 ? Math.round((v / s.gross) * 100) : 0);
      return {
        name: decode ? c.rm_desc || c.rm_code : c.rm_code, ...s,
        sPct: pct(s.stock), lPct: pct(s.later), bPct: pct(s.buy),
      };
    })
    .filter((r) => r.gross > 0)
    .sort((a, b) => (a.sPct - b.sPct) || (b.buy - a.buy));   // least in-stock on top
  const top = rows.slice(0, 9).reverse();
  const more = rows.length - top.length;
  const label = (r) => (r.name.length > 20 ? r.name.slice(0, 19) + "…" : r.name);
  const mk = (key, color, radius, lbl) => ({
    name: key, type: "bar", stack: "c", barMaxWidth: 15, itemStyle: { color, borderRadius: radius },
    data: top.map((r) => r[key]), label: lbl,
  });

  return {
    grid: { left: 4, right: 56, top: 6, bottom: more > 0 ? 16 : 4, containLabel: true },
    legend: { show: false },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex];
        return `<b>${r.name}</b><br/>Requirement: ${nf(r.gross)} KG`
          + `<br/><span style="color:${C.covered}">In stock:</span> ${r.sPct}% (${nf(r.stock)} KG)`
          + `<br/><span style="color:${C.later}">Later cycles:</span> ${r.lPct}% (${nf(r.later)} KG)`
          + `<br/><span style="color:${C.buy}">Buy now:</span> <b>${nf(r.buy)} KG</b>`;
      },
    },
    xAxis: { type: "value", max: 100, axisLabel: { fontSize: 9, color: "#9aa7b5", formatter: "{value}%" }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: "category", data: top.map(label), axisLabel: { fontSize: 9.5, color: C.ink }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      mk("sPct", C.covered, [4, 0, 0, 4], { show: true, position: "insideLeft", fontSize: 9, fontWeight: 700, color: "#fff",
        formatter: (p) => (top[p.dataIndex].sPct >= 16 ? top[p.dataIndex].sPct + "%" : "") }),
      mk("lPct", C.later, [0, 0, 0, 0], { show: false }),
      mk("bPct", C.buy, [0, 4, 4, 0], { show: true, position: "right", fontSize: 9.5, fontWeight: 700, color: C.ink,
        formatter: (p) => (top[p.dataIndex].buy > 0 ? nf(top[p.dataIndex].buy) + " KG" : "✓") }),
    ],
    graphic: more > 0 ? [{ type: "text", right: 6, bottom: 0, style: { text: `+${more} more RM`, fontSize: 9, fill: "#9aa7b5" } }] : [],
  };
}

// ── 2b. Overall sourcing: the same three buckets, aggregated (donut) ──────────
function sourcingOption({ bom }) {
  let stock = 0, later = 0, buy = 0;
  bom.components.forEach((c) => { const s = splitComponent(c); stock += s.stock; later += s.later; buy += s.buy; });
  const total = stock + later + buy;
  const pctBuy = total > 0 ? Math.round((buy / total) * 100) : 0;
  return {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/><b>${nf(p.value)}</b> KG (${p.percent}%)` },
    legend: { bottom: 0, left: "center", itemWidth: 9, itemHeight: 9, itemGap: 10, textStyle: { fontSize: 9.5, color: C.ink } },
    series: [{
      type: "pie", radius: ["52%", "74%"], center: ["50%", "44%"], avoidLabelOverlap: false,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: true, position: "center", formatter: `{v|${pctBuy}%}\n{l|buy now}`, rich: {
        v: { fontSize: 22, fontWeight: 800, color: pctBuy > 0 ? C.buy : C.covered, lineHeight: 26 },
        l: { fontSize: 10, color: "#8a97a6" } } },
      labelLine: { show: false },
      data: [
        { name: "In stock", value: Math.round(stock), itemStyle: { color: C.covered } },
        { name: "Later cycles", value: Math.round(later), itemStyle: { color: C.later } },
        { name: "Buy now", value: Math.round(buy), itemStyle: { color: C.buy } },
      ].filter((d) => d.value > 0),
    }],
  };
}

// ── 3. When the buying lands: net-to-buy across the 3 planning cycles ─────────
function timingOption({ bom, pjc }) {
  const sum = (k) => bom.components.reduce((a, c) => a + Math.max(0, (c.net_to_buy && c.net_to_buy[k]) || 0), 0);
  const vals = [sum("current"), sum("next1"), sum("next2")];
  const cats = [`JC${pjc}`, `JC${pjc + 1}`, `JC${pjc + 2}`];
  const anyBuy = vals.some((v) => v > 0);
  return {
    grid: { left: 4, right: 10, top: 18, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `${ps[0].name}<br/>Buy <b>${nf(ps[0].value)}</b> KG` },
    xAxis: { type: "category", data: cats, axisLabel: { fontSize: 10, color: C.ink }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#d7dee7" } } },
    yAxis: { type: "value", axisLabel: { fontSize: 9, color: "#9aa7b5", formatter: (v) => (v >= 1000 ? v / 1000 + "k" : v) }, splitLine: { lineStyle: { color: C.grid } } },
    series: [{
      type: "bar", barMaxWidth: 42,
      data: vals.map((v) => ({ value: v, itemStyle: { color: v > 0 ? C.buy : C.covered, borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: "top", fontSize: 10, fontWeight: 700, color: C.ink, formatter: (p) => (anyBuy ? nf(p.value) : "covered") },
    }],
  };
}

export default function CardCharts({ p, bom, pr, pjc, wh, br, data }) {
  const hasRm = bom && bom.components && bom.components.length > 0;
  const wf = useMemo(() => waterfallOption({ pr, wh, br, pjc }), [pr, wh, br, pjc]);
  const cov = useMemo(() => (hasRm ? coverageOption({ bom, decode: data.decode_names }) : null), [bom, hasRm, data.decode_names]);
  const src = useMemo(() => (hasRm ? sourcingOption({ bom }) : null), [bom, hasRm]);
  const tim = useMemo(() => (hasRm ? timingOption({ bom, pjc }) : null), [bom, hasRm, pjc]);
  const covRows = hasRm ? Math.min(9, bom.components.filter((c) => (c.gross_total || 0) > 0).length) : 0;
  const covH = Math.max(160, covRows * 26 + 44);

  return (
    <div className="sc-charts">
      <div className="sc-chart">
        <div className="sc-chart-title">Demand build-up (KG) — what drives the make-qty</div>
        <EChart option={wf} height={210} />
      </div>
      {hasRm && (
        <div className="sc-chart">
          <div className="sc-chart-title">When to buy — net shortfall by cycle (KG)</div>
          <EChart option={tim} height={210} />
        </div>
      )}
      {hasRm && covRows > 0 && (
        <div className="sc-chart">
          <div className="sc-chart-title">
            RM coverage — <span className="num-zero">in stock</span> · <span style={{ color: "#c8891f", fontWeight: 700 }}>later cycles</span> · <span className="num-pos">buy now</span> · label = KG to buy
          </div>
          <EChart option={cov} height={covH} />
        </div>
      )}
      {hasRm && covRows > 0 && (
        <div className="sc-chart">
          <div className="sc-chart-title">Overall sourcing — in stock vs later-cycle need vs buy now</div>
          <EChart option={src} height={covH} />
        </div>
      )}
    </div>
  );
}
