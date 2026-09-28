import React, { useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Tag } from "../components/ui.jsx";
import { LockOpen, Lock, Search } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const SALES_FLAG = {
  over: { label: "Over", bg: "#FFE5E5", color: "#a11" },
  under: { label: "Under", bg: "#FFF4DA", color: "#8a6d00" },
  ontrack: { label: "On track", bg: "#E6F6EC", color: "#1a7d4f" },
  new: { label: "New", bg: "#EAF3FF", color: "#1768c4" },
  none: { label: "—", bg: "#F0F0F2", color: "#666" },
};

function SalesFlag({ f, pct }) {
  const m = SALES_FLAG[f] || SALES_FLAG.none;
  return (
    <span className="chip" style={{ cursor: "default", fontWeight: 600, background: m.bg, color: m.color, borderColor: "transparent" }}>
      {m.label}{pct != null && (f === "over" || f === "under") ? ` ${pct > 0 ? "+" : ""}${pct}%` : ""}
    </span>
  );
}

// sort supporting dot-path keys (e.g. confirmation.quantity); blanks sink to the bottom.
function applySort(rows, { key, dir }) {
  if (!key) return rows;
  const get = (r) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), r);
  const out = [...rows].sort((a, b) => {
    const va = get(a), vb = get(b);
    const na = va == null || va === "", nb = vb == null || vb === "";
    if (na && nb) return 0; if (na) return 1; if (nb) return -1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
  return dir === "desc" ? out.reverse() : out;
}

function SortTh({ label, k, sort, setSort, className }) {
  const active = sort.key === k;
  return (
    <th className={className} title="Click to sort" style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }))}>
      {label}<span style={{ color: active ? "inherit" : "var(--border)", fontSize: 10 }}>{active ? (sort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
    </th>
  );
}

