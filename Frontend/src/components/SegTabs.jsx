import React from "react";

// Shared segmented toggle: a track with the active option shown as a white pill.
// Simple radio-input styling (no sliding glider). Same { tabs, value, onChange }
// API used across the pages, so call sites need no changes.
//
//   <SegTabs value={mode} onChange={setMode}
//     tabs={[{ id, label, title?, icon? }, ...]} size="md" | "sm" />
const cx = (...p) => p.filter(Boolean).join(" ");

export default function SegTabs({ tabs, value, onChange, size = "md", className, name }) {
  const auto = React.useId();
  const group = name || auto;
  return (
    <div className={cx("radio-inputs", size === "sm" && "radio-inputs-sm", className)} role="radiogroup">
      {tabs.map((t) => {
        const id = `${group}-${t.id}`;
        return (
          <label className="radio" key={t.id}>
            <input
              type="radio"
              id={id}
              name={group}
              checked={value === t.id}
              onChange={() => onChange(t.id)}
            />
            <span className="name" title={t.title || ""}>
              {t.icon ? `${t.icon} ` : ""}{t.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
