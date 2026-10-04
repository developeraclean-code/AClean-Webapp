import { defineConfig } from "@playwright/test";
// Isolated component tests: all data/gateway calls are mocked; no production login.
export default defineConfig({
  testDir: ".", testMatch: "wa-workspace.spec.js", workers: 1, timeout: 15000,
  reporter: "list", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
});
