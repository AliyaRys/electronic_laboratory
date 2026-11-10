/**
 * The three arrival queue tables (DR3, spec 10–12): per-stage columns and
 * actions on the ONE shared DataTable primitive (variant "arrivals"). Only
 * real read-model fields are shown; data the API does not provide renders
 * «—» and is reported as an API-gap — nothing is computed or fabricated on
 * the client.
 */
import { DataTable, type DataTableColumn, type DataTableRow } from "../../shared/ui/DataTable";
import { Icon } from "../../shared/ui/Icon";
import { STAGE_EMPTY_TEXTS, type IncomingView } from "./api";

export function formatRuDateTime(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** First non-empty string of the real source values, otherwise «—». */
function first(...keys: (string | null | undefined)[]): string {
  for (const key of keys) {
    if (typeof key === "string" && key.trim() !== "") return key;
  }
  return "—";
}

/** Sender side = «Хозяйство» of the mockups (real eVSD consignor). */
function hostText(view: IncomingView): string {
  return first(view.external.fields.consignor, view.external.fields.senderEnterprise);
}

function productText(view: IncomingView): string {
  return view.classification.product?.name ?? "Продукция не определена";
}

function massText(view: IncomingView): string {
  const mass = view.documentary.mass_kg;
  return mass !== "" && mass !== null && mass !== undefined ? `${mass} кг` : "—";
}

function quantityText(view: IncomingView): string {
  return view.documentary.quantity !== "" ? view.documentary.quantity : "—";
}

function vehicleText(view: IncomingView): string {
  return first(view.external.fields.transportNumber, view.external.fields.vehicleNumber);
}

/** Confirmed reconciliation date — the only real «дата сверки» fact. */
function reconciliationDate(view: IncomingView): string {
  return formatRuDateTime(view.confirmation?.confirmed_at);
}

function reconciliationHref(labId: string, view: IncomingView): string {
  return `/labs/${labId}/arrivals/${view.party_id}/reconciliation`;
}

function examinationHref(labId: string, view: IncomingView): string {
  return `/labs/${labId}/arrivals/${view.party_id}/examination/new`;
}

// --- 10 «Ожидаемые» ---------------------------------------------------------------

const EXPECTED_COLUMNS: readonly DataTableColumn[] = [
  { id: "date", header: "Дата создания ВСД" },
  { id: "number", header: "Номер эВСД" },
  { id: "host", header: "Хозяйство" },
  { id: "product", header: "Вид продукции" },
  { id: "mass", header: "Объём / масса" },
  { id: "quantity", header: "Количество" },
  { id: "vehicle", header: "ТС" },
];

export interface ExpectedArrivalsTableProps {
  labId: string;
  items: readonly IncomingView[];
  onHide?: ((partyId: string) => void) | undefined;
}

export function ExpectedArrivalsTable({
  labId,
  items,
  onHide,
}: ExpectedArrivalsTableProps): React.ReactElement {
  const rows: DataTableRow[] = items.map((view) => {
    const canHide = view.queue === "EXPECTED" && view.confirmation === null;
    return {
      id: view.party_id,
      href: reconciliationHref(labId, view),
      cells: [
        { columnId: "date", value: formatRuDateTime(first(view.external.fields.issuedOn)) },
        { columnId: "number", value: first(view.external.fields.documentNumber) },
        { columnId: "host", value: hostText(view) },
        { columnId: "product", value: productText(view) },
        { columnId: "mass", value: massText(view) },
        { columnId: "quantity", value: quantityText(view) },
        { columnId: "vehicle", value: vehicleText(view) },
      ],
      rowAction: {
        href: reconciliationHref(labId, view),
        label: "Сверить",
        accessibleName: "Перейти к сверке данных",
        icon: "arrival-reconcile",
      },
      actions:
        canHide && onHide !== undefined ? (
          <button
            type="button"
            className="arrivals-icon-action danger"
            aria-label="Скрыть поступление из очереди"
            title="Скрыть поступление из очереди"
            onClick={() => onHide(view.party_id)}
          >
            <Icon name="admin-delete" />
          </button>
        ) : null,
    };
  });
  return (
    <DataTable
      caption="Ожидаемые поступления"
      columns={EXPECTED_COLUMNS}
      rows={rows}
      variant="arrivals"
      visuallyHiddenCaption
      emptyMessage={STAGE_EMPTY_TEXTS.EXPECTED}
    />
  );
}

// --- 11 «В работе» -----------------------------------------------------------------

const WORK_COLUMNS: readonly DataTableColumn[] = [
  { id: "date", header: "Дата сверки данных" },
  { id: "number", header: "Номер эВСД" },
  { id: "host", header: "Хозяйство" },
  { id: "product", header: "Вид продукции" },
  { id: "mass", header: "Объём / масса" },
  { id: "quantity", header: "Количество" },
  { id: "cost", header: "Стоимость сверки" },
  { id: "author", header: "Автор сверки данных" },
];

export interface WorkArrivalsTableProps {
  labId: string;
  items: readonly IncomingView[];
  /**
   * Parties with an unfinished draft (server fact). The read model does not
   * expose this yet (API-gap): the working page never passes it, the state
   * is exercised in stories only.
   */
  draftPartyIds?: ReadonlySet<string> | undefined;
}

export function WorkArrivalsTable({
  labId,
  items,
  draftPartyIds,
}: WorkArrivalsTableProps): React.ReactElement {
  const rows: DataTableRow[] = items.map((view) => {
    const isDraft = draftPartyIds?.has(view.party_id) === true;
    return {
      id: view.party_id,
      href: reconciliationHref(labId, view),
      className: isDraft ? "app-row-draft" : undefined,
      cells: [
        { columnId: "date", value: reconciliationDate(view) },
        { columnId: "number", value: first(view.external.fields.documentNumber) },
        { columnId: "host", value: hostText(view) },
        { columnId: "product", value: productText(view) },
        { columnId: "mass", value: massText(view) },
        { columnId: "quantity", value: quantityText(view) },
        // API-gap: the read model carries no reconciliation cost/author.
        { columnId: "cost", value: "—" },
        { columnId: "author", value: "—" },
      ],
      actions: isDraft ? (
        <a
          className="arrivals-icon-action"
          href={examinationHref(labId, view)}
          aria-label="Продолжить создание ВСЭ"
          title="Продолжить создание ВСЭ"
        >
          <Icon name="admin-edit" />
        </a>
      ) : (
        <a
          className="arrivals-icon-action primary"
          href={examinationHref(labId, view)}
          aria-label="Создать ВСЭ"
          title="Создать ВСЭ"
        >
          <Icon name="arrival-plus" />
        </a>
      ),
    };
  });
  return (
    <DataTable
      caption="Поступления в работе"
      columns={WORK_COLUMNS}
      rows={rows}
      variant="arrivals"
      visuallyHiddenCaption
      emptyMessage={STAGE_EMPTY_TEXTS.WORK}
    />
  );
}

// --- 12 «Завершенные» ---------------------------------------------------------------

const ACCEPTED_CORE_COLUMNS: readonly DataTableColumn[] = [
  { id: "date", header: "Дата сверки данных" },
  { id: "number", header: "Номер эВСД" },
  { id: "host", header: "Хозяйство" },
  { id: "product", header: "Вид продукции" },
  { id: "mass", header: "Объём / масса" },
  { id: "status", header: "Статус ВСД" },
  { id: "vse", header: "ВСЭ" },
  { id: "cost", header: "Стоимость" },
  { id: "deadline", header: "Срок реализации" },
];

const ACCEPTED_OPTIONAL_COLUMNS: readonly DataTableColumn[] = [
  { id: "checkAuthor", header: "Автор сверки данных" },
  { id: "vseAuthor", header: "Автор ВСЭ" },
  { id: "vseNumber", header: "Номер ВСЭ" },
];

export const ACCEPTED_OPTIONAL_COLUMN_IDS: readonly string[] = ACCEPTED_OPTIONAL_COLUMNS.map(
  (column) => column.id,
);

export interface CompletedArrivalsTableProps {
  labId: string;
  items: readonly IncomingView[];
  /** Optional column ids hidden by the user's session column chooser. */
  hiddenColumns: ReadonlySet<string>;
}

export function CompletedArrivalsTable({
  labId,
  items,
  hiddenColumns,
}: CompletedArrivalsTableProps): React.ReactElement {
  const columns: readonly DataTableColumn[] = [
    ...ACCEPTED_CORE_COLUMNS,
    ...ACCEPTED_OPTIONAL_COLUMNS.filter((column) => !hiddenColumns.has(column.id)),
  ];
  const rows: DataTableRow[] = items.map((view) => ({
    id: view.party_id,
    href: reconciliationHref(labId, view),
    cells: [
      { columnId: "date", value: reconciliationDate(view) },
      { columnId: "number", value: first(view.external.fields.documentNumber) },
      { columnId: "host", value: hostText(view) },
      { columnId: "product", value: productText(view) },
      { columnId: "mass", value: massText(view) },
      // API-gap: no human-readable ВетИС status label / ВСЭ result in the
      // read model — the queue is never presented as a veterinary result.
      { columnId: "status", value: "—" },
      { columnId: "vse", value: "—" },
      { columnId: "cost", value: "—" },
      { columnId: "deadline", value: "—" },
      { columnId: "checkAuthor", value: "—" },
      { columnId: "vseAuthor", value: "—" },
      { columnId: "vseNumber", value: "—" },
    ],
    actions:
      view.examination_id !== null ? (
        <a
          className="arrivals-icon-action compact"
          href={`/labs/${labId}/examinations/${view.examination_id}`}
          aria-label="Открыть карточку ВСЭ"
          title="Открыть карточку ВСЭ"
        >
          <Icon name="admin-view" />
        </a>
      ) : null,
  }));
  return (
    <DataTable
      caption="Завершенные поступления"
      columns={columns}
      rows={rows}
      variant="arrivals"
      visuallyHiddenCaption
      emptyMessage={STAGE_EMPTY_TEXTS.ACCEPTED}
    />
  );
}
