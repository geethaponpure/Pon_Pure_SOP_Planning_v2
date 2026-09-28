import React, { useEffect, useState } from "react";
import Pagination, { usePagination } from "../components/Pagination.jsx";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { ClipboardList, History, Mail, Settings, User, Timer, TriangleAlert, Factory, Package, Pause, Ban, Save, Download } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

const ROLES = ["R&D Requester", "Warehouse In-charge", "Warehouse Executive",
  "QA / QC", "R&D Head / Plant Head", "System Administrator"];

const STATUS_COLORS = {
  Draft: "#EEE", Submitted: "#FFF4DA", PendingApproval: "#E6E6FA", ApprovalRejected: "#FFE5E5",
  Acknowledged: "#E6F6EC", InProgress: "#EEF6FF", Closed: "#E6F6EC", Cancelled: "#FFE5E5",
  Open: "#FFF4DA", Hold: "#FFE5E5", PartiallyDispatched: "#EEF6FF", Dispatched: "#E6F6EC",
  Received: "#E6F6EC", ReceivedWithDiscrepancy: "#FFF4DA", Rejected: "#FFE5E5", ShortClosed: "#F3F0E8",
};
const Chip = ({ v }) => <span className="chip" style={{ cursor: "default", fontSize: 11, background: STATUS_COLORS[v] || "#EEE" }}>{v}</span>;

function usePersona() {
  const [persona, setPersona] = useState(() => {
    try { return JSON.parse(localStorage.getItem("srdms_persona")) || {}; } catch { return {}; }
  });
  const save = (p) => { setPersona(p); localStorage.setItem("srdms_persona", JSON.stringify(p)); };
  return [{ name: "", email: "", role: ROLES[0], ...persona }, save];
}

// capability helpers, mapped to the BRD role rights
const isReq = (r) => /Requester|Administrator/.test(r);                    // create/submit/cancel/receipt
const isWhIncharge = (r) => /Warehouse In-charge|Administrator/.test(r);   // acknowledge / assign
const isWh = (r) => /Warehouse|Administrator/.test(r);                     // dispatch / hold / reject (in-charge + executive)
const isApprover = (r) => /Head|Administrator/.test(r);                    // approve
const isAdmin = (r) => /Administrator/.test(r);
const isQa = (r) => /QA|QC|Administrator/.test(r);

function deriveRole(user) {
  if (!user) return ROLES[0];
  if ((user.menus || []).some((m) => (m.id || m) === "usermaster")) return "System Administrator";
  const d = (user.department || "").toLowerCase();
  if (/warehouse/.test(d)) return "Warehouse In-charge";
  if (/\bqa\b|\bqc\b|quality/.test(d)) return "QA / QC";
  return "R&D Requester";
}

