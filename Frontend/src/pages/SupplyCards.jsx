import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { Dropdown } from "../components/Dropdown.jsx";
import { fmt } from "../api";
import { Loading, ErrorBox, Tag, Stat } from "../components/ui.jsx";
import { useSupplyPlan } from "../SupplyPlanContext.jsx";
import { Package, ShoppingCart, CircleCheck, FlaskConical, Scale, TriangleAlert, Flag, Globe, BarChart3, CalendarDays, Receipt, Truck, ClipboardList, Pencil, Timer } from "lucide-react";
import RMDataCharts from "../components/RMDataCharts.jsx";
import CardCharts from "../components/CardCharts.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";

// ── local presentation helpers (kept self-contained so this beta page does not
// depend on Supply.jsx internals; will be merged in later) ───────────────────
const ACT = {
  manufacturing: { t: "MFG", bg: "#E3F3E8", c: "#1a7d4f" },
  repack_relabel: { t: "REPACK/RELABEL", bg: "#EAF1FF", c: "#1768c4" },
  trading: { t: "TRADING", bg: "#FDECEF", c: "#b03052" },
  internal: { t: "INTERNAL", bg: "#F0EEF6", c: "#6b5b95" },
  unclassified: { t: "UNCLASSIFIED", bg: "#F3F0E8", c: "#8a6d00" },
  none: { t: "NO BOM", bg: "#F4F4F5", c: "#888" },
};
const ActivityChip = ({ cls }) => {
  const a = ACT[cls] || ACT.none;
  return <span className="chip" style={{ cursor: "default", background: a.bg, color: a.c, borderColor: "transparent", fontSize: 10.5, fontWeight: 700 }}>{a.t}</span>;
};

const SalesFlag = ({ f }) => {
  if (!f || f === "none") return <span style={{ color: "var(--muted)" }}>—</span>;
  const map = {
    over: { t: "Over", bg: "#FFE5E5", c: "#a11" },
    under: { t: "Under", bg: "#FFF4DA", c: "#8a6d00" },
    ontrack: { t: "On track", bg: "#E6F6EC", c: "#1a7" },
    new: { t: "New", bg: "#EEF0FF", c: "#55a" },
  };
  const m = map[f] || { t: f, bg: "#eee", c: "#666" };
  return <span className="chip" style={{ cursor: "default", background: m.bg, color: m.c, borderColor: m.bg }}>{m.t}</span>;
};
const NetCell = ({ v }) => <span className={v > 0 ? "num-pos" : "num-zero"}>{fmt.num(v)}</span>;

// One row of the demand build-up table: OP · COMPONENT · QTY
export function BRow({ op, label, value, sub, hint }) {
  const tone = op === "+" ? "pos" : op === "−" ? "neg" : op === "=" ? "eq" : "";
  return (
    <div className={"sc-brow" + (sub ? " sub" : "")} title={hint || ""}>
      <span className={"sc-bop " + tone}>{op || ""}</span>
      <span className="sc-blabel">{label}</span>
      <span className={"sc-bval " + tone}>{value}</span>
    </div>
  );
}

