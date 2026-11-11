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
const postSpy = vi.fn();
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
  http.get("*/api/v1/catalogs/methods", () =>
    HttpResponse.json({
      items: INDICATORS.map((indicator, index) => ({
        id: `bbbbbbbb-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        laboratory_id: LAB,
        product_species_id: SPECIES,
        product_state_id: "cccccccc-0000-4000-8000-000000000001",
        indicator_id: indicator.id,
        version: 1,
        result_schema: "DECIMAL",
        unit_id: indicator.unit ?? "service",
        rule: { type: "interval", lower: "0" },
        source: { name: "методика" },
        active: true,
        revision: 1,
      })),
      total: INDICATORS.length,
      page: 1,
      page_size: 50,
    }),
  ),
  http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
    putSpy((request.headers.get("if-match"), await request.clone().json()));
    return HttpResponse.json(tariff({ price: "150.00", revision: 4 }));
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
  postSpy.mockClear();
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

  it("creates a missing price without technical user fields", async () => {
    const act = userEvent.setup();
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`);
    expect(screen.queryByText("Данные новой записи (единица, источник)")).toBeNull();
    expect(screen.queryByLabelText("Единица измерения")).toBeNull();
    expect(screen.queryByLabelText("Источник прейскуранта")).toBeNull();
    expect(screen.queryByText("Раздел не готов к расчёту:")).toBeNull();
    await act.type(input, "125,50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]).toMatchObject({
      service_code: organoleptic.id,
      unit_id: "RUB",
      price: "125.50",
      version: 1,
      source: { name: "Ручная настройка справочника" },
    });
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
              code: "VALUE_NOT_ACCEPTED",
              title: "Value rejected",
              detail: "Значение отклонено сервером.",
              errors: [],
            },
            { status: 422 },
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
    // The refetch of the fresh state finishes before the next save.
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeEnabled());
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent("Справочник сохранён."),
    );
    // Only the failed card was re-sent (the succeeded card is not repeated).
    expect(putSpy).toHaveBeenCalledTimes(3);
    expect(putSpy.mock.calls[2][0]).toBe("150.50");
  });

  it("a 409 conflict shows the server value and the explicit choice, never a silent overwrite", async () => {
    const act = userEvent.setup();
    let otherUserSaved = false;
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({
          items: [tariff({ price: otherUserSaved ? "120.00" : "100.00", revision: otherUserSaved ? 5 : 3 })],
          total: 1,
          page: 1,
          page_size: 50,
        }),
      ),
      http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
        const body = (await request.clone().json()) as { price: string };
        const ifMatch = request.headers.get("if-match") ?? "";
        putSpy(`${body.price}|${ifMatch}`);
        // The OTHER user saves in between: the fresh revision is 5 @ 120.00.
        otherUserSaved = true;
        // Any send against the stale revisions answers 409; the explicit
        // «Сохранить моё значение» uses the FRESH revision and succeeds.
        if (ifMatch === '"3"' || ifMatch === '"4"') {
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
        return HttpResponse.json(tariff({ price: body.price, revision: 6 }));
      }),
    );
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`);
    await act.clear(input);
    await act.type(input, "150,50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    // The §12.6 conflict state appears with BOTH values after the fresh
    // revision is loaded.
    const panel = await screen.findByTestId("catalog-conflict");
    expect(panel).toHaveTextContent("Актуальное значение сервера");
    expect(panel).toHaveTextContent("Ваше значение");
    // The refetched server value (the other user's edit) is shown next to
    // the user's draft.
    await waitFor(() => expect(panel).toHaveTextContent("120.00"));
    expect(panel).toHaveTextContent("150,50");
    // A second «Сохранить справочник» does NOT re-submit the stale draft.
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    expect(putSpy).toHaveBeenCalledTimes(1);
    // «Сохранить моё значение» retries with the FRESH revision.
    await act.click(screen.getByRole("button", { name: "Сохранить моё значение" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(putSpy.mock.calls[1][0]).toBe('150.50|"5"');
    await waitFor(() => expect(screen.queryByTestId("catalog-conflict")).not.toBeInTheDocument());
  });

  it("the conflict «Взять значение сервера» drops the draft without a save", async () => {
    const act = userEvent.setup();
    server.use(
      http.get("*/api/v1/catalogs/tariffs", () =>
        HttpResponse.json({
          items: [tariff({ price: "100.00", revision: 3 })],
          total: 1,
          page: 1,
          page_size: 50,
        }),
      ),
      http.put("*/api/v1/catalogs/tariffs/:id", () => {
        putSpy("conflict");
        return HttpResponse.json(
          {
            code: "REVISION_CONFLICT",
            title: "Revision conflict",
            detail: "Запись была изменена другим пользователем.",
            errors: [],
          },
          { status: 409 },
        );
      }),
    );
    renderEditor();
    const input = await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`);
    await act.clear(input);
    await act.type(input, "150,50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await screen.findByTestId("catalog-conflict");
    await act.click(screen.getByRole("button", { name: "Взять значение сервера" }));
    await waitFor(() => expect(screen.queryByTestId("catalog-conflict")).not.toBeInTheDocument());
    // The card now shows the server value; no further PUT was sent.
    expect(await screen.findByLabelText(`Стоимость: ${organoleptic.name}, ₽`)).toHaveValue("100.00");
    expect(putSpy).toHaveBeenCalledTimes(1);
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
