import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const listUrl = pathToFileURL(resolve('admin_makets/admin-reports.html')).href;
const createUrl = pathToFileURL(resolve('admin_makets/admin-report-create.html')).href;
const printUrl = pathToFileURL(resolve('admin_makets/admin-report-print.html')).href;
const samplesUrl = pathToFileURL(resolve('admin_makets/sample-accounting.html')).href;

test('список отчётов использует административную шапку и меню действий', async ({ page }) => {
  await page.goto(listUrl);
  await expect(page.locator('#admin-users-link')).toContainText('Управление пользователями');
  await expect(page.locator('#admin-reports-link')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.report-list-table tbody tr')).toHaveCount(20);
  await page.locator('.report-actions-menu summary').first().click();
  await expect(page.locator('.report-actions-popover').first()).toBeVisible();
  await expect(page.locator('.report-actions-popover').first()).toContainText('Скачать Excel');
  await expect(page.locator('.report-pagination-count')).toContainText('из 27');
});

test('создание формирует предварительный отчёт и требует семь кодов', async ({ page }) => {
  await page.goto(createUrl);
  await page.locator('#report-laboratory').selectOption('lab-nizhnekamsk');
  await expect(page.locator('#report-period')).toBeEnabled();
  await page.getByRole('button', { name: 'Сформировать отчёт' }).click();
  await expect(page.getByRole('heading', { name: 'Предварительный просмотр' })).toBeVisible();
  await expect(page.locator('.report-code-field input')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Сохранить отчёт' })).toBeDisabled();
  for (const input of await page.locator('.report-code-field input').all()) await input.fill('123');
  await expect(page.getByRole('button', { name: 'Сохранить отчёт' })).toBeEnabled();
});

test('на узком экране матрица прокручивается внутри страницы', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(createUrl);
  await page.locator('#report-laboratory').selectOption('lab-nizhnekamsk');
  await page.getByRole('button', { name: 'Сформировать отчёт' }).click();
  await expect(page.locator('.report-matrix-scroll')).toBeVisible();
  const dimensions = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth, matrix: document.querySelector('.report-matrix-scroll').scrollWidth, matrixClient: document.querySelector('.report-matrix-scroll').clientWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.matrix).toBeGreaterThan(dimensions.matrixClient);
});

test('печатная версия не содержит шапку системы', async ({ page }) => {
  await page.goto(printUrl);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.official-form-title')).toBeVisible();
  await expect(page.locator('.official-report-table')).toBeVisible();
});

test('тип отчёта переключает форму 5-вет и учёт проб', async ({ page }) => {
  await page.goto(listUrl);
  await expect(page.locator('#report-type')).toHaveValue('5-vet-iii');
  await page.locator('.report-type-filter .choices').click();
  await page.getByRole('option', { name: 'Учёт проб' }).click();
  await expect(page).toHaveURL(/sample-accounting\.html/);
  await expect(page.getByRole('heading', { name: 'Учёт проб' })).toBeVisible();
  await expect(page.locator('#report-type')).toHaveValue('sample-accounting');
});

test('учёт проб показывает все виды продукции и два раздела данных', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('vse-sample-accounting-demo-v1'));
  await page.goto(samplesUrl);
  await expect(page.locator('.sample-balance-table tbody tr')).toHaveCount(20);
  const positiveRows = page.locator('.sample-balance-table tbody tr:not(.empty-balance)');
  expect(await positiveRows.count()).toBeGreaterThanOrEqual(5);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Доступные отборы' })).toHaveCount(0);
  await expect(page.locator('.sample-balance-table thead')).toContainText('Количество взятых проб');
  await expect(page.getByText('Всего проб в наличии')).toHaveCount(0);
});

test('утилизация списывает весь остаток и создаёт запись в истории', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('vse-sample-accounting-demo-v1'));
  await page.goto(samplesUrl);
  const beefRow = page.locator('.sample-balance-table tbody tr').filter({ has: page.getByText('Говядина', { exact: true }) });
  await expect(beefRow).toContainText('2,65 кг');
  await beefRow.getByRole('button', { name: 'Утилизировать остаток' }).click();
  await expect(page.getByRole('dialog', { name: 'Утилизация остатка' })).toBeVisible();
  await page.locator('#sample-disposal-vsd').fill('RU016:261105-011100');
  await page.getByRole('button', { name: 'Утилизировать', exact: true }).click();
  await expect(page.locator('.sample-feedback')).toContainText('Утилизация 2,65 кг зарегистрирована');
  await expect(beefRow).toContainText('0 кг');
  await page.getByRole('tab', { name: 'История утилизаций' }).click();
  await expect(page.locator('.sample-history-table')).toContainText('RU016:261105-011100');
});

test('меню отчёта учёта проб содержит Excel, PDF и печать', async ({ page }) => {
  await page.goto(samplesUrl);
  await page.locator('.sample-page-actions summary[aria-label="Действия"]').click();
  const menu = page.locator('.sample-page-actions .report-actions-popover');
  await expect(menu).toContainText('Скачать Excel');
  await expect(menu).toContainText('Скачать PDF');
  await expect(menu).toContainText('Распечатать');
  const downloadPromise = page.waitForEvent('download');
  await menu.getByRole('button', { name: 'Скачать Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  await page.locator('.sample-page-actions summary[aria-label="Действия"]').click();
  await expect(menu.getByRole('link', { name: 'Скачать PDF' })).toHaveAttribute('href', /sample-accounting-print\.html/);
});

test('учёт проб на узком экране не создаёт горизонтальную прокрутку страницы', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(samplesUrl);
  const dimensions = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('печатная форма учёта проб содержит текущие остатки без шапки системы', async ({ page }) => {
  await page.goto(`${samplesUrl.replace('sample-accounting.html', 'sample-accounting-print.html')}?laboratory=lab-kazan-1`);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Учёт проб' })).toBeVisible();
  await expect(page.locator('.sample-print-table tbody tr')).toHaveCount(20);
});
