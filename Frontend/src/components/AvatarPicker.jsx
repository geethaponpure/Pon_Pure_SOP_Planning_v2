import React, { useEffect } from "react";
import { AVATARS } from "../assets/avatars/index.js";

// Modal grid for choosing a 3D profession avatar. onSelect receives the avatar
// id (or "" to clear). Closes on overlay click or Escape.
export default function AvatarPicker({ current, title, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="avatar-modal-overlay" onClick={onClose}>
      <div className="avatar-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose avatar">
        <div className="avatar-modal-head">
          <h3>{title || "Choose an avatar"}</h3>
          <button className="avatar-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="avatar-grid">
          <button
            type="button"
            className={`avatar-tile none ${!current ? "sel" : ""}`}
            onClick={() => onSelect("")}
            title="No avatar"
          >
            <span>None</span>
          </button>
          {AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`avatar-tile ${current === a.id ? "sel" : ""}`}
              onClick={() => onSelect(a.id)}
              title={a.label}
            >
              <img src={a.url} alt={a.label} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
