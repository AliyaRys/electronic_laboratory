/**
 * Catalogs/profile mockup alignment e2e (DR4): the /catalogs overview matches
 * directories.html composition (three cards, mockup order, only real actions),
 * the header shows the PNG logo without the check icon, /profile shows the
 * real user in the two-card layout without raw UUIDs, and there is no
 * horizontal document overflow at 1440/1024/768/390.
 *
 * Prerequisites: the C02 isolated stack (vse-pg-c02 :55441, redis :56391,
 * uvicorn :8001, vite :4173) seeded by frontend/tests/e2e/seed_identity.py.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seedPath = resolve(process.cwd(), "tests/e2e/identity-seed.local.json");
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as {
  users: { head: string };
  userPassword: string;
  labAId: string;
  productId: string;
};

const widths: [number, number][] = [
  [1440, 900],
  [1024, 800],
  [768, 900],
  [390, 844],
];

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: `test-results/dr4-${name}.png`, fullPage: true });
}

async function login(page: Page, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Логин").fill(seed.users.head);
  await page.getByLabel("Пароль").fill(seed.userPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[?.]/g, ".*")));
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe("DR4 catalogs/profile mockup alignment", () => {
  test("catalogs overview and editor transition", async ({ page }) => {
    await login(page, "/catalogs");
    await expect(page.getByRole("heading", { name: "Управление справочниками" })).toBeVisible();
    await expect(page.getByTestId("catalog-overview")).toBeVisible();

    // PNG logo in the brand; no SVG icon there.
    expect(await page.locator(".brand-logo img").count()).toBe(1);
    expect(await page.locator(".brand-logo svg").count()).toBe(0);
    await expect(page.getByRole("link", { name: "Справочники" })).toHaveAttribute("aria-current", "page");

    const names = await page.locator("[data-testid^=catalog-card-] .vse-catalog-item-name").allInnerTexts();
    expect(names).toEqual(["Стоимость исследований ВСЭ", "Платные услуги", "Нормы исследований"]);
    expect(await page.getByRole("button", { name: "Редактировать" }).count()).toBe(3);
    expect(await page.getByRole("button", { name: /Удалить/ }).count()).toBe(0);

    for (const [width, height] of widths) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId("catalog-overview")).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `catalogs-${width}`);
    }

    // Keyboard: «Редактировать» is reachable and focused.
    await page.setViewportSize({ width: 1440, height: 900 });
    const edit = page.getByTestId("catalog-card-tariffs").getByRole("button", { name: "Редактировать" });
    await edit.focus();
    await expect(edit).toBeFocused();

    // The editor transition keeps laboratory_id/product_species_id in the URL.
    // This run starts from a SCOPED overview so the preservation is real.
    const LAB = seed.labAId;
    const SPECIES = seed.productId;
    await page.goto(
      `/catalogs?laboratory_id=${encodeURIComponent(LAB)}&product_species_id=${encodeURIComponent(SPECIES)}`,
    );
    await expect(page.getByRole("heading", { name: "Управление справочниками" })).toBeVisible();
    await page.getByTestId("catalog-card-tariffs").getByRole("button", { name: "Редактировать" }).click();
    // DR6: the editor transition opens the dedicated editor page (no pill
    // tab strip by design); the scope stays in the URL for the deep link.
    await expect(page.getByText("Редактирование справочника")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Стоимость исследований ВСЭ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Отменить" })).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("laboratory_id")).toBe(LAB);
    expect(url.searchParams.get("product_species_id")).toBe(SPECIES);
    expect(url.searchParams.get("tab")).toBe("tariffs");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, "catalogs-editor-1440");
    // «Отменить» returns to the overview.
    await page.getByRole("button", { name: "Отменить" }).click();
    await expect(page.getByRole("heading", { name: "Управление справочниками" })).toBeVisible();
  });

  test("profile composition at four widths", async ({ page }) => {
    await login(page, "/profile");
    await expect(page.getByRole("heading", { name: "Профиль пользователя" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Данные пользователя" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Смена пароля" })).toBeVisible();
    // The user link is the current page (aria-current on /profile).
    await expect(page.locator(".user-link.active")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("profile-photo-input")).toHaveCount(1);

    // The real session user's data, no raw UUIDs as names.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(/права доступа|прав не назначено/i.test(body)).toBe(true);

    await page.getByLabel("Текущий пароль").focus();
    await expect(page.getByLabel("Текущий пароль")).toBeFocused();

    for (const [width, height] of widths) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("heading", { name: "Смена пароля" })).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `profile-${width}`);
    }
  });
});
