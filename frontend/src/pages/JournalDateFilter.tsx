/**
 * JournalDateFilter (ТЗ DR47 §2.3.3): the «Период обращения» filter of the
 * journal — ONE trigger button with a summary and a popover offering three
 * modes (Дата / Дата и время / Диапазон). The entered values travel to the
 * URL state through ``onChange`` on «Применить»; «Сбросить» clears them.
 * The popover closes on Escape and an outside click (both return the focus
 * to the trigger). The Moscow half-open boundaries are computed by the page.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/ui/Icon";

export type JournalDateMode = "date" | "datetime" | "range";

export interface JournalDateValue {
  mode: JournalDateMode;
  date: string;
  moment: string;
  from: string;
  to: string;
}

export const emptyJournalDate: JournalDateValue = {
  mode: "date",
  date: "",
  moment: "",
  from: "",
  to: "",
};

const MODE_LABELS: Readonly<Record<JournalDateMode, string>> = Object.freeze({
  date: "Дата",
  datetime: "Дата и время",
  range: "Диапазон",
});

/** The day-first Russian date of an ISO date/datetime-local part. */
function ruDay(isoDate: string): string {
  const [year = "", month = "", day = ""] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/** The minute part of a datetime-local value. */
function ruMinutes(moment: string): string {
  return moment.slice(11, 16);
}

/** The trigger summary of the current value (the exact macro wording). */
export function journalDateSummary(value: JournalDateValue): string {
  const rangeValue = [value.from, value.to]
    .map((moment) => (moment === "" ? null : `${ruDay(moment.slice(0, 10))} ${ruMinutes(moment)}`.trim()))
    .filter((part) => part !== null)
    .join(" — ");
  if (value.mode === "date" && value.date !== "") {
    return `Дата: ${ruDay(value.date)}`;
  }
  if (value.mode === "datetime" && value.moment !== "") {
    return `Дата и время: ${ruDay(value.moment.slice(0, 10))} ${ruMinutes(value.moment)}`;
  }
  if (value.mode === "range" && rangeValue !== "") {
    return rangeValue;
  }
  return "Любая дата";
}

function normalize(value: JournalDateValue): JournalDateValue {
  return {
    mode: value.mode,
    date: value.date.trim(),
    moment: value.moment.trim(),
    from: value.from.trim(),
    to: value.to.trim(),
  };
}

export function JournalDateFilter({
  value,
  onChange,
}: {
  value: JournalDateValue;
  onChange: (next: JournalDateValue) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JournalDateValue>(value);
  const [error, setError] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleOpen = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    // Opening always drafts the committed value (URL state), never a stale
    // half-entered edit from the previous session.
    setDraft(value);
    setError("");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (filterRef.current !== null && !filterRef.current.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  };

  const apply = (): void => {
    const next = normalize(draft);
    if (next.mode === "range" && next.from !== "" && next.to !== "" && next.from > next.to) {
      // ТЗ DR47 §2.3.3: an invalid range is never sent — the Russian inline
      // error keeps the popover open with the entered values.
      setError("Начало диапазона не может быть позже конца.");
      return;
    }
    setError("");
    onChange(next);
    close(true);
  };

  const reset = (): void => {
    setDraft({ ...emptyJournalDate, mode: draft.mode });
    setError("");
    onChange({ ...emptyJournalDate, mode: draft.mode });
    close(true);
  };

  const summary = journalDateSummary(value);

  return (
    <div className="vse-journal-date-filter" ref={filterRef}>
      <button
        ref={triggerRef}
        type="button"
        className="vse-journal-date-trigger"
        aria-label={`Период обращения: ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <span>{summary}</span>
        <Icon name="calendar" />
      </button>
      {open ? (
        <div className="vse-journal-date-popover" role="dialog" aria-label="Период обращения">
          <div className="vse-journal-date-modes" aria-label="Режим выбора периода">
            {(Object.keys(MODE_LABELS) as JournalDateMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.mode === mode}
                onClick={() => setDraft({ ...draft, mode })}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          {draft.mode === "date" ? (
            <div className="vse-journal-filter-field">
              <label htmlFor="journal-date-only">Дата</label>
              <input
                id="journal-date-only"
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </div>
          ) : null}
          {draft.mode === "datetime" ? (
            <div className="vse-journal-filter-field">
              <label htmlFor="journal-date-moment">Дата и время</label>
              <input
                id="journal-date-moment"
                type="datetime-local"
                value={draft.moment}
                onChange={(event) => setDraft({ ...draft, moment: event.target.value })}
              />
            </div>
          ) : null}
          {draft.mode === "range" ? (
            <>
              <div className="vse-journal-filter-field">
                <label htmlFor="journal-date-from">С</label>
                <input
                  id="journal-date-from"
                  type="datetime-local"
                  value={draft.from}
                  onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                />
              </div>
              <div className="vse-journal-filter-field">
                <label htmlFor="journal-date-to">По</label>
                <input
                  id="journal-date-to"
                  type="datetime-local"
                  value={draft.to}
                  onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                />
              </div>
              {error !== "" ? (
                <p className="app-field-message app-field-error" aria-live="polite">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          <div className="vse-journal-date-actions">
            <button type="button" className="vse-journal-date-secondary" onClick={reset}>
              Сбросить
            </button>
            <button type="button" className="vse-journal-date-primary" onClick={apply}>
              Применить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
