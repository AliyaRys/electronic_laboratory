/**
 * «Нормы исследований» editor page (ТЗ DR31 §12 frontend scenarios): the page
 * opens immediately with the full VSE-F18–F29 registry for «Мясо и
 * мясопродукты», has NO species/state selectors, URL parameters or GUIDs, the
 * first norm is configured directly from its row («Настроить») and
 * «Сохранить справочник» saves the dirty rows with honest per-row results.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../app/providers";
import type { UserView } from "../../shared/api/me";
import { INDICATORS } from "../examinations/indicators";
import type { MethodsContextTyped, MethodRuleTyped } from "./api";
import { MethodsEditorPage } from "./MethodsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";

const microscopy = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const temperature = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];

let me: UserView;
/** The active rules of the mocked meat context. */
let activeRules: MethodRuleTyped[];
/** 409 problem of the context request. */
let contextProblem: { code: string; detail: string } | null;
/** The created rules (POST), served back on the context refetch. */
let createdRules: MethodRuleTyped[];
/** POST failures (partial mass save). */
let postFailures = 0;

function intervalRule(overrides: Partial<MethodRuleTyped>): MethodRuleTyped {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_area_code: "meat",
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

function contextFixture(overrides: Partial<MethodsContextTyped> = {}): MethodsContextTyped {
  return {
    laboratory: { id: LAB, name: "Лаборатория №1 г. Казань" },
    areas: [{ code: "meat", name: "Мясо и мясопродукты", configured: true }],
    product_area_code: "meat",
    product_area_name: "Мясо и мясопродукты",
    indicators: INDICATORS.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      result_schema:
        item.kind === "DECIMAL"
          ? "DECIMAL"
          : item.kind === "INTEGER"
            ? "INTEGER_NONNEGATIVE"
            : item.kind === "TEXT"
              ? "TEXT"
              : item.kind === "DOSIMETRY"
                ? "DOSIMETRY_PAIR"
                : item.kind === "BOOLEAN"
                  ? "BOOLEAN_MATCH"
                  : "ENUM",
      unit_id: item.unit ?? null,
      mandatory: item.mandatory,
      conditional: item.code === "VSE-F21",
      options: item.options ? item.options.map((option) => option.label) : null,
    })),
    active_rules: [...activeRules, ...createdRules],
    missing: INDICATORS.filter(
      (item) => ![...activeRules, ...createdRules].some((rule) => rule.indicator_id === item.id),
    ).map((item) => item.id),
    ...overrides,
  };
}

const putSpy = vi.fn();
const postSpy = vi.fn();
let listRequests = 0;

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: null, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/methods/context", () => {
    if (contextProblem !== null) {
      return HttpResponse.json(contextProblem, { status: 409 });
    }
    return HttpResponse.json(contextFixture());
  }),
  http.get("*/api/v1/catalogs/methods", () => {
    // The legacy scoped list must NEVER be called by the page (DR31 §9.1):
    // there is no species parameter and no GUID in the scope any more.
    listRequests += 1;
    return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 50 });
  }),
  http.put("*/api/v1/catalogs/methods/:id", async ({ request }) => {
    putSpy(await request.clone().json());
    return HttpResponse.json({ id: "x" });
  }),
  http.post("*/api/v1/catalogs/methods", async ({ request }) => {
    const payload = (await request.clone().json()) as Record<string, unknown>;
    postSpy(payload);
    if (postFailures > 0) {
      postFailures -= 1;
      return HttpResponse.json(
        { code: "VALIDATION_ERROR", detail: "Тип нормы не соответствует каноническому типу результата." },
        { status: 422 },
      );
    }
    createdRules.push(
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-0000000000aa",
        indicator_id: String((INDICATORS.find((item) => item.code === payload["code"]) ?? { id: "" }).id),
        result_schema: "DECIMAL",
        unit_id: "°C",
      }),
    );
    return HttpResponse.json({ rule: { id: "bbbbbbbb-0000-4000-8000-0000000000aa" } });
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
    scopes: [{ laboratory_id: LAB, product_scope_id: null }],
    capabilities: ["catalog:create", "catalog:update", "catalog:delete"],
    revision: 1,
  };
  activeRules = [];
  createdRules = [];
  contextProblem = null;
  postFailures = 0;
  listRequests = 0;
  putSpy.mockClear();
  postSpy.mockClear();
  server.resetHandlers();
});

