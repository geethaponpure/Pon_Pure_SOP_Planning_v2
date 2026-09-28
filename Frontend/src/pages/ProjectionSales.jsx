import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Target, ArrowUp, ArrowDown, CircleCheck } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const FLAG = {
  over: { cls: "pill-buy", label: "Over" },
  under: { cls: "pill-buy", label: "Under" },
  ontrack: { cls: "pill-ok", label: "On track" },
  new: { cls: "chip", label: "New" },
  none: { cls: "chip", label: "—" },
};

function Flag({ f }) {
  const m = FLAG[f] || FLAG.none;
  const style = f === "under" ? { background: "#FFF4DA", color: "#8a6d00" }
    : f === "over" ? { background: "#FFE5E5", color: "#a11" } : {};
  return <span className={m.cls} style={style}>{m.label}</span>;
}

function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const out = [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    if (typeof va === "boolean" && typeof vb === "boolean") return (va ? 1 : 0) - (vb ? 1 : 0);
    return String(va ?? "").localeCompare(String(vb ?? ""));
  });
  return dir === "desc" ? out.reverse() : out;
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

export default function ProjectionSales() {
  const { data, loading, error } = useAsync(api.projectionVsSales);
  const [q, setQ] = useState("");
  const [seg2, setSeg2] = useState("");
  const [seg3, setSeg3] = useState("");
  const [flag, setFlag] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState({ key: "variance", dir: "desc" });
  const [exporting, setExporting] = useState(false);
  const ql = q.toLowerCase();
  const rows = (data && !data.note) ? applySort(data.items.filter((i) =>
    (!q || i.name.toLowerCase().includes(ql)) &&
    (!seg2 || i.segment2 === seg2) && (!seg3 || i.segment3 === seg3) &&
    (!flag || i.flag === flag) && (!type || i.make_or_buy === type)), sort) : [];
  const pg = usePagination(rows, [q, seg2, seg3, flag, type, sort]);
  if (loading) return <Loading what="Projection vs Sales" />;
  if (error) return <ErrorBox msg={error} />;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;
  const seg2opts = [...new Set(data.items.map((i) => i.segment2).filter(Boolean))].sort();
  const seg3opts = [...new Set(data.items.filter((i) => !seg2 || i.segment2 === seg2).map((i) => i.segment3).filter(Boolean))].sort();

  return (
    <>
      <PageInfo title="Projection vs Sales">
        The Sales team's projection (<b>current JC = JC{data.planning_jc || 4} WK1+WK2</b>, plus Next 1 / Next 2)
        compared to <b>actual dispatched sales</b> averaged over the last {data.n_jc} JCs (CRM <code>SP_DespatchDetailsReport</code>).
        Items are flagged <span className="pill-buy" style={{ background: "#FFE5E5", color: "#a11" }}>Over</span> /
        <span className="pill-buy" style={{ background: "#FFF4DA", color: "#8a6d00" }}>Under</span> /
        <span className="pill-ok">On track</span> when projection deviates beyond ±{data.band_pct}% of trailing sales.
      </PageInfo>

      {(() => {
        const ring = (on, color) => ({ cursor: "pointer", boxShadow: on ? `0 0 0 2px ${color}` : undefined });
        const toggle = (f) => setFlag(flag === f ? "" : f);
        return (
          <div className="grid cols-4">
            <div className="card statcard" style={ring(!flag, "var(--teal)")} title="Show all flags" onClick={() => setFlag("")}>
              <div className="ic"><Target size={22} /></div><Stat value={fmt.num(s.items)} label="Projected items" /></div>
            <div className="card statcard red" style={ring(flag === "over", "var(--red)")} title="Filter: over-projected" onClick={() => toggle("over")}>
              <div className="ic"><ArrowUp size={22} /></div><Stat value={fmt.num(s.item_over)} label="Over-projected (proj > sales)" /></div>
            <div className="card statcard amber" style={ring(flag === "under", "var(--amber)")} title="Filter: under-projected" onClick={() => toggle("under")}>
              <div className="ic"><ArrowDown size={22} /></div><Stat value={fmt.num(s.item_under)} label="Under-projected (proj < sales)" /></div>
            <div className="card statcard" style={ring(flag === "ontrack", "var(--green)")} title="Filter: on track" onClick={() => toggle("ontrack")}>
              <div className="ic"><CircleCheck size={22} /></div><Stat value={`${fmt.num(s.item_ontrack)} / ${fmt.num(s.item_new)}`} label="On track / New (no sales)" /></div>
          </div>
        );
      })()}

      <div className="pagebar" style={{ marginTop: 14 }}>
        <SmoothInput className="searchbox" placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectBox className="searchbox" style={{ maxWidth: 180 }} value={seg2} onChange={(e) => { setSeg2(e.target.value); setSeg3(""); }}>
          <option value="">All Segment 2</option>
          {seg2opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 180 }} value={seg3} onChange={(e) => setSeg3(e.target.value)}>
          <option value="">All Segment 3</option>
          {seg3opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 150 }} value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">All flags</option>
          <option value="over">Over-projected</option>
          <option value="under">Under-projected</option>
          <option value="ontrack">On track</option>
          <option value="new">New (no sales)</option>
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 150 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="make">Manufactured</option>
          <option value="buy">Traded</option>
        </SelectBox>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{rows.length} items</span>
        <button className="btn" disabled={exporting}
          onClick={async () => { setExporting(true); try { await api.projectionVsSalesExport(); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting ? "Exporting…" : "⤓ Download (Excel)"}
        </button>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <SortTh label="Item" k="name" sort={sort} setSort={setSort} />
              <SortTh label="Segment 2 / 3" k="segment2" sort={sort} setSort={setSort} />
              <th className="grp" colSpan={3}>Projection (KG)</th>
              <SortTh label={`Avg ${data.n_jc}-JC sales`} k="avg_3jc_sales" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Variance" k="variance" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Flag" k="flag" sort={sort} setSort={setSort} />
              <th className="grp" colSpan={2}>FG stock (KG)</th>
            </tr>
            <tr>
              <th></th><th></th>
              <SortTh label="Current" k="current" sort={sort} setSort={setSort} className="num cg-proj" />
              <SortTh label="Next 1" k="next1" sort={sort} setSort={setSort} className="num cg-proj" />
              <SortTh label="Next 2" k="next2" sort={sort} setSort={setSort} className="num cg-proj" />
              <th className="num"></th><th className="num"></th><th></th>
              <SortTh label="Warehouse" k="warehouse" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Branch" k="branch" sort={sort} setSort={setSort} className="num" />
            </tr>
          </thead>
          <tbody>
            {pg.pageRows.map((i, k) => (
              <tr key={k}>
                <td><b>{i.name}</b>{" "}
                  <span className="chip" style={{ cursor: "default", fontSize: 10,
                    background: i.make_or_buy === "make" ? "#EAF3FF" : "#F0F0F2",
                    color: i.make_or_buy === "make" ? "#1768c4" : "#666",
                    borderColor: i.make_or_buy === "make" ? "#CFE4FB" : "#e2e2e6" }}>
                    {i.item_type}</span></td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{i.segment2}{i.segment3 ? ` · ${i.segment3}` : ""}</td>
                <td className="num cg-proj"><b>{fmt.num(i.current)}</b></td>
                <td className="num cg-proj">{fmt.num(i.next1)}</td>
                <td className="num cg-proj">{fmt.num(i.next2)}</td>
                <td className="num">{fmt.num(i.avg_3jc_sales)}</td>
                <td className="num" style={{ color: i.variance > 0 ? "var(--red)" : i.variance < 0 ? "#8a6d00" : "var(--muted)" }}>
                  {i.variance > 0 ? "+" : ""}{fmt.num(i.variance)}{i.variance_pct != null ? ` (${i.variance_pct > 0 ? "+" : ""}${i.variance_pct}%)` : ""}
                </td>
                <td><Flag f={i.flag} /></td>
                <td className="num">{fmt.num(i.warehouse)}</td>
                <td className="num">{fmt.num(i.branch)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10}>No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination {...pg} />
      <div className="sub" style={{ marginTop: 8 }}>
        Variance = projection − avg sales. <span style={{ color: "var(--red)" }}>+ = over-projected</span> ·
        <span style={{ color: "#8a6d00" }}> − = under-projected</span>. <b>{fmt.num(s.manufactured)}</b> manufactured ·
        <b> {fmt.num(s.traded)}</b> traded. Excel adds a <b>Collector-Item</b> sheet
        ({fmt.num(s.collector_items)} rows) alongside the consolidated item view.
      </div>
    </>
  );
}
