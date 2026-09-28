import React, { useState } from "react";

// Icon-only "what this page shows" info popover, shown beside the top-bar title
// on the Vooki Planning page. Mirrors SupplyInfo / RMDataInfo / MfgStockInfo.
export default function VookiInfo() {
  const [info, setInfo] = useState(false);
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="About Vooki Planning"
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
            <div className="supply-info-title">Vooki Planning — How It Works</div>
            <ul className="supply-info-list">
              <li><b>Input:</b> Enter a <b>quantity to plan</b> for each Vooki finished good — the RM requirement explodes instantly through the selected BOM.</li>
              <li><b>BOM preference:</b> <b>PMO → BULK/HDLK → newest → Primary</b>; use <b>More</b> to override.</li>
              <li><b>Netting:</b> Main RM + substitutes are netted against live CRM stock (<code>SPBiStockDetails</code>, Business = <b>Vooki Division</b> for FG · <b>Raw Material + intermediates</b> for RM), and against PO received / in-transit.</li>
              <li><b>FG stock:</b> Unpacked from packaged SKUs (via the item master) into units &amp; KG/Lit.</li>
              <li><b>Packing:</b> Packing BOMs plan separately for packing material.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
