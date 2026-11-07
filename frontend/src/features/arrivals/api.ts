/**
 * Arrivals read/hide API (API-04) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. The sync command is deliberately not exposed here: until ТЗ-10
 * ships, the update button renders an honest disabled/not-configured state
 * instead of pretending a successful import.
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
