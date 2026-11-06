/**
 * Shell acceptance (F02): the four named checks plus visual screenshots of the
 * shell at 1440/1024/768/390. Component checks run against Storybook
 * (iframe.html story ids are deterministic), the legacy URL check against the
 * app dev server with a mocked session (page.route).
 */
import { expect, test, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "http://localhost:4173";
const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";

function storyUrl(component: string, story: string): string {
  return `${STORYBOOK}/iframe.html?id=f02-${component}--${story}&viewMode=story`;
}

async function mockSession(page: Page): Promise<void> {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
        full_name: "Анна Кузнецова",
        login: "kuznetsova",
        email: "kuznetsova@lab.tatar",
        position: "Ветеринарный врач",
        role: "VET",
        active: true,
        scopes: [{ laboratory_id: "11111111-2222-4333-8444-555555555555", product_scope_id: null }],
        capabilities: ["arrivals:read"],
        revision: 3,
      }),
    }),
  );
}

test.describe("dialog focus and escape", () => {
  test.use({ baseURL: STORYBOOK });

  test("test_dialog_focus_and_escape", async ({ page }) => {
    await page.goto(storyUrl("dialog", "focus-and-escape"));
    await page.getByRole("button", { name: "Открыть" }).click();

    // Safe cancel is focused first.
    const cancel = page.getByRole("button", { name: "Остаться" });
    await expect(cancel).toBeFocused();
    const dialog = page.getByRole("dialog", { name: "Удалить партию?" });
    await expect(dialog).toBeVisible();

    // Escape closes and focus returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть" })).toBeFocused();
  });
});

test.describe("row menu", () => {
  test.use({ baseURL: STORYBOOK });

  test("test_row_menu_does_not_navigate", async ({ page }) => {
    await page.goto(storyUrl("datatable", "row-menu"));
    const before = page.url();

    const menuButton = page.getByRole("button", { name: "Действия со строкой" }).first();
    await menuButton.click();
    const item = page.getByRole("menuitem", { name: "Создать ВСЭ" });
    await expect(item).toBeVisible();
    await item.click();

    // Choosing a row action is not navigation: URL unchanged, no row link followed.
    expect(page.url()).toBe(before);
    await expect(page.locator(".app-table-menu")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "В работе" })).toBeVisible();
  });
});

test.describe("long values", () => {
  test.use({ baseURL: STORYBOOK });

  test("test_long_values_keyboard", async ({ page }) => {
    await page.goto(storyUrl("datatable", "long-values"));
    const longValue = page.getByText(/Агрофирма Свободный Труд/);
    await expect(longValue).toBeVisible();
    // No page-level horizontal scrolling: overflow lives inside the table only.
    const overflow = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("legacy compatibility route", () => {
  test("test_legacy_url_without_identity", async ({ page }) => {
    await mockSession(page);
    await page.goto(`${APP}/journal.html`);

    // Honest outcome: no identity, no fabricated record.
    await expect(page.getByText(/Запись не указана/)).toBeVisible();
    await expect(page.getByText(/не открывают данные/)).toBeVisible();
    await expect(page.getByText(/эВСД|Усманов|Демо/)).toHaveCount(0);
    // The canonical shell is still fully operable.
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();
  });
});

test.describe("shell visuals", () => {
  test("screenshots at 1440/1024/768/390", async ({ page }) => {
    test.slow();
    await mockSession(page);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${APP}/`);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();
      await page.screenshot({ path: `test-results/shell-${width}.png`, fullPage: true });
    }
  });
});
