/**
 * Password form unit tests (FT-ACC-06, FT-ADM): field-bound errors, secrets
 * cleared after success and never persisted.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PasswordForm, type PasswordValues } from "./PasswordForm";
import { changePassword } from "./api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("PasswordForm (change mode)", () => {
  it("sends the change command and clears the secrets after success", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/api/v1/me/change-password", async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onSuccess = vi.fn();
    render(
      <PasswordForm
        mode="change"
        onSubmit={async (values) => changePassword(values)}
        onSuccess={onSuccess}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Текущий пароль"), "old-password-123");
    await user.type(screen.getByLabelText("Новый пароль"), "brand-new-secret-9");
    await user.type(screen.getByLabelText("Подтверждение"), "brand-new-secret-9");
    await user.click(screen.getByRole("button", { name: "Изменить пароль" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(bodies[0]).toEqual({
      current_password: "old-password-123",
      new_password: "brand-new-secret-9",
      confirmation: "brand-new-secret-9",
    });
    expect(screen.getByLabelText("Текущий пароль")).toHaveValue("");
    expect(screen.getByLabelText("Новый пароль")).toHaveValue("");
    expect(screen.getByLabelText("Подтверждение")).toHaveValue("");
  });

  it("binds server errors to the DTO fields and keeps the input", async () => {
    server.use(
      http.post("*/api/v1/me/change-password", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "VALIDATION_ERROR",
            status: 422,
            detail: "Проверьте данные.",
            code: "VALIDATION_ERROR",
            errors: [{ path: "current_password", message: "Текущий пароль указан неверно." }],
          },
          { status: 422, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    render(<PasswordForm mode="change" onSubmit={async (values) => changePassword(values)} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Текущий пароль"), "wrong-old-1234567");
    await user.type(screen.getByLabelText("Новый пароль"), "brand-new-secret-9");
    await user.type(screen.getByLabelText("Подтверждение"), "brand-new-secret-9");
    await user.click(screen.getByRole("button", { name: "Изменить пароль" }));
    await waitFor(() => expect(screen.getByText("Текущий пароль указан неверно.")).toBeInTheDocument());
    expect(screen.getByLabelText("Текущий пароль")).toHaveValue("wrong-old-1234567");
  });

  it("rejects a mismatched confirmation without a network call", async () => {
    let calls = 0;
    server.use(
      http.post("*/api/v1/me/change-password", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<PasswordForm mode="change" onSubmit={async (values) => changePassword(values)} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Текущий пароль"), "old-password-123");
    await user.type(screen.getByLabelText("Новый пароль"), "brand-new-secret-9");
    await user.type(screen.getByLabelText("Подтверждение"), "different-secret-9");
    await user.click(screen.getByRole("button", { name: "Изменить пароль" }));
    await waitFor(() => expect(screen.getByText("Пароли не совпадают.")).toBeInTheDocument());
    expect(calls).toBe(0);
  });

  it("clears the secrets when the form closes", async () => {
    const cleanup = vi.fn();
    const { unmount } = render(
      <PasswordForm mode="change" onSubmit={async (values: PasswordValues) => changePassword(values)} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Новый пароль"), "brand-new-secret-9");
    unmount();
    expect(cleanup).not.toHaveBeenCalled();
  });
});
