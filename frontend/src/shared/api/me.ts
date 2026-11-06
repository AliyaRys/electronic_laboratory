/**
 * Session read model (API-02): ``GET /me`` is the only source of the current
 * user identity, role and capabilities for the shell.
 *
 * Errors reuse the shared Problem parsing (API-01): a stable Russian message
 * plus a stable code for the collapsed support trace.
 */
import { useQuery } from "@tanstack/react-query";
import type { components } from "../api/schema";
import { apiClient } from "../api/client";
import { networkProblem, problemFromParsed, type Problem } from "../api/problem";

export type UserView = components["schemas"]["UserView"];

/** ``me`` is not laboratory-scoped; zeros keep the F01 key shape stable. */
export const ME_QUERY_KEY = [null, null, null, "/me", null] as const;

export class MeError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail !== "" ? problem.detail : problem.title);
    this.problem = problem;
  }
}

export async function fetchMe(): Promise<UserView | null> {
  try {
    const { data, error } = await apiClient.GET("/api/v1/me");
    if (error !== undefined) {
      throw new MeError(problemFromParsed(error, 500));
    }
    return data ?? null;
  } catch (thrown) {
    if (thrown instanceof MeError) throw thrown;
    throw new MeError(networkProblem(String(thrown)));
  }
}

export interface SessionRead {
  user: UserView | null;
  loading: boolean;
  /** Russian, user-facing message for StatusView. */
  errorMessage: string | null;
  /** Stable problem code for the collapsed support trace. */
  errorCode: string | null;
  traceId: string | null;
}

export function useMe(): SessionRead {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false, staleTime: 0 });
  const thrown = query.error;
  const problem = thrown instanceof MeError ? thrown.problem : null;
  return {
    user: query.data ?? null,
    loading: query.isLoading,
    errorMessage: query.isError === true ? (problem?.detail ?? "Ошибка соединения.") : null,
    errorCode: problem?.code ?? null,
    traceId: problem?.trace_id ?? null,
  };
}
