import React, { useEffect, useMemo, useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { ArrowDown, Target, Scale, BarChart3, Link2, Package, Factory, CircleCheck, TriangleAlert } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const pct = (v, d = 1) => (v == null ? "—" : `${Number(v).toFixed(d)}%`);
const accColor = (v) => (v == null ? "var(--muted)" : v >= 80 ? "var(--green,#2A9D8F)" : v >= 50 ? "#8a6d00" : "var(--red)");

function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const out = [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    const na = va == null, nb = vb == null;
    if (na && nb) return 0;
    if (na) return 1;            // nulls last
    if (nb) return -1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  });
  return dir === "desc" ? out.reverse() : out;
}

function SortTh({ label, k, sort, setSort, className, title }) {
  const active = sort.key === k;
  return (
    <th className={className} title={title || "Click to sort"}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }))}>
      {label}<span style={{ color: active ? "inherit" : "var(--border)", fontSize: 10 }}>{active ? (sort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
    </th>
  );
}

const STATUS_CHIP = {
  "Matched": { bg: "#E6F6EC", fg: "#1c6b4b" },
  "Projected, not produced": { bg: "#FFF4DA", fg: "#8a6d00" },
  "Produced, not projected": { bg: "#FFE5E5", fg: "#9b2c2c" },
};

