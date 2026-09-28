import React, { useRef } from "react";

// CSS-only reveal (checkbox `:checked` sibling toggle) with a JS confirm action.
// The trigger is a <label> that flips a hidden checkbox → the `.ic-pop` shows via
// CSS alone (no React state / portal / stacking games). "Confirm" imperatively
// unchecks the box (closing the pop) then runs onConfirm; "Cancel" is a plain
// <label> that toggles the box back off.
export default function InlineConfirm({
  id, trigger, triggerClass = "", disabled = false,
  message, cancelLabel = "Cancel", confirmLabel = "Confirm",
  confirmClass = "primary", onConfirm,
}) {
  const inputRef = useRef(null);
  const doConfirm = () => {
    if (inputRef.current) inputRef.current.checked = false;
    onConfirm?.();
  };
  return (
    <span className="inline-confirm">
      <input ref={inputRef} type="checkbox" id={id} className="ic-toggle sr-only" disabled={disabled} />
      {/* click-away: a label over the page that toggles the same box back off */}
      <label htmlFor={id} className="ic-backdrop" aria-hidden />
      <label htmlFor={id} className={`ic-trigger ${triggerClass}`}>{trigger}</label>
      <span className="ic-pop" role="dialog" aria-modal="false">
        <span className="ic-msg">{message}</span>
        <span className="ic-actions">
          <label htmlFor={id} className="ic-btn ghost">{cancelLabel}</label>
          <button type="button" className={`ic-btn ${confirmClass}`} onClick={doConfirm}>{confirmLabel}</button>
        </span>
      </span>
    </span>
  );
}
