import React, { useState } from "react";
import { api } from "../api";
import IconButton from "../components/IconButton.jsx";
import { useAsync, Loading, ErrorBox } from "../components/ui.jsx";
import { Plus } from "lucide-react";

export default function RoleMaster() {
  const [ver, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const { data, loading, error } = useAsync(() => api.roles.list(), [ver]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const act = async (fn, msg) => {
    setStatus("");
    try { await fn(); if (msg) setStatus(msg); bump(); }
    catch (e) { alert(e.message); }
  };

  if (error) return <ErrorBox msg={error} />;
  const roles = data?.roles || [];
  const st = data?.storage || {};

  const add = async () => {
    const nm = name.trim();
    if (!nm) { alert("Enter a role name."); return; }
    if (roles.some((r) => (r.role_name || "").toLowerCase() === nm.toLowerCase())) { alert("That role already exists."); return; }
    setBusy("add");
    try { await api.roles.add(nm, desc.trim()); setName(""); setDesc(""); setStatus(`✓ Role "${nm}" created.`); bump(); }
    catch (e) { alert(e.message); } finally { setBusy(""); }
  };

  const inp = { width: "100%", minWidth: 0, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff" };

  return (
    <>
      {data && st.db_ready && st.json_roles > 0 && (
        <div className="banner info" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button className="btn secondary"
            onClick={() => act(async () => { const r = await api.roles.importJson(); alert(`Imported ${r.imported} role(s) into MySQL.`); })}>
            Import {st.json_roles} JSON role(s) → DB</button>
        </div>
      )}

      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0, display: "inline-flex", alignItems: "center", gap: 7 }}><Plus size={16} /> Create a role</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 220px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>Role name *</span>
            <input style={inp} value={name} placeholder="e.g. Procurement Manager"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "2 1 320px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>Description</span>
            <input style={inp} value={desc} placeholder="What this role can do (optional)"
              onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          </label>
          <button className="btn" disabled={busy === "add"} onClick={add}>{busy === "add" ? "Saving…" : "Create role"}</button>
        </div>
        {status && <div style={{ marginTop: 8, fontSize: 13, color: "var(--green)" }}>{status}</div>}
      </div>

      <h3 style={{ marginTop: 18 }}>Roles ({roles.length})</h3>
      {loading && <Loading what="roles" />}
      {data && (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Role name</th><th>Description</th><th>Status</th><th>Created by</th><th></th>
            </tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.role_name}>
                  <td><b>{r.role_name}</b></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.description || "—"}</td>
                  <td>
                    <button className="chip" style={{ background: r.active ? "#E6F6EC" : "#FFE5E5", fontWeight: 600 }}
                      onClick={() => act(() => api.roles.update(r.role_name, r.description || "", !r.active))}>
                      {r.active ? "● Active" : "○ Disabled"}
                    </button>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.created_by || "—"}</td>
                  <td>
                    <IconButton icon="trash" tooltip="Delete role" color="danger"
                      onClick={() => { if (confirm(`Delete role "${r.role_name}"? Users already assigned this role keep it until reassigned.`)) act(() => api.roles.remove(r.role_name), `Role "${r.role_name}" deleted.`); }} />
                  </td>
                </tr>
              ))}
              {roles.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No roles yet — create one above.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="sub" style={{ marginTop: 8 }}>
        Disabled roles stay in the database but are hidden from the assignment dropdowns. These roles feed the
        <b> SRDMS role</b> picker in User Master.
      </div>
    </>
  );
}
