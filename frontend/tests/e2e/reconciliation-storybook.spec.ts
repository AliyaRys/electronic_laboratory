/**
 * A02 browser check: the built Storybook A02 stories render the CHK sections
 * in the fixed order at 1440 and 390 px (the canonical mockup composition),
 * stay interactive (comparison marks reveal the fact inputs) and pass the
 * axe accessibility scan on the representative states (§16).
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";
const encode = (id: string): string => encodeURIComponent(id);
const STARTED = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--незаполненная")}&viewMode=story`;
const MISMATCH = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--однорасхождение")}&viewMode=story`;
const ERRORS = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--ошибкиполей")}&viewMode=story`;
const NARROW = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--узкийэкран")}&viewMode=story`;
const ORDER = [
  "Документ",
  "Участники перевозки",
  "Ветеринарно-санитарная оценка и идентификация транспорта",
  "Идентификация продукции по наименованию и визуальным осмотром",
  "Сопроводительные документы",
  "Ранее проведённая ВСЭ",
  "Результаты сверки",
  "Расчёт стоимости услуг",
];

test("started form renders the CHK sections in the fixed order (1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(STARTED);
  await expect(page.getByText("Решение о приёмке", { exact: true })).toBeVisible();
  const headings = await page.locator(".vse-check-section h2").allTextContents();
  expect(headings).toEqual(ORDER);
  await page.screenshot({ path: "test-results/a02-form-1440.png", fullPage: true });
});

test("narrow 390 story keeps the form usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(NARROW);
  await expect(page.getByRole("button", { name: "Сохранить сверку" })).toBeVisible();
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontal).toBe(false);
  await page.screenshot({ path: "test-results/a02-form-390.png", fullPage: true });
});

test("story interaction: marking a mismatch reveals the fact inputs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(STARTED);
  await expect(page.getByText("Решение о приёмке", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Фактическое значение")).toHaveCount(0);
  await page.getByRole("radio", { name: "Не совпадает: Вес, кг", exact: true }).click();
  const actual = page.getByLabel("Фактическое значение");
  const reason = page.getByLabel("Причина несоответствия");
  await expect(actual).toBeVisible();
  await expect(reason).toBeVisible();
  // Switching back to «Совпадает» removes the fact inputs again.
  await page.getByRole("radio", { name: "Совпадает: Вес, кг", exact: true }).click();
  await expect(actual).toHaveCount(0);
  await expect(reason).toHaveCount(0);
});

/** axe scan of one story; only serious/critical findings fail the build. */
async function axeScan(page: import("@playwright/test").Page, url: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.getByRole("heading", { level: 2 }).first().waitFor();
  const builder = new AxeBuilder({ page });
  const results = await builder.analyze();
  const blocking = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  test.info().attach("axe-violations.json", {
    body: JSON.stringify(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)).toEqual([]);
}

test("axe: the empty form has no serious or critical violations", async ({ page }) => {
  await axeScan(page, STARTED);
});

test("axe: the mismatch state has no serious or critical violations", async ({ page }) => {
  await axeScan(page, MISMATCH);
});

test("axe: the field-error state has no serious or critical violations", async ({ page }) => {
  await axeScan(page, ERRORS);
});

test("axe: the narrow screen has no serious or critical violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(NARROW);
  await page.getByRole("heading", { level: 2 }).first().waitFor();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)).toEqual([]);
});
