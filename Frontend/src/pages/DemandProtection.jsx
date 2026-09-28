import React, { useMemo, useState, useEffect } from "react";
import EChart from "../components/EChart.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { ShieldCheck, ShieldAlert, Download, Truck, FileCheck2, Users,
  TrendingUp, PartyPopper } from "lucide-react";

// Demand Protection — how much of the projection is actually backed by firm
// demand. A projection that converted AND ALREADY SHIPPED has no open order
// left, so cover counts dispatch as well as open orders; measuring against open
// orders alone reports every successful sale as a failure. Same persona scoping,
// View-as switcher, movable cards and Excel exports as My Dashboard.

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

// The three states a projected kilo can be in. They are mutually exclusive and
// always sum to the projection, so a donut of them is honest.
const COVER = {
  dispatched: { label: "Already dispatched", color: "#2f855a",
    hint: "Shipped inside this cycle — the projection converted and delivered" },
  soc: { label: "Open committed order", color: "#3182ce",
    hint: "A firm order is on the books, committed inside this cycle" },
  unprotected: { label: "Unprotected", color: "#c53030",
    hint: "Projected, but no order raised and nothing shipped" },
};
const PCT_COLOR = (p) => (p == null ? "var(--muted)" : p >= 70 ? "#2f855a" : p >= 40 ? "#b7791f" : "#c53030");

function coverDonut(k) {
  const rows = [
    { key: "dispatched", value: Math.round(k.dispatched || 0) },
    { key: "soc", value: Math.round(k.soc || 0) },
    { key: "unprotected", value: Math.round(k.unprotected || 0) },
  ].filter((r) => r.value > 0);
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (o) => `${o.marker} ${o.name}<br/><b style="font-size:13px">${fmt.num(o.value)}</b> KG · ${o.percent}%`
        + `<br/><span style="color:#90a1ac">${(COVER[rows[o.dataIndex].key] || {}).hint || ""}</span>` },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    title: { text: k.protection_pct == null ? "—" : `${k.protection_pct}%`,
      subtext: "of the projection is protected", left: "center", top: "33%",
      textStyle: { fontSize: 24, fontWeight: 700, color: PCT_COLOR(k.protection_pct) },
      subtextStyle: { fontSize: 11, color: "#90a1ac" } },
    series: [{
      type: "pie", radius: ["56%", "78%"], center: ["50%", "42%"], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data: rows.map((r) => ({ value: r.value, name: COVER[r.key].label,
        itemStyle: { color: COVER[r.key].color } })),
    }],
  };
}

function trendOption(trend) {
  const labels = trend.map((t) => t.label);
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const t = trend[ps[0].dataIndex] || {};
        return `<b>${t.label}</b><br/>`
          + ps.map((p) => `${p.marker} ${p.seriesName}: <b>${p.seriesName === "Protected %" ? `${p.value}%` : fmt.num(p.value) + " KG"}</b>`).join("<br/>")
          + `<br/><span style="color:#90a1ac">projected ${fmt.num(t.projected)} KG</span>`;
      } },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9,
      textStyle: { color: "#414d55", fontSize: 11 } },
    grid: { left: 8, right: 8, top: 16, bottom: 32, containLabel: true },
    xAxis: { type: "category", data: labels,
      axisLabel: { color: "#414d55", fontSize: 11 }, axisTick: { show: false } },
    yAxis: [
      { type: "value", name: "KG", nameTextStyle: { color: "#90a1ac", fontSize: 10 },
        axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
        splitLine: { lineStyle: { color: "#edf2f7" } } },
      { type: "value", name: "%", min: 0, max: 100, nameTextStyle: { color: "#90a1ac", fontSize: 10 },
        axisLabel: { color: "#90a1ac", fontSize: 10, formatter: "{value}%" },
        splitLine: { show: false } },
    ],
    series: [
      { name: "Protected", type: "bar", stack: "q", barMaxWidth: 34,
        itemStyle: { color: COVER.dispatched.color, borderRadius: [0, 0, 3, 3] },
        data: trend.map((t) => Math.round(t.protected)) },
      { name: "Unprotected", type: "bar", stack: "q", barMaxWidth: 34,
        itemStyle: { color: COVER.unprotected.color, borderRadius: [3, 3, 0, 0] },
        data: trend.map((t) => Math.round(t.unprotected)) },
      { name: "Protected %", type: "line", yAxisIndex: 1, smooth: true, symbolSize: 7,
        lineStyle: { width: 2.5, color: "#1f3a5f" }, itemStyle: { color: "#1f3a5f" },
        data: trend.map((t) => t.pct) },
    ],
  };
}

