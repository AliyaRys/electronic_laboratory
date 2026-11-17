/**
 * HelpTooltip (ТЗ DR44 §3): an accessible hover/focus tooltip.
 *
 * Opens on hover AND keyboard focus, closes on hover leave, blur and Escape,
 * is linked to the trigger through ``aria-describedby`` (never a bare
 * ``title`` attribute) and does not shift the surrounding layout: the popup
 * is absolutely positioned. The trigger is a real button with the given
 * accessible name, so the tooltip content stays reachable without a mouse.
 */
import { useId, useRef, useState } from "react";
import { Icon } from "./Icon";

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
