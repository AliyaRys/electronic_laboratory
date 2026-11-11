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
    product_species_id: SPECIES,
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
    product_species_id: SPECIES,
    service_code: "TRANSPORT_INSPECTION",
    unit_id: "услуга",
    price: "94.00",
    version: 1,
    source: { name: "Прейскурант лаборатории" },
    revision: 1,
  },
];

const methods = [
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
  http.get("*/api/v1/contexts", () =>
    HttpResponse.json([
      { laboratory_id: LAB, product_scope_id: SPECIES, laboratory_name: "Лаборатория №1 г. Казань" },
    ]),
  ),
  http.get("*/api/v1/catalogs/tariffs", () =>
    HttpResponse.json({ items: tariffs, total: tariffs.length, page: 1, page_size: 50 }),
  ),
  http.get("*/api/v1/catalogs/methods", () =>
    HttpResponse.json({ items: methods, total: methods.length, page: 1, page_size: 50 }),
  ),
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