// One horizontal-bar shape for the three "worst offenders" cards.
function rankOption(rows, { labelKey, valueKey = "unprotected", color, unit = "KG" }) {
  const top = rows.slice(0, 14).slice().reverse();
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex] || {};
        return `<b>${r[labelKey] || "—"}</b><br/>`
          + `projected <b>${fmt.num(r.projected)}</b> ${unit}<br/>`
          + `protected <b>${fmt.num(r.protected)}</b> ${unit}${r.pct == null ? "" : ` · ${r.pct}%`}<br/>`
          + `<span style="color:#c53030">unprotected <b>${fmt.num(r.unprotected)}</b> ${unit}</span>`;
      } },
    grid: { left: 8, right: 46, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#90a1ac", fontSize: 10, formatter: abbr },
      splitLine: { lineStyle: { color: "#edf2f7" } } },
    yAxis: { type: "category", data: top.map((r) => String(r[labelKey] || "—")),
      axisLabel: { color: "#414d55", fontSize: 11, width: 150, overflow: "truncate" },
      axisTick: { show: false } },
    series: [{
      type: "bar", barMaxWidth: 18, itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", fontSize: 10.5, color: "#414d55",
        formatter: (o) => abbr(o.value) },
      data: top.map((r) => Math.round(r[valueKey] || 0)),
    }],
  };
}

// Each canvas holds several related charts behind a filter, so the page stays
// two cards instead of five. The id doubles as the export section name.
const COVER_METRICS = [
  { id: "cover", label: "Cover", icon: ShieldCheck, title: "Is the projection protected?" },
  { id: "cycle", label: "By cycle", icon: TrendingUp, title: "Protection by cycle" },
];
const EXPOSURE_METRICS = [
  { id: "collectors", label: "By collector", icon: Users, title: "Unprotected projection by collector" },
  { id: "items", label: "By item", icon: FileCheck2, title: "Unprotected projection by item" },
  { id: "silent", label: "Nothing raised", icon: ShieldAlert, title: "Nothing raised yet" },
];

// ── shared tables ────────────────────────────────────────────────────────────

function CoverBar({ r }) {
  const p = Math.max(0, Math.min(100, r.pct == null ? 0 : r.pct));
  return (
    <div title={`${r.pct == null ? "—" : r.pct + "%"} protected`}
      style={{ height: 7, background: "#edf2f7", borderRadius: 4, overflow: "hidden", minWidth: 44 }}>
      <div style={{ width: `${p}%`, height: "100%", background: PCT_COLOR(r.pct), borderRadius: 4 }} />
    </div>
  );
}

