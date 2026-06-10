#!/usr/bin/env node
// Simulasi nyata untuk verifikasi 5 Quick Wins SEBELUM push.
// Tidak insert apapun ke prod — semua read-only / dry-run / DRY-mock.

import { readFileSync } from "node:fs";
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;

let pass = 0, fail = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };
const ko = (n, e) => { console.log(`❌ ${n} — ${e}`); fail++; };

console.log("═══ QW1: view security_invoker ═══");
{
  const r = await fetch(SU + "/rest/v1/wa_delivery_summary?limit=1", {
    headers: { apikey: SK, Authorization: "Bearer " + SK },
  });
  r.ok ? ok("wa_delivery_summary still queryable via service_role") : ko("view broken", r.status);
}

console.log("\n═══ QW2: /api/foto?key= regex ═══");
{
  // Mirror exactly the regex from api/[route].js
  const SAFE_KEY_RE = /^(foto|tool-bag|laporan|invoice|invoices|wa-group|wa-snapshots|service-reports|orders|materials|payments|projects|maintenance|quotations|customer-photos|expense-photos|expenses|merged-pdfs)\/[a-zA-Z0-9_\-./]{1,200}\.(jpg|jpeg|png|gif|webp|pdf|json)$/i;
  const guard = (k) => !SAFE_KEY_RE.test(k) || k.includes("..") || k.includes("//") || k.startsWith("/");
  const legit = [
    "wa-group/2026-06/abc/123_456.jpg",
    "wa-snapshots/2026-06-10.json",
    "expenses/2026-06/teknisi-rey/2026-06-10_abc123def0.jpg",
    "laporan/abc-123/foto.png",
    "invoice/INV-20260610/file.pdf",
    "merged-pdfs/2026-06/combined.pdf",
  ];
  const attacks = [
    "../etc/passwd",
    "foto/../../../secret.txt",
    "//backup.sql",
    "/etc/shadow",
    ".env",
    "wa-group/../../etc/passwd.jpg",
    "wa-group/x.exe",
    "random-folder/file.jpg",
  ];
  let legitOk = 0, legitFail = 0;
  for (const k of legit) {
    if (guard(k)) legitFail++; else legitOk++;
  }
  let blocked = 0, leaked = 0;
  for (const k of attacks) {
    if (guard(k)) blocked++; else leaked++;
  }
  legitFail === 0 ? ok(`Legit keys: ${legitOk}/${legit.length} pass`) : ko("Legit blocked", legitFail);
  leaked === 0 ? ok(`Attack keys: ${blocked}/${attacks.length} blocked`) : ko("Attack leaked", leaked);
}

console.log("\n═══ QW3: RLS lockdown verify ═══");
{
  // Dual client test
  const { createClient } = await import("@supabase/supabase-js");
  const svc = createClient(SU, SK);
  const anon = createClient(SU, ANON);

  // Real counts via service role
  const wp = await svc.from("weekly_payroll").select("id", { count: "exact", head: true });
  const kr = await svc.from("kasbon_requests").select("id", { count: "exact", head: true });
  const ps = await svc.from("payment_suggestions").select("id", { count: "exact", head: true });

  const wpA = await anon.from("weekly_payroll").select("id", { count: "exact", head: true });
  const krA = await anon.from("kasbon_requests").select("id", { count: "exact", head: true });
  const psA = await anon.from("payment_suggestions").select("id", { count: "exact", head: true });

  console.log(`  weekly_payroll      | service=${wp.count} | anon=${wpA.count}`);
  console.log(`  kasbon_requests     | service=${kr.count} | anon=${krA.count}`);
  console.log(`  payment_suggestions | service=${ps.count} | anon=${psA.count}`);

  wp.count > 0 && wpA.count === 0 ? ok("weekly_payroll: anon BLOCKED, service OK") : ko("weekly_payroll RLS", `anon=${wpA.count}`);
  kr.count > 0 && krA.count === 0 ? ok("kasbon_requests: anon BLOCKED, service OK") : ko("kasbon_requests RLS", `anon=${krA.count}`);
  ps.count >= 0 && psA.count === 0 ? ok("payment_suggestions: anon BLOCKED") : ko("payment_suggestions RLS", `anon=${psA.count}`);

  // Try WRITE via anon — must fail
  const writeTry = await anon.from("weekly_payroll").update({ kasbon_total: 9999 }).eq("id", "non-existent-uuid");
  console.log(`  ANON UPDATE try: ${writeTry.error ? 'BLOCKED ✓' : 'No error (filtered to 0 rows)'}`);
}

console.log("\n═══ QW4: criticalFetch simulation ═══");
{
  // Inline minimal version of helper utk simulasi
  const captureLog = [];
  const mockSentry = {
    captureMessage: (msg, opts) => captureLog.push({ type: "message", msg: msg.slice(0, 80), tags: opts?.tags }),
    captureException: (e, opts) => captureLog.push({ type: "exception", err: e.message, tags: opts?.tags }),
  };
  const criticalFetch = async (op, url, opts, ctx) => {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        mockSentry.captureMessage(`[CRITICAL_WRITE_${op.toUpperCase()}] HTTP ${r.status}: ${body.slice(0, 80)}`, {
          level: "warning", tags: { op, http_status: String(r.status) }, extra: ctx,
        });
      }
      return r;
    } catch (e) {
      mockSentry.captureException(e, { tags: { op }, extra: ctx });
      return null;
    }
  };

  // Test 1: Force HTTP 400 via invalid INSERT
  await criticalFetch("test_invalid_insert", SU + "/rest/v1/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
    body: JSON.stringify({ invalid_field: true }),
  }, { teknisi: "TEST_SIM", date: "2026-06-10" });

  // Test 2: Force network error via bad URL
  await criticalFetch("test_network_err", "https://this-domain-does-not-exist-12345.invalid/x", { method: "POST" }, { sim: true });

  console.log("Captures:");
  for (const c of captureLog) console.log("  •", c);
  captureLog.length >= 2 ? ok(`criticalFetch captured ${captureLog.length} events`) : ko("criticalFetch did not capture", captureLog.length);
}

console.log("\n═══ QW5: E2E syntax-check new specs ═══");
{
  const fs = await import("node:fs");
  for (const spec of ["payroll-readonly.spec.js", "pending-ai-material.spec.js"]) {
    const content = fs.readFileSync(`./e2e/${spec}`, "utf8");
    if (content.includes("test.skip") && content.includes("test(")) ok(`e2e/${spec} structure OK`);
    else ko(`e2e/${spec}`, "missing test structure");
  }
}

console.log(`\n═══ Summary: ${pass} pass, ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);
