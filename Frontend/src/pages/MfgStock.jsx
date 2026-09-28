import React, { useState, useMemo, useEffect } from "react";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { Package, Factory, Scale, Search } from "lucide-react";
import MfgStockCharts from "../components/MfgStockCharts.jsx";

function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const out = [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
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

export default function MfgStock() {
  const { data, loading, error } = useAsync(api.mfgStock);
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("");
  const [seg, setSeg] = useState("");
  const [div, setDiv] = useState("");
  const [sort, setSort] = useState({ key: "qty", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Filter + sort ONCE per input change (not on every render). Rendering only a
  // page slice below keeps the DOM small even with thousands of rows.
  const rows = useMemo(() => {
    const src = data?.rows || [];
    const ql = q.trim().toLowerCase();
    return applySort(
      src.filter((r) =>
        (!org || r.org === org) && (!seg || r.segment2 === seg) && (!div || r.division === div) &&
        (!ql || (r.item_code || "").toLowerCase().includes(ql) || (r.item_desc || "").toLowerCase().includes(ql))
      ),
      sort
    );
  }, [data, q, org, seg, div, sort]);

  // any filter/sort/page-size change jumps back to the first page
  useEffect(() => { setPage(1); }, [q, org, seg, div, sort, pageSize]);

  if (loading) return <Loading what="MFG Org Stock" />;
  if (error) return <ErrorBox msg={error} />;

  const s = data.summary || {};
  const shownQty = rows.reduce((a, r) => a + (r.qty || 0), 0);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pageCount);
  const start = (cur - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const maxQty = rows.length ? Math.max(...rows.map((r) => r.qty || 0)) : 1;

  return (
    <>
      <div className="grid cols-4">
        <div className="card statcard"><div className="ic"><Package size={22} /></div><Stat value={fmt.num(s.items)} label="Distinct items" /></div>
        <div className="card statcard"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.orgs)} label="MFG organizations" /></div>
        <div className="card statcard amber"><div className="ic"><Scale size={22} /></div><Stat value={fmt.num(s.total_qty)} label="Total on-hand (KG)" /></div>
        <div className="card statcard"><div className="ic"><Search size={22} /></div><Stat value={fmt.num(shownQty)} label="Shown qty (filtered, KG)" /></div>
      </div>

      <MfgStockCharts rows={rows} />

      <div className="pagebar mfg-filters" style={{ marginTop: 14 }}>
        <SmoothInput className="searchbox" placeholder="Search item code / description…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectBox className="searchbox" style={{ maxWidth: 220 }} value={div} onChange={(e) => setDiv(e.target.value)}>
          <option value="">All divisions</option>
          {(data.divisions || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 220 }} value={org} onChange={(e) => setOrg(e.target.value)}>
          <option value="">All MFG orgs</option>
          {(data.orgs || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 200 }} value={seg} onChange={(e) => setSeg(e.target.value)}>
          <option value="">All segments</option>
          {(data.segments || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{total} rows</span>
      </div>

      <div className="tbl-wrap mfg-tbl-wrap">
        <table className="mfg-table">
          <thead>
            <tr>
              <SortTh label="Item Code" k="item_code" sort={sort} setSort={setSort} />
              <SortTh label="Item Description" k="item_desc" sort={sort} setSort={setSort} />
              <SortTh label="Division" k="division" sort={sort} setSort={setSort} />
              <SortTh label="Segment" k="segment2" sort={sort} setSort={setSort} />
              <SortTh label="Sub-segment" k="segment3" sort={sort} setSort={setSort} />
              <SortTh label="Organisation" k="org" sort={sort} setSort={setSort} />
              <SortTh label="Qty (KG)" k="qty" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Age (d)" k="age_days" sort={sort} setSort={setSort} className="num" />
              <SortTh label="#Lots" k="lots" sort={sort} setSort={setSort} className="num" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, k) => (
              <tr key={start + k}>
                <td className="mfg-code">{r.item_code}</td>
                <td><span className="mfg-desc" title={r.item_desc}>{r.item_desc}</span></td>
                <td>{r.division && <span className="chip" style={{ cursor: "default", fontSize: 10, background: /npd/i.test(r.division) ? "#FFF3E8" : "#EEF6FF" }}>{r.division}</span>}</td>
                <td>{r.segment2 && <span className="chip" style={{ cursor: "default", fontSize: 10, background: /raw material/i.test(r.segment2) ? "#EEF6FF" : "#F3F0E8" }}>{r.segment2}</span>}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }} title={r.segment3 || ""}>{r.segment3 || "—"}</td>
                <td style={{ fontSize: 12 }} title={r.org}>{r.org}</td>
                <td className="num mfg-qty">
                  <b>{fmt.num(r.qty)}</b>
                  <span className="mfg-qbar"><i style={{ width: `${Math.max(2, Math.round((r.qty / maxQty) * 100))}%` }} /></span>
                </td>
                <td className="num">
                  {r.age_days >= 90
                    ? <span className={"mfg-age " + (r.age_days >= 180 ? "old" : "mid")}>{fmt.num(r.age_days)}</span>
                    : <span style={{ color: "var(--muted)" }}>{fmt.num(r.age_days)}</span>}
                </td>
                <td className="num" style={{ color: "var(--muted)" }}>{fmt.num(r.lots)}</td>
              </tr>
            ))}
            {total === 0 && <tr><td colSpan={9}>No stock matches the filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="pagebar" style={{ marginTop: 12, flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <SelectBox className="searchbox" style={{ maxWidth: 130 }} value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}>
              {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </SelectBox>
            <button className="btn secondary" disabled={cur <= 1} onClick={() => setPage(1)} title="First">«</button>
            <button className="btn secondary" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹ Prev</button>
            <span style={{ fontSize: 12, minWidth: 90, textAlign: "center" }}>Page {cur} / {pageCount}</span>
            <button className="btn secondary" disabled={cur >= pageCount} onClick={() => setPage(cur + 1)}>Next ›</button>
            <button className="btn secondary" disabled={cur >= pageCount} onClick={() => setPage(pageCount)} title="Last">»</button>
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}
          </span>
        </div>
      )}

    </>
  );
}
