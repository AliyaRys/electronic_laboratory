/**
 * A02 browser check (temporary, not committed): the built Storybook A02
 * stories render the CHK blocks in the fixed order at 1440 and 390 px.
 */
import { expect, test } from "@playwright/test";

const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";
const encode = (id: string): string => encodeURIComponent(id);
const STARTED = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--форманачатая")}&viewMode=story`;
const NARROW = `${STORYBOOK}/iframe.html?id=${encode("a02-сверка-эвсд--формаузкийэкран")}&viewMode=story`;
const ORDER = [
  "Документ",
  "Участники перевозки",
  "Идентификация транспорта",
  "Идентификация продукции",
  "Сопроводительные документы",
  "Прежняя ВСЭ",
  "Результаты",
  "Стоимость",
];

test("started form renders the CHK blocks in the fixed order (1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(STARTED);
  await expect(page.getByText("Решение о приёмке")).toBeVisible();
  const headings = await page.locator(".vse-check-block h3").allTextContents();
  expect(headings).toEqual(ORDER);
  await page.screenshot({ path: "test-results/a02-form-1440.png", fullPage: true });
});

test("narrow 390 story keeps the form usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(NARROW);
  await expect(page.getByText("Сохранить сверку")).toBeVisible();
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontal).toBe(false);
  await page.screenshot({ path: "test-results/a02-form-390.png", fullPage: true });
});
