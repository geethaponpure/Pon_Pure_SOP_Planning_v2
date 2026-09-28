import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAsync } from "./components/ui.jsx";

// Shared state between the two Supply pages:
//   • "Supply & RM Plan" (i/o — generate plan, exports, Apply BOM overrides)
//   • "RM Plan — Data"   (the By product / Consolidated / Real RM card views)
//
// - The base CRM plan (`api.rmPlanning`) is fetched ONCE here and shared.
// - `uploaded`: the uploaded / overridden plan (null → live CRM plan).
// - `data`: the effective plan = uploaded plan if present, else the fetched CRM plan.
// - `sel`: BOM override selections { productIndex -> chosen BOM index }.
// - `dirty` / `overrideCount`: unsaved (non-preferred) BOM selections not yet applied.
// - `applyOverrides()`: rebuild & save the plan with the selected overrides.
const SupplyPlanContext = createContext(null);

export function SupplyPlanProvider({ children, dirtyRef }) {
  const { data: fetched, loading, error } = useAsync(api.rmPlanning);
  const [uploaded, setUploaded] = useState(null);
  const [sel, setSel] = useState({});
  const data = uploaded ? uploaded.plan : fetched;

  // overrides = selections pointing at a NON-preferred BOM (product name -> recipe key)
  const buildOverrides = useCallback(() => {
    const o = {};
    Object.entries(sel).forEach(([i, k]) => {
      const p = data && data.products && data.products[+i];
      const b = p && p.boms && p.boms[k];
      if (b && !b.preferred) o[p.name] = `${b.assembly_item}|${b.org_code}|${b.designator}`;
    });
    return o;
  }, [sel, data]);

  const overrideCount = useMemo(() => Object.keys(buildOverrides()).length, [buildOverrides]);
  const dirty = overrideCount > 0;

  // apply & save the selected BOM overrides; clears the selection on success
  const applyOverrides = useCallback(async () => {
    const o = buildOverrides();
    if (!Object.keys(o).length) return null;
    const r = await api.applyBomOverrides(o);
    setUploaded(r);
    setSel({});
    return r;
  }, [buildOverrides]);

  const discardOverrides = useCallback(() => setSel({}), []);

  // expose the unsaved count to the app shell (App reads it for the nav-away guard)
  useEffect(() => { if (dirtyRef) dirtyRef.current = overrideCount; }, [overrideCount, dirtyRef]);

  // native "unsaved changes" prompt on browser refresh / tab close
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  return (
    <SupplyPlanContext.Provider value={{
      data, loading, error, uploaded, setUploaded, sel, setSel,
      overrideCount, dirty, applyOverrides, discardOverrides,
    }}>
      {children}
    </SupplyPlanContext.Provider>
  );
}

export function useSupplyPlan() {
  return useContext(SupplyPlanContext);
}
