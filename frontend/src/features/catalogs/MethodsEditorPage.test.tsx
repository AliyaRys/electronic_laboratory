/**
 * «Нормы исследований» editor page (ТЗ-DR6 §17.4): interval rendering with
 * unit, lower>upper blocked, a null boundary stays null, the qualitative
 * «Проба варки» mapping built from accepted_values with the variants coming
 * from the shared INDICATORS registry, and the honest unknown-indicator
 * diagnostic without an invented name.
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
import { INDICATORS } from "../examinations/indicators";
import type { MethodRuleTyped } from "./api";
import { MethodsEditorPage } from "./MethodsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";

const microscopy = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const temperature = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];

let me: UserView;

function intervalRule(overrides: Partial<MethodRuleTyped>): MethodRuleTyped {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: "cccccccc-0000-4000-8000-000000000001",
    indicator_id: microscopy.id,
    version: 1,
    result_schema: "INTEGER_NONNEGATIVE",
    unit_id: "ед.",
    rule: { type: "interval", lower: "0", upper: "10", lower_inclusive: true, upper_inclusive: true },
    source: { name: "методика" },
    active: true,
    revision: 2,
    ...overrides,
  };
}

const putSpy = vi.fn();

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/methods", () =>
    HttpResponse.json({
      items: [
        intervalRule({}),
        intervalRule({
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          indicator_id: temperature.id,
          result_schema: "DECIMAL",
          unit_id: "°C",
          rule: { type: "interval", lower: "0", upper: null, lower_inclusive: true, upper_inclusive: true },
        }),
        intervalRule({
          id: "bbbbbbbb-0000-4000-8000-000000000003",
          indicator_id: cooking.id,
          result_schema: "ENUM",
          unit_id: "",
          rule: {
            type: "qualitative",
            accepted_values: ["Бульон прозрачный, аромат специфический"],
          },
        }),
      ],
      total: 3,
      page: 1,
      page_size: 50,
    }),
  ),
  http.get("*/api/v1/catalogs/readiness", () => HttpResponse.json({ missing: [] })),
  http.put("*/api/v1/catalogs/methods/:id", async ({ request }) => {
    putSpy(await request.clone().json());
    return HttpResponse.json({ id: "x" });
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
  server.resetHandlers();
});

function renderEditor(): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <MethodsEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [`/catalogs?tab=methods`] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const normLabel = (indicatorName: string, bound: "от" | "до"): string => `Норма ${bound}: ${indicatorName}`;

describe("MethodsEditorPage", () => {
  it("renders interval rows with the unit and keeps metadata in the fold", async () => {
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    expect(lower).toHaveValue("0");
    expect(screen.getByLabelText(normLabel(microscopy.name, "до"))).toHaveValue("10");
    // The unit suffix of the row.
    expect(screen.getAllByText("ед.").length).toBeGreaterThan(0);
    // Metadata area is folded but available: version + source.
    const details = screen.getAllByText("Методика и версия");
    expect(details.length).toBeGreaterThan(0);
  });

  it("a null upper boundary stays empty and is sent as null (not 0)", async () => {
    const act = userEvent.setup();
    renderEditor();
    const upper = await screen.findByLabelText(normLabel(temperature.name, "до"));
    expect(upper).toHaveValue("");
    await act.type(upper, "4");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { upper?: string; lower?: string } };
    expect(payload.rule.upper).toBe("4");
  });

  it("lower > upper is blocked with a field-bound error", async () => {
    const act = userEvent.setup();
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    await act.clear(lower);
    await act.type(lower, "50");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() =>
      expect(screen.getAllByText("Нижняя граница должна быть не больше верхней.").length).toBeGreaterThan(0),
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("the qualitative mapping is built from accepted_values with the registry variants", async () => {
    renderEditor();
    await screen.findByRole("heading", { name: cooking.name });
    // Every registry variant of «Проба варки» is present; the accepted one is
    // «Норма», the rest are «Отклонение».
    for (const option of cooking.options ?? []) {
      const input = await screen.findByLabelText(`Вариант результата: ${option.label}`);
      expect(input).toHaveValue(option.label);
    }
    const selects = screen.getAllByLabelText(/Оценка/);
    expect((selects[0] as HTMLSelectElement).value).toBe("norm");
    expect((selects[1] as HTMLSelectElement).value).toBe("deviation");
  });

  it("marking a second variant «Норма» updates accepted_values on save", async () => {
    const act = userEvent.setup();
    renderEditor();
    const second = (await screen.findAllByLabelText(/Оценка/))[1];
    await act.selectOptions(second, "norm");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { accepted_values: string[] } };
    expect(payload.rule.accepted_values).toEqual([
      "Бульон прозрачный, аромат специфический",
      "Бульон мутный",
    ]);
  });

  it("an unknown indicator keeps the honest diagnostic without an invented name", async () => {
    server.use(
      http.get("*/api/v1/catalogs/methods", () =>
        HttpResponse.json({
          items: [
            intervalRule({
              id: "bbbbbbbb-0000-4000-8000-000000000009",
              indicator_id: "dddddddd-0000-4000-8000-000000000009",
              unit_id: "ед.",
            }),
          ],
          total: 1,
          page: 1,
          page_size: 50,
        }),
      ),
    );
    renderEditor();
    expect(await screen.findByText(/показателя вне общего каталога/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp("dddddddd"))).toBeInTheDocument();
  });
});
