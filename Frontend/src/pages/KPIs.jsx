import React from "react";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, StatusDot } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

function fmtVal(k) {
  const v = k.value;
  switch (k.format) {
    case "pct": return fmt.pct(v);
    case "pct_signed": return fmt.signed(v);
    case "x": return `${fmt.num(v, 1)}×`;
    case "days": return `${fmt.num(v)} d`;
    case "currency": return fmt.money(v);
    case "count": return fmt.num(v);
    default: return fmt.num(v, 2);
  }
}
function fmtTarget(k) {
  if (k.target === null || k.target === undefined) return "—";
  switch (k.format) {
    case "pct": case "pct_signed": return fmt.pct(k.target, 0);
    case "x": return `${fmt.num(k.target, 1)}×`;
    case "days": return `${fmt.num(k.target)} d`;
    case "count": return fmt.num(k.target);
    default: return fmt.num(k.target);
  }
}

export default function KPIs() {
  const { data, loading, error } = useAsync(api.kpis);
  if (loading) return <Loading what="KPIs" />;
  if (error) return <ErrorBox msg={error} />;

  return (
    <>
      <PageInfo title="Governed KPI Framework (Section 11)">
        Governed KPI framework (Section 11). Forecast-quality metrics are back-tested over the last 6 closed
        months; service, inventory and RM metrics derive from the live plan. <b>Balance, not single-metric optimisation</b> —
        a service target met by over-stocking is not a win.
      </PageInfo>
      <div className="legend">
        <span><StatusDot status="on_target" /> on target</span>
        <span><StatusDot status="watch" /> watch</span>
        <span><StatusDot status="off_target" /> off target</span>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        {data.groups.map((g) => (
          <div className="card" key={g.group}>
            <h3>{g.group}</h3>
            <table>
              <thead>
                <tr><th>KPI</th><th className="num">Value</th><th className="num">Target</th><th>Owner</th></tr>
              </thead>
              <tbody>
                {g.kpis.map((k) => (
                  <tr key={k.name} title={k.definition}>
                    <td><StatusDot status={k.status} />{k.name}</td>
                    <td className="num"><b>{fmtVal(k)}</b></td>
                    <td className="num">{fmtTarget(k)}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{k.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
