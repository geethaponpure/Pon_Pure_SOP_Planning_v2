import React, { useState, useEffect, useRef } from "react";
import { NAV, HIDDEN } from "./nav";
import { api } from "./api";
import { useAsync, Loading, useScrollFade } from "./components/ui.jsx";
import { SupplyPlanProvider } from "./SupplyPlanContext.jsx";
import DataFreshness from "./components/DataFreshness.jsx";
import ProfileMenu from "./components/ProfileMenu.jsx";
import SupplyInfo from "./components/SupplyInfo.jsx";
import RMDataInfo from "./components/RMDataInfo.jsx";
import AdhocInfo from "./components/AdhocInfo.jsx";
import AgedRMInfo from "./components/AgedRMInfo.jsx";
import MfgStockInfo from "./components/MfgStockInfo.jsx";
import VookiInfo from "./components/VookiInfo.jsx";
import ConfirmModal from "./components/ConfirmModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Login from "./pages/Login.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import CommitRisk from "./pages/CommitRisk.jsx";
import DemandProtection from "./pages/DemandProtection.jsx";
import SupplyCompetition from "./pages/SupplyCompetition.jsx";
import PromiseDates from "./pages/PromiseDates.jsx";
import SupplyPosition from "./pages/SupplyPosition.jsx";
import Overview from "./pages/Overview.jsx";
import DataQuality from "./pages/DataQuality.jsx";
import Validation from "./pages/Validation.jsx";
import Forecasting from "./pages/Forecasting.jsx";
import Segmentation from "./pages/Segmentation.jsx";
import Supply from "./pages/Supply.jsx";
import SupplyCards from "./pages/SupplyCards.jsx";
import MfgStock from "./pages/MfgStock.jsx";
import Vooki from "./pages/Vooki.jsx";
import AgedRM from "./pages/AgedRM.jsx";
import MSL from "./pages/MSL.jsx";
import ProjectionSales from "./pages/ProjectionSales.jsx";
import ProjectionAccuracy from "./pages/ProjectionAccuracy.jsx";
import SRDMS from "./pages/SRDMS.jsx";
import SupplierScorecard from "./pages/SupplierScorecard.jsx";
import AdhocPlanning from "./pages/AdhocPlanning.jsx";
import PPV from "./pages/PPV.jsx";
import ProductionSchedule from "./pages/ProductionSchedule.jsx";
import ItemReceiptSchedule from "./pages/ItemReceiptSchedule.jsx";
import JCPlan from "./pages/JCPlan.jsx";
import Analytics from "./pages/Analytics.jsx";
import KPIs from "./pages/KPIs.jsx";
import Governance from "./pages/Governance.jsx";
import PlanningSetting from "./pages/PlanningSetting.jsx";
import RoleMaster from "./pages/RoleMaster.jsx";
import UserMaster from "./pages/UserMaster.jsx";
import Audit from "./pages/Audit.jsx";

function BurgerIcon({ collapsed, onClick }) {
  return (
    <button
      type="button"
      className={`burger-btn ${collapsed ? "is-collapsed" : ""}`}
      onClick={onClick}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label="Toggle sidebar"
    >
      <span className="burger-line line-1" />
      <span className="burger-line line-2" />
      <span className="burger-line line-3" />
    </button>
  );
}

