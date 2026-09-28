import React from "react";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, Tag } from "../components/ui.jsx";

export default function DataQuality() {
  const { data, loading, error } = useAsync(api.dq);
  if (loading) return <Loading what="data-quality gate" />;
  if (error) return <ErrorBox msg={error} />;

  const { findings, scores, summary } = data;
  const gateOk = summary.gate === "PASS";

  return (
    <>
      <div className={`banner ${gateOk ? "info" : "err"}`}>
        <b>Data-Quality Gate (Section 5.3).</b> Every load is scored for completeness, validity and
        timeliness. Critical defects block the affected SKUs/RMs from planning and raise a
        data-stewardship exception — rather than silently producing a wrong plan.
        {" "}Gate status: <b>{summary.gate}</b>.
      </div>

      <div className="grid cols-4">
        <div className="card"><Stat value={fmt.pct(scores.overall)} label="Overall DQ score" /></div>
        <div className="card"><Stat value={summary.critical} label="Critical defects (blocking)" /></div>
        <div className="card"><Stat value={summary.skus_blocked} label="SKUs blocked from planning" /></div>
        <div className="card"><Stat value={summary.rms_blocked} label="RMs blocked from planning" /></div>
      </div>

      <div className="section-title">Dimension scores</div>
      <div className="grid cols-3">
        {["completeness", "validity", "timeliness"].map((d) => (
          <div className="card" key={d}>
            <Stat value={fmt.pct(scores[d])} label={d[0].toUpperCase() + d.slice(1)} />
          </div>
        ))}
      </div>

      <div className="section-title">Findings ({summary.total_findings})</div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Scope</th><th>Object</th><th>Defect</th><th>Severity</th><th>Description</th><th>Steward / owner</th></tr>
          </thead>
          <tbody>
            {findings.map((f, i) => (
              <tr key={i}>
                <td>{f.scope}</td>
                <td><b>{f.id}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{f.name}</span></td>
                <td>{f.defect}</td>
                <td><Tag kind={f.severity === "critical" ? "hard" : "soft"}>{f.severity}</Tag></td>
                <td style={{ fontSize: 12 }}>{f.description}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.owner}</td>
              </tr>
            ))}
            {findings.length === 0 && <tr><td colSpan={6}>No data-quality defects — gate clean.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
