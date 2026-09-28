import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Tag, Stat } from "../components/ui.jsx";
import VookiCharts from "../components/VookiCharts.jsx";
import { SprayCan, ClipboardList, Factory, Package, Download } from "lucide-react";

const NetCell = ({ v }) => <span className={v > 0 ? "num-pos" : "num-zero"}>{fmt.num(v)}</span>;

const LEAD_AMBER = 30, LEAD_RED = 60;   // days
const leadColor = (d) => (d == null ? "var(--muted)" : d >= LEAD_RED ? "#a11" : d >= LEAD_AMBER ? "#8a6d00" : "#1a7d4f");
const LeadCell = ({ v }) => (
  <span style={{ color: leadColor(v), fontWeight: v != null && v >= LEAD_AMBER ? 600 : 400 }}>
    {v == null ? "—" : `${fmt.num(v, 1)}d`}
  </span>
);

const PILL = { padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };
function Badge({ map, k }) {
  const [bg, fg, txt] = map[k] || map._default;
  return <span style={{ ...PILL, background: bg, color: fg }}>{txt}</span>;
}
const URG = {
  "order-now": ["#fdecec", "#b23b3b", "Order now"], "order-soon": ["#fff6e6", "#8a6d00", "Order soon"],
  routine: ["#eef4fb", "#1768c4", "Routine"], covered: ["#e6f4ea", "#1a7d4f", "✓ Covered"], _default: ["#eef1f5", "#5b6675", "Plan"],
};
const READY = {
  ready: ["#e6f4ea", "#1a7d4f", "✓ Ready"], partial: ["#fff6e6", "#8a6d00", "Partial"],
  blocked: ["#fdecec", "#b23b3b", "Blocked"], _default: ["#eef1f5", "#5b6675", "—"],
};
const urgencyOf = (net, lead) => (net <= 0 ? "covered" : lead == null ? "_default" : lead >= LEAD_RED ? "order-now" : lead >= LEAD_AMBER ? "order-soon" : "routine");

function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const mul = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va ?? "").localeCompare(String(vb ?? "")) * mul;
  });
}

function SortTh({ label, k, sort, setSort, className }) {
  const active = sort.key === k;
  return (
    <th className={className} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} title="Click to sort"
      onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }))}>
      {label}<span style={{ color: active ? "inherit" : "var(--border)", fontSize: 10 }}>{active ? (sort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
    </th>
  );
}

