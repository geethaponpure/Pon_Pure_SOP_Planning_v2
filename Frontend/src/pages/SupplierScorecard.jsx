import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Factory, Package, TriangleAlert, Star, Globe } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const scoreColor = (v) => (v >= 75 ? "#1a7d4f" : v >= 50 ? "#8a6d00" : "#a11");
const scoreBg = (v) => (v >= 75 ? "#E6F6EC" : v >= 50 ? "#FFF4DA" : "#FFE5E5");

function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const mul = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    const na = va == null, nb = vb == null;
    if (na && nb) return 0;
    if (na) return 1;   // nulls always last, regardless of direction
    if (nb) return -1;
    let c;
    if (typeof va === "number" && typeof vb === "number") c = va - vb;
    else if (typeof va === "boolean" && typeof vb === "boolean") c = (va ? 1 : 0) - (vb ? 1 : 0);
    else c = String(va).localeCompare(String(vb));
    return c * mul;
  });
}

function SortTh({ label, k, sort, setSort, className }) {
  const active = sort.key === k;
  return (
    <th className={className} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title="Click to sort"
      onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }))}>
      {label}<span style={{ color: active ? "inherit" : "var(--border)", fontSize: 10 }}>{active ? (sort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
    </th>
  );
}

function Bar({ v, good = "high" }) {
  // metric 0-100 mini bar
  const pct = Math.max(0, Math.min(100, v ?? 0));
  const col = good === "high"
    ? (pct >= 80 ? "#1a7d4f" : pct >= 50 ? "#8a6d00" : "#a11")
    : "#1768c4";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: "#eee", borderRadius: 3, minWidth: 34 }}>
        <div style={{ width: `${pct}%`, height: 6, background: col, borderRadius: 3 }} />
      </div>
      <span className="num" style={{ fontSize: 12, minWidth: 34 }}>{fmt.num(v, 1)}</span>
    </div>
  );
}

