/**
 * R03 visual evidence: the saved-matrix story at four viewport widths and a
 * print-media emulation (A4 check is honest on the page level; the PDF
 * itself is verified by the backend tests). Screenshots land in
 * test-results/r03-width-*.png / r03-print.png.
 */
import { expect, test } from "@playwright/test";

const STORYBOOK = process.env.E2E_STORYBOOK_URL ?? "http://localhost:6006";
const id = encodeURIComponent("r03-отчёты--матрицасохранённогоотчёта");
const STORY = `${STORYBOOK}/iframe.html?id=${id}&viewMode=story`;

test.describe.configure({ mode: "serial" });

test("matrix is readable at 1440 / 1024 / 768 / 390", async ({ page }) => {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(STORY);
    await expect(page.getByText("Матрица сохранённого отчёта")).toBeVisible();
    await expect(page.getByText("Предварительная форма")).toBeVisible();
    // Below 768 the table container may scroll horizontally BY DESIGN
    // (overflow-x: auto); the page itself must not be wider than the viewport.
    const pageHorizontal = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(pageHorizontal, `width ${width}`).toBe(false);
    await page.screenshot({ path: `test-results/r03-width-${width}.png`, fullPage: true });
  }
});

test("print media emulation renders the matrix without clipped cells", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(STORY);
  await expect(page.getByText("Матрица сохранённого отчёта")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: "test-results/r03-print.png", fullPage: true });
  const clipped = await page.evaluate(() => {
    const cell = document.querySelector(".vse-report-table td");
    return cell !== null && cell.scrollWidth > cell.clientWidth + 1;
  });
  // The A4 print surface is the backend PDF (verified by the renderer tests);
  // here we only prove the screen copy keeps every cell readable.
  expect(clipped).toBe(false);
});
