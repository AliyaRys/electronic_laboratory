/**
 * Working data table (UI-03). Rows carry an explicit link in the leading cell;
 * the row action menu is a plain button — it never wraps or triggers the row
 * navigation. Long values wrap (overflow-wrap: anywhere), so the full value
 * stays readable and reachable by keyboard/screen-reader users without hover;
 * horizontal scroll happens inside the table, never the page.
 *
 * Public row action (``DataTableRow.rowAction``): an optional separate link in
 * the actions column. It has its own visible label and full accessible name,
 * works by mouse, Enter and sequential Tab focus, and coexists with the row
 * menu without opening or triggering it. It renders even for rows without a
 * menu. When set for a canonical destination, it duplicates the leading-cell
 * link deliberately so the destination is discoverable as an explicit action.
 */
import "./ui.css";
import { useEffect, useId, useRef, useState } from "react";
import { StatusView } from "./StatusView";

export interface DataTableColumn {
  id: string;
  header: string;
}

export interface DataTableCell {
  columnId: string;
  value: string;
}

export interface DataTableRowAction {
  href: string;
  /** Visible short label of the link action («Сверить»). */
  label: string;
  /** Full accessible name (e.g. «Перейти к сверке данных»). */
  accessibleName: string;
}

export interface DataTableRow {
  id: string;
  /** Canonical navigation of the row: a real link in the leading cell. */
  href?: string;
  cells: DataTableCell[];
  /**
   * Explicit link action in the actions column, next to the row menu. It is a
   * separate navigation element: it never opens or triggers the menu, and it
   * is rendered even when the row has no menu.
   */
  rowAction?: DataTableRowAction;
  menu?: { id: string; label: string }[];
}

export interface DataTableProps {
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** Shared loading state instead of an empty table shell. */
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  onMenuAction?: (event: React.MouseEvent<HTMLButtonElement>, rowId: string, actionId: string) => void;
}

function RowMenu({
  row,
  onAction,
}: {
  row: DataTableRow;
  onAction?: DataTableProps["onMenuAction"];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const label = "Действия со строкой";
  return (
    <div
      className="app-table-actions"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
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
        className="app-table-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open ? (
        <ul className="app-table-menu" role="menu" aria-label={label}>
          {(row.menu ?? []).map((action) => (
            <li key={action.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  // No navigation semantics here: the row link stays separate.
                  setOpen(false);
                  onAction?.(event, row.id, action.id);
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DataTable({
  caption,
  columns,
  rows,
  loading = false,
  loadingMessage = "Загрузка…",
  emptyMessage = "Пока ничего нет.",
  onMenuAction,
}: DataTableProps): React.ReactElement {
  const menuId = useId();
  if (loading) {
    return <StatusView state="loading" title={loadingMessage} />;
  }
  if (rows.length === 0) {
    return <StatusView state="no-match" title={emptyMessage} />;
  }
  return (
    <div className="app-table-scroll">
      <table className="app-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
            <th scope="col">
              <span className="visually-hidden">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => {
                const cell = row.cells.find((entry) => entry.columnId === column.id);
                const text = cell?.value ?? "—";
                const isFirst = column.id === columns[0].id;
                return (
                  <td key={column.id}>
                    {isFirst && row.href !== undefined ? <a href={row.href}>{text}</a> : text}
                  </td>
                );
              })}
              <td>
                <div className="app-table-row-actions">
                  {row.rowAction !== undefined ? (
                    <a
                      className="app-table-row-action"
                      href={row.rowAction.href}
                      aria-label={row.rowAction.accessibleName}
                    >
                      {row.rowAction.label}
                    </a>
                  ) : null}
                  {row.menu !== undefined ? (
                    <RowMenu key={`menu-${menuId}`} row={row} onAction={onMenuAction} />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
