import React from "react";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

const TIER_KIND = { escalation: "hard", action: "soft", info: "light" };
const GATE_KIND = { complete: "none", in_progress: "soft", blocked: "hard", waiting: "light" };

export default function Governance() {
  const { data, loading, error } = useAsync(api.governance);
  if (loading) return <Loading what="governance" />;
  if (error) return <ErrorBox msg={error} />;

  const { raci, forums, risks, alerts, alert_tiers, gates, approval_threshold, maturity_path } = data;

  return (
    <>
      <PageInfo title="Governance & Collaboration (Sections 13 & 14)">
        The tool is the communication layer:
        every signal has a sender, receiver, trigger and record. Overrides above {fmt.money(approval_threshold)}
        {" "}value-at-risk require named electronic approval. Maturity path: {maturity_path}.
      </PageInfo>

      <div className="grid cols-4">
        <div className="card"><Stat value={alert_tiers.escalation || 0} label="Escalations (SLA breach / high VaR)" /></div>
        <div className="card"><Stat value={alert_tiers.action || 0} label="Action-required" /></div>
        <div className="card"><Stat value={alert_tiers.info || 0} label="FYI / information" /></div>
        <div className="card"><Stat value={gates.filter((g) => g.status === "complete").length + "/" + gates.length} label="Cadence gates complete" /></div>
      </div>

      <div className="section-title">S&amp;OP / IBP cadence — gated steps (Section 14)</div>
      <div className="card">
        <table>
          <thead><tr><th>Step</th><th>Entry criteria</th><th>Exit criteria</th><th>Owner</th><th>Status</th></tr></thead>
          <tbody>
            {gates.map((g) => (
              <tr key={g.step}>
                <td><b>{g.step}</b>{g.detail && <div style={{ fontSize: 12, color: "var(--muted)" }}>{g.detail}</div>}</td>
                <td style={{ fontSize: 12 }}>{g.entry}</td>
                <td style={{ fontSize: 12 }}>{g.exit}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{g.owner}</td>
                <td><Tag kind={GATE_KIND[g.status] || "light"}>{g.status.replace("_", " ")}</Tag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Tiered alert inbox (Section 13.3)</div>
      <div className="card">
        <table>
          <thead><tr><th>Tier</th><th>Owner</th><th>Title</th><th>Detail</th></tr></thead>
          <tbody>
            {alerts.map((a, i) => (
              <tr key={i}>
                <td><Tag kind={TIER_KIND[a.tier]}>{a.tier}</Tag></td>
                <td>{a.owner}</td>
                <td><b>{a.title}</b></td>
                <td style={{ fontSize: 12 }}>{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2">
        <div>
          <div className="section-title">RACI — planning cycle (Section 13.2)</div>
          <div className="card">
            <table>
              <thead><tr><th>Activity</th><th>R</th><th>A</th><th>C</th><th>I</th></tr></thead>
              <tbody>
                {raci.map((r) => (
                  <tr key={r.activity}>
                    <td style={{ fontSize: 12 }}>{r.activity}</td>
                    <td style={{ fontSize: 12 }}>{r.R}</td>
                    <td style={{ fontSize: 12 }}>{r.A}</td>
                    <td style={{ fontSize: 12 }}>{r.C}</td>
                    <td style={{ fontSize: 12 }}>{r.I}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="section-title">Communication cadence (Section 13.4)</div>
          <div className="card">
            <table>
              <thead><tr><th>Forum</th><th>Frequency</th><th>Owner</th></tr></thead>
              <tbody>
                {forums.map((f) => (
                  <tr key={f.forum} title={f.purpose}>
                    <td style={{ fontSize: 12 }}><b>{f.forum}</b></td>
                    <td style={{ fontSize: 12 }}>{f.frequency}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section-title">Risks &amp; mitigations (Section 16)</div>
      <div className="card">
        <table>
          <thead><tr><th>Risk</th><th>Impact</th><th>Mitigation</th></tr></thead>
          <tbody>
            {risks.map((r) => (
              <tr key={r.risk}>
                <td style={{ fontSize: 12 }}><b>{r.risk}</b></td>
                <td style={{ fontSize: 12 }}>{r.impact}</td>
                <td style={{ fontSize: 12 }}>{r.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
