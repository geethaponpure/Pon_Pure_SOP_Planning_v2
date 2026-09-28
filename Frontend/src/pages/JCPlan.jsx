import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

export default function JCPlan() {
  const { data, loading, error } = useAsync(api.jcPlan);
  const [metric, setMetric] = useState("production");
  const rows = data ? data.fg : [];
  const pg = usePagination(rows, []);
  if (loading) return <Loading what="JC plan" />;
  if (error) return <ErrorBox msg={error} />;

  const { jcs, by_jc, fg, summary, current_jc } = data;

  return (
    <>
      <PageInfo title="Multi-Period JC Plan (Section 3.2 — MPS)">
        The annual business plan is
        spread across the 13 JCs of FY 2026-27 (seasonality × working days), then time-phased:
        projected on-hand is carried forward and production is sized per JC. Current cycle: <b>JC{current_jc}</b>.
      </PageInfo>

      <div className="grid cols-4">
        <div className="card"><Stat value={`JC${current_jc}`} label="Current planning cycle" /></div>
        <div className="card"><Stat value={summary.items_planned} label="Items planned" /></div>
        <div className="card"><Stat value={fmt.num(summary.total_production)} label={`Production over ${summary.jcs_in_horizon} JCs (KG)`} /></div>
        <div className="card"><Stat value={fmt.money(summary.total_rm_buy_value)} label="RM buy value (horizon)" /></div>
      </div>

      <div className="section-title">Per-JC totals</div>
      <div className="card">
        <table>
          <thead>
            <tr><th>JC</th><th>From</th><th>To</th><th className="num">Wrk days</th>
              <th className="num">Demand</th><th className="num">Production</th>
              <th className="num">RM buy value</th><th>Capacity</th></tr>
          </thead>
          <tbody>
            {by_jc.map((b) => (
              <tr key={b.jc}>
                <td><b>{b.label}</b></td>
                <td style={{ fontSize: 12 }}>{b.from}</td>
                <td style={{ fontSize: 12 }}>{b.to}</td>
                <td className="num">{b.working_days}</td>
                <td className="num">{fmt.num(b.demand)}</td>
                <td className="num">{fmt.num(b.production)}</td>
                <td className="num">{fmt.money(b.rm_buy_value)}</td>
                <td>{b.overloaded.length
                  ? <Tag kind="hard">{b.overloaded.length} over</Tag>
                  : <Tag kind="none">OK</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        Time-phased grid (MPS) —{" "}
        <button className="link" onClick={() => setMetric("production")} style={{ fontWeight: metric === "production" ? 700 : 400 }}>production</button>{" · "}
        <button className="link" onClick={() => setMetric("demand")} style={{ fontWeight: metric === "demand" ? 700 : 400 }}>demand</button>{" · "}
        <button className="link" onClick={() => setMetric("ending_on_hand")} style={{ fontWeight: metric === "ending_on_hand" ? 700 : 400 }}>projected on-hand</button>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: "var(--card)" }}>SKU</th>
              <th>Policy</th><th>Tier</th>
              {jcs.map((j) => <th key={j.jc} className="num">{j.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {pg.pageRows.map((r) => (
              <tr key={r.sku}>
                <td style={{ position: "sticky", left: 0, background: "var(--card)" }}>
                  <b>{r.sku}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{(r.name || "").slice(0, 20)}</div>
                </td>
                <td><Tag kind={r.policy}>{r.policy}</Tag></td>
                <td>{r.customer_tier || "—"}</td>
                {r.cells.map((c) => (
                  <td key={c.jc} className="num"
                    style={{ color: metric === "production" && c.production > 0 ? "var(--navy)" : "var(--muted)" }}>
                    {fmt.num(c[metric])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination {...pg} />
      </div>
      <div className="sub">{fg.length} planned items by annual volume.</div>
    </>
  );
}
