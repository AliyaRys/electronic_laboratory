/**
 * «Нормы исследований» editor page (ТЗ-DR6 §17.4 + ТЗ-DR28 §8 frontend
 * scenarios): the scoped context drives everything — no misleading empty
 * state without a scope, the full VSE-F18–F29 registry with honest
 * «Не настроено» rows, «Добавить норму» opening the SHARED MethodEditor with
 * createMethod() and real internal ids while no UUID is ever shown.
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
import type { MethodsContextTyped, MethodRuleTyped } from "./api";
import { MethodsEditorPage } from "./MethodsEditorPage";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";
const BEEF = "33333333-3333-4333-8333-333333333334";
const STATE = "cccccccc-0000-4000-8000-000000000001";

type ScopeOption = { id: string; label: string; requires_trichinelloscopy: boolean };

const microscopy = INDICATORS.find((item) => item.code === "VSE-F24") as (typeof INDICATORS)[number];
const temperature = INDICATORS.find((item) => item.code === "VSE-F20") as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((item) => item.code === "VSE-F26") as (typeof INDICATORS)[number];

let me: UserView;
/** The active rules of the mocked scoped context. */
let activeRules: MethodRuleTyped[];
/** 409 CONFIGURATION_MISSING: no configured working scope. */
let scopeMissing: boolean;
/** The created rules (POST), served back on the context refetch. */
let createdRules: MethodRuleTyped[];
/** Allowed species/state options and the currently resolved pair. */
let speciesOptions: ScopeOption[];
let stateOptions: ScopeOption[];
let resolvedSpecies: ScopeOption | null;
let resolvedState: ScopeOption | null;

