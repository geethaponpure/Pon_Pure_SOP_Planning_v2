import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Hourglass, Calculator, Wallet, TrendingUp, CalendarDays } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const inr = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);

export default function PPV() {
  const { data, loading, error } = useAsync(api.ppv);
  const [q, setQ] = useState("");
  const [seg1, setSeg1] = useState("");
  const [seg2, setSeg2] = useState("");
  const [seg3, setSeg3] = useState("");
  const [exporting, setExporting] = useState(false);
  const ql0 = q.toLowerCase();
  const pgItems = (data?.items || []).filter((i) =>
    (!q || i.name.toLowerCase().includes(ql0) || i.code.toLowerCase().includes(ql0)) &&
    (!seg1 || i.segment1 === seg1) && (!seg2 || i.segment2 === seg2) && (!seg3 || i.segment3 === seg3));
  const pg = usePagination(pgItems, [q, seg1, seg2, seg3]);
  if (loading) return <Loading what="PPV Scorecard" />;
  if (error) return <ErrorBox msg={error} />;
  if (data.note && (!data.jc_performance || data.jc_performance.length === 0))
    return (
      <>
        <div className="banner info">
          <b>Purchase Price Variance (PPV).</b> Standard = weighted-average price over FY{data.std_fy}.
          Evaluating <b>FY{data.eval_fy}</b> purchases (from {data.eval_from}) JC-wise.
        </div>
        <div className="banner warn" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 7 }}><Hourglass size={15} /> {data.note}</div>
      </>
    );

  const s = data.summary;
  const ql = q.toLowerCase();
  const seg1opts = [...new Set(data.items.map((i) => i.segment1).filter(Boolean))].sort();
  const seg2opts = [...new Set(data.items.filter((i) => !seg1 || i.segment1 === seg1).map((i) => i.segment2).filter(Boolean))].sort();
  const seg3opts = [...new Set(data.items.filter((i) => (!seg1 || i.segment1 === seg1) && (!seg2 || i.segment2 === seg2)).map((i) => i.segment3).filter(Boolean))].sort();
  const items = data.items.filter((i) =>
    (!q || i.name.toLowerCase().includes(ql) || i.code.toLowerCase().includes(ql)) &&
    (!seg1 || i.segment1 === seg1) && (!seg2 || i.segment2 === seg2) && (!seg3 || i.segment3 === seg3));
  const maxPpv = Math.max(1, ...data.jc_performance.map((j) => Math.abs(j.ppv)));

  return (
    <>
      <PageInfo title="Purchase Price Variance (PPV)">
        Standard = <b>weighted-average price over FY{data.std_fy}</b>;
        evaluating <b>FY{data.eval_fy}</b> purchases (from {data.eval_from}) JC-wise. Each JC's actual weighted price is
        compared to the standard → <span style={{ color: "#1a7d4f" }}>favourable</span> (bought below)
        or <span style={{ color: "#a11" }}>unfavourable</span> (above). A purchase-team review per JC.
      </PageInfo>

      <div className="grid cols-4">
        <div className="card statcard"><div className="ic"><Calculator size={22} /></div><Stat value={fmt.num(s.std_items)} label="Items with standard" /></div>
        <div className="card statcard"><div className="ic"><Wallet size={22} /></div><Stat value={inr(s.total_spend)} label={`Total spend (FY${data.std_fy})`} /></div>
        <div className="card statcard red"><div className="ic"><TrendingUp size={22} /></div><Stat value={`${inr(s.timing_overspend)} · ${s.timing_overspend_pct}%`} label="Timing overspend (vs annual WAP)" /></div>
        <div className="card statcard"><div className="ic"><CalendarDays size={22} /></div><Stat value={`JC${s.best_jc} / JC${s.worst_jc}`} label="Best / worst JC" /></div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>JC-wise performance vs FY{data.std_fy} standard</h3>
        <table>
          <thead><tr><th>JC</th><th className="num">Qty</th><th className="num">Spend</th>
            <th>PPV (favourable ◀ | ▶ unfavourable)</th><th className="num">PPV %</th><th>Status</th></tr></thead>
          <tbody>
            {data.jc_performance.map((j) => {
              const w = Math.abs(j.ppv) / maxPpv * 100;
              const fav = j.ppv < 0;
              return (
                <tr key={j.jc}>
                  <td><b>JC{j.jc}</b></td>
                  <td className="num">{fmt.num(j.qty)}</td>
                  <td className="num">{inr(j.spend)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", height: 16 }}>
                      <div style={{ width: "50%", display: "flex", justifyContent: "flex-end" }}>
                        {fav && <div style={{ width: `${w}%`, height: 12, background: "#1a7d4f", borderRadius: "3px 0 0 3px" }} />}
                      </div>
                      <div style={{ width: 1, height: 16, background: "#ccc" }} />
                      <div style={{ width: "50%" }}>
                        {!fav && <div style={{ width: `${w}%`, height: 12, background: "#c0392b", borderRadius: "0 3px 3px 0" }} />}
                      </div>
                    </div>
                  </td>
                  <td className="num" style={{ color: fav ? "#1a7d4f" : "#a11", fontWeight: 600 }}>{j.ppv_pct > 0 ? "+" : ""}{j.ppv_pct}%</td>
                  <td><span className={fav ? "pill-ok" : "pill-buy"} style={!fav ? { background: "#FFE5E5", color: "#a11" } : {}}>{fav ? "Favourable" : "Unfavourable"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pagebar" style={{ marginTop: 14 }}>
        <SmoothInput className="searchbox" placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectBox className="searchbox" style={{ maxWidth: 190 }} value={seg1} onChange={(e) => { setSeg1(e.target.value); setSeg2(""); setSeg3(""); }}>
          <option value="">All Segment 1</option>
          {seg1opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 190 }} value={seg2} onChange={(e) => { setSeg2(e.target.value); setSeg3(""); }}>
          <option value="">All Segment 2</option>
          {seg2opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 190 }} value={seg3} onChange={(e) => setSeg3(e.target.value)}>
          <option value="">All Segment 3</option>
          {seg3opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{items.length} items (by timing overspend)</span>
        <button className="btn" disabled={exporting}
          onClick={async () => { setExporting(true); try { await api.ppvExport(); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting ? "Exporting…" : "⤓ Download (Excel)"}
        </button>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Item</th><th className="num">Std price (₹)</th><th className="num">Min</th><th className="num">Max</th>
            <th className="num">Volatility</th><th className="num">JCs ▲/▼</th><th className="num">Timing overspend</th><th className="num">Worst JC</th><th className="num">Spend</th></tr></thead>
          <tbody>
            {pg.pageRows.map((it, k) => (
              <tr key={k}>
                <td><b>{it.name}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {it.code}{[it.segment1, it.segment2, it.segment3].filter(Boolean).length ? ` · ${[it.segment1, it.segment2, it.segment3].filter(Boolean).join(" / ")}` : ""}</div></td>
                <td className="num">{fmt.num(it.std_price, 2)}</td>
                <td className="num">{fmt.num(it.min_price, 2)}</td>
                <td className="num">{fmt.num(it.max_price, 2)}</td>
                <td className="num" style={{ color: it.volatility_pct >= 20 ? "#a11" : "var(--text)" }}>{fmt.num(it.volatility_pct, 1)}%</td>
                <td className="num">{it.jcs_above}/{it.jcs_below}</td>
                <td className="num" style={{ color: it.timing_overspend > 0 ? "#a11" : "var(--muted)" }}>{inr(it.timing_overspend)}</td>
                <td className="num">{it.worst_jc != null ? `JC${it.worst_jc}` : "—"}</td>
                <td className="num">{inr(it.spend)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={9}>No items.</td></tr>}
          </tbody>
        </table>
        <Pagination {...pg} />
      </div>
      <div className="sub" style={{ marginTop: 8 }}>
        <b>Timing overspend</b> = ₹ paid above the annual WAP in unfavourable JCs (the saving available from better purchase timing).
        High <b>volatility</b> items are candidates for fixed-price contracts. Excel adds the full per-item sheet.
      </div>
    </>
  );
}
