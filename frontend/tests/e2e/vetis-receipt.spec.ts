/**
 * W03 acceptance is intentionally offline. Every request is intercepted in
 * the browser; this file never loads credentials or contacts Mercury.
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const OPERATION = "aaaaaaaa-0000-4000-8000-000000000001";

const arrival = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "CONFIRMED",
    fields: {
      documentNumber: "№ А-001234",
      consignor: "ООО «Мясопром»",
      consignee: "Агропромышленный парк",
      productItem: "Свинина",
    },
  },
  classification: {
    product: { id: "p", name: "свинина" },
    subProduct: null,
    productItem: { id: "pi", name: "Свинина" },
    unit: { id: "u", name: "кг" },
    productType: 1,
  },
  documentary: { mass_kg: "120", quantity: "4", unit_id: "u" },
  confirmation: null,
  queue: "WORK",
  examination_id: null,
  revision: 2,
};

const reconciliation = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  party_id: PARTY,
  revision: 3,
  state: "OPEN",
  checks: {},
  inspection: { compartment: "COMPLIANT", jointCarriage: "NONE" },
  delivered: { mass_kg: "120", quantity: "4", unit_id: "u" },
  accepted: { mass_kg: "120", quantity: "4", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
  decision: "ACCEPT_ALL",
  return_reason: null,
  repeat: null,
  transaction: { planned: false, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-10T06:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: "EXAMINATION",
  errors: [],
  complete: true,
};

async function baseRoutes(page: Page): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Ветврач",
        login: "vet",
        email: "vet@lab.test",
        position: "Ветеринарный врач",
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: ["receipt:submit"],
        revision: 1,
      }),
    }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(arrival) }),
  );
  await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reconciliation) }),
  );
}

test.describe("VetIS receipt is verified only through offline adapters", () => {
  test("disabled capability exposes no submit and makes zero write calls", async ({ page }) => {
    await baseRoutes(page);
    let writes = 0;
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          write_enabled: false,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: null,
          operation_state: null,
        }),
      }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt`, (route) => {
      writes += 1;
      return route.abort();
    });
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    await expect(page.getByText("Гашение не включено оператором")).toBeVisible();
    await expect(page.getByRole("button", { name: "Подготовить гашение" })).toHaveCount(0);
    expect(writes).toBe(0);
  });

  test("enabled preview requires explicit confirmation and sends once", async ({ page }) => {
    await baseRoutes(page);
    let writes = 0;
    let polls = 0;
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          write_enabled: true,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: null,
          operation_state: null,
        }),
      }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-preview`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          intent: { decision: "ACCEPT_ALL", vet_inspection: "CORRESPONDS" },
          application_xml: "<offline-spy />",
          fingerprint: "a".repeat(64),
        }),
      }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt`, (route) => {
      writes += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: OPERATION,
          state: "QUEUED",
          status_url: `/api/v1/operations/${OPERATION}`,
        }),
      });
    });
    await page.route(`**/api/v1/operations/${OPERATION}`, (route) => {
      polls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: OPERATION,
          kind: "vetis.receipt",
          state: polls > 1 ? "UNKNOWN" : "PROCESSING",
          updated_at: "2026-11-10T06:00:00Z",
        }),
      });
    });
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    await page.getByLabel("Результат ветеринарного осмотра").selectOption("CORRESPONDS");
    await page.getByRole("button", { name: "Подготовить гашение" }).click();
    await expect(page.getByRole("dialog", { name: "Подтвердите гашение эВСД" })).toBeVisible();
    await page.screenshot({ path: "test-results/w03-receipt-confirmation.png", fullPage: true });
    expect(writes).toBe(0);
    await page.getByRole("button", { name: "Погасить эВСД" }).click();
    await expect(page.getByText("Результат гашения пока неизвестен")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Повторить" }).click();
    expect(writes).toBe(1);
  });

  test("confirmed evidence opens VSE and rejected does not", async ({ page }) => {
    await baseRoutes(page);
    await page.route(`**/api/v1/arrivals/${PARTY}/receipt-context`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          write_enabled: true,
          source_revision: 7,
          reconciliation_revision: 3,
          operation_id: OPERATION,
          operation_state: "CONFIRMED",
        }),
      }),
    );
    await page.route(`**/api/v1/operations/${OPERATION}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: OPERATION,
          kind: "vetis.receipt",
          state: "CONFIRMED",
          updated_at: "2026-11-10T06:00:00Z",
        }),
      }),
    );
    await page.goto(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`);
    await expect(page.getByRole("link", { name: "Создать ВСЭ" })).toHaveAttribute(
      "href",
      `/labs/${LAB}/arrivals/${PARTY}/examination/new`,
    );

    await page.unroute(`**/api/v1/operations/${OPERATION}`);
    await page.route(`**/api/v1/operations/${OPERATION}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: OPERATION,
          kind: "vetis.receipt",
          state: "REJECTED",
          problem: "MERCURY_REJECTED",
          updated_at: "2026-11-10T06:00:00Z",
        }),
      }),
    );
    await page.reload();
    await expect(page.getByText("ВетИС отклонил гашение")).toBeVisible();
    await expect(page.getByRole("link", { name: "Создать ВСЭ" })).toHaveCount(0);
  });
});
