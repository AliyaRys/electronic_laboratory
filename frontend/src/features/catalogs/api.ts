/**
 * Catalog command/read API (API-03) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. Mutations follow SPEC-04: create/delete/retry carry an
 * Idempotency-Key, updates carry If-Match of the target record.
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import { networkProblem, problemFromParsed, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

export type MethodRuleView = components["schemas"]["MethodRuleView"];
export type TariffView = components["schemas"]["TariffView"];
export type CheckServiceRuleView = components["schemas"]["CheckServiceRuleView"];
export type MethodRuleWrite = components["schemas"]["MethodRuleWrite"];
export type TariffWrite = components["schemas"]["TariffWrite"];
export type CheckServiceRuleWrite = components["schemas"]["CheckServiceRuleWrite"];
export type Readiness = components["schemas"]["Readiness"];
export type BulkPriceWrite = components["schemas"]["BulkPriceWrite"];
export type BulkAccepted = components["schemas"]["BulkAccepted"];
export type BulkPriceJobView = components["schemas"]["BulkPriceJobView"];

/** The typed rule union behind the JSONB ``rule`` field (INPUT-02). */
export type MethodRule =
  | {
      type: "interval";
      lower?: string | null;
      upper?: string | null;
      lower_inclusive?: boolean | null;
      upper_inclusive?: boolean | null;
    }
  | { type: "qualitative"; accepted_values: string[] };

/** MethodRuleView with the rule field narrowed to the typed union. */
export type MethodRuleTyped = Omit<MethodRuleView, "rule"> & { rule: MethodRule };

/** Narrow the loose generated view into the typed rule union. */
export function typedMethodRule(view: MethodRuleView): MethodRuleTyped {
  const raw = view.rule as Record<string, unknown>;
  if (raw.type === "qualitative") {
    return {
      ...view,
      rule: {
        type: "qualitative",
        accepted_values: Array.isArray(raw.accepted_values) ? (raw.accepted_values as string[]) : [],
      },
    };
  }
  return {
    ...view,
    rule: {
      type: "interval",
      lower: typeof raw.lower === "string" ? raw.lower : null,
      upper: typeof raw.upper === "string" ? raw.upper : null,
      lower_inclusive: typeof raw.lower_inclusive === "boolean" ? raw.lower_inclusive : true,
      upper_inclusive: typeof raw.upper_inclusive === "boolean" ? raw.upper_inclusive : true,
    },
  };
}

/** Minimal openapi-fetch result shape (see command.ts). */
interface RawResult<TData> {
  data?: TData;
  error?: unknown;
  response: Response;
}

/** Wrap a transport result into data-or-problem without losing the response. */
export async function settle<TData>(
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

type MethodsPage = components["schemas"]["Page_MethodRuleView_"];
type TariffsPage = components["schemas"]["Page_TariffView_"];
type CheckServicesPage = components["schemas"]["Page_CheckServiceRuleView_"];

export interface CatalogPageData<TItem> {
  items: TItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function fetchMethods(
  laboratoryId: string,
  productSpeciesId: string,
  page = 1,
  signal?: AbortSignal | null,
): Promise<CatalogPageData<MethodRuleTyped> | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/catalogs/methods", {
      params: { query: { laboratory_id: laboratoryId, product_species_id: productSpeciesId, page } },
      signal: signal ?? null,
    }) as Promise<RawResult<MethodsPage>>,
  );
  if ("problem" in settled) return settled.problem;
  return { ...settled.data, items: settled.data.items.map(typedMethodRule) };
}

export async function fetchTariffs(
  laboratoryId: string,
  productSpeciesId: string | null,
  page = 1,
  signal?: AbortSignal | null,
): Promise<CatalogPageData<TariffView> | Problem> {
  // Owner decision DR14: without a species the call lists the
  // laboratory-scoped CHECK tariffs (species IS NULL server-side).
  const query: { laboratory_id: string; product_species_id?: string | null; page: number } = {
    laboratory_id: laboratoryId,
    page,
  };
  if (productSpeciesId !== null) query.product_species_id = productSpeciesId;
  const settled = await settle(
    apiClient.GET("/api/v1/catalogs/tariffs", {
      params: { query },
      signal: signal ?? null,
    }) as Promise<RawResult<TariffsPage>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchCheckServices(
  page = 1,
  signal?: AbortSignal | null,
): Promise<CatalogPageData<CheckServiceRuleView> | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/catalogs/check-services", {
      params: { query: { page } },
      signal: signal ?? null,
    }) as Promise<RawResult<CheckServicesPage>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchReadiness(
  laboratoryId: string,
  productSpeciesId: string,
  signal?: AbortSignal | null,
): Promise<Readiness | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/catalogs/readiness", {
      params: { query: { laboratory_id: laboratoryId, product_species_id: productSpeciesId } },
      signal: signal ?? null,
    }) as Promise<RawResult<Readiness>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function createMethod(
  payload: MethodRuleWrite,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ rule: MethodRuleView } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/catalogs/methods", {
      body: payload,
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<MethodRuleView>>,
  );
  return "problem" in settled ? settled.problem : { rule: settled.data };
}

