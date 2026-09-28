import React, { useState } from "react";
import { api } from "../api";
import SmoothInput from "../components/SmoothInput.jsx";
import { TriangleAlert } from "lucide-react";

// forced=true -> full-screen, no cancel (first-login password change).
// forced=false -> modal overlay with a Cancel button (self-service).
export default function ChangePassword({ login, forced = false, onDone, onCancel }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (nw !== confirm) { setErr("New password and confirmation don’t match."); return; }
    setBusy(true);
    try {
      const r = await api.userMaster.changePassword(login, cur, nw);
      onDone(r.user);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const card = (
    <form onSubmit={submit} style={{ width: 380, maxWidth: "94%", background: "#fff", borderRadius: 14,
      padding: "26px 28px", boxShadow: "0 10px 40px rgba(0,0,0,.25)" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1F3A5F", marginBottom: 2 }}>
        {forced ? "Set a new password" : "Change password"}
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
        {forced ? "You’re signing in with the default password — please set your own to continue." : `Signed in as ${login}`}
      </div>
      {err && <div className="banner err" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}><TriangleAlert size={16} style={{ flex: "none" }} /> {err}</div>}
      <label style={{ fontSize: 12, color: "#475569" }}>Current password</label>
      <SmoothInput className="searchbox" style={{ width: "100%", margin: "4px 0 12px" }} type="password" autoFocus
        value={cur} onChange={(e) => setCur(e.target.value)} placeholder={forced ? "pure@123" : "Current password"} />
      <label style={{ fontSize: 12, color: "#475569" }}>New password</label>
      <SmoothInput className="searchbox" style={{ width: "100%", margin: "4px 0 12px" }} type="password"
        value={nw} onChange={(e) => setNw(e.target.value)} placeholder="At least 4 characters" />
      <label style={{ fontSize: 12, color: "#475569" }}>Confirm new password</label>
      <SmoothInput className="searchbox" style={{ width: "100%", margin: "4px 0 18px" }} type="password"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-type new password" />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" type="submit" disabled={busy} style={{ flex: 1, justifyContent: "center" }}>
          {busy ? "Saving…" : "Update password"}
        </button>
        {!forced && <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );

  return (
    <div style={{ position: forced ? "static" : "fixed", inset: 0, zIndex: 50,
      minHeight: forced ? "100vh" : undefined, display: "flex", alignItems: "center", justifyContent: "center",
      background: forced ? "linear-gradient(135deg,#1F3A5F,#2A9D8F)" : "rgba(15,23,42,.5)",
      fontFamily: "'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      {card}
    </div>
  );
}
