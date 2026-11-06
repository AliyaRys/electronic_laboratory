/**
 * Single API transport (ADR-010): openapi-fetch with an empty baseUrl
 * (same-origin) and generated types from the backend OpenAPI document.
 *
 * The backend paths already contain the full ``/api/v1`` prefix and the
 * OpenAPI ``servers`` field is ``/``, so nothing is concatenated twice. This
 * module is the only fetch layer: no page code calls ``fetch`` directly.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { getCsrfToken } from "./csrf";

export const SESSION_EXPIRED_EVENT = "vse:session-expired";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const middleware: Middleware = {
  onRequest({ request }) {
    if (MUTATION_METHODS.has(request.method.toUpperCase())) {
      request.headers.set("x-csrf-token", getCsrfToken());
    }
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) {
      // 401 leaves the working context: the session layer clears the cache and
      // closed forms (SPEC-05). Dispatched here so every consumer shares it.
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: response.status }));
    }
    return response;
  },
};

export const apiClient = createClient<paths>({ baseUrl: testBaseUrl(), fetch: lazyFetch });

/**
 * Resolve the global fetch at call time so interception (MSW in tests, service
 * workers in dev) always sees the current global.
 */
function lazyFetch(request: Request, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(request, init);
}

/**
 * The application uses an empty baseUrl (same-origin relative paths, ADR-010).
 * Under Vitest/jsdom fetch requires an absolute URL, so the test environment
 * points at the local origin instead — the shipped build keeps "".
 */
function testBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return "http://localhost";
  }
  return "";
}
apiClient.use(middleware);
