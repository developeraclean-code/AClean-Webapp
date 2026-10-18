import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'field-report-reminder.spec.js', workers: 1, retries: 0, reporter: 'list',
  projects: [{ name: 'desktop', use: devices['Desktop Chrome'] }, { name: 'mobile', use: devices['Pixel 7'] }],
});
