import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import EChart from "../components/EChart.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { CalendarClock, CalendarX2, Download, Factory, Hourglass, PartyPopper,
  ShieldCheck, Truck } from "lucide-react";

// Promise Dates — Phase 3. Phase 2 asked whether there is enough supply; this
// asks WHEN. Every dated supply event (stock now, production off the saved plan,
// inbound purchase with an estimated arrival) goes on one ladder, the company's
// dated firm orders burn it down, and the walk yields a promise date, a risk date
// and the slip against what the projection actually needed.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const abbr = (v) => {
  const n = Math.abs(v || 0);
  if (n >= 1e7) return ((v || 0) / 1e7).toFixed(n >= 1e8 ? 0 : 1) + "Cr";
  if (n >= 1e5) return ((v || 0) / 1e5).toFixed(n >= 1e6 ? 0 : 1) + "L";
  if (n >= 1e3) return ((v || 0) / 1e3).toFixed(0) + "K";
  return fmt.num(v || 0);
};
const CELL = { border: "1px solid var(--border)", padding: "7px 8px", verticalAlign: "middle" };
const HCELL = { ...CELL, background: "#f7fafc", fontSize: 12, color: "#414d55",
  fontWeight: 600, whiteSpace: "nowrap" };

const CLASS = {
  none: { label: "No dated supply", color: "#7b1d1d",
    hint: "Nothing planned or in transit that we can see — no date can be given" },
  late: { label: "Slips past requirement", color: "#c53030",
    hint: "Supply arrives, but after the cycle needed it" },
  dated: { label: "Can be promised in time", color: "#3182ce",
    hint: "Supply arrives before the requirement date" },
  ready: { label: "Available now", color: "#2f855a",
    hint: "Enough on hand today, after everyone's committed orders" },
  covered: { label: "Already firm", color: "#90a1ac",
    hint: "Nothing left to convert — the projection is already ordered" },
};
const CLASS_ORDER = ["none", "late", "dated", "ready", "covered"];
const SOURCE = {
  production: { label: "Production", color: "#3182ce" },
  inbound: { label: "Inbound purchase (estimated)", color: "#805ad5" },
  stock: { label: "Stock on hand only", color: "#2f855a" },
  none: { label: "No forward supply", color: "#c53030" },
};

const STATUS_METRICS = [
  { id: "status", label: "Status", icon: CalendarClock, title: "Can we promise a date?" },
  { id: "slip", label: "Slippage", icon: Hourglass, title: "How far the promise slips" },
  { id: "nodate", label: "No date", icon: CalendarX2, title: "Items we cannot date at all" },
];
const RISK_METRICS = [
  { id: "risk", label: "Days to risk", icon: Hourglass, title: "When the stock runs out" },
  { id: "sources", label: "Supply sources", icon: Factory, title: "What the dates rest on" },
  { id: "all", label: "All items", icon: CalendarClock, title: "Every item and its dates" },
];

function statusDonut(buckets) {
  const rows = (buckets || []).filter((b) => b.items > 0);
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (o) => {
        const b = rows[o.dataIndex] || {};
        return `${o.marker} ${o.name}<br/><b style="font-size:13px">${fmt.num(o.value)}</b> items · ${o.percent}%`
          + (b.qty ? `<br/>${fmt.num(b.qty)} KG still to convert` : "")
          + `<br/><span style="color:#90a1ac">${(CLASS[b.key] || {}).hint || ""}</span>`;
      } },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    series: [{
      type: "pie", radius: ["54%", "77%"], center: ["50%", "43%"], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data: rows.map((b) => ({ value: b.items, name: (CLASS[b.key] || {}).label || b.key,
        itemStyle: { color: (CLASS[b.key] || {}).color } })),
    }],
  };
}

function barOption(rows, { labelKey, valueKey, color, unit, tip }) {
  const top = rows.slice(0, 14).slice().reverse();
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => tip(top[ps[0].dataIndex] || {}) },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10 },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => String(r[labelKey] || "—")),
      axisLabel: { color: "#414d55", fontSize: 11, width: 160, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18,
      itemStyle: { color: typeof color === "function" ? (o) => color(top[o.dataIndex]) : color,
        borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => `${fmt.num(o.value)}${unit}` },
      data: top.map((r) => Math.round(r[valueKey] || 0)),
    }],
  };
}

