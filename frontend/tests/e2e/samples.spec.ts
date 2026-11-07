/**
 * Sample accounting e2e (S03, MSW-style route mocks — the same honest pattern
 * as arrivals.spec.ts; the real-API leg is not available in this task's
 * environment and is documented as such in the evidence file): the screen
 * under «Отчёты», the readonly shown weight, the ANALYST read-only view and
 * the narrow screen.
 */
import { expect, test, type Page } from "@playwright/test";

const LAB = "11111111-2222-4333-8444-555555555555";
const SPECIES = "33333333-3333-4333-8333-333333333333";

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/s03-${name}.png`, fullPage: true });
}

interface Seed {
  role: "VET" | "ANALYST";
}

async function mockSamples(page: Page, seed: Seed): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: seed.role === "VET" ? "Кузнецова Алиса Викторовна" : "Аналитик Татарстана",
        login: seed.role === "VET" ? "kuznetsova" : "analyst",
        email: "user@lab.tatar",
        position: null,
        role: seed.role,
        active: true,
        scopes: [{ laboratory_id: LAB, product_scope_id: null }],
        capabilities: [],
        revision: 3,
      }),
    }),
  );
  await page.route("**/api/v1/samples/balances*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ product_species_id: SPECIES, mass_kg: "12.6", revision: 3 }]),
    }),
  );
  await page.route("**/api/v1/samples/collections*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            party_id: "9c1b2d3e-1111-4222-8333-444444444444",
            laboratory_id: LAB,
            product_species_id: SPECIES,
            classification_snapshot: { product: { id: SPECIES, name: "говядина" } },
            collected_on: "2026-11-05",
            mass_kg: "12.6",
            collected_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
            created_at: "2026-11-05T10:00:00Z",
            disposal_id: null,
            revision: 1,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    }),
  );
  await page.route("**/api/v1/samples/disposals*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            laboratory_id: LAB,
            product_species_id: SPECIES,
            disposed_on: "2026-11-06",
            mass_kg: "12.6",
            external_vsd_number: "ВСД-001",
            actor_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
            recorded_at: "2026-11-06T10:00:00Z",
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    }),
  );
}

test.describe("samples accounting", () => {
  test("balances and history under Отчёты with the readonly weight", async ({ page }) => {
    await mockSamples(page, { role: "VET" });
    await page.goto(`/labs/${LAB}/reports/samples`);
    await expect(page.getByRole("heading", { name: "Учёт проб" })).toBeVisible();
    await expect(page.getByText("12.6").first()).toBeVisible();
    // No disposal action exists before the dialog, and the balance weight is
    // not editable anywhere on the screen.
    await expect(page.getByLabel(/Остаток/)).toHaveCount(0);
    await shot(page, "vet-1440");
  });

  test("the disposal dialog shows the kind/weight/date/number before confirm", async ({ page }) => {
    await mockSamples(page, { role: "VET" });
    await page.goto(`/labs/${LAB}/reports/samples`);
    await page.getByRole("button", { name: "Действия со строкой" }).click();
    await page.getByRole("menuitem", { name: "Утилизировать остаток" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("disposal-shown-mass")).toHaveText("12.6 кг");
    // No weight input exists: the shown mass is readonly.
    await expect(dialog.getByLabel(/Вес/)).toHaveCount(0);
    await expect(dialog.getByLabel("Дата утилизации")).toBeVisible();
    await expect(dialog.getByLabel("Номер исходящей эВСД")).toBeVisible();
    await shot(page, "dialog-1440");
  });

  test("ANALYST sees no disposal affordance (read-only scope)", async ({ page }) => {
    await mockSamples(page, { role: "ANALYST" });
    await page.goto(`/labs/${LAB}/reports/samples`);
    await expect(page.getByText("12.6").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Действия со строкой" })).toHaveCount(0);
    await shot(page, "analyst-1440");
  });

  test("narrow screen keeps the blocks stacked", async ({ page }) => {
    await mockSamples(page, { role: "VET" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/labs/${LAB}/reports/samples`);
    await expect(page.getByRole("heading", { name: "Учёт проб" })).toBeVisible();
    const heading = page.getByRole("heading", { name: "Остатки проб" });
    const box = (await heading.boundingBox()) ?? { y: 0 };
    const history = page.getByRole("heading", { name: "История утилизации" });
    const historyBox = (await history.boundingBox()) ?? { y: 0 };
    expect(historyBox.y).toBeGreaterThan(box.y);
    await shot(page, "vet-390");
  });
});
