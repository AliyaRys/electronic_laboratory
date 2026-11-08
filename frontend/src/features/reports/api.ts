/**
 * Reports API (API-08, R03).
 *
 * Most routes are typed in the generated schema (operational, preview, save,
 * read, delete). The saved-report list and the two export files are served by
 * the backend but are **not** in ``shared/api/schema.d.ts`` yet (the generator
 * needs a live backend regen); they use the plain transport here, confined to
 * this module — page components never call ``fetch`` directly (D02 rule).
 * Every failure becomes a shared {@link Problem}; an export Blob is created
 * only AFTER the Problem check, never for an error response.
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import {
  isProblemContentType,
  networkProblem,
  parseProblem,
  problemFromParsed,
  type Problem,
} from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

export type OperationalView = components["schemas"]["OperationalView"];
export type SignedPreview = components["schemas"]["SignedPreview"];
export type ReportSnapshotView = components["schemas"]["ReportSnapshotView"];
export type ReportPreviewParams = components["schemas"]["ReportPreviewParams"];

/** Minimal openapi-fetch result shape (see features/samples/api.ts). */
interface RawResult<TData> {
  data?: TData;
  error?: unknown;
  response: Response;
}

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
    return { problem: networkProblem(thrown instanceof Error ? thrown.message : "Сеть недоступна.") };
  }
}

/** One row of the saved-report list (API-08 ReportSummary; not in schema yet). */
export interface ReportSummary {
  id: string;
  report_type: string;
  laboratory_id: string;
  year: number;
  half: number;
  source_count: number;
  saved_at: string;
  saved_by: string;
  rev: number;
}

export interface ReportSummaryPage {
  items: ReportSummary[];
  total: number;
  page: number;
  page_size: number;
}

/** Same-origin base that keeps jsdom fetch absolute (mirrors shared/api/client). */
function base(): string {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return "http://localhost";
  }
  return "";
}

/** Query keys of the reporting screens (exact keys, commands bind them). */
export const reportsKey = (laboratoryId: string, page: number): readonly unknown[] => [
  laboratoryId,
  "reports",
  "list",
  page,
];
export const operationalKey = (laboratoryId: string, from: string, to: string): readonly unknown[] => [
  laboratoryId,
  "reports",
  "operational",
  from,
  to,
];
export const reportKey = (reportId: string): readonly unknown[] => ["reports", "saved", reportId];

export async function fetchReports(
  laboratoryId: string,
  page: number,
  signal?: AbortSignal | null,
): Promise<ReportSummaryPage | Problem> {
  try {
    const response = await fetch(
      `${base()}/api/v1/reports/5vet?laboratory_id=${encodeURIComponent(laboratoryId)}&page=${page}`,
      { signal: signal ?? null },
    );
    if (!response.ok) {
      return await parseProblem(response);
    }
    return (await response.json()) as ReportSummaryPage;
  } catch (thrown) {
    return networkProblem(thrown instanceof Error ? thrown.message : "Ошибка сети.");
  }
}

export async function fetchOperational(
  laboratoryId: string,
  from: string,
  to: string,
  signal?: AbortSignal | null,
): Promise<OperationalView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/reports/operational", {
      params: {
        query: { laboratory_id: laboratoryId, date_from: from, date_to: to },
      } as never,
      signal: signal ?? null,
    }) as Promise<RawResult<OperationalView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchReport(
  reportId: string,
  signal?: AbortSignal | null,
): Promise<ReportSnapshotView | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/reports/5vet/{report_id}", {
      params: { path: { report_id: reportId } },
      signal: signal ?? null,
    }) as Promise<RawResult<ReportSnapshotView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/** Raw POST executor of the signed preview (useCommand; CSRF via middleware). */
export function previewReport(
  params: ReportPreviewParams,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<SignedPreview>> {
  return ({ signal }) =>
    apiClient.POST("/api/v1/reports/5vet/preview", {
      body: params,
      signal,
    }) as Promise<RawResult<SignedPreview>>;
}

/**
 * Raw POST executor of the immutable save: the signed preview is verified and
 * stored exactly as received — the client never recomputes it (R02 contract).
 */
export function saveReport(
  preview: SignedPreview,
  codes: {
    okud: string;
    okpo: string;
    okved: string;
    oktmo: string;
    okogu: string;
    okopf: string;
    okfs: string;
  },
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<ReportSnapshotView>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.POST("/api/v1/reports/5vet", {
      body: { preview, codes },
      headers: { "idempotency-key": idempotencyKey },
      signal,
    }) as Promise<RawResult<ReportSnapshotView>>;
}

/** DELETE of one saved snapshot (If-Match of the row, idempotent). */
export function deleteReport(
  reportId: string,
  etag: string,
): (ctx: { idempotencyKey: string; signal: AbortSignal }) => Promise<RawResult<undefined>> {
  return ({ idempotencyKey, signal }) =>
    apiClient.DELETE("/api/v1/reports/5vet/{report_id}", {
      params: { path: { report_id: reportId } },
      headers: { "if-match": etag, "idempotency-key": idempotencyKey },
      signal,
    }) as Promise<RawResult<undefined>>;
}

export interface FileResult {
  blob: Blob;
  filename: string;
}

/**
 * GET ``.../export.pdf`` of one SAVED report: bytes come only after the
 * Problem check (a 503 renderer failure or a 404 never downloads a file).
 * A retry repeats exactly the same GET — the snapshot cannot change.
 */
export async function fetchReportFile(
  reportId: string,
  kind: "pdf" | "xlsx",
  signal?: AbortSignal | null,
): Promise<FileResult | { problem: Problem }> {
  try {
    const response = await fetch(`${base()}/api/v1/reports/5vet/${reportId}/export.${kind}`, {
      signal: signal ?? null,
    });
    if (!response.ok || isProblemContentType(response)) {
      return { problem: await parseProblem(response) };
    }
    const data = await response.arrayBuffer();
    const type =
      kind === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match !== null ? decodeURIComponent(match[1] ?? "") : "";
    return { blob: new Blob([data], { type }), filename };
  } catch (thrown) {
    return { problem: networkProblem(thrown instanceof Error ? thrown.message : "Ошибка сети.") };
  }
}

/** The roles allowed to see any reporting screen (AT-20: ADMIN is forbidden). */
export const REPORT_ROLES: ReadonlySet<string> = new Set(["HEAD", "ANALYST"]);
