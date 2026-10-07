// Explicit --live calls the AI provider with synthetic conversations only.
// No Supabase writes or WhatsApp delivery; production training is not modified.
import fs from "node:fs";
import assert from "node:assert/strict";
import { customerCases, createAraMemoryDb, prices, training } from "./lib/ara-fixtures.mjs";
import { generateCustomerReply, processAraCustomer } from "../api/_ara-customer.js";
import { assessCustomerReply, buildAraSystem } from "../src/lib/araPolicy.js";

const live = process.argv.includes("--live");
const provider = process.argv.find(v => v.startsWith("--provider="))?.split("=")[1] || "claude";
const from = Number(process.argv.find(v => v.startsWith("--from="))?.split("=")[1] || 0);
if (!["claude", "openai"].includes(provider)) throw new Error("Provider tidak didukung");
if (live) {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*(ANTHROPIC_API_KEY|LLM_API_KEY|OPENAI_API_KEY)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
let calls = 0, failures = 0, guarded = 0, sent = 0;
if (live) {
  for (const [intent, message] of customerCases.slice(from)) {
    try {
      const reply = await generateCustomerReply({ provider, system: buildAraSystem({ training, prices, message }), history: [{ role: "user", content: message }], recordUsage: () => {} });
      calls++;
      const check = assessCustomerReply(reply, prices, message);
      if (!check.ok) guarded++;
      console.log(JSON.stringify({ intent, message, reply, reviewReasons: check.reasons }));
    } catch (error) {
      failures++;
      console.log(JSON.stringify({ provider, error: error.message }));
      // A configuration/quota outage cannot be improved by repeated paid calls.
      break;
    }
  }
} else {
  const db = createAraMemoryDb({ mode: "auto_safe" });
  for (let i = 0; i < 200; i++) {
    const [intent, message] = customerCases[i % customerCases.length];
    const result = await processAraCustomer({ db, phone: "628000000001", message, sourceKey: `simulation-${i}`, chatbotOn: true, autoOn: false,
      generate: async () => { calls++; return "Boleh informasikan detail AC dan lokasi? Admin akan memeriksa kebutuhan Anda."; },
      deliver: async () => { sent++; return { status: "ACCEPTED" }; },
    });
    assert.equal(result.replied, ["greeting", "thanks"].includes(intent));
  }
  assert.equal(db.reviews.size, 200);
  assert.equal(sent, 20);
}
console.log(JSON.stringify({ mode: live ? "live-model-synthetic-input" : "200-local-workflows", provider: live ? provider : "mock", calls, failures, guarded, whatsappSent: 0, simulatedDeliveries: sent }));
if (failures) process.exitCode = 1;
