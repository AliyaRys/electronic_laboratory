/**
 * User editor unit tests (FT-ACC-09): idempotent create with scopes, server
 * errors bound to fields, secrets cleared after success.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UserEditor } from "./UserEditor";
import { createUser } from "./api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LAB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "11111111-1111-4111-8111-111111111111";

describe("UserEditor", () => {
  it("creates a user with the scope list and an idempotency key", async () => {
    const headersSeen: (string | null)[] = [];
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/users", async ({ request }) => {
        headersSeen.push(request.headers.get("idempotency-key"));
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            full_name: "Новый Ветеринарный",
            login: "novyy",
            email: "novyy@e2e.test",
            position: null,
            role: "VET",
            active: true,
            scopes: [{ laboratory_id: LAB, product_scope_id: PRODUCT }],
            capabilities: [],
            revision: 1,
          },
          {
            status: 201,
            headers: { ETag: '"1"', Location: "/api/v1/users/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          },
        );
      }),
    );
    const onSuccess = vi.fn();
    render(
      <UserEditor
        mode="create"
        onSubmit={async (parsed) => {
          const result = await createUser(parsed, crypto.randomUUID());
          return "code" in result ? result : null;
        }}
        onSuccess={onSuccess}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("ФИО"), "Новый Ветеринарный");
    await user.type(screen.getByLabelText("Логин"), "novyy");
    await user.type(screen.getByLabelText("Email"), "novyy@e2e.test");
    await user.type(screen.getByLabelText("Лаборатория (UUID)"), LAB);
    await user.type(screen.getByLabelText("Продукция (UUID, необязательно)"), PRODUCT);
    await user.type(screen.getByLabelText("Пароль"), "initial-password-1");
    await user.type(screen.getByLabelText("Подтверждение пароля"), "initial-password-1");
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(headersSeen[0]).not.toBeNull();
    expect(body).toMatchObject({
      full_name: "Новый Ветеринарный",
      login: "novyy",
      role: "VET",
      scopes: [{ laboratory_id: LAB, product_scope_id: PRODUCT }],
    });
    // The secrets never outlive the submit (ТЗ-02).
    expect(screen.getByLabelText("Пароль")).toHaveValue("");
  });

  it("binds a duplicate login to the login field", async () => {
    server.use(
      http.post("*/api/v1/users", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "ALREADY_EXISTS",
            status: 409,
            detail: "Логин уже занят.",
            code: "ALREADY_EXISTS",
            errors: [],
          },
          { status: 409, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    render(
      <UserEditor
        mode="create"
        onSubmit={async (parsed) => {
          const result = await createUser(parsed, crypto.randomUUID());
          return "code" in result ? result : null;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("ФИО"), "Новый Ветеринарный");
    await user.type(screen.getByLabelText("Логин"), "novyy");
    await user.type(screen.getByLabelText("Email"), "novyy@e2e.test");
    await user.type(screen.getByLabelText("Пароль"), "initial-password-1");
    await user.type(screen.getByLabelText("Подтверждение пароля"), "initial-password-1");
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(screen.getByText("Такой логин уже занят.")).toBeInTheDocument());
    // The input is kept for correction (FT-COM-03).
    expect(screen.getByLabelText("Логин")).toHaveValue("novyy");
  });

  it("adds and removes scope rows", async () => {
    render(
      <UserEditor
        mode="create"
        onSubmit={async (parsed) => {
          const result = await createUser(parsed, crypto.randomUUID());
          return "code" in result ? result : null;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Добавить назначение" }));
    expect(screen.getAllByLabelText("Лаборатория (UUID)")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Убрать" })[0]);
    expect(screen.getAllByLabelText("Лаборатория (UUID)")).toHaveLength(1);
  });
});
