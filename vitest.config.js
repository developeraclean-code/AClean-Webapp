import { defineConfig } from "vitest/config";

// Unit tests (Vitest) hanya untuk pure logic di src/lib.
// E2E (Playwright, folder e2e/) di-exclude — dijalankan via `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e", "**/*.e2e.*"],
    environment: "node",
  },
});
