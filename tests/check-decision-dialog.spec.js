import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const screens = [
  { file: 'evsd-check-milk-ak-bars.html', modals: ['extinguish-modal', 'refusal-modal'] },
  { file: 'evsd-check-milk-nur.html', modals: ['extinguish-modal', 'refusal-modal'] },
  { file: 'evsd-check-usmanov.html', modals: ['extinguish-modal', 'refusal-modal', 'return-evsd-modal'] },
  { file: 'evsd-check-agro.html', modals: ['extinguish-modal', 'refusal-modal', 'return-evsd-modal'] },
];

for (const screen of screens) {
  test(`${screen.file}: окна решения помещаются в низкий экран`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto(pathToFileURL(resolve(screen.file)).href);

    for (const id of screen.modals) {
      await page.evaluate(modalId => {
        document.querySelectorAll('.modal-backdrop.open').forEach(item => item.classList.remove('open'));
        const backdrop = document.getElementById(modalId);
        backdrop.classList.add('open');
        backdrop.setAttribute('aria-hidden', 'false');
      }, id);

      const dialog = page.locator(`#${id} .extinguish-modal`);
      const actions = page.locator(`#${id} .modal-actions`);
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      const actionsBox = await actions.boundingBox();
      const layers = await page.evaluate(modalId => ({
        modal: Number.parseInt(getComputedStyle(document.getElementById(modalId)).zIndex, 10),
        header: Number.parseInt(getComputedStyle(document.querySelector('.topbar')).zIndex, 10),
      }), id);
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(600);
      expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(600);
      expect(layers.modal).toBeGreaterThan(layers.header);
    }
  });
}
