import React, { useState } from "react";

// Icon-only "how this plan is calculated" info popover, shown beside the top-bar
// title on the Supply & RM Plan page. Self-contained (static content + toggle).
export default function SupplyInfo() {
  const [info, setInfo] = useState(false);
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="How this plan is calculated"
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
            <div className="supply-info-title">How This Plan Is Calculated</div>
            <ul className="supply-info-list">
              <li><b>Demand:</b> 3-JC projection + pending MFG SOC, using preferred BOMs (PMO → Bulk/HDLK → Newest → Primary).</li>
              <li><b>RM Planning:</b> Requirement is netted against live RM stock, pending PO, and substitutes.</li>
              <li><b>Manufacturing:</b> Current/3-JC requirement = Demand + MSL − FG stock.</li>
              <li><b>MSL:</b> Applies only to consistently moving items (&gt;10/13 JCs, &gt;5 customers).</li>
              <li><b>Producible:</b> Limited by the scarcest available RM.</li>
              <li><b>Filter:</b> Items ≤25 KG across projection and SOC are excluded.</li>
              <li><b>In-Transit:</b> Open POs since May 1, 2026 are added to RM availability.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
