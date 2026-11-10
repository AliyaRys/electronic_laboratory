/**
 * ArrivalList (UI-03): the queue table of one laboratory. The list is
 * presentational — queue/result filters, search and paging belong to the page
 * that owns the URL state. Rows navigate by the REAL party id to the
 * reconciliation route (A02 renders a clearly marked placeholder there). The
 * last column carries the explicit «Сверить» action («Перейти к сверке данных»)
 * next to the row menu for every queue the party appears in.
 */
import { DataTable, type DataTableRow } from "../../shared/ui/DataTable";
import { QUEUE_LABELS, type IncomingView } from "./api";

const COLUMNS = [
  { id: "product", header: "Продукция" },
  { id: "document", header: "Документ" },
  { id: "sender", header: "Отправитель" },
  { id: "quantity", header: "Количество / масса" },
  { id: "queue", header: "Очередь" },
] as const;

export interface ArrivalListProps {
  /** Laboratory id of the current URL context (canonical navigation). */
  labId: string;
  items: readonly IncomingView[];
  /** Party ids the user can hide (expected arrivals only). */
  onHide?: (partyId: string) => void;
}

function quantityText(view: IncomingView): string {
  const { quantity, mass_kg: mass } = view.documentary;
  return `${quantity} / ${mass} кг`;
}

function reconciliationHref(labId: string, view: IncomingView): string {
  return `/labs/${labId}/arrivals/${view.party_id}/reconciliation`;
}

export function ArrivalList({ labId, items, onHide }: ArrivalListProps): React.ReactElement {
  const rows: DataTableRow[] = items.map((view) => {
    const row: DataTableRow = {
      id: view.party_id,
      href: reconciliationHref(labId, view),
      // Explicit action in the last column (spec: явный переход к сверке);
      // visible short label, full accessible name, real party id in the URL.
      rowAction: {
        href: reconciliationHref(labId, view),
        label: "Сверить",
        accessibleName: "Перейти к сверке данных",
      },
      cells: [
        { columnId: "product", value: view.classification.product.name ?? "Продукция не определена" },
        { columnId: "document", value: view.external.fields.documentNumber ?? "" },
        { columnId: "sender", value: view.external.fields.consignor ?? "" },
        { columnId: "quantity", value: quantityText(view) },
        { columnId: "queue", value: QUEUE_LABELS[view.queue] },
      ],
    };
    if (onHide !== undefined && view.queue === "EXPECTED" && view.confirmation === null) {
      row.menu = [{ id: "hide", label: "Скрыть из очереди" }];
    }
    return row;
  });

  return (
    <DataTable
      caption="Поступления лаборатории"
      columns={COLUMNS}
      rows={rows}
      onMenuAction={(_event, rowId, actionId) => {
        if (actionId === "hide") onHide?.(rowId);
      }}
    />
  );
}