export default function App() {
  const [page, setPage] = useState("supply");
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "true"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar_collapsed", String(next)); } catch {}
      return next;
    });
  };
  // shared cycle status drives the badge + header; bumped on any mutation
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const status = useAsync(api.overview, [version]);
  const cycle = status.data?.cycle;
  const openEx = cycle?.exceptions_open ?? 0;

  // ── access control ───────────────────────────────────────────────────────
  // The login gate only activates once passwords are enabled AND at least one user is
  // approved — before that the app stays open (bootstrap, so no one is locked out).
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("app_session")); } catch { return null; }
  });
  const auth = useAsync(() => api.userMaster.status(), []);
  const gate = !!(auth.data && auth.data.password_enabled && auth.data.user_count > 0);
  const menus = new Set(session?.menus || []);
  const isAdmin = !gate || menus.has("usermaster");
  const allowed = (id) => !HIDDEN.has(id) && (isAdmin || menus.has(id));
  const navItems = NAV.filter((n) => allowed(n.id));
  const navRef = useScrollFade([navItems.length, collapsed]);

  // unsaved BOM overrides (set by SupplyPlanProvider) — used to warn before leaving Supply
  const dirtyRef = useRef(0);
  const [leaveTo, setLeaveTo] = useState(null);   // pending page id awaiting leave-confirm
  const SUPPLY_PAGES = new Set(["supply", "supplycards"]);
  const goToPage = (id) => {
    if (id === page) return;
    const leavingSupply = SUPPLY_PAGES.has(page) && !SUPPLY_PAGES.has(id);
    if (leavingSupply && dirtyRef.current > 0) { setLeaveTo(id); return; }  // ask via modal
    setPage(id);
  };

  const [showChangePw, setShowChangePw] = useState(false);
  const saveSession = (s) => { setSession(s); localStorage.setItem("app_session", JSON.stringify(s)); };
  const doLogin = (s) => {
    saveSession(s);
    const admin = (s.menus || []).includes("usermaster");
    const first = NAV.find((n) => !HIDDEN.has(n.id) && (admin || (s.menus || []).includes(n.id)));
    setPage(first ? first.id : "");
  };
  const doLogout = () => { setSession(null); localStorage.removeItem("app_session"); };
  const loginName = session?.user?.username || session?.user?.user_code || "";

  useEffect(() => {   // keep the selected page within the user's granted modules
    if (gate && session && !allowed(page)) setPage(navItems[0] ? navItems[0].id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, session, page]);

  if (auth.loading) return <Loading what="workspace" />;
  if (gate && !session) return <Login onLogin={doLogin} />;
  if (gate && session && session.user?.must_change_password) {
    return <ChangePassword login={loginName} forced
      onDone={() => saveSession({ ...session, user: { ...session.user, must_change_password: false } })} />;
  }

  const pages = {
    mydash: <Dashboard session={session} isAdmin={isAdmin} />,
    commitrisk: <CommitRisk session={session} isAdmin={isAdmin} />,
    demandprot: <DemandProtection session={session} isAdmin={isAdmin} />,
    supplycomp: <SupplyCompetition session={session} isAdmin={isAdmin} />,
    promisedates: <PromiseDates session={session} isAdmin={isAdmin} />,
    supplypos: <SupplyPosition session={session} isAdmin={isAdmin} />,
    overview: <Overview onChange={bump} />,
    dq: <DataQuality />,
    validation: <Validation onChange={bump} />,
    forecasting: <Forecasting />,
    segmentation: <Segmentation />,
    supply: <Supply />,
    supplycards: <SupplyCards />,
    mfgstock: <MfgStock />,
    vooki: <Vooki />,
    adhoc: <AdhocPlanning />,
    agedrm: <AgedRM />,
    msl: <MSL />,
    projsales: <ProjectionSales />,
    projaccuracy: <ProjectionAccuracy />,
    "rd-samples": <SRDMS session={session} mode="requester" />,
    "wh-dispatch": <SRDMS session={session} mode="warehouse" />,
    "qc-samples": <SRDMS session={session} mode="qc" />,
    srdms: <SRDMS session={session} mode="all" />,
    scorecard: <SupplierScorecard />,
    ppv: <PPV />,
    prodsched: <ProductionSchedule />,
    receipt: <ItemReceiptSchedule />,
    jcplan: <JCPlan />,
    analytics: <Analytics />,
    kpis: <KPIs />,
    governance: <Governance />,
    planningsetting: <PlanningSetting />,
    roles: <RoleMaster />,
    usermaster: <UserMaster />,
    audit: <Audit version={version} />,
  };

  return (
    <SupplyPlanProvider dirtyRef={dirtyRef}>
    <div className={`app ${collapsed ? "sb-collapsed" : ""}`}>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-content">
            <span>Supply Chain</span>
            <h1>Planning Tool</h1>
          </div>
          <BurgerIcon collapsed={collapsed} onClick={toggleCollapsed} />
        </div>
        <nav ref={navRef}>
          {navItems.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => goToPage(n.id)}
              title={collapsed ? n.label : undefined}
            >
              <span className="nav-icon">{n.icon && <n.icon size={18} strokeWidth={1.75} />}</span>
              <span className="nav-label">{n.label}</span>
              {n.id === "validation" && openEx > 0 && <span className="badge">{openEx}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <div className="main">
        <div className="topbar">
          <h2>{NAV.find((n) => n.id === page)?.label}</h2>
          {page === "supply" && <SupplyInfo />}
          {page === "supplycards" && <RMDataInfo />}
          {page === "adhoc" && <AdhocInfo />}
          {page === "agedrm" && <AgedRMInfo />}
          <span id="page-info-slot" className="page-info-slot" />
          {page === "mfgstock" && <MfgStockInfo />}
          {page === "vooki" && <VookiInfo />}
          <div className="cycle-pill">
            <DataFreshness />
            {cycle && (
              <>
                <span className="pill">Cycle {cycle.cycle_period}</span>
                <span className="pill">{cycle.step}</span>
              </>
            )}
            {session && (
              <ProfileMenu
                name={session.user?.name || session.user?.username || session.user?.user_code || "User"}
                role={isAdmin ? "Admin" : "User"}
                avatar={session.user?.avatar}
                onChangePassword={() => setShowChangePw(true)}
                onLogout={doLogout}
              />
            )}
          </div>
        </div>
        <div className="content">
          {allowed(page) && pages[page] ? <ErrorBoundary key={page}>{pages[page]}</ErrorBoundary> : (
            <div className="banner warn">
              You don’t have access to this module. {navItems.length === 0
                ? "No modules are assigned to your account — please contact your administrator."
                : "Pick a module from the sidebar."}
            </div>
          )}
        </div>
      </div>

      {showChangePw && session && (
        <ChangePassword login={loginName}
          onDone={() => { setShowChangePw(false); alert("Password updated."); }}
          onCancel={() => setShowChangePw(false)} />
      )}

      <ConfirmModal
        open={!!leaveTo}
        title="Unsaved BOM changes"
        cancelLabel="Stay on this page"
        confirmLabel="Leave without saving"
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => { const t = leaveTo; setLeaveTo(null); setPage(t); }}
      >
        You have <b>{dirtyRef.current} unsaved BOM change{dirtyRef.current > 1 ? "s" : ""}</b>. They won’t be
        applied to the plan or exports until you save them from the RM Plan — Data page.
      </ConfirmModal>
    </div>
    </SupplyPlanProvider>
  );
}
