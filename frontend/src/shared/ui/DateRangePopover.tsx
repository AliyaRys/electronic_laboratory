/**
 * DateRangePopover (DR48 §3.4): the shared low-level trigger/popover pair for
 * choosing an inclusive calendar range («С»/«По», native date inputs). The
 * visual pattern follows the arrivals date filter: nothing is sent before
 * «Применить», Escape and an outside click close the popover and return the
 * focus to the trigger. Pages never re-implement this behaviour locally.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import "./DateRangePopover.css";

export interface AppliedDateRange {
  /** Inclusive start date (YYYY-MM-DD) or "" when not chosen. */
  from: string;
  /** Inclusive end date (YYYY-MM-DD) or "" when not chosen. */
  to: string;
}

export interface DateRangePopoverProps {
  /** The static caption of the trigger («Период отчёта»). */
  caption: string;
  applied: AppliedDateRange;
  onApply: (range: AppliedDateRange) => void;
  onReset: () => void;
  /** Trigger label while no range is applied. */
  emptyLabel?: string;
  disabled?: boolean;
  /** Story/variant helper: render with the popover already open. */
  initialOpen?: boolean;
  /** DOM id prefix of the two date inputs (a11y labels). */
  idPrefix?: string;
}

/** The Russian apply-time validation of the pair (shared wording). */
export function dateRangeError(from: string, to: string): string {
  if (from === "" || to === "") return "Укажите дату начала и дату окончания периода.";
  if (from > to) return "Дата начала не может быть позже даты окончания.";
  return "";
}

/** «ДД.ММ.ГГГГ — ДД.ММ.ГГГГ»; one applied day prints a single date. */
export function appliedRangeLabel(range: AppliedDateRange): string {
  const ru = (value: string): string => {
    const parts = value.split("-");
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
  };
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  if (from === "" && to === "") return "";
  if (from === to) return ru(from);
  return `${ru(from)} — ${ru(to)}`;
}

export function DateRangePopover({
  caption,
  applied,
  onApply,
  onReset,
  emptyLabel = "Выберите период",
  disabled = false,
  initialOpen = false,
  idPrefix = "date-range",
}: DateRangePopoverProps): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const [draft, setDraft] = useState<AppliedDateRange>(applied);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Same outside-click contract as the arrivals date filter: the trigger
  // itself is skipped so its click stays a plain toggle.
  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (triggerRef.current?.contains(target)) return;
    if (!rootRef.current?.contains(target)) {
      event.preventDefault();
      close();
    }
  };

  useEffect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (): void => {
    if (open) {
      close();
      return;
    }
    // The APPLIED state is always the draft: opening never resurrects an
    // unapplied experiment.
    setDraft(applied);
    setError("");
    setOpen(true);
  };

  const apply = (): void => {
    const problem = dateRangeError(draft.from, draft.to);
    if (problem !== "") {
      setError(problem);
      return;
    }
    setError("");
    onApply(draft);
    close();
  };

  const reset = (): void => {
    setError("");
    onReset();
    setDraft({ from: "", to: "" });
    close();
  };

  const summary = appliedRangeLabel(applied);
  const fromId = `${idPrefix}-from`;
  const toId = `${idPrefix}-to`;

  return (
    <div
      className="vse-date-range"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span className="vse-date-range-caption">{caption}</span>
      <button
        ref={triggerRef}
        type="button"
        className="vse-date-range-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${caption}${summary !== "" ? `: ${summary}` : ""}`}
        disabled={disabled}
        onClick={toggle}
      >
        <Icon name="calendar" />
        <span>{summary !== "" ? summary : emptyLabel}</span>
      </button>
      {open ? (
        <div className="vse-date-range-popover" role="group" aria-label={caption}>
          <div className="vse-date-range-title">{caption}</div>
          <div className="vse-date-range-inputs">
            <label htmlFor={fromId}>С</label>
            <input
              id={fromId}
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
            <label htmlFor={toId}>По</label>
            <input
              id={toId}
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
          {error !== "" ? (
            <p className="vse-date-range-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vse-date-range-actions">
            <button type="button" className="vse-date-range-secondary" onClick={reset}>
              Сбросить
            </button>
            <button type="button" className="vse-date-range-primary" onClick={apply}>
              Применить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