function renderEditor(initial = "/catalogs?tab=methods"): void {
  const router = createMemoryRouter(
    [
      { path: "/catalogs", element: <MethodsEditorPage /> },
      { path: "*", element: <p>Не найдено</p> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const normLabel = (indicatorName: string, bound: "от" | "до"): string => `Норма ${bound}: ${indicatorName}`;

describe("MethodsEditorPage", () => {
  it("opens immediately with the full registry, the readonly area and no species/state selectors", async () => {
    renderEditor();
    await screen.findByTestId("methods-area-name");
    for (const indicator of INDICATORS) {
      expect(screen.getByText(indicator.name)).toBeInTheDocument();
    }
    // F30/F31 are party dictionaries, never catalog norms.
    expect(screen.queryByText("Инвазионные болезни")).toBeNull();
    expect(screen.queryByText("Незаразные болезни")).toBeNull();
    // The F23 TEXT row carries a readonly explanation instead of a norm.
    expect(screen.getAllByText("Не настроено").length).toBe(INDICATORS.length - 1);
    expect(screen.getAllByRole("button", { name: "Настроить" }).length).toBe(INDICATORS.length - 1);
    // The readonly context of the product area; no selectors, no GUIDs.
    expect(screen.getByTestId("methods-area-name")).toHaveTextContent("Мясо и мясопродукты");
    expect(screen.queryByLabelText("Продукция")).toBeNull();
    expect(screen.queryByLabelText("Состояние продукции")).toBeNull();
    expect(screen.queryByText(/UUID/)).toBeNull();
    expect(screen.queryByText(/Выберите вид продукции/)).toBeNull();
    expect(screen.queryByText(/Выберите состояние продукции/)).toBeNull();
    expect(listRequests).toBe(0);
    // No technical «Добавить норму» form exists.
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
    // The canonical conditional flag of F21 is annotated.
    expect(screen.getAllByText("Обязательно для указанных видов продукции").length).toBeGreaterThan(0);
  });

  it("a problem of the context keeps the honest screen, never an empty catalog", async () => {
    contextProblem = {
      code: "CONFIGURATION_MISSING",
      detail: "Область продукции не поддерживается системой.",
    };
    renderEditor();
    expect(await screen.findAllByText(/Область продукции не поддерживается/i)).not.toHaveLength(0);
  });

  it("the first norm is configured directly from the row and POSTs only the code and rule", async () => {
    const act = userEvent.setup();
    renderEditor();
    await screen.findByTestId("methods-area-name");
    const unsetRow = (await screen.findByText(temperature.name)).closest("article");
    await act.click(within(unsetRow as HTMLElement).getByRole("button", { name: "Настроить" }));
    // The row editor appears inline: subject fields only.
    await waitFor(() =>
      expect(within(unsetRow as HTMLElement).queryByRole("button", { name: "Настроить" })).toBeNull(),
    );
    const lower = await screen.findByLabelText(normLabel(temperature.name, "от"));
    expect(screen.queryByLabelText("Тип результата")).toBeNull();
    expect(screen.queryByLabelText("Единица измерения нормы")).toBeNull();
    expect(screen.queryByLabelText("Версия")).toBeNull();
    expect(screen.queryByLabelText("Источник методики")).toBeNull();
    await act.type(lower, "0");
    await act.type(screen.getByLabelText(normLabel(temperature.name, "до")), "6");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const payload = postSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload["laboratory_id"]).toBe(LAB);
    expect(payload["code"]).toBe("VSE-F20");
    expect(payload["rule"]).toEqual({
      type: "interval",
      lower: "0",
      upper: "6",
      lower_inclusive: true,
      upper_inclusive: true,
    });
    expect(payload["product_species_id"]).toBeUndefined();
    expect(payload["product_state_id"]).toBeUndefined();
    expect(payload["result_schema"]).toBeUndefined();
    expect(payload["unit_id"]).toBeUndefined();
    expect(payload["version"]).toBeUndefined();
    expect(payload["source"]).toBeUndefined();
    // The configured row appears through the context refetch, no page reload.
    expect(await screen.findByLabelText(normLabel(temperature.name, "от"))).toHaveValue("0");
    expect(screen.getAllByText("Не настроено").length).toBe(INDICATORS.length - 2);
  });

  it("renders interval rows with the unit and only business boundary settings", async () => {
    activeRules = [
      intervalRule({}),
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        indicator_id: temperature.id,
        result_schema: "DECIMAL",
        unit_id: "°C",
        rule: { type: "interval", lower: "0", upper: null, lower_inclusive: true, upper_inclusive: true },
      }),
    ];
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    expect(lower).toHaveValue("0");
    expect(screen.getByLabelText(normLabel(microscopy.name, "до"))).toHaveValue("10");
    // The unit suffix of the row comes from the canonical registry.
    expect(screen.getAllByText("ед.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Версия записи/)).toBeNull();
    expect(screen.getAllByText(/Источник: методика/).length).toBeGreaterThan(0);
  });

  it("a null upper boundary stays empty and is sent as a string, never as 0", async () => {
    const act = userEvent.setup();
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        indicator_id: temperature.id,
        result_schema: "DECIMAL",
        unit_id: "°C",
        rule: { type: "interval", lower: "0", upper: null, lower_inclusive: true, upper_inclusive: true },
      }),
    ];
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
    activeRules = [intervalRule({})];
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
    const first = (cooking.options ?? [])[0] as { label: string };
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000003",
        indicator_id: cooking.id,
        result_schema: "ENUM",
        unit_id: "",
        rule: { type: "qualitative", accepted_values: [first.label] },
      }),
    ];
    renderEditor();
    await screen.findByRole("heading", { name: cooking.name });
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
    const first = (cooking.options ?? [])[0] as { label: string };
    const second = (cooking.options ?? [])[1] as { label: string };
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000003",
        indicator_id: cooking.id,
        result_schema: "ENUM",
        unit_id: "",
        rule: { type: "qualitative", accepted_values: [first.label] },
      }),
    ];
    renderEditor();
    await screen.findByRole("heading", { name: cooking.name });
    expect((screen.getAllByLabelText(/Оценка/)[0] as HTMLSelectElement).value).toBe("norm");
    await act.selectOptions(screen.getAllByLabelText(/Оценка/)[1], "norm");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const payload = putSpy.mock.calls[0][0] as { rule: { accepted_values: string[] } };
    expect(payload.rule.accepted_values).toEqual([first.label, second.label]);
    expect(await screen.findByText("Справочник норм сохранён.")).toBeInTheDocument();
  });

  it("a partial mass save keeps the input and reports which rows failed", async () => {
    const act = userEvent.setup();
    renderEditor();
    await screen.findByTestId("methods-area-name");
    const temperatureRow = (await screen.findByText(temperature.name)).closest("article");
    await act.click(within(temperatureRow as HTMLElement).getByRole("button", { name: "Настроить" }));
    await act.type(await screen.findByLabelText(normLabel(temperature.name, "от")), "0");
    await act.type(screen.getByLabelText(normLabel(temperature.name, "до")), "6");
    postFailures = 1;
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(screen.getByTestId("catalog-save-summary")).toBeInTheDocument());
    expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent(/Не удалось: 1/);
    // The draft of the failed row is NOT lost.
    expect(screen.getByLabelText(normLabel(temperature.name, "от"))).toHaveValue("0");
  });

  it("a TEXT research shows the honest readonly explanation, never a numeric editor", async () => {
    const bacterioscopy = INDICATORS.find((item) => item.code === "VSE-F23") as (typeof INDICATORS)[number];
    renderEditor();
    await screen.findByText(/автоматическая оценка нормы для этого исследования не применяется/i);
    expect(screen.getByText(bacterioscopy.name)).toBeInTheDocument();
    const configureButtons = screen.queryAllByRole("button", { name: "Настроить" });
    expect(configureButtons.length).toBeLessThan(INDICATORS.length);
  });

  it("a reader without edit rights sees no configure or delete actions", async () => {
    me = {
      ...me,
      role: "VET",
      full_name: "Игорь Ветеринар",
      login: "vet",
      capabilities: [],
    };
    renderEditor();
    await screen.findByTestId("methods-area-name");
    expect(screen.queryByRole("button", { name: "Настроить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить норму" })).toBeNull();
    const save = screen.getByRole("button", { name: "Сохранить справочник" });
    expect(save).toBeDisabled();
  });

  it("an unknown indicator keeps the honest diagnostic without an invented name", async () => {
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000009",
        indicator_id: "dddddddd-0000-4000-8000-000000000009",
        unit_id: "ед.",
      }),
    ];
    renderEditor();
    expect(await screen.findByText(/показателя вне общего каталога/i)).toBeInTheDocument();
  });
});
