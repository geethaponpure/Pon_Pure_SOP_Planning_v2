// Shared navigation model (imported by App and by the User Master admin page,
// where each nav entry is a grantable module/menu).
// Icons are lucide-react components (rendered by App as <n.icon />).
import {
  AlarmClock, Gauge, Compass, ShieldCheck, ShieldHalf, Swords, CalendarCheck2, Crosshair, CircleCheck, TrendingUp, Grid3x3, Settings, LayoutGrid,
  Factory, SprayCan, Zap, Hourglass, TrendingDown, Target, Ruler, FlaskConical, Package,
  Microscope, FolderKanban, Award, ArrowLeftRight, CalendarClock, PackageCheck, CalendarRange,
  Sparkles, ChartColumn, Handshake, Settings2, UserCog, Users, History,
} from "lucide-react";

export const NAV = [
  { id: "mydash", label: "My Dashboard", icon: Gauge },
  { id: "commitrisk", label: "Commitment Risk", icon: AlarmClock },
  { id: "supplypos", label: "My Supply Position", icon: Crosshair },
  { id: "demandprot", label: "Demand Protection", icon: ShieldHalf },
  { id: "supplycomp", label: "Supply Competition", icon: Swords },
  { id: "promisedates", label: "Promise Dates", icon: CalendarCheck2 },
  { id: "overview", label: "S&OP Cockpit", icon: Compass },
  { id: "dq", label: "Data-Quality Gate", icon: ShieldCheck },
  { id: "validation", label: "Demand Validation", icon: CircleCheck },
  { id: "forecasting", label: "Forecasting", icon: TrendingUp },
  { id: "segmentation", label: "Segmentation", icon: Grid3x3 },
  { id: "supply", label: "Supply & RM Plan", icon: Settings },
  { id: "supplycards", label: "RM Plan — Data", icon: LayoutGrid },
  { id: "mfgstock", label: "MFG Org Stock", icon: Factory },
  { id: "vooki", label: "Vooki Planning", icon: SprayCan },
  { id: "adhoc", label: "Adhoc Planning", icon: Zap },
  { id: "agedrm", label: "Aged RM → FG", icon: Hourglass },
  { id: "msl", label: "MSL (Min Stock Level)", icon: TrendingDown },
  { id: "projsales", label: "Projection vs Sales", icon: Target },
  { id: "projaccuracy", label: "Projection Accuracy", icon: Ruler },
  { id: "rd-samples", label: "R&D Sample Requests", icon: FlaskConical },
  { id: "wh-dispatch", label: "Warehouse Sample Dispatch", icon: Package },
  { id: "qc-samples", label: "QC for R&D Sample", icon: Microscope },
  { id: "srdms", label: "Sample Req & Dispatch (admin)", icon: FolderKanban },
  { id: "scorecard", label: "Supplier Scorecard", icon: Award },
  { id: "ppv", label: "Purchase Price Variance", icon: ArrowLeftRight },
  { id: "prodsched", label: "Production Scheduling", icon: CalendarClock },
  { id: "receipt", label: "Item Receipt Schedule", icon: PackageCheck },
  { id: "jcplan", label: "JC Plan (multi-period)", icon: CalendarRange },
  { id: "analytics", label: "Analytics & What-if", icon: Sparkles },
  { id: "kpis", label: "KPI Framework", icon: ChartColumn },
  { id: "governance", label: "Governance & RACI", icon: Handshake },
  { id: "planningsetting", label: "Planning Setting (admin)", icon: Settings2 },
  { id: "roles", label: "Role Master (admin)", icon: UserCog },
  { id: "usermaster", label: "User Master (admin)", icon: Users },
  { id: "audit", label: "Audit Trail", icon: History },
];

// pages hidden from the sidebar (not accessible)
// commitrisk / demandprot / supplycomp / promisedates are parked for now — the
// pages and their routes stay in the code, remove an id here to bring one back.
export const HIDDEN = new Set(["overview", "dq", "validation", "forecasting", "segmentation", "jcplan",
  "analytics", "kpis", "governance", "audit",
  "commitrisk", "demandprot", "supplycomp", "promisedates"]);
