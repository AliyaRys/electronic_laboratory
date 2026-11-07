/**
 * Login form unit tests (FT-ACC-01, rate limit 429 via MSW — never the real
 * backend, which would lock the IP for 15 minutes).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LoginForm, runLogin, type LoginValues } from "./LoginForm";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function problem(status: number, code: string, detail: string): Response {
  return HttpResponse.json(
    { type: "about:blank", title: code, status, detail, code, trace_id: "t1", errors: [] },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** The real command runs; MSW answers, so the transport path is covered. */
function harness(): void {
  render(<LoginForm onSubmit={async (values: LoginValues) => runLogin(values)} />);
}

describe("LoginForm", () => {
  it("bootstraps the anonymous CSRF cookie exactly once", async () => {
    let csrfCalls = 0;
    server.use(
      http.get("*/api/v1/auth/csrf", () => {
        csrfCalls += 1;
        return HttpResponse.json({ csrf_token: "t" });
      }),
    );
    harness();
    await waitFor(() => expect(csrfCalls).toBe(1));
  });

  it("shows the stable 429 rate-limit text without touching the real backend", async () => {
    server.use(
      http.get("*/api/v1/auth/csrf", () => HttpResponse.json({ csrf_token: "t" })),
      http.post("*/api/v1/auth/login", () =>
        problem(429, "LOGIN_RATE_LIMITED", "Слишком много попыток входа."),
      ),
    );
    harness();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Логин"), "someone");
    await user.type(screen.getByLabelText("Пароль"), "whatever-long-enough");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText(/Слишком много попыток входа/)).toBeInTheDocument());
  });

  it("keeps the login and clears the secret after INVALID_CREDENTIALS", async () => {
    server.use(
      http.get("*/api/v1/auth/csrf", () => HttpResponse.json({ csrf_token: "t" })),
      http.post("*/api/v1/auth/login", () =>
        problem(401, "INVALID_CREDENTIALS", "Неверный логин или пароль."),
      ),
    );
    harness();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Логин"), "e2e-admin");
    await user.type(screen.getByLabelText("Пароль"), "wrong-password-123");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText("Неверный логин или пароль.")).toBeInTheDocument());
    expect(screen.getByLabelText("Логин")).toHaveValue("e2e-admin");
    expect(screen.getByLabelText("Пароль")).toHaveValue("");
  });

  it("explains a blocked account instead of the generic failure", async () => {
    server.use(
      http.get("*/api/v1/auth/csrf", () => HttpResponse.json({ csrf_token: "t" })),
      http.post("*/api/v1/auth/login", () =>
        problem(403, "ACCOUNT_BLOCKED", "Учётная запись заблокирована."),
      ),
    );
    harness();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Логин"), "e2e-blocked");
    await user.type(screen.getByLabelText("Пароль"), "whatever-long-enough");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(screen.getByText(/Учётная запись заблокирована/)).toBeInTheDocument());
  });

  it("requires both fields with Zod before sending anything", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/auth/csrf", () => HttpResponse.json({ csrf_token: "t" })),
      http.post("*/api/v1/auth/login", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    harness();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("Укажите логин.")).toBeInTheDocument();
    expect(screen.getByText("Укажите пароль.")).toBeInTheDocument();
    expect(calls).toBe(0);
  });
});
