/**
 * Catalogs e2e (Task C02 + DR6): the dedicated editor pages of the three
 * directories (SC-093/SC-094) and the bulk price command with a partial
 * coverage and independent prices (AT-21, SC-095/SC-096/SC-097) against the
 * REAL backend + PostgreSQL + Redis.
 *
 * DR6 replaced the old tab strip and result tables with the dedicated editor
 * pages (ТЗ-DR6 §9/§10/§11): each tab is a page with eyebrow
 * «Редактирование справочника», per-card price fields, diagnostic cards for
 * tariffs outside the shared indicator registry, and «Отменить» back to the
 * overview. There is no result table and no row-level «Изменить» any more —
 * the assertions below target the NEW behavior.
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
    // HEAD edits the catalog of ITS OWN laboratory (SC-093): the methods
    // editor page opens directly, no laboratory selector.
    await loginTo(page, seed.users.head, scope("methods"));
    await expect(page.getByRole("heading", { name: "Нормы исследований" })).toBeVisible();
    await expect(page.getByText("Редактирование справочника")).toBeVisible();

    // Readiness reports the missing REAL configuration inputs (C01 seam).
    await expect(page.getByTestId("catalog-readiness")).toBeVisible();
    await expect(page.getByTestId("catalog-readiness")).toContainText("Раздел не готов к расчёту");
    await shot(page, "head-methods-1440");

    // Create a method rule through the editor dialog.
    await page.getByRole("button", { name: "Добавить норму" }).click();
    await page.getByLabel("Показатель (UUID)").fill("22222222-2222-4222-8222-222222222222");
    await page.getByLabel("Состояние продукции (UUID)").fill("33333333-3333-4333-8333-333333333333");
    await page.getByLabel("Единица измерения нормы").fill("kg");
    await page.getByLabel("Нижняя граница", { exact: true }).fill("0");
    await page.getByLabel("Верхняя граница", { exact: true }).fill("100");
    await page.getByLabel("Версия").fill("1");
    await page.getByLabel("Источник методики").fill("методика Е2Е");
    await page.getByRole("button", { name: "Сохранить" }).click();
    // The indicator is outside the shared registry: the page shows the honest
    // diagnostic card with the code (no invented name, never a table). The
    // database is persistent: earlier runs may have left the same rule.
    await expect(
      page.locator("code", { hasText: "22222222-2222-4222-8222-222222222222" }).first(),
    ).toBeVisible();

    // Tariff of the same scope: back to the overview, then the tariffs editor.
    await page.getByRole("button", { name: "Отменить" }).click();
    await expect(page.getByRole("heading", { name: "Управление справочниками" })).toBeVisible();
    await page.getByTestId("catalog-card-tariffs").getByRole("button", { name: "Редактировать" }).click();
    await expect(page.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeVisible();
    await page.getByRole("button", { name: "Добавить тариф" }).click();
    // A per-run service code: the database is persistent, so a fixed code
    // would 409 on the second run and mask the actual create result.
    const tariffCode = `trich-e2e-${Date.now()}`;
    await page.locator("#tariff-code").fill(tariffCode);
    await page.locator("#tariff-unit").fill("kg");
    await page.locator("#tariff-price").fill("100.00");
    await page.locator("#tariff-version").fill("1");
    await page.locator("#tariff-source").fill("прейскурант Е2Е");
    await page.getByRole("button", { name: "Сохранить" }).click();
    // The diagnostic card shows the foreign service code; the price itself is
    // never edited outside the shared registry on this page.
    await expect(page.locator("code", { hasText: tariffCode }).first()).toBeVisible();
    await shot(page, "head-tariffs-1440");

    // Narrow (390) and wide (1440) screens of the same state.
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "head-tariffs-390");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("test_analyst_bulk_price_partial_coverage", async ({ page }) => {
    // ANALYST may run the bulk price command for its own coverage (SC-095).
    await loginTo(page, seed.users.analyst, scope("tariffs"));
    await expect(page.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeVisible();

    // The coverage labels are the human-readable laboratory names; the lab-B
    // name comes from the same scoped read model the selector uses.
    const labs = await page.request.get("/api/v1/contexts/laboratories");
    expect(labs.ok()).toBe(true);
    const options = (await labs.json()) as { laboratory_id: string; name: string }[];
    const labBName = options.find((option) => option.laboratory_id === seed.labBId)?.name ?? "";

    // The bulk command opens the coverage dialog BEFORE any confirmation.
    await page.getByRole("button", { name: "Применить стоимость к лабораториям" }).click();
    const coverage = page.getByTestId("bulk-coverage");
    await expect(coverage).toContainText("затронутые лаборатории (2)");
    // The FULL coverage is listed before the confirmation.
    await expect(coverage.locator("input[type=checkbox]")).toHaveCount(2);
    await coverage.locator("label", { hasText: labBName }).locator("input").uncheck();
    await page.locator("#bulk-code").fill("bulk-e2e-service");
    await page.locator("#bulk-unit").fill("kg");
    await page.locator("#bulk-price").fill("100.00");
    await shot(page, "bulk-coverage-before-confirm");
    await page.getByRole("button", { name: "Применить цену" }).click();

    // The per-target actual result is shown; nothing about lab B changed.
    await expect(page.getByTestId("bulk-state")).toContainText("Применено полностью");
    const result = page.getByTestId("bulk-result");
    await expect(result).toContainText("Применено");
    await shot(page, "bulk-result");
    await page.getByTestId("bulk-result").getByRole("button", { name: "Закрыть" }).click();

    // The editor page shows the foreign service code as a diagnostic card
    // (no result table by design since DR6).
    await expect(page.locator("code", { hasText: "bulk-e2e-service" }).first()).toBeVisible();

    // No inheritance (SC-096): lab B was never in the coverage, so the
    // service code is absent there. The laboratory selector switches the
    // scope; the data follows the chosen laboratory only.
    const selector = page.getByTestId("catalog-context").getByLabel("Лаборатория");
    await selector.selectOption(seed.labBId);
    await expect(page.locator("code", { hasText: "bulk-e2e-service" })).toHaveCount(0);
    await selector.selectOption(seed.labAId);
    await expect(page.locator("code", { hasText: "bulk-e2e-service" }).first()).toBeVisible();

    // The applied price on lab A is verified against the real read model:
    // the old row-level «Изменить» no longer exists by design — a foreign
    // service code is a read-only diagnostic card on the editor page. The
    // product scope is the assigned pair of the chosen laboratory (the URL
    // parameter never widens it), so the check reads the scope from /contexts.
    const contexts = await page.request.get("/api/v1/contexts");
    expect(contexts.ok()).toBe(true);
    const scopeRows = (await contexts.json()) as {
      laboratory_id: string | null;
      product_scope_id: string | null;
    }[];
    const speciesId = scopeRows.find((row) => row.laboratory_id === seed.labAId)?.product_scope_id;
    expect(speciesId).toBeTruthy();
    const tariffs = await page.request.get(
      `/api/v1/catalogs/tariffs?laboratory_id=${seed.labAId}&product_species_id=${speciesId}&page=1`,
    );
    expect(tariffs.ok()).toBe(true);
    const items = (await tariffs.json()) as {
      items: { service_code: string; laboratory_id: string; price: string }[];
    };
    const bulkRows = items.items.filter(
      (item) => item.service_code === "bulk-e2e-service" && item.laboratory_id === seed.labAId,
    );
    expect(bulkRows.length).toBeGreaterThan(0);
    for (const row of bulkRows) expect(row.price).toBe("100.00");
    await shot(page, "bulk-lab-a-only-100");
  });
});
