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
import { INDICATORS } from "../../src/features/examinations/indicators";

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
  test("test_head_sees_business_only_catalog_fields", async ({ page }) => {
    // HEAD edits the catalog of ITS OWN laboratory (SC-093): the methods
    // editor page opens directly, no laboratory selector.
    await loginTo(page, seed.users.head, scope("methods"));
    await expect(page.getByRole("heading", { name: "Нормы исследований" })).toBeVisible();
    await expect(page.getByText("Редактирование справочника")).toBeVisible();

    // ТЗ business-fields §5.6: the full-readiness summary is NOT shown inside
    // the price/norm editors any more — it mixed independent settings; a
    // concrete calculation error stays blocking at VSE creation time.
    await expect(page.getByTestId("catalog-readiness")).toHaveCount(0);
    await expect(page.getByText("Раздел не готов к расчёту")).toHaveCount(0);
    await shot(page, "head-methods-1440");

    // The fixed research catalogue is not extended with arbitrary UUIDs from
    // the user interface. Only business norm controls may be present.
    await expect(page.getByRole("button", { name: "Добавить норму" })).toHaveCount(0);
    await expect(page.getByLabel("Показатель (UUID)")).toHaveCount(0);
    await expect(page.getByLabel("Состояние продукции (UUID)")).toHaveCount(0);
    await expect(page.getByLabel("Источник методики")).toHaveCount(0);

    // Tariff of the same scope: back to the overview, then the tariffs editor.
    await page.getByRole("button", { name: "Отменить" }).click();
    await expect(page.getByRole("heading", { name: "Управление справочниками" })).toBeVisible();
    await page.getByTestId("catalog-card-tariffs").getByRole("button", { name: "Редактировать" }).click();
    await expect(page.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить тариф" })).toHaveCount(0);
    await expect(page.getByLabel("Единица измерения")).toHaveCount(0);
    await expect(page.getByLabel("Источник прейскуранта")).toHaveCount(0);
    await expect(page.getByLabel(/^Стоимость:/).first()).toBeVisible();
    await shot(page, "head-tariffs-1440");

    // Narrow (390) and wide (1440) screens of the same state.
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "head-tariffs-390");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("test_analyst_bulk_price_uses_business_fields", async ({ page }) => {
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
    await expect(page.getByLabel("Исследование", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Код услуги")).toHaveCount(0);
    await expect(page.getByLabel("Единица измерения")).toHaveCount(0);
    // No silent default: the service must be chosen explicitly.
    await page.getByLabel("Исследование", { exact: true }).selectOption({ label: INDICATORS[0].name });
    await page.locator("#bulk-price").fill("100.00");
    await shot(page, "bulk-coverage-before-confirm");
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByTestId("bulk-coverage")).toHaveCount(0);
  });
});
