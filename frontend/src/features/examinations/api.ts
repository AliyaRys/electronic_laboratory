/**
 * Examinations API (API-05, E04) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. Write payloads follow the generated camelCase contract; the read
 * view stays snake_case exactly as the backend serves it. The four state
 * changing actions (wait / complete / update / late outcome) are strictly
 * separate executors — no combined button ever exists.
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import { networkProblem, problemFromParsed, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

export type ExaminationView = components["schemas"]["ExaminationView"];
export type ExaminationWrite = components["schemas"]["ExaminationWrite"];
export type OutcomeWrite = components["schemas"]["OutcomeWrite"];
export type CommandStateView = components["schemas"]["CommandStateView"];
export type SampleSelection = ExaminationWrite["sample"];
export type ResearchWrite = ExaminationWrite["researches"][number];
/** DR35 §4: the frozen reconciliation-step read model of the create page. */
export type ExaminationFormView = components["schemas"]["ExaminationFormView"];
/** DR35 §13.3: the server pricing preview (the same snapshot the save stores). */
export type PricingPreviewResponse = components["schemas"]["PricingPreviewResponse"];
export type PricingSnapshotView = PricingPreviewResponse["snapshot"];
/** ТЗ DR44 §2: the compact server examination summary of an arrival row. */
export type ExaminationSummaryView = components["schemas"]["ExaminationSummary"];
/** The body of the preview: only the fully performed researches (§13.3). */
export type PricingPreviewRequestBody = { researches: ResearchWrite[] };

/** Minimal openapi-fetch result shape (see features/samples/api.ts). */
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

/** Query key of one examination card (exact keys, commands bind them). */
export const examinationKey = (examinationId: string): readonly unknown[] => ["examinations", examinationId];

/**
 * ТЗ DR44 §3: the exact Russian result wording of the compact «ВСЭ» column —
 * ONE dictionary, never duplicated in the table.
 */
export function examinationOutcomeLabel(value: string | null | undefined): string {
  if (value === "FIT") return "Пригодно";
  if (value === "UNFIT") return "Непригодно";
  return "—";
}

/** DR45 §2: the scoped journal read model item (snake_case wire). */
export type ExaminationJournalItem = components["schemas"]["ExaminationJournalItem"];
/** §2: the scoped author options of the journal filter. */
export type JournalAuthor = components["schemas"]["JournalAuthor"];

export interface JournalQuery {
  laboratory_id: string;
  /** Absent status = COMPLETED (the server default; the plain URL). */
  status?: "WAITING" | "COMPLETED" | null;
  q?: string | null;
  outcome?: "FIT" | "UNFIT" | null;
  occurred_from?: string | null;
  /** Exclusive upper boundary of the Moscow calendar window. */
  occurred_to?: string | null;
  sort?: "asc" | "desc" | null;
  /** §2: the server filters the displayed specialist BEFORE count/page. */
  specialist_id?: string | null;
  page?: number;
}

/** DR45 §2: the journal query key (URL-state joins the key). */
export const journalKey = (query: JournalQuery): readonly unknown[] => [
  "examinations",
  "journal",
  query.laboratory_id,
  query.status ?? "COMPLETED",
  query.q ?? "",
  query.outcome ?? "",
  query.occurred_from ?? "",
  query.occurred_to ?? "",
  query.sort ?? "desc",
  query.page ?? 1,
];

export async function fetchJournal(
  query: JournalQuery,
  signal?: AbortSignal | null,
): Promise<{ items: ExaminationJournalItem[]; total: number; page: number; page_size: number } | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/examinations", {
      params: {
        query: {
          laboratory_id: query.laboratory_id,
          status: query.status ?? null,
          q: query.q ?? null,
          outcome: query.outcome ?? null,
          occurred_from: query.occurred_from ?? null,
          occurred_to: query.occurred_to ?? null,
          sort: query.sort ?? null,
          specialist_id: query.specialist_id ?? null,
          page: query.page ?? 1,
        },
      } as never,
      signal: signal ?? null,
    }) as Promise<
      RawResult<{ items: ExaminationJournalItem[]; total: number; page: number; page_size: number }>
    >,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** The scoped author options of the journal filter (§2): ONE query over the
 * laboratory's journal cards, never the full user list. */