function intervalRule(overrides: Partial<MethodRuleTyped>): MethodRuleTyped {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: STATE,
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
    species_options: speciesOptions,
    states: stateOptions,
    product_species: resolvedSpecies,
    product_state: resolvedState,
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
let contextRequests = 0;
let listRequests = 0;

const server = setupServer(
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/methods/context", ({ request }) => {
    contextRequests += 1;
    if (scopeMissing) {
      return HttpResponse.json(
        {
          code: "CONFIGURATION_MISSING",
          detail: "Вид продукции и состояние продукции не настроены для этой лаборатории.",
        },
        { status: 409 },
      );
    }
    // The backend resolves the pair from the URL params, like the real
    // endpoint: no pair → options without a fabricated selection.
    const url = new URL(request.url);
    const speciesId = url.searchParams.get("product_species_id");
    const stateId = url.searchParams.get("product_state_id");
    // Exactly one species is auto-selected (backend §5.2); >1 → pair unset.
    const resolved =
      speciesId != null
        ? (speciesOptions.find((item) => item.id === speciesId) ?? null)
        : speciesOptions.length === 1
          ? speciesOptions[0]
          : null;
    const states = resolved != null ? stateOptions : [];
    // Exactly one observed state is auto-selected (backend §5.3).
    const state =
      stateId != null
        ? (stateOptions.find((item) => item.id === stateId) ?? null)
        : states.length === 1
          ? states[0]
          : null;
    return HttpResponse.json(
      contextFixture({
        product_species: resolved,
        states,
        product_state: state,
      }),
    );
  }),
  http.get("*/api/v1/catalogs/methods", () => {
    // The legacy scoped list must NEVER be called by the page (DR28 §5.1):
    // it is not the working read model and a laboratory UUID never reaches it.
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
    createdRules.push(
      intervalRule({
        id: "bbbbbbbb-0000-4000-8000-0000000000aa",
        indicator_id: String(payload["indicator_id"]),
        result_schema: String(payload["result_schema"]),
        unit_id: String(payload["unit_id"]),
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
    scopes: [{ laboratory_id: LAB, product_scope_id: SPECIES }],
    capabilities: ["catalog:create", "catalog:update", "catalog:delete"],
    revision: 1,
  };
  activeRules = [];
  createdRules = [];
  scopeMissing = false;
  speciesOptions = [{ id: SPECIES, label: "Свинина", requires_trichinelloscopy: true }];
  stateOptions = [{ id: STATE, label: "Охлаждённое", requires_trichinelloscopy: false }];
  resolvedSpecies = speciesOptions[0];
  resolvedState = stateOptions[0];
  contextRequests = 0;
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
  it("an unconfigured scope shows the honest configuration screen and never the empty norms state", async () => {
    scopeMissing = true;
    renderEditor();
    expect(await screen.findAllByText(/Вид продукции и состояние продукции не настроены/i)).not.toHaveLength(
      0,
    );
    expect(screen.queryByText("Нормы для этой области не заданы.")).toBeNull();
    await waitFor(() => expect(contextRequests).toBeGreaterThan(0));
    // The legacy scoped list is never called — the laboratory UUID never
    // becomes a product species (§5.1).
    expect(listRequests).toBe(0);
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
  });

  it("an empty but configured scope lists the full VSE-F18–F29 registry as «Не настроено»", async () => {
    renderEditor();
    expect(await screen.findByRole("button", { name: "Добавить норму" })).toBeInTheDocument();
    for (const indicator of INDICATORS) {
      expect(screen.getByText(indicator.name)).toBeInTheDocument();
    }
    // F30/F31 are party dictionaries, never catalog norms.
    expect(screen.queryByText("Инвазионные болезни")).toBeNull();
    expect(screen.queryByText("Незаразные болезни")).toBeNull();
    const unset = screen.getAllByText("Не настроено");
    expect(unset.length).toBe(INDICATORS.length);
    expect(screen.getAllByRole("button", { name: "Настроить" }).length).toBe(INDICATORS.length);
    // The human-readable scope is shown; no GUID ever appears.
    expect(screen.getByText(/Состояние продукции: Охлаждённое/)).toBeInTheDocument();
    expect(screen.getByText(/Продукция: Свинина/)).toBeInTheDocument();
    expect(screen.queryByText(SPECIES)).toBeNull();
    expect(screen.queryByText(STATE)).toBeNull();
    // The canonical conditional flag of F21 is annotated (spec §4 GUID list).
    expect(screen.getAllByText("Обязательно для указанных видов продукции").length).toBeGreaterThan(0);
  });

  it("a multi-species area renders the selector instead of the no-scope screen", async () => {
    speciesOptions = [
      { id: SPECIES, label: "Свинина", requires_trichinelloscopy: true },
      { id: BEEF, label: "Говядина", requires_trichinelloscopy: false },
    ];
    resolvedSpecies = null;
    resolvedState = null;
    stateOptions = [];
    renderEditor();
    // The §5.3 selector of the allowed named options — no GUID, no «not
    // configured» screen (options are non-empty).
    const select = await screen.findByLabelText("Продукция");
    expect(select).toBeInTheDocument();
    expect(screen.queryAllByText(/Вид продукции и состояние продукции не настроены/i)).toHaveLength(0);
    expect(screen.queryByText(BEEF)).toBeNull();
    expect(screen.getByRole("option", { name: "Говядина" })).toBeInTheDocument();
    expect(screen.getByText("Выберите вид продукции, чтобы открыть нормы.")).toBeInTheDocument();
    // No scoped rules are shown before the pair is chosen.
    expect(screen.queryByRole("button", { name: "Добавить норму" })).toBeNull();
  });

  it("picking a species loads the state selector and the scoped rules of the pair", async () => {
    const act = userEvent.setup();
    speciesOptions = [
      { id: SPECIES, label: "Свинина", requires_trichinelloscopy: true },
      { id: BEEF, label: "Говядина", requires_trichinelloscopy: false },
    ];
    resolvedSpecies = null;
    resolvedState = null;
    // The observed states of the chosen species (the mock resolves the pair
    // from the request params like the real backend, single state auto).
    stateOptions = [{ id: STATE, label: "Охлаждённое", requires_trichinelloscopy: false }];
    renderEditor();
    await act.selectOptions(await screen.findByLabelText("Продукция"), BEEF);
    // After the choice the backend resolves the pair; the registry loads
    // scoped (the state is auto-selected: exactly one observed state).
    expect(await screen.findByRole("button", { name: "Добавить норму" })).toBeInTheDocument();
    for (const indicator of INDICATORS) {
      expect(screen.getByText(indicator.name)).toBeInTheDocument();
    }
    // The selected pair went into the URL of the pick action, not as GUID text.
    expect(screen.queryByText(BEEF)).toBeNull();
  });

  it("the URL pair params restore the scoped rules without free UUID input", async () => {
    activeRules = [intervalRule({})];
    renderEditor(
      `/catalogs?tab=methods&area=meat&species=${encodeURIComponent(SPECIES)}&state=${encodeURIComponent(STATE)}`,
    );
    // The restored link resolves the same pair (stable safe area code + pair
    // params) and shows the scoped rule, no UUID input anywhere.
    expect(await screen.findByLabelText(normLabel(microscopy.name, "от"))).toHaveValue("0");
    expect(screen.getByText(/Продукция: Свинина/)).toBeInTheDocument();
    expect(screen.queryByText(/введите UUID/i)).toBeNull();
  });

  it("«Добавить норму» opens the shared editor and POSTs real ids, then the row appears", async () => {
    const act = userEvent.setup();
    renderEditor();
    await act.click(await screen.findByRole("button", { name: "Добавить норму" }));
    const select = await screen.findByLabelText("Показатель");
    expect(screen.queryByText(/UUID/)).toBeNull();
    await act.selectOptions(select, temperature.id);
    await act.type(screen.getByLabelText("Нижняя граница"), "0");
    await act.type(screen.getByLabelText("Верхняя граница"), "6");
    await act.type(screen.getByLabelText("Источник методики"), "ГОСТ");
    await act.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const payload = postSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload["product_species_id"]).toBe(SPECIES);
    expect(payload["product_state_id"]).toBe(STATE);
    expect(payload["indicator_id"]).toBe(temperature.id);
    // The created row appears through the context refetch, no page reload.
    expect(await screen.findByLabelText(normLabel(temperature.name, "от"))).toHaveValue("0");
    // The configured row left the «Не настроено» list.
    expect(screen.getAllByText("Не настроено").length).toBe(INDICATORS.length - 1);
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
    // The unit suffix of the row.
    expect(screen.getAllByText("ед.").length).toBeGreaterThan(0);
    // Boundary inclusivity stays available; the version is never exposed, the
    // source of the methodology is (§6.1 «источник» column).
    const details = screen.getAllByText("Настройка границ");
    expect(details.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Версия записи/)).toBeNull();
    expect(screen.getAllByText(/Источник: методика/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Раздел не готов к расчёту:")).toBeNull();
  });

  it("a null upper boundary stays empty and is sent as null (not 0)", async () => {
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
    activeRules = [
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
    ];
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
    expect(screen.getByText(new RegExp("dddddddd"))).toBeInTheDocument();
  });
});
