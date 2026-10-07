import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"ara-review.spec.js",workers:1,retries:0,reporter:"list",
  use:{baseURL:"http://127.0.0.1:4175"},projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
});
