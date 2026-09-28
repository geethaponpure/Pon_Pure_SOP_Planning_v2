import React from "react";
import { api } from "../api";
import { useAsync, Loading, ErrorBox, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

const ACTION_LABEL = {
  cycle_initialised: "Cycle initialised",
  confirm_projection: "Projection confirmed",
  lock_consensus: "Consensus locked",
  unlock_consensus: "Consensus unlocked",
};

export default function Audit({ version }) {
  const { data, loading, error } = useAsync(api.audit, [version]);
  if (loading) return <Loading what="audit trail" />;
  if (error) return <ErrorBox msg={error} />;

  return (
    <>
      <PageInfo title="Audit Trail (Section 13.3)">
        Single audit trail (Section 13.3) — who changed which number, when, and why (reason code).
        Permanently recorded for governance and accuracy learning.
      </PageInfo>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Timestamp (UTC)</th><th>Actor</th><th>Action</th><th>SKU</th><th>Reason code</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{e.ts.replace("T", " ").replace("+00:00", "")}</td>
                <td>{e.actor}</td>
                <td><Tag kind={e.action === "lock_consensus" ? "soft" : "light"}>{ACTION_LABEL[e.action] || e.action}</Tag></td>
                <td>{e.sku || "—"}</td>
                <td style={{ fontSize: 12 }}>{e.reason_code || "—"}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
