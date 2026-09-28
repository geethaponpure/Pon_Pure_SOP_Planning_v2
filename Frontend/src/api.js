// S&OP Planning Tool – API client
const BASE = "/api";

// the logged-in admin performing an access change (for the audit log)
function _actorQS() {
  try {
    const u = (JSON.parse(localStorage.getItem("app_session")) || {}).user || {};
    const p = new URLSearchParams();
    if (u.user_code) p.set("actor_code", u.user_code);
    if (u.name || u.username) p.set("actor_name", u.name || u.username);
    const s = p.toString();
    return s ? `?${s}` : "";
  } catch (_) { return ""; }
}

async function req(path, opts) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (Array.isArray(j.detail)) {
        // FastAPI validation errors: [{loc, msg, type}, ...]
        detail = j.detail.map((d) => (d && d.msg ? `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}` : JSON.stringify(d))).join("; ");
      } else {
        detail = j.detail || j.message || detail;
      }
    } catch (_) {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

async function downloadFile(path, fallbackName, opts) {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || `filename="${fallbackName}"`;
  const name = (cd.split("filename=").pop() || fallbackName).replace(/"/g, "") || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  // demand side
  overview: () => req("/overview"),
  validation: () => req("/validation"),
  confirmations: () => req("/confirmations"),
  confirm: (sku, body) => req(`/confirmations/${sku}`, { method: "POST", body: JSON.stringify(body) }),
  lock: (actor) => req("/consensus/lock", { method: "POST", body: JSON.stringify({ actor }) }),
  unlock: (actor) => req("/consensus/unlock", { method: "POST", body: JSON.stringify({ actor }) }),
  skuHistory: (sku) => req(`/skus/${sku}/history`),
  segmentation: () => req("/segmentation"),
  dq: () => req("/dq"),
  forecasting: () => req("/forecasting"),
  analytics: () => req("/analytics"),
  whatIf: (body) => req("/what-if", { method: "POST", body: JSON.stringify(body) }),
  governance: () => req("/governance"),
  kpis: () => req("/kpis"),
  jcPlan: () => req("/jc-plan"),
  audit: () => req("/audit"),
  // supply / RM (live CRM)
  supply: () => req("/supply"),
  rmPlanning: () => req("/rm-planning"),
  mfgStock: () => req("/mfg-stock"),
  myDashboard: ({ username = "", email = "", admin = 0, persona = "" } = {}) =>
    req(`/my-dashboard?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`),
  myDashboardPersonas: () => req("/my-dashboard/personas"),
  // gated server-side: only Division Head / Business Head / Admin get figures
  myDashboardRmImpact: ({ username = "", email = "", admin = 0, persona = "" } = {}) =>
    req(`/my-dashboard/rm-impact?username=${encodeURIComponent(username)}` +
      `&email=${encodeURIComponent(email)}&admin=${admin ? 1 : 0}` +
      `&persona=${encodeURIComponent(persona)}`),
  // same gate as the card — a persona without price access gets a 403, not a file
  myDashboardRmExport: ({ section = "", username = "", email = "", admin = 0, persona = "" } = {}) =>
    downloadFile(
      `/my-dashboard/rm-impact/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`,
      "RM_Price_Impact.xlsx"),
  // section = one card's table; omit it for the whole page (charts + tables)
  myDashboardExport: ({ section = "", username = "", email = "", admin = 0, persona = "" } = {}) =>
    downloadFile(
      `/my-dashboard/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`,
      section ? `${section}.xlsx` : "My_Dashboard.xlsx"),
  commitRisk: ({ username = "", email = "", admin = 0, persona = "" } = {}) =>
    req(`/commit-risk?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`),
  commitRiskExport: ({ section = "", username = "", email = "", admin = 0, persona = "" } = {}) =>
    downloadFile(
      `/commit-risk/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`,
      section ? `${section}.xlsx` : "Commitment_Risk.xlsx"),
  demandProtection: ({ username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/demand-protection?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  demandProtectionExport: ({ section = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    downloadFile(
      `/demand-protection/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`,
      section ? `${section}.xlsx` : "Demand_Protection.xlsx"),
  supplyCompetition: ({ username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/supply-competition?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  supplyCompetitionItem: ({ item = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/supply-competition/item?item=${encodeURIComponent(item)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  supplyCompetitionExport: ({ section = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    downloadFile(
      `/supply-competition/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`,
      section ? `${section}.xlsx` : "Supply_Competition.xlsx"),
  promiseDates: ({ username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/promise-dates?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  promiseItem: ({ item = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/promise-dates/item?item=${encodeURIComponent(item)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  promiseDatesExport: ({ section = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    downloadFile(
      `/promise-dates/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`,
      section ? `${section}.xlsx` : "Promise_Dates.xlsx"),
  supplyPosition: ({ username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/supply-position?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  supplyPositionItem: ({ item = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    req(`/supply-position/item?item=${encodeURIComponent(item)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`),
  supplyPositionExport: ({ section = "", username = "", email = "", admin = 0, persona = "", jc = 0 } = {}) =>
    downloadFile(
      `/supply-position/export?section=${encodeURIComponent(section)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}&jc=${jc || 0}`,
      section ? `${section}.xlsx` : "My_Supply_Position.xlsx"),
  dashboardLayout: (key = "mydash", user = "") =>
    req(`/dashboard-layout?key=${encodeURIComponent(key)}&user=${encodeURIComponent(user)}`),
  // user "" writes the app-level default; a user code writes that person's own
  saveDashboardLayout: (key, layouts, user = "") =>
    req("/dashboard-layout", { method: "PUT", body: JSON.stringify({ key, layouts, user }) }),
  myDashboardItem: ({ item = "", code = "", username = "", email = "", admin = 0, persona = "" } = {}) =>
    req(`/my-dashboard/item?item=${encodeURIComponent(item)}&code=${encodeURIComponent(code)}` +
      `&username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}` +
      `&admin=${admin ? 1 : 0}&persona=${encodeURIComponent(persona)}`),
  rmPlanningExport: () => downloadFile("/rm-planning/export", "Supply_RM_Planning.xlsx"),
  packingExport: (planId) => downloadFile(
    `/rm-planning/export-packing${planId ? `?plan_id=${planId}` : ""}`, "Supply_Packing_Plan.xlsx"),
  uploadPlan: (file, mode) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("mode", mode);
    return fetch(`${BASE}/supply/plan/upload`, { method: "POST", body: fd }).then(async (res) => {
      if (!res.ok) { let d = res.statusText; try { const j = await res.json(); d = j.detail || j.message || d; } catch (_) {} throw new Error(d); }
      return res.json();
    });
  },
  applyBomOverrides: (bom_overrides, note = "") =>
    req("/rm-planning/apply", { method: "POST", body: JSON.stringify({ bom_overrides, note }) }),
  planExport: (planId) => downloadFile(`/supply/plan/export?plan_id=${planId}`, `Supply_RM_Plan_${planId}.xlsx`),
  rmSegmentExport: (planId) => downloadFile(
    `/rm-planning/export-by-segment${planId ? `?plan_id=${planId}` : ""}`, "Projection_Confirmation_to_Share_BU.zip"),
  templateSegments: () => req("/supply/template-segments"),
  templateDownload: (segment2, segment3) => downloadFile(
    `/supply/template/download?segment2=${encodeURIComponent(segment2 || "")}&segment3=${encodeURIComponent(segment3 || "")}`,
    "Plan_Template.xlsx"),
  publish: () => downloadFile("/publish", "SOP_Plan.xlsx"),
  agedRmPlan: () => req("/aged-rm-plan"),
  agedRmExport: () => downloadFile("/aged-rm-plan/export", "Aged_RM_Plan.xlsx"),
  agedRmReportExport: () => downloadFile("/aged-rm/report-export", "Report_Aged_RM.xlsx"),
  projectionVsSales: () => req("/projection-vs-sales"),
  projectionVsSalesExport: () => downloadFile("/projection-vs-sales/export", "Projection_vs_Sales.xlsx"),
  projAccuracyMeta: () => req("/projection-accuracy/meta"),
  projAccuracy: ({ acc_year, jc, approved } = {}) => {
    const p = new URLSearchParams();
    if (acc_year) p.set("acc_year", acc_year);
    if (jc != null && jc !== "") p.set("jc", jc);
    if (approved) p.set("approved", "true");
    return req(`/projection-accuracy?${p.toString()}`);
  },
  projAccuracyExport: ({ acc_year, jc, approved } = {}) => {
    const p = new URLSearchParams();
    if (acc_year) p.set("acc_year", acc_year);
    if (jc != null && jc !== "") p.set("jc", jc);
    if (approved) p.set("approved", "true");
    return downloadFile(`/projection-accuracy/export?${p.toString()}`, "Projection_Accuracy.xlsx");
  },
  supplierScorecard: () => req("/supplier-scorecard"),
  supplierScorecardExport: () => downloadFile("/supplier-scorecard/export", "Supplier_Scorecard.xlsx"),
  adhocPlanning: (planId) => req(`/adhoc-planning${planId ? `?plan_id=${planId}` : ""}`),
  adhocPlanningRun: (plan_id) => req("/adhoc-planning/run", { method: "POST", body: JSON.stringify({ plan_id }) }),
  adhocPlanningExport: (planId) => downloadFile(`/adhoc-planning/export${planId ? `?plan_id=${planId}` : ""}`, "Adhoc_Planning.xlsx"),
  jcPlans: () => req("/jc-plans"),
  productionSchedule: (planId) => req(`/production-schedule${planId ? `?plan_id=${planId}` : ""}`),
  productionScheduleExport: (planId) => downloadFile(
    `/production-schedule/export${planId ? `?plan_id=${planId}` : ""}`, `Production_Schedule_${planId || "plan"}.xlsx`),
  itemReceiptSchedule: (planId, region) => {
    const p = new URLSearchParams();
    if (planId) p.set("plan_id", planId);
    if (region) p.set("region", region);
    const qs = p.toString();
    return req(`/item-receipt-schedule${qs ? `?${qs}` : ""}`);
  },
  saveJcPlan: (note = "") => req("/jc-plan/save", { method: "POST", body: JSON.stringify({ note }) }),
  ppv: () => req("/ppv"),
  ppvExport: () => downloadFile("/ppv/export", "PPV_Scorecard.xlsx"),
  vookiPlanning: () => req("/vooki-planning"),
  vookiPlanningExport: (quantities, product = null) => downloadFile(
    "/vooki-planning/export", product ? `Vooki_${product}.xlsx` : "Vooki_Planning.xlsx", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantities, product }),
    }),
  vookiFgMap: () => req("/vooki-fg-map"),
  setVookiFgMap: (sku_code, product_name) =>
    req("/vooki-fg-map", { method: "POST", body: JSON.stringify({ sku_code, product_name }) }),
  vookiFgSkus: () => req("/vooki-fg-skus"),
  addVookiFgSku: (sku_code, item_desc) =>
    req("/vooki-fg-skus", { method: "POST", body: JSON.stringify({ sku_code, item_desc }) }),
  removeVookiFgSku: (sku_code) =>
    req("/vooki-fg-skus/remove", { method: "POST", body: JSON.stringify({ sku_code }) }),
  // SRDMS — Sample Request & Dispatch Management
  srdms: {
    masters: () => req("/srdms/masters"),
    saveMasters: (updates) => req("/srdms/masters", { method: "POST", body: JSON.stringify(updates) }),
    userRoles: () => req("/srdms/user-roles"),
    setUserRole: (user_code, role, plant_id = "") => req(`/srdms/user-roles${_actorQS()}`, { method: "POST", body: JSON.stringify({ user_code, role, plant_id }) }),
    items: (q) => req(`/srdms/items?q=${encodeURIComponent(q || "")}`),
    rdHeads: () => req("/srdms/rd-heads"),
    dashboard: () => req("/srdms/dashboard"),
    tatReport: () => req("/srdms/reports/tat"),
    notifications: (opts = {}) => {
      const p = new URLSearchParams();
      if (opts.unsent) p.set("unsent", "true");
      if (opts.sr_id) p.set("sr_id", opts.sr_id);
      return req(`/srdms/notifications?${p.toString()}`);
    },
    sendAll: () => req("/srdms/notifications/send-all", { method: "POST", body: "{}" }),
    runDigest: () => req("/srdms/digest", { method: "POST", body: "{}" }),
    list: (filters = {}) => {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v !== "" && v != null && v !== false) p.set(k, v); });
      return req(`/srdms/requests?${p.toString()}`);
    },
    get: (id) => req(`/srdms/requests/${id}`),
    create: (body) => req("/srdms/requests", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => req(`/srdms/requests/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    submit: (id, actor) => req(`/srdms/requests/${id}/submit`, { method: "POST", body: JSON.stringify({ actor }) }),
    approve: (id, body) => req(`/srdms/requests/${id}/approve`, { method: "POST", body: JSON.stringify(body) }),
    acknowledge: (id, body) => req(`/srdms/requests/${id}/acknowledge`, { method: "POST", body: JSON.stringify(body) }),
    dispatch: (id, lineId, body) => req(`/srdms/requests/${id}/lines/${lineId}/dispatch`, { method: "POST", body: JSON.stringify(body) }),
    hold: (id, lineId, body) => req(`/srdms/requests/${id}/lines/${lineId}/hold`, { method: "POST", body: JSON.stringify(body) }),
    reject: (id, lineId, body) => req(`/srdms/requests/${id}/lines/${lineId}/reject`, { method: "POST", body: JSON.stringify(body) }),
    receipt: (id, lineId, body) => req(`/srdms/requests/${id}/lines/${lineId}/receipt`, { method: "POST", body: JSON.stringify(body) }),
    qaRelease: (id, lineId, body) => req(`/srdms/requests/${id}/lines/${lineId}/qa-release`, { method: "POST", body: JSON.stringify(body) }),
    cancel: (id, body) => req(`/srdms/requests/${id}/cancel`, { method: "POST", body: JSON.stringify(body) }),
    emailTemplates: () => req("/srdms/email-templates"),
    reportsExport: () => downloadFile("/srdms/reports/export", "SRDMS_Reports.xlsx"),
    attachmentUrl: (stored) => `/api/srdms/attachments/${stored}`,
    uploadAttachment: (id, file, { line_id = "", kind = "attachment", actor } = {}) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("line_id", line_id);
      fd.append("kind", kind);
      fd.append("actor_name", actor?.name || "");
      fd.append("actor_role", actor?.role || "");
      return fetch(`${BASE}/srdms/requests/${id}/attachments`, { method: "POST", body: fd }).then(async (r) => {
        if (!r.ok) { let d = r.statusText; try { const j = await r.json(); d = j.detail || d; } catch (_) {} throw new Error(d); }
        return r.json();
      });
    },
  },
  // User Master (admin)
  userMaster: {
    status: () => req("/user-master/status"),
    importJson: () => req("/user-master/import", { method: "POST", body: "{}" }),
    departments: () => req("/user-master/departments"),
    setAllowedDepartments: (departments) => req("/user-master/allowed-departments", { method: "POST", body: JSON.stringify({ departments }) }),
    crmUsers: ({ q = "", all = false } = {}) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (all) p.set("all_departments", "true");
      return req(`/user-master/crm-users?${p.toString()}`);
    },
    login: (login, password) => req("/user-master/login", { method: "POST", body: JSON.stringify({ login, password }) }),
    changePassword: (login, current_password, new_password) =>
      req("/user-master/change-password", { method: "POST", body: JSON.stringify({ login, current_password, new_password }) }),
    setPassword: (code, password) => req(`/user-master/users/${encodeURIComponent(code)}/set-password${_actorQS()}`, { method: "POST", body: JSON.stringify({ password }) }),
    resetPassword: (code) => req(`/user-master/users/${encodeURIComponent(code)}/reset-password${_actorQS()}`, { method: "POST", body: "{}" }),
    initPasswords: () => req("/user-master/init-passwords", { method: "POST", body: "{}" }),
    users: () => req("/user-master/users"),
    accessLog: (user_code) => req(`/user-master/access-log${user_code ? `?user_code=${encodeURIComponent(user_code)}` : ""}`),
    addUser: (body) => req(`/user-master/users${_actorQS()}`, { method: "POST", body: JSON.stringify(body) }),
    removeUser: (code) => req(`/user-master/users/${encodeURIComponent(code)}${_actorQS()}`, { method: "DELETE" }),
    setStatus: (code, status) => req(`/user-master/users/${encodeURIComponent(code)}/status${_actorQS()}`, { method: "POST", body: JSON.stringify({ status }) }),
    setAvatar: (code, avatar) => req(`/user-master/users/${encodeURIComponent(code)}/avatar${_actorQS()}`, { method: "POST", body: JSON.stringify({ avatar }) }),
    addMenu: (code, menu_id, menu_label) => req(`/user-master/users/${encodeURIComponent(code)}/menus/add${_actorQS()}`, { method: "POST", body: JSON.stringify({ menu_id, menu_label }) }),
    removeMenu: (code, menu_id) => req(`/user-master/users/${encodeURIComponent(code)}/menus/remove${_actorQS()}`, { method: "POST", body: JSON.stringify({ menu_id }) }),
    setMenus: (code, menus) => req(`/user-master/users/${encodeURIComponent(code)}/menus${_actorQS()}`, { method: "PUT", body: JSON.stringify({ menus }) }),
  },
  roles: {
    list: () => req("/roles"),
    add: (role_name, description = "") => req(`/roles${_actorQS()}`, { method: "POST", body: JSON.stringify({ role_name, description }) }),
    update: (role_name, description, active) => req(`/roles${_actorQS()}`, { method: "PUT", body: JSON.stringify({ role_name, description, active }) }),
    remove: (role_name) => {
      const actor = _actorQS().slice(1);   // "actor_code=...&actor_name=..." or ""
      const qs = `role_name=${encodeURIComponent(role_name)}${actor ? "&" + actor : ""}`;
      return req(`/roles?${qs}`, { method: "DELETE" });
    },
    importJson: () => req("/roles/import", { method: "POST", body: "{}" }),
  },
  // admin
  planningSettings: () => req("/planning-settings"),
  savePlanningSettings: (updates) => req("/planning-settings", { method: "POST", body: JSON.stringify(updates) }),
  // data freshness (sync-to-DB architecture)
  syncStatus: () => req("/sync-status"),
  refreshData: (source = "all") => req(`/refresh${source && source !== "all" ? `?source=${encodeURIComponent(source)}` : ""}`, { method: "POST", body: "{}" }),
  orgs: () => req("/orgs"),
  msl: (reference) => req(`/msl${reference ? `?reference=${encodeURIComponent(reference)}` : ""}`),
  mslSnapshots: () => req("/msl/snapshots"),
  mslSave: () => req(`/msl/save${_actorQS()}`, { method: "POST", body: "{}" }),
  mslExport: (reference) => downloadFile(`/msl/export${reference ? `?reference=${encodeURIComponent(reference)}` : ""}`,
    `MSL_${reference || "current"}.xlsx`),
  reset: () => req("/reset", { method: "POST", body: "{}" }),
  health: () => req("/health"),
  healthDb: () => req("/health/db"),
};

export const fmt = {
  num: (v, d = 0) =>
    v == null || v === "" || v !== v ? "—"
      : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }),
  // Compact Indian abbreviation for KPI cards: ≥1 crore → "Cr", ≥1 lakh → "L";
  // smaller numbers stay full (they fit fine). Keeps big totals from overflowing.
  compact: (v) => {
    if (v == null || v === "" || v !== v) return "—";
    const n = Number(v);
    if (!isFinite(n)) return fmt.num(v);
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr";
    if (a >= 1e5) return (n / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L";
    return fmt.num(n);
  },
  inr: (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`),
  money: (v) => {
    if (v == null) return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
    return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  },
  pct: (v, d = 1) => (v == null ? "—" : `${(Number(v) * 100).toFixed(d)}%`),
  signed: (v, d = 1) => {
    if (v == null) return "—";
    const n = Number(v) * 100;
    return n > 0 ? `+${n.toFixed(d)}%` : `${n.toFixed(d)}%`;
  },
};
