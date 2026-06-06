#!/usr/bin/env node
// Quick test: classifyImage with a known-good public test image
// to verify the helper itself works, then we know issue is elsewhere.

import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import { classifyImage } from "../api/_ai-vision.js";

// Pakai foto random dari Fonnte yang baru aja (mungkin masih hidup ~5 menit lalu)
const TEST_URL = process.argv[2] || "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800";

console.log("Test URL:", TEST_URL);
console.log("Has LLM_API_KEY:", !!process.env.LLM_API_KEY, "len:", (process.env.LLM_API_KEY || "").length);
console.log("Has ANTHROPIC_API_KEY:", !!process.env.ANTHROPIC_API_KEY, "len:", (process.env.ANTHROPIC_API_KEY || "").length);

const t0 = Date.now();
const result = await classifyImage({
  imageUrl: TEST_URL,
  groupCfg: {
    group_id: "test-group",
    ai_expense_enabled: true,
    ai_material_enabled: true,
    ai_payment_enabled: true,
  },
  sender: { phone: "62812000000", name: "Test User" },
  messageText: "Struk bensin",
});
const ms = Date.now() - t0;
console.log(`\n⏱  ${ms}ms`);
console.log(JSON.stringify(result, null, 2));
