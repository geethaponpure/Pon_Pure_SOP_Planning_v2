import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Page-level "ⓘ" explainer. The PAGE owns the content — so live values such as
// {data.std_lead_days} or {meta.reference} keep working — but the button itself is
// portalled into the top-bar slot beside the page title, matching SupplyInfo &co.
export default function PageInfo({ title, children }) {
  const [slot, setSlot] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { setSlot(document.getElementById("page-info-slot")); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!slot) return null;
  return createPortal(
    <span className="supply-info">
      <button
        type="button"
        className="supply-info-btn"
        aria-label={title ? `About ${title}` : "About this page"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {open && (
        <>
          <div className="supply-info-backdrop" onClick={() => setOpen(false)} />
          <div className="supply-info-pop">
            {title && <div className="supply-info-title">{title}</div>}
            <div className="supply-info-text">{children}</div>
          </div>
        </>
      )}
    </span>,
    slot
  );
}
