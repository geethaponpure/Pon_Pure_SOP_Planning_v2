import React, { useMemo, useState, useEffect } from "react";
import EChart from "../components/EChart.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import DashGrid from "../components/DashGrid.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { AlarmClock, CalendarCheck, CalendarDays, Download, Flame, PartyPopper,
  ShieldCheck, Undo2, Zap } from "lucide-react";

// Commitment Risk — every open order line the business has promised a date on,
// classified purely by how that date stands against today. Same persona scoping,
// View-as switcher, movable cards and Excel exports as My Dashboard.

const TT = {
  backgroundColor: "#fff", borderColor: "#e2e8f0", borderWidth: 1, padding: [8, 11],
  textStyle: { color: "#1a202c", fontSize: 12 },
  extraCssText: "box-shadow:0 12px 30px rgba(15,23,42,.16);border-radius:10px;",
};
const ANIM = { animationDuration: 650, animationEasing: "cubicOut" };
const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
const abbr = (v) => {
  const n = Math.abs(v);
  if (n >= 1e7) return (v / 1e7).toFixed(n >= 1e8 ? 0 : 1) + "Cr";
  if (n >= 1e5) return (v / 1e5).toFixed(n >= 1e6 ? 0 : 1) + "L";
  if (n >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return fmt.num(v);
};
const CELL = { border: "1px solid var(--border)", padding: "7px 8px", verticalAlign: "middle" };
const HCELL = { ...CELL, background: "#f7fafc", fontSize: 12, color: "#414d55",
  fontWeight: 600, whiteSpace: "nowrap" };

// the derived risk classes and their colours (worst first)
const RISK = {
  // Orders overdue by months are almost always never-closed paperwork rather
  // than commitments anyone is chasing, so they are kept visually apart from
  // the lines that still need action.
  stale: { label: "Overdue > 90 days", color: "#7b7f87" },
  overdue7: { label: "Overdue > 7 days", color: "#9b2c2c" },
  overdue: { label: "Overdue", color: "#c53030" },
  today: { label: "Due today", color: "#b7791f" },
  d2: { label: "Due in 1–2 days", color: "#d69e2e" },
  week: { label: "Due this week", color: "#3182ce" },
  later: { label: "Later", color: "#2f855a" },
  nodate: { label: "No commitment date", color: "#90a1ac" },
};

const REASON_PAL = ["#3182ce", "#b7791f", "#c53030", "#805ad5", "#2f855a", "#90a1ac", "#d69e2e"];

function donutOption(rows, { centerText, centerSub, unit }) {
  return {
    ...ANIM,
    tooltip: { ...TT, trigger: "item",
      formatter: (o) => `${o.marker} ${o.name}<br/><b style="font-size:13px">${fmt.num(o.value)}</b> ${unit} · ${o.percent}%` +
        (rows[o.dataIndex] && rows[o.dataIndex].kg != null
          ? `<br/><span style="color:#90a1ac">${fmt.num(rows[o.dataIndex].kg)} KG balance</span>` : "") },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, type: "scroll",
      textStyle: { color: "#414d55", fontSize: 11 } },
    title: { text: centerText, subtext: centerSub, left: "center", top: "33%",
      textStyle: { fontSize: 22, fontWeight: 700, color: "#1f3a5f" },
      subtextStyle: { fontSize: 11, color: "#90a1ac" } },
    series: [{
      type: "pie", radius: ["56%", "78%"], center: ["50%", "42%"], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.18)" } },
      data: rows.map((r) => ({ value: r.value, name: r.name, itemStyle: { color: r.color } })),
    }],
  };
}

