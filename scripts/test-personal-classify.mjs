#!/usr/bin/env node
// Test personal flow classify (exact same prompt as inline call in api/[route].js line 1374)
import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const url = process.argv[2];
if (!url) { console.error("Usage: test-personal-classify.mjs <url>"); process.exit(1); }
const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;

// Download image
const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
console.log("DL status:", r.status, "size will check after");
if (!r.ok) { console.error("Failed download"); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
console.log("Buffer size:", buf.length, "bytes");
const base64Img = buf.toString("base64");
const mimeType = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();

const t0 = Date.now();
const classifyRes = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 250,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mimeType, data: base64Img } },
      { type: "text", text: 'Klasifikasikan gambar ini. Pilih SATU kategori: "bukti_transfer" (struk transfer/screenshot m-banking), "kerusakan_ac" (foto AC rusak/error/bocor/kotor), "dokumen" (dokumen/teks lain yang relevan), atau "tidak_relevan" (foto tidak terkait AC/pembayaran). Jika bukti_transfer, ekstrak: amount (angka), bank (nama bank), transfer_date (YYYY-MM-DD). Format JSON SAJA:\n{"category":"bukti_transfer","amount":150000,"bank":"BCA","transfer_date":"2026-04-22"}\natau\n{"category":"kerusakan_ac"}\natau\n{"category":"tidak_relevan"}' }
    ]}]
  })
});
const ms = Date.now() - t0;
console.log(`\nAnthropic ${classifyRes.status} (${ms}ms)`);
const data = await classifyRes.json();
const txt = (data.content||[]).map(c=>c.text||"").join("").trim();
console.log("Raw text:", txt);
const m = txt.match(/\{[\s\S]*\}/);
if (m) {
  const parsed = JSON.parse(m[0]);
  console.log("Parsed:", parsed);
}
