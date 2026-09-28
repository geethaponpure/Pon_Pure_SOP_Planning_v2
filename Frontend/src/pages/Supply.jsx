import React, { useState } from "react";
import SegTabs from "../components/SegTabs.jsx";
import SelectBox from "../components/SelectBox.jsx";
import SupplyDashboard from "../components/SupplyDashboard.jsx";
import { api, fmt } from "../api";
import { useAsync, Loading, ErrorBox, Stat } from "../components/ui.jsx";
import { useSupplyPlan } from "../SupplyPlanContext.jsx";
import { Package, Factory, Tags, Truck, FileSpreadsheet, Download, Upload, Play, RotateCcw, Check, Save, Share2, Boxes, CalendarDays, Receipt, TriangleAlert, ClipboardList } from "lucide-react";

function TemplateBar() {
  const { data } = useAsync(api.templateSegments);
  const [seg2, setSeg2] = useState("");
  const [seg3, setSeg3] = useState("");
  const [busy, setBusy] = useState(false);
  const segments = data?.segments || [];
  const seg3opts = segments.find((x) => x.segment2 === seg2)?.segment3 || [];
  return (
    <div className="card supply-tool-card" style={{ display: "flex", flexWrap: "nowrap", gap: 12, alignItems: "center", marginBottom: 14 }}>
      <span style={{ flexShrink: 0 }}><b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><FileSpreadsheet size={15} /> Plan-input template</b> <span style={{ fontSize: 12, color: "var(--muted)" }}>· Segment 1 = Performance Chemicals</span></span>
      <SelectBox className="searchbox" style={{ maxWidth: 210 }} value={seg2} onChange={(e) => { setSeg2(e.target.value); setSeg3(""); }}>
        <option value="">All Segment 2</option>
        {segments.map((x) => <option key={x.segment2} value={x.segment2}>{x.segment2}</option>)}
      </SelectBox>
      <SelectBox className="searchbox" style={{ maxWidth: 210 }} value={seg3} onChange={(e) => setSeg3(e.target.value)} disabled={!seg2}>
        <option value="">All Segment 3</option>
        {seg3opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </SelectBox>
      <button className="btn" style={{ marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }} disabled={busy}
        title="Excel template (S.No, Item Description [dropdown], Qty, Current JC, Next JC1, Next JC2)"
        onClick={async () => { setBusy(true); try { await api.templateDownload(seg2, seg3); } catch (e) { alert(e.message); } finally { setBusy(false); } }}>
        {busy ? "Preparing…" : <><Download size={15} /> Download Template</>}
      </button>
    </div>
  );
}

function UploadBar({ onPlan, active, onClear }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("consolidate");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (mode !== "crm" && !file) { alert("Choose a filled template (.xlsx) first."); return; }
    if (mode === "excel_only" && !window.confirm("Plan using ONLY the uploaded Excel — ignoring CRM projection and pending SOC?\n\nProceed with Excel-only planning?")) return;
    setBusy(true);
    try {
      const r = await api.uploadPlan(mode === "crm" ? null : file, mode);
      onPlan(r);
      const src = mode === "crm" ? "Projection + Pending SOC" : `${r.plan_mode}, ${r.excel_items} Excel items`;
      alert(`✓ Plan #${r.plan_id ?? "—"} generated (${src})` + (r.mysql_ok ? " and saved to DB." : " — DB save failed: " + (r.mysql_error || "")));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card supply-tool-card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 14 }}>
      <span><b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Upload size={15} /> Generate plan</b></span>
      <SegTabs
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "crm", label: "Projection + Pending SOC" },
          { id: "consolidate", label: "Consolidate" },
          { id: "excel_only", label: "Excel only" },
        ]}
      />
      {mode !== "crm" && (
        <label className={"drop-container" + (file ? " has-file" : "")} style={{ marginLeft: "auto" }}>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files[0])} />
          <svg className="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="drop-title">{file ? file.name : "Choose file"}<small>{file ? "Click to replace" : "Upload filled template (.xlsx)"}</small></span>
        </label>
      )}
      <button className="btn" style={{ marginLeft: mode === "crm" ? "auto" : 0 }} disabled={busy} onClick={go}>{busy ? "Planning…" : <><Play size={15} /> Generate Plan</>}</button>
      {active && <button className="btn secondary" onClick={onClear}><RotateCcw size={14} /> Back to CRM plan</button>}
    </div>
  );
}