export default function ProjectionAccuracy() {
  const meta = useAsync(api.projAccuracyMeta, []);
  const [accYear, setAccYear] = useState("");
  const [jc, setJc] = useState("");            // "" = aggregate (all JCs)
  const [approved, setApproved] = useState(false);
  const [tab, setTab] = useState("item");
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [sort, setSort] = useState({ key: "actual", dir: "desc" });

  // default the accounting year to the newest once meta arrives
  useEffect(() => {
    if (!accYear && meta.data?.years?.length) setAccYear(meta.data.years[0].acc_year);
  }, [meta.data, accYear]);

  const yearMeta = meta.data?.years?.find((y) => y.acc_year === accYear);
  const data = useAsync(
    () => api.projAccuracy({ acc_year: accYear || undefined, jc: jc === "" ? undefined : Number(jc), approved }),
    [accYear, jc, approved]);

  useEffect(() => { setSort({ key: tab === "item" ? "actual" : "actual_all", dir: "desc" }); }, [tab]);

  const rows = useMemo(() => {
    const d = data.data;
    if (!d) return [];
    if (tab === "item") {
      const ql = q.toLowerCase();
      return applySort((d.items || []).filter((r) =>
        (!statusF || r.status === statusF) &&
        (!q || (r.item_desc || "").toLowerCase().includes(ql) || (r.item_code || "").toLowerCase().includes(ql))
      ), sort);
    }
    return applySort((tab === "division" ? d.divisions : d.products) || [], sort);
  }, [data.data, tab, q, statusF, sort]);

  const pg = usePagination(rows, [data.data, tab, q, statusF, sort]);

  if (meta.loading) return <Loading what="consumption file index" />;
  if (meta.error) return <ErrorBox msg={meta.error} />;
  if (!meta.data?.years?.length) return <ErrorBox msg="No RM_Consumption files found on the server." />;

  const s = data.data?.summary || {};
  const sc = data.data?.scope || {};

  return (
    <>
      <PageInfo title="Projection Accuracy">
        Received <b>projection</b> (CRM business plan, per JC — the <i>Current</i> WK1+WK2 plan)
        vs <b>actual production</b> taken from <code>RM_Consumption</code> (the <b>Output Quantity of each unique Job</b>).
        Joined by item description and rolled up <b>item / division / product</b>. Accuracy is measured on the <b>matched</b>
        set (items both projected and produced); <b>coverage</b> shows how much of production carried a projection.
        Production also includes intermediates / basic chemicals never in the FG demand plan (they appear as <i>Produced, not projected</i>).
      </PageInfo>

      <div className="pagebar" style={{ marginTop: 12, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--muted)" }}>
          Accounting year
          <SelectBox className="searchbox" style={{ width: 150 }} value={accYear} onChange={(e) => { setAccYear(e.target.value); setJc(""); }}>
            {meta.data.years.map((y) => <option key={y.acc_year} value={y.acc_year}>{y.acc_year}</option>)}
          </SelectBox>
        </label>
        <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--muted)" }}>
          Journey cycle
          <SelectBox className="searchbox" style={{ width: 190 }} value={jc} onChange={(e) => setJc(e.target.value)}>
            <option value="">All JCs (year-to-date)</option>
            {(yearMeta?.jcs || []).map((n) => <option key={n} value={n}>JC{n}</option>)}
            {yearMeta?.has_full && <option value="0">Full-year file</option>}
          </SelectBox>
        </label>
        <label className="chip" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
          whiteSpace: "nowrap", flexShrink: 0, alignSelf: "flex-end", height: 38, padding: "0 12px" }}
          title="Approved-only keeps just rows whose JC status = Approved. Off (default) uses all plan rows — better for past JCs whose approval state has since moved on.">
          <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          Approved-only projection
        </label>
        <button className="btn" style={{ marginLeft: "auto", alignSelf: "flex-end" }}
          onClick={() => api.projAccuracyExport({ acc_year: accYear || undefined, jc: jc === "" ? undefined : Number(jc), approved })}>
          <ArrowDown size={15} /> Export Excel
        </button>
      </div>

      {data.loading && <Loading what="Projection Accuracy" />}
      {data.error && <ErrorBox msg={data.error} />}
      {data.data && (
        <>
          {data.data.note && <div className="banner warn" style={{ marginTop: 8 }}>{data.data.note}</div>}

          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <div className="card statcard"><div className="ic"><Target size={22} /></div>
              <Stat value={<span style={{ color: accColor(s.accuracy_pct) }}>{pct(s.accuracy_pct)}</span>} label="Accuracy % (matched, WMAPE-based)" /></div>
            <div className="card statcard"><div className="ic"><Scale size={22} /></div>
              <Stat value={pct(s.bias_pct)} label="Bias % (matched)" /></div>
            <div className="card statcard amber"><div className="ic"><BarChart3 size={22} /></div>
              <Stat value={`${pct(s.mape)} / ${pct(s.wmape)}`} label="MAPE / WMAPE %" /></div>
            <div className="card statcard"><div className="ic"><Link2 size={22} /></div>
              <Stat value={pct(s.coverage_pct)} label="Production covered by projection" /></div>
          </div>
          <div className="grid cols-4" style={{ marginTop: 10 }}>
            <div className="card statcard"><div className="ic"><Package size={22} /></div>
              <Stat value={fmt.num(s.projected_all)} label="Projected total (KG)" /></div>
            <div className="card statcard"><div className="ic"><Factory size={22} /></div>
              <Stat value={fmt.num(s.actual_all)} label="Actual produced (KG)" /></div>
            <div className="card statcard"><div className="ic"><CircleCheck size={22} /></div>
              <Stat value={`${fmt.num(s.n_matched)} / ${fmt.num(s.n_items)}`} label="Matched / total items" /></div>
            <div className="card statcard"><div className="ic"><TriangleAlert size={22} /></div>
              <Stat value={`${fmt.num(s.n_proj_only)} / ${fmt.num(s.n_prod_only)}`} label="Proj-only / Prod-only" /></div>
          </div>

          <div className="pagebar" style={{ marginTop: 14 }}>
            <SegTabs value={tab} onChange={setTab} tabs={[
              { id: "item", label: "Item" }, { id: "division", label: "Division" }, { id: "product", label: "Product" }]} />
            {tab === "item" && (
              <>
                <SmoothInput className="searchbox" style={{ maxWidth: 260 }} placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} />
                <SelectBox className="searchbox" style={{ maxWidth: 200 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
                  <option value="">All statuses</option>
                  <option>Matched</option>
                  <option>Projected, not produced</option>
                  <option>Produced, not projected</option>
                </SelectBox>
              </>
            )}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              {sc.acc_year} · {sc.label} · {rows.length} rows{sc.files?.length ? ` · ${sc.files.length} file(s)` : ""}
            </span>
          </div>

          <div className="tbl-wrap">
            {tab === "item" ? (
              <table>
                <thead>
                  <tr>
                    <SortTh label="Item" k="item_desc" sort={sort} setSort={setSort} />
                    <SortTh label="Division" k="division" sort={sort} setSort={setSort} />
                    <SortTh label="Product" k="product" sort={sort} setSort={setSort} />
                    <SortTh label="Status" k="status" sort={sort} setSort={setSort} />
                    <SortTh label="UoM" k="uom" sort={sort} setSort={setSort} />
                    <SortTh label="#Jobs" k="jobs" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Projected" k="projected" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Actual" k="actual" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Variance" k="variance" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Var %" k="variance_pct" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Accuracy %" k="accuracy_pct" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Bias %" k="bias_pct" sort={sort} setSort={setSort} className="num" />
                  </tr>
                </thead>
                <tbody>
                  {pg.pageRows.map((r, k) => {
                    const ch = STATUS_CHIP[r.status] || {};
                    return (
                      <tr key={k}>
                        <td><b>{r.item_desc}</b>{r.item_code && <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.item_code}</div>}</td>
                        <td style={{ fontSize: 12 }}>{r.division}</td>
                        <td style={{ fontSize: 12 }}>{r.product}</td>
                        <td><span className="chip" style={{ cursor: "default", fontSize: 10, background: ch.bg, color: ch.fg }}>{r.status}</span></td>
                        <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.uom || "—"}</td>
                        <td className="num">{fmt.num(r.jobs)}</td>
                        <td className="num">{fmt.num(r.projected)}</td>
                        <td className="num"><b>{fmt.num(r.actual)}</b></td>
                        <td className="num" style={{ color: (r.variance || 0) < 0 ? "var(--red)" : "inherit" }}>{fmt.num(r.variance)}</td>
                        <td className="num">{pct(r.variance_pct)}</td>
                        <td className="num" style={{ color: accColor(r.accuracy_pct), fontWeight: 600 }}>{pct(r.accuracy_pct)}</td>
                        <td className="num">{pct(r.bias_pct)}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={12}>No items match.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <SortTh label={tab === "division" ? "Division" : "Product"} k="name" sort={sort} setSort={setSort} />
                    <SortTh label="#Items" k="n_items" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="#Matched" k="n_matched" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Coverage %" k="coverage_pct" sort={sort} setSort={setSort} className="num" title="Matched actual / total actual in the group" />
                    <SortTh label="Projected" k="projected" sort={sort} setSort={setSort} className="num" title="Matched-set projected" />
                    <SortTh label="Actual" k="actual" sort={sort} setSort={setSort} className="num" title="Matched-set actual" />
                    <SortTh label="Actual (all)" k="actual_all" sort={sort} setSort={setSort} className="num" title="All production in the group" />
                    <SortTh label="Accuracy %" k="accuracy_pct" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="MAPE %" k="mape" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="WMAPE %" k="wmape" sort={sort} setSort={setSort} className="num" />
                    <SortTh label="Bias %" k="bias_pct" sort={sort} setSort={setSort} className="num" />
                  </tr>
                </thead>
                <tbody>
                  {pg.pageRows.map((r, k) => (
                    <tr key={k}>
                      <td><b>{r.name}</b></td>
                      <td className="num">{fmt.num(r.n_items)}</td>
                      <td className="num">{fmt.num(r.n_matched)}</td>
                      <td className="num">{pct(r.coverage_pct)}</td>
                      <td className="num">{fmt.num(r.projected)}</td>
                      <td className="num">{fmt.num(r.actual)}</td>
                      <td className="num"><b>{fmt.num(r.actual_all)}</b></td>
                      <td className="num" style={{ color: accColor(r.accuracy_pct), fontWeight: 600 }}>{pct(r.accuracy_pct)}</td>
                      <td className="num">{pct(r.mape)}</td>
                      <td className="num">{pct(r.wmape)}</td>
                      <td className="num">{pct(r.bias_pct)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={11}>No rows.</td></tr>}
                </tbody>
              </table>
            )}
            <Pagination {...pg} />
          </div>
        </>
      )}
    </>
  );
}
