import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const loginUrl = pathToFileURL(resolve('login.html')).href;
const recoveryUrl = pathToFileURL(resolve('password-recovery.html')).href;
const recoverySentUrl = pathToFileURL(resolve('password-recovery-sent.html')).href;
const activationUrl = pathToFileURL(resolve('admin_makets/account-activation.html')).href;
const storyUrl = id => `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story`;
const screenshotDir = resolve('test-results');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// Keep our audit engine separate from the Storybook accessibility addon's engine.
// The addon may run automatically while a story is opening.
const injectAxe = page => page.addScriptTag({ content: `(() => {
  const previous = window.axe;
  ${axeSource}
  window.__vseTestAxe = window.axe;
  window.axe = previous;
})();` });

test('Макет: маскировка пароля, подписи, ошибки и успешный переход', async ({ page }) => {
  await page.goto(loginUrl);
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await page.getByText('Логин', { exact: true }).click();
  await expect(page.getByLabel('Логин', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Забыли пароль?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Пароль', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const login = page.getByLabel('Логин', { exact: true });
  await expect(login).toBeFocused();
  await expect(login).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Введите логин', { exact: true })).toBeVisible();
  await expect(page.getByText('Введите пароль', { exact: true })).toBeVisible();
  await login.fill('test.user');
  await expect(login).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/journal\.html$/);
});

test('Макет: ссылка восстановления сохраняет маршрут', async ({ page }) => {
  await page.goto(loginUrl);
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page).toHaveURL(/\/password-recovery\.html$/);
});

test('Восстановление: проверка email, ожидание и подтверждение', async ({ page }) => {
  await page.goto(recoveryUrl);
  const email = page.getByLabel('Электронная почта', { exact: true });
  const submit = page.locator('button[type="submit"]');
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(email).toHaveAttribute('inputmode', 'email');
  await submit.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Укажите электронную почту.', { exact: true })).toBeVisible();
  await email.fill('wrong-address');
  await submit.click();
  await expect(page.getByText('Проверьте адрес электронной почты.', { exact: true })).toBeVisible();
  await email.fill('anna@example.ru');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(page).toHaveURL(/\/password-recovery-sent\.html$/);
  await expect(page.getByRole('status')).toContainText('с адресом «anna@example.ru»');
});

test('Восстановление: прямое подтверждение не раскрывает адрес, возврат очищает временные данные', async ({ page }) => {
  await page.goto(recoverySentUrl);
  const notice = page.getByRole('status');
  await expect(notice).toContainText('Если учётная запись существует');
  await expect(notice).not.toContainText('@');
  await page.evaluate(() => sessionStorage.setItem('vse-password-recovery-email', 'temporary@example.ru'));
  await page.getByRole('link', { name: 'Вернуться ко входу' }).click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem('vse-password-recovery-email'))).toBeNull();
});

