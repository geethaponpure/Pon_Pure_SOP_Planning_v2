import React from "react";
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts";
import { ChartContainer, ChartTooltip, chartColor } from "../components/Chart.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, KitStat, Tag } from "../components/ui.jsx";

export default function Overview() {
  const { data, loading, error } = useAsync(api.overview);
  if (loading) return <Loading what="cockpit" />;
  if (error) return <ErrorBox msg={error} />;

  const { cycle, pipeline, exception_summary, owner_bias, supply_summary, rccp, counts, dq, dq_scores, alert_tiers, gates, source, scope, load_warnings } = data;
  const exData = Object.entries(exception_summary)
    .filter(([k]) => k !== "Auto-accept")
    .map(([name, value]) => ({ name, value }));
  const autoAccept = exception_summary["Auto-accept"] || 0;

  return (
    <>
      {source && source !== "synthetic" && (
        <div className={`banner ${(load_warnings && load_warnings.length) ? "err" : "info"}`} style={{ marginBottom: 14 }}>
          <b>Live data: {source}</b>
          {scope && <> · scope: {scope.division} · {scope.items_in_scope} of {scope.items_total} items{scope.active_only ? " (active only)" : ""}{scope.max_skus ? `, cap ${scope.max_skus}` : ""}</>}
          {load_warnings && load_warnings.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {load_warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="pipeline" style={{ marginBottom: 18 }}>
        {pipeline.map((s, i) => (
          <React.Fragment key={s}>
            <span className="step">{s}</span>
            {i < pipeline.length - 1 && <span className="arrow">→</span>}
          </React.Fragment>
        ))}
      </div>

      {dq && (
        <div className={`banner ${dq.gate === "PASS" ? "info" : "err"}`} style={{ marginBottom: 14 }}>
          <b>DQ gate: {dq.gate}</b> — overall {fmt.pct(dq_scores.overall)} ·
          {" "}{dq.critical} critical defect(s), {dq.skus_blocked} SKU(s) + {dq.rms_blocked} RM(s) blocked ·
          {" "}alerts: {alert_tiers.escalation || 0} escalation / {alert_tiers.action || 0} action / {alert_tiers.info || 0} FYI
        </div>
      )}

      <div className="grid cols-4">
        <div className="card"><KitStat label="Finished goods" value={counts.skus} foot={`${counts.families} families`} /></div>
        <div className="card"><KitStat label="Open exceptions" value={cycle.exceptions_open} foot="pending validation" /></div>
        <div className="card"><KitStat label="Auto-accepted" value={autoAccept} foot="within tolerance band" /></div>
        <div className="card"><KitStat label="RCCP capacity gaps" value={supply_summary.capacity_gaps} foot="bottleneck assets" /></div>
      </div>

      {gates && (
        <>
          <div className="section-title">S&amp;OP / IBP cadence — gated steps (Section 14)</div>
          <div className="pipeline">
            {gates.map((g, i) => (
              <React.Fragment key={g.step}>
                <span className="step" title={`${g.entry} → ${g.exit}`} style={{
                  background: g.status === "complete" ? "var(--green-bg)" : g.status === "blocked" ? "var(--red-bg)" : g.status === "in_progress" ? "var(--amber-bg)" : undefined,
                }}>{g.step} <Tag kind={{ complete: "none", in_progress: "soft", blocked: "hard", waiting: "light" }[g.status]}>{g.status.replace("_", " ")}</Tag></span>
                {i < gates.length - 1 && <span className="arrow">→</span>}
              </React.Fragment>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Demand reconciliation</div>
      <div className="grid cols-2">
        <div className="card">
          <h3>Exceptions by type</h3>
          <div className="sub">Section 7.4 — how the validation engine classified this cycle's projections</div>
          <ChartContainer config={{ value: { label: "Exceptions" } }} height={230}>
            <BarChart data={exData} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <ChartTooltip config={{ value: { label: "Exceptions" } }} formatter={fmt.num} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {exData.map((e, i) => (
                  <Cell key={i} fill={chartColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>

        <div className="card">
          <h3>Sales owner bias guardrail</h3>
          <div className="sub">Running projection bias vs baseline — persistent over/under-projection is flagged</div>
          <table>
            <thead>
              <tr><th>Owner</th><th className="num">SKUs</th><th className="num">Bias</th><th>Flag</th></tr>
            </thead>
            <tbody>
              {Object.entries(owner_bias).map(([owner, b]) => (
                <tr key={owner}>
                  <td>{owner}</td>
                  <td className="num">{b.n_skus}{b.missing ? ` (+${b.missing} missing)` : ""}</td>
                  <td className="num" style={{ color: Math.abs(b.bias) > 0.1 ? "var(--red)" : "var(--green)" }}>
                    {fmt.signed(b.bias)}
                  </td>
                  <td>
                    <Tag kind={b.flag === "in tolerance" ? "none" : "soft"}>{b.flag}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-title">Supply feasibility (rough-cut capacity)</div>
      <div className="card">
        <div className="sub">
          Net FG requirement {fmt.num(supply_summary.total_net_fg)} MT · RM buy value {fmt.money(supply_summary.total_rm_buy_value)} ·
          {" "}{supply_summary.critical_rm_to_buy} critical RM to trigger
        </div>
        <table>
          <thead>
            <tr><th>Bottleneck asset</th><th className="num">Load (h)</th><th className="num">Capacity (h)</th><th className="num">Utilisation</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rccp.map((a) => (
              <tr key={a.asset}>
                <td>{a.name}</td>
                <td className="num">{fmt.num(a.load_hours)}</td>
                <td className="num">{fmt.num(a.capacity_hours)}</td>
                <td className="num">{fmt.pct(a.utilisation)}</td>
                <td>{a.overloaded ? <Tag kind="hard">Overloaded +{fmt.num(a.gap_hours)}h</Tag> : <Tag kind="none">OK</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
