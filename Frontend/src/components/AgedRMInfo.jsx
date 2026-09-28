import React, { useState } from "react";

// Icon-only "how aged RM → FG works" info popover, shown beside the top-bar title
// on the Aged RM → FG page. Self-contained (static content + toggle).
export default function AgedRMInfo() {
  const [info, setInfo] = useState(false);
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="How aged RM to FG is calculated"
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
            <div className="supply-info-title">Aged Raw-Material → Finished-Goods</div>
            <ul className="supply-info-list">
              <li><b>Source:</b> raw materials (<b>Business = Raw Material</b>) aged more than <b>90 days</b> — the threshold is configurable in Planning Settings.</li>
              <li><b>Live data:</b> aged stock is read live from CRM <b>SPBiStockDetails</b>.</li>
              <li><b>Producible FGs:</b> the finished goods listed are those where <b>every required RM has aged stock</b>.</li>
              <li><b>Why a plan is needed:</b> one RM feeds several FGs at different consumption rates, so those FGs compete for the same aged pool.</li>
              <li><b>Recommended plan:</b> greedily produces the FGs that consume the <b>most aged inventory</b>, depleting the shared RM pool — to maximise utilisation of slow-moving stock.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