// The projection ledger — one row per customer + item.
function LineTable({ rows, total }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.customer} ${r.item} ${r.item_code || ""} ${r.collector || ""}`
      .toLowerCase().includes(s));
  }, [rows, q]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer, item or collector…" />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} of {fmt.num(total ?? rows.length)} lines
          {total != null && total > rows.length
            ? ` · showing the ${fmt.num(rows.length)} most exposed — download for all`
            : ""}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: "21%" }} /><col style={{ width: "22%" }} />
            <col style={{ width: "9%" }} /><col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Approved projection for this cycle (KG)">Projected</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Shipped to this customer inside the cycle">Dispatched</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Open committed order balance falling in this cycle">Open SOC</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Projected quantity with no order and nothing shipped">Unprotected</th>
              <th style={{ ...HCELL, textAlign: "left" }} title="Share of the projection covered by firm demand">Protected</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Collector</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }} title={r.customer}>{r.customer}</td>
                <td style={{ ...CELL }} title={`${r.item_code || ""} ${r.item || ""}`}>{r.item}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.projected)}</td>
                <td style={{ ...CELL, textAlign: "right",
                  color: r.dispatched > 0 ? COVER.dispatched.color : "var(--muted)" }}>
                  {r.dispatched > 0 ? fmt.num(r.dispatched) : "—"}
                </td>
                <td style={{ ...CELL, textAlign: "right",
                  color: r.soc > 0 ? COVER.soc.color : "var(--muted)" }}
                  title={r.soc_lines ? `${r.soc_lines} open order line${r.soc_lines === 1 ? "" : "s"}` : ""}>
                  {r.soc > 0 ? fmt.num(r.soc) : "—"}
                </td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                  color: r.unprotected > 0 ? COVER.unprotected.color : "var(--muted)" }}>
                  {r.unprotected > 0 ? fmt.num(r.unprotected) : "0"}
                </td>
                <td style={{ ...CELL }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <CoverBar r={r} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: PCT_COLOR(r.pct), minWidth: 32 }}>
                      {r.pct == null ? "—" : `${r.pct}%`}
                    </span>
                  </div>
                </td>
                <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}
                  title={r.mc_code ? `market circle ${r.mc_code}` : ""}>{r.collector || "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} style={CELL}>No lines match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Roll-up table shared by the collector / item / customer cards.
function GroupTable({ rows, label, title, extraCol }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => String(r[label] || "").toLowerCase().includes(s));
  }, [rows, q, label]);
  return (
    <>
      <div className="card-filters" style={{ marginBottom: 8 }}>
        <SmoothInput className="searchbox" style={{ maxWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} {title.toLowerCase()}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: extraCol ? "27%" : "34%" }} />
            {extraCol && <col style={{ width: "13%" }} />}
            <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
            <col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>{title}</th>
              {extraCol && <th style={{ ...HCELL, textAlign: "left" }}>{extraCol.head}</th>}
              <th style={{ ...HCELL, textAlign: "right" }}>Projected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Protected</th>
              <th style={{ ...HCELL, textAlign: "right" }}>Unprotected</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Protected</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Projection lines with no order and nothing shipped">Silent</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }} title={r[label]}>{r[label] || "—"}</td>
                {extraCol && <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>{extraCol.get(r) || "—"}</td>}
                <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(r.projected)}</td>
                <td style={{ ...CELL, textAlign: "right", color: COVER.dispatched.color }}>{fmt.num(r.protected)}</td>
                <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: COVER.unprotected.color }}>
                  {fmt.num(r.unprotected)}
                </td>
                <td style={{ ...CELL }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <CoverBar r={r} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: PCT_COLOR(r.pct), minWidth: 32 }}>
                      {r.pct == null ? "—" : `${r.pct}%`}
                    </span>
                  </div>
                </td>
                <td style={{ ...CELL, textAlign: "right", fontSize: 11.5, color: "var(--muted)" }}>
                  {fmt.num(r.silent_lines)} / {fmt.num(r.lines)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={extraCol ? 7 : 6} style={CELL}>Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// An empty risk card here is genuinely good news, so it says so rather than
// rendering a blank chart.
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

function ExportBtn({ section, idParams, label = "Download this table as Excel" }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn secondary dash-export" title={label}
      disabled={busy} aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await api.demandProtectionExport({ ...idParams, section }); } catch { /* surfaced by the browser */ }
        setBusy(false);
      }}>
      <Download size={14} />
    </button>
  );
}

const DASH_DEFAULTS = {
  coverCanvas: { x: 0, y: 0, w: 12, h: 11 },
  exposureCanvas: { x: 0, y: 11, w: 12, h: 12 },
};

export default function DemandProtection({ session, isAdmin }) {
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

  // 0 = let the server pick the planning JC
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
    () => api.demandProtection(idParams), [viewAs.username, viewAs.persona, jc]);

  // which chart each canvas is showing, and whether it is drawn or tabulated
  const [coverMetric, setCoverMetric] = useState("cover");
  const [expMetric, setExpMetric] = useState("collectors");
  const [coverView, setCoverView] = useState("chart");
  const [expView, setExpView] = useState("chart");
  const [coverSel, setCoverSel] = useState(null);      // donut drill-down
  const [dlAll, setDlAll] = useState(false);
  useEffect(() => {
    setCoverSel(null);
    setCoverMetric("cover"); setExpMetric("collectors");
    setCoverView("chart"); setExpView("chart");
  }, [viewAs.username, viewAs.persona, jc]);
  // the drill-down belongs to the cover donut only
  const pickCoverMetric = (m) => { setCoverMetric(m); setCoverSel(null); };

  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("demandprot", me), [me]);

  const rows = data?.rows || [];
  const k = data?.kpis;

  const coverRows = useMemo(() => {
    if (!coverSel) return [];
    if (coverSel === "unprotected") return rows.filter((r) => r.unprotected > 0);
    if (coverSel === "dispatched") return rows.filter((r) => r.dispatched > 0);
    return rows.filter((r) => r.soc > 0);
  }, [rows, coverSel]);
  const silentRows = useMemo(() => rows.filter((r) => r.silent), [rows]);

  const coverOpt = useMemo(() => coverDonut(k || {}), [k]);
  const trendOpt = useMemo(() => trendOption(data?.trend || []), [data]);
  const collOpt = useMemo(() => rankOption(data?.by_collector || [],
    { labelKey: "collector", color: "#c53030" }), [data]);
  const itemOpt = useMemo(() => rankOption(data?.by_item || [],
    { labelKey: "item", color: "#b7791f" }), [data]);
  const custOpt = useMemo(() => rankOption(
    (data?.by_customer || []).filter((c) => c.silent_lines > 0),
    { labelKey: "customer", color: "#805ad5" }), [data]);

  const fitRows = (n, toolbar = true) => {
    const px = 76 + (toolbar ? 46 : 0) + 38 + Math.min(n, 12) * 34 + 42;
    return Math.max(5, Math.ceil((px + 14) / 44));
  };
  const expandedCards = useMemo(() => {
    const out = {};
    if (coverView === "table") {
      out.coverCanvas = coverMetric === "cycle"
        ? fitRows((data?.trend || []).length, false)
        : fitRows(coverSel ? coverRows.length : rows.length);
    }
    if (expView === "table") {
      out.exposureCanvas = fitRows(
        expMetric === "collectors" ? (data?.by_collector || []).length
          : expMetric === "items" ? (data?.by_item || []).length
            : silentRows.length);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverView, expView, coverMetric, expMetric, coverSel,
    coverRows.length, rows.length, silentRows.length, data]);

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
  const CM = COVER_METRICS.find((m) => m.id === coverMetric) || COVER_METRICS[0];
  const EM = EXPOSURE_METRICS.find((m) => m.id === expMetric) || EXPOSURE_METRICS[0];
  const CIcon = CM.icon;
  const EIcon = EM.icon;

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
          title="Which journey cycle to measure"
          onChange={(e) => setJc(Number(e.target.value) || 0)}>
          {(data.jcs || []).map((j) => (
            <option key={j.jc} value={j.jc}>{j.label}{j.jc === data.jc && !data.has_dispatch ? " (planning)" : ""}</option>
          ))}
        </SelectBox>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{(data.scope || []).join(" · ") || "—"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {abbr(k.projected)} KG projected · <b style={{ color: PCT_COLOR(k.protection_pct) }}>
            {k.protection_pct == null ? "—" : `${k.protection_pct}% protected`}</b>
          {syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel workbook: charts on the first sheet, every table on its own sheet — all lines, uncapped"
          disabled={dlAll}
          onClick={async () => {
            setDlAll(true);
            try { await api.demandProtectionExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDlAll(false);
          }}>
          <Download size={15} /> {dlAll ? "Preparing…" : "Download page"}
        </button>
      </div>

      {!data.has_dispatch && (
        <div className="banner" style={{ marginBottom: 14 }}>
          <b>{data.jc_label} has not started yet</b> ({data.jc_from} → {data.jc_to}). Nothing has shipped
          against it, so cover here means open committed orders only — a low figure this early is normal.
        </div>
      )}

      <DashGrid storageKey={`demandprot_layout_v2:${me || "anon"}`} defaults={DASH_DEFAULTS}
        expanded={expandedCards}
        remoteLayouts={savedLayout.data?.layouts || null}
        userLayouts={savedLayout.data?.user_layouts || null}
        canSaveDefault={isAdmin}
        onSaveDefault={(l) => api.saveDashboardLayout("demandprot", l)}
        onSaveUser={me ? (l) => api.saveDashboardLayout("demandprot", l, me) : undefined}>

        {/* canvas 1 — how well the projection is covered, now and over time */}
        <div key="coverCanvas" className="card">
          <ExportBtn idParams={idParams}
            section={coverMetric === "cycle" ? "trend" : coverSel ? "lines" : "summary"} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <CIcon size={16} /> {coverSel ? (COVER[coverSel] || {}).label : CM.title}
              </h3>
              <div className="sub">
                {coverMetric === "cover" && (coverSel
                  ? <>{fmt.num(coverRows.length)} line{coverRows.length === 1 ? "" : "s"} · {(COVER[coverSel] || {}).hint}</>
                  : <>{data.jc_label} · projected {abbr(k.projected)} KG — protected once it has shipped
                    or a firm order covers it · click a slice for the lines</>)}
                {coverMetric === "cycle" &&
                  <>how much of each cycle’s projection ended up backed by firm demand — the conversion trend</>}
              </div>
            </div>
            <div className="card-filters">
              {coverMetric === "cover" && coverSel && (
                <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setCoverSel(null)}>← All cover</button>
              )}
              <SegTabs size="sm" value={coverMetric} onChange={pickCoverMetric}
                tabs={COVER_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={coverView} onChange={setCoverView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {coverMetric === "cover" ? (
            k.projected <= 0 ? (
              <AllClear icon={PartyPopper} tone="calm"
                title={`No projection in scope for ${data.jc_label}`}
                note="Nothing has been projected for this cycle against the customers you can see." />
            ) : coverView === "chart" ? (
              <div className="echart-fill" style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
                <EChart option={coverOpt} height="100%"
                  onEvents={{ click: (pt) => {
                    const hit = Object.keys(COVER).find((key) => COVER[key].label === pt.name);
                    if (hit) setCoverSel(hit);
                  } }} />
              </div>
            ) : (
              <LineTable rows={coverSel ? coverRows : rows}
                total={coverSel ? coverRows.length : data.total_rows} />
            )
          ) : (data.trend || []).length === 0 ? (
            <AllClear icon={TrendingUp} tone="calm" title="No cycles to compare yet"
              note="Once more than one cycle has been projected, the trend appears here." />
          ) : coverView === "chart" ? (
            <EChart className="echart-fill" option={trendOpt} height="100%" />
          ) : (
            <div className="tbl-wrap">
              <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...HCELL, textAlign: "left" }}>Cycle</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Projected</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Dispatched</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Open SOC</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Unprotected</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Protected %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.trend || []).map((t) => (
                    <tr key={t.jc}>
                      <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }}>{t.label}</td>
                      <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(t.projected)}</td>
                      <td style={{ ...CELL, textAlign: "right", color: COVER.dispatched.color }}>{fmt.num(t.dispatched)}</td>
                      <td style={{ ...CELL, textAlign: "right", color: COVER.soc.color }}>{fmt.num(t.soc)}</td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: COVER.unprotected.color }}>
                        {fmt.num(t.unprotected)}
                      </td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 700, color: PCT_COLOR(t.pct) }}>
                        {t.pct == null ? "—" : `${t.pct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* canvas 2 — where the exposure sits: collector, item, or not raised at all */}
        <div key="exposureCanvas" className="card">
          <ExportBtn section={expMetric} idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <EIcon size={16} /> {EM.title}
              </h3>
              <div className="sub">
                {expMetric === "collectors" &&
                  <>where the exposure sits — a low protected % means demand was projected but never converted</>}
                {expMetric === "items" &&
                  <>the products carrying the most projected-but-unconverted volume this cycle</>}
                {expMetric === "silent" &&
                  <>{fmt.num(k.silent_lines)} of {fmt.num(k.lines)} projection lines have no order and nothing
                    shipped — {abbr(k.silent_qty)} KG still entirely on paper</>}
              </div>
            </div>
            <div className="card-filters">
              <SegTabs size="sm" value={expMetric} onChange={setExpMetric}
                tabs={EXPOSURE_METRICS.map((m) => ({ id: m.id, label: m.label }))} />
              <SegTabs size="sm" value={expView} onChange={setExpView}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>

          {expMetric === "collectors" ? (
            (data.by_collector || []).length === 0 ? (
              <AllClear icon={ShieldCheck} title="Nothing unprotected"
                note="Every projected kilo in scope is covered by an order or already shipped." />
            ) : expView === "chart" ? (
              <EChart className="echart-fill" option={collOpt} height="100%" />
            ) : (
              <GroupTable rows={data.by_collector} label="collector" title="Collector" />
            )
          ) : expMetric === "items" ? (
            (data.by_item || []).length === 0 ? (
              <AllClear icon={ShieldCheck} title="Nothing unprotected"
                note="No item in scope has projected volume left uncovered." />
            ) : expView === "chart" ? (
              <EChart className="echart-fill" option={itemOpt} height="100%" />
            ) : (
              <GroupTable rows={data.by_item} label="item" title="Item"
                extraCol={{ head: "Segment", get: (r) => r.segment3 }} />
            )
          ) : k.silent_lines === 0 ? (
            <AllClear icon={Truck}
              title="Every projected line has moved"
              note="Each customer-item you projected for has either shipped or carries a firm order." />
          ) : expView === "chart" ? (
            <EChart className="echart-fill" option={custOpt} height="100%" />
          ) : (
            <LineTable rows={silentRows} total={silentRows.length} />
          )}
        </div>

      </DashGrid>
    </>
  );
}
