import { defineConfig, devices } from "@playwright/test";

// Playwright config untuk AClean Webapp E2E tests.
// Test target: localhost dev server (port 3000 / 3001 auto-detect).
// Untuk production smoke test, set BASE_URL env var.

const PORT = process.env.PORT || "3000";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000, // 30s per test — generous untuk slow PDF generation
  expect: {
    timeout: 5000,
  },
  fullyParallel: false, // Sequential untuk hindari race condition di Supabase shared DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker — DB production shared
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Auto-start dev server kalau BASE_URL = localhost & belum running
  webServer: process.env.BASE_URL ? undefined : {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
