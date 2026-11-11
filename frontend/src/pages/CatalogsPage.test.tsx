/**
 * Catalogs overview + editor routing (DR6 §7): without a tab the route is the
 * directories.html composition; each editor tab renders its dedicated editor
 * page and the scope stays in the query. A HEAD without an assigned
 * laboratory gets the honest blocking configuration state, never a silent
 * first laboratory.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
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

/** Reflects the CURRENT router location so tests can assert the real URL. */
function RouteProbe(): React.ReactElement {
  const location = useLocation();
  return <span data-testid="route-probe">{location.pathname + location.search}</span>;
}

function renderCatalogs(path: string): void {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <RouteProbe />
            <CatalogsPage />
          </>
        ),
        path: "/catalogs",
      },
      { path: "/catalogs/methods", element: <CatalogsPage /> },
      { path: "/catalogs/tariffs", element: <CatalogsPage /> },
      { path: "/catalogs/check-services", element: <CatalogsPage /> },
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
  });

  it("«Редактировать» keeps the scope in the query and opens the editor page", async () => {
    const act = userEvent.setup();
    const LAB = "11111111-2222-4333-8444-555555555555";
    const SPECIES = "33333333-3333-4333-8333-333333333333";
    renderCatalogs(`/catalogs?laboratory_id=${LAB}&product_species_id=${SPECIES}`);
    await waitFor(() => expect(screen.getByTestId("catalog-overview")).toBeInTheDocument());
    await act.click(
      within(screen.getByTestId("catalog-card-tariffs")).getByRole("button", { name: "Редактировать" }),
    );
    // The dedicated editor page of DR6 (no pill tabs), with its mockup title.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Нормы исследований" })).toBeNull();
    // The real navigation URL keeps both scope identifiers and sets the tab.
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      new RegExp(`^/catalogs\\?laboratory_id=${LAB}&product_species_id=${SPECIES}&tab=tariffs$`),
    );
  });

  it("a HEAD without any assigned laboratory gets the honest blocking state", async () => {
    renderCatalogs("/catalogs?tab=methods");
    await waitFor(() =>
      expect(
        screen.getByText(
          "Рабочая область не назначена. Обратитесь к администратору, чтобы назначить лабораторию и тип продукции.",
        ),
      ).toBeInTheDocument(),
    );
    // No laboratory selector and no fake data are shown.
    expect(screen.queryByLabelText("Лаборатория")).toBeNull();
  });

  it("no pill-tab strip is rendered on the editor pages", async () => {
    renderCatalogs("/catalogs?tab=check-services");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Платные услуги" })).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Разделы справочников" })).toBeNull();
  });
});
