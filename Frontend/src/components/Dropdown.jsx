import React from "react";
import {
  Button as AriaButton,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  SubmenuTrigger,
} from "react-aria-components";

// A reusable dropdown-menu system modeled on the Untitled UI `Dropdown.*` API but
// rebuilt on react-aria-components for this project's plain-CSS stack (no Tailwind).
// react-aria gives us keyboard nav, focus management, click-outside/Esc and submenu
// handling for free; we only supply the styling via the dd-* classes in styles.css.

const cx = (...parts) => parts.filter(Boolean).join(" ");

// Root = the trigger + menu pairing (wraps MenuTrigger). Its first child is the
// trigger element, the rest is the Popover.
function Root(props) {
  return <MenuTrigger {...props} />;
}

// The floating panel. react-aria positions it relative to the trigger.
function Popover({ className, children, ...props }) {
  return (
    <AriaPopover className={cx("dd-popover", className)} offset={6} {...props}>
      {children}
    </AriaPopover>
  );
}

function Menu({ className, ...props }) {
  return <AriaMenu className={cx("dd-menu", className)} {...props} />;
}

function Section(props) {
  return <AriaMenuSection className="dd-section" {...props} />;
}

function Separator() {
  return <AriaSeparator className="dd-separator" />;
}

// An item. `addon` renders a right-aligned shortcut/hint (e.g. "⌘X").
// `submenu` shows the ▸ affordance for items that open a nested menu.
function Item({ addon, submenu, className, children, ...props }) {
  return (
    <AriaMenuItem className={cx("dd-item", className)} {...props}>
      <span className="dd-item-label">{children}</span>
      {addon && <Keyboard className="dd-item-addon">{addon}</Keyboard>}
      {submenu && <span className="dd-item-chevron" aria-hidden>›</span>}
    </AriaMenuItem>
  );
}

// A plain button styled as a dropdown trigger (optional — callers may pass their
// own trigger element as Root's first child instead).
function Trigger({ className, ...props }) {
  return <AriaButton className={cx("dd-trigger", className)} {...props} />;
}

export const Dropdown = { Root, Trigger, Popover, Menu, Section, Separator, Item };
export { SubmenuTrigger };
