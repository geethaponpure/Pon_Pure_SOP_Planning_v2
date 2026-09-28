import React, { useState, useEffect } from "react";
import SelectBox from "../components/SelectBox.jsx";
import SmoothInput from "../components/SmoothInput.jsx";
import IconButton from "../components/IconButton.jsx";
import { api } from "../api";
import { Loading, ErrorBox } from "../components/ui.jsx";
import { SprayCan, TrendingUp, FlaskConical, Package, Factory, Building2, Plus, Ban } from "lucide-react";
import PageInfo from "../components/PageInfo.jsx";

function Toggle({ checked, onChange }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </span>
  );
}

function SetRow({ checked, onChange, prio, title, hint }) {
  return (
    <div className="set-row">
      <Toggle checked={checked} onChange={onChange} />
      <div className="lbl" style={{ flex: 1 }}>
        {prio != null && <span className={`prio ${checked ? "" : "off"}`}>{prio}</span>}
        {title}
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

function Section({ n, icon, title, desc, children }) {
  return (
    <>
      <div className="sec">
        <div className="n tealn">{n}</div>
        <div><h2 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{icon}{title}</h2>{desc && <div className="d">{desc}</div>}</div>
      </div>
      {children}
    </>
  );
}

function ListEditor({ label, hint, value, onChange }) {
  return (
    <div className="card">
      <h3 style={{ fontSize: 13 }}>{label}</h3>
      <div className="sub">{(value || []).length} entries · {hint}</div>
      <textarea value={(value || []).join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))}
        rows={11}
        style={{ fontFamily: "monospace", fontSize: 12 }} />
    </div>
  );
}

const chip = (bg, color) => ({ background: bg, color, borderColor: "transparent", cursor: "default", fontSize: 10, marginLeft: 6 });

// Add / remove organizations — chips for the current list + a picker of live CRM orgs
// (and a free-text box for orgs not present in the current stock).
function OrgEditor({ label, hint, value, onChange, allOrgs }) {
  const [custom, setCustom] = useState("");
  const list = value || [];
  const add = (o) => { const v = (o || "").trim(); if (v && !list.includes(v)) onChange([...list, v]); };
  const remove = (o) => onChange(list.filter((x) => x !== o));
  const available = (allOrgs || []).filter((o) => !list.includes(o));
  return (
    <div className="card">
      <h3 style={{ fontSize: 13 }}>{label}</h3>
      <div className="sub">{list.length} organization{list.length === 1 ? "" : "s"} · {hint}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0", minHeight: 26 }}>
        {list.map((o) => (
          <span key={o} className="dept-chip is-active" style={{ cursor: "default" }}>
            {o}
            <span className="dept-chip-x" title="remove" onClick={() => remove(o)}>×</span>
          </span>
        ))}
        {list.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>none</span>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <SelectBox className="searchbox" style={{ maxWidth: 280, fontSize: 12 }} value=""
          onChange={(e) => { if (e.target.value) add(e.target.value); }}>
          <option value="">＋ Add organization…{available.length ? "" : " (no CRM orgs loaded)"}</option>
          {available.map((o) => <option key={o} value={o}>{o}</option>)}
        </SelectBox>
        <SmoothInput className="searchbox" style={{ maxWidth: 220, fontSize: 12 }} placeholder="or type a custom org + Enter"
          value={custom} onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(custom); setCustom(""); } }} />
        {custom.trim() && <button className="chip" onClick={() => { add(custom); setCustom(""); }}>Add</button>}
      </div>
    </div>
  );
}

