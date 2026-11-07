/**
 * Identity command/read API (API-02) on top of the single F01 transport.
 *
 * Every failure becomes a shared {@link Problem}; screens never parse raw
 * responses. Secrets (passwords) live in form state only and are cleared by
 * the caller after submit/close (ТЗ-02: nothing is persisted anywhere).
 */
import type { components } from "../../shared/api/schema";
import { apiClient } from "../../shared/api/client";
import { setCsrfToken } from "../../shared/api/csrf";
import { networkProblem, problemFromParsed, type Problem } from "../../shared/api/problem";

export type { Problem } from "../../shared/api/problem";

export type UserView = components["schemas"]["UserView"];
export type ScopeView = components["schemas"]["ScopeView"];
export type UserWrite = components["schemas"]["UserWrite"];
export type UserRole = components["schemas"]["UserRole"];
export type UserEventView = components["schemas"]["UserEventView"];

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

/** Anonymous bootstrap: fetch the CSRF token into memory before the first login. */
export async function bootstrapCsrf(): Promise<void> {
  // The backend also sets the ``vse_csrf`` cookie on ``/`` so a live session
  // can recover after F5. The response body remains the immediate source for
  // this anonymous bootstrap request (ТЗ-02: no Web Storage persistence).
  // Concurrent callers share one request: every /auth/csrf response rotates
  // the cookie, and a stale response must never overwrite the fresh token.
  if (inflightBootstrap === null) {
    inflightBootstrap = (async () => {
      const settled = await settle(
        apiClient.GET("/api/v1/auth/csrf") as Promise<RawResult<{ csrf_token: string }>>,
      );
      if (!("problem" in settled)) {
        setCsrfToken(settled.data.csrf_token);
      }
    })().finally(() => {
      inflightBootstrap = null;
    });
  }
  return inflightBootstrap;
}
let inflightBootstrap: Promise<void> | null = null;

export interface LoginPayload {
  user: UserView;
  contexts: ScopeView[];
  /** Session CSRF token from the login response (memory only, ТЗ-02). */
  csrf_token: string;
}

export async function login(
  loginName: string,
  password: string,
  signal?: AbortSignal | null,
): Promise<{ ok: true; payload: LoginPayload } | { ok: false; problem: Problem }> {
  const settled = await settle(
    apiClient.POST("/api/v1/auth/login", {
      body: { login: loginName, password },
      signal: signal ?? null,
    }) as Promise<RawResult<components["schemas"]["LoginResponse"]>>,
  );
  if ("problem" in settled) {
    return { ok: false, problem: settled.problem };
  }
  const { data } = settled;
  return {
    ok: true,
    payload: { user: data.user, contexts: data.contexts, csrf_token: data.csrf_token },
  };
}

export async function fetchContexts(signal?: AbortSignal | null): Promise<ScopeView[] | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/contexts", { signal: signal ?? null }) as Promise<RawResult<ScopeView[]>>,
  );
  return "problem" in settled ? settled.problem : (settled.data ?? []);
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
  confirmation: string;
}

export async function changePassword(
  payload: ChangePasswordInput,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.POST("/api/v1/me/change-password", { body: payload, signal: signal ?? null }) as Promise<
      RawResult<undefined>
    >,
  );
  return "problem" in settled ? settled.problem : null;
}

export interface UsersQuery {
  role?: UserRole | null;
  status?: "active" | "inactive" | null;
  laboratory_id?: string | null;
  product_scope_id?: string | null;
  q?: string | null;
  page?: number;
}

export interface UsersPage {
  items: UserView[];
  total: number;
  page: number;
  page_size: number;
}

export async function fetchUsers(
  query: UsersQuery,
  signal?: AbortSignal | null,
): Promise<UsersPage | Problem> {
  // ``/users`` carries both GET and POST in the schema; the union of fetch
  // options defeats plain assignability, so the call is narrowed explicitly.
  const get = apiClient.GET as unknown as (
    path: "/api/v1/users",
    options: { params?: UsersQuery; signal?: AbortSignal | null },
  ) => Promise<RawResult<UsersPage>>;
  const settled = await settle(get("/api/v1/users", { params: query, signal: signal ?? null }));
  return "problem" in settled ? settled.problem : settled.data;
}

export async function fetchUser(
  userId: string,
  signal?: AbortSignal | null,
): Promise<{ user: UserView; etag: string } | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/users/{user_id}", {
      params: { path: { user_id: userId } },
      signal: signal ?? null,
    }) as Promise<RawResult<UserView>>,
  );
  if ("problem" in settled) return settled.problem;
  const etag = settled.response.headers.get("ETag") ?? `"${settled.data.revision}"`;
  return { user: settled.data, etag };
}

