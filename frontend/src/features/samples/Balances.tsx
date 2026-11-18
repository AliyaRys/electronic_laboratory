/**
 * Balances (API-06, S03): the live remainder of one laboratory per species.
 *
 * The shown weight is readonly — it comes from the server read model and the
 * user never edits it (there is no weight input on the balance). The disposal
 * of one basket is started by ONE direct icon action («Утилизировать остаток»,
 * DR48 §4.4) rendered through ``DataTableRow.actions`` — no row menu and no
 * empty ⋯ affordance. ANALYST is read-only: no disposal action is rendered at
 * all.
 */
import { DataTable, type DataTableColumn, type DataTableRow } from "../../shared/ui/DataTable";
import { Button } from "../../shared/ui/Button";
import type { BalanceView, Problem } from "./api";

const COLUMNS: readonly DataTableColumn[] = [
  { id: "species", header: "Вид продукции" },
  { id: "mass", header: "Остаток, кг" },
];

export interface BalancesProps {
  balances: readonly BalanceView[];
  loading: boolean;
  emptyMessage: string;
  /** ANALYST is read-only: no disposal affordance is rendered at all. */
  canDispose: boolean;
  onDispose: (balance: BalanceView) => void;
}

export function Balances({
  balances,
  loading,
  emptyMessage,
  canDispose,
  onDispose,
}: BalancesProps): React.ReactElement {
  return (
    <section className="vse-samples-block" aria-label="Остатки проб">
      <h2>Остатки проб</h2>
      <DataTable
        caption="Текущие остатки по видам продукции"
        columns={COLUMNS}
        loading={loading}
        emptyMessage={emptyMessage}
        rows={balances.map((balance): DataTableRow => {
          const row: DataTableRow = {
            id: balance.product_species_id,
            cells: [
              // ТЗ DR45 §4: the normalized display name; the raw species id
              // is never shown to the user (fallback: «Данные не найдены»).
              { columnId: "species", value: balance.product_name ?? "Данные не найдены" },
              { columnId: "mass", value: balance.mass_kg },
            ],
          };
          if (canDispose) {
            row.actions = (
              <Button
                type="button"
                variant="secondary"
                iconOnly
                icon="admin-dispose"
                label="Утилизировать остаток"
                onClick={() => onDispose(balance)}
              />
            );
          }
          return row;
        })}
      />
    </section>
  );
}

/** Shared problem mapper of the accounting screen (StatusView state). */
export function problemState(problem: Problem): "forbidden" | "network-error" {
  return problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error";
}
