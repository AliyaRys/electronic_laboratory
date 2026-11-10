/**
 * Catalogs overview (DR4 §7): without a selected tab the route is the
 * directories.html composition — three cards in the mockup order, each with
 * only the REAL action (no fake delete). Unknown tabs fall back to the safe
 * overview; the deep-link paths /catalogs/methods and /catalogs/tariffs keep
 * opening their sections.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQueryClient } from "../app/providers";
import { CatalogsPage } from "./CatalogsPage";

const me = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Ольга Заведующая",
  login: "head",
  email: "head@lab.tatar",
  position: null,
  role: "HEAD",
  active: true,
  scopes: [],
  capabilities: ["catalog:write"],
  revision: 1,
};

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () => HttpResponse.json([])),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

function renderCatalogs(path: string): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <CatalogsPage /> },
      { path: "/catalogs/methods", element: <CatalogsPage /> },
      { path: "/catalogs/tariffs", element: <CatalogsPage /> },
      { path: "/login", element: <p>Вход</p> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("CatalogsPage overview", () => {
  it("renders the three directory cards in the mockup order", async () => {
    renderCatalogs("/catalogs");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Управление справочниками" })).toBeInTheDocument(),
    );
    const names = screen
      .getAllByTestId(/^catalog-card-/)
      .map((card) => card.querySelector(".vse-catalog-item-name")?.textContent);
    expect(names).toEqual(["Стоимость исследований ВСЭ", "Платные услуги", "Нормы исследований"]);
    // Only real actions: three «Редактировать» buttons, no delete.
    expect(screen.getAllByRole("button", { name: "Редактировать" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Удалить/ })).toBeNull();
  });

  it("an unknown tab is the safe overview fallback", async () => {
    renderCatalogs("/catalogs?tab=unknown");
    await waitFor(() => expect(screen.getByTestId("catalog-overview")).toBeInTheDocument());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("the deep-link path opens the methods section with the active pill", async () => {
    renderCatalogs("/catalogs/methods");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Справочники" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Нормы исследований" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Выберите лабораторию и вид продукции.")).toBeInTheDocument();
  });

  it("«Редактировать» keeps the scope in the query and opens the editor", async () => {
    const act = userEvent.setup();
    renderCatalogs("/catalogs?laboratory_id=11111111-2222-4333-8444-555555555555");
    await waitFor(() => expect(screen.getByTestId("catalog-overview")).toBeInTheDocument());
    await act.click(
      within(screen.getByTestId("catalog-card-tariffs")).getByRole("button", { name: "Редактировать" }),
    );
    expect(screen.getByRole("heading", { name: "Справочники" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Стоимость исследований" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