// One Vooki product as an expandable card (replaces the wide By-product table row)
function VookiProductCard({ p, decode, qty, setQty, bomIdx, setBomIdx, open, setOpen, grossOf, netOf, rowBusy, downloadOne }) {
  const isOpen = open === p.name;
  const b = p.boms[Math.min(bomIdx[p.name] || 0, p.boms.length - 1)];
  const rmbuy = p._rmbuy;
  const toggle = () => p.has_bom && setOpen(isOpen ? null : p.name);
  return (
    <div className={"sc-card vk-card" + (isOpen ? " open" : "")}>
      <div className="sc-head" role="button" tabIndex={0} onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        style={{ cursor: p.has_bom ? "pointer" : "default" }}>
        <div className="sc-head-main">
          <div className="sc-title">
            {p.has_bom && <span className="sc-caret">{isOpen ? "▾" : "▸"}</span>}
            <span className="sc-name">{p.name}</span>
          </div>
          <div className="sc-chips">
            {p.has_bom ? <Tag kind="none">{b.designator || "BOM"}</Tag> : <Tag kind="light">no BOM</Tag>}
            {p.alternatives > 0 && <span className="chip" style={{ cursor: "default", fontSize: 10, fontWeight: 700, background: "#eef4fb", borderColor: "#cfe0f2" }}>{p.alternatives} alt BOM</span>}
          </div>
        </div>
        <div className="sc-head-make">
          <div className="sc-make">
            <div className="sc-make-label">RM to buy</div>
            <div className="sc-make-val" style={{ color: rmbuy > 0 ? "var(--red)" : "var(--green)" }}>{fmt.num(rmbuy)}<span className="sc-unit"> KG</span></div>
          </div>
        </div>
      </div>

      <div className="sc-metrics vk-metrics">
        <div className="sc-metric">
          <div className="l">Plan Qty</div>
          <input type="number" min="0" className="searchbox vk-qty" value={qty[p.name] ?? ""} placeholder="0"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setQty({ ...qty, [p.name]: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="sc-metric"><div className="l">FG stock (u)</div><div className="v">{fmt.num(p.fg_units)}</div></div>
        <div className="sc-metric"><div className="l">FG (KG/L)</div><div className="v">{fmt.num(p.fg_volume_l)}</div></div>
        <div className="sc-metric" title="Min = main RM stock only · Max = + subs + in-transit">
          <div className="l">Min / Max qty</div>
          <div className="v"><span style={{ color: "#1a7d4f" }}>{fmt.num(p._min)}</span><span className="sc-muted">/</span><span style={{ color: "#1768c4" }}>{fmt.num(p._max)}</span></div>
        </div>
        <div className="sc-metric" title={`Producible from on-hand MFG RM stock.${p.limiting_rm ? " Limited by: " + p.limiting_rm + " (avail " + fmt.num(p.limiting_rm_available) + ")" : ""}`}>
          <div className="l">Producible (RM)</div>
          <div className="v" style={{ color: "#7b2d8e" }}>{fmt.num(p.producible_now)}</div>
        </div>
      </div>

      {isOpen && p.has_bom && (
        <div className="sc-body">
          {p.boms.length > 1 && (
            <div style={{ marginBottom: 8, fontSize: 12 }}>
              <b>BOM:</b>{" "}
              {p.boms.map((bb, k) => (
                <button key={k} className="link" onClick={() => setBomIdx({ ...bomIdx, [p.name]: k })}
                  style={{ fontWeight: (bomIdx[p.name] || 0) === k ? 700 : 400, marginRight: 8 }}>
                  {bb.assembly_item}·{bb.org_code}·{bb.designator}{bb.preferred ? " (preferred)" : ""}
                </button>
              ))}
            </div>
          )}
          <div className="sc-rm">
            <div className="sc-sec-title">Raw materials — net to buy</div>
            <div className="tbl-wrap">
              <table className="subtable">
                <thead><tr><th>RM (main) + substitutes</th><th className="num">Qty/unit</th><th className="num">Gross</th>
                  <th className="num">Main stk</th><th className="num">Sub stk</th><th className="num">In-transit</th>
                  <th className="num">Available</th><th className="num" title="FG units this RM can produce from available stock">Producible</th>
                  <th className="num">Net to buy</th><th className="num" title="Avg lead time — latest 5 PO receipts">Lead time</th></tr></thead>
                <tbody>
                  {b.components.map((c, k) => (
                    <tr key={k}>
                      <td><b>{decode ? c.rm_desc : c.rm_code}</b>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{decode ? c.rm_code : c.rm_desc}
                          {c.substitutes.length > 0 && <> · subs: {c.substitutes.map((su) => `${su.desc || su.code} (${fmt.num(su.stock)})`).join(", ")}</>}</div></td>
                      <td className="num">{c.qty_per_unit}</td>
                      <td className="num">{fmt.num(grossOf(p, c))}</td>
                      <td className="num">{fmt.num(c.main_stock)}</td>
                      <td className="num">{fmt.num(c.substitute_stock)}</td>
                      <td className="num">{fmt.num(c.in_transit)}</td>
                      <td className="num">{fmt.num(c.available)}</td>
                      <td className="num">{fmt.num(c.producible)}</td>
                      <td className="num"><b><NetCell v={netOf(p, c)} /></b></td>
                      <td className="num"><LeadCell v={c.lead_time} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {p.packing_boms.length > 0 && (
            <div className="sc-rm">
              <div className="sc-sec-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><Package size={14} /> Packing BOMs (packing material)</div>
              {p.packing_boms.map((pb, k) => (
                <div className="tbl-wrap" key={k} style={{ marginBottom: 6 }}>
                  <table className="subtable">
                    <thead><tr><th>{pb.assembly_item} · {pb.org_code} · {pb.designator}</th>
                      <th className="num">Qty/unit</th><th className="num">Gross</th><th className="num">Stock</th><th className="num">Net to buy</th></tr></thead>
                    <tbody>
                      {pb.components.map((c, j) => (
                        <tr key={j}>
                          <td>{decode ? c.rm_desc : c.rm_code}</td>
                          <td className="num">{c.qty_per_unit}</td>
                          <td className="num">{fmt.num(grossOf(p, c))}</td>
                          <td className="num">{fmt.num(c.main_stock)}</td>
                          <td className="num"><b><NetCell v={netOf(p, c)} /></b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <button className="btn" disabled={rowBusy === p.name} onClick={() => downloadOne(p.name)}>
              {rowBusy === p.name ? "Exporting…" : <><Download size={15} /> Download this FG (Excel)</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Vooki() {
  const { data, loading, error } = useAsync(api.vookiPlanning);
  const [mode, setMode] = useState("product");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState({});        // product name -> planned quantity
  const [bomIdx, setBomIdx] = useState({});  // product name -> selected BOM index
  const [open, setOpen] = useState(null);    // expanded product name
  const [exporting, setExporting] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);   // product name being exported
  const [sortP, setSortP] = useState({ key: "name", dir: "asc" });
  const [sortC, setSortC] = useState({ key: "net_to_buy", dir: "desc" });

  const ready = !loading && !error && data && !data.note;
  const ql = q.toLowerCase();
  const bomOf = (p) => p.boms[Math.min(bomIdx[p.name] || 0, p.boms.length - 1)];
  const grossOf = (p, c) => (qty[p.name] || 0) * c.qty_per_unit;
  const netOf = (p, c) => Math.max(0, grossOf(p, c) - c.available);
  const rmToBuy = (p) => (p.has_bom ? bomOf(p).components.reduce((a, c) => a + netOf(p, c), 0) : 0);
  // FG qty producible from current RM: min = main stock only; max = main + subs + in-transit
  const minMax = (p) => {
    let mn = Infinity, mx = Infinity;
    if (p.has_bom) for (const c of bomOf(p).components) if (c.qty_per_unit > 0) {
      mn = Math.min(mn, c.main_stock / c.qty_per_unit);
      mx = Math.min(mx, c.available / c.qty_per_unit);
    }
    return { min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 0 };
  };

  const products = ready ? applySort(
    data.products
      .filter((p) => !q || p.name.toLowerCase().includes(ql))
      .map((p) => { const mm = minMax(p); return { ...p, _rmbuy: rmToBuy(p), _min: mm.min, _max: mm.max }; }),
    sortP) : [];
  const pg = usePagination(products, [q, sortP, qty, bomIdx, mode]);

  if (loading) return <Loading what="Vooki Planning" />;
  if (error) return <ErrorBox msg={error} />;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;
  const decode = data.decode_names;
  const plannedCount = data.products.filter((p) => (qty[p.name] || 0) > 0).length;
  const downloadOne = async (name) => {
    setRowBusy(name);
    try { await api.vookiPlanningExport(qty, name); } catch (e) { alert(e.message); } finally { setRowBusy(null); }
  };

  // consolidated RM across all products with a planned quantity
  const consMap = {};
  for (const p of data.products) {
    if (!p.has_bom || (qty[p.name] || 0) <= 0) continue;
    for (const c of bomOf(p).components) {
      const key = (c.rm_desc || c.rm_code).toUpperCase();   // consolidate by item description
      const a = consMap[key] || (consMap[key] = {
        rm_code: c.rm_code, rm_desc: c.rm_desc, gross: 0, available: c.available, fgs: new Set() });
      a.gross += grossOf(p, c);
      a.available = Math.max(a.available, c.available);      // desc-consolidated availability
      a.fgs.add(p.name);
    }
  }
  const cons = applySort(Object.values(consMap)
    .map((a) => ({ ...a, fg_count: a.fgs.size, net_to_buy: Math.max(0, a.gross - a.available) }))
    .filter((a) => !q || a.rm_code.toLowerCase().includes(ql) || (a.rm_desc || "").toLowerCase().includes(ql)),
    sortC);

  // ── per-RM index across ALL products (lead time + planned buy), for the added tables
  const rmMap = {};
  for (const p of data.products) {
    if (!p.has_bom) continue;
    const planned = (qty[p.name] || 0) > 0;
    for (const c of bomOf(p).components) {
      const key = (c.rm_desc || c.rm_code).toUpperCase();
      const a = rmMap[key] || (rmMap[key] = {
        rm_code: c.rm_code, rm_desc: c.rm_desc, available: c.available, lead: null, gross: 0, fgs: new Set() });
      a.available = Math.max(a.available, c.available);
      if (c.lead_time != null) a.lead = a.lead == null ? c.lead_time : Math.max(a.lead, c.lead_time);
      if (planned) { a.gross += grossOf(p, c); a.fgs.add(p.name); }
    }
  }
  const rmMatch = (a) => !q || a.rm_code.toLowerCase().includes(ql) || (a.rm_desc || "").toLowerCase().includes(ql);
  const rmRows = Object.values(rmMap).map((a) => ({
    ...a, fg_count: a.fgs.size, net_to_buy: Math.max(0, a.gross - a.available),
  }));

  // 1. Purchase priority — RMs to buy this plan, most urgent (long lead) first
  const purchase = rmRows.filter((a) => a.net_to_buy > 0 && rmMatch(a))
    .sort((a, b) => (b.lead ?? -1) - (a.lead ?? -1) || b.net_to_buy - a.net_to_buy);

  // 2. Production bottlenecks — the limiting RM per FG, grouped (independent of qty)
  const blkMap = {};
  for (const p of data.products) {
    if (!p.has_bom || !p.limiting_rm) continue;
    const a = blkMap[p.limiting_rm] || (blkMap[p.limiting_rm] = { rm: p.limiting_rm, available: p.limiting_rm_available ?? 0, fgs: [] });
    a.fgs.push(p.name);
  }
  const bottlenecks = Object.values(blkMap)
    .map((a) => ({ ...a, fg_count: a.fgs.length }))
    .filter((a) => !q || a.rm.toLowerCase().includes(ql) || a.fgs.some((n) => n.toLowerCase().includes(ql)))
    .sort((a, b) => b.fg_count - a.fg_count || a.available - b.available);

  // 3. Production readiness — plan qty vs producible-now (needs a plan qty)
  const readyRank = { blocked: 0, partial: 1, ready: 2 };
  const readiness = data.products
    .filter((p) => p.has_bom && (qty[p.name] || 0) > 0 && (!q || p.name.toLowerCase().includes(ql)))
    .map((p) => {
      const plan = qty[p.name] || 0, prod = p.producible_now || 0;
      const status = prod >= plan ? "ready" : prod > 0 ? "partial" : "blocked";
      return { name: p.name, plan, prod, shortfall: Math.max(0, plan - prod), status, limiting: p.limiting_rm, avail: p.limiting_rm_available };
    })
    .sort((a, b) => readyRank[a.status] - readyRank[b.status] || b.shortfall - a.shortfall);

  // 4. Lead-time watchlist — long-lead RMs (early-order alerts)
  const leadtime = rmRows.filter((a) => a.lead != null && a.lead >= LEAD_AMBER && rmMatch(a))
    .sort((a, b) => b.lead - a.lead || b.net_to_buy - a.net_to_buy);

  // unfiltered rollups for the overview charts (independent of the search box)
  const buyAll = rmRows.filter((a) => a.net_to_buy > 0);
  const bottleAll = Object.values(blkMap).map((a) => ({ ...a, fg_count: a.fgs.length })).sort((a, b) => b.fg_count - a.fg_count);
  const readyCounts = data.products.reduce((acc, p) => {
    if (!p.has_bom || (qty[p.name] || 0) <= 0) return acc;
    const plan = qty[p.name] || 0, prod = p.producible_now || 0;
    acc[prod >= plan ? "ready" : prod > 0 ? "partial" : "blocked"]++; acc.total++;
    return acc;
  }, { ready: 0, partial: 0, blocked: 0, total: 0 });

  const modeCount = { product: `${products.length} products`, consolidated: `${cons.length} RMs to plan`,
    purchase: `${purchase.length} RMs to buy`, bottlenecks: `${bottlenecks.length} limiting RMs`,
    readiness: `${readiness.length} planned products`, leadtime: `${leadtime.length} long-lead RMs` }[mode];
  const rmName = (r) => (<><b>{decode ? r.rm_desc : r.rm_code}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{decode ? r.rm_code : r.rm_desc}</div></>);
  const planHint = "Enter a plan quantity against a product (By product tab) to build this list.";

  return (
    <>
      <div className="grid cols-4 vk-stats">
        <div className="card statcard"><div className="ic"><SprayCan size={22} /></div><Stat value={fmt.num(s.products)} label="Vooki products (with BOM)" /></div>
        <div className="card statcard blue"><div className="ic"><ClipboardList size={22} /></div><Stat value={fmt.num(plannedCount)} label="Products planned (qty entered)" /></div>
        <div className="card statcard"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.rm_items_in_stock)} label="RM items in stock (Business = RM)" /></div>
        <div className="card statcard amber"><div className="ic"><Package size={22} /></div><Stat value={<span style={{ fontSize: 22, whiteSpace: "nowrap" }}>{fmt.num(s.fg_stock_units)} u · {fmt.num(s.fg_stock_volume_l)} L</span>} label="FG stock (units · KG/Lit)" /></div>
      </div>

      <VookiCharts buy={buyAll} bottlenecks={bottleAll} readyCounts={readyCounts} plannedCount={plannedCount} decode={decode} />

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "16px 0 8px" }}>
        <SegTabs value={mode} onChange={(m) => { setMode(m); setQ(""); }}
          tabs={[{ id: "product", label: "By product" }, { id: "consolidated", label: "Consolidated RM" },
            { id: "purchase", label: "Purchase priority" }, { id: "bottlenecks", label: "Bottlenecks" },
            { id: "readiness", label: "Production readiness" }, { id: "leadtime", label: "Lead-time watchlist" }]} />
        <button className="btn" style={{ marginLeft: "auto" }} disabled={exporting}
          onClick={async () => { setExporting(true); try { await api.vookiPlanningExport(qty); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting ? "Exporting…" : <><Download size={15} /> Download report (Excel)</>}
        </button>
      </div>

      <div className="pagebar">
        <SmoothInput className="searchbox" placeholder={mode === "product" || mode === "readiness" ? "Search product…" : "Search RM…"} value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{modeCount}</span>
      </div>

      {mode === "consolidated" ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <SortTh label="Raw material" k="rm_desc" sort={sortC} setSort={setSortC} />
              <SortTh label="#FG" k="fg_count" sort={sortC} setSort={setSortC} className="num" />
              <SortTh label="Gross" k="gross" sort={sortC} setSort={setSortC} className="num" />
              <SortTh label="Available" k="available" sort={sortC} setSort={setSortC} className="num" />
              <SortTh label="Net to buy" k="net_to_buy" sort={sortC} setSort={setSortC} className="num" />
            </tr></thead>
            <tbody>
              {cons.map((r, i) => (
                <tr key={i}>
                  <td><b>{decode ? r.rm_desc : r.rm_code}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{decode ? r.rm_code : r.rm_desc}</div></td>
                  <td className="num">{r.fg_count}</td>
                  <td className="num">{fmt.num(r.gross)}</td>
                  <td className="num">{fmt.num(r.available)}</td>
                  <td className="num"><b><NetCell v={r.net_to_buy} /></b></td>
                </tr>
              ))}
              {cons.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>{planHint}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : mode === "purchase" ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Raw material</th><th className="num">#FG</th><th className="num">Gross</th>
              <th className="num">Available</th><th className="num">Net to buy</th>
              <th className="num">Lead time</th><th>Action</th>
            </tr></thead>
            <tbody>
              {purchase.map((r, i) => (
                <tr key={i}>
                  <td>{rmName(r)}</td>
                  <td className="num">{r.fg_count}</td>
                  <td className="num">{fmt.num(r.gross)}</td>
                  <td className="num">{fmt.num(r.available)}</td>
                  <td className="num"><b><NetCell v={r.net_to_buy} /></b></td>
                  <td className="num"><LeadCell v={r.lead} /></td>
                  <td><Badge map={URG} k={urgencyOf(r.net_to_buy, r.lead)} /></td>
                </tr>
              ))}
              {purchase.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>{planHint}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : mode === "bottlenecks" ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Limiting raw material</th><th className="num">FGs blocked</th>
              <th className="num">RM available</th><th>Products it constrains</th>
            </tr></thead>
            <tbody>
              {bottlenecks.map((r, i) => (
                <tr key={i}>
                  <td><b>{r.rm}</b></td>
                  <td className="num"><b>{r.fg_count}</b></td>
                  <td className="num">{fmt.num(r.available)}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.fgs.slice(0, 4).join(", ")}{r.fgs.length > 4 ? ` +${r.fgs.length - 4} more` : ""}</td>
                </tr>
              ))}
              {bottlenecks.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No limiting raw materials found.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : mode === "readiness" ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Vooki product</th><th className="num">Plan qty</th><th className="num">Producible now</th>
              <th className="num">Shortfall</th><th>Status</th><th>Limiting RM</th>
            </tr></thead>
            <tbody>
              {readiness.map((r, i) => (
                <tr key={i}>
                  <td><b>{r.name}</b></td>
                  <td className="num">{fmt.num(r.plan)}</td>
                  <td className="num" style={{ color: "#7b2d8e", fontWeight: 600 }}>{fmt.num(r.prod)}</td>
                  <td className="num"><NetCell v={r.shortfall} /></td>
                  <td><Badge map={READY} k={r.status} /></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.limiting ? `${r.limiting} (avail ${fmt.num(r.avail)})` : "—"}</td>
                </tr>
              ))}
              {readiness.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>{planHint}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : mode === "leadtime" ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Raw material</th><th className="num">Lead time</th><th className="num">#FG</th>
              <th className="num">Available</th><th className="num">Net to buy</th><th>Action</th>
            </tr></thead>
            <tbody>
              {leadtime.map((r, i) => (
                <tr key={i}>
                  <td>{rmName(r)}</td>
                  <td className="num"><LeadCell v={r.lead} /></td>
                  <td className="num">{r.fg_count}</td>
                  <td className="num">{fmt.num(r.available)}</td>
                  <td className="num"><b><NetCell v={r.net_to_buy} /></b></td>
                  <td><Badge map={URG} k={urgencyOf(r.net_to_buy, r.lead)} /></td>
                </tr>
              ))}
              {leadtime.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No raw materials with a lead time ≥ {LEAD_AMBER} days.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="pagebar" style={{ margin: "0 0 8px" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Sort:</span>
            {[["name", "Name"], ["_rmbuy", "RM to buy"], ["producible_now", "Producible"], ["fg_units", "FG stock"]].map(([k, lbl]) => (
              <button key={k} className={"chip" + (sortP.key === k ? " active" : "")} style={{ margin: 0 }}
                onClick={() => setSortP((sv) => (sv.key === k ? { key: k, dir: sv.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" ? "asc" : "desc" }))}>
                {lbl}{sortP.key === k ? (sortP.dir === "asc" ? " ▲" : " ▼") : ""}
              </button>
            ))}
          </div>
          <div className="sc-grid">
            {pg.pageRows.map((p, i) => (
              <VookiProductCard key={p.name + i} p={p} decode={decode} qty={qty} setQty={setQty}
                bomIdx={bomIdx} setBomIdx={setBomIdx} open={open} setOpen={setOpen}
                grossOf={grossOf} netOf={netOf} rowBusy={rowBusy} downloadOne={downloadOne} />
            ))}
            {products.length === 0 && <div className="banner info" style={{ gridColumn: "1 / -1" }}>No products.</div>}
          </div>
          <Pagination {...pg} />
        </>
      )}
    </>
  );
}
