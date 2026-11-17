/**
 * «Нормы исследований» editor page (ТЗ DR36 §19): the page opens immediately
 * with the full VSE-F18–F29 registry for «Мясо и мясопродукты» inside ONE
 * section «Диапазоны нормы»; unset interval rows show their «Норма от/до»
 * fields directly (NO «Настроить» button), qualitative blocks use square
 * ＋/− buttons and «Сохранить справочник» saves only the dirty rows with
 * honest per-row results.
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

/** ТЗ DR41-B §6: the fixed FT rules and the norm-free research. */
const FIXED_CODES = new Set(["VSE-F18", "VSE-F19", "VSE-F22", "VSE-F27", "VSE-F28"]);

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
      evaluation_mode: FIXED_CODES.has(item.code)
        ? "FIXED"
        : item.code === "VSE-F23"
          ? "NONE"
          : "CONFIGURABLE",
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
    // §19.1: ONE h1 and ONE section header «Диапазоны нормы».
    expect(screen.getAllByRole("heading", { level: 1, name: "Нормы исследований" })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Диапазоны нормы" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Диапазоны нормы" })).not.toHaveTextContent(
      "Нормы исследований",
    );
    // §19.2: the mockup lead and the calm category line.
    expect(
      screen.getByText(
        "Диапазоны используются для автоматической отметки нормы и отклонений в карточке ВСЭ.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("methods-area-name")).toHaveTextContent("Мясо и мясопродукты");
    // ТЗ DR41-B §6: only the CONFIGURABLE indicators are catalog rows.
    const configurable = INDICATORS.filter((item) => !FIXED_CODES.has(item.code) && item.code !== "VSE-F23");
    for (const indicator of configurable) {
      expect(screen.getByText(indicator.name)).toBeInTheDocument();
    }
    for (const indicator of INDICATORS.filter(
      (item) => FIXED_CODES.has(item.code) || item.code === "VSE-F23",
    )) {
      expect(screen.queryByText(indicator.name)).toBeNull();
    }
    // F30/F31 are party dictionaries, never catalog norms.
    expect(screen.queryByText("Инвазионные болезни")).toBeNull();
    expect(screen.queryByText("Инвазионные болезни")).toBeNull();
    // §19.4: the unset interval row has BOTH fields right away…
    const unset = (await screen.findByText(temperature.name)).closest("article") as HTMLElement;
    expect(within(unset).getByLabelText(normLabel(temperature.name, "от"))).toHaveValue("");
    expect(within(unset).getByLabelText(normLabel(temperature.name, "до"))).toHaveValue("");
    // …and a calm «Не настроено» signature instead of a button.
    expect(within(unset).getByText("Не настроено")).toBeInTheDocument();
    // §19.5: no «Настроить» action exists anywhere.
    expect(screen.queryByRole("button", { name: "Настроить" })).toBeNull();
    // The readonly context of the product area; no selectors, no GUIDs.
    expect(screen.queryByLabelText("Продукция")).toBeNull();
    expect(screen.queryByLabelText("Состояние продукции")).toBeNull();
    expect(screen.queryByText(/UUID/)).toBeNull();
    expect(screen.queryByText(/Выберите вид продукции/)).toBeNull();
    expect(screen.queryByText(/Выберите состояние продукции/)).toBeNull();
    expect(listRequests).toBe(0);
    // No technical «Добавить норму» form exists.
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
    // The canonical conditional flag of F21 is annotated (joined meta line).
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent?.includes("Обязательно для указанных видов продукции") ?? false,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the technical metadata off the main surface (source, version, delete)", async () => {
    const act = userEvent.setup();
    activeRules = [intervalRule({})];
    renderEditor();
    await screen.findByLabelText(normLabel(microscopy.name, "от"));
    // §19.11: no source/version/UUID on the surface.
    expect(screen.queryByText(/Источник/)).toBeNull();
    expect(screen.queryByText(/Методика и версия/)).toBeNull();
    expect(screen.queryByText(/Настройка границ/)).toBeNull();
    // §19.12: the delete action stays available in the folded overflow and
    // goes through the confirming dialog.
    const row = screen.getByLabelText(normLabel(microscopy.name, "от")).closest("article") as HTMLElement;
    await act.click(within(row).getByText("Дополнительные настройки"));
    await act.click(within(row).getByRole("button", { name: "Удалить норму: Микроскопия" }));
    expect(await screen.findByRole("dialog", { name: /Удалить действующую норму\?/i })).toBeInTheDocument();
    expect(screen.getByText(/Удаление действующей нормы заблокирует/)).toBeInTheDocument();
    await act.click(screen.getByRole("button", { name: "Отмена" }));
  });

  it("save is disabled until a row is edited (§19.13)", async () => {
    renderEditor();
    await screen.findByTestId("methods-area-name");
    expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeDisabled();
  });

  it("a problem of the context keeps the honest screen, never an empty catalog", async () => {
    contextProblem = {
      code: "CONFIGURATION_MISSING",
      detail: "Область продукции не поддерживается системой.",
    };
    renderEditor();
    expect(await screen.findAllByText(/Область продукции не поддерживается/i)).not.toHaveLength(0);
  });

  it("the first norm is typed directly into the row and POSTs only the code and rule", async () => {
    const act = userEvent.setup();
    renderEditor();
    await screen.findByTestId("methods-area-name");
    // §10.2: no «Настроить» step — the fields wait for the input right away.
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
    // The remaining unset INTERVAL rows keep the «Не настроено» signature.
    expect(screen.getAllByText("Не настроено").length).toBe(3);
  });

  it("empty unset rows are never sent when other rows are saved (§19.6)", async () => {
    const act = userEvent.setup();
    renderEditor();
    await screen.findByTestId("methods-area-name");
    // Touch nothing but the temperature row; every other unset row stays empty.
    await act.type(await screen.findByLabelText(normLabel(temperature.name, "от")), "0");
    await act.type(screen.getByLabelText(normLabel(temperature.name, "до")), "6");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]["code"]).toBe("VSE-F20");
  });

  it("renders interval rows with the unit and only business boundary settings", async () => {
    const act = userEvent.setup();
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
    expect(screen.queryByText(/Источник/)).toBeNull();
    // The inclusivity checkboxes live in the folded overflow of the row.
    const row = screen.getByLabelText(normLabel(microscopy.name, "от")).closest("article") as HTMLElement;
    await act.click(within(row).getByText("Дополнительные настройки"));
    expect(within(row).getByLabelText(/нижняя граница включена/)).toBeChecked();
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
    const block = (await screen
      .findByRole("heading", { name: cooking.name })
      .then((heading) => heading.closest("article"))) as HTMLElement;
    for (const option of cooking.options ?? []) {
      const input = await within(block).findByLabelText(`Вариант результата: ${option.label}`);
      expect(input).toHaveValue(option.label);
    }
    const selects = within(block).getAllByLabelText(/Оценка/);
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
    const block = (await screen
      .findByRole("heading", { name: cooking.name })
      .then((heading) => heading.closest("article"))) as HTMLElement;
    expect((within(block).getAllByLabelText(/Оценка/)[0] as HTMLSelectElement).value).toBe("norm");
    await act.selectOptions(within(block).getAllByLabelText(/Оценка/)[1], "norm");
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
    await act.type(await screen.findByLabelText(normLabel(temperature.name, "от")), "0");
    await act.type(screen.getByLabelText(normLabel(temperature.name, "до")), "6");
    postFailures = 1;
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(screen.getByTestId("catalog-save-summary")).toBeInTheDocument());
    expect(screen.getByTestId("catalog-save-summary")).toHaveTextContent(/Не удалось: 1/);
    // The draft of the failed row is NOT lost.
    expect(screen.getByLabelText(normLabel(temperature.name, "от"))).toHaveValue("0");
  });

  it("a 409 keeps the draft and offers the honest resolution choice (§19.14)", async () => {
    const act = userEvent.setup();
    server.use(
      http.put("*/api/v1/catalogs/methods/:id", () =>
        HttpResponse.json(
          { code: "REVISION_CONFLICT", detail: "Запись была изменена другим пользователем." },
          { status: 409 },
        ),
      ),
    );
    activeRules = [intervalRule({})];
    renderEditor();
    const lower = await screen.findByLabelText(normLabel(microscopy.name, "от"));
    await act.clear(lower);
    await act.type(lower, "1");
    await act.type(screen.getByLabelText(normLabel(microscopy.name, "до")), "20");
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(screen.getByTestId("catalog-conflict")).toBeInTheDocument());
    // The draft stays visible for the comparison and the choice.
    expect(lower).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Сохранить моё значение" })).toBeInTheDocument();
  });

  it("бактериоскопия is not a catalog row any more (ТЗ DR41-B §6.2)", async () => {
    renderEditor();
    await screen.findByTestId("methods-area-name");
    expect(screen.queryByText("Результат вводится текстом; диапазон нормы не задаётся.")).toBeNull();
    expect(screen.queryByText("Бактериоскопия")).toBeNull();
  });

  it("a legacy rule of a fixed indicator stays an honest diagnostic (ТЗ DR41-B §6.4)", async () => {
    const organoleptic = INDICATORS.find((item) => item.code === "VSE-F18") as (typeof INDICATORS)[number];
    activeRules = [
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-000000000004",
        indicator_id: organoleptic.id,
        result_schema: "ENUM",
        unit_id: "",
        rule: { type: "qualitative", accepted_values: ["Соответствует"] },
      }),
    ];
    renderEditor();
    await screen.findByTestId(`method-legacy-bbbbbbbb-0000-4000-8000-000000000004`);
    expect(screen.getByText(/фиксирована методикой ФТ и не настраивается/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить справочник" })).toBeDisabled();
  });

  it("a qualitative block uses the square ＋/− buttons and removable custom variants (§19.9/§19.10)", async () => {
    const act = userEvent.setup();
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
    // Square add button of the mockup, no text button.
    expect(screen.getAllByRole("button", { name: "Добавить вариант" }).length).toBeGreaterThan(0);
    const block = screen.getByRole("heading", { name: cooking.name }).closest("article") as HTMLElement;
    const registryRows = (cooking.options ?? []).length;
    await act.click(within(block).getByRole("button", { name: "Добавить вариант" }));
    // A custom empty row was appended (an extra Оценка select) and is
    // removable with the square −.
    await waitFor(() => expect(within(block).getAllByLabelText(/Оценка/).length).toBe(registryRows + 1));
    const removeButtons = within(block).getAllByRole("button", { name: /^Удалить вариант:/ });
    // §19.10: only the custom variant can be removed — registry variants
    // keep the reserved third column without an active −.
    expect(removeButtons.length).toBe(1);
    // Registry variants stay readonly: their inputs cannot change.
    const registryInput = within(block).getByLabelText(`Вариант результата: ${first.label}`);
    expect(registryInput).toHaveAttribute("readonly");
    // §11.2/IMPORTANT-1: a just-added variant that stays EMPTY is not a
    // change — the save stays disabled and no PUT carries the empty value.
    expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeDisabled();
    // The focus moved into the new field.
    expect(within(block).getAllByLabelText(/Вариант результата:/)[registryRows]).toHaveFocus();
    await act.type(within(block).getAllByLabelText(/Вариант результата:/)[registryRows], "Соленый вкус");
    expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeEnabled();
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(
      (putSpy.mock.calls[0][0] as { rule: { accepted_values: string[] } }).rule.accepted_values,
    ).toContain("Соленый вкус");
  });

  it("an added but never filled variant is dropped: no request and no payload value (§11.2)", async () => {
    const act = userEvent.setup();
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
    const block = (await screen
      .findByRole("heading", { name: cooking.name })
      .then((heading) => heading.closest("article"))) as HTMLElement;
    await act.click(within(block).getByRole("button", { name: "Добавить вариант" }));
    await waitFor(() =>
      expect(within(block).getAllByLabelText(/Оценка/).length).toBe((cooking.options ?? []).length + 1),
    );
    // The row itself is NOT dirty while the field stays empty.
    expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeDisabled();
    expect(putSpy).not.toHaveBeenCalled();
    // The unset (create) path behaves the same: no POST without a value.
    const unsetBlock = (await screen
      .findByRole("heading", { name: "Трихинеллоскопия" })
      .then((heading) => heading.closest("article"))) as HTMLElement;
    await act.click(within(unsetBlock).getByRole("button", { name: "Добавить вариант" }));
    expect(screen.getByRole("button", { name: "Сохранить справочник" })).toBeDisabled();
    expect(postSpy).not.toHaveBeenCalled();
    // A typed custom variant IS sent; the still-empty second one is dropped.
    const reaction = INDICATORS.find((item) => item.code === "VSE-F21") as (typeof INDICATORS)[number];
    const reactionRows = (reaction.options ?? []).length;
    await act.click(within(unsetBlock).getByRole("button", { name: "Добавить вариант" }));
    await act.type(
      within(unsetBlock).getAllByLabelText(/Вариант результата:/)[reactionRows],
      "Бурой окраски нет",
    );
    await act.click(screen.getByRole("button", { name: "Сохранить справочник" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const payload = postSpy.mock.calls[0][0] as { code: string; rule: { accepted_values: string[] } };
    expect(payload.code).toBe("VSE-F21");
    // The registry variants plus the typed extra; the never-filled added
    // variant is absent and no empty string travels (§11.2).
    expect(payload.rule.accepted_values).toContain("Бурой окраски нет");
    expect(payload.rule.accepted_values).not.toContain("");
    expect(payload.rule.accepted_values).toHaveLength((reaction.options ?? []).length + 1);
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
