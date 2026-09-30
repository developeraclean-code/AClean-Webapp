import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const source of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const pos = line.indexOf("=");
    const key = line.slice(0, pos).trim();
    let value = line.slice(pos + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(".env.local"));

const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const apply = process.argv.includes("--apply");
if (!accountId) throw new Error("R2_ACCOUNT_ID belum dikonfigurasi");
if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN dengan izin Account > Workers R2 Storage > Edit diperlukan");

const desired = JSON.parse(fs.readFileSync(path.resolve("ops/r2-lifecycle.json"), "utf8")).rules || [];
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`;
const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data.errors?.map(e => e.message).join("; ") || `Cloudflare HTTP ${response.status}`;
    throw new Error(message);
  }
  return data.result || {};
}

const current = await request("GET");
const currentRules = Array.isArray(current.rules) ? current.rules : [];
const desiredIds = new Set(desired.map(rule => rule.id));
const merged = [...currentRules.filter(rule => !desiredIds.has(rule.id)), ...desired];

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  bucket,
  existingRules: currentRules.map(rule => rule.id),
  resultingRules: merged.map(rule => rule.id),
}, null, 2));

if (!apply) {
  console.log("Dry-run saja. Tambahkan --apply untuk menyimpan konfigurasi lifecycle.");
  process.exit(0);
}

await request("PUT", { rules: merged });
const verified = await request("GET");
const verifiedIds = new Set((verified.rules || []).map(rule => rule.id));
const missing = desired.filter(rule => !verifiedIds.has(rule.id)).map(rule => rule.id);
if (missing.length) throw new Error(`Verifikasi lifecycle gagal; rule hilang: ${missing.join(", ")}`);
console.log(`Lifecycle R2 aktif: ${desired.length} rule AClean terverifikasi.`);
