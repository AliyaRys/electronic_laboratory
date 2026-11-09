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

export type IncomingView = components["schemas"]["IncomingView"];
export type QuantitySet = components["schemas"]["QuantitySet"];

export type ArrivalQueue = "EXPECTED" | "WORK" | "ACCEPTED";
export type ArrivalResult = "WAITING" | "RETURNED" | "COMPLETED";

export interface ArrivalsQuery {
  laboratory_id: string;
  queue?: ArrivalQueue | null;
  result?: ArrivalResult | null;
  q?: string | null;
  page?: number;
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

export const RESULT_LABELS: Readonly<Record<ArrivalResult, string>> = Object.freeze({
  WAITING: "Ожидание",
  RETURNED: "Возврат",
  COMPLETED: "Завершено",
});

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

/** `If-Match` wire form of the IncomingView party revision (SPEC-04). */
export function revisionEtag(view: IncomingView): string {
  return `"${view.revision}"`;
}

// --- Reconciliation (A02, API-04) -------------------------------------------------

export type ReconciliationView = components["schemas"]["ReconciliationView"];
export type ReconciliationWrite = components["schemas"]["ReconciliationWrite"];
export type Comparison = components["schemas"]["Comparison"];
export type ActPreview = components["schemas"]["ActPreview"];
export type Decision = NonNullable<ReconciliationView["decision"]>;
export type ReceiptProblemItem = components["schemas"]["ProblemItem"];

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
  block: string;
  label: string;
  source: string;
}

export const RETURN_REASON_CODES: readonly { code: string; label: string }[] = Object.freeze([
  { code: "DEFECTIVE_GOODS", label: "Недоброкачественная продукция" },
  { code: "PACKAGING_DAMAGE", label: "Повреждение упаковки" },
  { code: "FOREIGN_MATERIAL_OR_SAFETY_VIOLATION", label: "Посторонние включения / нарушение безопасности" },
  { code: "LAB_TEST_MISMATCH", label: "Несоответствие лабораторных исследований" },
  { code: "PRODUCTION_VSD_ERROR", label: "Ошибка производственного ВС" },
  { code: "CRITICAL_EXPIRY_DATE", label: "Критичный срок годности" },
  { code: "MARKING_ISSUES", label: "Проблемы маркировки" },
  { code: "QUANTITY_DISCREPANCY", label: "Расхождение количества" },
  { code: "PRODUCT_DATE_MISMATCH", label: "Несоответствие дат продукции" },
  { code: "UNORDERED_PRODUCT", label: "Незаказанная продукция" },
  { code: "WRONG_SPECIFICATION", label: "Несоответствие спецификации" },
  { code: "CONSIGNOR_REJECTION", label: "Отказ отправителя" },
  { code: "CONTRACT_VIOLATION", label: "Нарушение условий договора" },
  { code: "OTHER_REASON", label: "Иная причина" },
]);

/** The viewed CHK source projection of one arrival (informational + compared). */
export function comparedFields(view: IncomingView): ComparedField[] {
  const fields: ComparedField[] = [];
  const external = view.external.fields;
  const classification = view.classification;
  const push = (fieldId: string, block: string, label: string, source: string | null | undefined): void => {
    if (source !== null && source !== undefined && source !== "") {
      fields.push({ fieldId, block, label, source });
    }
  };
  push("CHK-F05", "Участники перевозки", "Отправитель — предприятие", external.consignor);
  push("CHK-F07", "Участники перевозки", "Получатель — предприятие", external.consignee);
  push("CHK-F10", "Идентификация транспорта", "Номер ТС", external.transportNumber);
  push("CHK-F16", "Идентификация продукции", "Продукция", classification.product?.name);
  push("CHK-F17", "Идентификация продукции", "Вид продукции", classification.subProduct?.name ?? null);
  push("CHK-F18", "Идентификация продукции", "Название продукции", classification.productItem?.name);
  push("CHK-F20", "Идентификация продукции", "Количество", view.documentary.quantity);
  push("CHK-F21", "Идентификация продукции", "Вес, кг", view.documentary.mass_kg);
  return fields;
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