export default function Supply() {
  return <RMPlanning />;
}

// Supply & RM Plan — inputs / outputs only. The plan data views (By product /
// Consolidated RM / Real RM cards) live on the "Supply Cards" page.
function RMPlanning() {
  const { data, loading, error, uploaded, setUploaded, sel, setSel } = useSupplyPlan();
  const [exporting, setExporting] = useState(false);
  const [segExporting, setSegExporting] = useState(false);
  const [packExporting, setPackExporting] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [applying, setApplying] = useState(false);
  if (!data) return loading ? <Loading what="Supply & RM Plan" /> : error ? <ErrorBox msg={error} /> : null;
  if (data.note) return <div className="banner info">{data.note}</div>;

  const s = data.summary;
  const pjc = data.planning_jc || 4;

  // BOM overrides chosen in the UI: {product name -> "assembly|org|designator"}
  const bomOverrides = {};
  Object.entries(sel).forEach(([i, k]) => {
    const p = data.products[+i];
    const b = p && p.boms && p.boms[k];
    if (b && !b.preferred) bomOverrides[p.name] = `${b.assembly_item}|${b.org_code}|${b.designator}`;
  });
  const overrideCount = Object.keys(bomOverrides).length;
  const applyOverrides = async () => {
    if (!window.confirm(`Apply ${overrideCount} BOM override(s)?\n\nThe plan will rebuild with your chosen BOMs and save — this flows into the consolidated RM plan, Excel and Production Scheduling. (Rebuild can take ~2 minutes.)`)) return;
    setApplying(true);
    try {
      const r = await api.applyBomOverrides(bomOverrides);
      setUploaded(r); setSel({});
      alert(`✓ ${r.overrides_applied} BOM override(s) applied · plan #${r.plan_id ?? "—"} saved` + (r.mysql_ok ? "." : " — DB save failed: " + (r.mysql_error || "")));
    } catch (e) { alert(e.message); } finally { setApplying(false); }
  };

  return (
    <section className="supply-page">
      <div className="banner supply-context" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", fontSize: 13 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarDays size={15} /> <b>Planning JC{pjc}</b>{data.planning_jc_from ? ` · ${data.planning_jc_from} → ${data.planning_jc_to}` : ""}</span>
        {data.soc_window && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Receipt size={15} /> <b>Pending SOC:</b> {data.soc_window.from <= "1900-01-01" ? "As on date" : data.soc_window.from} → {data.soc_window.to}</span>}
        {data.po_window && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Truck size={15} /> <b>Pending PO dates:</b> {data.po_window.from} → {data.po_window.to}</span>}
      </div>
      {data.projection_jc_note && (
        <div className="banner supply-notice">
          <TriangleAlert size={15} style={{ verticalAlign: "-2px" }} /> <b>Projection roll-forward:</b> {data.projection_jc_note}
        </div>
      )}

      <div className="grid cols-4 supply-metrics">
        <div className="card statcard"><div className="ic"><Package size={22} /></div><Stat value={fmt.num(s.projected_products)} label="Projected products (3-JC ≠ 0)" /></div>
        <div className="card statcard blue"><div className="ic"><Factory size={22} /></div><Stat value={fmt.num(s.manufacturing)} label="Manufacturing (make)" /></div>
        <div className="card statcard"><div className="ic"><Tags size={22} /></div><Stat value={fmt.num(s.repack_relabel)} label="Repack / Relabel" /></div>
        <div className="card statcard amber"><div className="ic"><Truck size={22} /></div><Stat value={fmt.num(s.po_pending_items)} label="Items with PO pending" /></div>
      </div>

      <SupplyDashboard data={data} />

      <TemplateBar />
      <UploadBar onPlan={setUploaded} active={!!uploaded} onClear={() => setUploaded(null)} />
      {uploaded && (
        <div className="banner supply-notice">
          {uploaded.plan_mode === "bom_override"
            ? <><ClipboardList size={14} style={{ verticalAlign: "-2px" }} /> Showing <b>plan #{uploaded.plan_id ?? "—"}</b> with <b>{uploaded.overrides_applied} BOM override(s)</b> applied · saved to DB — flows into consolidated RM, Excel &amp; Production Scheduling. </>
            : <><ClipboardList size={14} style={{ verticalAlign: "-2px" }} /> Showing <b>uploaded plan #{uploaded.plan_id ?? "—"}</b> ({uploaded.plan_mode === "excel_only" ? "Excel only" : "Consolidated: Excel + Projection + Pending SOC"}) · {uploaded.excel_items} Excel items · saved to DB. </>}
          <button className="link" onClick={() => setUploaded(null)}>↺ back to CRM plan</button>
        </div>
      )}

      {/* Actions — save & exports */}
      <div className="supply-workspace supply-actions" style={{ display: "flex", alignItems: "center", flexWrap: "nowrap", gap: 8, margin: "16px 0 10px" }}>
        {overrideCount > 0 && (
          <button className="btn" disabled={applying}
            title="Rebuild & save the plan using your chosen BOMs (flows into consolidated RM, Excel & Production Scheduling)"
            onClick={applyOverrides}>
            {applying ? "Applying… (~2 min)" : <><Check size={15} /> Apply {overrideCount} BOM override{overrideCount > 1 ? "s" : ""}</>}
          </button>
        )}
        <button className="btn secondary" disabled={savingPlan}
          title="Save this JC's RM plan (freezes RM allocation for adhoc planning)"
          onClick={async () => {
            setSavingPlan(true);
            try { const r = await api.saveJcPlan(); alert(`✓ JC Plan saved — Plan ID ${r.plan_id}. Adhoc planning can now deduct this plan's RM allocation.`); }
            catch (e) { alert("Save failed: " + e.message); } finally { setSavingPlan(false); }
          }}>
          {savingPlan ? "Saving…" : <><Save size={15} /> Save JC Plan</>}
        </button>
        <button className="btn" disabled={exporting}
          onClick={async () => { setExporting(true); try { await (uploaded?.plan_id ? api.planExport(uploaded.plan_id) : api.rmPlanningExport()); } catch (e) { alert(e.message); } finally { setExporting(false); } }}>
          {exporting ? "Exporting…" : <><Download size={15} /> {uploaded ? "Download uploaded plan (Excel)" : "Download report (Excel)"}</>}
        </button>
        <button className="btn secondary" disabled={segExporting}
          title="A ZIP with a separate Excel file per Segment 2 (each split Manufacturing / Others) to share with the Business Units — each file includes a Reference sheet (understanding note + organization matrix)"
          onClick={async () => { setSegExporting(true); try { await api.rmSegmentExport(uploaded?.plan_id || null); } catch (e) { alert(e.message); } finally { setSegExporting(false); } }}>
          {segExporting ? "Zipping…" : <><Share2 size={15} /> Projection Confirmation to Share BU</>}
        </button>
        <button className="btn secondary" disabled={packExporting}
          title="Separate workbook: Packing Material (consolidated) + Packing BOMs (per-FG packing components) — split out of the RM plan"
          onClick={async () => { setPackExporting(true); try { await api.packingExport(uploaded?.plan_id || null); } catch (e) { alert(e.message); } finally { setPackExporting(false); } }}>
          {packExporting ? "Exporting…" : <><Boxes size={15} /> Packing plan (Excel)</>}
        </button>
      </div>

    </section>
  );
}
