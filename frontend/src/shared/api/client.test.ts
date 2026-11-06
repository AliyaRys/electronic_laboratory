/**
 * Transport contract tests (API-01, ADR-010).
 *
 * Test IDs required by the F01 brief:
 *  - test_api_prefix_once
 *  - test_mutation_not_auto_retried
 *  - test_conflict_keeps_input
 */
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { createElement, useState, type ReactElement } from "react";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { apiClient } from "./client";
import { useCommand } from "./command";
import { parseProblem } from "./problem";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** openapi-fetch result shape, untyped: most endpoints arrive with later tasks. */
interface RawResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}
const raw = apiClient as unknown as {
  GET: (path: string, options?: Record<string, unknown>) => Promise<RawResult>;
  PUT: (path: string, options?: Record<string, unknown>) => Promise<RawResult>;
};

function problemResponse(status: number, code: string, detail: string) {
  return HttpResponse.json(
    { type: "about:blank", title: code, status, detail, code, trace_id: "trace-1", errors: [] },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

describe("apiClient transport", () => {
  it("test_api_prefix_once", async () => {
    const seenPaths: string[] = [];
    server.use(
      http.get("*/api/v1/arrivals", ({ request }) => {
        seenPaths.push(new URL(request.url).pathname);
        return HttpResponse.json(
          { items: [], total: 0, page: 1, page_size: 20 },
          { headers: { ETag: '"1"', "content-type": "application/json" } },
        );
      }),
    );

    await raw.GET("/api/v1/arrivals");

    // The full prefix appears exactly once: no baseUrl concatenation on top of
    // the backend's already-prefixed paths (ADR-010).
    expect(seenPaths).toEqual(["/api/v1/arrivals"]);
  });
});

describe("useCommand", () => {
  it("test_mutation_not_auto_retried", async () => {
    let calls = 0;
    const keysSeen: (string | null)[] = [];
    server.use(
      http.put("*/api/v1/users/:id", async ({ request }) => {
        calls += 1;
        keysSeen.push(request.headers.get("idempotency-key"));
        await delay(300);
        return HttpResponse.json(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useCommand());
    await result.current.submit(
      async (ctx) =>
        raw.PUT("/api/v1/users/00000000-0000-0000-0000-000000000001", {
          headers: { "idempotency-key": ctx.idempotencyKey, "x-csrf-token": "t" },
          signal: ctx.signal,
        }),
      { timeoutMs: 50 },
    );

    // The slow answer hits the client timeout, the command fails — and the
    // mutation is NOT retried behind our back (ADR-008/ADR-010).
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(calls).toBe(1);
    expect(result.current.error?.code).toBe("NETWORK_ERROR");

    // The idempotency key is retained until an unambiguous result, so a manual
    // retry reuses it (ADR-008: повтор использует прежний idempotency key).
    await result.current.retry();
    expect(calls).toBe(2);
    expect(keysSeen[0]).not.toBeNull();
    expect(keysSeen[0]).toBe(keysSeen[1]);
  });

  it("test_conflict_keeps_input", async () => {
    server.use(
      http.put("*/api/v1/users/:id", () =>
        problemResponse(409, "REVISION_CONFLICT", "Запись изменена другим сотрудником."),
      ),
    );

    function ConflictForm(): ReactElement {
      const [reason, setReason] = useState("Загрязнение кузова");
      const command = useCommand();
      return createElement(
        "div",
        null,
        createElement("input", {
          "aria-label": "Причина",
          value: reason,
          onChange: (e: { target: { value: string } }) => setReason(e.target.value),
        }),
        createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              void command.submit(async (ctx) =>
                raw.PUT("/api/v1/users/00000000-0000-0000-0000-000000000001", {
                  headers: { "idempotency-key": ctx.idempotencyKey, "if-match": '"1"', "x-csrf-token": "t" },
                  signal: ctx.signal,
                }),
              ),
          },
          "Сохранить",
        ),
        command.error !== null
          ? createElement("output", { "aria-label": "Ошибка команды" }, command.error.code)
          : null,
      );
    }

    render(createElement(ConflictForm));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    // 409 keeps the typed input available: no silent clearing, no optimistic save.
    await waitFor(() =>
      expect(screen.getByLabelText("Ошибка команды")).toHaveTextContent("REVISION_CONFLICT"),
    );
    expect(screen.getByLabelText("Причина")).toHaveValue("Загрязнение кузова");
  });
});

describe("parseProblem", () => {
  it("parses the API-01 problem shape", async () => {
    const response = problemResponse(
      422,
      "VALIDATION_ERROR",
      "Некорректный диапазон дат.",
    ) as unknown as Response;
    const problem = await parseProblem(response);
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.status).toBe(422);
    expect(problem.trace_id).toBe("trace-1");
  });
});