export function ProductCard({ p, data, pjc, bi = 0, onPickBom }) {
  const [open, setOpen] = useState(false);
  const pickBom = (k) => onPickBom && onPickBom(k);
  const bom = p.boms && p.boms[bi];
  const pr = p.projection || {};
  const netSum = bom ? bom.components.reduce((a, c) => a + (c.net_total || 0), 0) : 0;
  const wh = bom ? bom.fg_stock.warehouse : 0;
  const br = bom ? bom.fg_stock.branch : 0;
  const overridden = bi !== 0 || p.overridden;

  // derived values for the coverage bar
  const prodPct = pr.mfg_required_3jc > 0
    ? Math.max(0, Math.min(100, Math.round((p.producible_qty / pr.mfg_required_3jc) * 100)))
    : (p.producible_qty > 0 ? 100 : 0);
  const coverText = pr.producible_cover || (prodPct >= 100 ? "Full" : prodPct > 0 ? "Partial" : "None");
  const coverTone = /3 JC|Full/.test(coverText) ? "ok" : /Current/.test(coverText) ? "info" : /None/.test(coverText) ? "bad" : "warn";

  const metadata = bom
    ? [bom.assembly_item, bom.org_code, bom.designator, bom.created, bom.bom_type].filter(Boolean)
    : ["No recipe — traded item"];

  const toggle = () => p.has_bom && setOpen((o) => !o);

  return (
    <div className={"sc-card" + (open ? " open" : "")}>
      {/* ── header (always visible) ─────────────────────────────── */}
      <div className="sc-head" role="button" tabIndex={0} onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        style={{ cursor: p.has_bom ? "pointer" : "default" }}>
        <div className="sc-head-main">
          <div className="sc-title">
            {p.has_bom && <span className="sc-caret">{open ? "▾" : "▸"}</span>}
            <span className="sc-name">{p.name}</span>
          </div>
          <div className="sc-chips">
            <ActivityChip cls={p.bom_class} />
            {p.msl_only && <span className="chip" style={{ cursor: "default", fontSize: 10, fontWeight: 700, background: "#EAF4FF", borderColor: "#BBD9F5" }} title="No projection this JC — topped up to MSL safety stock.">MSL top-up</span>}
            {p.pts_pto && <span className="chip" style={{ cursor: "default", fontSize: 10, fontWeight: 700, background: p.pts_pto === "PTS" ? "#E6F4EA" : "#EEF1F5", borderColor: p.pts_pto === "PTS" ? "#B7E1C4" : "#D9DEE5" }} title={p.pts_pto === "PTS" ? "Plan-To-Stock — served first in shared-RM allocation" : "Plan-To-Order — served after PTS"}>{p.pts_pto}</span>}
          </div>
          <div className="sc-meta">
            {metadata.map((m, k) => <React.Fragment key={k}>{k > 0 && <span className="sc-dot" />}<span>{m}</span></React.Fragment>)}
          </div>
        </div>
        <div className="sc-head-make">
          <div className="sc-make">
            <div className="sc-make-label">To make (JC{pjc})</div>
            <div className="sc-make-val">{fmt.num(pr.mfg_required)}<span className="sc-unit"> KG</span></div>
          </div>
          {!p.has_bom
            ? <span className="sc-status traded">Traded</span>
            : netSum > 0
              ? <span className="sc-status buy">Buy {fmt.num(netSum)}</span>
              : <span className="sc-status ok">Covered</span>}
        </div>
      </div>

      {/* ── metric strip (always visible) ───────────────────────── */}
      <div className="sc-metrics">
        <div className="sc-metric">
          <div className="l">3-JC req</div>
          <div className="v">{fmt.num(pr.mfg_required_3jc)}</div>
        </div>
        <div className="sc-metric">
          <div className="l">Producible</div>
          <div className="v">{p.has_bom ? fmt.num(p.producible_qty) : "—"}{p.has_bom && <span className={"sc-badge " + coverTone}>{coverText}</span>}</div>
          {p.has_bom && <div className="sc-bar"><span className="sc-track"><i className={"sc-fill " + coverTone} style={{ width: prodPct + "%" }} /></span><span className="sc-pct">{prodPct}%</span></div>}
        </div>
        <div className="sc-metric">
          <div className="l">FG stock (W/B)</div>
          <div className="v">{fmt.num(wh)} <span className="sc-muted">/ {fmt.num(br)}</span></div>
        </div>
        <div className="sc-metric">
          <div className="l">Avg sales</div>
          <div className="v">{fmt.num(p.avg_3jc_sales)}</div>
          <div style={{ marginTop: 4 }}><SalesFlag f={p.proj_flag} /></div>
        </div>
      </div>

      {/* ── expanded detail ─────────────────────────────────────── */}
      {open && p.has_bom && bom && (
        <div className="sc-body">
          <div className="sc-body-grid">
            {/* demand build-up */}
            <div className="sc-build">
              <div className="sc-sec-title">Demand build-up</div>
              <div className="sc-build-tbl">
                <div className="sc-brow head"><span>OP</span><span>Component</span><span>Qty (KG)</span></div>
                <BRow label={`JC${pjc} Qty (WK1+2)`} value={fmt.num(pr.current_target)} />
                <BRow op="+" label="MFG SOC pending" value={fmt.num(pr.mfg_soc)} hint="Pending sales-order commitments still to manufacture" />
                <BRow op="=" label={`JC${pjc} Qty`} value={fmt.num(pr.current)} sub />
                <BRow op="+" label={`JC${pjc + 1} Qty`} value={fmt.num(pr.next1)} />
                <BRow op="+" label={`JC${pjc + 2} Qty`} value={fmt.num(pr.next2)} />
                <BRow op="=" label="3-JC total" value={fmt.num(pr.total)} sub />
                <BRow op="+" label="MSL safety buffer" value={fmt.num(pr.msl)} hint="Min-stock-level buffer for valid items" />
                <BRow op="−" label="On-hand FG (WH + Branch)" value={fmt.num(wh + br)} hint="Netted off — already in stock" />
              </div>
              <div className="sc-req">
                <div className="sc-req-box"><span>Mfg required — JC{pjc}</span><b>{fmt.num(pr.mfg_required)}</b></div>
                <div className="sc-req-box"><span>Mfg required — 3-JC</span><b>{fmt.num(pr.mfg_required_3jc)}</b></div>
              </div>
              {pr.overall_soc > 0 && <div className="sc-build-note">Overall SOC (context): {fmt.num(pr.overall_soc)} KG</div>}
            </div>

            {/* bom + coverage summary */}
            <div className="sc-side">
              <div className="sc-sec-title">This BOM</div>
              <div className="sc-kv"><span>Recipe</span><b>{bom.assembly_item} · {bom.org_code} · {bom.designator}</b></div>
              <div className="sc-kv"><span>Selection</span>{overridden ? <Tag kind="soft">overridden</Tag> : <Tag kind="none">preferred</Tag>}</div>
              <div className="sc-kv"><span>FG stock</span><b>WH {fmt.num(wh)} · Branch {fmt.num(br)}</b></div>
              <div className="sc-kv"><span>RM status</span>{netSum > 0 ? <span className="pill-buy">buy {fmt.num(netSum)} KG</span> : <span className="pill-ok">covered</span>}</div>
              <div className="sc-kv"><span>Producible</span><b>{fmt.num(p.producible_qty)} KG</b></div>
              {p.alternatives > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Dropdown.Root>
                    <Dropdown.Trigger className="dd-trigger-sm">
                      Switch BOM ({p.alternatives} alt)
                      <span className="dd-trigger-caret" aria-hidden>▾</span>
                    </Dropdown.Trigger>
                    <Dropdown.Popover className="dd-bom-pop">
                      <Dropdown.Menu>
                        {p.boms.map((a, k) => (
                          <Dropdown.Item key={k} className={k === bi ? "is-selected" : ""}
                            onAction={() => pickBom(k)}>
                            {a.assembly_item} · {a.org_code} · {a.designator}{a.preferred ? " ★" : ""}
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown.Root>
                </div>
              )}
            </div>
          </div>

          {/* insight charts (only when the card is open → no cost when collapsed) */}
          <div className="sc-rm">
            <div className="sc-sec-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><BarChart3 size={14} /> Insights</div>
            <CardCharts p={p} bom={bom} pr={pr} pjc={pjc} wh={wh} br={br} data={data} />
          </div>

          {/* RM components */}
          {bom.components.length > 0 && (
            <div className="sc-rm">
              <div className="sc-sec-title">Raw materials — net to buy</div>
              <div className="tbl-wrap">
                <table className="subtable rm-net">
                  <thead>
                    <tr><th>Seq</th><th>RM (main) + substitutes</th><th className="num">Qty/unit</th>
                      <th className="grp" colSpan={4}>Gross requirement (KG)</th>
                      <th className="num">Main stk</th><th className="num">Sub stk</th>
                      <th className="num">Received</th><th className="num">In-transit</th>
                      <th className="grp" colSpan={4}>Net to buy (KG)</th></tr>
                    <tr><th></th><th></th><th></th>
                      <th className="num cg-proj">Curr</th><th className="num cg-proj">N1</th><th className="num cg-proj">N2</th><th className="num cg-proj">Total</th>
                      <th></th><th></th><th></th><th></th>
                      <th className="num cg-net">Curr</th><th className="num cg-net">N1</th><th className="num cg-net">N2</th><th className="num cg-net">Total</th></tr>
                  </thead>
                  <tbody>
                    {bom.components.map((c, k) => (
                      <tr key={k}>
                        <td>{c.seq}</td>
                        <td><b>{data.decode_names ? c.rm_desc : c.rm_code}</b>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{data.decode_names ? c.rm_code : c.rm_desc}
                            {c.substitutes.length > 0 && <> · subs: {c.substitutes.map((su) => `${su.desc || su.code} [${su.code}] (${fmt.num(su.stock)})`).join(", ")}</>}</div></td>
                        <td className="num">{c.qty_per_unit}</td>
                        <td className="num cg-proj">{fmt.num(c.gross.current)}</td>
                        <td className="num cg-proj">{fmt.num(c.gross.next1)}</td>
                        <td className="num cg-proj">{fmt.num(c.gross.next2)}</td>
                        <td className="num cg-proj"><b>{fmt.num(c.gross_total)}</b></td>
                        <td className="num">{fmt.num(c.main_stock)}</td>
                        <td className="num">{fmt.num(c.substitute_stock)}</td>
                        <td className="num">{fmt.num(c.received)}</td>
                        <td className="num">{fmt.num(c.in_transit)}</td>
                        <td className="num cg-net"><NetCell v={c.net_to_buy.current} /></td>
                        <td className="num cg-net"><NetCell v={c.net_to_buy.next1} /></td>
                        <td className="num cg-net"><NetCell v={c.net_to_buy.next2} /></td>
                        <td className="num cg-net"><b><NetCell v={c.net_total} /></b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* packing BOMs */}
          {p.packing_boms && p.packing_boms.length > 0 && (
            <div className="sc-rm">
              <div className="sc-sec-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><Package size={14} /> Packing BOMs ({p.packing_boms.length})</div>
              {p.packing_boms.map((pb, pk) => (
                <div key={pk} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
                    <b>{pb.assembly_item}</b> · {pb.org_code} · {pb.designator} · FG W {fmt.num(pb.fg_stock.warehouse)} / B {fmt.num(pb.fg_stock.branch)}
                  </div>
                  <div className="tbl-wrap">
                    <table className="subtable">
                      <thead>
                        <tr><th>Seq</th><th>Packing / component</th><th className="num">Qty/unit</th>
                          <th className="num">Gross total</th><th className="num">Stock</th>
                          <th className="num">In-transit</th><th className="num cg-net">Net to buy</th></tr>
                      </thead>
                      <tbody>
                        {pb.components.map((c, ck) => (
                          <tr key={ck}>
                            <td>{c.seq}</td>
                            <td><b>{data.decode_names ? c.rm_desc : c.rm_code}</b>
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{data.decode_names ? c.rm_code : c.rm_desc}</div></td>
                            <td className="num">{c.qty_per_unit}</td>
                            <td className="num"><b>{fmt.num(c.gross_total)}</b></td>
                            <td className="num">{fmt.num(c.main_stock)}</td>
                            <td className="num">{fmt.num(c.in_transit)}</td>
                            <td className="num cg-net"><b><NetCell v={c.net_total} /></b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RmPlanChip({ r, pjc }) {
  // Available (RM on hand for the lead-time horizon → no purchase) vs Buy-in-JCs.
  const lbl = (k) => k === "current" ? `JC${pjc}` : k === "next1" ? `JC${pjc + 1}` : `JC${pjc + 2}`;
  if (!r.to_buy) {
    return <span className="chip" title="Raw material available — no purchase needed this cycle" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6, cursor: "default", fontSize: 10, fontWeight: 700, background: "#E6F4EA", color: "#1a7d4f", borderColor: "transparent" }}><CircleCheck size={12} /> Available</span>;
  }
  const jcs = (r.buy_jcs && r.buy_jcs.length ? r.buy_jcs : r.planned_jcs || []).map(lbl).join(", ");
  return <span className="chip" title="Not available — plan the shortfall by lead time (≤30d: current · 31–60d: +next · >60d: all 3)" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6, cursor: "default", fontSize: 10, fontWeight: 700, background: "#FDECEC", color: "#b23b3b", borderColor: "transparent" }}><ShoppingCart size={12} /> Buy {jcs}</span>;
}

function RmActivityChip({ a }) {
  if (!a) return null;
  const has = (k) => a.includes(k);
  const bg = has("Manufacturing") && has("Repack") ? "#EFE9FB"
    : has("Manufacturing") ? "#E6F4EA" : has("Repack") ? "#FDECEC"
      : a === "Packing" ? "#EEF6FF" : "#F3F0E8";
  const c = has("Manufacturing") && has("Repack") ? "#5b3fa0"
    : has("Manufacturing") ? "#1a7d4f" : has("Repack") ? "#b23b3b"
      : a === "Packing" ? "#2b6cb0" : "#8a6d00";
  return <span className="chip" title={`Used in ${a} finished goods`} style={{ marginLeft: 6, cursor: "default", background: bg, color: c, borderColor: "transparent", fontSize: 10, fontWeight: 700 }}>{a}</span>;
}

function UnmatchedIntransit({ items }) {
  const [open, setOpen] = useState(false);
  if (!items || !items.length) return null;
  const total = items.reduce((a, x) => a + (x.in_transit || 0), 0);
  return (
    <div className="banner" style={{ marginBottom: 14, background: "#FFF7E6", border: "1px solid #F0D8A0" }}>
      <div style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <TriangleAlert size={14} style={{ verticalAlign: "-2px" }} /> <b>{items.length} item(s) with open-PO in-transit ({fmt.num(total)} KG) are NOT matched to any planned BOM RM.</b>{" "}
        These are bought/in-transit but absent from every recipe in scope, or a code/description mismatch (also in the report's <b>“In-transit Unmatched”</b> sheet). <button className="link">{open ? "hide" : "show"}</button>
      </div>
      {open && (
        <div className="tbl-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Item Description</th><th>Item Code</th><th className="num">In-transit (KG)</th><th className="num">#PO lines</th><th>Latest PO</th><th>Vendors</th></tr></thead>
            <tbody>
              {items.map((u, i) => (
                <tr key={i}>
                  <td><b>{u.item_desc}</b></td><td>{u.item_code}</td>
                  <td className="num">{fmt.num(u.in_transit)}</td><td className="num">{u.po_count}</td>
                  <td>{u.latest_po}</td><td style={{ fontSize: 11, color: "var(--muted)" }}>{(u.vendors || []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>)}
    </div>
  );
}

// Shared RM card — used by both Consolidated RM and Real RM (exploded).
// Row shapes are near-identical; type-specific fields render only when present.
function RmCard({ r, pjc }) {
  const [open, setOpen] = useState(false);
  const hasSub = r.substitute_stock != null;
  const buy = r.net_total > 0;
  const codeLine = r.code_count > 1
    ? `${r.code_count} item codes · ${(r.rm_codes || []).slice(0, 4).join(", ")}${r.code_count > 4 ? "…" : ""}`
    : r.rm_code;
  const metaBits = [];
  if (r.avg_lead_time_days != null) metaBits.push(<><Timer size={11} style={{ verticalAlign: "-1px" }} /> lead {fmt.num(r.avg_lead_time_days)}d (+7 = {fmt.num(r.lead_total_days)}d)</>);
  else if (r.lead_total_days != null) metaBits.push(<><Timer size={11} style={{ verticalAlign: "-1px" }} /> {fmt.num(r.lead_total_days)}d</>);
  if (r.trade) metaBits.push(r.trade === "Import" ? "Import" : "Domestic");
  if (r.currencies && r.currencies.length) metaBits.push(r.currencies.join(", "));

  return (
    <div className={"sc-card" + (open ? " open" : "")}>
      <div className="sc-head" role="button" tabIndex={0} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ cursor: "pointer" }}>
        <div className="sc-head-main">
          <div className="sc-title">
            <span className="sc-caret">{open ? "▾" : "▸"}</span>
            <span className="sc-name">{r.rm_desc || r.rm_code}</span>
          </div>
          <div className="sc-chips">
            <RmActivityChip a={r.activity} />
            <RmPlanChip r={r} pjc={pjc} />
            {r.business && <span className="chip" style={{ cursor: "default", fontSize: 10, background: /raw material/i.test(r.business) ? "#EEF6FF" : "#FFF4DA", borderColor: /raw material/i.test(r.business) ? "#CFE4FB" : "#F0D8A0" }}>{r.business}</span>}
            {r.unresolved && <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "default", fontSize: 10, fontWeight: 700, background: "#FDE9CF", color: "#a15c00", borderColor: "#F0D8A0" }} title="Encoded intermediate with a circular BOM — could not be exploded to raw materials."><TriangleAlert size={12} /> Unresolved</span>}
            {r.via_intermediate && <span className="chip" style={{ cursor: "default", fontSize: 10, background: "#FFF4DA", borderColor: "#F0D8A0" }} title={`Exploded from intermediate(s): ${(r.from_intermediates || []).join(", ")}`}>via {(r.from_intermediates || [])[0]}{(r.from_intermediates || []).length > 1 ? ` +${r.from_intermediates.length - 1}` : ""}</span>}
            {r.has_encoded_stock && <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "default", fontSize: 10, fontWeight: 700, background: "#EDE7F6", color: "#5b3fa0", borderColor: "#D6C8F0" }} title={`${fmt.num(r.encoded_stock)} KG held under encoded name ${r.encoded_names || "?"}, merged into Stock.`}><Flag size={12} /> encoded stock</span>}
          </div>
          <div className="sc-meta">
            <span>{codeLine}</span>
            {metaBits.map((m, k) => <React.Fragment key={k}><span className="sc-dot" /><span>{m}</span></React.Fragment>)}
          </div>
        </div>
        <div className="sc-head-make">
          <div className="sc-make">
            <div className="sc-make-label">To buy (total)</div>
            <div className="sc-make-val">{fmt.num(r.net_total)}<span className="sc-unit"> KG</span></div>
          </div>
          {buy
            ? <span className="sc-status buy">Buy {fmt.num(r.net_total)}</span>
            : <span className="sc-status ok">Covered</span>}
        </div>
      </div>

      <div className="sc-metrics">
        <div className="sc-metric"><div className="l">Gross total</div><div className="v">{fmt.num(r.gross_total)}</div></div>
        <div className="sc-metric"><div className="l">Stock{hasSub ? " (+sub)" : ""}</div><div className="v">{fmt.num(r.main_stock)}{hasSub && r.substitute_stock > 0 && <span className="sc-muted">+{fmt.num(r.substitute_stock)}</span>}</div></div>
        <div className="sc-metric"><div className="l">In-transit</div><div className="v">{fmt.num(r.in_transit)}</div></div>
        <div className="sc-metric"><div className="l">Used in</div><div className="v">{fmt.num(r.fg_count)} <span className="sc-muted">FG</span></div></div>
      </div>

      {open && (
        <div className="sc-body">
          <div className="sc-body-grid">
            {/* net-to-buy build-up */}
            <div className="sc-build">
              <div className="sc-sec-title">Net-to-buy build-up</div>
              <div className="sc-build-tbl">
                <div className="sc-brow head"><span>OP</span><span>Component</span><span>Qty (KG)</span></div>
                <BRow label={`Gross · JC${pjc}`} value={fmt.num(r.gross.current)} />
                <BRow op="+" label={`Gross · JC${pjc + 1}`} value={fmt.num(r.gross.next1)} />
                <BRow op="+" label={`Gross · JC${pjc + 2}`} value={fmt.num(r.gross.next2)} />
                <BRow op="=" label="Gross total" value={fmt.num(r.gross_total)} sub />
                <BRow op="−" label="Stock on hand" value={fmt.num(r.main_stock)} />
                {hasSub && <BRow op="−" label="Substitute stock" value={fmt.num(r.substitute_stock)} />}
                <BRow op="−" label="In-transit" value={fmt.num(r.in_transit)} />
                <BRow op="=" label="Available" value={fmt.num(r.available)} sub />
              </div>
              <div className="sc-req">
                <div className="sc-req-box"><span>Net to buy — total</span><b>{fmt.num(r.net_total)}</b></div>
              </div>
              <div className="sc-build-note">
                By JC — {`JC${pjc}: ${fmt.num(r.net_to_buy.current)} · JC${pjc + 1}: ${fmt.num(r.net_to_buy.next1)} · JC${pjc + 2}: ${fmt.num(r.net_to_buy.next2)}`}
              </div>
            </div>

            {/* context */}
            <div className="sc-side">
              <div className="sc-sec-title">Context</div>
              <div className="sc-kv"><span>Used in</span><b>{fmt.num(r.fg_count)} FG(s)</b></div>
              {r.fgs && r.fgs.length > 0 && <div className="sc-build-note" style={{ marginTop: 2 }}>{r.fgs.join(", ")}{r.fg_count > r.fgs.length ? " …" : ""}</div>}
              {hasSub && r.substitutes && r.substitutes.length > 0 && (
                <div className="sc-kv" style={{ marginTop: 6 }}><span>Substitutes</span><b style={{ fontWeight: 500, fontSize: 11 }}>{r.substitutes.map((su) => `${su.desc || su.code} [${su.code}] (${fmt.num(su.stock)})`).join(", ")}</b></div>
              )}
              {r.suppliers && r.suppliers.length > 0 && (
                <div className="sc-kv" style={{ marginTop: 6 }}><span>Suppliers ({r.supplier_count})</span><b style={{ fontWeight: 500, fontSize: 11 }}>{r.suppliers.join(", ")}{r.locations && r.locations.length > 0 ? ` · ${r.locations.join(", ")}` : ""}</b></div>
              )}
              {r.stock_orgs && <div className="sc-kv"><span>Stock by org</span><b style={{ fontWeight: 500, fontSize: 11 }}>{r.stock_orgs}</b></div>}
              {r.has_encoded_stock && <div className="sc-build-note" style={{ color: "#5b3fa0" }}>Includes {fmt.num(r.encoded_stock)} KG under encoded name {r.encoded_names || "(unknown)"} (merged into Stock).</div>}
              <div className="sc-build-note">Available = stock {fmt.num(r.main_stock)}{hasSub ? ` + sub ${fmt.num(r.substitute_stock)}` : ""} + in-transit {fmt.num(r.in_transit)} = {fmt.num(r.available)}{r.received != null ? ` · received ${fmt.num(r.received)}` : ""}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConsolidatedRM({ data, q, rmCls = "manufacturing", pjc = 4 }) {
  const pick = rmCls === "manufacturing"
    ? { list: data.consolidated_rm_manufacturing, cs: data.consolidated_summary_manufacturing, label: "Manufacturing" }
    : rmCls === "repack"
      ? { list: data.consolidated_rm_repack, cs: data.consolidated_summary_repack, label: "Repack / Relabel" }
      : rmCls === "packing"
        ? { list: data.consolidated_rm_packing, cs: data.consolidated_summary_packing, label: "Packing Material" }
        : { list: data.consolidated_rm, cs: data.consolidated_summary, label: "All activities" };
  const cs = pick.cs;
  const rows = (pick.list || []).filter((r) =>
    !q || r.rm_code.toLowerCase().includes(q.toLowerCase()) || (r.rm_desc || "").toLowerCase().includes(q.toLowerCase()));
  const pg = usePagination(rows, [q, rmCls]);
  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card statcard"><div className="ic"><FlaskConical size={22} /></div><Stat value={fmt.num(cs.distinct_rms)} label="Distinct RMs required" /></div>
        <div className="card statcard red"><div className="ic"><ShoppingCart size={22} /></div><Stat value={fmt.num(cs.rms_to_buy)} label="RMs to purchase (net &gt; 0)" /></div>
        <div className="card statcard amber"><div className="ic"><Scale size={22} /></div><Stat value={fmt.num(cs.total_buy_qty)} label="Total buy quantity (KG)" /></div>
      </div>
      <UnmatchedIntransit items={data.intransit_unmatched} />
      {rows.length === 0
        ? <div className="banner info">No raw materials match the current filter.</div>
        : <div className="sc-grid">
            {pg.pageRows.map((r, i) => <RmCard key={i} r={r} pjc={pjc} />)}
          </div>}
      <Pagination {...pg} />
      <div className="sub" style={{ marginTop: 8 }}>{rows.length} of {cs.distinct_rms} RMs shown. Net-to-buy: <span className="num-pos">red = buy</span> · <span className="num-zero">green = covered</span>. One RM used by multiple FGs is summed into a single purchase quantity.</div>
    </>
  );
}

function RealRM({ data, q, pjc }) {
  const cs = data.real_rm_summary || {};
  const list = data.real_rm_requirement || [];
  const rows = list.filter((r) =>
    !q || (r.rm_code || "").toLowerCase().includes(q.toLowerCase()) || (r.rm_desc || "").toLowerCase().includes(q.toLowerCase()));
  const pg = usePagination(rows, [q]);
  return (
    <>
      {cs.unresolved_intermediates > 0 && (
        <div className="banner" style={{ marginBottom: 14, background: "#FFF7E6", border: "1px solid #F0D8A0" }}>
          <TriangleAlert size={14} style={{ verticalAlign: "-2px" }} /> <b>{fmt.num(cs.unresolved_intermediates)} item(s) ({fmt.num(cs.unresolved_qty)} KG) could not be fully exploded</b> — their encoded BOMs are
          <b> circular / self-referential</b> (an intermediate whose recipe loops back to itself via another code). They stay listed as the intermediate
          (tagged <b>⚠ Unresolved</b> below and “Unresolved intermediate” in the report). Fix the BOM master to resolve them to raw materials.
        </div>)}
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card statcard"><div className="ic"><FlaskConical size={22} /></div><Stat value={fmt.num(cs.distinct_rms)} label="Distinct leaf RMs" /></div>
        <div className="card statcard red"><div className="ic"><ShoppingCart size={22} /></div><Stat value={fmt.num(cs.rms_to_buy)} label="RMs to purchase (net &gt; 0)" /></div>
        <div className="card statcard amber"><div className="ic"><Scale size={22} /></div><Stat value={fmt.num(cs.total_buy_qty)} label="Total buy quantity (KG)" /></div>
        <div className="card statcard"><div className="ic"><TriangleAlert size={22} /></div><Stat value={fmt.num(cs.unresolved_intermediates)} label="Unresolved (circular BOM)" /></div>
      </div>
      {rows.length === 0
        ? <div className="banner info">No leaf raw materials match the current filter.</div>
        : <div className="sc-grid">
            {pg.pageRows.map((r, i) => <RmCard key={i} r={r} pjc={pjc} />)}
          </div>}
      <Pagination {...pg} />
      <div className="sub" style={{ marginTop: 8 }}>{rows.length} of {cs.distinct_rms} leaf RMs shown. Net-to-buy: <span className="num-pos">red = buy</span> · <span className="num-zero">green = covered</span>.</div>
    </>
  );
}

export default function SupplyCards() {
  const { data, loading, error, uploaded, sel, setSel, applyOverrides, discardOverrides } = useSupplyPlan();
  const [applyingBom, setApplyingBom] = useState(false);
  const [confirm, setConfirm] = useState(null);   // "save" | "discard" | null → drives ConfirmModal
  const doSave = async () => {
    setConfirm(null);
    setApplyingBom(true);
    try {
      const r = await applyOverrides();
      alert(`✓ ${r.overrides_applied} BOM override(s) applied · plan #${r.plan_id ?? "—"} saved` + (r.mysql_ok ? "." : " — DB save failed: " + (r.mysql_error || "")));
    } catch (e) { alert(e.message); } finally { setApplyingBom(false); }
  };
  const doDiscard = () => { setConfirm(null); discardOverrides(); };
  const [mode, setMode] = useState("product");
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [rmCls, setRmCls] = useState("manufacturing");
  const [seg2, setSeg2] = useState("");
  const [seg3, setSeg3] = useState("");

  const rows = (data && !data.note) ? data.products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (!cls || p.bom_class === cls) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))
      && (!seg2 || p.segment2 === seg2) && (!seg3 || p.segment3 === seg3)) : [];
  const pg = usePagination(rows, [q, cls, seg2, seg3, mode]);

  if (!data) return loading ? <Loading what="Supply & RM Plan" /> : error ? <ErrorBox msg={error} /> : null;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;
  const pjc = data.planning_jc || 4;
  const seg2opts = [...new Set(data.products.map((p) => p.segment2).filter(Boolean))].sort();
  const seg3opts = [...new Set(data.products.filter((p) => !seg2 || p.segment2 === seg2).map((p) => p.segment3).filter(Boolean))].sort();
  // count non-preferred BOM selections (drives the "apply on the i/o page" prompt)
  const overrideCount = Object.entries(sel).reduce((n, [i, k]) => {
    const b = data.products[+i]?.boms?.[k];
    return n + (b && !b.preferred ? 1 : 0);
  }, 0);

  return (
    <section className="supply-page">
      <div className="banner supply-context" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", fontSize: 13 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarDays size={15} /> <b>Planning JC{pjc}</b>{data.planning_jc_from ? ` · ${data.planning_jc_from} → ${data.planning_jc_to}` : ""}</span>
        {data.soc_window && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Receipt size={15} /> <b>Pending SOC:</b> {data.soc_window.from <= "1900-01-01" ? "As on date" : data.soc_window.from} → {data.soc_window.to}</span>}
        {data.po_window && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Truck size={15} /> <b>Pending PO dates:</b> {data.po_window.from} → {data.po_window.to}</span>}
        {uploaded && <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}><ClipboardList size={15} /> <b>Viewing {uploaded.plan_mode === "excel_only" ? "Excel-only" : uploaded.plan_mode === "bom_override" ? "overridden" : "uploaded"} plan #{uploaded.plan_id ?? "—"}</b></span>}
      </div>
      {overrideCount > 0 && (
        <div className="bom-save-bar">
          <span className="bom-save-icon" aria-hidden style={{ display: "inline-flex" }}><Pencil size={16} /></span>
          <div className="bom-save-text">
            <b>{overrideCount} BOM override{overrideCount > 1 ? "s" : ""} selected</b>
            <span>Save to rebuild &amp; apply — until then these changes won’t affect the plan or exports.</span>
          </div>
          <div className="bom-save-actions">
            <button className="bom-save-btn discard" type="button" disabled={applyingBom}
              onClick={() => setConfirm("discard")}>
              Discard
            </button>
            <button className="bom-save-btn save" type="button" disabled={applyingBom} onClick={() => setConfirm("save")}>
              {applyingBom ? (
                <><span className="bom-spinner" aria-hidden />Saving… (~2 min)</>
              ) : (
                <>
                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                  Save &amp; apply {overrideCount} change{overrideCount > 1 ? "s" : ""}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <RMDataCharts data={data} />

      <div className="supply-workspace supply-viewtabs" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "0 0 8px" }}>
        <SegTabs value={mode}
          onChange={(m) => { setMode(m); setQ(""); if (m !== "product") { setSeg2(""); setSeg3(""); } }}
          tabs={[
            { id: "product", label: "By product" },
            { id: "consolidated", label: "Consolidated RM purchase" },
            { id: "realrm", label: "Real RM (exploded)", title: "Intermediates exploded to their purchased (leaf) raw materials — the true buy-list" },
          ]} />
      </div>

      <div className="pagebar supply-filters">
        <SmoothInput className="searchbox" placeholder={mode === "product" ? "Search product…" : "Search RM code / name…"} value={q} onChange={(e) => setQ(e.target.value)} />
        {mode === "product" && (
          <SelectBox className="searchbox" style={{ maxWidth: 190 }} value={seg2} onChange={(e) => { setSeg2(e.target.value); setSeg3(""); }}>
            <option value="">All Segment 2</option>
            {seg2opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </SelectBox>
        )}
        {mode === "product" && (
          <SelectBox className="searchbox" style={{ maxWidth: 190 }} value={seg3} onChange={(e) => setSeg3(e.target.value)}>
            <option value="">All Segment 3</option>
            {seg3opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </SelectBox>
        )}
        {mode === "product" && (
          <SelectBox className="searchbox" style={{ maxWidth: 210 }} value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">All activities</option>
            <option value="manufacturing">Manufacturing (make)</option>
            <option value="repack_relabel">Repack / Relabel</option>
            <option value="trading">Trading / Distribution</option>
            <option value="unclassified">Unclassified</option>
            <option value="internal">Internal (conv/decode)</option>
          </SelectBox>
        )}
        {mode === "consolidated" && (
          <SelectBox className="searchbox" style={{ maxWidth: 240 }} value={rmCls} onChange={(e) => setRmCls(e.target.value)}>
            <option value="manufacturing">Manufacturing RM</option>
            <option value="repack">Repack / Relabel RM</option>
            <option value="packing">Packing Material</option>
            <option value="all">RM — All (combined)</option>
          </SelectBox>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {mode === "product" ? `${rows.length} products` : (() => {
            const cs = mode === "realrm" ? (data.real_rm_summary || {})
              : rmCls === "manufacturing" ? data.consolidated_summary_manufacturing
                : rmCls === "repack" ? data.consolidated_summary_repack
                  : rmCls === "packing" ? data.consolidated_summary_packing : data.consolidated_summary;
            return `${cs.distinct_rms} materials · ${cs.rms_to_buy} to buy`;
          })()}
        </span>
      </div>

      {mode === "consolidated" && <ConsolidatedRM data={data} q={q} rmCls={rmCls} pjc={pjc} />}
      {mode === "realrm" && <RealRM data={data} q={q} pjc={pjc} />}
      {mode === "product" && (
        <div>
          {rows.length === 0
            ? <div className="banner info" style={{ marginTop: 4 }}>No products match the current filters.</div>
            : <div className="sc-grid">
                {pg.pageRows.map(({ p, i }) => <ProductCard key={i} p={p} data={data} pjc={pjc}
                  bi={sel[i] ?? 0} onPickBom={(k) => setSel((m) => ({ ...m, [i]: k }))} />)}
              </div>}
          <Pagination {...pg} />
        </div>
      )}
      {mode === "product" && (
        <div className="sub supply-summary" style={{ marginTop: 8 }}>{s.with_bom} of {s.shown} shown products matched a BOM; {s.without_bom} traded (no recipe).
          Net-to-buy: <span className="num-pos">red = buy</span> · <span className="num-zero">green = covered</span>. FG stock = Warehouse (MFG orgs) vs Branch.
          {" "}MFG SOC of <b>{fmt.num(s.mfg_soc_in_plan ?? s.pending_soc_in_plan)}</b> KG added across <b>{s.pending_soc_items}</b> planned items (Overall SOC {fmt.num(s.overall_soc_total)} KG){s.stock_source ? <> · stock source: <b>{s.stock_source}</b></> : null}.
          {s.msl_total > 0 && <> {" "}<b>MSL buffer</b> of <b>{fmt.num(s.msl_total)}</b> KG added across <b>{s.msl_items}</b> valid items; on-hand (WH+Branch) netted <b>{fmt.num(s.onhand_total)}</b> KG. Mfg Req = {s.mfg_required_formula}.{s.msl_only_items > 0 && <> Of these, <b>{s.msl_only_items}</b> had no projection this JC (<b>MSL top-up</b> — a BOM item below its MSL; demand = MSL − on-hand).</>}</>}
          {s.plan_divisions?.length > 0 && <> {" "}Scope: <b>Division = {s.plan_divisions.join(", ")}</b> only{s.out_of_scope_items > 0 && <> ({fmt.num(s.out_of_scope_items)} projected items in other divisions excluded)</>}.</>}
          {s.with_packing_bom > 0 && <> {s.packing_bom_count} packing BOM(s) across {s.with_packing_bom} products shown separately.</>}</div>
      )}

      <ConfirmModal
        open={confirm === "discard"}
        title="Discard BOM changes"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        onCancel={() => setConfirm(null)}
        onConfirm={doDiscard}
      >
        Discard <b>{overrideCount} unsaved BOM change{overrideCount > 1 ? "s" : ""}</b>? Your selected
        BOMs will be reset to the preferred recipes — this can’t be undone.
      </ConfirmModal>

      <ConfirmModal
        open={confirm === "save"}
        title="Save & apply BOM overrides"
        cancelLabel="Cancel"
        confirmLabel={`Save & apply ${overrideCount} change${overrideCount > 1 ? "s" : ""}`}
        onCancel={() => setConfirm(null)}
        onConfirm={doSave}
      >
        The plan rebuilds with your chosen BOMs and saves — this flows into the consolidated RM plan,
        Excel and Production Scheduling. Rebuild can take <b>~2 minutes</b>.
      </ConfirmModal>
    </section>
  );
}
