import React, { useState } from "react";
import { api } from "../api";
import SmoothInput from "../components/SmoothInput.jsx";
import { TriangleAlert } from "lucide-react";
import loginIllustration from "../assets/login-illustration.svg";

// Two-column login modeled on the Figma "SAAS Dashboard" login: white form panel
// on the left, illustration on the right (#FAFAFA), Nunito type, #605BFF primary.
// Wired to the app's real auth (username/user-code + password).
export default function Login({ onLogin }) {
  const [login, setLogin] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api.userMaster.login(login.trim(), pw);
      onLogin({ user: r.user, menus: (r.user.menus || []).map((m) => m.id) });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-form-panel">
        <form className="login-form" onSubmit={submit}>
          <div className="login-brand">Supply Chain · Planning Tool</div>
          <h1 className="login-title">Log in</h1>

          {err && <div className="banner err login-err" style={{ display: "flex", alignItems: "center", gap: 7 }}><TriangleAlert size={16} style={{ flex: "none" }} /> {err}</div>}

          <label className="login-label" htmlFor="login-user">Username or user code</label>
          <SmoothInput
            id="login-user"
            className="login-input"
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="e.g. SARANYAA"
          />

          <label className="login-label" htmlFor="login-pw">Password</label>
          <div className="login-pw">
            <SmoothInput
              id="login-pw"
              className="login-input"
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
            />
            <button type="button" className="login-pw-toggle" onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>

          <div className="login-hint">
            New users' default password is <b>pure@123</b> — change it after first login.
          </div>
        </form>
      </div>

      <div className="login-illus" aria-hidden>
        <img src={loginIllustration} alt="" />
      </div>
    </div>
  );
}