export const journalAuthorsKey = (laboratoryId: string): readonly unknown[] => [
  "examinations",
  "journal-authors",
  laboratoryId,
];

export async function fetchJournalAuthors(
  laboratoryId: string,
  signal?: AbortSignal | null,
): Promise<JournalAuthor[] | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/examinations/authors", {
      params: { query: { laboratory_id: laboratoryId } },
      signal: signal ?? null,
    }) as Promise<RawResult<JournalAuthor[]>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchExamination(
  examinationId: string,
  signal?: AbortSignal | null,
): Promise<ExaminationView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/examinations/{examination_id}", {
      params: { path: { examination_id: examinationId } },
      signal: signal ?? null,
    }) as Promise<RawResult<ExaminationView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** DR35 §4: the create-page read model — the frozen snapshot, no lookup. */
export async function fetchExaminationForm(
  partyId: string,
  signal?: AbortSignal | null,
): Promise<ExaminationFormView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/examinations/parties/{party_id}/form", {
      params: { path: { party_id: partyId } },
      signal: signal ?? null,
    }) as Promise<RawResult<ExaminationFormView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** DR35 §13.3: the live pricing preview (read/compute, never mutates). */
export async function fetchPricingPreview(
  partyId: string,
  payload: PricingPreviewRequestBody,
  signal?: AbortSignal | null,
): Promise<PricingPreviewResponse | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/examinations/parties/{party_id}/pricing-preview", {
      params: { path: { party_id: partyId } },
      body: payload,
      signal: signal ?? null,
    }) as Promise<RawResult<PricingPreviewResponse>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** Raw POST executor of the FIRST save: one action per button (API-05). */
export function createExamination(
  partyId: string,
  payload: ExaminationWrite,
  partyEtag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<ExaminationView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.POST("/api/v1/examinations/parties/{party_id}", {
      params: { path: { party_id: partyId } },
      body: payload,
      headers: {
        "if-match": partyEtag,
        "idempotency-key": idempotencyKey,
      },
      signal,
    }) as Promise<RawResult<ExaminationView>>;
}

/** The one full same-day edit (PUT /examinations/:id, If-Match of the card). */
export function updateExamination(
  examinationId: string,
  payload: ExaminationWrite,
  etag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<ExaminationView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.PUT("/api/v1/examinations/{examination_id}", {
      params: { path: { examination_id: examinationId } },
      body: payload,
      headers: {
        "if-match": etag,
        "idempotency-key": idempotencyKey,
      },
      signal,
    }) as Promise<RawResult<ExaminationView>>;
}

/**
 * The explicit late completion of a WAITING card: body holds only
 * outcome/direction/reason (OutcomeWrite strict) — never any other field.
 */
export function completeWaiting(
  examinationId: string,
  payload: OutcomeWrite,
  etag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<ExaminationView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.POST("/api/v1/examinations/{examination_id}/complete-waiting", {
      params: { path: { examination_id: examinationId } },
      body: payload,
      headers: {
        "if-match": etag,
        "idempotency-key": idempotencyKey,
      },
      signal,
    }) as Promise<RawResult<ExaminationView>>;
}

/**
 * The durable examination delete (E03). A 204 means the remote WAL flush is
 * confirmed; a 202 carries CommandState UNKNOWN and must not be presented as
 * a completed deletion by the caller.
 */
export function deleteExamination(
  examinationId: string,
  etag: string,
): (ctx: {
  idempotencyKey: string;
  signal: AbortSignal;
}) => Promise<RawResult<CommandStateView | undefined>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.DELETE("/api/v1/examinations/{examination_id}", {
      params: { path: { examination_id: examinationId } },
      headers: {
        "if-match": etag,
        "idempotency-key": idempotencyKey,
      },
      signal,
    }) as Promise<RawResult<CommandStateView | undefined>>;
}