function sourcesDonut(rows) {
  const mix = { production: 0, inbound: 0, stock: 0, none: 0 };
  rows.forEach((r) => {
    const src = r.supply_sources || [];
    if (src.includes("production")) mix.production += 1;
    else if (src.includes("inbound")) mix.inbound += 1;
    else if (r.on_hand > 0) mix.stock += 1;
    else mix.none += 1;
  });
  const data = Object.entries(mix).filter(([, v]) => v > 0);
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (o) => `${o.marker} ${o.name}<br/><b style="font-size:13px">${fmt.num(o.value)}</b> items · ${o.percent}%`
        + (o.name.includes("estimated")
          ? '<br/><span style="color:#90a1ac">CRM carries no arrival date — modelled from PO date + our own average lead time</span>'
          : "") },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    series: [{
      type: "pie", radius: ["54%", "77%"], center: ["50%", "43%"],
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8 },
      data: data.map(([k, v]) => ({ value: v, name: SOURCE[k].label,
        itemStyle: { color: SOURCE[k].color } })),
    }],
  };
}

function AllClear({ icon: Icon, title, note, tone = "good" }) {
  const c = tone === "good" ? "#2f855a" : "#3182ce";
  return (
    <div className="commit-allclear">
      <span className="commit-allclear-badge" style={{ background: `${c}14`, color: c }}>
        <Icon size={30} strokeWidth={1.8} />
      </span>
      <span className="commit-allclear-title" style={{ color: c }}>{title}</span>
      <span className="commit-allclear-note">{note}</span>
    </div>
  );
}

function DateCell({ value, tone, title, suffix }) {
  return (
    <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap",
      color: tone || "var(--muted)", fontWeight: tone ? 600 : 400 }} title={title || ""}>
      {value || "—"}{suffix || ""}
    </td>
  );
}

