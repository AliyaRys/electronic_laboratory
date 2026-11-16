/**
 * MSW fixtures for the catalog editor stories (ТЗ-DR6 §16): the three editor
 * pages render on the SAME components the production pages use, with fixture
 * data only — no demo prices from the HTML mockups, no credentials.
 */
import { http, HttpResponse, type HttpHandler } from "msw";
import { INDICATORS } from "../features/examinations/indicators";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";

const organoleptic = INDICATORS[0];
const temperature = INDICATORS.find(
  (indicator) => indicator.code === "VSE-F20",
) as (typeof INDICATORS)[number];
const cooking = INDICATORS.find((indicator) => indicator.code === "VSE-F26") as (typeof INDICATORS)[number];

const me = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Ольга Заведующая",
  login: "head-stories",
  email: "head@example.test",
  position: null,
  role: "HEAD",
  active: true,
  scopes: [{ laboratory_id: LAB, product_scope_id: SPECIES }],
  capabilities: ["catalog:create", "catalog:update", "catalog:delete"],
  revision: 1,
};

const tariffs = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    service_code: organoleptic.id,
    unit_id: "услуга",
    price: "35.00",
    version: 1,
    source: { name: "Прейскурант лаборатории" },
    revision: 2,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    service_code: temperature.id,
    unit_id: "°C",
    price: "0.00",
    version: 1,
    source: { name: "Прейскурант лаборатории" },
    revision: 1,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    laboratory_id: LAB,
    product_species_id: null,
    service_code: "PRODUCT_IDENTIFICATION",
    unit_id: "услуга",
    price: "40.00",
    version: 1,
    source: { name: "Прейскурант лаборатории" },
    revision: 1,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    laboratory_id: LAB,
    product_species_id: null,
    service_code: "TRANSPORT_INSPECTION",
    unit_id: "услуга",
    price: "94.00",
    version: 1,
    source: { name: "Прейскурант лаборатории" },
    revision: 1,
  },
];

const methods: Array<Record<string, unknown>> = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: "cccccccc-0000-4000-8000-000000000001",
    indicator_id: temperature.id,
    version: 1,
    result_schema: "DECIMAL",
    unit_id: "°C",
    rule: { type: "interval", lower: "0", upper: "4", lower_inclusive: true, upper_inclusive: true },
    source: { name: "Методика измерений", edition: "2024" },
    effective_from: "2026-01-01",
    active: true,
    revision: 1,
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    laboratory_id: LAB,
    product_species_id: SPECIES,
    product_state_id: "cccccccc-0000-4000-8000-000000000001",
    indicator_id: cooking.id,
    version: 1,
    result_schema: "ENUM",
    unit_id: "",
    rule: { type: "qualitative", accepted_values: ["Бульон прозрачный, аромат специфический"] },
    source: { name: "Методика варки" },
    active: true,
    revision: 1,
  },
];

export const catalogEditorHandlers: HttpHandler[] = [
  http.get("*/api/v1/me", () => HttpResponse.json(me)),
  // Real contract (§6.4): HEAD gets its scope rows WITH laboratory_id here;
  // ADMIN would get territory-only rows. Laboratory options come ONLY from
  // /contexts/laboratories, never fabricated inside /contexts.
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/contexts/laboratories", () =>
    HttpResponse.json([{ laboratory_id: LAB, name: "Лаборатория №1 г. Казань", territory_id: null }]),
  ),
  http.get("*/api/v1/catalogs/tariffs", () =>
    HttpResponse.json({ items: tariffs, total: tariffs.length, page: 1, page_size: 50 }),
  ),
  http.get("*/api/v1/catalogs/methods", () =>
    HttpResponse.json({ items: methods, total: methods.length, page: 1, page_size: 50 }),
  ),
  // The DR31/DR36 read model of «Нормы исследований»: the full registry, the
  // meat scope and the active rules (fixture data only, no mockup numbers).
  http.get("*/api/v1/catalogs/methods/context", () =>
    HttpResponse.json(methodsContextFixture([...methods])),
  ),
  http.post("*/api/v1/catalogs/methods", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const indicator = INDICATORS.find((item) => item.code === body["code"]) ?? temperature;
    const created: Record<string, unknown> = {
      id: "bbbbbbbb-0000-4000-8000-0000000000aa",
      laboratory_id: LAB,
      product_area_code: "meat",
      indicator_id: indicator.id,
      version: 1,
      result_schema: indicator.kind === "DECIMAL" ? "DECIMAL" : "INTEGER_NONNEGATIVE",
      unit_id: indicator.unit ?? null,
      rule: body["rule"],
      source: { name: "Ручная настройка справочника норм" },
      active: true,
      revision: 1,
    };
    methods.push(created);
    return HttpResponse.json({ rule: { id: created.id } });
  }),
  http.get("*/api/v1/catalogs/readiness", () => HttpResponse.json({ missing: [] })),
  http.put("*/api/v1/catalogs/tariffs/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...body, revision: 3 });
  }),
  http.put("*/api/v1/catalogs/methods/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...body, revision: 2 });
  }),
];

/** The DR31 methods read-model fixture: full VSE-F18–F29 registry for the
 * meat scope, active rules from the fixture list, honest missing set. */
function methodsContextFixture(rules: Array<Record<string, unknown>>): Record<string, unknown> {
  const active = rules
    .filter((rule) => rule["active"] === true && rule["product_species_id"] === SPECIES)
    .map((rule): Record<string, unknown> => ({ ...rule, product_area_code: "meat" }));
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
    active_rules: active,
    missing: INDICATORS.filter((item) => !active.some((rule) => rule["indicator_id"] === item.id)).map(
      (item) => item.id,
    ),
  };
}

/** The REAL ADMIN shape: /contexts carries only territory rows; laboratory
 * options come exclusively from the scoped /contexts/laboratories endpoint. */
const adminMe = {
  ...me,
  login: "admin-stories",
  full_name: "Андрей Администратор",
  email: "admin@example.test",
  role: "ADMIN",
  scopes: [],
};

const TERRITORY = "44444444-4444-4333-8444-444444444444";
const LAB_B = "66666666-6666-4333-8444-666666666666";

export const adminCatalogEditorHandlers: HttpHandler[] = [
  http.get("*/api/v1/me", () => HttpResponse.json(adminMe)),
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([{ territory_id: TERRITORY, territory_name: "Набережные Челны" }]),
  ),
  http.get("*/api/v1/contexts/laboratories", () =>
    HttpResponse.json([
      { laboratory_id: LAB, name: "Лаборатория №1 г. Казань", territory_id: TERRITORY },
      { laboratory_id: LAB_B, name: "Лаборатория №2 с. Азнакаево", territory_id: TERRITORY },
    ]),
  ),
  ...catalogEditorHandlers.filter(
    (handler) =>
      !String(handler.info.path).includes("/me") && !String(handler.info.path).includes("/contexts"),
  ),
];
