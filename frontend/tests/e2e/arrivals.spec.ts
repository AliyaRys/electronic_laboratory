/**
 * Arrivals e2e (A01, MSW-style route mocks — real API e2e is not required in
 * this task): URL-context queues, real-ID navigation into the real A02
 * reconciliation screen and back, the VET/HEAD-only sync button, and the
 * 390/1440 screens.
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";

const singleView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentNumber: "№ A-001234",
      transportNumber: "А123ВС77",
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

const reconciliationView = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001",
  party_id: PARTY,
  revision: 1,
  state: "OPEN",
  checks: {},
  inspection: { compartment: null, jointCarriage: null },
  delivered: { mass_kg: "0", quantity: "0", unit_id: "u" },
  accepted: { mass_kg: "0", quantity: "0", unit_id: "u" },
  returned: { mass_kg: "0", quantity: "0", unit_id: "u" },
  decision: null,
  returnReason: null,
  repeat: null,
  transaction: { planned: null, type: null },
  fair: false,
  services: [],
  actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  saved_at: "2026-11-09T10:00:00Z",
  completed_at: null,
  allowed_decisions: ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
  act: { required: false, items: [] },
  route: "EXAMINATION",
  errors: [],
  complete: false,
};

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/a01-${name}.png`, fullPage: true });
}

async function mockSessionAndArrivals(page: Page): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Кузнецова Алиса Викторовна",
        login: "kuznetsova",
        email: "kuznetsova@lab.tatar",
        position: "Ветеринарный врач",
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: ["arrivals:read"],
        revision: 3,
      }),
    }),
  );
  await page.route("**/api/v1/arrivals?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("laboratory_id") !== LAB) {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "ACCESS_DENIED" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "3f0e6d2a-1111-4222-8333-444444444444",
            party_id: PARTY,
            laboratory_id: LAB,
            external: {
              contour: "PILOT",
              evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
              status: "COMPLETED",
              fields: {
                documentNumber: "№ A-001234",
                transportNumber: "А123ВС77",
                consignor: "ООО «Мясопром»",
                consignee: "Убойный пункт Ленина, 5",
                productItem: "Отруба говяжьи",
              },
            },
            classification: {
              product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
              subProduct: null,
              productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
              unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
            },
            documentary: { mass_kg: "120.0", quantity: "4", unit_id: "u" },
            confirmation: null,
            queue: "EXPECTED",
            examination_id: null,
            revision: 1,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    });
  });
}

test.describe("arrivals", () => {
  test("test_real_id_navigation_preserves_url_context", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.goto(`/labs/${LAB}/arrivals?queue=expected`);
    await expect(page.getByRole("heading", { name: "Поступления" })).toBeVisible();
    await expect(page.getByText("говядина")).toBeVisible();
    await shot(page, "list-1440");

    // The sync button is VET/HEAD only; the job itself is e2e-proven in
    // vetis-read.spec.ts (ТЗ-10 V02).
    const update = page.getByRole("button", { name: "Обновить" });
    await expect(update).toBeEnabled();

    // Row navigation by the REAL party id; the real A02 reconciliation screen
    // loads the single read (mocked here) and renders the CHK form.
    await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(singleView) }),
    );
    await page.route(`**/api/v1/arrivals/${PARTY}/reconciliation`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reconciliationView) }),
    );
    await page.getByRole("link", { name: "говядина" }).click();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals/${PARTY}/reconciliation`));
    await expect(page.getByRole("heading", { name: "Сверка эВСД" })).toBeVisible();
    await shot(page, "reconciliation-placeholder-1440");

    // Back: the URL context (queue filter) survives.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB}/arrivals\\?queue=expected`));
    await expect(page.getByText("говядина")).toBeVisible();
  });

  test("narrow screen keeps the controls stacked", async ({ page }) => {
    await mockSessionAndArrivals(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/labs/${LAB}/arrivals`);
    await expect(page.getByText("говядина")).toBeVisible();
    const search = page.getByLabel("Поиск (документ, продукция)");
    const box = (await search.boundingBox()) ?? { width: 0 };
    expect(box.width).toBeGreaterThan(200);
    await shot(page, "list-390");
  });
});
