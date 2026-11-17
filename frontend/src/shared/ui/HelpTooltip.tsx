/**
 * HelpTooltip (ТЗ DR44 §3): an accessible hover/focus tooltip.
 *
 * Opens on hover AND keyboard focus, closes on hover leave, blur and Escape,
 * is linked to the trigger through ``aria-describedby`` (never a bare
 * ``title`` attribute) and does not shift the surrounding layout: the popup
 * is absolutely positioned. The trigger is a real button with the given
 * accessible name, so the tooltip content stays reachable without a mouse.
 */
import { cloneElement, isValidElement, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** ТЗ DR46 §3.2: a shared accessible tooltip wrapper for an arbitrary
 * trigger (e.g. an icon-only Button): opens on hover AND keyboard focus,
 * closes on blur/hover-leave/Escape, links the popup via
 * ``aria-describedby`` — never a bare ``title``. */
export interface TooltipProps {
  text: string;
  children: ReactNode;
}

export function Tooltip({ text, children }: TooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const child = isValidElement(children)
    ? (children as React.ReactElement<Record<string, unknown>>)
    : null;
  return (
    <span
      className="app-help-tooltip"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {child !== null
        ? cloneElement(child, {
            // The canonical Button owns its own props (ariaDescribedBy);
            // ordinary DOM elements use the direct attribute.
            "aria-describedby": open ? popupId : undefined,
            ariaDescribedBy: open ? popupId : undefined,
            onMouseEnter: () => setOpen(true),
            onMouseLeave: () => setOpen(false),
            onFocus: () => setOpen(true),
            onBlur: () => setOpen(false),
          })
        : children}
      {open ? (
        <span role="tooltip" id={popupId} className="app-help-tooltip-popup">
          {text}
        </span>
      ) : null}
    </span>
  );
}

export interface HelpTooltipProps {
  /** The tooltip text (exact wording owned by the caller). */
  text: string;
  /** Accessible name of the trigger, e.g. «Что входит в стоимость». */
  accessibleName: string;
}

export function HelpTooltip({ text, accessibleName }: HelpTooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <span
      className="app-help-tooltip"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="app-help-tooltip-trigger"
        aria-label={accessibleName}
        aria-expanded={open}
        aria-describedby={open ? popupId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="question-circle" />
      </button>
      {open ? (
        <span role="tooltip" id={popupId} className="app-help-tooltip-popup">
          {text}
        </span>
      ) : null}
    </span>
  );
}
