/**
 * Arrivals read/hide/sync API (API-04) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. The sync command (ТЗ-10) accepts the SAME durable job the
 * 15-minute scheduler uses (202 SyncRun) and is polled through
 * GET /operations/:id — never treated as a sync confirmation.
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import { networkProblem, problemFromParsed, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

/** The accepted ru dateTime format of the project (kept for dateTime sources). */
export function formatRuDateTime(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Plain eVSD dates (``vd:issueDate`` = ``2026-11-03``) render as «03.11.2026»
 * WITHOUT any timezone shift and WITHOUT an invented time (ТЗ DR5 §7); a
 * source dateTime keeps the accepted project format.
 */
export function formatRuDate(value: string | null | undefined): string {
  if (typeof value !== "string") return "—";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`;
  return formatRuDateTime(value);
}

export type IncomingView = components["schemas"]["IncomingView"];
export type QuantitySet = components["schemas"]["QuantitySet"];

export type ArrivalQueue = "EXPECTED" | "WORK" | "ACCEPTED";
export type ArrivalResult = "WAITING" | "RETURNED" | "COMPLETED";
/** DR15 §5.2: the issue-date sort order of the EXPECTED queue. */
export type ArrivalSort = "asc" | "desc";

export interface ArrivalsQuery {
  laboratory_id: string;
  queue?: ArrivalQueue | null;
  result?: ArrivalResult | null;
  q?: string | null;
  page?: number;
  /** DR15 §5.2: sent only when the user picked a non-default order. */
  sort?: ArrivalSort | null;
}

export interface ArrivalsPage {
  items: IncomingView[];
  total: number;
  page: number;
  page_size: number;
}

/** Minimal openapi-fetch result shape (see features/identity/api.ts). */
interface RawResult<TData> {
  data?: TData;
  error?: unknown;
  response: Response;
}

/** Wrap a transport result into data-or-problem without losing the response. */
async function settle<TData>(
  promise: Promise<RawResult<TData>>,
): Promise<{ data: TData; response: Response } | { problem: Problem }> {
  try {
    const result = await promise;
    if (result.error !== undefined) {
      return { problem: problemFromParsed(result.error, result.response.status) };
    }
    return { data: result.data as TData, response: result.response };
  } catch (thrown) {
    return {
      problem: networkProblem(thrown instanceof Error ? thrown.message : "Сеть недоступна."),
    };
  }
}

/** Russian queue labels for the interface. */
export const QUEUE_LABELS: Readonly<Record<ArrivalQueue, string>> = Object.freeze({
  EXPECTED: "Ожидается",
  WORK: "В работе",
  ACCEPTED: "Принято",
});

/** Exact stage-tab titles of the approved mockups (never «Ожидается»/«Принято»). */
export const STAGE_LABELS: Readonly<Record<ArrivalQueue, string>> = Object.freeze({
  EXPECTED: "Ожидаемые",
  WORK: "В работе",
  ACCEPTED: "Завершенные",
});

/** Short stage explanations under the h1 (mockup wording, real lab context). */
export const STAGE_DESCRIPTIONS: Readonly<Record<ArrivalQueue, string>> = Object.freeze({
  EXPECTED: "Транспортные эВСД из системы «Меркурий», где получателем указана текущая лаборатория",
  WORK: "Партии с пройденной сверкой данных",
  ACCEPTED: "Завершенные партии: сверка завершена, ВСЭ проведена или подтверждена, можно оформить заключение",
});

/** Honest empty-state texts per stage (spec 14). */
export const STAGE_EMPTY_TEXTS: Readonly<Record<ArrivalQueue, string>> = Object.freeze({
  EXPECTED: "По заданным условиям эВСД не найдены",
  WORK: "По заданным условиям поступления в работе не найдены",
  ACCEPTED: "По заданным условиям завершенные поступления не найдены",
});

export const RESULT_LABELS: Readonly<Record<ArrivalResult, string>> = Object.freeze({
  WAITING: "Ожидание",
  RETURNED: "Возврат",
  COMPLETED: "Завершено",
});

/** ТЗ DR9 §4: the exact user text of the stale source-presence state. */
export const SOURCE_PRESENCE_STALE_TEXT = "ВСД больше не входит в текущую очередь оформленных документов.";

/** ТЗ DR9: true when the eVSD is absent from the current confirmed external list. */
export function isStaleSourcePresence(view: IncomingView): boolean {
  return view.source_presence === "NOT_IN_CURRENT_CONFIRMED_LIST";
}

/** API-04: the 202 SyncRun body (the accepted intent, never a confirmation). */
export interface SyncAccepted {
  operation_id: string;
  state: string;
  status_url: string;
}

/** API-01: the polled operation state of the accepted sync job. */
export interface SyncOperationState {
  id: string;
  kind: string;
  state: string;
  result_id?: string | null;
  problem?: string | null;
  updated_at?: string | null;
  /** DR7 §6.3 diagnostics: pages processed / documents imported / counters. */
  pages_done?: number | null;
  imported?: number | null;
  diagnostics?: { [key: string]: unknown } | null;
}

const SYNC_TERMINAL_STATES = new Set(["SUCCESS", "FAILED"]);

export async function syncArrivals(laboratoryId: string): Promise<SyncAccepted | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/arrivals/sync", {
      body: { laboratory_id: laboratoryId },
    }) as Promise<RawResult<SyncAccepted>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchOperationState(operationId: string): Promise<SyncOperationState | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/operations/{operation_id}", {
      params: { path: { operation_id: operationId } },
    }) as Promise<RawResult<SyncOperationState>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export function syncIsTerminal(state: SyncOperationState | Problem | undefined): boolean {
  return state !== undefined && "state" in state && SYNC_TERMINAL_STATES.has(state.state);
}

export async function fetchArrivals(
  query: ArrivalsQuery,
  signal?: AbortSignal | null,
): Promise<ArrivalsPage | Problem> {
  const params: Record<string, string | number | null | undefined> = {
    laboratory_id: query.laboratory_id,
    queue: query.queue ?? null,
    result: query.result ?? null,
    q: query.q ?? null,
    page: query.page ?? 1,
    // DR15 §6: only the explicitly chosen order is sent; the absent param
    // keeps the server default (desc = the newest issued ВСД first).
    sort: query.sort ?? null,
  };
  const settled = await settle(
    apiClient.GET("/api/v1/arrivals", {
      params: { query: params } as never,
      signal: signal ?? null,
    }) as Promise<RawResult<ArrivalsPage>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/**
 * Hide an expected arrival (204). Mutations follow SPEC-04: CSRF comes from
 * the transport middleware, the command needs an Idempotency-Key and the
 * If-Match of the shown party revision.
 */
export async function hideArrival(
  partyId: string,
  etag: string,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.DELETE("/api/v1/arrivals/{party_id}", {
      params: { path: { party_id: partyId } },
      headers: { "if-match": etag, "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<undefined>>,
  );
  return "problem" in settled ? settled.problem : null;
}

/** Russian labels of the two CHECK services: ONE wording across the catalog
 * editor, the backend snapshot, the reconciliation screen and the export. */
export const CHECK_SERVICE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  PRODUCT_IDENTIFICATION: "Идентификация продукции по наименованию и визуальным осмотром",
  TRANSPORT_INSPECTION: "Ветеринарно-санитарная оценка и идентификация транспорта",
});

/**
 * ТЗ DR11 §6: the money is a server decimal string — the screen formats the
 * display only (a comma separator), it never computes or alters a value.
 */
export function moneyLabel(value: string): string {
  return `${value.replace(".", ",")} ₽`;
}

/** The honest unit label of a pricing line: a source GUID stays a GUID
 * fallback, the lineage «service» default reads as one service. */
export function pricingUnitLabel(unitId: string): string {
  if (UNIT_GUID_RE.test(unitId)) return `Единица из ВСД (GUID: ${unitId})`;
  if (unitId === "service") return "1 услуга";
  return unitId;
}

/**
 * ТЗ DR11 §7: the user text of a server CONFIGURATION_MISSING — the exact
 * missing service is carried by the problem item path
 * (``performed.<SERVICE_CODE>``); the honest wording names it in Russian.
 */
export function configurationMissingText(problem: Problem): string {
  const item = problem.errors?.find(
    (entry) => typeof entry.path === "string" && entry.path.startsWith("performed."),
  );
  const code = typeof item?.path === "string" ? item.path.replace("performed.", "") : "";
  const service = code !== "" ? (CHECK_SERVICE_NAMES[code] ?? code) : "";
  return service !== ""
    ? `Расчёт остановлен: не хватает настройки для услуги «${service}».`
    : "Расчёт остановлен: не хватает настройки справочника платных услуг.";
}

/** `If-Match` wire form of the IncomingView party revision (SPEC-04). */
export function revisionEtag(view: IncomingView): string {
  return `"${view.revision}"`;
}

/**
 * `If-Match` wire form of the SHOWN reconciliation revision (SPEC-04/ТЗ DR13):
 * the empty OPEN view carries the parent party revision, a saved view its own
 * — always the exact value the PUT endpoint compares against.
 */
export function reconciliationEtag(view: ReconciliationView): string {
  return `"${view.revision}"`;
}

// --- Reconciliation (A02, API-04) -------------------------------------------------

export type ReconciliationView = components["schemas"]["ReconciliationView"];
export type ReconciliationWrite = components["schemas"]["ReconciliationWrite"];
export type PricingSnapshot = components["schemas"]["PricingSnapshot"];
export type PricingLine = PricingSnapshot["lines"][number];
export type Comparison = components["schemas"]["Comparison"];
export type ActPreview = components["schemas"]["ActPreview"];
export type Decision = NonNullable<ReconciliationView["decision"]>;
export type ReceiptProblemItem = components["schemas"]["ProblemItem"];
export type ReceiptContext = components["schemas"]["ReceiptContext"];
export type ReceiptPreview = components["schemas"]["ReceiptPreview"];
export type ReceiptAccepted = components["schemas"]["ReceiptAccepted"];
export type VetInspection = components["schemas"]["ReceiptPreviewRequest"]["vet_inspection"];

export const DECISIONS: readonly Decision[] = ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"];

export const DECISION_LABELS: Readonly<Record<Decision, string>> = Object.freeze({
  ACCEPT_ALL: "Полное гашение",
  PARTIAL: "Частичное гашение",
  RETURN_ALL: "Полный возврат",
});

/** «Принятие→RETURN_ALL убирает обещание акта, но не местные факты». */
export function decisionLabel(decision: string | null): string {
  return decision !== null && decision in DECISION_LABELS ? DECISION_LABELS[decision as Decision] : "";
}

/** The CHK comparison fields shown on the screen, in the block order of FT-ARR-03. */
export interface ComparedField {
  fieldId: string;
  /** Canonical reconciliation-section key (components/icons/README.md map). */
  block: "participants" | "transport" | "product" | "documents";
  label: string;
  source: string;
}

/** User-facing reconciliation section titles (mockup wording). */
export const CHECK_SECTION_TITLES: Readonly<Record<string, string>> = Object.freeze({
  document: "Документ",
  participants: "Участники перевозки",
  transport: "Ветеринарно-санитарная оценка и идентификация транспорта",
  product: "Идентификация продукции по наименованию и визуальным осмотром",
  documents: "Сопроводительные документы",
  priorVse: "Ранее проведённая ВСЭ",
  results: "Результаты сверки",
  invoice: "Расчёт стоимости услуг",
});

/** Short section subtitles under the titles (mockup wording). */
export const CHECK_SECTION_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  document: "Реквизиты транспортного эВСД и связанного контроля поставки.",
  participants: "Отправитель, получатель и площадки, указанные в эВСД.",
  transport: "Сведения о перевозке и транспортном средстве.",
  product: "Классификация, наименование, объём и ветеринарные характеристики партии.",
  documents: "Реквизиты транспортного документа партии.",
  priorVse:
    "Сведения из мероприятий с партией продукции: номер экспертизы, дата, организация и результат осмотра.",
  results: "Отметки сравнения, решение о приёмке и формируемые документы.",
  invoice: "Услуги по сверке партии и транспорта, их количество, тарифы и итоговая сумма.",
});

/** ТЗ DR8 §6.2: the exact Russian labels of the CHK-F35 reason dictionary. */
export const RETURN_REASON_CODES: readonly { code: string; label: string }[] = Object.freeze([
  { code: "DEFECTIVE_GOODS", label: "Брак / товар ненадлежащего качества" },
  { code: "PACKAGING_DAMAGE", label: "Нарушение целостности упаковки" },
  {
    code: "FOREIGN_MATERIAL_OR_SAFETY_VIOLATION",
    label: "Наличие посторонних включений / несоответствие безопасности",
  },
  {
    code: "LAB_TEST_MISMATCH",
    label: "Отсутствие, дублирование или несоответствие лабораторных исследований / ВСЭ",
  },
  { code: "PRODUCTION_VSD_ERROR", label: "Ошибки при оформлении производственного ВСД" },
  { code: "CRITICAL_EXPIRY_DATE", label: "Короткий / критический / истекающий остаточный срок годности" },
  { code: "MARKING_ISSUES", label: "Проблемы с маркировкой" },
  { code: "QUANTITY_DISCREPANCY", label: "Расхождение по количеству" },
  {
    code: "PRODUCT_DATE_MISMATCH",
    label: "Несоответствие даты выработки или срока годности в ВСД и на упаковке",
  },
  { code: "UNORDERED_PRODUCT", label: "Товар не по заявке / не заказывали / не по контракту" },
  { code: "WRONG_SPECIFICATION", label: "Пересорт (по наименованию, дате, партии, размеру и др.)" },
  { code: "CONSIGNOR_REJECTION", label: "Отказ торговой точки / покупателя" },
  { code: "CONTRACT_VIOLATION", label: "Нарушение условий поставки / договора" },
  { code: "OTHER_REASON", label: "Иное" },
]);

/** Russian label of a saved CHK-F35 code (old codes render with new labels). */
export function returnReasonLabel(code: string): string {
  return RETURN_REASON_CODES.find((item) => item.code === code)?.label ?? code;
}

/** The viewed CHK source projection of one arrival (informational + compared). */
export function comparedFields(view: IncomingView): ComparedField[] {
  const fields: ComparedField[] = [];
  const external = view.external.fields;
  const classification = view.classification;
  // The server projection names a field by its snapshot key; the mapping
  // tolerates both the CHK projection keys and the test fixtures so real
  // arrivals always surface their values (senderEnterprise/vehicleNumber).
  // A numeric projection value (CHK-F15 productType) is shown as its decimal
  // string — the honest source value, never an invented label.
  const source = (...keys: (string | number | null | undefined)[]): string | null | undefined => {
    for (const key of keys) {
      if (typeof key === "number") {
        return String(key);
      }
      if (typeof key === "string" && key !== "") {
        return key;
      }
    }
    return null;
  };
  const push = (
    fieldId: string,
    block: ComparedField["block"],
    label: string,
    source: string | null | undefined,
  ): void => {
    if (source !== null && source !== undefined && source !== "") {
      fields.push({ fieldId, block, label, source });
    }
  };
  push(
    "CHK-F05",
    "participants",
    "Отправитель — предприятие",
    source(external.consignor, external.senderEnterprise),
  );
  // CHK-F06/F08/F15 (ТЗ DR13): the backend FieldSpec marks senderOwner,
  // receiverOwner and productType as compared (inadmissible) grounds — the
  // frontend list mirrors the backend COMPARABLE_SPECS ids one-to-one; an
  // absent projection key stays absent (push omits it), never a fictitious
  // mark.
  push("CHK-F06", "participants", "Отправитель — владелец", source(external.senderOwner));
  push(
    "CHK-F07",
    "participants",
    "Получатель — предприятие",
    source(external.consignee, external.receiverEnterprise),
  );
  push("CHK-F08", "participants", "Получатель — владелец", source(external.receiverOwner));
  push("CHK-F09", "transport", "Вид транспорта", source(external.transportKind));
  push("CHK-F10", "transport", "Номер ТС", source(external.transportNumber, external.vehicleNumber));
  push("CHK-F11", "transport", "Номер прицепа", source(external.trailerNumber));
  push("CHK-F12", "transport", "Хранение", source(external.storage));
  push("CHK-F15", "product", "Тип продукции", source(classification.productType, external.productType));
  push("CHK-F16", "product", "Продукция", source(classification.product?.name, external.product));
  push("CHK-F17", "product", "Вид продукции", source(classification.subProduct?.name, external.species));
  push(
    "CHK-F18",
    "product",
    "Название продукции",
    source(classification.productItem?.name, external.name, external.productItem),
  );
  push("CHK-F19", "product", "Изготовитель", source(external.manufacturer));
  push("CHK-F20", "product", "Количество", source(view.documentary.quantity, external.quantity));
  push("CHK-F21", "product", "Вес, кг", source(view.documentary.mass_kg, external.massKg));
  push("CHK-F22", "product", "Дата выработки", source(external.producedOn));
  push("CHK-F23", "product", "Годен до", source(external.expiresOn));
  // CHK-F25–27: the accompanying-document «act» grounds of the backend
  // FieldSpec; the projection fills them only when the snapshot carries the
  // requisites.
  push("CHK-F25", "documents", "Тип транспортного документа", source(external.transportDocumentType));
  push("CHK-F26", "documents", "Номер транспортного документа", source(external.transportDocumentNumber));
  push("CHK-F27", "documents", "Дата транспортного документа", source(external.transportDocumentIssuedOn));
  return fields;
}

/** The external-fields document facts of the Документ section (real data; absent values stay «—»).
 *
 * ТЗ DR5: the identity shown to the user is the TOP-LEVEL eVSD UUID
 * (``documentUuid``/``evsd_uuid``), never the blank ``issueNumber``; the date
 * is ``vd:issueDate``; the status is the backend-owned Russian label; the
 * purpose is the name resolved by the contour-scoped local dictionary. */
export function documentFacts(view: IncomingView): { label: string; value: string }[] {
  const external = view.external.fields;
  const pick = (...keys: (string | null | undefined)[]): string => {
    for (const key of keys) {
      if (typeof key === "string" && key.trim() !== "") {
        return key;
      }
    }
    return "—";
  };
  return [
    { label: "UUID ВСД", value: pick(external.documentUuid, view.external.evsd_uuid) },
    { label: "Дата оформления ВСД", value: formatRuDate(external.issuedOn) },
    { label: "Статус эВСД", value: pick(external.statusLabel) },
    { label: "Назначение груза", value: pick(external.purpose) },
  ];
}

/** The owner facts of one participant (ЧК-F06/F09 stay informational). */
export function participantOwner(view: IncomingView, side: "sender" | "receiver"): string | null {
  const external = view.external.fields;
  const value = side === "sender" ? external.senderOwner : external.receiverOwner;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Valid canonical unit identity: a non-empty source GUID (ТЗ DR10 §4).
 *
 * An empty string, null, a mass (``500.0``), a place count or the local
 * display text «кг» NEVER count as a unit — only a real source GUID does.
 */
const UNIT_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ТЗ DR10 §6: the canonical unit identity of the party quantities.
 *
 * The identity comes from the allowed sources in priority order:
 * ``documentary.unit_id`` → ``classification.unit.id`` →
 * ``external.fields.unitId`` (published by the backend as the SAME source
 * GUID). The NAME is display-only and never an identity: a present
 * ``unitId`` with an empty name still means the unit IS present.
 */
export interface PartyUnit {
  /** Canonical source unit GUID («» when no allowed source carries one). */
  id: string;
  /** Display-only name («» when the source carries none — not a missing unit). */
  name: string;
}

export function partyUnit(view: IncomingView): PartyUnit {
  const candidates = [
    view.documentary?.unit_id,
    view.classification?.unit?.id ?? null,
    (view.external?.fields?.unitId as string | null | undefined) ?? null,
  ];
  const id =
    candidates.find((entry): entry is string => typeof entry === "string" && entry.trim() !== "") ?? "";
  const names = [
    (view.external?.fields?.unitName as string | null | undefined) ?? null,
    view.classification?.unit?.name ?? null,
  ];
  const name = names.find((entry): entry is string => typeof entry === "string" && entry.trim() !== "") ?? "";
  return { id: id.trim(), name: name.trim() };
}

/** ТЗ DR10 §6: the unit counts as present ONLY with a valid canonical GUID.
 *
 * An empty or non-GUID canonical unitId honestly shows the missing-unit
 * warning; an absent display name never does.
 */
export function hasSourceUnit(view: IncomingView): boolean {
  return UNIT_GUID_RE.test(partyUnit(view).id);
}

/** The read-only unit label: the name when the source carries one, otherwise
 * the honest GUID fallback «Единица из ВСД (GUID: …)» (ТЗ DR10 §6). */
export function partyUnitLabel(view: IncomingView): string {
  const unit = partyUnit(view);
  return unit.name !== "" ? unit.name : `Единица из ВСД (GUID: ${unit.id})`;
}

/** GET /arrivals/:party_id — the IncomingView of one party (API-04, party ETag).
 *
 * The reconciliation screen loads the party by its REAL route id; a foreign
 * or unknown UUID is a 404 problem, never a queue search (a UUID never
 * matches the queue `q` projection). */
export async function fetchArrival(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<IncomingView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/arrivals/{party_id}", {
      params: { path: { party_id: partyId } },
      signal: signal ?? null,
    }) as Promise<RawResult<IncomingView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

// --- Client-side mirror of the server decision rules (FT-ARR-04/09) ---------------

/** CHK fields whose mismatch forbids full/partial acceptance (validate_receipt). */
const INADMISSIBLE_FIELDS: ReadonlySet<string> = new Set([
  "CHK-F05",
  "CHK-F06",
  "CHK-F07",
  "CHK-F08",
  "CHK-F09",
  "CHK-F12",
  "CHK-F15",
  "CHK-F16",
  "CHK-F17",
  "CHK-F19",
  "CHK-F22",
]);

/**
 * The allowed receipt decisions recomputed from the CURRENT form input,
 * mirroring ``validate_receipt`` (FT-ARR-09): the server stays authoritative
 * at save time and any mismatch surfaces as its own validation errors, but
 * the doctor must never wait for a first save before the radios become
 * selectable. A non-arrival / zero delivery admits no decision at all.
 */
export function computeAllowedDecisions(
  delivered: { mass_kg: string; quantity: string },
  comparisons: Record<string, { matches: boolean | null }>,
): Decision[] {
  const positive = Number(delivered.mass_kg) > 0 || Number(delivered.quantity) > 0;
  if (!positive || Number.isNaN(Number(delivered.mass_kg)) || Number.isNaN(Number(delivered.quantity))) {
    return [];
  }
  const inadmissible = Object.entries(comparisons).some(
    ([fieldId, mark]) => mark.matches === false && INADMISSIBLE_FIELDS.has(fieldId),
  );
  return inadmissible ? ["RETURN_ALL"] : ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"];
}

/** The previous-ВСЭ facts of the source projection (CHK-F24/28–32). */
export interface PreviousVse {
  number: string;
  performedOn: string;
  organization: string;
  result: string;
  conclusion: string;
  stamp: string;
}

/**
 * The previous-ВСЭ record when the eVSD source carries one; ``null`` means the
 * block stays informational («нет сведений») and the local ВСЭ is required
 * without a fictitious repeat selection (FT-ARR-11).
 */
export function previousVse(view: IncomingView): PreviousVse | null {
  const fields: Record<string, string | null | undefined> = view.external.fields;
  const value = (key: string): string =>
    typeof fields[key] === "string" ? (fields[key] as string).trim() : "";
  const facts = {
    number: value("previousNumber"),
    performedOn: value("previousPerformedOn"),
    organization: value("previousOrganization"),
    result: value("previousResult"),
    conclusion: value("previousConclusion"),
    stamp: value("previousStamp"),
  };
  return Object.values(facts).some((entry) => entry !== "") ? facts : null;
}

/** GET /arrivals/:party_id/reconciliation — an empty OPEN view before the first save. */
export async function fetchReconciliation(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<ReconciliationView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/arrivals/{party_id}/reconciliation", {
      params: { path: { party_id: partyId } },
      signal: signal ?? null,
    }) as Promise<RawResult<ReconciliationView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** Raw PUT executor for ``useCommand`` (SPEC-04: If-Match + Idempotency-Key). */
export function saveReconciliation(
  partyId: string,
  payload: ReconciliationWrite,
  etag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<ReconciliationView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.PUT("/api/v1/arrivals/{party_id}/reconciliation", {
      params: { path: { party_id: partyId } },
      body: payload,
      headers: { "if-match": etag, "idempotency-key": idempotencyKey },
      signal,
    }) as Promise<RawResult<ReconciliationView>>;
}

// --- Verified VetIS receipt (W03) ----------------------------------------------

export async function fetchReceiptContext(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<ReceiptContext | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/arrivals/{party_id}/receipt-context", {
      params: { path: { party_id: partyId } },
      signal: signal ?? null,
    }) as Promise<RawResult<ReceiptContext>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function previewReceipt(
  partyId: string,
  payload: components["schemas"]["ReceiptPreviewRequest"],
): Promise<ReceiptPreview | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/arrivals/{party_id}/receipt-preview", {
      params: { path: { party_id: partyId } },
      body: payload,
    }) as Promise<RawResult<ReceiptPreview>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function submitReceipt(
  partyId: string,
  payload: components["schemas"]["ReceiptSubmitRequest"],
  idempotencyKey: string,
): Promise<ReceiptAccepted | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/arrivals/{party_id}/receipt", {
      params: { path: { party_id: partyId } },
      headers: { "idempotency-key": idempotencyKey },
      body: payload,
    }) as Promise<RawResult<ReceiptAccepted>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}
