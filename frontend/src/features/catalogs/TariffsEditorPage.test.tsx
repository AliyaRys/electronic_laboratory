/**
 * «Стоимость исследований ВСЭ» editor page (ТЗ-DR6 §17.1/§17.2):
 * role context (HEAD without a selector, foreign query ignored), honest
 * price states (0.00 valid, absence = «Не настроено»), dirty-only sequential
 * saving with honest partial results, DecimalString without a float, the
 * ADMIN/ANALYST-only bulk command and human-readable names only.
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
import { INDICATORS } from "../examinations/indicators";
import { TariffsEditorPage, normalizeMoneyInput } from "./TariffsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const LAB_B = "22222222-2222-4333-8444-555555555555";

const organoleptic = INDICATORS[0];
const trich = INDICATORS.find((item) => item.code === "VSE-F21") as (typeof INDICATORS)[number];

function tariff(overrides: Partial<TariffView>): TariffView {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    service_code: organoleptic.id,
    unit_id: "шт",
    price: "100.00",
    version: 1,
    source: { name: "прейскурант" },
    revision: 3,
    ...overrides,
  };
}

let me: UserView;
const putSpy = vi.fn();
const tariffsSpy = vi.fn();

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/tariffs", ({ request }) => {
    tariffsSpy(new URL(request.url).searchParams.get("laboratory_id"));
    return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 });
  }),
  http.get("*/api/v1/catalogs/readiness", () => HttpResponse.json({ missing: [] })),
  http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
    putSpy((request.headers.get("if-match"), await request.clone().json()));
    return HttpResponse.json(tariff({ price: "150.00", revision: 4 }));
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  me = {
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
  putSpy.mockClear();
  tariffsSpy.mockClear();
  server.resetHandlers();
});

function renderEditor(search = `/catalogs?tab=tariffs`): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <TariffsEditorPage /> },
      { path: "/catalogs/:any", element: <TariffsEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [search] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("TariffsEditorPage", () => {
  it("HEAD has no laboratory selector and reads its own assigned scope", async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Лаборатория")).toBeNull();
    expect(await screen.findByText(/Лаборатория №1 г\. Казань/)).toBeInTheDocument();
    await waitFor(() => expect(tariffsSpy).toHaveBeenCalledWith(LAB));
    expect(screen.queryByText(new RegExp(LAB.slice(0, 8)))).toBeNull();
  });

  it("a foreign laboratory query does not override the HEAD scope", async () => {
    renderEditor(`/catalogs?tab=tariffs&laboratory_id=${LAB_B}`);
    await waitFor(() => expect(tariffsSpy).toHaveBeenCalledWith(LAB));
    expect(tariffsSpy).not.toHaveBeenCalledWith(LAB_B);
  });

  it("an explicit 0,00 is a valid price and absence shows «Не настроено»", async () => {
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({
          items: [tariff({ price: "0.00" })],
          total: 1,
          page: 1,
          page_size: 50,
        }),
      ),
    );
    renderEditor();
    expect(await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`)).toHaveValue("0.00");
    const unsetInput = screen.getByLabelText(`Стоимость: ${trich.name}, ₽`);
    expect(unsetInput).toHaveValue("");
    expect(screen.getAllByText("Не настроено").length).toBeGreaterThan(0);
  });

  it("saves only dirty cards with a comma accepted and dot wire form", async () => {
    const act = userEvent.setup();
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({
          items: [
            tariff({}),
            tariff({ id: "aaaaaaaa-0000-4000-8000-000000000002", service_code: trich.id, price: "50.00" }),
          ],
          total: 2,
          page: 1,
          page_size: 50,
        }),
      ),
    );
    renderEditor();
    const first = await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`);
    await act.clear(first);
    await act.type(first, "150,50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { price: string };
    expect(payload.price).toBe("150.50");
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent("Справочник сохранён."),
    );
  });

  it("a partial failure stays honest and retry re-sends only the failed card", async () => {
    const act = userEvent.setup();
    let failFirst = true;
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({
          items: [
            tariff({}),
            tariff({ id: "aaaaaaaa-0000-4000-8000-000000000002", service_code: trich.id, price: "50.00" }),
          ],
          total: 2,
          page: 1,
          page_size: 50,
        }),
      ),
      http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
        const body = (await request.clone().json()) as { price: string };
        putSpy(body.price);
        if (body.price === "150.50" && failFirst) {
          failFirst = false;
          return HttpResponse.json(
            {
              code: "REVISION_CONFLICT",
              title: "Revision conflict",
              detail: "Запись была изменена другим пользователем.",
              errors: [],
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(tariff({ price: body.price, revision: 5 }));
      }),
    );
    renderEditor();
    const first = await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`);
    const second = await screen.findByLabelText(`Стоимость: ${trich.name}, ₽`);
    await act.clear(first);
    await act.type(first, "150,50");
    await act.clear(second);
    await act.type(second, "60");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent(/Сохранено: 1\. Не удалось: 1/),
    );
    // The succeeded card keeps its saved value; the failed one stays dirty.
    expect(putSpy).toHaveBeenCalledTimes(2);
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent("Справочник сохранён."),
    );
    // Only the failed card was re-sent (the succeeded card is not repeated).
    expect(putSpy).toHaveBeenCalledTimes(3);
    expect(putSpy.mock.calls[2][0]).toBe("150.50");
  });

  it("the bulk command is ADMIN/ANALYST-only and absent for HEAD", async () => {
    renderEditor();
    await screen.findByRole("heading", { name: "Стоимость исследований ВСЭ" });
    expect(screen.queryByRole("button", { name: "Применить стоимость к лабораториям" })).toBeNull();
    me = { ...me, role: "ANALYST", scopes: [] };
    server.use(
      http.get("*/api/v1/contexts", () =>
        HttpResponse.json([
          { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
        ]),
      ),
    );
    renderEditor(`/catalogs?tab=tariffs&laboratory_id=${LAB}`);
    expect(
      await screen.findByRole("button", { name: "Применить стоимость к лабораториям" }),
    ).toBeInTheDocument();
  });

  it("normalizeMoneyInput accepts the comma and trims", () => {
    expect(normalizeMoneyInput(" 12,50 ")).toBe("12.50");
    expect(normalizeMoneyInput("0.00")).toBe("0.00");
  });
});
