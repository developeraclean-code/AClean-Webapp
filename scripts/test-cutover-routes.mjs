import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const retiredHosts = [
  "a-clean-webapp.vercel.app",
  "aclean.vercel.app",
  "status.aclean.id",
  "apsbeppcmsxeldnejibz.supabase.co",
];

const activeFiles = [
  ".github/workflows/cron.yml",
  ".github/workflows/payment-media.yml",
  "env.example",
  "vite.config.js",
  "api/_auth.js",
  "api/_handlers/customer.js",
  "api/_handlers/wa.js",
  "api/_tasks/reminders.js",
  "scripts/configure-payment-worker.mjs",
  "scripts/replay-ai-vision.mjs",
  "src/lib/loadAllData.js",
  "src/project/views/ProjectListView.jsx",
  "src/views/MaintenanceView.jsx",
  "src/views/SettingsView.jsx",
];

for (const file of activeFiles) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  for (const host of retiredHosts) {
    assert.equal(source.includes(host), false, `${file} still references retired host ${host}`);
  }
}

for (const file of [".github/workflows/cron.yml", ".github/workflows/payment-media.yml"]) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  assert.equal(/^\s*schedule:/m.test(source), false, `${file} must remain manual-only`);
  assert.match(source, /https:\/\/app\.aclean\.id/);
}

const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
assert.equal("crons" in vercel, false, "retired Vercel project must not define cron jobs");
assert.equal(vercel.redirects?.[0]?.destination, "https://app.aclean.id/:path*");

console.log(JSON.stringify({
  checkedActiveFiles: activeFiles.length,
  retiredHostsBlocked: retiredHosts.length,
  githubSchedulers: "manual-only",
  vercelCrons: 0,
}));
