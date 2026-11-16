/**
 * User creation form tests (DR34 §13.2, FT-ACC-09/FT-ADM-01): server options
 * become names, no UUID field exists anywhere, server Problems bind to their
 * fields and the secrets never outlive the submit.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserCreateForm, type UserCreatePayload } from "./UserCreateForm";
import type { AssignableOptions } from "./api";

const LAB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEAT = "11111111-1111-4111-8111-111111111111";
const DISTRICT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const OPTIONS: AssignableOptions = {
  roles: [
    {
      role: "VET",
      label: "Ветеринарный врач",
      territories: [],
      laboratories: [{ laboratory_id: LAB, name: "Лаборатория ВСЭ №1 г. Казань", territory_id: DISTRICT }],
      product_areas: [{ product_area_id: MEAT, name: "Свинина" }],
      max_laboratories: null,
    },
    {
      role: "ADMIN",
      label: "Администратор",
      territories: [{ territory_id: DISTRICT, name: "Альметьевский район" }],
      laboratories: [],
      product_areas: [],
      max_laboratories: null,
    },
  ],
};

function fillBase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return (async () => {
    await user.type(screen.getByLabelText(/ФИО/), "Новый Ветеринарный");
    await user.type(screen.getByLabelText("Логин *"), "novyy");
    await user.type(screen.getByLabelText("Пароль *"), "initial-password-1");
    await user.type(screen.getByLabelText("Повторите пароль *"), "initial-password-1");
    await user.type(screen.getByLabelText("Email *"), "novyy@example.test");
  })();
}

describe("UserCreateForm", () => {
  it("sends named selections as server ids without any UUID field", async () => {
    const submitted: { payload: UserCreatePayload; keys: string[] } = { payload: null as never, keys: [] };
    const onSubmit = vi.fn(async (payload: UserCreatePayload, key: string) => {
      submitted.keys.push(key);
      submitted.payload = payload;
      return null;
    });
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "VET");
    await user.selectOptions(screen.getByLabelText("Лаборатория *"), LAB);
    await user.selectOptions(screen.getByLabelText("Тип продукции *"), MEAT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted.payload).toMatchObject({
      full_name: "Новый Ветеринарный",
      login: "novyy",
      role: "VET",
      scopes: [{ laboratory_id: LAB, product_scope_id: MEAT }],
      position: null,
    });
    expect(screen.queryByLabelText(/UUID/)).toBeNull();
  });

  it("repeats the same intent key on network uncertainty, then starts a new one", async () => {
    const keys: string[] = [];
    let calls = 0;
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, key: string) => {
      keys.push(key);
      calls += 1;
      if (calls === 1) {
        return {
          type: "about:blank",
          title: "Network unavailable",
          status: 503,
          detail: "Сеть недоступна.",
          code: "NETWORK_UNAVAILABLE",
          errors: [],
        };
      }
      return null;
    });
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Сеть недоступна.")).toBeInTheDocument();
    // The unchanged intent repeats the SAME key (DR34 §9).
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(keys[1]).toBe(keys[0]);
    // A changed input starts a new intent with a new key (the secrets were
    // cleared by the successful submit, so they are entered again).
    await user.type(screen.getByLabelText("Пароль *"), "initial-password-2");
    await user.type(screen.getByLabelText("Повторите пароль *"), "initial-password-2");
    await user.type(screen.getByLabelText("Логин *"), "2");
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("creates an ADMIN from the territory select and never sends stale scope fields", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => null);
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    expect(screen.queryByLabelText("Лаборатория *")).toBeNull();
    expect(screen.queryByLabelText("Тип продукции *")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      role: "ADMIN",
      territory_id: DISTRICT,
      scopes: [],
    });
  });

  it("clears incompatible selections when the role changes and asks before losing an area", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => null);
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "VET");
    await user.selectOptions(screen.getByLabelText("Лаборатория *"), LAB);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    // §7.4: the chosen area would be lost — the form asks first.
    expect(await screen.findByText("Изменить роль пользователя?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.queryByLabelText("Лаборатория *")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // No stale scope field rides along with the ADMIN payload.
    expect(Object.keys(onSubmit.mock.calls[0][0].scopes ?? {})).toHaveLength(0);
  });

  it("binds a duplicate login to the login field and keeps the typed input", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => ({
      type: "about:blank",
      title: "Already exists",
      status: 409,
      detail: "Логин уже занят.",
      code: "ALREADY_EXISTS",
      errors: [],
    }));
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(screen.getByText("Такой логин уже занят.")).toBeInTheDocument());
    expect(screen.getByLabelText("Логин *")).toHaveValue("novyy");
  });

  it("binds server field errors by Problem.errors.path", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => ({
      type: "about:blank",
      title: "Validation error",
      status: 422,
      detail: "Запрос не прошёл проверку.",
      code: "VALIDATION_ERROR",
      errors: [{ path: "scopes.0.laboratory_id", message: "Лаборатория не найдена." }],
    }));
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "VET");
    await user.selectOptions(screen.getByLabelText("Лаборатория *"), LAB);
    await user.selectOptions(screen.getByLabelText("Тип продукции *"), MEAT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(screen.getByText("Лаборатория не найдена.")).toBeInTheDocument());
  });

  it("reports a 403 without disclosing foreign areas", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => ({
      type: "about:blank",
      title: "Access denied",
      status: 403,
      detail: "Доступ запрещён.",
      code: "ACCESS_DENIED",
      errors: [],
    }));
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() =>
      expect(screen.getByText(/Недостаточно прав для создания пользователя/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Лаборатория ВСЭ|foreign/i)).toBeNull();
  });

  it("clears the secrets after a successful submit", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => null);
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.selectOptions(screen.getByLabelText("Роль *"), "ADMIN");
    await user.selectOptions(screen.getByLabelText("Территория назначения *"), DISTRICT);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByLabelText("Пароль *")).toHaveValue("");
    expect(screen.getByLabelText("Повторите пароль *")).toHaveValue("");
  });

  it("requires the human-readable selections instead of UUIDs", async () => {
    const onSubmit = vi.fn(async (_payload: UserCreatePayload, _key: string) => null);
    render(<UserCreateForm options={OPTIONS} onSubmit={onSubmit} onCancel={() => {}} />);
    const user = userEvent.setup();
    await fillBase(user);
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(screen.getByText("Выберите лабораторию.")).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
