/**
 * ТЗ DR39 §7: the completed-reconciliation date filter of the «Завершенные»
 * queue — a trigger/popover pair on the SAME composition as the columns
 * chooser (arrivals-accepted.html). Two modes: «Дата» (one native date) and
 * «Диапазон» (two datetime-local fields «С»/«По»). Nothing is sent to the
 * API before «Применить»; «Сбросить» removes ALL reconciled_* params. The
 * popover closes on Escape and an outside click and returns focus to the
 * trigger; the conversion of the московский local values to the wire stays
 * in api.ts — the component never builds ISO text itself.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { reconciliationRangeError, reconciliationSummaryLabel } from "./api";

/** The APPLIED (URL-committed) reconciliation date of the page. */
export interface AppliedReconciliationDate {
  /** ``reconciled_on`` — one московский calendar day (YYYY-MM-DD). */
  on: string;
  /** ``reconciled_from`` — a datetime-local value (Europe/Moscow meaning). */
  from: string;
  /** ``reconciled_to`` — a datetime-local value (Europe/Moscow meaning). */
  to: string;
}

export interface ReconciliationDateFilterProps {
  applied: AppliedReconciliationDate;
  onApply: (next: AppliedReconciliationDate) => void;
  /** Story/variant helper: render with the popover already open. */
  initialOpen?: boolean;
}

type Mode = "date" | "range";

export function ReconciliationDateFilter({
  applied,
  onApply,
  initialOpen = false,
}: ReconciliationDateFilterProps): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const [mode, setMode] = useState<Mode>(applied.from !== "" || applied.to !== "" ? "range" : "date");
  const [draft, setDraft] = useState<AppliedReconciliationDate>(applied);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // ТЗ DR39 fix-loop: the pointerdown outside handler closes WITH the focus
  // return (same as Escape/toggle); the trigger itself is skipped so its
  // following click stays a plain toggle and never re-opens the popover.
  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (triggerRef.current?.contains(target)) return;
    if (!rootRef.current?.contains(target)) {
      // preventDefault keeps the browser from moving the focus to the
      // clicked element AFTER our focus() — the trigger stays focused.
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
    // unapplied experiment and F5/back-forward keeps the honest state.
    setDraft(applied);
    setMode(applied.from !== "" || applied.to !== "" ? "range" : "date");
    setError("");
    setOpen(true);
  };

  const apply = (): void => {
    if (mode === "date") {
      setError("");
      onApply({ on: draft.on, from: "", to: "" });
      close();
      return;
    }
    const problem = reconciliationRangeError(draft.from, draft.to);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError("");
    onApply({ on: "", from: draft.from, to: draft.to });
    close();
  };

  const reset = (): void => {
    setError("");
    onApply({ on: "", from: "", to: "" });
    setDraft({ on: "", from: "", to: "" });
    close();
  };

  const summary = reconciliationSummaryLabel(applied);

  return (
    <div
      className="arrivals-filter-field arrivals-date-filter"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span className="arrivals-filter-label">Дата сверки данных</span>
      <button
        ref={triggerRef}
        type="button"
        className="arrivals-columns-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Дата сверки данных${summary !== "" ? `: ${summary}` : ""}`}
        onClick={toggle}
      >
        <Icon name="calendar" />
        <span>{summary !== "" ? summary : "Выбрать дату"}</span>
      </button>
      {open ? (
        <div
          className="arrivals-columns-popover arrivals-date-popover"
          role="group"
          aria-label="Дата сверки данных"
        >
          <div className="arrivals-columns-title">Дата сверки данных</div>
          <fieldset className="arrivals-date-modes">
            <label>
              <input
                type="radio"
                name="reconciled-mode"
                checked={mode === "date"}
                onChange={() => setMode("date")}
              />
              Дата
            </label>
            <label>
              <input
                type="radio"
                name="reconciled-mode"
                checked={mode === "range"}
                onChange={() => setMode("range")}
              />
              Диапазон
            </label>
          </fieldset>
          {mode === "date" ? (
            <div className="arrivals-date-inputs">
              <label htmlFor="arrivals-reconciled-on">Дата сверки</label>
              <input
                id="arrivals-reconciled-on"
                type="date"
                value={draft.on}
                onChange={(event) => setDraft({ ...draft, on: event.target.value })}
              />
            </div>
          ) : (
            <div className="arrivals-date-inputs">
              <label htmlFor="arrivals-reconciled-from">С</label>
              <input
                id="arrivals-reconciled-from"
                type="datetime-local"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
              <label htmlFor="arrivals-reconciled-to">По</label>
              <input
                id="arrivals-reconciled-to"
                type="datetime-local"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </div>
          )}
          {error !== "" ? (
            <p className="arrivals-date-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="arrivals-date-actions">
            <button type="button" className="arrivals-date-secondary" onClick={reset}>
              Сбросить
            </button>
            <button type="button" className="arrivals-date-primary" onClick={apply}>
              Применить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
