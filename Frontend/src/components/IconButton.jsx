import React from "react";

// Compact icon-only button with a hover tooltip — the plain-CSS equivalent of
// Untitled UI's <ButtonUtility>. Use for row actions (edit / delete / download /
// copy). Pass `icon` as a known name (below) or a custom SVG node.
//
//   <IconButton icon="trash" tooltip="Delete" color="danger" onClick={...} />
const cx = (...p) => p.filter(Boolean).join(" ");

// feather-style 24×24 stroke icons (inherit currentColor)
const ICONS = {
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};

export default function IconButton({
  icon,
  tooltip,
  onClick,
  disabled,
  color = "secondary", // "secondary" | "danger" | "primary"
  size = "sm",         // "sm" | "xs"
  type = "button",
  className,
  ...rest
}) {
  return (
    <span className="icon-btn-wrap">
      <button
        type={type}
        className={cx("icon-btn", `icon-btn-${size}`, `icon-btn-${color}`, className)}
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        {...rest}
      >
        {typeof icon === "string" ? ICONS[icon] : icon}
      </button>
      {tooltip && <span className="icon-btn-tip" role="tooltip">{tooltip}</span>}
    </span>
  );
}