function timelineOption(timeline) {
  return {
    ...ANIM, grid: { left: 8, right: 10, top: 20, bottom: 8, containLabel: true },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const t = timeline[ps[0].dataIndex] || {};
        return `<b>${t.label}</b><br/><b>${fmt.num(t.kg)}</b> KG committed` +
          `<br/><span style="color:#90a1ac">${fmt.num(t.lines)} order line${t.lines === 1 ? "" : "s"}</span>`;
      } },
    xAxis: { type: "category", data: timeline.map((t) => t.label), axisTick: { show: false },
      axisLabel: { color: "#414d55", fontSize: 10, rotate: 35, hideOverlap: true } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true } },
    series: [{ type: "bar", barWidth: "58%",
      data: timeline.map((t) => ({ value: t.kg,
        itemStyle: { borderRadius: [5, 5, 0, 0],
          color: t.overdue ? grad("#e08585", "#c53030") : grad("#7aa7ff", "#4880ff") } })) }],
  };
}

// top open lines as horizontal bars, coloured by their risk class
function topLinesOption(rows) {
  const top = rows.slice(0, 14);
  const rev = [...top].reverse();
  return {
    ...ANIM, grid: { left: 8, right: 26, top: 12, bottom: 8, containLabel: true },
    tooltip: { ...TT, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const m = rev[ps[0].dataIndex] || {};
        const rk = RISK[m.bucket] || {};
        return `<b>${m.item_name}</b><br/>${m.customer_name || ""}` +
          `<br/><b>${fmt.num(m.balance)}</b> KG balance · committed ${m.resched_date || "—"}` +
          `<br/><span style="color:${rk.color}">● ${rk.label}${m.days != null && m.days < 0 ? ` (${-m.days}d late)` : ""}</span>` +
          (m.supply_risk ? `<br/><span style="color:#9b2c2c">no plan supply before commitment</span>` : "");
      } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef1f5" } },
      axisLabel: { color: "#90a1ac", fontSize: 11, formatter: abbr, hideOverlap: true },
      axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: rev.map((m) => m.item_name),
      axisLabel: { color: "#414d55", fontSize: 11, width: 170, overflow: "truncate", hideOverlap: true },
      axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", barWidth: "58%",
      data: rev.map((m) => {
        const c = (RISK[m.bucket] || {}).color || "#4880ff";
        return { value: m.balance, itemStyle: { borderRadius: [0, 6, 6, 0], color: grad(c + "66", c) } };
      }) }],
  };
}

