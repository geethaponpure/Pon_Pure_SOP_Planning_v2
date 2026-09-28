import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Tag, Stat } from "../components/ui.jsx";
import { Hourglass, FlaskConical, Factory, ShoppingCart, CircleCheck, Recycle, TrendingUp } from "lucide-react";

export default function AgedRM() {
  const { data, loading, error } = useAsync(api.agedRmPlan);
  const [tab, setTab] = useState("recommended");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  if (loading) return <Loading what="Aged RM Plan" />;
  if (error) return <ErrorBox msg={error} />;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;
  const decode = data.decode_names;
  const ql = q.toLowerCase();
  const filt = (arr, keyer) => arr.filter((r) => !q || keyer(r).toLowerCase().includes(ql));

  return (
    <>
      <div className="grid cols-4">
        <div className="card statcard"><div className="ic"><Hourglass size={22} /></div><Stat value={fmt.num(s.aged_rm_items)} label={`Aged RM items (> ${data.aged_days}d)`} /></div>
        <div className="card statcard"><div className="ic"><FlaskConical size={22} /></div><Stat value={fmt.num(s.aged_rm_qty)} label="Aged RM qty (KG)" /></div>
        <div className="card statcard blue"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.fgs_producible_from_aged)} label="FGs producible from aged RM" /></div>
        <div className="card statcard amber"><div className="ic"><ShoppingCart size={22} /></div><Stat value={fmt.num(s.fgs_needing_purchase)} label="FGs needing a purchase" /></div>
      </div>
      <div className="grid cols-3" style={{ marginTop: 12 }}>
        <div className="card statcard"><div className="ic"><CircleCheck size={22} /></div><Stat value={`${fmt.num(s.recommended_fgs)} FGs`} label="Recommended to produce" /></div>
        <div className="card statcard"><div className="ic"><Recycle size={22} /></div><Stat value={`${fmt.num(s.aged_consumed_qty)} KG`} label="Aged RM consumed by plan" /></div>
        <div className="card statcard" style={{ borderLeft: `4px solid ${s.utilisation_pct >= 60 ? "var(--green)" : "var(--amber)"}` }}>
          <div className="ic"><TrendingUp size={22} /></div><Stat value={`${s.utilisation_pct}%`} label={`Aged utilisation · ${fmt.num(s.aged_left_unused)} KG left`} /></div>
      </div>

      <div style={{ margin: "16px 0 8px" }}>
        <SegTabs value={tab} onChange={setTab} tabs={[
          { id: "recommended", label: "Recommended production" },
          { id: "producible", label: `Producible from aged (${s.fgs_producible_from_aged})` },
          { id: "blocked", label: `Needs purchase (${s.fgs_needing_purchase})` },
          { id: "unused", label: "Unused aged RM" },
        ]} />
      </div>

      <div className="pagebar">
        <SmoothInput className="searchbox" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn secondary" style={{ marginLeft: "auto" }} disabled={exporting === "report"}
          title="Aged-RM excess analysis: aged qty/value vs last-3-JC consumption, sales requirement and projection requirement, with a Critical/Excess/OK status."
          onClick={async () => { setExporting("report"); try { await api.agedRmReportExport(); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting === "report" ? "Preparing…" : "⤓ Aged RM Report (Excel)"}
        </button>
        <button className="btn" disabled={exporting === "plan"}
          onClick={async () => { setExporting("plan"); try { await api.agedRmExport(); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting === "plan" ? "Exporting…" : "⤓ Download plan (Excel)"}
        </button>
      </div>

      {tab === "recommended" && <Recommended rows={filt(data.recommended, (r) => r.name)} />}
      {tab === "producible" && <Producible rows={filt(data.producible, (r) => r.name)} decode={decode} />}
      {tab === "blocked" && <Blocked rows={filt(data.blocked, (r) => r.name + " " + r.missing.join(" "))} />}
      {tab === "unused" && <Unused rows={filt(data.unused_aged_rm, (r) => r.rm_desc + " " + r.rm_code)} />}
    </>
  );
}

function Recommended({ rows }) {
  const [open, setOpen] = useState(null);
  const pg = usePagination(rows, [rows]);
  return (
    <div className="tbl-wrap">
      <div className="sub" style={{ margin: "0 0 8px" }}>Greedy plan — produce in this order to consume the most aged inventory. Shared RMs are depleted as you go, so quantities reflect contention. Click a row to see the aged RMs it draws.</div>
      <table>
        <thead>
          <tr><th style={{ width: 24 }}></th><th>#</th><th>Finished good</th>
            <th className="num">Produce (units)</th><th className="num">Aged consumed (KG)</th>
            <th className="num">Aged value</th><th className="num">Cumulative aged (KG)</th></tr>
        </thead>
        <tbody>
          {pg.pageRows.map((r, j) => {
            const i = pg.start + j;
            const isOpen = open === i;
            return (
              <React.Fragment key={i}>
                <tr className={`parent ${isOpen ? "isopen" : ""}`} style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : i)}>
                  <td style={{ color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</td>
                  <td>{i + 1}</td>
                  <td><b>{r.name}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{r.assembly_item}</div></td>
                  <td className="num">{fmt.num(r.produce_units)}</td>
                  <td className="num"><b className="num-pos">{fmt.num(r.aged_consumed)}</b></td>
                  <td className="num">{fmt.money(r.aged_value_consumed)}</td>
                  <td className="num">{fmt.num(r.cumulative_aged_consumed)}</td>
                </tr>
                {isOpen && (
                  <tr className="expander"><td></td><td colSpan={6}>
                    <b style={{ fontSize: 12 }}>Aged RM consumed:</b>{" "}
                    {r.rms_used.map((u, k) => <span key={k} className="chip" style={{ cursor: "default" }}>{u.rm_desc} · {fmt.num(u.qty)} KG</span>)}
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={7}>No finished goods can be produced from aged RM.</td></tr>}
        </tbody>
      </table>
      <Pagination {...pg} />
    </div>
  );
}

function Producible({ rows, decode }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="tbl-wrap">
      <div className="sub" style={{ margin: "0 0 8px" }}>Every required raw material has aged stock, so these can be made entirely from inventory aged past the threshold. Click to see each component's aged vs. total stock.</div>
      <table>
        <thead>
          <tr><th style={{ width: 24 }}></th><th>Finished good</th>
            <th className="num">Producible (units)</th><th className="num">Aged consumable (KG)</th>
            <th>Inputs</th><th className="num">Components</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isOpen = open === i;
            return (
              <React.Fragment key={i}>
                <tr className={`parent ${isOpen ? "isopen" : ""}`} style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : i)}>
                  <td style={{ color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</td>
                  <td><b>{r.name}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{r.assembly_item} · {r.org_code} · {r.designator}</div></td>
                  <td className="num">{fmt.num(r.producible_units)}</td>
                  <td className="num"><b>{fmt.num(r.aged_consumed)}</b></td>
                  <td>{r.needs_fresh ? <Tag kind="soft">needs fresh too</Tag> : <Tag kind="none">all from aged</Tag>}</td>
                  <td className="num">{r.components.length}</td>
                </tr>
                {isOpen && (
                  <tr className="expander"><td></td><td colSpan={5}>
                    <table className="subtable">
                      <thead><tr><th>RM</th><th className="num">Qty/unit</th><th className="num">Aged stock</th><th className="num">Total stock</th><th className="num">Oldest age</th><th>Status</th></tr></thead>
                      <tbody>
                        {r.components.map((c, k) => (
                          <tr key={k}>
                            <td><b>{decode ? c.rm_desc : c.rm_code}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{decode ? c.rm_code : c.rm_desc}</div></td>
                            <td className="num">{c.qty_per_unit}</td>
                            <td className="num"><span className={c.ok_aged ? "num-pos" : "num-zero"}>{fmt.num(c.aged_stock)}</span></td>
                            <td className="num">{fmt.num(c.total_stock)}</td>
                            <td className="num">{c.aged_age_days}d</td>
                            <td>{c.ok_aged ? <Tag kind="none">aged ✓</Tag> : c.ok_total ? <Tag kind="soft">fresh only</Tag> : <Tag kind="hard">missing</Tag>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6}>None.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Blocked({ rows }) {
  return (
    <div className="tbl-wrap">
      <div className="sub" style={{ margin: "0 0 8px" }}>These finished goods use some aged RM, but <b>not all</b> required raw materials are available — a purchase is needed before they can be produced.</div>
      <table>
        <thead><tr><th>Finished good</th><th className="num">Missing RMs</th><th>Raw materials to purchase</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><b>{r.name}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{r.assembly_item}</div></td>
              <td className="num">{r.missing.length}</td>
              <td>{r.missing.map((m, k) => <span key={k} className="pill-buy" style={{ margin: "1px 3px 1px 0", display: "inline-block" }}>{m}</span>)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={3}>None.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Unused({ rows }) {
  return (
    <div className="tbl-wrap">
      <div className="sub" style={{ margin: "0 0 8px" }}>Aged raw materials that <b>no producible finished good can consume</b> — candidates for liquidation, rework or supplier return.</div>
      <table>
        <thead><tr><th>RM</th><th className="num">Aged qty (KG)</th><th className="num">Oldest age</th><th className="num">Value</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><b>{r.rm_desc}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{r.rm_code}</div></td>
              <td className="num">{fmt.num(r.qty)}</td>
              <td className="num">{r.max_age}d</td>
              <td className="num">{fmt.money(r.value)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4}>None.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
