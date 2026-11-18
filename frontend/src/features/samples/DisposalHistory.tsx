/**
 * DisposalHistory (API-06, S03): the immutable page of the full-disposal
 * facts with the period filter.
 *
 * The history is never editable: there are no edit/delete affordances and no
 * mutation routes exist (O-07). A link to a deleted ВСЭ must never open a
 * protocol — until E0x delivers the examination link data the row renders no
 * link at all (an honest inert value), and even a present-but-deleted
 * examination id renders a disabled, non-navigating link label.
 */
import type { ReactNode } from "react";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable";
import type { DisposalView } from "./api";
const COLUMNS: readonly DataTableColumn[] = [
  { id: "disposed_on", header: "Дата утилизации" },
  { id: "product", header: "Вид продукции" },
  { id: "mass", header: "Вес, кг" },
  { id: "number", header: "Номер исходящей эВСД" },
  { id: "actor", header: "Провёл" },
];

export interface DisposalHistoryProps {
  items: DisposalView[] | null;
  total: number;
  page: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  /** The period filter rendered right under the heading (DR48 §4.3). */
  filter?: ReactNode;
}

export function DisposalHistory({
  items,
  total,
  page,
  loading,
  onPageChange,
  filter,
}: DisposalHistoryProps): React.ReactElement {
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const headingId = "disposal-history-heading";
  return (
    <section className="vse-samples-block">
      <h2 id={headingId}>История утилизаций</h2>
      {filter}
      <DataTable
        // DR49 §5.2: the visible caption is gone; the table's accessible name
        // is the section heading via aria-labelledby — not a hidden caption.
        labelledBy={headingId}
        columns={COLUMNS}
        loading={loading}
        emptyMessage="За выбранный период утилизаций нет."
        rows={(items ?? []).map((item) => ({
          id: item.id,
          cells: [
            { columnId: "disposed_on", value: item.disposed_on },
            {
              // ТЗ DR45 §4: the server-resolved product name; the species id
              // is never shown and the name never depends on the current
              // collections page.
              columnId: "product",
              value: item.product_name ?? "Данные не найдены",
            },
            { columnId: "mass", value: item.mass_kg },
            { columnId: "number", value: item.external_vsd_number },
            { columnId: "actor", value: item.actor_name ?? "Данные не найдены" },
          ],
        }))}
      />
      {pages > 1 ? (        <nav className="vse-pagination" aria-label="Страницы истории утилизации">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            aria-label="Предыдущая страница"
          >
            ‹
          </button>
          <span>
            Страница {page} из {pages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages || loading}
            aria-label="Следующая страница"
          >
            ›
          </button>
        </nav>
      ) : null}
    </section>
  );
}
