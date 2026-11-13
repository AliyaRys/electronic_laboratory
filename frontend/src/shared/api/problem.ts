/**
 * Problem Details parsing (API-01).
 *
 * Every backend error answers ``application/problem+json`` with a stable
 * ``code`` and a Russian ``detail``. The client normalizes any failure shape
 * into one {@link Problem} so screens never re-parse raw responses.
 */

export interface ProblemItem {
  path: string;
  field_id?: string | undefined;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string | undefined;
  code: string;
  trace_id?: string | undefined;
  errors?: ProblemItem[] | undefined;
  /** ТЗ DR27 §5.2: safe technical diagnostics of a REVISION_CONFLICT. */
  current_source_revision?: number | undefined;
  current_reconciliation_revision?: number | undefined;
}

export function isProblemContentType(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/problem+json");
}

/** Parse a problem response; falls back to a synthetic network problem. */
export async function parseProblem(response: Response): Promise<Problem> {
  if (isProblemContentType(response)) {
    const raw: unknown = await response.json().catch(() => null);
    const problem = coerceProblem(raw, response.status);
    if (problem !== null) {
      return problem;
    }
  }
  return unrecognized(response.status);
}

/**
 * Build a Problem from a value already parsed by the transport (openapi-fetch
 * puts the JSON error body into ``result.error``); the response body cannot be
 * re-read after that.
 */
export function problemFromParsed(raw: unknown, status: number): Problem {
  const problem = coerceProblem(raw, status);
  return problem ?? unrecognized(status);
}

function unrecognized(status: number): Problem {
  return {
    type: "about:blank",
    title: "Ошибка сети",
    status,
    detail: "Ответ сервера не распознан. Обратитесь к поддержке, указав статус ошибки.",
    code: "UNRECOGNIZED_RESPONSE",
  };
}

export function networkProblem(cause: string): Problem {
  return {
    type: "about:blank",
    title: "Ошибка сети",
    status: 0,
    detail: cause,
    code: "NETWORK_ERROR",
  };
}

/** Narrow unknown JSON into a Problem; returns null when the shape does not match. */
function coerceProblem(raw: unknown, status: number): Problem | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.detail !== "string") {
    return null;
  }
  return {
    type: typeof record.type === "string" ? record.type : "about:blank",
    title: typeof record.title === "string" ? record.title : "",
    status: typeof record.status === "number" ? record.status : status,
    detail: record.detail,
    instance: typeof record.instance === "string" ? record.instance : undefined,
    code: record.code,
    trace_id: typeof record.trace_id === "string" ? record.trace_id : undefined,
    errors: Array.isArray(record.errors) ? record.errors.map(coerceProblemItem) : undefined,
    // ТЗ DR27 §5.2: the backend MAY attach two safe technical diagnostics to
    // a REVISION_CONFLICT Problem; they survive the normalization.
    current_source_revision:
      typeof record.current_source_revision === "number" ? record.current_source_revision : undefined,
    current_reconciliation_revision:
      typeof record.current_reconciliation_revision === "number"
        ? record.current_reconciliation_revision
        : undefined,
  };
}

function coerceProblemItem(raw: unknown): ProblemItem {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    path: typeof record.path === "string" ? record.path : "",
    field_id: typeof record.field_id === "string" ? record.field_id : undefined,
    message: typeof record.message === "string" ? record.message : "",
  };
}
