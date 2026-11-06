import { defineConfig, devices } from "@playwright/test";

/**
 * Minimal Playwright configuration for F01 (SPEC-06 requires the script; e2e
 * specs arrive with F02/F03 — the CI route walkthrough belongs to those tasks).
 * Run locally with a built SPA or leave empty until specs land.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
  },
  ...(process.env.CI
    ? {}
    : {
        webServer: [
          {
            command: "npm run dev -- --port 4173 --strictPort",
            url: "http://localhost:4173",
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            // Storybook serves the component stories the shell checks open.
            command: "npm run storybook -- --port 6006 --no-open --ci",
            url: "http://localhost:6006",
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ],
      }),
});