export default function SupplierScorecard() {
  const { data, loading, error } = useAsync(api.supplierScorecard);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("");
  const [crit, setCrit] = useState("");
  const [minLines, setMinLines] = useState(2);
  const [open, setOpen] = useState(null);
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [exporting, setExporting] = useState(false);
  const ql = q.toLowerCase();
  const rows = (data && !data.note) ? applySort(data.suppliers.filter((x) =>
    (!q || x.vendor.toLowerCase().includes(ql)) &&
    (!trade || x.trade === trade) && x.po_lines >= minLines &&
    (!crit || (crit === "critical" && x.critical) || (crit === "sole" && x.sole_source_count > 0) ||
      (crit === "high" && x.criticality === "High"))), sort) : [];
  const pg = usePagination(rows, [q, trade, crit, minLines, sort]);
  if (loading) return <Loading what="Supplier Scorecard" />;
  if (error) return <ErrorBox msg={error} />;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;

  return (
    <>
      <PageInfo title="Supplier Scorecard">
        RM suppliers rated from the 2-year PO receipts on a weighted 0–100 score:
        <b> {s.weights}</b>. <b>OTIF</b> = on-time & in-full · <b>OTD</b> = on-time · <b>Fill</b> = received ÷ ordered ·
        <b> Price vs market</b> = supplier price vs the median price across all suppliers (currency-normalised to INR).
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <i>Note:</i> the PO export has no promised-delivery date, so <b>on-time</b> is benchmarked against each item's
          typical lead time (median across suppliers, +25% tolerance) — a relative, peer-based OTD.
        </div>
      </PageInfo>

      <div className="grid cols-4">
        <div className="card statcard"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.suppliers)} label="Suppliers (rated)" /></div>
        <div className="card statcard"><div className="ic"><Package size={22} /></div><Stat value={fmt.num(s.items_supplied)} label="RM items supplied" /></div>
        <div className="card statcard red"><div className="ic"><TriangleAlert size={22} /></div><Stat value={`${fmt.num(s.critical)} · ${fmt.num(s.sole_source)}`} label="Critical · sole-source suppliers" /></div>
        <div className="card statcard" style={{ borderLeft: `4px solid ${scoreColor(s.avg_score)}` }}>
          <div className="ic"><Star size={22} /></div><Stat value={fmt.num(s.avg_score, 1)} label="Average score" /></div>
      </div>

      <div className="pagebar" style={{ marginTop: 14 }}>
        <SmoothInput className="searchbox" placeholder="Search supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectBox className="searchbox" style={{ maxWidth: 150 }} value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">All suppliers</option>
          <option value="Domestic">Domestic</option>
          <option value="Import">Import</option>
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 170 }} value={crit} onChange={(e) => setCrit(e.target.value)}>
          <option value="">All criticality</option>
          <option value="critical">Critical only</option>
          <option value="high">High criticality</option>
          <option value="sole">Sole-source only</option>
        </SelectBox>
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
          Min PO lines
          <input type="number" value={minLines} style={{ width: 70 }} onChange={(e) => setMinLines(parseInt(e.target.value || "0", 10))} />
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{rows.length} suppliers</span>
        <button className="btn" disabled={exporting}
          onClick={async () => { setExporting(true); try { await api.supplierScorecardExport(); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting ? "Exporting…" : "⤓ Download (Excel)"}
        </button>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}></th><th>#</th>
              <SortTh label="Supplier" k="vendor" sort={sort} setSort={setSort} />
              <SortTh label="Score" k="score" sort={sort} setSort={setSort} className="num" />
              <SortTh label="OTIF" k="otif" sort={sort} setSort={setSort} />
              <SortTh label="OTD" k="otd" sort={sort} setSort={setSort} />
              <SortTh label="Fill" k="fill_rate" sort={sort} setSort={setSort} />
              <SortTh label="Avg lead" k="avg_lead_time" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Price vs mkt" k="price_vs_market" sort={sort} setSort={setSort} className="num" />
              <SortTh label="PO lines" k="po_lines" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Items" k="item_count" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Spend (₹)" k="spend" sort={sort} setSort={setSort} className="num" />
            </tr>
          </thead>
          <tbody>
            {pg.pageRows.map((x, i) => {
              const isOpen = open === x.vendor;
              return (
                <React.Fragment key={x.vendor + i}>
                  <tr className={`parent ${isOpen ? "isopen" : ""}`} style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : x.vendor)}>
                    <td style={{ color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</td>
                    <td>{pg.start + i + 1}</td>
                    <td><b>{x.vendor}</b>
                      {x.critical && <span className="chip" style={{ cursor: "default", marginLeft: 6, fontSize: 10,
                        background: x.criticality === "High" ? "#FFE5E5" : "#FFF4DA",
                        color: x.criticality === "High" ? "#a11" : "#8a6d00", borderColor: "transparent" }}><TriangleAlert size={12} style={{ verticalAlign: "-2px" }} /> {x.criticality}</span>}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        <span style={{ color: x.trade === "Import" ? "var(--red)" : "var(--muted)" }}>{x.trade === "Import" ? <><Globe size={12} style={{ verticalAlign: "-2px" }} /> Import</> : "Domestic"}</span>
                        {x.currencies.length > 0 && ` · ${x.currencies.join(", ")}`}
                        {x.locations.length > 0 && ` · ${x.locations.slice(0, 2).join(", ")}`}
                        {x.criticality_reasons.length > 0 && <> · <span style={{ color: "#a11" }}>{x.criticality_reasons.join(" · ")}</span></>}</div></td>
                    <td className="num"><span className="chip" style={{ cursor: "default", fontWeight: 700, background: scoreBg(x.score), color: scoreColor(x.score), borderColor: scoreBg(x.score) }}>{fmt.num(x.score, 1)}</span></td>
                    <td><Bar v={x.otif} /></td>
                    <td><Bar v={x.otd} /></td>
                    <td><Bar v={x.fill_rate} /></td>
                    <td className="num">{x.avg_lead_time != null ? `${fmt.num(x.avg_lead_time, 1)}d` : "—"}</td>
                    <td className="num" style={{ color: x.price_vs_market == null ? "var(--muted)" : x.price_vs_market <= 0 ? "#1a7d4f" : "#a11" }}>
                      {x.price_vs_market == null ? "—" : `${x.price_vs_market > 0 ? "+" : ""}${fmt.num(x.price_vs_market, 1)}%`}</td>
                    <td className="num">{fmt.num(x.po_lines)}</td>
                    <td className="num">{fmt.num(x.item_count)}</td>
                    <td className="num">{fmt.num(x.spend)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="expander"><td></td><td colSpan={11}>
                      {x.criticality_reasons.length > 0 && (
                        <div style={{ marginBottom: 8, padding: 8, background: "#FFF6F6", borderRadius: 6, fontSize: 12 }}>
                          <b style={{ color: "#a11" }}><TriangleAlert size={13} style={{ verticalAlign: "-2px" }} /> Criticality: {x.criticality}</b> — {x.criticality_reasons.join(" · ")}.
                          {x.sole_source_items.length > 0 && (
                            <div style={{ marginTop: 4 }}><b>Sole source for:</b> {x.sole_source_items.map((it) => `${it.name}`).join(", ")}
                              <span style={{ color: "var(--muted)" }}> — losing this supplier stops these RMs.</span></div>)}
                        </div>)}
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Items supplied (top by spend):</div>
                      <table className="subtable">
                        <thead><tr><th>Item</th><th className="num">Lines</th><th className="num">Received</th>
                          <th className="num">Avg price (₹)</th><th className="num">Market</th><th className="num">Price vs mkt</th>
                          <th className="num">Avg lead</th><th className="num">Spend (₹)</th></tr></thead>
                        <tbody>
                          {x.items.map((it, k) => (
                            <tr key={k}>
                              <td><b>{it.name}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{it.code}</div></td>
                              <td className="num">{it.lines}</td>
                              <td className="num">{fmt.num(it.received)}</td>
                              <td className="num">{it.avg_price != null ? fmt.num(it.avg_price, 2) : "—"}</td>
                              <td className="num">{it.market_price != null ? fmt.num(it.market_price, 2) : "—"}</td>
                              <td className="num" style={{ color: it.price_vs_market == null ? "var(--muted)" : it.price_vs_market <= 0 ? "#1a7d4f" : "#a11" }}>
                                {it.price_vs_market == null ? "—" : `${it.price_vs_market > 0 ? "+" : ""}${fmt.num(it.price_vs_market, 1)}%`}</td>
                              <td className="num">{it.avg_lead != null ? `${fmt.num(it.avg_lead, 1)}d` : "—"}</td>
                              <td className="num">{fmt.num(it.spend)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={12}>No suppliers match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination {...pg} />
      <div className="sub" style={{ marginTop: 8 }}>
        Score: <span style={{ color: "#1a7d4f" }}>≥75 strong</span> · <span style={{ color: "#8a6d00" }}>50–75 fair</span> ·
        <span style={{ color: "#a11" }}> &lt;50 weak</span>. Price vs market: <span style={{ color: "#1a7d4f" }}>negative = cheaper than peers</span>.
        Excel adds a per-supplier <b>Supplier-Item</b> sheet.
      </div>
    </>
  );
}
