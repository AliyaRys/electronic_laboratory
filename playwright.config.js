import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  workers: 2,
  reporter: 'list',
  use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'node tests/serve-storybook.mjs',
    url: 'http://127.0.0.1:6007/index.json',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