function VookiFgMapSection() {
  const [d, setD] = useState(null);      // vookiFgMap: FG SKU list (master bulk ∪ added)
  const [fg, setFg] = useState(null);    // vookiFgSkus: { added, candidates }
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [cq, setCq] = useState("");
  const [busy, setBusy] = useState(null);

  const load = () => {
    api.vookiFgMap().then(setD).catch((e) => setErr(e.message));
    api.vookiFgSkus().then(setFg).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const addSku = async (code, desc) => {
    setBusy(code);
    try { await api.addVookiFgSku(code, desc); load(); } catch (e) { alert(e.message); } finally { setBusy(null); }
  };
  const removeSku = async (code) => {
    setBusy(code);
    try { await api.removeVookiFgSku(code); load(); } catch (e) { alert(e.message); } finally { setBusy(null); }
  };

  const rows = d && d.ready
    ? d.skus.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase().includes(q.toLowerCase()))
    : [];

  return (
    <Section n="6" icon={<SprayCan size={18} />} title="Vooki FG names"
      desc="The Vooki finished-good SKUs used by the Vooki Planning page (bulk SKUs from the master + any added below). Add new ones from CRM Vooki Division items. Stored in the app's MySQL database.">
      {err && <ErrorBox msg={err} />}
      {!d ? <Loading what="Vooki FG names" /> : !d.ready ? (
        <div className="banner warn">
          <b>MySQL store not ready.</b> {d.error || d.setup_hint}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Run <code>backend/db/setup.sql</code> (or <code>migrate_fg_sku.sql</code>) as root, then reload this page.
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="pagebar" style={{ marginTop: 0 }}>
              <SmoothInput className="searchbox" placeholder="Search SKU code / name…" value={q} onChange={(e) => setQ(e.target.value)} />
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{rows.length} FG SKUs</span>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: "38vh" }}>
              <table>
                <thead><tr><th>FG SKU</th><th style={{ width: 80 }}></th></tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((s) => (
                    <tr key={s.code}>
                      <td><b>{s.name}</b>{s.added && <span className="chip" style={chip("#EAF3FF", "#1768c4")}>added</span>}
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.code}{s.group ? ` · ${s.group}` : ""}</div></td>
                      <td>{s.added && <IconButton icon="trash" tooltip="Remove SKU" color="danger" size="xs" disabled={busy === s.code} onClick={() => removeSku(s.code)} />}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={2} style={{ color: "var(--muted)" }}>No Vooki FG SKUs.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}><Plus size={16} /> Add new FG SKU (from CRM Vooki Division)</h3>
            {!fg ? <Loading what="Vooki Division items" /> : !fg.candidates || fg.candidates.length === 0 ? (
              <div className="sub">No Vooki Division items found in CRM.</div>
            ) : (
              <>
                <div className="pagebar" style={{ marginTop: 0 }}>
                  <SmoothInput className="searchbox" placeholder="Search Vooki Division item description…" value={cq} onChange={(e) => setCq(e.target.value)} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{fg.candidates.length} Vooki Division items</span>
                </div>
                <div className="tbl-wrap" style={{ maxHeight: "34vh" }}>
                  <table>
                    <thead><tr><th>Vooki Division item</th><th style={{ width: 90 }}></th></tr></thead>
                    <tbody>
                      {fg.candidates
                        .filter((c) => !cq || (c.desc || "").toLowerCase().includes(cq.toLowerCase()) || c.code.toLowerCase().includes(cq.toLowerCase()))
                        .slice(0, 300)
                        .map((c) => (
                          <tr key={c.code}>
                            <td><b>{c.desc || c.code}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{c.code}</div></td>
                            <td>{c.added
                              ? <span className="chip" style={chip("#E6F6EC", "#1a7d4f")}>✓ added</span>
                              : <button className="btn" style={{ padding: "3px 12px" }} disabled={busy === c.code} onClick={() => addSku(c.code, c.desc)}>{busy === c.code ? "…" : "Add"}</button>}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="sub" style={{ marginTop: 8 }}>Showing up to 300 — use search. Added SKUs extend the Vooki FG list and Planning scope (if they have a BOM).</div>
              </>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

export default function PlanningSetting() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [allOrgs, setAllOrgs] = useState([]);   // live CRM org names for the pickers

  useEffect(() => {
    api.planningSettings().then((d) => { setData(d); setForm(d.settings); }).catch((e) => setError(e.message));
    api.orgs().then((d) => setAllOrgs(d.orgs || [])).catch(() => {});
  }, []);

  if (error) return <ErrorBox msg={error} />;
  if (!form) return <Loading what="planning settings" />;

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const r = await api.savePlanningSettings(form);
      setForm(r.settings); setDirty(false);
      setStatus("✓ Saved — the Supply & RM page will recompute on these settings.");
    } catch (e) { setStatus("Error: " + e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <PageInfo title="Planning Setting (admin)">
        Choose which filtration elements drive the
        <b> Supply &amp; RM Planning Filtration Technique</b> and edit the organization / sub-inventory lists.
        Settings persist; saving recomputes the Supply &amp; RM page.
      </PageInfo>

      <div className="set-summary">
        <span className="pill">JCs: {["current", "next1", "next2"].filter((k) => form[`plan_${k}`]).map((k) => ({ current: "Current", next1: "Next1", next2: "Next2" }[k])).join(", ") || "none"}</span>
        <span className="pill">BOM rules active: {["bom_prefer_pmo", "bom_prefer_bulk_hdlk", "bom_prefer_creation_date", "bom_prefer_primary"].filter((k) => form[k]).length}/4</span>
        <span className="pill">Substitutes: {form.consider_substitutes ? "on" : "off"}</span>
        <span className="pill">DM-water codes: {(form.dm_water_codes || []).length}</span>
        <span className="pill">Decode names: {form.decode_encoded_names ? "on" : "off"}</span>
        <span className="pill">Warehouse orgs: {(form.warehouse_orgs || []).length}</span>
        <span className="pill">RM-source orgs: {(form.rm_source_orgs || []).length}</span>
        <span className="pill">Intermediate stock orgs: {(form.intermediate_stock_orgs || []).length}</span>
        <span className="pill">MFG SOC-pending orgs: {(form.mfg_soc_orgs || []).length}</span>
        <span className="pill">Inter-company vendors: {(form.intercompany_vendors || []).length}</span>
        <span className="pill">Excluded sub-inv: {(form.excluded_subinv || []).length}</span>
      </div>

      <Section n="1" icon={<TrendingUp size={18} />} title="Projection filtering (3-JC)"
        desc="Item-based summation → Current / Next1 / Next2. Choose which JCs to plan ('plan as individual also').">
        <div className="grid cols-2">
          <div className="card">
            <SetRow checked={form.plan_current} onChange={(v) => set("plan_current", v)} title={<b>Plan Current JC</b>} />
            <SetRow checked={form.plan_next1} onChange={(v) => set("plan_next1", v)} title={<b>Plan Next&nbsp;1 JC</b>} />
            <SetRow checked={form.plan_next2} onChange={(v) => set("plan_next2", v)} title={<b>Plan Next&nbsp;2 JC</b>} />
          </div>
          <div className="card">
            <SetRow checked={form.drop_all_zero_projection} onChange={(v) => set("drop_all_zero_projection", v)}
              title="Drop all-zero products" hint="Items with zero across all enabled JCs are excluded" />
            <div className="set-row">
              <div className="lbl" style={{ flex: 1 }}>Min plan quantity (KG)<small>Plan an item only if a JC projection <b>or</b> Pending SOC exceeds this (else negligible). e.g. 0 projection but SOC 40 → still planned</small></div>
              <input type="number" value={form.min_plan_qty} style={{ width: 100 }}
                onChange={(e) => set("min_plan_qty", parseFloat(e.target.value || "0"))} />
            </div>
            <div className="set-row">
              <div className="lbl" style={{ flex: 1 }}>Max products shown<small>Cap the Supply &amp; RM list size</small></div>
              <input type="number" value={form.max_products} style={{ width: 100 }}
                onChange={(e) => set("max_products", parseInt(e.target.value || "0", 10))} />
            </div>
            <div className="set-row">
              <div className="lbl" style={{ flex: 1 }}>Aged-RM threshold (days)<small>RM older than this is "aged" on the Aged RM → FG page</small></div>
              <input type="number" value={form.aged_rm_days} style={{ width: 100 }}
                onChange={(e) => set("aged_rm_days", parseInt(e.target.value || "0", 10))} />
            </div>
          </div>
        </div>
      </Section>

      <Section n="2" icon={<FlaskConical size={18} />} title="BOM filtering technique"
        desc="Match by ASSEMBLY_DESC; the highest-priority enabled rule selects the BOM, the rest appear under 'More' on the Supply & RM page. Packing BOMs (packed assemblies) are shown separately for packing-material planning.">
        <div className="grid cols-2">
          <div className="card">
            <h3>Selection preference (applied in order)</h3>
            <SetRow prio={1} checked={form.bom_prefer_pmo} onChange={(v) => set("bom_prefer_pmo", v)}
              title={<>Prefer <code className="k">ORGANIZATION_CODE = PMO</code></>} />
            <SetRow prio={2} checked={form.bom_prefer_bulk_hdlk} onChange={(v) => set("bom_prefer_bulk_hdlk", v)}
              title={<>Prefer <code className="k">ASSEMBLY_ITEM</code> contains BULK / HDLK</>} />
            <SetRow prio={3} checked={form.bom_prefer_creation_date} onChange={(v) => set("bom_prefer_creation_date", v)}
              title={<>Prefer the newest <code className="k">BOM_CREATION_DATE</code></>} hint="Most recently created BOM wins" />
            <SetRow prio={4} checked={form.bom_prefer_primary} onChange={(v) => set("bom_prefer_primary", v)}
              title={<>Prefer <code className="k">ALTERNATE_BOM_DESIGNATOR = Primary</code></>} />
          </div>
          <div className="card">
            <h3>Components</h3>
            <SetRow checked={form.consider_substitutes} onChange={(v) => set("consider_substitutes", v)}
              title={<>Consider main RM <b>+ substitutes</b></>}
              hint="Repeated COMPONENT_ITEM_SEQ ⇒ substitutes; their stock counts toward availability" />
            <SetRow checked={form.decode_encoded_names} onChange={(v) => set("decode_encoded_names", v)}
              title="Decode encoded RM / intermediate names" hint="Show COMP_ITEM_DESC instead of the encoded item code" />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              <Ban size={13} style={{ verticalAlign: -2 }} /> <b>Excluded from substitutes (data-entry errors):</b> packing material (item code starting <code>P</code>, auto-excluded) and the DM-water codes listed below. These never count toward RM availability.
            </div>
          </div>
          <ListEditor label="DM-water item codes (excluded from substitutes)"
            hint="Exact item codes for DM / demineralized water — wrongly listed as RM substitutes"
            value={form.dm_water_codes} onChange={(v) => set("dm_water_codes", v)} />
        </div>
      </Section>

      <Section n="3" icon={<Package size={18} />} title="Finished-good stock filtering"
        desc="Business ≠ Raw Material. Split into Warehouse (MFG orgs) vs Branch; excluded sub-inventories removed.">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="set-row">
            <div className="lbl" style={{ flex: 1 }}>Raw-material Business label<small>Everything else is treated as finished good</small></div>
            <input type="text" value={form.raw_material_business} style={{ width: 220 }}
              onChange={(e) => set("raw_material_business", e.target.value)} />
          </div>
        </div>
        <div className="grid cols-2">
          <OrgEditor label="Warehouse organizations" hint="FG warehouse vs branch split"
            value={form.warehouse_orgs} onChange={(v) => set("warehouse_orgs", v)} allOrgs={allOrgs} />
          <ListEditor label="Excluded sub-inventories" hint="rework / expired / scrap / return …"
            value={form.excluded_subinv} onChange={(v) => set("excluded_subinv", v)} />
        </div>
        <div className="grid cols-2" style={{ marginTop: 16 }}>
          <OrgEditor label="MFG SOC-pending dispatch orgs (Current JC)"
            hint="Pending SOC at these dispatch orgs = 'MFG SOC Pending' in the Current JC"
            value={form.mfg_soc_orgs} onChange={(v) => set("mfg_soc_orgs", v)} allOrgs={allOrgs} />
        </div>
      </Section>

      <Section n="4" icon={<Factory size={18} />} title="Raw-material filtering"
        desc="RM = Business = Raw Material plus General-Chemicals / intermediates in the RM-source organizations.">
        <div className="grid cols-2">
          <OrgEditor label="RM-source organizations" hint="General Chemicals / intermediates"
            value={form.rm_source_orgs} onChange={(v) => set("rm_source_orgs", v)} allOrgs={allOrgs} />
          <OrgEditor label="Intermediate stock orgs (GC1/GC2)"
            hint="For RMs whose Business ≠ Raw Material, only stock at these orgs counts as available"
            value={form.intermediate_stock_orgs} onChange={(v) => set("intermediate_stock_orgs", v)} allOrgs={allOrgs} />
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="set-row">
            <div className="lbl" style={{ flex: 1 }}>In-transit (open-PO) source
              <small><b>CRM</b> = live Oracle open-PO balance (ordered − received − cancelled), window-independent & includes not-yet-received POs. <b>File</b> = legacy PO_receipts register (date-windowed).</small></div>
            <select value={form.intransit_source} style={{ width: 130 }} onChange={(e) => set("intransit_source", e.target.value)}>
              <option value="crm">CRM (live)</option>
              <option value="file">File register</option>
            </select>
          </div>
          <div className="set-row">
            <div className="lbl" style={{ flex: 1 }}>In-transit PO recency (months)<small>Only POs placed within this many months count as in-transit — drops stale un-received POs & old blanket contracts</small></div>
            <input type="number" value={form.intransit_po_months} style={{ width: 100 }}
              onChange={(e) => set("intransit_po_months", parseInt(e.target.value || "0", 10))} />
          </div>
          <div className="set-row">
            <div className="lbl" style={{ flex: 1 }}>Blanket-PO cap (KG)<small>Ignore PO lines ordered above this — blanket/annual framework contracts, not physical in-transit (median order is ~6,000 KG)</small></div>
            <input type="number" value={form.blanket_po_qty} style={{ width: 120 }}
              onChange={(e) => set("blanket_po_qty", parseFloat(e.target.value || "0"))} />
          </div>
        </div>
        <OrgEditor label="RM-only in-transit orgs"
          hint="At these orgs, only 'Raw Material' business POs count as in-transit — GC1/GC2 & other-business POs are dropped (e.g. Madhavaram receives GC intermediates)"
          value={form.intransit_rm_only_orgs} onChange={(v) => set("intransit_rm_only_orgs", v)} allOrgs={allOrgs} />
      </Section>

      <Section n="5" icon={<Building2 size={18} />} title="Group-company (inter-company) PO vendors"
        desc="Purchases from these vendors are DROPPED from all PO analytics — in-transit, net-to-buy, lead time, supplier scorecard, PPV. Matched on Vendor Name (whitespace-normalized, case-insensitive), so add every spelling variant used in the data (e.g. 'PVT LTD' vs 'PRIVATE LIMITED').">
        <ListEditor label="Inter-company vendor names" hint="Exact vendor-name match; add variants to be safe"
          value={form.intercompany_vendors} onChange={(v) => set("intercompany_vendors", v)} />
      </Section>

      <div className="savebar">
        <button className="btn" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save settings"}</button>
        <button className="btn secondary" onClick={() => { setForm({ ...data.defaults }); setDirty(true); }}>Reset to defaults</button>
        {dirty && !status && <span style={{ fontSize: 13, color: "var(--amber)" }}>Unsaved changes</span>}
        {status && <span style={{ fontSize: 13, color: status.startsWith("Error") ? "var(--red)" : "var(--green)" }}>{status}</span>}
      </div>

      <VookiFgMapSection />
    </>
  );
}
