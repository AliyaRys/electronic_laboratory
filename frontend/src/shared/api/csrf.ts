/**
 * CSRF token holder (API-01, SPEC-05).
 *
 * The token is issued by ``GET /api/v1/auth/csrf`` (bootstrap) and refreshed by
 * the login response. It is held in memory only — persisting session material
 * to localStorage/sessionStorage is forbidden by ТЗ-02. The token is also set
 * by the backend as a non-HttpOnly cookie scoped to ``/api/v1``; the cookie is
 * the fallback when the store is empty (for example after a full page load
 * before a new bootstrap fetch).
 */

let token: string | null = null;

export function setCsrfToken(next: string | null): void {
  token = next;
}

export function getCsrfToken(): string {
  if (token !== null) {
    return token;
  }
  const cookie = readCsrfCookie();
  return cookie ?? "";
}

function readCsrfCookie(): string | null {
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("vse_csrf="));
  return match ? decodeURIComponent(match.slice("vse_csrf=".length)) : null;
}

export function clearCsrfToken(): void {
  token = null;
}