test('Восстановление: составная форма блокирует повторную отправку', async ({ page }) => {
  await page.goto(storyUrl('auth-recovery-form--default'));
  await expect(page.getByRole('form', { name: 'Форма восстановления пароля' })).toBeVisible();
  const result = await page.evaluate(async () => {
    let calls = 0;
    let complete;
    const form = globalThis.VseAuth.createRecoveryForm({ onSubmit: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
    document.body.append(form);
    form.field.input.value = 'anna@example.ru';
    form.requestSubmit();
    form.requestSubmit();
    const busy = form.submitButton.disabled;
    complete();
    await Promise.resolve();
    return { calls, busy, type: form.field.input.type, autocomplete: form.field.input.autocomplete };
  });
  expect(result).toEqual({ calls: 1, busy: true, type: 'email', autocomplete: 'email' });
});

test('Активация: личные данные появляются после проверки, пароль валидируется и не сохраняется', async ({ page }) => {
  await page.goto(activationUrl);
  await page.evaluate(() => localStorage.removeItem('vse-admin-demo-v1'));
  await page.reload();
  await expect(page.getByText('Проверяем приглашение…', { exact: true })).toBeVisible();
  await expect(page.getByText('Бикмуллин Ринат Рашидович', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Бикмуллин Ринат Рашидович', { exact: true })).toBeVisible();
  const password = page.getByLabel('Новый пароль', { exact: true });
  const repeat = page.getByLabel('Повторите пароль', { exact: true });
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await page.getByRole('button', { name: 'Активировать учётную запись' }).click();
  await expect(password).toBeFocused();
  await password.fill('Пароль2026');
  await repeat.fill('Другой2026');
  await page.getByRole('button', { name: 'Активировать учётную запись' }).click();
  await expect(page.getByText('Пароли не совпадают.', { exact: true })).toBeVisible();
  await repeat.fill('Пароль2026');
  await page.getByRole('button', { name: 'Активировать учётную запись' }).click();
  await expect(page.getByText(/Учётная запись активирована/)).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('vse-admin-demo-v1') || '');
  expect(saved).not.toContain('Пароль2026');
  const state = JSON.parse(saved);
  expect(state.overrides['u-1002'].status).toBe('active');
  expect(state.overrides['u-1002'].history.filter(item => item.type === 'activated')).toHaveLength(1);
});

test('Активация: использованная и недействительная ссылки не раскрывают форму', async ({ page }) => {
  await page.goto(`${activationUrl}?state=used`);
  await expect(page.getByText('Приглашение уже использовано.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Восстановить пароль', exact: true })).toBeVisible();
  await expect(page.getByLabel('Новый пароль', { exact: true })).toHaveCount(0);
  await page.goto(`${activationUrl}?state=revoked`);
  await expect(page.getByText('Приглашение недействительно.', { exact: true })).toBeVisible();
  await expect(page.getByText('Бикмуллин Ринат Рашидович', { exact: true })).toHaveCount(0);
});

test('Активация: изменение статуса во время ввода не сохраняет пароль', async ({ page }) => {
  await page.goto(activationUrl);
  await page.evaluate(() => localStorage.removeItem('vse-admin-demo-v1'));
  await page.goto(`${activationUrl}?state=blocked-during`);
  await page.getByLabel('Новый пароль', { exact: true }).fill('Пароль2026');
  await page.getByLabel('Повторите пароль', { exact: true }).fill('Пароль2026');
  await page.getByRole('button', { name: 'Активировать учётную запись' }).click();
  await expect(page.getByText(/Активация недоступна/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vse-admin-demo-v1') || '')).not.toContain('Пароль2026');
});

test('Форма: ожидание, повторная отправка и демонстрационный результат', async ({ page }) => {
  await page.goto(storyUrl('auth-form--default'));
  await page.getByLabel('Логин', { exact: true }).fill('test.user');
  await page.getByLabel('Пароль', { exact: true }).fill('demo-password');
  const button = page.getByRole('button');
  const before = await button.boundingBox();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  expect((await button.boundingBox()).width).toBe(before.width);
  await expect(page.getByRole('status')).toHaveText('Форма заполнена. Это демонстрационный пример.');
  await expect(button).toBeEnabled();
  await expect(page).toHaveURL(storyUrl('auth-form--default'));
  expect(await page.evaluate(() => [localStorage, sessionStorage].some(storage => Object.values(storage).some(value => value.includes('demo-password'))))).toBe(false);
});

test('Форма: ошибка соединения, сохранение ввода и повтор', async ({ page }) => {
  await page.goto(storyUrl('auth-form--retry'));
  await page.getByLabel('Логин', { exact: true }).fill('test.user');
  await page.getByLabel('Пароль', { exact: true }).fill('demo-password');
  await page.getByRole('button').click();
  await expect(page.getByRole('alert')).toHaveText('Не удалось войти. Попробуйте ещё раз.');
  await expect(page.getByLabel('Логин', { exact: true })).toHaveValue('test.user');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button').click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('Компоненты: два экземпляра имеют разные идентификаторы; двойная отправка блокируется', async ({ page }) => {
  await page.goto(loginUrl);
  const result = await page.evaluate(async () => {
    let calls = 0;
    let complete;
    const form = VseAuth.createLoginForm({ onSubmit: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
    document.body.append(form);
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    form.fields.login.input.value = 'test.user';
    form.fields.password.input.value = 'demo-password';
    form.requestSubmit();
    form.requestSubmit();
    const busy = form.submitButton.disabled;
    complete();
    await Promise.resolve();
    return { unique: new Set(ids).size === ids.length, calls, busy };
  });
  expect(result).toEqual({ unique: true, calls: 1, busy: true });
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
  test(`Экран: ${name}, геометрия и доступность`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(loginUrl);
    await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, logo: document.querySelector('.auth-logo img').naturalWidth, animation: getComputedStyle(document.querySelector('.auth-orb')).animationName, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    expect(geometry.logo).toBeGreaterThan(0);
    expect(geometry).toMatchObject({ animation: 'none', reducedMotion: true });
    await injectAxe(page);
    const violations = await page.evaluate(async () => (await __vseTestAxe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    expect(violations).toEqual([]);
    await page.screenshot({ path: resolve(screenshotDir, `login-${name}.png`), fullPage: true, animations: 'disabled' });
  });
}

test('Каталог: узкий viewport и документация компонентов', async ({ page }) => {
  await page.goto('http://127.0.0.1:6007/index.html?path=/story/auth-screen--narrow');
  const preview = page.frameLocator('#storybook-preview-iframe');
  await expect(preview.locator('.auth-shell')).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('#storybook-preview-iframe').boundingBox()).width)).toBe(390);
  await page.screenshot({ path: resolve(screenshotDir, 'storybook-narrow.png'), fullPage: true });
  await page.goto('http://127.0.0.1:6007/index.html?path=/docs/auth-field--docs');
  await expect(page.frameLocator('#storybook-preview-iframe').locator('h1').filter({ hasText: 'Поле ввода' })).toBeVisible();
  await expect.poll(async () => Math.round((await page.frameLocator('#storybook-preview-iframe').locator('.auth-preview').first().boundingBox()).width)).toBe(370);
  const ids = await page.frameLocator('#storybook-preview-iframe').locator('input').evaluateAll(inputs => inputs.map(input => input.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.screenshot({ path: resolve(screenshotDir, 'storybook-field-docs.png'), fullPage: true });
});

for (const [file, url] of [['password-recovery', recoveryUrl], ['password-recovery-sent', recoverySentUrl]]) {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    test(`${file}: ${name}, геометрия и доступность`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await injectAxe(page);
      const violations = await page.evaluate(async () => (await __vseTestAxe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
      expect(violations).toEqual([]);
      await page.screenshot({ path: resolve(screenshotDir, `${file}-${name}.png`), fullPage: true, animations: 'disabled' });
    });
  }
}

const stories = Object.values(JSON.parse(readFileSync(resolve('storybook-static/index.json'), 'utf8')).entries).filter(entry => entry.type === 'story');
for (const story of stories) {
  test(`Storybook: ${story.title} / ${story.name}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(storyUrl(story.id));
    await expect(page.locator('#storybook-root :is(.vse-auth, .vse-app)').first()).toBeVisible();
    await expect(page.locator('.sb-errordisplay')).toBeHidden();
    await injectAxe(page);
    const violations = await page.evaluate(async () => (await __vseTestAxe.run(document.querySelector('#storybook-root'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    expect(violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