export default function Validation({ onChange }) {
  const { data, loading, error, refresh } = useAsync(api.confirmations);
  const [active, setActive] = useState(null); // sku id for drawer
  const [q, setQ] = useState("");
  const [seg2, setSeg2] = useState("");
  const [seg3, setSeg3] = useState("");
  const [statusF, setStatusF] = useState("");   // "" | open | confirmed | auto-accepted
  const [sort, setSort] = useState({ key: "", dir: "asc" });

  const rows = data?.rows ?? [];
  const ql = q.toLowerCase();
  const shown = rows.filter((r) =>
    (!statusF || r.confirmation.status === statusF) &&
    (!ql || r.name.toLowerCase().includes(ql) || (r.sku || "").toLowerCase().includes(ql)) &&
    (!seg2 || r.segment2 === seg2) && (!seg3 || r.segment3 === seg3));
  const sortedShown = applySort(shown, sort);
  const pg = usePagination(sortedShown, [q, seg2, seg3, statusF, sort]);

  if (loading) return <Loading what="exception inbox" />;
  if (error) return <ErrorBox msg={error} />;

  const open = rows.filter((r) => r.confirmation.status === "open");
  const confirmedCount = rows.filter((r) => r.confirmation.status === "confirmed").length;
  const autoCount = rows.filter((r) => r.confirmation.status === "auto-accepted").length;
  const seg2opts = [...new Set(rows.map((r) => r.segment2).filter(Boolean))].sort();
  const seg3opts = [...new Set(rows.filter((r) => !seg2 || r.segment2 === seg2).map((r) => r.segment3).filter(Boolean))].sort();

  async function doLock() {
    if (!confirm("Lock the consensus demand for this cycle? Downstream supply planning will consume the locked numbers. Changes after lock require re-approval.")) return;
    await api.lock("Demand Planner");
    refresh();
    onChange?.();
  }
  async function doUnlock() {
    await api.unlock("Demand Planner");
    refresh();
    onChange?.();
  }

  return (
    <>
      <PageInfo title="Validation — Triangulation">
        each CRM projection is validated against <b>actual dispatched sales</b>
        (CRM <code>SP_DespatchDetailsReport</code>, trailing 3-month avg), the statistical baseline,
        firm Pending SOC, and the LMS signal, then judged against segment tolerance bands (A ±12.5% · B ±22.5% · C ±40%).
        The <b>vs Sales</b> flag marks an item <span className="chip" style={{ background: "#FFE5E5", color: "#a11", borderColor: "transparent" }}>Over</span>-
        or <span className="chip" style={{ background: "#FFF4DA", color: "#8a6d00", borderColor: "transparent" }}>Under</span>-projected
        when the projection deviates beyond the segment band from what actually sells. A projection below Pending SOC breaches the firm-order floor.
      </PageInfo>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 14px", flexWrap: "wrap" }}>
        {[
          ["open", `${open.length} open exception${open.length !== 1 ? "s" : ""}`, "#8a6d00", "#FFF4DA"],
          ["confirmed", `${confirmedCount} confirmed`, "#1a7d4f", "#E6F6EC"],
          ["auto-accepted", `${autoCount} auto-accepted`, "#555", "#EEEFF1"],
        ].map(([id, lbl, fg, bg]) => {
          const on = statusF === id;
          return (
            <button key={id} onClick={() => setStatusF(on ? "" : id)} title="Click to filter by status"
              style={{ cursor: "pointer", background: bg, color: fg, fontWeight: 600, fontSize: 13,
                border: `1px solid ${on ? fg : "transparent"}`, borderRadius: 20, padding: "5px 14px",
                boxShadow: on ? `0 0 0 2px ${bg}` : "none", transition: "all .12s" }}>
              {lbl}
            </button>
          );
        })}
        {statusF && <button className="link" onClick={() => setStatusF("")}>clear filter</button>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {data.locked ? (
            <button className="btn secondary" onClick={doUnlock}><LockOpen size={15} /> Unlock for re-approval</button>
          ) : (
            <button className="btn" onClick={doLock}><Lock size={15} /> Lock consensus demand</button>
          )}
        </div>
      </div>

      <div className="pagebar">
        <SmoothInput className="searchbox" placeholder="Search item name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectBox className="searchbox" style={{ maxWidth: 200 }} value={seg2} onChange={(e) => { setSeg2(e.target.value); setSeg3(""); }}>
          <option value="">All Segment 2</option>
          {seg2opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 200 }} value={seg3} onChange={(e) => setSeg3(e.target.value)}>
          <option value="">All Segment 3</option>
          {seg3opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <span className="chip" style={{ cursor: "default" }}>Scope: Segment 1 = Performance Chemicals</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{shown.length} of {rows.length} items</span>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <SortTh label="Item" k="name" sort={sort} setSort={setSort} />
              <SortTh label="Cell" k="cell" sort={sort} setSort={setSort} />
              <SortTh label="Owner" k="owner" sort={sort} setSort={setSort} />
              <SortTh label="CRM proj." k="projection" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Sales (avg)" k="avg_sales" sort={sort} setSort={setSort} className="num" />
              <SortTh label="vs Sales" k="sales_variance_pct" sort={sort} setSort={setSort} />
              <SortTh label="Baseline" k="baseline" sort={sort} setSort={setSort} className="num" />
              <SortTh label="SOC" k="pending_soc" sort={sort} setSort={setSort} className="num" />
              <SortTh label="LMS" k="lms" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Consensus" k="confirmation.quantity" sort={sort} setSort={setSort} className="num" />
              <SortTh label="Exception" k="type" sort={sort} setSort={setSort} />
              <SortTh label="Status" k="confirmation.status" sort={sort} setSort={setSort} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pg.pageRows.map((r) => {
              const c = r.confirmation;
              return (
                <tr key={r.sku}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>
                      {r.sku}{(r.segment2 || r.segment3) ? ` · ${[r.segment2, r.segment3].filter(Boolean).join(" / ")}` : ""}
                    </div>
                  </td>
                  <td><Tag kind={r.cell[0]}>{r.cell}</Tag></td>
                  <td>{r.owner}</td>
                  <td className="num">{fmt.num(r.projection)}</td>
                  <td className="num">{fmt.num(r.avg_sales)}</td>
                  <td><SalesFlag f={r.sales_flag} pct={r.sales_variance_pct} /></td>
                  <td className="num">{fmt.num(r.baseline)}</td>
                  <td className="num">{fmt.num(r.pending_soc)}</td>
                  <td className="num">{fmt.num(r.lms)}</td>
                  <td className="num"><b>{fmt.num(c.quantity)}</b></td>
                  <td><Tag kind={r.severity}>{r.type}</Tag></td>
                  <td>
                    {c.status === "confirmed" ? <span style={{ color: "var(--green)" }}>✓ confirmed</span>
                      : c.status === "auto-accepted" ? <span style={{ color: "var(--muted)" }}>auto</span>
                      : <span style={{ color: "var(--amber)" }}>● open</span>}
                  </td>
                  <td><button className="btn secondary" style={{ padding: "4px 12px", fontSize: 12, whiteSpace: "nowrap" }}
                    onClick={() => setActive(r.sku)}><Search size={15} /> Review</button></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={13} style={{ color: "var(--muted)" }}>No items match the current filters.</td></tr>}
          </tbody>
        </table>
        <Pagination {...pg} />
      </div>

      {active && (
        <Drawer
          row={rows.find((r) => r.sku === active)}
          reasonCodes={data.reason_codes}
          locked={data.locked}
          onClose={() => setActive(null)}
          onSaved={() => { setActive(null); refresh(); onChange?.(); }}
        />
      )}
    </>
  );
}

function Drawer({ row, reasonCodes, locked, onClose, onSaved }) {
  const c = row.confirmation;
  const [qty, setQty] = useState(c.quantity);
  const [reason, setReason] = useState(c.reason_code || reasonCodes[0]);
  const [note, setNote] = useState(c.note || "");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const hist = useAsync(() => api.skuHistory(row.sku), [row.sku]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.confirm(row.sku, { quantity: Number(qty), reason_code: reason, note, actor: row.owner });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const chartData = (hist.data?.history || []).map((h) => ({
    period: h.period.slice(2),
    sales: h.event === "stockout" ? h.true_demand : h.shipped,
  }));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="link" onClick={onClose} style={{ float: "right" }}>✕ close</button>
        <h3>{row.sku} — {row.name}</h3>
        <div style={{ marginBottom: 6 }}>
          <Tag kind={row.cell[0]}>{row.cell}</Tag>{" "}
          <Tag kind={row.severity}>{row.type}</Tag>{" "}
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{row.family} · {row.owner} · {row.method}</span>
        </div>

        <div className="banner warn"><b>{row.trigger}.</b> {row.meaning}. <i>Suggested: {row.action}</i></div>

        {!hist.loading && (
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ left: -10 }}>
              <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sales" name="Actual sales (dispatched, monthly)" fill="#1768c4" />
              <ReferenceLine y={row.avg_sales} stroke="#1768c4" strokeWidth={2} strokeDasharray="2 2" label={{ value: "sales avg (3-mo)", fontSize: 9, fill: "#1768c4", position: "insideBottomRight" }} />
              <ReferenceLine y={row.projection} stroke="#c53030" strokeDasharray="4 3" label={{ value: "projection", fontSize: 9, fill: "#c53030" }} />
              <ReferenceLine y={row.baseline} stroke="#2a9d8f" strokeDasharray="4 3" label={{ value: "baseline", fontSize: 9, fill: "#2a9d8f" }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 8px" }}>
          <span style={{ color: "#1768c4", fontWeight: 600 }}>■ Blue bars</span> = monthly dispatched sales (CRM <code>SP_DespatchDetailsReport</code>);
          the <span style={{ color: "#1768c4", fontWeight: 600 }}>blue dashed line</span> is their 3-month average.
          When the <span style={{ color: "#c53030", fontWeight: 600 }}>red projection line</span> sits above it → <b>over-projected</b>; below → <b>under-projected</b>.
        </div>

        <div className="kv">
          <div><div className="k">CRM projection</div><div className="val">{fmt.num(row.projection)}</div></div>
          <div><div className="k">Actual sales (3-mo avg)</div><div className="val">{fmt.num(row.avg_sales)} <SalesFlag f={row.sales_flag} pct={row.sales_variance_pct} /></div></div>
          <div><div className="k">Projection vs sales</div><div className="val">{row.sales_variance == null ? "—" : fmt.signed(row.sales_variance)}</div></div>
          <div><div className="k">Statistical baseline</div><div className="val">{fmt.num(row.baseline)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({fmt.num(row.ci_low)}–{fmt.num(row.ci_high)})</span></div></div>
          <div><div className="k">Pending SOC (firm floor)</div><div className="val">{fmt.num(row.pending_soc)}</div></div>
          <div><div className="k">LMS signal</div><div className="val">{fmt.num(row.lms)}</div></div>
          <div><div className="k">Dev vs baseline</div><div className="val">{fmt.signed(row.dev_vs_baseline)}</div></div>
          <div><div className="k">Dev vs LMS</div><div className="val">{fmt.signed(row.dev_vs_lms)}</div></div>
          <div><div className="k">Engine consensus candidate</div><div className="val" style={{ color: "var(--teal)" }}>{fmt.num(row.candidate)}</div></div>
          <div><div className="k">Tolerance band</div><div className="val">±{fmt.pct(row.band, 0)}</div></div>
        </div>

        {locked ? (
          <div className="banner err">Consensus is locked — unlock to revise this number.</div>
        ) : (
          <>
            <div className="form-row">
              <label>Confirmed quantity (must be ≥ Pending SOC {fmt.num(row.pending_soc)})</label>
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className="btn secondary" onClick={() => setQty(row.candidate)}>Use consensus {fmt.num(row.candidate)}</button>
                <button className="btn secondary" onClick={() => setQty(row.baseline)}>Use baseline {fmt.num(row.baseline)}</button>
              </div>
            </div>
            <div className="form-row">
              <label>Override reason code (Section 8.2)</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasonCodes.map((rc) => <option key={rc}>{rc}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Justification note</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. firm tender awarded for Q3" />
            </div>
            {err && <div className="banner err">{err}</div>}
            <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Confirm into consensus"}</button>
          </>
        )}
      </div>
    </div>
  );
}
