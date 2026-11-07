/**
 * Collections (API-06, S03): the page of the available (not disposed)
 * physical collection facts of one laboratory. Every fact is readonly —
 * corrections happen through the allowed card edit, never here.
 */
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable";
import { snapshotProduct, type CollectionView } from "./api";

const COLUMNS: readonly DataTableColumn[] = [
  { id: "product", header: "Вид продукции" },
  { id: "collected_on", header: "Дата отбора" },
  { id: "mass", header: "Вес, кг" },
  { id: "party", header: "Партия (идентификатор)" },
  { id: "author", header: "Отобрал (идентификатор)" },
];

export interface CollectionsProps {
  items: readonly CollectionView[] | null;
  total: number;
  loading: boolean;
  page: number;
  onPageChange: (page: number) => void;
}

export function Collections({
  items,
  total,
  loading,
  page,
  onPageChange,
}: CollectionsProps): React.ReactElement {
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="vse-samples-block" aria-label="Доступные отборы">
      <h2>Доступные отборы</h2>
      <DataTable
        caption="Доступные (не утилизированные) физические факты отбора"
        columns={COLUMNS}
        loading={loading}
        emptyMessage="Доступных отборов нет."
        rows={(items ?? []).map((item) => ({
          id: item.id,
          cells: [
            { columnId: "product", value: snapshotProduct(item) },
            { columnId: "collected_on", value: item.collected_on },
            { columnId: "mass", value: item.mass_kg },
            { columnId: "party", value: item.party_id },
            { columnId: "author", value: item.collected_by },
          ],
        }))}
      />
      {pages > 1 ? (
        <nav className="vse-pagination" aria-label="Страницы списка отборов">
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
