import {defineConfig,devices} from "@playwright/test";
import {fileURLToPath} from "node:url";
export default defineConfig({testDir:".",testMatch:"ara-review.spec.js",workers:1,retries:0,reporter:"list",
  use:{baseURL:"http://127.0.0.1:4175"},projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  webServer:{command:"/usr/local/bin/node scripts/preview-ara.mjs",cwd:fileURLToPath(new URL("../",import.meta.url)),url:"http://127.0.0.1:4175",reuseExistingServer:true},
});
