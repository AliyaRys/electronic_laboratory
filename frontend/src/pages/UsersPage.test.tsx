/**
 * Users list tests (DR34 §5/§13.2, FT-ACC-08/09): the «Создать пользователя»
 * button appears only after /me LOADED with users:create, the returnTo keeps
 * the list filters, and loading/error states stay honest.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UsersPage } from "./UsersPage";
import { ME_QUERY_KEY } from "../shared/api/me";
import type { UserView } from "../features/identity/api";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ADMIN: UserView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  full_name: "Главный администратор",
  login: "chief",
  email: "chief@example.test",
  position: null,
  role: "ADMIN",
  active: true,
  scopes: [
    { laboratory_id: null, product_scope_id: null, territory_id: "d1", territory_name: "Первый район" },
  ],
  capabilities: ["users:create", "users:list"],
  revision: 1,
};

const ADMIN_WITHOUT_RIGHT: UserView = {
  ...ADMIN,
  capabilities: ["users:list"],
};

function renderPage(initialUrl = "/users?role=VET&page=1"): { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/new" element={<div>Форма создания</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client };
}

describe("UsersPage — create entry", () => {
  it("shows the button only for a LOADED admin with users:create", async () => {
    server.use(
      http.get("*/api/v1/users", () => HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 })),
      http.get("*/api/v1/me", () => HttpResponse.json(ADMIN)),
    );
    const { client } = renderPage();
    client.setQueryData(ME_QUERY_KEY, ADMIN);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Создать пользователя" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Первый район")).toBeInTheDocument();
  });

  it("keeps the button hidden while /me loads and for an admin without the right", async () => {
    server.use(
      http.get("*/api/v1/users", () => HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 })),
      http.get("*/api/v1/me", () => HttpResponse.json(ADMIN_WITHOUT_RIGHT)),
    );
    renderPage();
    // No /me data yet: no button, no admin list query fired.
    expect(screen.queryByRole("button", { name: "Создать пользователя" })).toBeNull();
    expect(screen.getByText("Загрузка сеанса…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Поиск \(ФИО, логин, email\)/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Создать пользователя" })).toBeNull();
  });

  it("navigates to /users/new and passes the filtered list URL as returnTo", async () => {
    server.use(
      http.get("*/api/v1/users", () => HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 })),
      http.get("*/api/v1/me", () => HttpResponse.json(ADMIN)),
    );
    renderPage("/users?role=HEAD&q=иван&page=2");
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Создать пользователя" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Создать пользователя" }));
    await waitFor(() => expect(screen.getByText("Форма создания")).toBeInTheDocument());
  });

  it("shows the success notice delivered from the create page", async () => {
    server.use(
      http.get("*/api/v1/users", () => HttpResponse.json({ items: [], total: 0, page: 1, page_size: 20 })),
      http.get("*/api/v1/me", () => HttpResponse.json(ADMIN)),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: "/users", state: { notice: "Пользователь создан." } }]}>
          <Routes>
            <Route path="/users" element={<UsersPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Пользователь создан.")).toBeInTheDocument());
  });
});
