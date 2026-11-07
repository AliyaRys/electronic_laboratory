/**
 * Sample accounting API (API-06, S03) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. The balances read model is the live SUM of the active
 * collections (DATA-03), so after every disposal the screen re-reads it —
 * the 201 answer carries no ETag, and no balance is ever zeroed
 * optimistically on the client.
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import { networkProblem, problemFromParsed, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

export type BalanceView = components["schemas"]["BalanceView"];
export type CollectionView = components["schemas"]["CollectionView"];
export type DisposalView = components["schemas"]["DisposalView"];
export type DisposalWrite = components["schemas"]["DisposalWrite"];

export interface CollectionsQuery {
  laboratory_id: string;
  page?: number;
}

export interface DisposalsQuery {
  laboratory_id: string;
  /** Inclusive period on disposed_on; the filter never affects the balance. */
  date_from?: string | null;
  date_to?: string | null;
  page?: number;
}

export interface SamplePage<TItem> {
  items: TItem[];
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

/** Query keys of the accounting screen (exact keys, command refresh binds them). */
export const balancesKey = (laboratoryId: string): readonly unknown[] => [
  "samples",
  "balances",
  laboratoryId,
];
export const collectionsKey = (laboratoryId: string, page: number): readonly unknown[] => [
  "samples",
  "collections",
  laboratoryId,
  page,
];
export const disposalsKey = (
  laboratoryId: string,
  from: string,
  to: string,
  page: number,
): readonly unknown[] => ["samples", "disposals", laboratoryId, from, to, page];

export async function fetchBalances(
  laboratoryId: string,
  signal?: AbortSignal | null,
): Promise<BalanceView[] | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/samples/balances", {
      params: { query: { laboratory_id: laboratoryId } },
      signal: signal ?? null,
    }) as Promise<RawResult<BalanceView[]>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchCollections(
  query: CollectionsQuery,
  signal?: AbortSignal | null,
): Promise<SamplePage<CollectionView> | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/samples/collections", {
      params: {
        query: { laboratory_id: query.laboratory_id, page: query.page ?? 1 },
      } as never,
      signal: signal ?? null,
    }) as Promise<RawResult<SamplePage<CollectionView>>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchDisposals(
  query: DisposalsQuery,
  signal?: AbortSignal | null,
): Promise<SamplePage<DisposalView> | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/samples/disposals", {
      params: {
        query: {
          laboratory_id: query.laboratory_id,
          date_from: query.date_from ?? null,
          date_to: query.date_to ?? null,
          page: query.page ?? 1,
        },
      } as never,
      signal: signal ?? null,
    }) as Promise<RawResult<SamplePage<DisposalView>>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/**
 * Raw POST executor for ``useCommand`` (SPEC-04): the confirmation carries the
 * readonly shown mass (If-Match of the basket revision guards it), the server
 * always recomputes the actual stored mass.
 */
export function disposeSamples(
  payload: DisposalWrite,
  revision: number,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<DisposalView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.POST("/api/v1/samples/disposals", {
      body: payload,
      headers: {
        "if-match": `"${revision}"`,
        "idempotency-key": idempotencyKey,
      },
      signal,
    }) as Promise<RawResult<DisposalView>>;
}

/** The product name of a collection fact from its frozen snapshot. */
export function snapshotProduct(view: CollectionView): string {
  const product = view.classification_snapshot["product"];
  if (product !== null && typeof product === "object" && "name" in product) {
    const name = (product as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return view.product_species_id;
}
