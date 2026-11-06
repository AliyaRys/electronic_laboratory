import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const historyUrl = pathToFileURL(resolve('admin_makets/admin-user-history.html')).href;

test('История пользователя: фильтр, раскрытие diff и пагинация', async ({ page }) => {
  await page.goto(`${historyUrl}?user=u-1001`);
  await expect(page.getByRole('heading', { name: 'История изменений', exact: true })).toBeVisible();
  await expect(page.getByText('Алексеева Марина Викторовна', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-history-event')).toHaveCount(20);
  await expect(page.getByText('Показано 1–20 из 23', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page.locator('.admin-history-event')).toHaveCount(3);
  await page.getByLabel('Событие').selectOption('permissions');
  await expect(page.locator('.admin-history-event')).toHaveCount(1);
  const toggle = page.locator('.admin-history-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Редактирование справочников', { exact: false })).toBeVisible();
  await expect(page.getByText('Растительная пищевая продукция', { exact: false })).toBeVisible();
  expect((await page.locator('body').innerText()).toLocaleLowerCase('ru-RU')).not.toContain('пароль');
  expect((await page.locator('body').innerText()).toLocaleLowerCase('ru-RU')).not.toContain('токен');
});

test('История пользователя: удалённая запись и узкий экран', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${historyUrl}?user=u-1001&state=deleted`);
  await expect(page.getByText('Пользователь удалён', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'К карточке пользователя' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'К списку пользователей' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
