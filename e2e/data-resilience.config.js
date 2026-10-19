import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Isolated fake provider. This suite never loads production credentials and its
// network fixture aborts every origin other than this server/fake Supabase.
export default defineConfig({
  testDir: ".", testMatch: "data-resilience.spec.js", workers: 1, timeout: 60_000,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3199", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3199 --strictPort`,
    url: "http://127.0.0.1:3199", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "https://database.simulated.test", VITE_SUPABASE_ANON_KEY: "SIMULATED_ANON_KEY", VITE_DEV_API_PROXY: "http://127.0.0.1:3199" },
  },
});
