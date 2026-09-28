import React, { useState } from "react";
import { useSupplyPlan } from "../SupplyPlanContext.jsx";

// Icon-only "how the RM plan is calculated" info popover, shown beside the top-bar
// title on the "RM Plan — Data" page. Mirrors SupplyInfo's display logic; content
// covers the Consolidated & Real-RM views. Lead-time JC bands are dynamic (pjc).
export default function RMDataInfo() {
  const [info, setInfo] = useState(false);
  const { data } = useSupplyPlan() || {};
  const pjc = data?.planning_jc || 4;
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="How the RM plan is calculated"
        aria-expanded={info}
        onClick={() => setInfo((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {info && (
        <>
          <div className="supply-info-backdrop" onClick={() => setInfo(false)} />
          <div className="supply-info-pop">
            <div className="supply-info-title">Consolidated & Real RM — How It's Calculated</div>
            <ul className="supply-info-list">
              <li><b>Consolidation:</b> One row per material; all item codes are rolled up and summed across manufacturing finished goods.</li>
              <li><b>Planning:</b> Requirement is netted against stock, substitutes, and in-transit inventory.</li>
              <li><b>Scope:</b> Manufacturing, Repack/Relabel, and Packing are planned separately; item codes starting with <b>“P”</b> are excluded.</li>
              <li><b>Purchase Rule:</b> Available stock → ✓ no purchase. Shortfall → purchase only the deficit, by lead time:
                <ul style={{ margin: "5px 0 0", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                  <li>≤30d: <b>JC{pjc}</b></li>
                  <li>31–60d: <b>JC{pjc} + JC{pjc + 1}</b></li>
                  <li>&gt;60d: <b>JC{pjc} + JC{pjc + 1} + JC{pjc + 2}</b></li>
                </ul>
              </li>
              <li><b>Real RM:</b> Intermediates are recursively exploded to purchased leaf raw materials; quantities are rolled up and names decoded.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