export default function SRDMS({ session, mode = "all" }) {
  const rolesQ = useAsync(() => api.srdms.userRoles(), []);
  const masters = useAsync(() => api.srdms.masters(), []);
  const [manual, setManual] = usePersona();      // fallback when the app runs without login
  const [viewAs, setViewAs] = useState("");       // admin "view as" role override (admin console only)
  const [view, setView] = useState("dashboard");
  const [selId, setSelId] = useState(null);
  const [ver, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const open = (id) => { setSelId(id); setView("detail"); };

  // The MODULE the user entered through fixes the role (R&D Sample Requests → Requester,
  // Warehouse Sample Dispatch → Warehouse, QC for R&D Sample → QA/QC). The admin console
  // ("all") uses the assigned/derived role and lets admins "view as" any role.
  const lu = session?.user;
  const assigned = lu && rolesQ.data?.user_roles?.[lu.user_code];
  let realRole;
  if (mode === "requester") realRole = (assigned && /Head/.test(assigned.role || "")) ? assigned.role : "R&D Requester";
  else if (mode === "qc") realRole = "QA / QC";
  else if (mode === "warehouse") realRole = (assigned && /Warehouse/.test(assigned.role || "")) ? assigned.role : "Warehouse In-charge";
  else realRole = assigned?.role || deriveRole(lu);
  const canSwitch = mode === "all" && (!lu || isAdmin(realRole));
  const effRole = mode === "all" ? (viewAs || realRole) : realRole;
  const persona = lu
    ? { name: lu.name || lu.username, email: lu.email || "", user_code: lu.user_code,
        role: effRole, plant_id: (assigned && assigned.plant_id) || "" }
    : { ...manual, role: mode === "all" ? manual.role : realRole };

  useEffect(() => {   // keep the tab within what the role can do
    if (view === "new" && !isReq(persona.role)) setView("dashboard");
    if (view === "masters" && !isAdmin(persona.role)) setView("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.role]);

  return (
    <>
      <PageInfo title="Sample Request & Dispatch Management (SRDMS)">
        R&D raises sample-material requests to a plant warehouse;
        the warehouse acknowledges, dispatches (batch + delivery mode), holds or short-closes each line; the requester
        acknowledges receipt. Every step is timestamped for TAT / ageing and fires the email notification matrix (N1–N13).
      </PageInfo>

      {(!lu || canSwitch) && (
        <div className="card" style={{ marginTop: 12, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {lu ? (
            <>
              <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}><User size={14} /> <b>{persona.name}</b>{persona.email ? ` · ${persona.email}` : ""}</span>
              <span className="chip" style={{ cursor: "default" }}>{realRole}{persona.plant_id ? ` · plant ${persona.plant_id}` : ""}</span>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                View as:
                <SelectBox className="searchbox" style={{ maxWidth: 210 }} value={viewAs || realRole}
                  onChange={(e) => setViewAs(e.target.value === realRole ? "" : e.target.value)}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </SelectBox>
              </label>
              {viewAs && viewAs !== realRole && <span style={{ fontSize: 11, color: "#8a6d00" }}>viewing as {viewAs}</span>}
            </>
          ) : (
            <ManualPersona persona={manual} setPersona={setManual} />
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        <SegTabs value={view === "detail" ? "requests" : view}
          onChange={(id) => { setView(id); setSelId(null); }}
          tabs={[
            { id: "dashboard", label: "Dashboard" },
            { id: "requests", label: "Requests" },
            ...(isReq(persona.role) ? [{ id: "new", label: "New Request" }] : []),
            { id: "reports", label: "Reports" },
            { id: "notifications", label: "Notifications" },
            ...(isAdmin(persona.role) ? [{ id: "masters", label: "Masters" }] : []),
          ]} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          Acting as <b>{persona.name || "—"}</b> · {persona.role}
        </span>
      </div>

      {(masters.loading || rolesQ.loading) && <Loading what="SRDMS" />}
      {masters.error && <ErrorBox msg={masters.error} />}
      {masters.data && (
        <>
          {view === "dashboard" && <Dashboard onOpen={open} ver={ver} />}
          {view === "requests" && <RequestList onOpen={open} masters={masters.data} persona={persona} mode={mode} ver={ver} />}
          {view === "new" && isReq(persona.role) && <NewRequest masters={masters.data} persona={persona}
            onDone={(id) => { bump(); open(id); }} />}
          {view === "detail" && selId && <Detail id={selId} persona={persona} masters={masters.data}
            onChange={bump} onBack={() => setView("requests")} ver={ver} />}
          {view === "reports" && <Reports ver={ver} />}
          {view === "notifications" && <Notifications ver={ver} onChange={bump} />}
          {view === "masters" && isAdmin(persona.role) && <Masters masters={masters.data} onSaved={() => masters.refresh()} />}
        </>
      )}
    </>
  );
}

function ManualPersona({ persona, setPersona }) {
  return (
    <>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>Acting user (no login layer — recorded on every action):</span>
      <SmoothInput className="searchbox" style={{ maxWidth: 180 }} placeholder="Your name" value={persona.name}
        onChange={(e) => setPersona({ ...persona, name: e.target.value })} />
      <SmoothInput className="searchbox" style={{ maxWidth: 230 }} placeholder="email@pure-chemical.com" value={persona.email}
        onChange={(e) => setPersona({ ...persona, email: e.target.value })} />
      <SelectBox className="searchbox" style={{ maxWidth: 220 }} value={persona.role}
        onChange={(e) => setPersona({ ...persona, role: e.target.value })}>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
      </SelectBox>
    </>
  );
}

function Dashboard({ onOpen, ver }) {
  const { data, loading, error } = useAsync(() => api.srdms.dashboard(), [ver]);
  const { sort, toggle, apply } = useSort("tat.open_age_days", "desc");
  if (loading) return <Loading what="dashboard" />;
  if (error) return <ErrorBox msg={error} />;
  const t = data.totals || {};
  const card = (v, l, cls = "") => <div className={`card statcard ${cls}`}><div className="ic">•</div>
    <div className="stat"><div className="v">{fmt.compact(v)}</div><div className="l">{l}</div></div></div>;
  return (
    <>
      <div className="grid cols-4" style={{ marginTop: 12 }}>
        {card(t.open, "Open requests")}
        {card(t.held_lines, "Lines on hold", "amber")}
        {card(t.ack_breach, "Ack SLA breached", t.ack_breach ? "red" : "")}
        {card(t.hold_overdue, "Holds overdue", t.hold_overdue ? "red" : "")}
      </div>
      <div className="grid cols-4" style={{ marginTop: 10 }}>
        {card(t.all, "All requests")}
        {card(t.closed, "Closed")}
        <div className="card statcard"><div className="ic"><Timer size={22} /></div><div className="stat">
          <div className="v">{data.avg_ack_tat_h == null ? "—" : `${data.avg_ack_tat_h}h`}</div>
          <div className="l">Avg acknowledge TAT</div></div></div>
        <div className="card statcard"><div className="ic"><Timer size={22} /></div><div className="stat">
          <div className="v">{data.avg_total_tat_h == null ? "—" : `${data.avg_total_tat_h}h`}</div>
          <div className="l">Avg total TAT (closed)</div></div></div>
      </div>

      <h3 style={{ marginTop: 18 }}>Open requests — ageing</h3>
      <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
        {Object.entries(data.aging_buckets || {}).map(([k, v]) => (
          <span key={k} className="chip" style={{ cursor: "default" }}>{k}: <b>{v}</b></span>
        ))}
      </div>
      <div className="tbl-wrap">
        <table><thead><tr>
          <SortTh label="SR No" k="sr_no" sort={sort} toggle={toggle} />
          <SortTh label="Requester" k="requester_name" sort={sort} toggle={toggle} />
          <SortTh label="Plant" k="plant_name" sort={sort} toggle={toggle} />
          <SortTh label="Priority" k="priority" sort={sort} toggle={toggle} />
          <SortTh label="Status" k="status" sort={sort} toggle={toggle} />
          <SortTh label="Open lines" k="open_lines" sort={sort} toggle={toggle} num />
          <SortTh label="Age (d)" k="tat.open_age_days" sort={sort} toggle={toggle} num /><th></th>
        </tr></thead><tbody>
          {apply(data.open_requests || []).map((r) => (
            <tr key={r.id}>
              <td><b>{r.sr_no}</b></td><td>{r.requester_name}</td><td>{r.plant_name}</td>
              <td><Chip v={r.priority} /></td><td><Chip v={r.status} /></td>
              <td className="num">{r.open_lines}</td>
              <td className="num" style={{ color: (r.tat.open_age_days || 0) > 3 ? "var(--red)" : "inherit" }}>{r.tat.open_age_days ?? "—"}</td>
              <td><button className="chip" onClick={() => onOpen(r.id)}>Open</button></td>
            </tr>
          ))}
          {(data.open_requests || []).length === 0 && <tr><td colSpan={8}>No open requests.</td></tr>}
        </tbody></table>
      </div>

      {(data.hold_overdue_lines || []).length > 0 && (
        <>
          <h3 style={{ marginTop: 18, color: "var(--red)", display: "inline-flex", alignItems: "center", gap: 7 }}><TriangleAlert size={16} /> Holds past planned date</h3>
          <div className="tbl-wrap"><table><thead><tr>
            <th>SR No</th><th>Item</th><th>Planned date</th><th>Reason</th><th>Requester</th><th></th>
          </tr></thead><tbody>
            {data.hold_overdue_lines.map((h, i) => (
              <tr key={i}><td>{h.sr_no}</td><td>{h.item}</td><td>{h.planned_date}</td><td>{h.reason}</td>
                <td>{h.requester}</td><td><button className="chip" onClick={() => onOpen(h.sr_id)}>Open</button></td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
    </>
  );
}

// ---- sortable table helper (click a header to sort; click again to flip) ----
function useSort(defaultKey = "", defaultDir = "asc") {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const apply = (rows) => {
    if (!sort.key) return rows;
    const val = (r) => sort.key.split(".").reduce((o, k) => (o == null ? o : o[k]), r);
    const empty = (v) => v == null || v === "" || v === "—";
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (empty(va) && empty(vb)) return 0;
      if (empty(va)) return 1;          // blanks always sink to the bottom
      if (empty(vb)) return -1;
      const c = (typeof va === "number" && typeof vb === "number")
        ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return sort.dir === "asc" ? c : -c;
    });
  };
  return { sort, toggle, apply };
}

function SortTh({ label, k, sort, toggle, num }) {
  const active = sort.key === k;
  return (
    <th className={num ? "num" : ""} onClick={() => toggle(k)} title="Click to sort"
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {label}<span style={{ opacity: active ? 1 : 0.3, marginLeft: 4, fontSize: 9 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

function RequestList({ onOpen, masters, persona, mode, ver }) {
  // a warehouse user bound to a plant only sees that plant's requests (unless admin)
  const boundPlant = (isWh(persona?.role) && !isAdmin(persona?.role) && persona?.plant_id) || "";
  const [f, setF] = useState({ status: "", plant_id: boundPlant, q: "" });
  const eff = { ...f, plant_id: boundPlant || f.plant_id };
  const { data, loading, error } = useAsync(() => api.srdms.list(eff), [ver, eff.status, eff.plant_id, eff.q]);

  // Scope the list to the user: QC → QC-routed; R&D Head → requests referred to them;
  // R&D Requester → their own; warehouse/admin → all (plant-bound for warehouse).
  const qcOnly = mode === "qc";
  const regSet = new Set(masters.regulated_plants || []);
  const myCode = persona?.user_code || "";
  const isHeadUser = /Head/.test(persona?.role || "") && !isAdmin(persona?.role);
  const isReqUser = /Requester/.test(persona?.role || "") && !isAdmin(persona?.role);
  const rows = (data?.requests || []).filter((r) => {
    if (qcOnly) {
      return (r.lines || []).some((l) => !["Released", "Rejected"].includes(l.qa_status || "") && ["Open", "Hold"].includes(l.status)
        && (regSet.has(r.plant_id) || /qc|qa/i.test((l.hold && l.hold.reason) || "")));
    }
    if (mode === "requester") {
      if (isHeadUser) return r.rd_head_code === myCode;      // R&D head: referred to them
      if (isReqUser) return r.requester_code === myCode;     // requester: their own requests
    }
    return true;
  });
  const { sort, toggle, apply } = useSort("sr_no", "desc");
  const sortedRows = apply(rows);
  const pg = usePagination(sortedRows, [eff.q, eff.status, eff.plant_id, ver, sort]);
  return (
    <>
      <div className="pagebar" style={{ marginTop: 12 }}>
        <SmoothInput className="searchbox" placeholder="Search SR / requester / item…" value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })} />
        <SelectBox className="searchbox" style={{ maxWidth: 180 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>
          {["Draft", "Submitted", "PendingApproval", "Acknowledged", "InProgress", "Dispatched", "Closed", "Cancelled", "ApprovalRejected"].map((s) => <option key={s}>{s}</option>)}
        </SelectBox>
        <SelectBox className="searchbox" style={{ maxWidth: 180 }} value={eff.plant_id} disabled={!!boundPlant}
          title={boundPlant ? "You are bound to this plant" : ""} onChange={(e) => setF({ ...f, plant_id: e.target.value })}>
          <option value="">All plants</option>
          {(masters.plants || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectBox>
      </div>
      {loading && <Loading what="requests" />}
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="tbl-wrap"><table><thead><tr>
          <SortTh label="SR No" k="sr_no" sort={sort} toggle={toggle} />
          <SortTh label="Requester" k="requester_name" sort={sort} toggle={toggle} />
          <SortTh label="Plant" k="plant_name" sort={sort} toggle={toggle} />
          <SortTh label="Priority" k="priority" sort={sort} toggle={toggle} />
          <SortTh label="Required by" k="required_by" sort={sort} toggle={toggle} />
          <SortTh label="Status" k="status" sort={sort} toggle={toggle} />
          <SortTh label="Lines" k="line_count" sort={sort} toggle={toggle} num />
          <SortTh label="Req qty" k="qty_requested_total" sort={sort} toggle={toggle} num />
          <SortTh label="Disp qty" k="qty_dispatched_total" sort={sort} toggle={toggle} num />
          <SortTh label="Submitted" k="submitted_at" sort={sort} toggle={toggle} /><th></th>
        </tr></thead><tbody>
          {pg.pageRows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.sr_no || "(draft)"}</b></td><td>{r.requester_name}</td><td>{r.plant_name}</td>
              <td><Chip v={r.priority} /></td><td>{r.required_by || "—"}</td><td><Chip v={r.status} /></td>
              <td className="num">{r.line_count}</td><td className="num">{fmt.num(r.qty_requested_total)}</td>
              <td className="num">{fmt.num(r.qty_dispatched_total)}</td><td style={{ fontSize: 11 }}>{r.submitted_at || "—"}</td>
              <td><button className="chip" onClick={() => onOpen(r.id)}>Open</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={11}>{
            qcOnly ? "No QC-routed requests — an item appears here when its plant is regulated (QC gate) or the warehouse holds a line for QC."
              : isHeadUser ? "No sample requests are referred to you yet."
              : isReqUser ? "You haven't raised any sample requests yet."
              : "No requests."}</td></tr>}
        </tbody></table>
        <Pagination {...pg} /></div>
      )}
    </>
  );
}

const blankLine = () => ({ item_code: "", item_desc: "", uom: "KG", qty_requested: "", remarks: "" });

// CRM item search — pick by NAME; fills description + (optional) code + UoM.
function ItemPicker({ desc, onPick }) {
  const [q, setQ] = useState(desc || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setQ(desc || ""); }, [desc]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      if ((q || "").trim().length < 2) { setResults([]); return; }
      setLoading(true);
      try { const r = await api.srdms.items(q); setResults(r.items || []); } catch { setResults([]); } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff" }}
        value={q} placeholder="Search item name from CRM…"
        onChange={(e) => { setQ(e.target.value); onPick({ item_desc: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && (loading || results.length > 0) && (
        <div style={{ position: "absolute", zIndex: 30, background: "#fff", border: "1px solid var(--border)", borderRadius: 8,
          maxHeight: 260, overflow: "auto", width: "100%", minWidth: 300, boxShadow: "0 8px 20px rgba(15,23,42,.18)" }}>
          {loading && <div style={{ padding: 8, fontSize: 12, color: "var(--muted)" }}>searching CRM…</div>}
          {results.map((it, k) => (
            <div key={k} style={{ padding: "6px 9px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
              onMouseDown={() => { onPick({ item_desc: it.name, item_code: it.code || "", uom: it.uom || "KG" }); setQ(it.name); setOpen(false); }}>
              <b>{it.name}</b><div style={{ color: "var(--muted)" }}>{it.code}{it.uom ? ` · ${it.uom}` : ""}</div>
            </div>
          ))}
          {!loading && results.length === 0 && <div style={{ padding: 8, fontSize: 12, color: "var(--muted)" }}>no match — you can type a free name</div>}
        </div>
      )}
    </div>
  );
}

function NewRequest({ masters, persona, onDone }) {
  const [h, setH] = useState({
    requester_email: persona.email || "", department: "",
    request_location: "", plant_id: (masters.plants[0] || {}).id || "", priority: "Normal",
    required_by: "", rd_head: "", rd_head_code: "", purpose: "",
  });
  const heads = useAsync(() => api.srdms.rdHeads(), []);
  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const setLineMulti = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const create = async (submit) => {
    setBusy(true);
    try {
      const body = { ...h, requester_name: persona.name || "", requester_code: persona.user_code || "",
        lines: lines.filter((l) => l.item_desc || l.item_code).map((l) => ({ ...l, qty_requested: Number(l.qty_requested) || 0 })), actor: persona };
      if (!body.lines.length) throw new Error("Add at least one item line");
      const created = await api.srdms.create(body);
      if (submit) await api.srdms.submit(created.id, persona);
      onDone(created.id);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const inp = { width: "100%", maxWidth: 320, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff" };
  const field = (label, node, req) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{label}{req && <span style={{ color: "var(--red)" }}> *</span>}</span>
      {node}
    </label>
  );
  return (
    <div className="card" style={{ marginTop: 12, padding: 20, maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <ClipboardList size={18} />
        <h3 style={{ margin: 0 }}>Form A — Sample Request</h3>
      </div>
      <div className="sub" style={{ marginBottom: 16 }}>Fill the request header, then add one or more sample items. Item code is filled automatically when you pick a name from CRM.</div>

      <div style={{ padding: 16, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 18 }}>
        <div className="grid cols-3" style={{ gap: 14 }}>
          {field("R&D Head", <select style={inp} value={h.rd_head_code}
            onChange={(e) => { const hd = (heads.data?.heads || []).find((x) => x.user_code === e.target.value); setH({ ...h, rd_head_code: e.target.value, rd_head: hd ? hd.name : "" }); }}>
            <option value="">Select your R&D head…</option>
            {(heads.data?.heads || []).map((hd) => <option key={hd.user_code} value={hd.user_code}>{hd.name}</option>)}
          </select>, true)}
          {field("Department", <input style={inp} value={h.department} placeholder="e.g. R&D — Coatings" onChange={(e) => setH({ ...h, department: e.target.value })} />)}
          {field("Request (delivery) location", <input style={inp} value={h.request_location} placeholder="Where should the sample be delivered?" onChange={(e) => setH({ ...h, request_location: e.target.value })} />)}
          {field("Target plant", <select style={inp} value={h.plant_id} onChange={(e) => setH({ ...h, plant_id: e.target.value })}>
            {(masters.plants || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>, true)}
          {field("Priority", <select style={inp} value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value })}>
            {(masters.priorities || []).map((p) => <option key={p}>{p}</option>)}</select>)}
          {field("Required-by date", <input type="date" style={inp} value={h.required_by} onChange={(e) => setH({ ...h, required_by: e.target.value })} />)}
          {field("Purpose / remarks", <textarea style={{ ...inp, minHeight: 72, resize: "vertical", fontFamily: "inherit" }} value={h.purpose} placeholder="Reason for the sample request" onChange={(e) => setH({ ...h, purpose: e.target.value })} />)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <h4 style={{ margin: 0, color: "var(--navy)" }}>Items</h4>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Search the item name — code &amp; UoM auto-fill from CRM.</span>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 34 }} /><col /><col style={{ width: 168 }} />
            <col style={{ width: 92 }} /><col style={{ width: 104 }} /><col style={{ width: 220 }} /><col style={{ width: 44 }} />
          </colgroup>
          <thead><tr style={{ background: "#f1f5fb", textAlign: "left" }}>
            {["#", "Item name (from CRM)", "Item code", "UoM", "Qty", "Remarks", ""].map((t, k) => (
              <th key={k} style={{ padding: "9px 10px", fontSize: 10.5, letterSpacing: ".3px", textTransform: "uppercase",
                color: "var(--muted)", fontWeight: 700, borderBottom: "1px solid var(--border)" }}>{t}</th>
            ))}
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 10px", color: "var(--muted)", fontWeight: 600 }}>{i + 1}</td>
                <td style={{ padding: "8px 10px" }}><ItemPicker desc={l.item_desc} onPick={(patch) => setLineMulti(i, patch)} /></td>
                <td style={{ padding: "8px 10px" }}>
                  <input style={{ ...inp, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 600,
                    letterSpacing: ".5px", padding: "9px 10px",
                    color: l.item_code ? "var(--green)" : "var(--muted)",
                    background: l.item_code ? "var(--green-bg)" : "#fff",
                    borderColor: l.item_code ? "#9ae6b4" : "var(--border)" }}
                    placeholder="auto / optional" value={l.item_code} onChange={(e) => setLine(i, "item_code", e.target.value)} />
                </td>
                <td style={{ padding: "8px 10px" }}><select style={{ ...inp, padding: "9px 8px" }} value={l.uom} onChange={(e) => setLine(i, "uom", e.target.value)}>
                  {(masters.uoms || ["KG"]).map((u) => <option key={u}>{u}</option>)}</select></td>
                <td style={{ padding: "8px 10px" }}><input type="number" style={{ ...inp, textAlign: "right", padding: "9px 10px" }} placeholder="0" value={l.qty_requested} onChange={(e) => setLine(i, "qty_requested", e.target.value)} /></td>
                <td style={{ padding: "8px 10px" }}><input style={inp} placeholder="optional" value={l.remarks} onChange={(e) => setLine(i, "remarks", e.target.value)} /></td>
                <td style={{ padding: "8px 6px", textAlign: "center" }}>
                  <button className="chip" style={{ padding: "4px 9px", color: "var(--red)" }} title="Remove line"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="chip" style={{ marginTop: 10 }} onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add item</button>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
        <button className="btn secondary" disabled={busy} onClick={() => create(false)}><Save size={15} /> Save draft</button>
        <button className="btn" disabled={busy} onClick={() => create(true)}>{busy ? "…" : "▶ Submit request"}</button>
      </div>
    </div>
  );
}

function ActionPanel({ req, line, persona, masters, onChange }) {
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const wh = isWh(persona.role), rq = isReq(persona.role), qa = isQa(persona.role);
  const regulated = (masters.regulated_plants || []).includes(req.plant_id);
  // warehouse can act directly on a Submitted request (no separate acknowledge step)
  const active = ["Submitted", "Acknowledged", "InProgress"].includes(req.status);
  const canWhAct = wh && active && !["Dispatched", "Rejected", "ShortClosed", "Received", "ReceivedWithDiscrepancy"].includes(line.status);
  const canReceive = rq && ["Dispatched", "PartiallyDispatched"].includes(line.status);
  // QC can record a test result (OK / Reject) on any pending line, not only regulated plants
  const canQa = qa && active && ["Open", "Hold"].includes(line.status);

  const run = async (fn) => { try { await fn(); setAct(null); setF({}); onChange(); } catch (e) { alert(e.message); } };
  const inp = (k, ph, type = "text") => <input type={type} className="searchbox" style={{ width: "100%", minWidth: 0 }} placeholder={ph} value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;

  return (
    <div style={{ padding: "6px 0" }}>
      {(regulated || qa || line.qa_status) && <div style={{ fontSize: 11, marginBottom: 3 }}>QC: {line.qa_status
        ? <span className="chip" style={{ cursor: "default", fontSize: 10, background: line.qa_status === "Released" ? "#E6F6EC" : "#FFE5E5" }}>{line.qa_status === "Released" ? "QC OK / Passed" : "QC Rejected"}{line.qa?.remarks ? ` · ${line.qa.remarks}` : ""}</span>
        : <span style={{ color: "#8a6d00" }}>{regulated ? "QC release required before dispatch" : "pending QC"}</span>}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canWhAct && <><button className="chip" onClick={() => setAct("dispatch")}>Dispatch</button>
          <button className="chip" onClick={() => setAct("hold")}>Hold</button>
          <button className="chip" onClick={() => setAct("reject")}>Reject / Short-close</button></>}
        {canQa && <button className="chip" onClick={() => setAct("qa")}>QC test result (OK / Reject)</button>}
        {canReceive && <button className="chip" onClick={() => setAct("receipt")}>Acknowledge receipt</button>}
        {act && <button className="chip" onClick={() => { setAct(null); setF({}); }}>Cancel</button>}
      </div>

      {act === "qa" && (
        <div className="grid cols-3" style={{ gap: 6, marginTop: 8 }}>
          <SelectBox className="searchbox" style={{ width: "100%", minWidth: 0 }} value={f.decision || "Released"} onChange={(e) => setF({ ...f, decision: e.target.value })}>
            <option value="Released">✓ QC OK / Passed</option><option value="Rejected">✗ QC Rejected</option></SelectBox>
          {inp("remarks", "QC remarks / COA / test ref")}
          <button className="btn" onClick={() => run(() => api.srdms.qaRelease(req.id, line.line_id, { decision: f.decision || "Released", remarks: f.remarks, actor: persona }))}>Submit QC result</button>
        </div>
      )}

      {act === "dispatch" && (() => {
        const batches = f.batches || [{ batch_no: "", qty: "", mfg_date: "", exp_date: "" }];
        const setB = (i, k, v) => setF({ ...f, batches: batches.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });
        const addB = () => setF({ ...f, batches: [...batches, { batch_no: "", qty: "", mfg_date: "", exp_date: "" }] });
        const rmB = (i) => setF({ ...f, batches: batches.filter((_, j) => j !== i) });
        const delivered = batches.reduce((a, b) => a + (Number(b.qty) || 0), 0);
        const balance = line.qty_requested - line.qty_dispatched - delivered;
        const mode = f.mode || "Courier";
        const inPerson = mode === "In person" || mode === "Hand delivery";
        return (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Batches</div>
            <table style={{ width: "100%", tableLayout: "fixed", fontSize: 12 }}>
              <colgroup><col style={{ width: 24 }} /><col /><col style={{ width: 68 }} /><col style={{ width: 116 }} /><col style={{ width: 116 }} /><col style={{ width: 30 }} /></colgroup>
              <thead><tr>
              <th style={{ textAlign: "left" }}>#</th><th style={{ textAlign: "left" }}>Batch no*</th>
              <th style={{ textAlign: "left" }}>Qty*</th><th style={{ textAlign: "left" }}>Mfg date</th>
              <th style={{ textAlign: "left" }}>Exp date</th><th></th></tr></thead>
              <tbody>{batches.map((b, i) => {
                const cell = { width: "100%", minWidth: 0, padding: "8px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, background: "#fff" };
                return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td style={{ paddingRight: 6 }}><input style={cell} value={b.batch_no} onChange={(e) => setB(i, "batch_no", e.target.value)} /></td>
                  <td style={{ paddingRight: 6 }}><input type="number" style={{ ...cell, textAlign: "right" }} value={b.qty} onChange={(e) => setB(i, "qty", e.target.value)} /></td>
                  <td style={{ paddingRight: 6 }}><input type="month" style={cell} value={b.mfg_date} onChange={(e) => setB(i, "mfg_date", e.target.value)} /></td>
                  <td style={{ paddingRight: 6 }}><input type="month" style={cell} value={b.exp_date} onChange={(e) => setB(i, "exp_date", e.target.value)} /></td>
                  <td><button className="chip" disabled={batches.length === 1} onClick={() => rmB(i)}>✕</button></td>
                </tr>);})}</tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 8px" }}>
              <button className="chip" onClick={addB}>+ Add batch</button>
              <span style={{ fontSize: 12 }}>Delivered <b>{delivered.toFixed(3)}</b> · balance <b>{balance.toFixed(3)}</b></span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, margin: "2px 0 4px" }}>Delivery mode*</div>
            <div className="grid cols-3" style={{ gap: 6 }}>
              <SelectBox className="searchbox" style={{ width: "100%", minWidth: 0 }} value={mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                {(masters.delivery_modes || []).map((m) => <option key={m}>{m}</option>)}</SelectBox>
              {mode === "Courier" && <>{inp("courier_name", "Courier name")}{inp("awb_no", "Docket / AWB no")}{inp("tracking_link", "Tracking link")}</>}
              {mode === "Vehicle" && <>{inp("vehicle_no", "Vehicle no")}{inp("driver_name", "Driver name")}{inp("driver_contact", "Driver contact")}</>}
              {inPerson && <>{inp("person_name", "Handed to (person)")}{inp("contact", "Contact")}</>}
              {inp("dispatch_date", inPerson ? "Delivery date" : "Dispatch date", "date")}
              {/* In-person = handed over directly: no ETA, packages or freight */}
              {!inPerson && inp("expected_arrival", "Expected delivery", "date")}
              {!inPerson && inp("packages", "Packages", "number")}
              {!inPerson && (
                <SelectBox className="searchbox" style={{ width: "100%", minWidth: 0 }} value={f.freight || ""} onChange={(e) => setF({ ...f, freight: e.target.value })}>
                  <option value="">Freight…</option>{(masters.freight_terms || ["Paid", "To pay"]).map((t) => <option key={t}>{t}</option>)}
                </SelectBox>
              )}
            </div>
            <button className="btn" style={{ marginTop: 8 }} onClick={() => run(() => api.srdms.dispatch(req.id, line.line_id, {
              batches: batches.filter((b) => Number(b.qty) > 0).map((b) => ({ batch_no: b.batch_no, qty: Number(b.qty) || 0, mfg_date: b.mfg_date, exp_date: b.exp_date })),
              mode, mode_details: { courier_name: f.courier_name, awb_no: f.awb_no, tracking_link: f.tracking_link, vehicle_no: f.vehicle_no, driver_name: f.driver_name, driver_contact: f.driver_contact, person_name: f.person_name, contact: f.contact },
              packages: inPerson ? null : (Number(f.packages) || null), freight: inPerson ? "" : (f.freight || ""),
              dispatch_date: f.dispatch_date, expected_arrival: inPerson ? "" : (f.expected_arrival || ""), actor: persona,
            }))}>Submit and notify requester</button>
          </div>
        );
      })()}
      {act === "hold" && (
        <div className="grid cols-3" style={{ gap: 6, marginTop: 8 }}>
          <SelectBox className="searchbox" value={f.reason || ""} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            <option value="">Hold reason…</option>{(masters.hold_reasons || []).map((r) => <option key={r}>{r}</option>)}</SelectBox>
          {inp("planned_date", "Planned delivery date", "date")}
          <SelectBox className="searchbox" value={f.responsible_dept || ""} onChange={(e) => setF({ ...f, responsible_dept: e.target.value })}>
            <option value="">Responsible dept…</option>{(masters.responsible_depts || []).map((d) => <option key={d}>{d}</option>)}</SelectBox>
          {inp("remarks", "Hold remarks")}
          <button className="btn" onClick={() => run(() => api.srdms.hold(req.id, line.line_id, { reason: f.reason, remarks: f.remarks, planned_date: f.planned_date, responsible_dept: f.responsible_dept, actor: persona }))}>Put on hold</button>
        </div>
      )}
      {act === "reject" && (
        <div className="grid cols-3" style={{ gap: 6, marginTop: 8 }}>
          <SelectBox className="searchbox" value={f.reason || ""} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            <option value="">Reason…</option>{(masters.reject_reasons || []).map((r) => <option key={r}>{r}</option>)}</SelectBox>
          {inp("remarks", "Remarks")}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={!!f.short_close} onChange={(e) => setF({ ...f, short_close: e.target.checked })} /> Short-close (else reject)</label>
          <button className="btn danger" onClick={() => run(() => api.srdms.reject(req.id, line.line_id, { reason: f.reason, remarks: f.remarks, short_close: !!f.short_close, actor: persona }))}>Confirm</button>
        </div>
      )}
      {act === "receipt" && (() => {
        const cond = f.condition || "Received in order";
        return (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8 }}>
            <div className="grid cols-3" style={{ gap: 6 }}>
              {inp("received_date", "Received date", "date")}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, margin: "8px 0 4px" }}>Condition*</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {["Received in order", "Short quantity", "Damaged", "Wrong batch"].map((c) => (
                <button key={c} className={cond === c ? "chip active" : "chip"} onClick={() => setF({ ...f, condition: c })}>{c}</button>
              ))}
            </div>
            <textarea className="searchbox" style={{ width: "100%", minHeight: 48 }}
              placeholder={cond === "Received in order" ? "Remarks (optional)" : "Describe the shortfall, damage or batch mismatch (required)"}
              value={f.remarks || ""} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
            <button className="btn" style={{ marginTop: 8 }} onClick={() => run(() => api.srdms.receipt(req.id, line.line_id, {
              condition: cond, received_date: f.received_date, remarks: f.remarks, actor: persona,
            }))}>Confirm receipt and close</button>
          </div>
        );
      })()}
    </div>
  );
}

function Detail({ id, persona, masters, onChange, onBack, ver }) {
  const { data: req, loading, error, refresh } = useAsync(() => api.srdms.get(id), [id, ver]);
  const bump = () => { refresh(); onChange(); };
  if (loading) return <Loading what="request" />;
  if (error) return <ErrorBox msg={error} />;

  const doAct = async (fn) => { try { await fn(); bump(); } catch (e) { alert(e.message); } };
  const rq = isReq(persona.role), appr = isApprover(persona.role);

  return (
    <div style={{ marginTop: 12 }}>
      <button className="chip" onClick={onBack}>← Back to list</button>
      <div className="card" style={{ padding: 16, marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{req.sr_no || "(draft)"} <Chip v={req.status} /></h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {req.status === "Draft" && rq && <button className="btn" onClick={() => doAct(() => api.srdms.submit(req.id, persona))}>▶ Submit</button>}
            {req.status === "PendingApproval" && appr && <>
              <button className="btn" onClick={() => doAct(() => api.srdms.approve(req.id, { decision: "approve", reason: "", actor: persona }))}>✓ Approve</button>
              <button className="btn danger" onClick={() => { const r = prompt("Rejection reason"); if (r != null) doAct(() => api.srdms.approve(req.id, { decision: "reject", reason: r, actor: persona })); }}>✗ Reject</button></>}
            {["Draft", "Submitted", "PendingApproval", "Acknowledged", "InProgress"].includes(req.status) && rq &&
              <button className="btn danger" onClick={() => { const r = prompt("Cancellation reason"); if (r != null) doAct(() => api.srdms.cancel(req.id, { reason: r, actor: persona })); }}>Cancel request</button>}
          </div>
        </div>
        <div className="grid cols-4" style={{ gap: 8, marginTop: 10, fontSize: 13 }}>
          <div><b>Requester</b><br />{req.requester_name}{req.department ? <><br /><span style={{ color: "var(--muted)" }}>{req.department}</span></> : null}</div>
          <div><b>R&D Head</b><br />{req.rd_head || "—"}</div>
          <div><b>Plant</b><br />{req.plant_name}</div>
          <div><b>Request location</b><br />{req.request_location || "—"}</div>
          <div><b>Priority / Required-by</b><br />{req.priority} · {req.required_by || "—"}</div>
          <div><b>Submitted</b><br />{req.submitted_at || "—"}</div>
          <div><b>Acknowledged</b><br />{req.acknowledged_at || "—"} {req.acknowledged_by ? `by ${req.acknowledged_by}` : ""}</div>
          <div><b>Ack TAT / Total TAT</b><br />{req.tat.ack_tat_h == null ? "—" : `${req.tat.ack_tat_h}h`} · {req.tat.total_tat_h == null ? "—" : `${req.tat.total_tat_h}h`}</div>
          <div><b>Purpose</b><br />{req.purpose || "—"}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {req.lines.map((l, i) => (
          <div key={l.line_id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
              paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>#{i + 1}</span>
              <div style={{ flex: 1, minWidth: 170 }}>
                <b style={{ fontSize: 14, color: "var(--navy)" }}>{l.item_desc}</b>
                {l.item_code && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8, fontFamily: "ui-monospace, Menlo, monospace" }}>{l.item_code}</span>}
              </div>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>UoM <b style={{ color: "var(--text)" }}>{l.uom}</b></span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Req <b style={{ color: "var(--text)" }}>{fmt.num(l.qty_requested)}</b></span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Disp <b style={{ color: "var(--text)" }}>{fmt.num(l.qty_dispatched)}</b></span>
              <Chip v={l.status} />
            </div>
            <div style={{ marginTop: 8 }}>
              {l.dispatches.length > 0 && <div style={{ fontSize: 11 }}>{l.dispatches.map((d, k) => (
                <div key={k} style={{ marginBottom: 2 }}>
                  <Package size={13} style={{ verticalAlign: -2 }} /> <b>{d.batch_no}</b> ×{d.qty} · {d.mode} {d.mode_details?.awb_no || d.mode_details?.vehicle_no || d.mode_details?.person_name || ""}
                  {d.packages ? ` · ${d.packages} pkg` : ""}{d.freight ? ` · ${d.freight}` : ""}{d.dispatch_date ? ` · ${d.dispatch_date}` : ""}{d.expected_arrival ? ` · ETA ${d.expected_arrival}` : ""}
                  {(d.batches || []).some((b) => b.mfg_date || b.exp_date) &&
                    <div style={{ color: "var(--muted)", marginLeft: 14 }}>{d.batches.map((b) => `${b.batch_no}: ${b.qty} (mfg ${b.mfg_date || "—"} / exp ${b.exp_date || "—"})`).join("; ")}</div>}
                </div>
              ))}</div>}
              {l.hold && <div style={{ fontSize: 11, color: "#8a6d00" }}><Pause size={13} style={{ verticalAlign: -2 }} /> {l.hold.reason} · planned {l.hold.planned_date || "—"}{l.hold.responsible_dept ? ` · dept ${l.hold.responsible_dept}` : ""} {l.hold.remarks ? `· ${l.hold.remarks}` : ""}</div>}
              {l.reject && <div style={{ fontSize: 11, color: "var(--red)" }}><Ban size={13} style={{ verticalAlign: -2 }} /> {l.reject.short_close ? "Short-closed" : "Rejected"}: {l.reject.reason}</div>}
              {l.receipt && <div style={{ fontSize: 11, color: "#1c6b4b" }}>✓ {l.receipt.status}{l.receipt.discrepancy_type ? ` — ${l.receipt.discrepancy_type}` : ""}{l.receipt.received_date ? ` · ${l.receipt.received_date}` : ""} {l.receipt.remarks ? `· ${l.receipt.remarks}` : ""}</div>}
              <ActionPanel req={req} line={l} persona={persona} masters={masters} onChange={bump} />
            </div>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: 16 }}>Activity log</h4>
      <div className="tbl-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead><tbody>
        {(req.events || []).map((e, i) => <tr key={i}><td style={{ fontSize: 11 }}>{e.ts}</td><td>{e.actor}</td><td style={{ fontSize: 11 }}>{e.role}</td><td>{e.action}</td><td style={{ fontSize: 12 }}>{e.detail}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function Reports({ ver }) {
  const { data, loading, error } = useAsync(() => api.srdms.tatReport(), [ver]);
  const [busy, setBusy] = useState(false);
  const { sort, toggle, apply } = useSort("sr_no", "desc");
  const exp = async () => { setBusy(true); try { await api.srdms.reportsExport(); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  return (
    <>
      <div className="pagebar" style={{ marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>TAT & ageing report</b>
        <button className="btn" style={{ marginLeft: "auto" }} disabled={busy} onClick={exp}>{busy ? "…" : <><Download size={15} /> Export Excel</>}</button>
      </div>
      {loading && <Loading what="TAT report" />}
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="tbl-wrap"><table><thead><tr>
          <SortTh label="SR No" k="sr_no" sort={sort} toggle={toggle} />
          <SortTh label="Requester" k="requester" sort={sort} toggle={toggle} />
          <SortTh label="Plant" k="plant" sort={sort} toggle={toggle} />
          <SortTh label="Priority" k="priority" sort={sort} toggle={toggle} />
          <SortTh label="Status" k="status" sort={sort} toggle={toggle} />
          <SortTh label="Submitted" k="submitted_at" sort={sort} toggle={toggle} />
          <SortTh label="Acknowledged" k="acknowledged_at" sort={sort} toggle={toggle} />
          <SortTh label="Closed" k="closed_at" sort={sort} toggle={toggle} />
          <SortTh label="Ack TAT (h)" k="ack_tat_h" sort={sort} toggle={toggle} num />
          <SortTh label="Total TAT (h)" k="total_tat_h" sort={sort} toggle={toggle} num />
          <SortTh label="Open age (d)" k="open_age_days" sort={sort} toggle={toggle} num />
          <SortTh label="Lines" k="lines" sort={sort} toggle={toggle} num />
        </tr></thead><tbody>
          {apply(data.rows).map((r, i) => (
            <tr key={i}>
              <td><b>{r.sr_no}</b></td><td>{r.requester}</td><td>{r.plant}</td><td><Chip v={r.priority} /></td><td><Chip v={r.status} /></td>
              <td style={{ fontSize: 11 }}>{r.submitted_at || "—"}</td><td style={{ fontSize: 11 }}>{r.acknowledged_at || "—"}</td><td style={{ fontSize: 11 }}>{r.closed_at || "—"}</td>
              <td className="num">{r.ack_tat_h ?? "—"}</td><td className="num">{r.total_tat_h ?? "—"}</td>
              <td className="num">{r.open_age_days ?? "—"}</td><td className="num">{r.lines}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={12}>No submitted requests yet.</td></tr>}
        </tbody></table></div>
      )}
    </>
  );
}

function EmailTemplates({ masters, setMasters }) {
  const { data, loading } = useAsync(() => api.srdms.emailTemplates(), []);
  const [tpl, setTpl] = useState({});
  useEffect(() => { if (data) setTpl(masters.email_templates || {}); }, [data]);
  if (loading) return <Loading what="email templates" />;
  const codes = data ? Object.entries(data.templates) : [];
  const set = (code, field, v, dflt) => {
    setTpl((s) => {
      const cur = { ...(s[code] || {}) };
      if (v === dflt || v === "") delete cur[field]; else cur[field] = v;
      const next = { ...s };
      if (Object.keys(cur).length) next[code] = cur; else delete next[code];
      setMasters((m) => ({ ...m, email_templates: next }));
      return next;
    });
  };
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>Leave blank to use the built-in default (shown as the placeholder). Placeholders like
        <code>{"{sr_no} {item} {reason} {planned_date} {qty} {mode_line} {total_tat} {link}"}</code> are substituted when the email is generated.</p>
      {codes.map(([code, t]) => (
        <div key={code} className="card" style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}><span className="chip" style={{ cursor: "default", fontSize: 10 }}>{code}</span> {t.event} {(tpl[code]) && <span style={{ color: "var(--teal)", fontSize: 11 }}>· customised</span>}</div>
          <SmoothInput className="searchbox" style={{ width: "100%", marginTop: 4 }} placeholder={t.default_subject}
            value={(tpl[code]?.subject) ?? ""} onChange={(e) => set(code, "subject", e.target.value, t.default_subject)} />
          <textarea className="searchbox" style={{ width: "100%", minHeight: 48, marginTop: 4 }} placeholder={t.default_body}
            value={(tpl[code]?.body) ?? ""} onChange={(e) => set(code, "body", e.target.value, t.default_body)} />
        </div>
      ))}
    </>
  );
}

function Notifications({ ver }) {
  const [unsent, setUnsent] = useState(false);
  const { data, loading, error, refresh } = useAsync(() => api.srdms.notifications({ unsent }), [ver, unsent]);
  const digest = async () => { try { const r = await api.srdms.runDigest(); alert(`${r.digests_created} daily digest email(s) sent.`); refresh(); } catch (e) { alert(e.message); } };
  return (
    <>
      <div className="banner info" style={{ marginTop: 12 }}>
        <Mail size={14} style={{ verticalAlign: -2 }} /> Emails are sent <b>automatically</b> the moment each notification is created — this is the email log.
        Any row still marked <b>unsent</b> means delivery failed (check the recipient email in Masters / SMTP).
      </div>
      <div className="pagebar" style={{ marginTop: 8 }}>
        <label className="chip" style={{ cursor: "pointer" }}><input type="checkbox" checked={unsent} onChange={(e) => setUnsent(e.target.checked)} /> Unsent / failed only</label>
        <button className="btn secondary" onClick={digest} title="Send the daily pending digest (N13) now"><History size={15} /> Send daily digest</button>
      </div>
      {loading && <Loading what="notifications" />}
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="tbl-wrap"><table><thead><tr>
          <th>Code</th><th>Event</th><th>SR</th><th>To</th><th>CC</th><th>Subject</th><th>Sent</th><th>When</th>
        </tr></thead><tbody>
          {data.notifications.map((n) => (
            <tr key={n.id}>
              <td><span className="chip" style={{ cursor: "default", fontSize: 10 }}>{n.code}</span></td>
              <td style={{ fontSize: 12 }}>{n.event}</td><td>{n.sr_no}</td>
              <td style={{ fontSize: 11 }}>{(n.to || []).join(", ") || "—"}</td>
              <td style={{ fontSize: 11 }}>{(n.cc || []).join(", ") || "—"}</td>
              <td style={{ fontSize: 12 }} title={n.body}><b>{n.subject}</b></td>
              <td>{n.sent ? "✓" : "—"}</td><td style={{ fontSize: 11 }}>{n.created_at}</td>
            </tr>
          ))}
          {data.notifications.length === 0 && <tr><td colSpan={8}>No notifications.</td></tr>}
        </tbody></table></div>
      )}
    </>
  );
}

function Masters({ masters, onSaved }) {
  const [m, setM] = useState(masters);
  const [busy, setBusy] = useState(false);
  const setPlant = (i, k, v) => setM((s) => ({ ...s, plants: s.plants.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));
  const setSla = (k, v) => setM((s) => ({ ...s, sla: { ...s.sla, [k]: v } }));
  const toggleReg = (id) => setM((s) => {
    const set = new Set(s.regulated_plants || []);
    set.has(id) ? set.delete(id) : set.add(id);
    return { ...s, regulated_plants: [...set] };
  });
  const save = async () => {
    setBusy(true);
    try {
      await api.srdms.saveMasters({
        plants: m.plants, hold_reasons: m.hold_reasons, reject_reasons: m.reject_reasons,
        discrepancy_types: m.discrepancy_types, priorities: m.priorities, uoms: m.uoms,
        delivery_modes: m.delivery_modes, qa_emails: m.qa_emails, sla: m.sla,
        regulated_plants: m.regulated_plants || [], email_templates: m.email_templates || {},
        app_base_url: m.app_base_url || "",
      });
      alert("Masters saved."); onSaved();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const inp = { width: "100%", minWidth: 0, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff" };
  const field = (label, node) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{label}</span>{node}
    </label>
  );
  const listEdit = (label, key) => field(label,
    <textarea style={{ ...inp, minHeight: 80, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={(m[key] || []).join("\n")}
      onChange={(e) => setM({ ...m, [key]: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />);
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 7 }}><Factory size={16} /> Plant → warehouse in-charge mapping</h3>
        <div className="sub" style={{ marginTop: 4, marginBottom: 12 }}>Recipients notified for each plant. Tick <b>Regulated (QA)</b> to require QA batch release before a line can be dispatched.</div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 12, minWidth: 780 }}>
            <colgroup><col style={{ width: 150 }} /><col /><col /><col /><col /><col style={{ width: 96 }} /></colgroup>
            <thead><tr style={{ background: "#f1f5fb" }}>
              {["Plant", "In-charge name", "In-charge email", "Backup email", "Plant-head email", "Regulated (QA)"].map((t, k) => (
                <th key={k} style={{ textAlign: k === 5 ? "center" : "left", padding: "9px 10px", fontSize: 10.5,
                  textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", fontWeight: 700, borderBottom: "1px solid var(--border)" }}>{t}</th>
              ))}
            </tr></thead>
            <tbody>{m.plants.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 10px" }}><b style={{ color: "var(--navy)" }}>{p.name}</b></td>
                <td style={{ padding: "8px 10px" }}><input style={inp} value={p.incharge_name || ""} onChange={(e) => setPlant(i, "incharge_name", e.target.value)} /></td>
                <td style={{ padding: "8px 10px" }}><input style={inp} value={p.incharge_email || ""} onChange={(e) => setPlant(i, "incharge_email", e.target.value)} /></td>
                <td style={{ padding: "8px 10px" }}><input style={inp} value={p.backup_email || ""} onChange={(e) => setPlant(i, "backup_email", e.target.value)} /></td>
                <td style={{ padding: "8px 10px" }}><input style={inp} value={p.plant_head_email || ""} onChange={(e) => setPlant(i, "plant_head_email", e.target.value)} /></td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={(m.regulated_plants || []).includes(p.id)} onChange={() => toggleReg(p.id)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 7 }}><ClipboardList size={16} /> Dropdown lists</h3>
        <div className="sub" style={{ marginTop: 4, marginBottom: 12 }}>One value per line — these populate the pickers used across the module.</div>
        <div className="grid cols-3" style={{ gap: 14 }}>
          {listEdit("Hold reasons", "hold_reasons")}
          {listEdit("Reject / short-close reasons", "reject_reasons")}
          {listEdit("Discrepancy types", "discrepancy_types")}
          {listEdit("Priorities", "priorities")}
          {listEdit("Delivery modes", "delivery_modes")}
          {listEdit("UoMs", "uoms")}
          {listEdit("QA / QC emails (CC on discrepancy)", "qa_emails")}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 7 }}><Settings size={16} /> SLA & configuration</h3>
        <div className="grid cols-3" style={{ gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--navy)", alignSelf: "end", paddingBottom: 9 }}>
            <input type="checkbox" style={{ width: 16, height: 16 }} checked={!!m.sla.approval_required} onChange={(e) => setSla("approval_required", e.target.checked)} /> Require R&D approval before warehouse</label>
          {field("Approver email", <input style={inp} value={m.sla.approver_email || ""} onChange={(e) => setSla("approver_email", e.target.value)} />)}
          {field("Ack SLA (hours) → N9 reminder", <input type="number" style={inp} value={m.sla.ack_sla_hours} onChange={(e) => setSla("ack_sla_hours", Number(e.target.value))} />)}
          {field("Dispatch SLA (hours)", <input type="number" style={inp} value={m.sla.dispatch_sla_hours} onChange={(e) => setSla("dispatch_sla_hours", Number(e.target.value))} />)}
          {field("SR number prefix", <input style={inp} value={m.sla.sr_prefix} onChange={(e) => setSla("sr_prefix", e.target.value)} />)}
          {field(`App base URL (email {link})`, <input style={inp} value={m.app_base_url || ""} onChange={(e) => setM({ ...m, app_base_url: e.target.value })} />)}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 7 }}><Mail size={16} /> Email templates (N1–N13 + approval / QA)</h3>
        <EmailTemplates masters={m} setMasters={setM} />
      </div>

      <div style={{ position: "sticky", bottom: 0, padding: "12px 0", background: "linear-gradient(transparent, var(--bg) 40%)" }}>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : <><Save size={15} /> Save masters</>}</button>
      </div>
    </div>
  );
}