// An empty risk card means nothing is late / nothing is due — that is the
// outcome the page exists to produce, so it gets a proper "all clear" panel
// rather than a blank chart or an empty table.
export function AllClear({ icon: Icon, title, note, tone = "good" }) {
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

// one table shape for every drill-down list on this page (self-contained search)
function LineTable({ rows, total }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((m) =>
      (m.item_name || "").toLowerCase().includes(t) ||
      (m.item_code || "").toLowerCase().includes(t) ||
      (m.customer_name || "").toLowerCase().includes(t) ||
      String(m.order_ref || "").toLowerCase().includes(t));
  }, [rows, q]);
  return (
    <>
      <div className="pagebar" style={{ marginBottom: 10 }}>
        <SmoothInput className="searchbox" placeholder="Search order / customer / item…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(shown.length)} of {fmt.num(total ?? rows.length)} lines
          {total != null && total > rows.length
            ? ` · showing the ${fmt.num(rows.length)} most urgent — download for all`
            : ""}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <colgroup>
            <col style={{ width: "9%" }} /><col style={{ width: "17%" }} />
            <col style={{ width: "20%" }} /><col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} /><col style={{ width: "9%" }} />
            <col style={{ width: "6%" }} /><col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...HCELL, textAlign: "left" }}>Order</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Customer</th>
              <th style={{ ...HCELL, textAlign: "left" }}>Item</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Balance still to dispatch (KG)">Bal (KG)</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="The date the customer asked for">Requested</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Current committed delivery date">Committed</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="Days late (−) or days left (+)">Days</th>
              <th style={{ ...HCELL, textAlign: "left" }} title="Risk class · reschedule reason when the line was pushed">Risk / reason</th>
              <th style={{ ...HCELL, textAlign: "right" }} title="When the latest JC plan produces this item (+ receipt lead)">Plan supply</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m, i) => {
              const rk = RISK[m.bucket] || RISK.later;
              return (
                <tr key={i}>
                  <td style={{ ...CELL, fontSize: 11.5 }} title={`${m.order_ref || m.order_no} · placed ${m.soc_date || "—"}`}>
                    {m.order_ref || m.order_no}
                  </td>
                  <td style={{ ...CELL, fontWeight: 600, color: "#1f3a5f" }} title={m.customer_name}>{m.customer_name}</td>
                  <td style={{ ...CELL }} title={`${m.item_code || ""} ${m.item_name || ""}`}>{m.item_name}</td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(m.balance)}</td>
                  <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap",
                    color: m.off_request ? "#b7791f" : "var(--muted)" }}
                    title={m.off_request
                      ? "We committed to a different date than the customer asked for"
                      : "We committed to the date the customer asked for"}>
                    {m.cust_req_date || "—"}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap" }}
                    title={m.pushed ? `pushed from ${m.sched_date}` : "as first committed"}>
                    {m.resched_date || "—"}{m.pushed ? " ↷" : ""}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", fontWeight: 700,
                    color: m.days == null ? "var(--muted)" : m.days < 0 ? "#c53030" : m.days <= 2 ? "#b7791f" : "inherit" }}>
                    {m.days == null ? "—" : m.days < 0 ? `${m.days}d` : `+${m.days}d`}
                  </td>
                  <td style={{ ...CELL }}
                    title={[rk.label, m.resched_reason, m.wh_comments, m.executive && `exec: ${m.executive}`]
                      .filter(Boolean).join(" · ")}>
                    <span style={{ color: rk.color, fontWeight: 600, fontSize: 11.5 }}>● {rk.label}</span>
                    {(m.resched_reason || m.wh_comments)
                      ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · {m.resched_reason || m.wh_comments}</span>
                      : null}
                  </td>
                  <td style={{ ...CELL, textAlign: "right", fontSize: 11.5, whiteSpace: "nowrap",
                    color: m.supply_risk ? "#9b2c2c" : "var(--muted)", fontWeight: m.supply_risk ? 700 : 400 }}
                    title={m.supply_risk ? "The latest JC plan has no supply before this commitment" : ""}>
                    {m.supply_date || "—"}{m.supply_risk ? " ⚠" : ""}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={9} style={CELL}>No lines match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
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
        try { await api.commitRiskExport({ ...idParams, section }); } catch { /* surfaced by the browser */ }
        setBusy(false);
      }}>
      <Download size={14} />
    </button>
  );
}

const DASH_DEFAULTS = {
  riskStatus: { x: 0, y: 0, w: 6, h: 9 },
  timeline: { x: 6, y: 0, w: 6, h: 9 },
  rush: { x: 0, y: 9, w: 12, h: 10 },
  emergency: { x: 0, y: 19, w: 12, h: 10 },
  pushed: { x: 0, y: 29, w: 12, h: 10 },
};