export async function updateMethod(
  ruleId: string,
  payload: MethodRuleWrite,
  etag: string,
  signal?: AbortSignal | null,
): Promise<{ rule: MethodRuleView } | Problem> {
  const settled = await settle(
    apiClient.PUT("/api/v1/catalogs/methods/{rule_id}", {
      body: payload,
      params: { path: { rule_id: ruleId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<MethodRuleView>>,
  );
  return "problem" in settled ? settled.problem : { rule: settled.data };
}

export async function deleteMethod(
  ruleId: string,
  etag: string,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.DELETE("/api/v1/catalogs/methods/{rule_id}", {
      params: { path: { rule_id: ruleId } },
      headers: { "if-match": etag, "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<undefined>>,
  );
  return "problem" in settled ? settled.problem : null;
}

export async function createTariff(
  payload: TariffWrite,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ tariff: TariffView } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/catalogs/tariffs", {
      body: payload,
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<TariffView>>,
  );
  return "problem" in settled ? settled.problem : { tariff: settled.data };
}

export async function updateTariff(
  tariffId: string,
  payload: TariffWrite,
  etag: string,
  signal?: AbortSignal | null,
): Promise<{ tariff: TariffView } | Problem> {
  const settled = await settle(
    apiClient.PUT("/api/v1/catalogs/tariffs/{tariff_id}", {
      body: payload,
      params: { path: { tariff_id: tariffId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<TariffView>>,
  );
  return "problem" in settled ? settled.problem : { tariff: settled.data };
}

export async function deleteTariff(
  tariffId: string,
  etag: string,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.DELETE("/api/v1/catalogs/tariffs/{tariff_id}", {
      params: { path: { tariff_id: tariffId } },
      headers: { "if-match": etag, "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<undefined>>,
  );
  return "problem" in settled ? settled.problem : null;
}

export async function createCheckService(
  payload: CheckServiceRuleWrite,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ rule: CheckServiceRuleView } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/catalogs/check-services", {
      body: payload,
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<CheckServiceRuleView>>,
  );
  return "problem" in settled ? settled.problem : { rule: settled.data };
}

export async function updateCheckService(
  ruleId: string,
  payload: CheckServiceRuleWrite,
  etag: string,
  signal?: AbortSignal | null,
): Promise<{ rule: CheckServiceRuleView } | Problem> {
  const settled = await settle(
    apiClient.PUT("/api/v1/catalogs/check-services/{rule_id}", {
      body: payload,
      params: { path: { rule_id: ruleId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<CheckServiceRuleView>>,
  );
  return "problem" in settled ? settled.problem : { rule: settled.data };
}

/** POST /catalogs/bulk-prices → 202 BulkAccepted (API-03, whole-set intent). */
export async function createBulkPrice(
  payload: BulkPriceWrite,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ accepted: BulkAccepted } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/catalogs/bulk-prices", {
      body: payload,
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<BulkAccepted>>,
  );
  return "problem" in settled ? settled.problem : { accepted: settled.data };
}

/** GET /catalogs/bulk-prices/:id — the per-target actual results. */
export async function fetchBulkJob(
  jobId: string,
  signal?: AbortSignal | null,
): Promise<BulkPriceJobView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/catalogs/bulk-prices/{job_id}", {
      params: { path: { job_id: jobId } },
      signal: signal ?? null,
    }) as Promise<RawResult<BulkPriceJobView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** POST /:id/retry — only FAILED targets, original intent, NEW command key. */
export async function retryBulkJob(
  jobId: string,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ accepted: BulkAccepted } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/catalogs/bulk-prices/{job_id}/retry", {
      params: { path: { job_id: jobId } },
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<BulkAccepted>>,
  );
  return "problem" in settled ? settled.problem : { accepted: settled.data };
}

/** Result state of one bulk target (API-03: PENDING/SUCCEEDED/FAILED). */
export const BULK_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING: "Ожидает",
  SUCCEEDED: "Применено",
  FAILED: "Ошибка",
  COMPLETED: "Применено полностью",
  PARTIAL: "Применено частично",
});

export const BULK_JOB_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING: "Принято, ожидает применения",
  RUNNING: "Применяется",
  COMPLETED: "Цена применена во все лаборатории",
  PARTIAL: "Применено частично: часть лабораторий не обновлена",
  FAILED: "Применение не удалось ни в одной лаборатории",
});
