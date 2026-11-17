/**
 * SelectDropdown (ТЗ DR42 §6.1): the one reusable styled select of the ВСЭ
 * form — the controlled equivalent of the mockup's Choices markup.
 *
 * A native browser-default select is never left on the screen: the trigger is
 * a button styled like the mockup control, the dropdown is a positioned
 * listbox panel with border/shadow/active item, the placeholder stays disabled
 * and muted, arrows/Home/End/Enter/Escape work and the ARIA listbox semantics
 * (aria-expanded, role=listbox/option, the associated label) hold. The popup
 * stacks above the section content, so a long list is never clipped.
 */
import { useEffect, useId, useRef, useState } from "react";
import "./ui.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectDropdownProps {
  /** Accessible name of the control (linked to the trigger by the label). */
  label: string;
  /** Hide the visible label text when the field grid provides its own. */
  hideLabel?: boolean;
  value: string;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Optional options marked unavailable (still visible, not selectable). */
  onChange: (value: string) => void;
  id?: string;
}

export function SelectDropdown({
  label,
  hideLabel = false,
  value,
  options,
  placeholder = "Выберите значение",
  disabled = false,
  onChange,
  id,
}: SelectDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = id ?? `select-${useId()}`;
  const labelId = `${listboxId}-label`;

  const selected = value === "" ? null : (options.find((option) => option.value === value) ?? null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0 && listRef.current !== null) {
      const item = listRef.current.children[activeIndex];
      if (item instanceof HTMLElement && typeof item.scrollIntoView === "function") {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [open, activeIndex]);

  const openList = (): void => {
    if (disabled) return;
    const initial = options.findIndex((option) => option.value === value);
    setActiveIndex(nearestEnabled(initial));
    setOpen(true);
  };

  const commit = (index: number): void => {
    const option = options[index];
    if (option === undefined || (option.value === "" && option.label === placeholder)) {
      // The disabled placeholder never becomes a value; the list stays open.
      return;
    }
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** The nearest enabled option at or after ``index`` (Home/End/arrows never
   * land on the disabled placeholder). */
  const nearestEnabled = (index: number): number => {
    for (let forward = index; forward < options.length; forward += 1) {
      const option = options[forward];
      if (option !== undefined && !(option.value === "" && option.label === placeholder)) return forward;
    }
    for (let back = index; back >= 0; back -= 1) {
      const option = options[back];
      if (option !== undefined && !(option.value === "" && option.label === placeholder)) return back;
    }
    return -1;
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => nearestEnabled(Math.min(options.length - 1, Math.max(0, index) + 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => nearestEnabled(Math.max(0, Math.max(0, index) - 1)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(nearestEnabled(0));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(nearestEnabled(options.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) commit(activeIndex);
    }
  };

  return (
    <div className={`app-select${hideLabel ? " app-select-inline" : ""}`} ref={rootRef}>
      <span className={`app-field-heading${hideLabel ? " app-visually-hidden" : ""}`} id={labelId}>
        {label}
      </span>
      <button
        type="button"
        ref={triggerRef}
        className={`app-select-trigger${selected === null ? " is-placeholder" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${listboxId}-value`}
        disabled={disabled}
        data-testid={listboxId ? `${listboxId}-trigger` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="app-select-value" id={`${listboxId}-value`}>
          {selected === null ? placeholder : selected.label}
        </span>
        <span className="app-select-arrow" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          className="app-select-list"
          role="listbox"
          aria-labelledby={labelId}
          id={listboxId}
          ref={listRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => {
            const unavailable = option.value === "" && option.label === placeholder;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={unavailable}
                className={`app-select-option${index === activeIndex ? " is-active" : ""}${
                  option.value === value ? " is-selected" : ""
                }`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => {
                  if (unavailable) return;
                  commit(index);
                }}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
