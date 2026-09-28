import React, { useEffect } from "react";
import { createPortal } from "react-dom";

// Styled confirmation modal (replaces window.confirm). Markup/classes follow the
// provided .modal-container design. Closes on overlay click, the ✕, or Escape.
export default function ConfirmModal({
  open, title, children,
  cancelLabel = "Cancel", confirmLabel = "Confirm",
  onCancel, onConfirm, confirmClass = "is-primary",
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  // Portal to <body> so the fixed overlay is never clipped or covered by an
  // ancestor with transform/filter/overflow (e.g. the supply page container).
  return createPortal(
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-container" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-container-header">
          <div className="modal-container-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            {title}
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onCancel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-container-body">
          <div className="rtf">{children}</div>
        </div>
        <div className="modal-container-footer">
          <button className="button is-ghost" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className={`button ${confirmClass}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
