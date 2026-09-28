import React, { useState } from "react";

// Icon-only "how adhoc planning works" info popover, shown beside the top-bar
// title on the Adhoc Planning page. Self-contained (static content + toggle).
export default function AdhocInfo() {
  const [info, setInfo] = useState(false);
  return (
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label="How adhoc planning works"
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
            <div className="supply-info-title">How Adhoc Planning Works</div>
            <ul className="supply-info-list">
              <li><b>Scope:</b> open SOC orders received <b>after the freeze date</b> (2nd day of the 3rd JC week).</li>
              <li><b>Validated against:</b> <b>Projected Qty</b> + <b>Pending SOC</b>.</li>
              <li><b>Covered:</b> the order sits within the projection.</li>
              <li><b>Exceeds:</b> beyond projection + pending SOC — the excess is an Exceeds adhoc order.</li>
              <li><b>New:</b> a line item that is not in the projection at all.</li>
              <li><b>RM source:</b> adhoc production is planned from the RM remaining <b>after deducting a saved JC Plan's allocation</b>, so RM is never allocated twice.</li>
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
