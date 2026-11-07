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
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable";
import { snapshotProduct, type CollectionView, type DisposalView } from "./api";

const COLUMNS: readonly DataTableColumn[] = [
  { id: "disposed_on", header: "Дата утилизации" },
  { id: "product", header: "Вид продукции" },
  { id: "mass", header: "Вес, кг" },
  { id: "number", header: "Номер исходящей эВСД" },
  { id: "actor", header: "Провёл (идентификатор)" },
];

export interface DisposalHistoryProps {
  items: DisposalView[] | null;
  collections: readonly CollectionView[];
  total: number;
  page: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

export function DisposalHistory({
  items,
  collections,
  total,
  page,
  loading,
  onPageChange,
}: DisposalHistoryProps): React.ReactElement {
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="vse-samples-block" aria-label="История утилизации">
      <h2>История утилизации</h2>
      <DataTable
        caption="Утилизации за выбранный период (неизменяемые факты)"
        columns={COLUMNS}
        loading={loading}
        emptyMessage="За выбранный период утилизаций нет."
        rows={(items ?? []).map((item) => ({
          id: item.id,
          cells: [
            { columnId: "disposed_on", value: item.disposed_on },
            {
              columnId: "product",
              value: speciesLabel(item.product_species_id, collections),
            },
            { columnId: "mass", value: item.mass_kg },
            { columnId: "number", value: item.external_vsd_number },
            { columnId: "actor", value: item.actor_id },
          ],
        }))}
      />
      {pages > 1 ? (
        <nav className="vse-pagination" aria-label="Страницы истории утилизации">
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
      <p className="vse-samples-note app-field-message">
        История утилизаций не изменяется и не содержит правок. Ссылка на ВСЭ появляется только когда она
        доступна; ссылка на удалённую ВСЭ никогда не открывает протокол.
      </p>
    </section>
  );
}

/** The known species name of a disposal from the collection snapshots; the
 * honest identifier otherwise. */
function speciesLabel(speciesId: string, collections: readonly CollectionView[]): string {
  const match = collections.find((item) => item.product_species_id === speciesId);
  return match !== undefined ? snapshotProduct(match) : speciesId;
}
