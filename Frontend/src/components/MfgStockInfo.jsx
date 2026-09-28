import React, { useState } from "react";

// Icon-only "what this page shows" info popover, shown beside the top-bar title
// on the MFG-Org Stock page. Mirrors SupplyInfo / RMDataInfo.
export default function MfgStockInfo() {
  const [info, setInfo] = useState(false);
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="About MFG-Org Stock"
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
            <div className="supply-info-title">MFG-Org Stock — What It Shows</div>
            <ul className="supply-info-list">
              <li><b>Source:</b> On-hand stock at the <b>manufacturing organizations</b> (org names containing “MFG/Mfg”), read from CRM (<code>SPBiStockDetails</code>).</li>
              <li><b>Aggregation:</b> Per <b>item × org</b>, tagged with <b>Division</b> &amp; <b>Segment</b>.</li>
              <li><b>Scope:</b> Restricted to the <b>Performance Chemicals</b> and <b>NPD</b> divisions. Excluded sub-inventories and <b>DM-water</b> codes are removed.</li>
              <li><b>Controls:</b> Filter by Division / Org / Segment, search, and click any column to sort.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
