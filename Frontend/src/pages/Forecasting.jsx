import React from "react";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

export default function Forecasting() {
  const { data, loading, error } = useAsync(api.forecasting);
  if (loading) return <Loading what="forecasting governance" />;
  if (error) return <ErrorBox msg={error} />;

  const { reconciliation, champion_challenger, demand_sensing } = data;

  return (
    <>
      <PageInfo title="Forecasting Governance (Section 9)">
        Best-fit method per series, reconciled across the
        hierarchy so numbers add up; a challenger must beat the incumbent on back-tested accuracy
        before promotion; demand sensing refines the near weeks from firm-order velocity.
      </PageInfo>

      <div className="grid cols-3">
        <div className="card"><Stat value={fmt.num(reconciliation.total_baseline)} label="Total reconciled baseline (MT)" /></div>
        <div className="card"><Stat value={champion_challenger.promotion_candidates} label="Champion/challenger promotions" /></div>
        <div className="card"><Stat value={reconciliation.coherent ? "Coherent" : "—"} label="Hierarchy SKU→family→region→total" /></div>
      </div>

      <div className="section-title">Hierarchical reconciliation</div>
      <div className="grid cols-2">
        <div className="card">
          <h3>By family</h3>
          <table>
            <thead><tr><th>Family</th><th>Region</th><th className="num">SKUs</th><th className="num">Baseline</th><th className="num">Share</th></tr></thead>
            <tbody>
              {reconciliation.by_family.map((f) => (
                <tr key={f.family}>
                  <td>{f.family}</td><td>{f.region}</td>
                  <td className="num">{f.skus}</td>
                  <td className="num">{fmt.num(f.baseline)}</td>
                  <td className="num">{fmt.pct(f.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>By region</h3>
          <table>
            <thead><tr><th>Region</th><th className="num">SKUs</th><th className="num">Baseline</th><th className="num">Share</th></tr></thead>
            <tbody>
              {reconciliation.by_region.map((r) => (
                <tr key={r.region}>
                  <td>{r.region}</td>
                  <td className="num">{r.skus}</td>
                  <td className="num">{fmt.num(r.baseline)}</td>
                  <td className="num">{fmt.pct(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-title">Champion / challenger (back-tested WMAPE error, lower is better)</div>
      <div className="card">
        <table>
          <thead>
            <tr><th>SKU</th><th>Champion method</th><th className="num">Champion err</th><th>Challenger</th><th className="num">Challenger err</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {champion_challenger.rows.map((r) => (
              <tr key={r.sku}>
                <td><b>{r.sku}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</span></td>
                <td style={{ fontSize: 12 }}>{r.champion_method}</td>
                <td className="num">{fmt.pct(r.champion_wmape)}</td>
                <td>{r.challenger}</td>
                <td className="num">{fmt.pct(r.challenger_wmape)}</td>
                <td>{r.promote_challenger
                  ? <Tag kind="soft">Promote challenger</Tag>
                  : <Tag kind="none">Keep champion</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Demand sensing (near-term signal)</div>
      <div className="card">
        <table>
          <thead>
            <tr><th>SKU</th><th className="num">Baseline</th><th className="num">Firm SOC</th><th>Signal</th><th className="num">Sensed near-term</th><th className="num">Adj.</th></tr>
          </thead>
          <tbody>
            {demand_sensing.rows.slice(0, 12).map((r) => (
              <tr key={r.sku}>
                <td><b>{r.sku}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</span></td>
                <td className="num">{fmt.num(r.baseline)}</td>
                <td className="num">{fmt.num(r.firm_soc)}</td>
                <td><Tag kind={r.signal === "accelerating" ? "soft" : r.signal === "softening" ? "light" : "none"}>{r.signal}</Tag></td>
                <td className="num">{fmt.num(r.sensed_near_term)}</td>
                <td className="num">{fmt.signed(r.adjustment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
