import React, { useState } from "react";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Tag } from "../components/ui.jsx";
import PageInfo from "../components/PageInfo.jsx";

const ABC = ["A", "B", "C"];
const XYZ = ["X", "Y", "Z"];

export default function Segmentation() {
  const { data, loading, error } = useAsync(api.segmentation);
  const [tab, setTab] = useState("fg");
  if (loading) return <Loading what="segmentation" />;
  if (error) return <ErrorBox msg={error} />;

  return (
    <>
      <PageInfo title="Segmentation Policy (Section 6)">
        Differentiated policy by segment (Section 6). Finished goods and raw materials are classified
        independently: a commodity RM feeding a PTS product can still be bought to order, and a long-lead
        single-source RM feeding a PTO product can still be stocked strategically.
      </PageInfo>

      <div className="grid cols-2">
        <div className="card">
          <h3>ABC–XYZ matrix (finished goods)</h3>
          <div className="sub">ABC by value contribution · XYZ by demand variability (CoV)</div>
          <div className="matrix">
            <div className="cell hd"></div>
            {XYZ.map((x) => <div key={x} className="cell hd">{x} — {x === "X" ? "stable" : x === "Y" ? "variable" : "erratic"}</div>)}
            {ABC.map((a) => (
              <React.Fragment key={a}>
                <div className="cell hd">{a}</div>
                {XYZ.map((x) => (
                  <div className="cell" key={a + x}>
                    <div className="c-count">{data.matrix[a + x] || 0}</div>
                    <div style={{ color: "var(--muted)" }}>{a + x}</div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Policy mix</h3>
          <div className="sub">Recommended default policy per the decision rules</div>
          <PolicyMix fg={data.fg} rm={data.rm} />
        </div>
      </div>

      <div className="section-title">
        <button className={`link ${tab === "fg" ? "" : ""}`} onClick={() => setTab("fg")} style={{ fontWeight: tab === "fg" ? 700 : 400 }}>Finished goods (PTO/PTS)</button>
        {"   ·   "}
        <button className="link" onClick={() => setTab("rm")} style={{ fontWeight: tab === "rm" ? 700 : 400 }}>Raw materials (Kraljic)</button>
      </div>

      {tab === "fg" ? <FGTable rows={data.fg} /> : <RMTable rows={data.rm} />}
    </>
  );
}

function PolicyMix({ fg, rm }) {
  const fgPts = fg.filter((r) => r.policy === "PTS").length;
  const rmPts = rm.filter((r) => r.policy === "PTS").length;
  const post = fg.filter((r) => r.postponement).length;
  return (
    <table>
      <tbody>
        <tr><td>Finished goods — PTS (stock)</td><td className="num"><b>{fgPts}</b> / {fg.length}</td></tr>
        <tr><td>Finished goods — PTO (order)</td><td className="num"><b>{fg.length - fgPts}</b> / {fg.length}</td></tr>
        <tr><td>Postponement candidates</td><td className="num"><b>{post}</b></td></tr>
        <tr><td>Raw materials — PTS (strategic / buffer)</td><td className="num"><b>{rmPts}</b> / {rm.length}</td></tr>
        <tr><td>Raw materials — PTO (JIT / min-max)</td><td className="num"><b>{rm.length - rmPts}</b> / {rm.length}</td></tr>
      </tbody>
    </table>
  );
}

function FGTable({ rows }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Family</th><th>Cell</th><th className="num">Value share</th>
            <th className="num">CoV</th><th className="num">Shelf life</th><th>Policy</th><th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.sku}>
              <tr>
                <td><b>{r.sku}</b><div style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</div></td>
                <td>{r.family}</td>
                <td><Tag kind={r.abc}>{r.cell}</Tag></td>
                <td className="num">{fmt.pct(r.value_share)}</td>
                <td className="num">{fmt.num(r.cov, 2)}</td>
                <td className="num">{r.shelf_life_days}d</td>
                <td>
                  <Tag kind={r.policy}>{r.policy}</Tag>
                  {r.postponement && <Tag kind="light">postpone</Tag>}
                </td>
                <td><button className="link" onClick={() => setOpen(open === r.sku ? null : r.sku)}>{open === r.sku ? "hide" : "show"}</button></td>
              </tr>
              {open === r.sku && (
                <tr><td colSpan={8} style={{ background: "#fafcff" }}>
                  <ul className="reasons">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RMTable({ rows }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>RM</th><th className="num">Lead time</th><th className="num">Suppliers</th>
            <th className="num">Criticality</th><th>Supply risk</th><th>Kraljic</th><th>Policy</th><th>Buffer approach</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.code}>
              <tr>
                <td><b>{r.code}</b><div style={{ color: "var(--muted)", fontSize: 12 }}>{r.name}</div></td>
                <td className="num">{r.lead_time_days}d</td>
                <td className="num">{r.suppliers}</td>
                <td className="num">{fmt.num(r.criticality, 2)}</td>
                <td><Tag kind={r.supply_risk === "High" ? "hard" : r.supply_risk === "Medium" ? "soft" : "none"}>{r.supply_risk}</Tag></td>
                <td><Tag kind={r.kraljic}>{r.kraljic}</Tag></td>
                <td><Tag kind={r.policy}>{r.policy}</Tag></td>
                <td style={{ fontSize: 12 }}>{r.buffer}</td>
                <td><button className="link" onClick={() => setOpen(open === r.code ? null : r.code)}>why</button></td>
              </tr>
              {open === r.code && (
                <tr><td colSpan={9} style={{ background: "#fafcff" }}>
                  <ul className="reasons">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Review cadence: {r.review}</span>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
