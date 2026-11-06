import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const profileUrl = pathToFileURL(resolve('profile.html')).href;
const storyUrl = id => `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story`;
const screenshotDir = resolve('test-results');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const injectAxe = page => page.addScriptTag({ content: `(() => {
  const previous = window.axe;
  ${axeSource}
  window.__vseProfileTestAxe = window.axe;
  window.axe = previous;
})();` });

test('Профиль: данные, выбор фото и смена пароля', async ({ page }) => {
  await page.goto(profileUrl);
  await expect(page.getByRole('heading', { name: 'Профиль пользователя' })).toBeVisible();
  await expect(page.getByLabel('Профиль пользователя').getByText('Лаборатория ВСЭ №1 г. Казань', { exact: true })).toBeVisible();
  await expect(page.getByText('Создание ВСЭ', { exact: true })).toBeVisible();

  const photo = page.getByLabel('Выбрать фото профиля');
  await photo.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(page.getByRole('status')).toHaveText('Выбор фото — демонстрация');

  const toggle = page.getByRole('button', { name: 'Сменить пароль' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const current = page.getByLabel('Старый пароль');
  const next = page.getByLabel('Новый пароль', { exact: true });
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('autocomplete', 'current-password');
  await expect(next).toHaveAttribute('autocomplete', 'new-password');
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
  await expect(current).toBeFocused();
  await expect(page.getByText('Введите старый пароль.', { exact: true })).toBeVisible();
  await expect(page.getByText('Введите новый пароль.', { exact: true })).toBeVisible();
  await current.fill('old-demo-secret');
  await next.fill('new-demo-secret');
  await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Смена пароля — демонстрация');
  await toggle.click();
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  expect(await page.evaluate(() => [localStorage, sessionStorage].some(storage => Object.values(storage).some(value => value.includes('demo-secret'))))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
});

test('Профиль: форма сохраняет размер кнопки и блокирует повторную отправку', async ({ page }) => {
  await page.goto(storyUrl('profile-password-form--open'));
  await expect(page.getByRole('form', { name: 'Смена пароля' })).toBeVisible();
  await page.getByLabel('Старый пароль').fill('old-demo-secret');
  await page.getByLabel('Новый пароль', { exact: true }).fill('new-demo-secret');
  const submit = page.getByRole('button', { name: 'Сохранить новый пароль' });
  const before = await submit.boundingBox();
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  expect((await submit.boundingBox()).width).toBe(before.width);
  await expect(page.getByRole('form', { name: 'Смена пароля' })).toBeHidden();
});

test('Профиль: два экземпляра формы получают разные идентификаторы', async ({ page }) => {
  await page.goto(storyUrl('profile-password-form--closed'));
  await expect(page.getByRole('button', { name: 'Сменить пароль' })).toBeVisible();
  const unique = await page.evaluate(() => {
    const first = globalThis.VseProfile.createPasswordChangeForm({ open: true });
    const second = globalThis.VseProfile.createPasswordChangeForm({ open: true });
    document.body.append(first, second);
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    return new Set(ids).size === ids.length;
  });
  expect(unique).toBe(true);
});

test('Профиль: выход ведёт на экран входа', async ({ page }) => {
  await page.goto(profileUrl);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login\.html$/);
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
  test(`Профиль: ${name}, геометрия и доступность`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(profileUrl);
    await expect(page.getByRole('heading', { name: 'Профиль пользователя' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await injectAxe(page);
    const violations = await page.evaluate(async () => (await __vseProfileTestAxe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    expect(violations).toEqual([]);
    await page.screenshot({ path: resolve(screenshotDir, `profile-${name}.png`), fullPage: true, animations: 'disabled' });
  });
}
