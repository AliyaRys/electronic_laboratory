/**
 * VetIS read e2e (ТЗ-10 V02, MSW-style route mocks — real API e2e is not
 * required here): the refresh button is enabled for VET/HEAD only, POSTs
 * /arrivals/sync, polls GET /operations/:id, refreshes the list and shows
 * the source product name; a FAILED run shows its own honest problem.
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const OPERATION = "aaaaaaaa-0000-4000-8000-000000000001";

const ME = {
  id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  full_name: "Кузнецова Алиса Викторовна",
  login: "kuznetsova",
  email: "kuznetsova@lab.tatar",
  position: "Ветеринарный врач",
  role: "VET",
  active: true,
  scopes: [{ laboratory_id: LAB, product_scope_id: null }],
  capabilities: ["arrivals:read", "vetis:sync"],
  revision: 3,
};

const arrivalsBody = (product: string) => ({
  items: [
    {
      id: "3f0e6d2a-1111-4222-8333-444444444444",
      party_id: "9c1b2d3e-1111-4222-8333-444444444444",
      laboratory_id: LAB,
      external: {
        contour: "PILOT",
        evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
        status: "CONFIRMED",
        fields: {
          documentNumber: "№ А-001234",
          transportNumber: "А123ВС77",
          consignor: "ООО «Мясопром»",
          consignee: "Убойный пункт Ленина, 5",
          productItem: "Отруба говяжьи",
        },
      },
      classification: {
        product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: product },
        subProduct: null,
        productItem: null,
        unit: null,
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
});

async function mockSession(page: Page, role = "VET"): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...ME, role }) }),
  );
}

async function mockArrivals(page: Page, product = "говядина"): Promise<void> {
  await page.route("**/api/v1/arrivals?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(arrivalsBody(product)),
    }),
  );
}

test.describe("vetis read sync", () => {
  test("vet runs the refresh job and the list shows the source name", async ({ page }) => {
    await mockSession(page);
    const afterSync = { value: false };
    await page.route("**/api/v1/arrivals?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(arrivalsBody(afterSync.value ? "свинина" : "говядина")),
      }),
    );
    let syncPosts = 0;
    await page.route("**/api/v1/arrivals/sync", (route) => {
      syncPosts += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: OPERATION,
          state: "PENDING",
          status_url: `/api/v1/operations/${OPERATION}`,
        }),
      });
    });
    let polls = 0;
    await page.route(`**/api/v1/operations/${OPERATION}`, (route) => {
      polls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: OPERATION,
          kind: "vetis.sync",
          state: polls >= 2 ? "SUCCESS" : "RUNNING",
          updated_at: "2026-11-09T10:00:00Z",
        }),
      });
    });

    await page.goto(`/labs/${LAB}/arrivals`);
    await expect(page.getByRole("heading", { name: "Поступления" })).toBeVisible();
    // The source name of the level-2 product is shown as received from ВетИС.
    await expect(page.getByText("говядина")).toBeVisible();

    const update = page.getByRole("button", { name: "Обновить" });
    await expect(update).toBeEnabled();
    await update.click();
    expect(syncPosts).toBe(1);
    afterSync.value = true;
    await expect(page.getByText("Обновление выполняется…")).toBeVisible();
    await expect(page.getByText("Поступления обновлены из ВетИС.")).toBeVisible({ timeout: 10_000 });
    // The list is refreshed after the successful full pass.
    await expect(page.getByText("свинина")).toBeVisible();
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  test("a failed run shows its own honest problem, never a fake import", async ({ page }) => {
    await mockSession(page);
    await mockArrivals(page);
    await page.route("**/api/v1/arrivals/sync", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          operation_id: OPERATION,
          state: "PENDING",
          status_url: `/api/v1/operations/${OPERATION}`,
        }),
      }),
    );
    await page.route(`**/api/v1/operations/${OPERATION}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: OPERATION,
          kind: "vetis.sync",
          state: "FAILED",
          problem: "INTEGRATION_NOT_CONFIGURED",
          updated_at: "2026-11-09T10:00:00Z",
        }),
      }),
    );

    await page.goto(`/labs/${LAB}/arrivals`);
    await page.getByRole("button", { name: "Обновить" }).click();
    await expect(page.getByText(/Обновление не выполнено/)).toBeVisible({ timeout: 10_000 });
  });

  test("analyst cannot run the sync: no refresh button, no posts", async ({ page }) => {
    await mockSession(page, "ANALYST");
    await mockArrivals(page);
    let posts = 0;
    await page.route("**/api/v1/arrivals/sync", (route) => {
      posts += 1;
      return route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });

    await page.goto(`/labs/${LAB}/arrivals`);
    // The compact refresh button belongs to VET/HEAD only; an ANALYST gets
    // neither the button nor a permanent hint row (DR3 spec 8.5).
    await expect(page.getByRole("button", { name: "Обновить" })).toHaveCount(0);
    await expect(page.getByText(/Обновление поступлений из ВетИС выполняется автоматически/)).toHaveCount(0);
    expect(posts).toBe(0);
  });
});
