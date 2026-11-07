/**
 * Balances (API-06, S03): the live remainder of one laboratory per species.
 *
 * The shown weight is readonly — it comes from the server read model and the
 * user never edits it (there is no weight input on the balance). The disposal
 * of one basket is started from the row menu and only for roles allowed to
 * dispose (ANALYST is read-only and sees no disposal affordance at all).
 */
import { DataTable, type DataTableColumn, type DataTableRow } from "../../shared/ui/DataTable";
import type { BalanceView, Problem } from "./api";

const COLUMNS: readonly DataTableColumn[] = [
  { id: "species", header: "Вид продукции (идентификатор)" },
  { id: "mass", header: "Остаток, кг" },
  { id: "revision", header: "Ревизия" },
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
              { columnId: "species", value: balance.product_species_id },
              { columnId: "mass", value: balance.mass_kg },
              { columnId: "revision", value: String(balance.revision) },
            ],
          };
          if (canDispose) {
            row.menu = [{ id: "dispose", label: "Утилизировать остаток" }];
          }
          return row;
        })}
        onMenuAction={(_event, rowId, actionId) => {
          if (actionId !== "dispose") return;
          const target = balances.find((item) => item.product_species_id === rowId);
          if (target !== undefined) onDispose(target);
        }}
      />
      <p className="vse-samples-note app-field-message">
        Остаток показывается только для чтения; его изменяют отбор пробы и полная утилизация.
      </p>
    </section>
  );
}

/** Shared problem mapper of the accounting screen (StatusView state). */
export function problemState(problem: Problem): "forbidden" | "network-error" {
  return problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error";
}
