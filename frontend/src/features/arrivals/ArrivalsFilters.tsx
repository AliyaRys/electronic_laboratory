/**
 * Per-stage filter panels (DR3, spec 8). Only server-supported controls are
 * functional: search (q) on every stage and the queue result filter on
 * «Завершенные» (the only queue the GET /arrivals endpoint filters by
 * result). The column chooser (spec 12.3) is a session-only display
 * preference of the accepted table. No «Найти» button: the search applies on
 * Enter and after a 300 ms debounce, and every change resets the page.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { RESULT_LABELS, type ArrivalResult } from "./api";

const SEARCH_PLACEHOLDER = "Номер эВСД, хозяйство, продукция или ТС";
const DEBOUNCE_MS = 300;

export interface ArrivalsFiltersProps {
  /** Current committed search value (from the URL). */
  q: string;
  onSearch: (q: string) => void;
  /** Server-supported result filter of the accepted queue. */
  result?: string | undefined;
  onResultChange?: ((result: string) => void) | undefined;
  /** Column chooser of the accepted queue (session-only preference). */
  columns?: React.ReactNode;
}

export function ArrivalsFilters({
  q,
  onSearch,
  result,
  onResultChange,
  columns,
}: ArrivalsFiltersProps): React.ReactElement {
  const [value, setValue] = useState(q);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const apply = (next: string): void => {
    setValue(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSearch(next), DEBOUNCE_MS);
  };
  const applyNow = (next: string): void => {
    setValue(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    onSearch(next);
  };

  return (
    <section className="arrivals-filters" aria-label="Фильтры поступлений">
      <div className="arrivals-filters-row">
        <div className="arrivals-filter-field arrivals-search">
          <label htmlFor="arrivals-q">Поиск</label>
          <input
            id="arrivals-q"
            type="text"
            value={value}
            onChange={(event) => apply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyNow(value);
              }
            }}
            placeholder={SEARCH_PLACEHOLDER}
          />
          {value !== "" ? (
            <button
              type="button"
              className="arrivals-search-clear"
              aria-label="Очистить поиск"
              onClick={() => applyNow("")}
            >
              <Icon name="admin-clear" />
            </button>
          ) : null}
        </div>
        {result !== undefined && onResultChange !== undefined ? (
          <div className="arrivals-filter-field">
            <label htmlFor="arrivals-result">Результат</label>
            <select
              id="arrivals-result"
              value={result}
              onChange={(event) => onResultChange(event.target.value)}
            >
              <option value="">Все результаты</option>
              {(Object.keys(RESULT_LABELS) as ArrivalResult[]).map((key) => (
                <option key={key} value={key}>
                  {RESULT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {columns}
      </div>
    </section>
  );
}

// --- 12.3 column chooser popover ---------------------------------------------------

export interface ColumnsChooserProps {
  options: readonly { id: string; label: string }[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Story/variant helper: render with the popover already open. */
  initialOpen?: boolean | undefined;
}

export function ColumnsChooser({
  options,
  hidden,
  onToggle,
  initialOpen = false,
}: ColumnsChooserProps): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      className="arrivals-filter-field arrivals-columns"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <span className="arrivals-filter-label">Столбцы</span>
      <button
        ref={triggerRef}
        type="button"
        className="arrivals-columns-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Выбрать столбцы таблицы"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="columns-grid" />
        <span>Выбрать столбцы</span>
      </button>
      {open ? (
        <div className="arrivals-columns-popover" role="group" aria-label="Столбцы таблицы">
          <div className="arrivals-columns-title">Столбцы таблицы</div>
          <fieldset>
            {options.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={!hidden.has(option.id)}
                  onChange={() => onToggle(option.id)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
