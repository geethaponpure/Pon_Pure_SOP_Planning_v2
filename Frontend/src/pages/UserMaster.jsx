import React, { useState, useEffect } from "react";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import AvatarPicker from "../components/AvatarPicker.jsx";
import IconButton from "../components/IconButton.jsx";
import { avatarUrl } from "../assets/avatars/index.js";
import { NAV, HIDDEN } from "../nav";
import { api } from "../api";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { Users, Plus, User, KeyRound, Save } from "lucide-react";
import Pagination, { usePagination } from "../components/Pagination.jsx";

// grantable modules = the navigable pages (incl. User Master itself, so admins can be
// created); hidden/non-navigable pages are not offered.
const MODULES = NAV.filter((n) => !HIDDEN.has(n.id));
const label = (id) => (NAV.find((n) => n.id === id) || {}).label || id;

export default function UserMaster() {
  const [ver, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const [approver, setApprover] = useState(() => localStorage.getItem("um_approver") || "");
  const saveApprover = (v) => { setApprover(v); localStorage.setItem("um_approver", v); };
  const [tab, setTab] = useState("approved");   // "approved" | "crm"
  // the two expanders live in the same button row as the tabs, so the parent owns
  // their open state and the child components render only their panels
  const [openDepts, setOpenDepts] = useState(false);
  const [openLog, setOpenLog] = useState(false);
  const [pickFor, setPickFor] = useState(null); // user_code whose avatar picker is open
  const [expanded, setExpanded] = useState(null); // user_code whose detail row is open

  const status = useAsync(() => api.userMaster.status(), [ver]);
  const usersA = useAsync(() => api.userMaster.users(), [ver]);
  const deptsA = useAsync(() => api.userMaster.departments(), [ver]);
  const srdmsQ = useAsync(() => api.srdms.userRoles(), [ver]);
  const mastersQ = useAsync(() => api.srdms.masters(), []);
  const roleMap = srdmsQ.data?.user_roles || {};
  const srdmsRoles = srdmsQ.data?.roles || [];
  const plants = mastersQ.data?.plants || [];

  const act = async (fn) => { try { await fn(); bump(); } catch (e) { alert(e.message); } };

  const approved = usersA.data?.users || [];
  const st = status.data || {};

  return (
    <>

      {/* storage status — only shown when something needs attention */}
      {status.data && (!st.db_ready || st.json_users > 0) && (
        <div className={`banner ${st.db_ready ? "info" : "warn"}`} style={{ marginTop: 10 }}>
          Storage backend: <b>{st.backend === "mysql" ? "MySQL database" : "JSON fallback"}</b>.
          {!st.db_ready && <> The DB tables aren’t created yet — run <code>{st.migration}</code> as root, then click Import.
            {st.json_users > 0 && <> ({st.json_users} user(s) currently in the JSON store.)</>}</>}
          {st.db_ready && st.json_users > 0 &&
            <> <button className="btn secondary" style={{ marginLeft: 8 }}
              onClick={() => act(async () => { const r = await api.userMaster.importJson(); alert(`Imported ${r.imported} user(s) into MySQL.`); })}>
              Import {st.json_users} JSON user(s) → DB</button></>}
        </div>
      )}

      {/* login / password status */}
      {status.data && st.db_ready && !st.password_enabled && (
        <div className="banner warn" style={{ marginTop: 8 }}>
          <b>Login passwords not enabled.</b> Run <code>backend/db/migrate_user_password.sql</code> as root
          (adds the <code>password_hash</code> column), then reload this page. Users can be managed now, but
          can’t sign in until this is done.
        </div>
      )}

      <div className="pagebar" style={{ marginTop: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Approving as:</span>
        <SmoothInput className="searchbox" style={{ maxWidth: 220 }} placeholder="your name / email"
          value={approver} onChange={(e) => saveApprover(e.target.value)} />
      </div>

      <div className="pagebar" style={{ marginTop: 12, gap: 8 }}>
        <button className={"um-btn" + (tab === "approved" ? " is-active" : "")} onClick={() => setTab("approved")}>
          <Users size={14} className="svg-icon" />
          <span className="lable">Approved users ({approved.length})</span>
        </button>
        <button className={"um-btn" + (tab === "crm" ? " is-active" : "")} onClick={() => setTab("crm")}>
          <Plus size={14} className="svg-icon" />
          <span className="lable">Add CRM users</span>
        </button>
        {tab === "crm" && (
          <button className={"um-btn" + (openDepts ? " is-active" : "")} onClick={() => setOpenDepts((o) => !o)}>
            <span className="svg-icon" aria-hidden>{openDepts ? "▾" : "▸"}</span>
            <span className="lable">Eligible departments ({(deptsA.data?.allowed || []).length})</span>
          </button>
        )}
        <button className={"um-btn" + (openLog ? " is-active" : "")} onClick={() => setOpenLog((o) => !o)}>
          <span className="svg-icon" aria-hidden>{openLog ? "▾" : "▸"}</span>
          <span className="lable">User access change log (audit)</span>
        </button>
      </div>

      {tab === "crm" && <AllowedDepartments deptsA={deptsA} onSaved={bump} open={openDepts} />}
      <AccessLog ver={ver} open={openLog} />

      {tab === "crm" && <CrmPicker ver={ver} approver={approver} onAdded={bump} />}

      {tab === "approved" && <>
      {usersA.loading && <Loading what="approved users" />}
      {usersA.error && <ErrorBox msg={usersA.error} />}
      {usersA.data && (
        <div className="um-table-wrap">
          <table className="um-table">
            <thead>
              <tr>
                <th className="um-c-exp" aria-label="expand" />
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Status</th>
                <th className="um-c-act" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {approved.map((u) => {
                const ur = roleMap[u.user_code] || {};
                const isWhRole = /Warehouse/.test(ur.role || "");
                const isOpen = expanded === u.user_code;
                const sel = { width: "100%", minWidth: 0, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff" };
                const lbl = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 6, display: "block" };
                return (
                  <React.Fragment key={u.user_code}>
                    <tr className={`um-row ${isOpen ? "open" : ""}`} onClick={() => setExpanded(isOpen ? null : u.user_code)}>
                      <td className="um-c-exp"><span className="um-exp">{isOpen ? "▾" : "▸"}</span></td>
                      <td>
                        <div className="um-name-cell">
                          <button className="um-avatar" title="Change avatar"
                            onClick={(e) => { e.stopPropagation(); setPickFor(u.user_code); }}>
                            {avatarUrl(u.avatar)
                              ? <img src={avatarUrl(u.avatar)} alt={`${u.name} avatar`} />
                              : <span className="um-avatar-ph"><User size={22} /></span>}
                            <span className="um-avatar-edit">✎</span>
                          </button>
                          <span className="um-name-txt">
                            <span className="um-name">{u.name}</span>
                            <span className="um-sub">{u.username} · {u.user_code}</span>
                          </span>
                        </div>
                      </td>
                      <td className="um-gray">{u.email || "—"}</td>
                      <td className="um-gray">{u.department || "—"}</td>
                      <td className="um-gray">{u.designation || "—"}</td>
                      <td>
                        <button className="chip" style={{ background: u.status === "active" ? "#E6F6EC" : "#FFE5E5", fontWeight: 600 }}
                          onClick={(e) => { e.stopPropagation(); act(() => api.userMaster.setStatus(u.user_code, u.status === "active" ? "disabled" : "active")); }}>
                          {u.status === "active" ? "● Active" : "○ Disabled"}
                        </button>
                      </td>
                      <td className="um-c-act">
                        <span style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
                          <IconButton icon="trash" tooltip="Delete user" color="danger"
                            onClick={() => { if (confirm(`Remove ${u.name} from the app?`)) act(() => api.userMaster.removeUser(u.user_code)); }} />
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="um-detail-row">
                        <td />
                        <td colSpan={6}>
                          <div className="um-detail">
                            <div>
                              <span style={lbl}>SRDMS role (flow)</span>
                              <select style={sel} value={ur.role || ""}
                                onChange={(e) => act(() => api.srdms.setUserRole(u.user_code, e.target.value, ur.plant_id || ""))}>
                                <option value="">— derive from dept —</option>
                                {srdmsRoles.map((r) => <option key={r}>{r}</option>)}
                              </select>
                              {isWhRole && (
                                <select style={{ ...sel, marginTop: 6 }} value={ur.plant_id || ""}
                                  onChange={(e) => act(() => api.srdms.setUserRole(u.user_code, ur.role, e.target.value))}>
                                  <option value="">All plants</option>
                                  {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              )}
                              <div style={{ marginTop: 12 }}>
                                <span style={lbl}>Login password</span>
                                {st.password_enabled ? (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <button className="chip" title="Reset to the default password"
                                      onClick={() => act(async () => { const r = await api.userMaster.resetPassword(u.user_code); alert(`${u.name}'s password reset to: ${r.password}`); })} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><KeyRound size={15} /> Reset</button>
                                    <button className="chip" title="Set a specific password"
                                      onClick={() => { const p = prompt(`New password for ${u.name} (min 4 chars):`); if (p) act(() => api.userMaster.setPassword(u.user_code, p)); }}>Set…</button>
                                  </div>
                                ) : <span style={{ fontSize: 12, color: "var(--muted)" }}>login not enabled</span>}
                              </div>
                            </div>

                            <div>
                              <span style={lbl}>Module / menu access</span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                {(u.menus || []).map((m) => (
                                  <span key={m.id} className="chip" style={{ cursor: "default", fontSize: 11, background: "#EEF6FF" }}>
                                    {label(m.id)} <span style={{ cursor: "pointer", color: "var(--red)", fontWeight: 700 }}
                                      onClick={() => act(() => api.userMaster.removeMenu(u.user_code, m.id))}>×</span>
                                  </span>
                                ))}
                                {(u.menus || []).length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>no modules granted</span>}
                                <SelectBox className="searchbox" style={{ maxWidth: 200, fontSize: 12, padding: "6px 8px" }} value=""
                                  onChange={(e) => { if (e.target.value) act(() => api.userMaster.addMenu(u.user_code, e.target.value, label(e.target.value))); }}>
                                  <option value="">+ grant module…</option>
                                  {MODULES.filter((m) => !(u.menus || []).some((x) => x.id === m.id)).map((m) => (
                                    <option key={m.id} value={m.id}>{m.label}</option>
                                  ))}
                                </SelectBox>
                                {(u.menus || []).length > 0 &&
                                  <button className="chip" title="Grant all modules"
                                    onClick={() => act(() => api.userMaster.setMenus(u.user_code, MODULES.map((m) => ({ id: m.id, label: m.label }))))}>all</button>}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {approved.length === 0 && <div className="um-empty">No users approved yet — switch to <b>Add CRM users</b> to approve someone.</div>}
        </div>
      )}
      </>}

      {pickFor && (() => {
        const u = approved.find((x) => x.user_code === pickFor) || {};
        return (
          <AvatarPicker
            current={u.avatar || ""}
            title={`Avatar — ${u.name || pickFor}`}
            onSelect={(id) => { act(() => api.userMaster.setAvatar(pickFor, id)); setPickFor(null); }}
            onClose={() => setPickFor(null)}
          />
        );
      })()}

    </>
  );
}

function AccessLog({ ver, open }) {
  const { data, loading, error } = useAsync(() => (open ? api.userMaster.accessLog() : Promise.resolve({ log: [] })), [ver, open]);
  const ACTION = {
    approved: ["#E6F6EC", "Approved"], removed: ["#FFE5E5", "Removed"], status: ["#FFF4DA", "Status"],
    grant: ["#E6F6EC", "Grant module"], revoke: ["#FFE5E5", "Revoke module"], set_modules: ["#EEF6FF", "Set modules"],
    role: ["#E6E6FA", "SRDMS role"], password_set: ["#F3F0E8", "Password set"], password_reset: ["#F3F0E8", "Password reset"],
  };
  return (
    <div style={{ marginTop: open ? 14 : 0 }}>
      {open && (
        <div style={{ marginTop: 6 }}>
          {loading && <Loading what="access log" />}
          {error && <ErrorBox msg={error} />}
          {data && (
            <div className="tbl-wrap" style={{ maxHeight: "56vh", overflow: "auto" }}>
              <table><thead><tr>
                <th>When</th><th>User (id)</th><th>Action</th><th>Detail</th><th>Changed by</th>
              </tr></thead><tbody>
                {(data.log || []).map((r, i) => {
                  const a = ACTION[r.action] || ["#EEE", r.action];
                  return (
                    <tr key={i}>
                      <td style={{ fontSize: 11 }}>{r.logged_at}</td>
                      <td style={{ fontSize: 12 }}>{r.target_name || "—"}{r.target_user_code ? <span style={{ color: "var(--muted)" }}> · {r.target_user_code}</span> : ""}</td>
                      <td><span className="chip" style={{ cursor: "default", fontSize: 10, background: a[0] }}>{a[1]}</span></td>
                      <td style={{ fontSize: 12 }}>{r.detail}</td>
                      <td style={{ fontSize: 12 }}>{r.changed_by_name || "—"}{r.changed_by_code ? <span style={{ color: "var(--muted)" }}> · {r.changed_by_code}</span> : ""}</td>
                    </tr>
                  );
                })}
                {(data.log || []).length === 0 && <tr><td colSpan={5}>No access changes logged yet.</td></tr>}
              </tbody></table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AllowedDepartments({ deptsA, onSaved, open }) {
  const d = deptsA.data || { allowed: [], all: [] };
  const [sel, setSel] = useState(null);
  const allowed = sel ?? d.allowed;
  const toggle = (name) => setSel((s) => {
    const cur = new Set(s ?? d.allowed);
    cur.has(name) ? cur.delete(name) : cur.add(name);
    return [...cur];
  });
  const save = async () => { try { await api.userMaster.setAllowedDepartments(allowed); setSel(null); onSaved(); alert("Eligible departments saved."); } catch (e) { alert(e.message); } };
  return (
    <div style={{ marginTop: 12 }}>
      {open && (
        <div className="card" style={{ padding: 12, marginTop: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Only CRM users in these departments are offered for approval. Click to toggle.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(d.all.length ? d.all.map((x) => x.department) : d.allowed).map((name) => (
              <span key={name} className={`dept-chip ${allowed.includes(name) ? "is-active" : ""}`} onClick={() => toggle(name)}>
                {name}{d.all.length ? ` (${(d.all.find((x) => x.department === name) || {}).n})` : ""}
              </span>
            ))}
          </div>
          {sel && <button className="btn" style={{ marginTop: 10 }} onClick={save}><Save size={15} /> Save eligible departments</button>}
        </div>
      )}
    </div>
  );
}

function CrmPicker({ ver, approver, onAdded }) {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // live search — debounce keystrokes so it filters as you type (no need to press Enter)
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);
  // race-safe fetch: only the LATEST query's response is applied — a fast search must
  // not be overwritten by a slower earlier request. All departments are always shown.
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    api.userMaster.crmUsers({ q, all: true })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [ver, q]);

  // 1200+ CRM users would render as one huge table, so page them client-side
  const pg = usePagination(data?.users || [], [data, q], 50);

  const add = async (u) => {
    setBusy(u.user_code);
    try {
      await api.userMaster.addUser({
        user_code: u.user_code, crm_line_id: u.line_id, name: u.name, username: u.username,
        email: u.email, mobile: u.mobile, department: u.department, designation: u.designation,
        menus: [], actor: approver,
      });
      onAdded();
    } catch (e) { alert(e.message); } finally { setBusy(""); }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Available CRM users</h3>
      <div className="pagebar">
        <SmoothInput className="searchbox" placeholder="Search name / username / email / code…" value={qInput}
          onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setQ(qInput); }} />
        <button className="btn secondary" onClick={() => setQ(qInput)}>Search</button>
        {qInput && <button className="chip" onClick={() => { setQInput(""); setQ(""); }}>✕ Clear</button>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {data?.users?.length || 0} user{(data?.users?.length || 0) === 1 ? "" : "s"} · all departments
        </span>
      </div>
      {loading && <Loading what="CRM users" />}
      {error && <ErrorBox msg={error} />}
      {data?.note && <div className="banner warn">{data.note}</div>}
      {data && !data.note && (
        <div className="tbl-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
          <table><thead><tr>
            <th>Name</th><th>Username</th><th>Code</th><th>Dept</th><th>Designation</th><th>Email</th><th>Mobile</th><th></th>
          </tr></thead><tbody>
            {pg.pageRows.map((u, i) => (
              <tr key={u.line_id ?? u.user_code ?? i}>
                <td><b>{u.name}</b></td><td style={{ fontSize: 12 }}>{u.username}</td><td style={{ fontSize: 12 }}>{u.user_code || "—"}</td>
                <td style={{ fontSize: 12 }}>{u.department}</td><td style={{ fontSize: 12 }}>{u.designation}</td>
                <td style={{ fontSize: 12 }}>{u.email || "—"}</td><td style={{ fontSize: 12 }}>{u.mobile || "—"}</td>
                <td>{u.already_added
                  ? <span className="chip" style={{ cursor: "default", background: "#E6F6EC", fontSize: 11 }}>added</span>
                  : <button className="btn" style={{ padding: "3px 10px" }} disabled={!!busy && busy === u.user_code} onClick={() => add(u)}>{busy && busy === u.user_code ? "…" : "+ Add"}</button>}
                </td>
              </tr>
            ))}
            {data.users.length === 0 && <tr><td colSpan={8}>No CRM users match.</td></tr>}
          </tbody></table>
          <Pagination {...pg} />
        </div>
      )}
    </div>
  );
}
