/**
 * D02 browser check: the Storybook documents stories render the preview and
 * the actions at 1440 and 390 px with screenshots (visual evidence for the
 * A4/PDF and narrow-screen claims).
 */
import { expect, test } from "@playwright/test";

const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";
const encode = (id: string): string => encodeURIComponent(id);
const PREVIEW = `${STORYBOOK}/iframe.html?id=${encode("d02-документы--заключениеместнойвсэ")}&viewMode=story`;
const LONG = `${STORYBOOK}/iframe.html?id=${encode("d02-документы--заключениеубойногопунктасдлиннымиданными")}&viewMode=story`;

test("preview renders the requisites and the preliminary warning (1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PREVIEW);
  await expect(page.getByText("Ветеринарное заключение")).toBeVisible();
  await expect(page.getByText("Предварительная форма")).toBeVisible();
  await expect(page.getByText("Принятая масса, кг")).toBeVisible();
  await page.screenshot({ path: "test-results/d02-preview-1440.png", fullPage: true });
});

test("long owner/product data wrap without clipping", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LONG);
  await expect(page.getByText(/чрезвычайно длинного наименования владельца/)).toBeVisible();
  const clipped = await page.evaluate(() => {
    const cell = document.querySelector(".vse-conclusion-table td");
    return cell !== null && cell.scrollWidth > cell.clientWidth + 1;
  });
  expect(clipped).toBe(false);
  await page.screenshot({ path: "test-results/d02-preview-long-1440.png", fullPage: true });
});

test("narrow 390 story keeps the document readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LONG);
  await expect(page.getByText("Ветеринарное заключение")).toBeVisible();
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontal).toBe(false);
  await page.screenshot({ path: "test-results/d02-preview-390.png", fullPage: true });
});
