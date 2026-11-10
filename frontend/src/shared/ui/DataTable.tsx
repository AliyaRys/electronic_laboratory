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
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { StatusView } from "./StatusView";

export interface DataTableColumn {
  id: string;
  header: string;
}

export interface DataTableCell {
  columnId: string;
  value: string;
  /**
   * Optional renderer override (named variant of the shared primitive): when
   * set it replaces the plain text value in that cell. The ``value`` stays
   * the accessible fallback. Other tables keep working unchanged.
   */
  node?: ReactNode;
}

export interface DataTableRowAction {
  href: string;
  /** Visible short label of the link action («Сверить»). */
  label: string;
  /** Full accessible name (e.g. «Перейти к сверке данных»). */
  accessibleName: string;
  /** Registry icon; renders the action as a compact icon link. */
  icon?: IconName | undefined;
  /** Tone class of the icon action ("neutral" | "danger"). */
  tone?: "neutral" | "danger" | undefined;
}

export interface DataTableRow {
  id: string;
  /** Canonical navigation of the row: a real link in the leading cell. */
  href?: string;
  cells: DataTableCell[];
  /** Row tone class (e.g. the light-gray draft row). */
  className?: string | undefined;
  /**
   * Explicit link action in the actions column, next to the row menu. It is a
   * separate navigation element: it never opens or triggers the menu, and it
   * is rendered even when the row has no menu.
   */
  rowAction?: DataTableRowAction;
  /** Extra icon actions rendered in the actions column (renderers variant). */
  actions?: ReactNode;
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
  /** Named geometry variant applied on the scroller (arrivals queue tables). */
  variant?: "default" | "arrivals" | undefined;
  /** Keep the caption but hide it visually (mockups show no visible caption). */
  visuallyHiddenCaption?: boolean | undefined;
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
  variant = "default",
  visuallyHiddenCaption = false,
}: DataTableProps): React.ReactElement {
  const menuId = useId();
  if (loading) {
    return <StatusView state="loading" title={loadingMessage} />;
  }
  if (rows.length === 0) {
    return <StatusView state="no-match" title={emptyMessage} />;
  }
  return (
    <div className={`app-table-scroll${variant !== "default" ? ` app-table-${variant}` : ""}`}>
      <table className={`app-table${variant !== "default" ? ` app-table-${variant}` : ""}`}>
        {visuallyHiddenCaption ? (
          <caption className="visually-hidden">{caption}</caption>
        ) : (
          <caption>{caption}</caption>
        )}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
            <th scope="col" className="app-table-column-actions">
              <span className="visually-hidden">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.className}>
              {columns.map((column) => {
                const cell = row.cells.find((entry) => entry.columnId === column.id);
                const isFirst = column.id === columns[0].id;
                const text = cell?.value ?? "—";
                const link = isFirst && row.href !== undefined ? <a href={row.href}>{text}</a> : text;
                return (
                  <td
                    key={column.id}
                    title={
                      variant === "arrivals" && !isFirst && typeof text === "string" && text !== ""
                        ? text
                        : undefined
                    }
                  >
                    {cell?.node !== undefined ? cell.node : link}
                  </td>
                );
              })}
              <td className="app-table-column-actions">
                <div className="app-table-row-actions">
                  {row.rowAction !== undefined ? <RowActionLink action={row.rowAction} /> : null}
                  {row.actions}
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

function RowActionLink({ action }: { action: DataTableRowAction }): React.ReactElement {
  if (action.icon !== undefined) {
    return (
      <a
        className={`app-table-icon-action${action.tone === "danger" ? " danger" : ""}`}
        href={action.href}
        aria-label={action.accessibleName}
        title={action.accessibleName}
      >
        <Icon name={action.icon} />
      </a>
    );
  }
  return (
    <a
      className="app-table-row-action"
      href={action.href}
      aria-label={action.accessibleName}
      title={action.accessibleName}
    >
      {action.label}
    </a>
  );
}
