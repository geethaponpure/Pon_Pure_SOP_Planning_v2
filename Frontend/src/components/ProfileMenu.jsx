import React from "react";
import { Button, Header } from "react-aria-components";
import { avatarUrl } from "../assets/avatars/index.js";
import { Dropdown } from "./Dropdown.jsx";

const KeyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 2l-2 2m-3.5 3.5L19 4l3 3-3.5 3.5m-3-3L11.4 11.6m0 0a5.5 5.5 0 1 0-7.8 7.8 5.5 5.5 0 0 0 7.8-7.8z" />
  </svg>
);
const PowerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
  </svg>
);

// Top-bar profile chip (avatar + name + role + chevron) with a dropdown for
// change-password / logout. Built on the reusable Dropdown (react-aria-components),
// which supplies open/close, click-outside, Esc and keyboard navigation.

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfileMenu({ name, role, avatar, onChangePassword, onLogout }) {
  const avaUrl = avatarUrl(avatar);

  return (
    <div className="topbar-profile">
    <Dropdown.Root>
      <Button className="profile-chip" aria-label="Account menu">
        <span className={`profile-avatar ${avaUrl ? "has-img" : ""}`}>
          {avaUrl ? <img src={avaUrl} alt="" /> : initials(name)}
        </span>
        <span className="profile-meta">
          <span className="profile-name">{name}</span>
          <span className="profile-role">{role}</span>
        </span>
        <span className="profile-chevron" aria-hidden>▾</span>
      </Button>

      <Dropdown.Popover className="profile-menu-pop">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "pw") onChangePassword?.();
            else if (key === "logout") onLogout?.();
          }}
        >
          <Dropdown.Section>
            <Header className="profile-menu-title">{name}{role ? ` · ${role}` : ""}</Header>
            <Dropdown.Item id="pw" className="act-pw"><KeyIcon /><span>Change password</span></Dropdown.Item>
            <Dropdown.Separator />
            <Dropdown.Item id="logout" className="logout"><PowerIcon /><span>Logout</span></Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
    </div>
  );
}
