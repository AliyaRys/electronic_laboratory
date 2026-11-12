/**
 * «Платные услуги» editor page (ТЗ-DR6 §17.3; owner decision DR14): exactly
 * two price cards with the fixed CHECK service codes, read/create/update
 * through the laboratory-scoped tariff API, NO product species anywhere,
 * no CheckServiceRule editor, no CheckServiceRule request on save, absence
 * shown as «Не настроено», no bulk command.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../app/providers";
import type { UserView } from "../../shared/api/me";
import type { TariffView } from "./api";
import { CheckServicesEditorPage } from "./CheckServicesEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const PRODUCT_IDENTIFICATION = "PRODUCT_IDENTIFICATION";
const TRANSPORT_INSPECTION = "TRANSPORT_INSPECTION";

const me: UserView = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Ольга Заведующая",
  login: "head",
  email: "head@lab.tatar",
  position: null,
  role: "HEAD",
  active: true,
  scopes: [{ laboratory_id: LAB, product_scope_id: SPECIES }],
  capabilities: ["catalog:create", "catalog:update", "catalog:delete"],
  revision: 1,
};

function tariff(overrides: Partial<TariffView>): TariffView {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: null,
    service_code: PRODUCT_IDENTIFICATION,
    unit_id: "услуга",
    price: "40.00",
    version: 1,
    source: { name: "прейскурант" },
    revision: 2,
    ...overrides,
  };
}

const putSpy = vi.fn();
const postSpy = vi.fn();
const checkRulesSpy = vi.fn();

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/tariffs", () =>
    HttpResponse.json({
      items: [
        tariff({}),
        tariff({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          service_code: TRANSPORT_INSPECTION,
          price: "94.00",
        }),
      ],
      total: 2,
      page: 1,
      page_size: 50,
    }),
  ),
  http.get("*/api/v1/catalogs/check-services", () => {
    checkRulesSpy();
    return HttpResponse.json({
      items: [
        {
          id: "dddddddd-0000-4000-8000-000000000001",
          service_code: PRODUCT_IDENTIFICATION,
          unit_id: "service",
          multiplier_basis: "ONE_SERVICE",
          applicable_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
          version: 1,
          source: { name: "правило" },
          revision: 1,
        },
        {
          id: "dddddddd-0000-4000-8000-000000000002",
          service_code: TRANSPORT_INSPECTION,
          unit_id: "service",
          multiplier_basis: "ONE_SERVICE",
          applicable_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
          version: 1,
          source: { name: "правило" },
          revision: 1,
        },
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });
  }),
  http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
    putSpy(await request.clone().json());
    return HttpResponse.json(tariff({ price: "55.00", revision: 3 }));
  }),
  http.post("*/api/v1/catalogs/tariffs", async ({ request }) => {
    const body = (await request.clone().json()) as Record<string, unknown>;
    postSpy(body);
    return HttpResponse.json(tariff({ service_code: String(body.service_code), price: String(body.price) }), {
      status: 201,
    });
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  putSpy.mockClear();
  postSpy.mockClear();
  checkRulesSpy.mockClear();
  server.resetHandlers();
});

function renderEditor(): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <CheckServicesEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [`/catalogs?tab=check-services&laboratory_id=${LAB}`] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const NAME_1 = "Идентификация продукции по наименованию и визуальным осмотром";
const NAME_2 = "Ветеринарно-санитарная оценка и идентификация транспорта";

describe("CheckServicesEditorPage", () => {
  it("shows exactly the two CHECK price cards and never the rule editor", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Платные услуги" })).toBeInTheDocument());
    expect(await screen.findByLabelText(`Стоимость: ${NAME_1}, ₽`)).toHaveValue("40.00");
    expect(screen.getByLabelText(`Стоимость: ${NAME_2}, ₽`)).toHaveValue("94.00");
    expect(checkRulesSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Применить стоимость к лабораториям" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить правило" })).toBeNull();
  });

  it("saves the price through the tariff API only (no CheckServiceRule write)", async () => {
    const act = userEvent.setup();
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${NAME_1}, ₽`);
    await act.clear(input);
    await act.type(input, "55,00");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { service_code: string; price: string };
    expect(payload.service_code).toBe(PRODUCT_IDENTIFICATION);
    expect(payload.price).toBe("55.00");
    expect(checkRulesSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent("Справочник сохранён."),
    );
  });

  it("an absent CHECK price is a configuration gap shown as «Не настроено»", async () => {
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({ items: [tariff({})], total: 1, page: 1, page_size: 50 }),
      ),
    );
    renderEditor();
    expect(await screen.findByLabelText(`Стоимость: ${NAME_2}, ₽`)).toHaveValue("");
    expect(screen.getByText("Не настроено")).toBeInTheDocument();
  });

  it("creates a missing service price without unit or source inputs", async () => {
    const act = userEvent.setup();
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 }),
      ),
    );
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${NAME_1}, ₽`);
    expect(screen.queryByText("Данные новой записи (единица, источник)")).toBeNull();
    expect(screen.queryByLabelText("Единица измерения")).toBeNull();
    expect(screen.queryByLabelText("Источник прейскуранта")).toBeNull();
    await act.type(input, "45");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]).toMatchObject({
      service_code: PRODUCT_IDENTIFICATION,
      unit_id: "RUB",
      price: "45",
      version: 1,
      source: { name: "Ручная настройка справочника" },
    });
  });

  it("shows only the laboratory context and no species anywhere (owner DR14)", async () => {
    renderEditor();
    expect(await screen.findByTestId("check-services-laboratory")).toHaveTextContent(
      "Лаборатория: Лаборатория №1 г. Казань",
    );
    expect(screen.queryByTestId("check-services-species")).toBeNull();
    expect(screen.queryByText(/Вид продукции/)).toBeNull();
    expect(screen.queryByText(/Продукция/)).toBeNull();
  });

  it("keeps the editor usable when the scope carries no real species (owner DR14)", async () => {
    // The legacy assignment fallback: the product scope holds the LABORATORY
    // id. The CHECK directory ignores the species entirely — the editor stays
    // usable and prices are saved into the laboratory scope.
    server.use(
      http.get("*/api/v1/contexts", () =>
        HttpResponse.json([
          { laboratory_id: LAB, product_scope_id: LAB, laboratory_name: "Лаборатория №1 г. Казань" },
        ]),
      ),
    );
    const act = userEvent.setup();
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${NAME_1}, ₽`);
    await act.clear(input);
    await act.type(input, "55,00");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.product_species_id).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent("Справочник сохранён."),
    );
  });

  it("saves the create payload without a species (owner DR14)", async () => {
    const act = userEvent.setup();
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 }),
      ),
    );
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${NAME_1}, ₽`);
    await act.type(input, "45");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]).toMatchObject({
      laboratory_id: LAB,
      service_code: PRODUCT_IDENTIFICATION,
      unit_id: "RUB",
      price: "45",
      version: 1,
      source: { name: "Ручная настройка справочника" },
    });
    expect(postSpy.mock.calls[0][0]).not.toHaveProperty("product_species_id");
  });
});