export default function CommitRisk({ session, isAdmin }) {
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

  const idParams = useMemo(() => (viewAs.username
    ? { username: viewAs.username, persona: viewAs.persona }
    : { username: u.username || u.user_code || "", email: u.email || "", admin: isAdmin ? 1 : 0 }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [viewAs.username, viewAs.persona, isAdmin]);

  const { data, loading, error } = useAsync(
    () => api.commitRisk(idParams), [viewAs.username, viewAs.persona]);

  const [bucketSel, setBucketSel] = useState(null);           // risk drill-down
  // every card opens as a CHART; the user switches the ones they want as tables
  const CHART_VIEWS = { risk: "chart", timeline: "chart", rush: "chart",
    emergency: "chart", pushed: "chart" };
  const [views, setViews] = useState(CHART_VIEWS);
  const setView = (k) => (v) => setViews((s) => ({ ...s, [k]: v }));
  const [dlAll, setDlAll] = useState(false);
  useEffect(() => {
    setBucketSel(null);
    setViews(CHART_VIEWS);
  }, [viewAs.username, viewAs.persona]);

  const me = (u.user_code || u.username || "").trim();
  const savedLayout = useAsync(() => api.dashboardLayout("commitrisk", me), [me]);

  const rows = data?.rows || [];
  const bucketRows = useMemo(
    () => (bucketSel ? rows.filter((r) => r.bucket === bucketSel) : []), [rows, bucketSel]);
  // server-side totals for the scope (the payload rows are capped per class)
  const totals = useMemo(() => Object.fromEntries(
    (data?.buckets || []).map((b) => [b.key, b.lines])), [data]);
  const bucketTotal = bucketSel ? (totals[bucketSel] ?? bucketRows.length) : 0;
  const rushRows = useMemo(() => rows.filter((r) => r.bucket === "today" || r.bucket === "d2"), [rows]);
  const emergencyRows = useMemo(() => rows.filter((r) => r.bucket === "overdue7" || r.bucket === "overdue"), [rows]);
  const pushedRows = useMemo(() => rows.filter((r) => r.pushed), [rows]);

  const riskOpt = useMemo(() => donutOption(
    (data?.buckets || []).map((b) => ({ name: RISK[b.key]?.label || b.key, value: b.lines,
      kg: b.kg, color: RISK[b.key]?.color })),
    { centerText: fmt.num(data?.kpis?.overdue_lines || 0), centerSub: "lines overdue", unit: "lines" }),
  [data]);
  const riskEvents = useMemo(() => ({
    click: (e) => {
      const k = Object.keys(RISK).find((x) => RISK[x].label === e.name);
      if (k) setBucketSel(k);
    },
  }), []);
  const timelineOpt = useMemo(() => timelineOption(data?.timeline || []), [data]);
  const rushOpt = useMemo(() => topLinesOption(rushRows), [rushRows]);
  const emergencyOpt = useMemo(() => topLinesOption(emergencyRows), [emergencyRows]);
  const bucketOpt = useMemo(() => topLinesOption(bucketRows), [bucketRows]);
  const reasonsOpt = useMemo(() => donutOption(
    (data?.reasons || []).slice(0, 8).map((r, i) => ({ name: r.reason, value: r.lines, kg: r.kg,
      color: REASON_PAL[i % REASON_PAL.length] })),
    { centerText: fmt.num(data?.kpis?.pushed_lines || 0), centerSub: "lines pushed", unit: "lines" }),
  [data]);

  // A card showing its table takes the full row and fits its rows. This is safe
  // again now that DashGrid saves the un-expanded geometry rather than skipping
  // the save while a card is expanded.
  const fitRows = (n, toolbar = true) => {
    const px = 76 + (toolbar ? 46 : 0) + 38 + Math.min(n, 12) * 34 + 42;
    return Math.max(5, Math.ceil((px + 14) / 44));
  };
  const expandedCards = useMemo(() => {
    const out = {};
    if (views.risk === "table") {
      out.riskStatus = bucketSel ? fitRows(bucketRows.length)
        : fitRows((data?.buckets || []).length, false);
    }
    if (views.timeline === "table") out.timeline = fitRows((data?.timeline || []).length, false);
    if (views.rush === "table") out.rush = fitRows(rushRows.length);
    if (views.emergency === "table") out.emergency = fitRows(emergencyRows.length);
    if (views.pushed === "table") out.pushed = fitRows(pushedRows.length);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, bucketSel, bucketRows.length, rushRows.length,
      emergencyRows.length, pushedRows.length, data]);



  if (loading && !data) return <Loading what="commitment risk" />;
  if (error) return <ErrorBox msg={error} />;

  const k = data.kpis;
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
        {viewAs.username && data.user_name && (
          <span className="chip" style={{ cursor: "default", background: "#FFF3E8", fontWeight: 600 }}>{data.user_name.trim()}</span>
        )}
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{(data.scope || []).join(" · ") || "—"}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {fmt.num(k.lines)} open lines · {abbr(k.kg)} KG{syncedAt ? ` · data as of ${syncedAt}` : ""}
        </span>
        <button type="button" className="btn secondary" style={{ display: "inline-flex", gap: 6 }}
          title="Excel workbook: charts on the first sheet, every table on its own sheet — all lines, uncapped"
          disabled={dlAll}
          onClick={async () => {
            setDlAll(true);
            try { await api.commitRiskExport({ ...idParams }); } catch { /* surfaced by the browser */ }
            setDlAll(false);
          }}>
          <Download size={15} /> {dlAll ? "Preparing…" : "Download page"}
        </button>
      </div>

      <DashGrid storageKey={`commitrisk_layout_v1:${me || "anon"}`} defaults={DASH_DEFAULTS}
        expanded={expandedCards}
        remoteLayouts={savedLayout.data?.layouts || null}
        userLayouts={savedLayout.data?.user_layouts || null}
        canSaveDefault={isAdmin}
        onSaveDefault={(l) => api.saveDashboardLayout("commitrisk", l)}
        onSaveUser={me ? (l) => api.saveDashboardLayout("commitrisk", l, me) : undefined}>

        <div key="riskStatus" className="card">
          <ExportBtn section={bucketSel ? "lines" : "buckets"} idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div>
              <h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <AlarmClock size={16} /> {bucketSel ? (RISK[bucketSel] || {}).label : "Commitments by risk"}
              </h3>
              <div className="sub">
                {bucketSel
                  ? <>{fmt.num(bucketTotal)} line{bucketTotal === 1 ? "" : "s"} in this class · {abbr((data.buckets.find((b) => b.key === bucketSel) || {}).kg || 0)} KG</>
                  : <>open order lines by how the committed date stands against today · click a slice for the lines</>}
              </div>
            </div>
            <div className="card-filters">
              {bucketSel && (
                <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setBucketSel(null)}>← All risks</button>
              )}
              <SegTabs size="sm" value={views.risk} onChange={setView("risk")}
                tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
            </div>
          </div>
          {k.lines === 0 ? (
            <AllClear icon={PartyPopper}
              title="No open commitments"
              note="Every committed order line in your scope has been dispatched." />
          ) : views.risk === "chart" ? (
            bucketSel
              ? <EChart className="echart-fill" option={bucketOpt} height="100%" />
              : <EChart className="echart-fill" option={riskOpt} height="100%" onEvents={riskEvents} />
          ) : bucketSel ? (
            bucketTotal === 0
              ? <AllClear icon={ShieldCheck} tone="calm"
                  title={`No lines are ${(RISK[bucketSel] || {}).label?.toLowerCase()}`}
                  note="Nothing in your scope falls into this risk class right now." />
              : <LineTable rows={bucketRows} total={bucketTotal} />
          ) : (
            <div className="tbl-wrap">
              <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <colgroup><col style={{ width: "40%" }} /><col style={{ width: "18%" }} />
                  <col style={{ width: "24%" }} /><col style={{ width: "18%" }} /></colgroup>
                <thead>
                  <tr>
                    <th style={{ ...HCELL, textAlign: "left" }}>Risk</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Lines</th>
                    <th style={{ ...HCELL, textAlign: "right" }}>Balance (KG)</th>
                    <th style={{ ...HCELL, textAlign: "left" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(data.buckets || []).map((b, i) => (
                    <tr key={i} onClick={() => { setBucketSel(b.key); setViews((s) => ({ ...s, risk: "table" })); }}
                      style={{ cursor: "pointer" }} title="Click to see these lines">
                      <td style={{ ...CELL, fontWeight: 600, color: (RISK[b.key] || {}).color }}>
                        ● {(RISK[b.key] || {}).label || b.key}
                      </td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(b.lines)}</td>
                      <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(b.kg)}</td>
                      <td style={{ ...CELL, fontSize: 11.5, color: "var(--muted)" }}>view lines →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div key="timeline" className="card">
          <ExportBtn section="timeline" idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <CalendarDays size={16} /> Commitment timeline</h3>
              <div className="sub">KG committed per day — the red bar is everything already overdue</div></div>
            <SegTabs size="sm" value={views.timeline} onChange={setView("timeline")}
              tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
          </div>
          {views.timeline === "chart" ? (
            <EChart className="echart-fill" option={timelineOpt} height="100%" />
          ) : (
            <div className="tbl-wrap">
              <table className="proj-table" style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <colgroup><col style={{ width: "40%" }} /><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /></colgroup>
                <thead><tr>
                  <th style={{ ...HCELL, textAlign: "left" }}>Day</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Lines due</th>
                  <th style={{ ...HCELL, textAlign: "right" }}>Committed (KG)</th>
                </tr></thead>
                <tbody>
                  {(data.timeline || []).map((t, i) => (
                    <tr key={i}>
                      <td style={{ ...CELL, fontWeight: 600, color: t.overdue ? "#c53030" : "#1f3a5f" }}>{t.label}</td>
                      <td style={{ ...CELL, textAlign: "right" }}>{fmt.num(t.lines)}</td>
                      <td style={{ ...CELL, textAlign: "right", fontWeight: 600 }}>{fmt.num(t.kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div key="rush" className="card">
          <ExportBtn section="rush" idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Zap size={16} /> Rush — due within 48h</h3>
              <div className="sub">
                {fmt.num(k.rush_lines)} line{k.rush_lines === 1 ? "" : "s"} · {abbr(k.rush_kg)} KG still to dispatch by tomorrow
              </div></div>
            <SegTabs size="sm" value={views.rush} onChange={setView("rush")}
              tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
          </div>
          {k.rush_lines === 0 ? (
            <AllClear icon={CalendarCheck} tone="calm"
              title="Nothing due in the next 48 hours"
              note="No open line is committed for today or tomorrow — the dispatch desk has room to breathe." />
          ) : views.rush === "chart" ? (
            <EChart className="echart-fill" option={rushOpt} height="100%" />
          ) : (
            <LineTable rows={rushRows} total={k.rush_lines} />
          )}
        </div>

        <div key="emergency" className="card"
          style={k.overdue_lines > 0 ? { background: "#FFFBFA" } : undefined}>
          <ExportBtn section="emergency" idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Flame size={16} /> Emergency — commitment broken</h3>
              <div className="sub">
                {fmt.num(k.overdue_lines)} overdue line{k.overdue_lines === 1 ? "" : "s"} · {abbr(k.overdue_kg)} KG
                {k.stale_lines > 0
                  ? <span style={{ color: "var(--muted)" }}> · {fmt.num(k.stale_lines)} more overdue by 90+ days, shown separately</span>
                  : null}
                {k.supply_risk_lines > 0 && data.supply_plan
                  ? <span style={{ color: "#9b2c2c", fontWeight: 600 }}> · {fmt.num(k.supply_risk_lines)} with no plan supply in time</span>
                  : null}
              </div></div>
            <SegTabs size="sm" value={views.emergency} onChange={setView("emergency")}
              tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
          </div>
          {k.overdue_lines === 0 ? (
            <AllClear icon={PartyPopper}
              title="Every commitment is being met"
              note="Not a single open order line has passed its committed date — nothing is late in your scope." />
          ) : views.emergency === "chart" ? (
            <EChart className="echart-fill" option={emergencyOpt} height="100%" />
          ) : (
            <LineTable rows={emergencyRows} total={k.overdue_lines} />
          )}
        </div>

        <div key="pushed" className="card">
          <ExportBtn section="pushed" idParams={idParams} />
          <div className="supply-dash-cardhead">
            <div><h3 style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Undo2 size={16} /> Pushed commitments</h3>
              <div className="sub">
                {fmt.num(k.pushed_lines)} line{k.pushed_lines === 1 ? "" : "s"} moved past the date first promised — and why
              </div></div>
            <SegTabs size="sm" value={views.pushed} onChange={setView("pushed")}
              tabs={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
          </div>
          {k.pushed_lines === 0 ? (
            <AllClear icon={ShieldCheck}
              title="No commitment has been moved"
              note="Every open line still sits on the date it was first promised." />
          ) : views.pushed === "chart" ? (
            <EChart className="echart-fill" option={reasonsOpt} height="100%" />
          ) : (
            <LineTable rows={pushedRows} total={k.pushed_lines} />
          )}
        </div>
      </DashGrid>
    </>
  );
}