function ItemTable({ rows, total, onPick }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.item} ${r.item_code || ""} ${r.segment3 || ""}`
      .toLowerCase().includes(s));
  }, [rows, q]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 250 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search item or segment…" />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} of {fmt.num(total ?? rows.length)} items · click a row for the supply timeline
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: "24%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} /><col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} /><col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} /><col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Projected quantity not yet converted to an order">Needed</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="When the cycle needs it — dated to the half of the cycle the planner used">Required by</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Earliest date supply covers the quantity, after everyone's committed orders">Can promise</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Promise date minus required date">Slip</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="First date committed orders take the balance negative">Runs out</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Days from today until it runs out">Days</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const c = CLASS[r.class] || CLASS.covered;
              return (
                <tr key={r.key} style={{ cursor: "pointer" }} onClick={() => onPick && onPick(r)}
                  title="Open the supply timeline for this item">
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}
                    title={`${r.item_code || ""} ${r.item}`}>{r.item}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>
                    {r.need > 0 ? fmt.num(r.need) : "—"}
                  </td>
                  <DateCell value={r.required} title="The half of the cycle this quantity was projected for" />
                  <DateCell value={r.ctp} tone={r.ctp ? (r.slip_days > 0 ? "#c53030" : "#2f855a") : null}
                    title={r.estimated ? "Rests on an estimated PO arrival" : ""}
                    suffix={r.estimated && r.ctp ? " ~" : ""} />
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                    color: r.slip_days > 0 ? "#c53030" : r.slip_days != null ? "#2f855a" : "var(--muted)" }}>
                    {r.slip_days == null ? "—" : r.slip_days > 0 ? `+${r.slip_days}d` : `${r.slip_days}d`}
                  </td>
                  <DateCell value={r.risk_date} tone={r.risk_date ? "#b7791f" : null} />
                  <td style={{ ...CELL, textAlign: "right",
                    color: r.days_to_risk == null ? "var(--muted)"
                      : r.days_to_risk <= 14 ? "#c53030" : "inherit" }}>
                    {r.days_to_risk == null ? "—" : `${r.days_to_risk}d`}
                  </td>
                  <td style={{ ...CELL }} title={c.hint}>
                    <span style={{ color: c.color, fontWeight: 600, fontSize: 11.5 }}>● {c.label}</span>
                    {r.breaches_msl && (
                      <span style={{ color: "#b7791f", fontSize: 11 }} title="Honouring this dips below the safety level"> · below MSL</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={8} style={CELL}>No items match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── the section-4 supply ladder ──────────────────────────────────────────────

function Fig({ label, value, unit = "", color, hint }) {
  return (
    <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 6,
      minWidth: 130, flex: "1 1 130px" }} title={hint || ""}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#1f3a5f" }}>
        {value == null || value === "" ? "—" : value}
        {unit && value != null && value !== "" ? <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}> {unit}</span> : null}
      </div>
    </div>
  );
}

function TimelineModal({ target, idParams, onClose }) {
  const { data, loading, error } = useAsync(
    () => (target ? api.promiseItem({ ...idParams, item: target.key }) : Promise.resolve(null)),
    [target && target.key]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);
  if (!target) return null;
  const r = data && data.found ? data.row : null;
  const c = r ? (CLASS[r.class] || CLASS.covered) : null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-container" role="dialog" aria-modal="true"
        style={{ maxWidth: 900, width: "94vw" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title" style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
              <CalendarClock size={16} style={{ flex: "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {target.item}
              </span>
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-container-body">
          {loading && <Loading what="supply timeline" />}
          {error && <ErrorBox error={error} />}
          {data && !data.found && !loading && (
            <div className="banner warn">This item is no longer in your scope for this cycle.</div>
          )}
          {r && !loading && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ color: c.color, fontWeight: 700, fontSize: 13 }}>● {c.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.hint}</span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <Fig label="Quantity to convert" value={fmt.num(r.need)} unit="KG" />
                <Fig label="Required by" value={r.required}
                  hint="The half of the cycle the planner entered this quantity in" />
                <Fig label="Can promise from" value={r.ctp}
                  color={r.ctp ? (r.slip_days > 0 ? "#c53030" : "#2f855a") : "#7b1d1d"}
                  hint={r.estimated ? "Rests on an estimated PO arrival date" : ""} />
                <Fig label="Slip" value={r.slip_days == null ? null : `${r.slip_days > 0 ? "+" : ""}${r.slip_days} days`}
                  color={r.slip_days > 0 ? "#c53030" : "#2f855a"} />
                <Fig label="Stock runs out" value={r.risk_date} color="#b7791f" />
                <Fig label="Days to risk" value={r.days_to_risk == null ? null : `${r.days_to_risk}`}
                  unit="days" color={r.days_to_risk != null && r.days_to_risk <= 14 ? "#c53030" : undefined} />
              </div>

              {r.class === "none" && (
                <div className="banner warn" style={{ marginBottom: 16 }}>
                  <b>No date can be given for this item.</b> There is no production job on the saved
                  plan and no open purchase order we can see, so nothing dated exists to promise from.
                  That does not mean it cannot be supplied — only that no planned supply is visible here.
                </div>
              )}
              {r.slip_days > 0 && (
                <div className="banner warn" style={{ marginBottom: 16 }}>
                  <b>Supply arrives {r.slip_days} days after this cycle needs it.</b>{" "}
                  Earliest promise is {r.ctp} against a requirement of {r.required}.
                  Raise the order now to hold the place in the queue, or agree a revised date
                  with the customer.
                </div>
              )}
              {r.breaches_msl && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14 }}>
                  Honouring this takes the balance below the safety level ({fmt.num(r.msl)} KG).
                  The promise is still shown — safety stock is a policy buffer, not a hard reservation.
                </div>
              )}

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Where the supply comes from</h4>
              <div className="tbl-wrap" style={{ maxHeight: 200, marginBottom: 16 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Available</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>Source</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Quantity (KG)</th>
                      <th style={{ ...HCELL, textAlign: "left" }}>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ ...CELL, fontWeight: 600 }}>{data.today}</td>
                      <td style={{ ...CELL }}>Stock on hand</td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.on_hand)}</td>
                      <td style={{ ...CELL, color: "var(--muted)", fontSize: 11.5 }}>
                        sellable stock across the orgs that ship
                      </td>
                    </tr>
                    {(data.sources || []).map((s, i) => (
                      <tr key={i}>
                        <td style={{ ...CELL, fontWeight: 600 }}>
                          {s.date}{s.estimate ? " ~" : ""}
                        </td>
                        <td style={{ ...CELL, color: (SOURCE[s.source] || {}).color, fontWeight: 600 }}>
                          {(SOURCE[s.source] || {}).label || s.source}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(s.qty)}</td>
                        <td style={{ ...CELL, color: "var(--muted)", fontSize: 11.5 }}>{s.note}</td>
                      </tr>
                    ))}
                    {!(data.sources || []).length && (
                      <tr><td colSpan={4} style={{ ...CELL, color: "var(--muted)" }}>
                        No production job and no open purchase order.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Running balance
                <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>
                  {" "}— committed orders across the whole company burning the supply down
                </span>
              </h4>
              <div className="tbl-wrap" style={{ maxHeight: 260 }}>
                <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...HCELL, textAlign: "left" }}>Date</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Supply in</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Orders out</th>
                      <th style={{ ...HCELL, textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ladder || []).map((s, i) => (
                      <tr key={i} style={s.balance < 0 ? { background: "#FDF3F3" } : undefined}>
                        <td style={{ ...CELL, fontWeight: 600 }}>{s.date}</td>
                        <td style={{ ...CELL, textAlign: "right", color: s.in > 0 ? "#2f855a" : "var(--muted)" }}>
                          {s.in > 0 ? `+${fmt.num(s.in)}` : "—"}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", color: s.out > 0 ? "#c53030" : "var(--muted)" }}>
                          {s.out > 0 ? `−${fmt.num(s.out)}` : "—"}
                        </td>
                        <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                          color: s.balance < 0 ? "#c53030" : "inherit" }}>
                          {fmt.num(s.balance)}
                        </td>
                      </tr>
                    ))}
                    {!(data.ladder || []).length && (
                      <tr><td colSpan={4} style={CELL}>No dated events in the horizon.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>, document.body);
}

function ExportBtn({ section, idParams }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn secondary dash-export" title="Download this table as Excel"
      disabled={busy} aria-label="Download this table as Excel"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await api.promiseDatesExport({ ...idParams, section }); } catch { /* surfaced by the browser */ }
        setBusy(false);
      }}>
      <Download size={14} />
    </button>
  );
}

const DASH_DEFAULTS = {
  statusCanvas: { x: 0, y: 0, w: 12, h: 12 },
  riskCanvas: { x: 0, y: 12, w: 12, h: 12 },
};

export default function PromiseDates({ session, isAdmin }) {
  const u = session?.user || {};

  const [viewAs, setViewAs] = useState({ persona: "", username: "" });
  const personas = useAsync(() => (isAdmin ? api.myDashboardPersonas() : Promise.resolve(null)), []);
  const plist = personas.data?.personas || [];
  const pickPersona = (e) => {
    const pn = e.target.value;
    const first = plist.find((x) => x.persona === pn)?.users?.[0]?.username || "";
    setViewAs({ persona: pn, username: pn ? first : "" });
  };
  const viewUsers = plist.find((x) => x.persona === viewAs.persona)?.users || [];

  const [jc, setJc] = useState(0);
  const idParams = useMemo(() => ({
    ...(viewAs.username
      ? { username: viewAs.username, persona: viewAs.persona }
      : { username: u.username || u.user_code || "", email: u.email || "", admin: isAdmin ? 1 : 0 }),
    jc,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [viewAs.username, viewAs.persona, isAdmin, jc]);

  const { data, loading, error } = useAsync(
    () => api.promiseDates(idParams), [viewAs.username, viewAs.persona, jc]);

  const [statMetric, setStatMetric] = useState("status");
  const [riskMetric, setRiskMetric] = useState("risk");
  const [statView, setStatView] = useState("chart");
  const [riskView, setRiskView] = useState("chart");
  const [classSel, setClassSel] = useState(null);
  const [pick, setPick] = useState(null);
  const [dlAll, setDlAll] = useState(false);
  useEffect(() => {
    setClassSel(null); setPick(null);
    setStatMetric("status"); setRiskMetric("risk");
    setStatView("chart"); setRiskView("chart");
  }, [viewAs.username, viewAs.persona, jc]);
  const pickStatMetric = (m) => { setStatMetric(m); setClassSel(null); };

  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("promisedates", me), [me]);

  const rows = data?.rows || [];
  const k = data?.kpis;
  const classRows = useMemo(
    () => (classSel ? rows.filter((r) => r.class === classSel) : []), [rows, classSel]);
  const lateRows = useMemo(
    () => rows.filter((r) => r.class === "late").slice().sort((a, b) => b.slip_days - a.slip_days),
    [rows]);
  const noDateRows = useMemo(
    () => rows.filter((r) => r.class === "none").slice().sort((a, b) => b.need - a.need), [rows]);
  const riskRows = useMemo(
    () => rows.filter((r) => r.days_to_risk != null).slice()
      .sort((a, b) => a.days_to_risk - b.days_to_risk), [rows]);

  const statusOpt = useMemo(() => statusDonut(k?.buckets), [k]);
  const slipOpt = useMemo(() => barOption(lateRows, {
    labelKey: "item", valueKey: "slip_days", color: "#c53030", unit: "d",
    tip: (r) => `<b>${r.item}</b><br/>needed ${fmt.num(r.need)} KG by ${r.required}<br/>`
      + `earliest promise <b>${r.ctp}</b><br/>`
      + `<span style="color:#c53030">slips <b>${r.slip_days}</b> days</span>`
      + '<br/><span style="color:#90a1ac">click for the supply timeline</span>' }), [lateRows]);
  const noDateOpt = useMemo(() => barOption(noDateRows, {
    labelKey: "item", valueKey: "need", color: "#7b1d1d", unit: "",
    tip: (r) => `<b>${r.item}</b><br/>${fmt.num(r.need)} KG to convert<br/>`
      + `<span style="color:#90a1ac">no production job and no open PO — nothing dated to promise from</span>` }),
  [noDateRows]);
  const riskOpt = useMemo(() => barOption(riskRows, {
    labelKey: "item", valueKey: "days_to_risk", unit: "d",
    color: (r) => (r.days_to_risk <= 7 ? "#c53030" : r.days_to_risk <= 30 ? "#b7791f" : "#3182ce"),
    tip: (r) => `<b>${r.item}</b><br/>committed orders exhaust the stock on <b>${r.risk_date}</b><br/>`
      + `${r.days_to_risk} days from today<br/>`
      + `<span style="color:#90a1ac">on hand ${fmt.num(r.on_hand)} KG</span>` }), [riskRows]);
  const sourcesOpt = useMemo(() => sourcesDonut(rows), [rows]);

  const fitRows = (n, toolbar = true) => {
    const px = 76 + (toolbar ? 46 : 0) + 38 + Math.min(n, 12) * 34 + 42;
    return Math.max(5, Math.ceil((px + 14) / 44));
  };
  const expandedCards = useMemo(() => {
    const out = {};
    if (statView === "table") {
      out.statusCanvas = fitRows(
        statMetric === "status" ? (classSel ? classRows.length : rows.length)
          : statMetric === "slip" ? lateRows.length : noDateRows.length);
    }
    if (riskView === "table") {
      out.riskCanvas = fitRows(riskMetric === "risk" ? riskRows.length : rows.length);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statView, riskView, statMetric, riskMetric, classSel, classRows.length,
    rows.length, lateRows.length, noDateRows.length, riskRows.length]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  if (!data.persona || !k) {
    const who = viewAs.username || u.username || "";
    return (
      <div className="banner warn">
        No data scope is mapped to {viewAs.username ? "this account" : "your account"}
        {who ? ` (${who})` : ""} — the CRM role-to-data mapping hasn’t been set up.
      </div>
    );
  }
  const syncedAt = data.last_sync?.finished_at ? String(data.last_sync.finished_at).slice(0, 16) : null;
  const SM = STATUS_METRICS.find((m) => m.id === statMetric) || STATUS_METRICS[0];
  const RM = RISK_METRICS.find((m) => m.id === riskMetric) || RISK_METRICS[0];
  const SIcon = SM.icon;
  const RIcon = RM.icon;

  return (
    <>
      {isAdmin && plist.length > 0 && (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          padding: "10px 16px", marginBottom: 14, background: viewAs.username ? "#FFF9EF" : undefined }}>
          <b style={{ fontSize: 13 }}>👁 View as</b>
          <SelectBox className="searchbox" style={{ maxWidth: 250 }} value={viewAs.persona} onChange={pickPersona}>
            <option value="">Myself (Admin — all data)</option>
            {plist.map((pp) => <option key={pp.persona} value={pp.persona}>{pp.persona} ({pp.users.length} users)</option>)}
          </SelectBox>
          {viewAs.persona && (
            <SelectBox className="searchbox" style={{ maxWidth: 280 }} value={viewAs.username}
              onChange={(e) => setViewAs((v) => ({ ...v, username: e.target.value }))}>
              {viewUsers.map((us) => <option key={us.username} value={us.username}>{us.user_name} — {us.username}</option>)}
            </SelectBox>
          )}
        </div>
      )}

      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
        padding: "12px 16px", marginBottom: 14 }}>
        <span className="chip" style={{ cursor: "default", background: "#EEF6FF", fontWeight: 600 }}>{data.persona}</span>
        <SelectBox className="searchbox" style={{ maxWidth: 150 }} value={String(data.jc)}
          title="Which journey cycle to promise against" onChange={(e) => setJc(Number(e.target.value) || 0)}>
          {(data.jcs || []).map((j) => <option key={j.jc} value={j.jc}>{j.label}</option>)}
        </SelectBox>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{(data.scope || []).join(" · ") || "—"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(k.promised)} promisable · <b style={{ color: k.late ? "#c53030" : "#2f855a" }}>
            {fmt.num(k.late)} slipping</b> · {fmt.num(k.no_date)} with no date
          {syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel workbook: charts on the first sheet, every table on its own sheet"
          disabled={dlAll}
          onClick={async () => {
            setDlAll(true);
            try { await api.promiseDatesExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDlAll(false);
          }}>
          <Download size={15} /> {dlAll ? "Preparing…" : "Download page"}
        </button>
      </div>

      <div className="banner" style={{ marginBottom: 14, fontSize: 12.5 }}>
        Dates come from one ladder per item: stock on hand today, production off saved plan{" "}
        <b>{data.plan_id || "—"}</b>, and open purchase orders. CRM holds no expected-arrival date,
        so a PO’s arrival is <b>estimated</b> from its order date plus our own average lead time —
        those rows are marked <b>~</b> ({fmt.num(k.estimated_items)} items). Committed orders across
        the whole company burn the supply down first. Requirement dates are accurate to a half-cycle:
        a projection carries no day-level date.
      </div>

      <DashGrid storageKey={`promisedates_layout_v1:${me || "anon"}`} defaults={DASH_DEFAULTS}
        expanded={expandedCards}
        remoteLayouts={savedLayout.data?.layouts || null}
        userLayouts={savedLayout.data?.user_layouts || null}
        canSaveDefault={isAdmin}
        onSaveDefault={(l) => api.saveDashboardLayout("promisedates", l)}
        onSaveUser={me ? (l) => api.saveDashboardLayout("promisedates", l, me) : undefined}>

        <div key="statusCanvas" className="card">
          <ExportBtn idParams={idParams}
            section={statMetric === "slip" ? "late" : statMetric === "nodate" ? "nodate" : "classes"} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <SIcon size={16} /> {classSel ? `${(CLASS[classSel] || {}).label} items` : SM.title}
              </h3>
              <div className="sub">
                {statMetric === "status" && (classSel
                  ? <>{fmt.num(classRows.length)} item{classRows.length === 1 ? "" : "s"} · {(CLASS[classSel] || {}).hint}</>
                  : <>{data.jc_label} · whether supply can cover what you have not converted yet ·
                    click a slice for the items</>)}
                {statMetric === "slip" &&
                  <>{fmt.num(k.late)} item{k.late === 1 ? "" : "s"} where supply arrives after the
                    cycle needs it · worst {k.worst_slip} days, average {k.avg_slip}</>}
                {statMetric === "nodate" &&
                  <>{fmt.num(k.no_date)} items carrying {abbr(k.no_date_qty)} KG with no production job
                    and no open PO — no date can be given</>}
              </div>
            </div>
            <div className="card-filters">
              {statMetric === "status" && classSel && (
                <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setClassSel(null)}>← All statuses</button>
              )}
              <SegTabs size="sm" value={statMetric} onChange={pickStatMetric}
                tabs={STATUS_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={statView} onChange={setStatView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {k.items === 0 ? (
            <AllClear icon={PartyPopper} tone="calm" title={`Nothing to promise for ${data.jc_label}`}
              note="There is no unconverted projection in your scope for this cycle." />
          ) : statMetric === "status" ? (
            statView === "chart" ? (
              classSel ? <ItemTable rows={classRows} total={classRows.length} onPick={setPick} />
                : <div className="echart-fill" style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
                    <EChart option={statusOpt} height="100%"
                      onEvents={{ click: (p) => {
                        const hit = CLASS_ORDER.find((key) => CLASS[key].label === p.name);
                        if (hit) setClassSel(hit);
                      } }} />
                  </div>
            ) : (
              <ItemTable rows={classSel ? classRows : rows}
                total={classSel ? classRows.length : data.total_rows} onPick={setPick} />
            )
          ) : statMetric === "slip" ? (
            lateRows.length === 0 ? (
              <AllClear icon={ShieldCheck} title="Nothing slips"
                note="Every item that can be promised arrives before the cycle needs it." />
            ) : statView === "chart" ? (
              <EChart className="echart-fill" option={slipOpt} height="100%"
                onEvents={{ click: (p) => {
                  const hit = lateRows.slice(0, 14).slice().reverse()[p.dataIndex];
                  if (hit) setPick(hit);
                } }} />
            ) : (
              <ItemTable rows={lateRows} total={lateRows.length} onPick={setPick} />
            )
          ) : noDateRows.length === 0 ? (
            <AllClear icon={ShieldCheck} title="Every item can be dated"
              note="Each item you still have to convert has visible supply to promise from." />
          ) : statView === "chart" ? (
            <EChart className="echart-fill" option={noDateOpt} height="100%"
              onEvents={{ click: (p) => {
                const hit = noDateRows.slice(0, 14).slice().reverse()[p.dataIndex];
                if (hit) setPick(hit);
              } }} />
          ) : (
            <ItemTable rows={noDateRows} total={noDateRows.length} onPick={setPick} />
          )}
        </div>

        <div key="riskCanvas" className="card">
          <ExportBtn section={riskMetric === "risk" ? "risk" : "items"} idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <RIcon size={16} /> {RM.title}
              </h3>
              <div className="sub">
                {riskMetric === "risk" &&
                  <>the date committed orders exhaust the stock · {fmt.num(k.running_out)} item
                    {k.running_out === 1 ? "" : "s"} run out within 14 days</>}
                {riskMetric === "sources" &&
                  <>what each item’s date actually rests on — stock, a production job, or an
                    estimated purchase arrival</>}
                {riskMetric === "all" &&
                  <>every item in scope with its requirement, promise and risk dates</>}
              </div>
            </div>
            <div className="card-filters">
              <SegTabs size="sm" value={riskMetric} onChange={setRiskMetric}
                tabs={RISK_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={riskView} onChange={setRiskView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {k.items === 0 ? (
            <AllClear icon={PartyPopper} tone="calm" title="Nothing in scope"
              note="No projection for this cycle against the customers you can see." />
          ) : riskMetric === "risk" ? (
            riskRows.length === 0 ? (
              <AllClear icon={Truck} title="No item runs out"
                note="Committed orders stay within available supply across the whole horizon." />
            ) : riskView === "chart" ? (
              <EChart className="echart-fill" option={riskOpt} height="100%"
                onEvents={{ click: (p) => {
                  const hit = riskRows.slice(0, 14).slice().reverse()[p.dataIndex];
                  if (hit) setPick(hit);
                } }} />
            ) : (
              <ItemTable rows={riskRows} total={riskRows.length} onPick={setPick} />
            )
          ) : riskMetric === "sources" ? (
            riskView === "chart" ? (
              <div className="echart-fill" style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
                <EChart option={sourcesOpt} height="100%" />
              </div>
            ) : (
              <ItemTable rows={rows} total={data.total_rows} onPick={setPick} />
            )
          ) : (
            <ItemTable rows={rows} total={data.total_rows} onPick={setPick} />
          )}
        </div>

      </DashGrid>

      <TimelineModal target={pick} idParams={idParams} onClose={() => setPick(null)} />
    </>
  );
}