export interface UserEditorPayload {
  full_name: string;
  login: string;
  email: string;
  position?: string | null;
  role: UserRole;
  scopes: components["schemas"]["ScopeInput"][];
  password?: string | null | undefined;
  confirmation?: string | null | undefined;
}

export async function createUser(
  payload: UserEditorPayload,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<{ user: UserView } | Problem> {
  const settled = await settle(
    apiClient.POST("/api/v1/users", {
      body: payload as unknown as UserWrite,
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<UserView>>,
  );
  return "problem" in settled ? settled.problem : { user: settled.data };
}

export async function updateUser(
  userId: string,
  payload: UserEditorPayload,
  etag: string,
  signal?: AbortSignal | null,
): Promise<{ user: UserView; etag: string } | Problem> {
  const settled = await settle(
    apiClient.PUT("/api/v1/users/{user_id}", {
      body: payload as unknown as UserWrite,
      params: { path: { user_id: userId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<UserView>>,
  );
  if ("problem" in settled) return settled.problem;
  return {
    user: settled.data,
    etag: settled.response.headers.get("ETag") ?? `"${settled.data.revision}"`,
  };
}

/** `If-Match` wire form of the UserView revision (SPEC-04). */
export function revisionEtag(user: UserView): string {
  return `"${user.revision}"`;
}

async function postUserAction(
  path: "/api/v1/users/{user_id}/block" | "/api/v1/users/{user_id}/unblock",
  userId: string,
  etag: string,
  signal?: AbortSignal | null,
): Promise<UserView | Problem> {
  const settled = await settle(
    apiClient.POST(path, {
      params: { path: { user_id: userId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<UserView>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

export const blockUser = (userId: string, etag: string, signal?: AbortSignal | null) =>
  postUserAction("/api/v1/users/{user_id}/block", userId, etag, signal);

export const unblockUser = (userId: string, etag: string, signal?: AbortSignal | null) =>
  postUserAction("/api/v1/users/{user_id}/unblock", userId, etag, signal);

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  confirmation: string,
  etag: string,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.POST("/api/v1/users/{user_id}/reset-password", {
      body: { new_password: newPassword, confirmation },
      params: { path: { user_id: userId } },
      headers: { "if-match": etag },
      signal: signal ?? null,
    }) as Promise<RawResult<undefined>>,
  );
  return "problem" in settled ? settled.problem : null;
}

export async function deleteUser(
  userId: string,
  idempotencyKey: string,
  signal?: AbortSignal | null,
): Promise<Problem | null> {
  const settled = await settle(
    apiClient.DELETE("/api/v1/users/{user_id}", {
      params: { path: { user_id: userId } },
      headers: { "idempotency-key": idempotencyKey },
      signal: signal ?? null,
    }) as Promise<RawResult<undefined>>,
  );
  return "problem" in settled ? settled.problem : null;
}

export async function fetchUserHistory(
  userId: string,
  page: number,
  signal?: AbortSignal | null,
): Promise<{ items: UserEventView[]; total: number; page: number; page_size: number } | Problem> {
  const settled = await settle(
    apiClient.GET("/api/v1/users/{user_id}/history", {
      params: { path: { user_id: userId }, query: { page } },
      signal: signal ?? null,
    }) as Promise<RawResult<{ items: UserEventView[]; total: number; page: number; page_size: number }>>,
  );
  return "problem" in settled ? settled.problem : settled.data;
}

/**
 * Initial route after login (API-02 «Начальные маршруты»): ADMIN works in the
 * administration section; VET/HEAD go straight into their current laboratory;
 * ANALYST selects one laboratory first. Without any laboratory scope the
 * honest no-products state is the profile.
 */
export function initialRouteFor(user: UserView, contexts: ScopeView[]): string {
  if (user.role === "ADMIN") return "/users";
  if (user.role === "ANALYST") return "/labs";
  const lab = contexts.find((scope) => scope.laboratory_id !== null)?.laboratory_id;
  if (lab !== undefined && lab !== null) return `/labs/${lab}/arrivals?queue=expected`;
  return "/profile";
}

/** Human-readable role names for the interface. */
export const ROLE_LABELS: Readonly<Record<UserRole, string>> = Object.freeze({
  VET: "Ветврач",
  HEAD: "Заведующий",
  ADMIN: "Администратор",
  ANALYST: "Аналитик",
});

/** Stable Russian problem text for common login outcomes (FT-ACC-01). */
export function loginProblemText(problem: Problem): string {
  if (problem.code === "INVALID_CREDENTIALS") return "Неверный логин или пароль.";
  if (problem.code === "ACCOUNT_BLOCKED")
    return "Учётная запись заблокирована администратором. Вход недоступен.";
  if (problem.code === "LOGIN_RATE_LIMITED") return "Слишком много попыток входа. Повторите позже.";
  return problem.detail !== "" ? problem.detail : "Не удалось выполнить вход.";
}
