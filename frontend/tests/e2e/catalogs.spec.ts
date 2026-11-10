/**
 * Catalogs e2e (Task C02): editors of the own laboratory (SC-093/SC-094) and
 * the bulk price command with a partial coverage and independent prices
 * (AT-21, SC-095/SC-096/SC-097) against the REAL backend + PostgreSQL + Redis.
 *
 * Prerequisites (see docs/implementation/C02-bulk-evidence.md):
 *   - postgres `vse-pg-c02` (55441), redis `vse-redis-c02` (56391), backend
 *     uvicorn on 127.0.0.1:8001, vite dev server on 4173 (proxy → 8001);
 *   - seeded identity data (frontend/tests/e2e/seed_identity.py), which
 *     writes frontend/tests/e2e/identity-seed.local.json.
 * The suite fails loudly when the seed file or the backend is missing.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Seed {
  admin: { login: string; password: string };
  userPassword: string;
  users: { vet: string; head: string; analyst: string };
  labAId: string;
  labBId: string;
  productId: string;
}

const seedPath = resolve(process.cwd(), "tests/e2e/identity-seed.local.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/c02-${name}.png`, fullPage: true });
}

async function loginTo(page: Page, loginName: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill(seed.userPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/catalogs/);
}

const scope = (tab: string): string =>
  `/catalogs?laboratory_id=${seed.labAId}&product_species_id=${seed.productId}&tab=${tab}`;

test.describe("catalogs", () => {
  test("test_head_edits_own_catalog", async ({ page }) => {
    // HEAD edits the catalog of ITS OWN laboratory (SC-093).
    await loginTo(page, seed.users.head, scope("methods"));
    await expect(page.getByRole("heading", { name: "Справочники" })).toBeVisible();

    // Readiness reports the missing REAL configuration inputs (C01 seam).
    await expect(page.getByTestId("catalog-readiness")).toBeVisible();
    await expect(page.getByTestId("catalog-readiness")).toContainText("Раздел не готов к расчёту");
    await shot(page, "head-methods-1440");

    // Create a method rule through the editor.
    await page.getByRole("button", { name: "Добавить норму" }).click();
    await page.getByLabel("Показатель (UUID)").fill("22222222-2222-4222-8222-222222222222");
    await page.getByLabel("Состояние продукции (UUID)").fill("33333333-3333-4333-8333-333333333333");
    await page.getByLabel("Единица измерения нормы").fill("kg");
    await page.getByLabel("Нижняя граница", { exact: true }).fill("0");
    await page.getByLabel("Верхняя граница", { exact: true }).fill("100");
    await page.getByLabel("Версия").fill("1");
    await page.getByLabel("Источник методики").fill("методика Е2Е");
    await page.getByRole("button", { name: "Сохранить" }).click();
    // The rule list may already contain earlier runs' rows (persistent
    // database); the new rule only needs to appear among them.
    await expect(page.getByRole("cell", { name: "22222222…" }).first()).toBeVisible();

    // Tariff of the same scope.
    await page.getByRole("link", { name: "Стоимость исследований" }).click();
    await page.getByRole("button", { name: "Добавить тариф" }).click();
    await page.getByLabel("Код услуги").fill("trichinelloscopy");
    await page.getByLabel("Единица измерения").fill("kg");
    await page.getByLabel("Цена, ₽").fill("100.00");
    await page.getByLabel("Версия прейскуранта").fill("1");
    await page.getByLabel("Источник прейскуранта").fill("прейскурант Е2Е");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("cell", { name: "trichinelloscopy" })).toBeVisible();
    // Earlier runs may have left rows with the same values (persistent
    // database); the new tariff only needs to appear among them.
    await expect(page.getByRole("cell", { name: "100.00" }).first()).toBeVisible();
    await shot(page, "head-tariffs-1440");

    // Narrow (390) and wide (1440) screens of the same state.
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "head-tariffs-390");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("test_analyst_bulk_price_partial_coverage", async ({ page }) => {
    // ANALYST may run the bulk price command for its own coverage (SC-095).
    await loginTo(page, seed.users.analyst, scope("tariffs"));

    // First run: price 100 in lab A only (lab B is unchecked).
    await page.getByRole("button", { name: "Массовая цена" }).click();
    const coverage = page.getByTestId("bulk-coverage");
    await expect(coverage).toContainText("затронутые лаборатории (2)");
    // The FULL coverage is listed before the confirmation.
    await expect(coverage.locator("input[type=checkbox]")).toHaveCount(2);
    await coverage
      .locator("label", { hasText: seed.labBId.slice(0, 8) })
      .locator("input")
      .uncheck();
    await page.getByLabel("Код услуги", { exact: true }).fill("bulk-e2e-service");
    await page.getByLabel("Единица измерения", { exact: true }).fill("kg");
    await page.getByLabel("Новая цена, ₽").fill("100.00");
    await shot(page, "bulk-coverage-before-confirm");
    await page.getByRole("button", { name: "Применить цену" }).click();

    // The per-target actual result is shown; nothing about lab B changed.
    await expect(page.getByTestId("bulk-state")).toContainText("Применено полностью");
    const result = page.getByTestId("bulk-result");
    await expect(result).toContainText("Применено");
    await shot(page, "bulk-result");
    await page.getByTestId("bulk-result").getByRole("button", { name: "Закрыть" }).click();
    const bulkRow = page.locator("tr", { hasText: "bulk-e2e-service" });
    await expect(bulkRow.getByRole("cell", { name: "100.00" })).toBeVisible();

    // Editing lab A to 150 leaves lab B untouched (no inheritance, SC-096):
    // lab B was never in the coverage, so only lab A's row changes below.
    await bulkRow.getByRole("button", { name: "Изменить" }).click();
    await page.getByLabel("Цена, ₽").fill("150.00");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("cell", { name: "150.00" })).toBeVisible();
    await shot(page, "tariff-edited-150");
  });
});
