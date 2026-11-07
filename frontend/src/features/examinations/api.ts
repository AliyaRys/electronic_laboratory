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
export type SampleSelection = ExaminationWrite["sample"];
export type ResearchWrite = ExaminationWrite["researches"][number];

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
 * The examination delete (E03 route). The backend route is not part of this
 * task's merged contract yet, so the call is typed ``as never`` against the
 * generated client — the honest situation is documented in the evidence file.
 */
export function deleteExamination(
  examinationId: string,
  etag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<undefined>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.DELETE(
      "/api/v1/examinations/{examination_id}" as never,
      {
        params: { path: { examination_id: examinationId } } as never,
        headers: {
          "if-match": etag,
          "idempotency-key": idempotencyKey,
        },
        signal,
      } as never,
    ) as unknown as Promise<RawResult<undefined>>;
}
