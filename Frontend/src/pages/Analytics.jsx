import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

function WhatIf() {
  const [form, setForm] = useState({ demand_surge_pct: 20, family: "", supplier_outage: "RM-07", capacity_loss_pct: 10 });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { ...form, family: form.family || null, supplier_outage: form.supplier_outage || null };
      setRes(await api.whatIf(body));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="card">
      <h3>What-if scenario simulation</h3>
      <div className="sub">Model a demand surge, a supplier outage or a capacity loss and see the service / cost / cash impact before committing (Section 12).</div>
      <div className="grid cols-4" style={{ marginTop: 10 }}>
        <label style={{ fontSize: 12 }}>Demand surge %
          <input type="number" value={form.demand_surge_pct} onChange={upd("demand_surge_pct")} style={inp} />
        </label>
        <label style={{ fontSize: 12 }}>Restrict to family
          <input type="text" placeholder="(all)" value={form.family} onChange={upd("family")} style={inp} />
        </label>
        <label style={{ fontSize: 12 }}>Supplier outage (RM)
          <input type="text" placeholder="e.g. RM-07" value={form.supplier_outage} onChange={upd("supplier_outage")} style={inp} />
        </label>
        <label style={{ fontSize: 12 }}>Capacity loss %
          <input type="number" value={form.capacity_loss_pct} onChange={upd("capacity_loss_pct")} style={inp} />
        </label>
      </div>
      <button className="btn" onClick={run} disabled={busy} style={{ marginTop: 10 }}>{busy ? "Simulating…" : "Run scenario"}</button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 14 }}>
          <div className="grid cols-4">
            <div className="card"><Stat value={fmt.signed(res.deltas.net_fg / (res.base.total_net_fg || 1))} label={`Net FG Δ (${fmt.num(res.deltas.net_fg)} MT)`} /></div>
            <div className="card"><Stat value={fmt.money(res.deltas.rm_buy_value)} label="RM buy value Δ" /></div>
            <div className="card"><Stat value={res.deltas.capacity_gaps >= 0 ? `+${res.deltas.capacity_gaps}` : res.deltas.capacity_gaps} label="Capacity gaps Δ" /></div>
            <div className="card"><Stat value={res.deltas.critical_rm_to_buy >= 0 ? `+${res.deltas.critical_rm_to_buy}` : res.deltas.critical_rm_to_buy} label="Critical RM to buy Δ" /></div>
          </div>
          {res.new_capacity_gaps.length > 0 && (
            <div className="banner err" style={{ marginTop: 10 }}>
              New/overloaded assets under scenario: {res.new_capacity_gaps.map((a) => `${a.name} (${fmt.pct(a.utilisation)})`).join(", ")}
            </div>
          )}
          {res.outage_impact.length > 0 && (
            <div className="banner info" style={{ marginTop: 10 }}>
              Outage on {form.supplier_outage}: shortfall {fmt.num(res.outage_impact[0].shortfall)} on a {res.outage_impact[0].name} requirement of {fmt.num(res.outage_impact[0].gross_requirement)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const inp = { width: "100%", padding: "6px 8px", marginTop: 4, border: "1px solid var(--border)", borderRadius: 6 };

export default function Analytics() {
  const { data, loading, error } = useAsync(api.analytics);
  const anomalyRows = data ? data.anomaly_detection.rows : [];
  const pg = usePagination(anomalyRows, []);
  if (loading) return <Loading what="analytics" />;
  if (error) return <ErrorBox msg={error} />;

  const { anomaly_detection, risk_scoring, supplier_reliability, meio, segmentation_autotune, maturity } = data;

  return (
    <>
      <PageInfo title="Analytics & Intelligence (Section 12)">
        Layered descriptive → diagnostic → predictive →
        prescriptive. Every flag ties to a decision and an owner.
      </PageInfo>

      <div className="grid cols-4">
        {maturity.map((m) => (
          <div className="card" key={m.layer}>
            <Stat value={m.layer} label={m.question} />
            <Tag kind="none">{m.status}</Tag>
          </div>
        ))}
      </div>

      <div className="section-title">What-if simulation (prescriptive)</div>
      <WhatIf />

      <div className="section-title">Projection anomaly detection (predictive — sharpens Section 7)</div>
      <div className="card">
        <table>
          <thead>
            <tr><th>SKU</th><th>Owner</th><th className="num">Projection</th><th className="num">Expected</th><th className="num">z-score</th><th className="num">Value at risk</th><th>Level</th></tr>
          </thead>
          <tbody>
            {pg.pageRows.map((r) => (
              <tr key={r.sku}>
                <td><b>{r.sku}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</span></td>
                <td>{r.owner}</td>
                <td className="num">{fmt.num(r.projection)}</td>
                <td className="num">{fmt.num(r.expected)}</td>
                <td className="num">{r.z_score} ({r.direction})</td>
                <td className="num">{fmt.money(r.value_at_risk)}</td>
                <td><Tag kind={r.level === "anomaly" ? "hard" : "soft"}>{r.level}</Tag></td>
              </tr>
            ))}
            {anomaly_detection.rows.length === 0 && <tr><td colSpan={7}>No projection anomalies this cycle.</td></tr>}
          </tbody>
        </table>
        <Pagination {...pg} />
      </div>

      <div className="grid cols-2">
        <div>
          <div className="section-title">Stock-out &amp; expiry risk (ranked by value at risk)</div>
          <div className="card">
            <table>
              <thead><tr><th>SKU</th><th className="num">Days cover</th><th className="num">Stock-out</th><th className="num">Expiry</th><th>Flag</th></tr></thead>
              <tbody>
                {risk_scoring.rows.map((r) => (
                  <tr key={r.sku}>
                    <td><b>{r.sku}</b></td>
                    <td className="num">{fmt.num(r.days_cover)}</td>
                    <td className="num">{fmt.pct(r.stockout_risk, 0)}</td>
                    <td className="num">{fmt.pct(r.expiry_risk, 0)}</td>
                    <td><Tag kind={r.flag === "stock-out" ? "hard" : "soft"}>{r.flag}</Tag></td>
                  </tr>
                ))}
                {risk_scoring.rows.length === 0 && <tr><td colSpan={5}>No material stock-out / expiry risk.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="section-title">Supplier reliability prediction</div>
          <div className="card">
            <table>
              <thead><tr><th>RM</th><th className="num">On-time</th><th className="num">Late prob.</th><th className="num">Exposure</th><th>Risk</th></tr></thead>
              <tbody>
                {supplier_reliability.rows.slice(0, 10).map((r) => (
                  <tr key={r.code} title={r.action}>
                    <td><b>{r.code}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</span></td>
                    <td className="num">{fmt.pct(r.on_time_rate, 0)}</td>
                    <td className="num">{fmt.pct(r.late_probability, 0)}</td>
                    <td className="num">{fmt.pct(r.exposure, 0)}</td>
                    <td><Tag kind={r.risk === "high" ? "hard" : r.risk === "medium" ? "soft" : "none"}>{r.risk}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section-title">Prescriptive recommendations — MEIO &amp; optimal buy ({meio.count})</div>
      <div className="card">
        <table>
          <thead><tr><th>Scope</th><th>Object</th><th>Lever</th><th>Recommendation</th></tr></thead>
          <tbody>
            {meio.recommendations.map((r, i) => (
              <tr key={i}>
                <td>{r.scope}</td>
                <td><b>{r.id}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</span></td>
                <td><Tag kind="none">{r.lever}</Tag></td>
                <td style={{ fontSize: 13 }}>{r.recommendation}</td>
              </tr>
            ))}
            {meio.recommendations.length === 0 && <tr><td colSpan={4}>No prescriptive moves recommended this cycle.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="section-title">Segmentation auto-tuning — policy drift ({segmentation_autotune.drift_count})</div>
      <div className="card">
        <div className="sub">{segmentation_autotune.note}</div>
        {segmentation_autotune.rows.length === 0
          ? <p style={{ color: "var(--muted)" }}>No segmentation drift — current ABC-XYZ / PTO-PTS policies still fit.</p>
          : <table>
              <thead><tr><th>SKU</th><th>Cell</th><th>Recommended cell</th><th>Policy</th><th>Recommended policy</th></tr></thead>
              <tbody>
                {segmentation_autotune.rows.map((r) => (
                  <tr key={r.sku}>
                    <td><b>{r.sku}</b> {r.name}</td>
                    <td>{r.current_cell}</td><td>{r.recommended_cell}</td>
                    <td>{r.current_policy}</td><td>{r.recommended_policy}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </div>
    </>
  );
}
