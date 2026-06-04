#!/usr/bin/env node
// One-off lokal: trigger snapshot WA grup utk tanggal tertentu (default = hari ini WIB).
// Pakai R2 + Supabase credentials dari .env.local. Sama logikanya dengan
// taskWaSnapshot di api/cron-reminder.js — dipakai utk bootstrap 4 Juni.
//
// Usage:
//   node scripts/wa-snapshot-local.mjs                 # snapshot hari ini WIB
//   node scripts/wa-snapshot-local.mjs 2026-06-04      # snapshot tanggal spesifik

import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch (e) { console.warn("env load fail:", e.message); }

import { createClient } from "@supabase/supabase-js";
import { uploadBufferToR2, hasR2Config } from "../api/_r2-upload.js";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const arg = process.argv[2];
const targetDate = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)
  ? arg
  : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

console.log(`📸 Snapshot WA grup utk ${targetDate} (WIB)`);
console.log(`R2 ready: ${hasR2Config() ? "✅" : "❌"}`);
if (!hasR2Config()) { console.error("Missing R2_* env. Abort."); process.exit(1); }

const startWibUtcIso = new Date(Date.parse(targetDate + "T00:00:00+07:00")).toISOString();
const endWibUtcIso   = new Date(Date.parse(targetDate + "T23:59:59.999+07:00")).toISOString();

const { data: groups } = await sb.from("wa_monitored_groups")
  .select("group_id,group_name,enabled,capture_all,ai_expense_enabled,ai_material_enabled,ai_payment_enabled,ai_selesai_enabled,ai_quotation_enabled,ai_kasbon_enabled");
const enabledGroups = (groups || []).filter(g => g.enabled);

const perGroup = [];
let totalMessages = 0, totalWithImage = 0;
for (const g of enabledGroups) {
  const { data: logs } = await sb.from("wa_group_logs")
    .select("id,sender_phone,sender_name,type,content,parsed_ok,amount,job_id,image_url,r2_image_url,metadata,forwarded,created_at")
    .eq("group_id", g.group_id)
    .gte("created_at", startWibUtcIso)
    .lte("created_at", endWibUtcIso)
    .order("created_at", { ascending: true });
  const rows = logs || [];
  const withImg = rows.filter(r => !!r.image_url).length;
  totalMessages += rows.length;
  totalWithImage += withImg;
  console.log(`  • ${g.group_name}: ${rows.length} msg, ${withImg} foto`);
  perGroup.push({
    group_id: g.group_id,
    group_name: g.group_name,
    toggles: {
      capture_all: g.capture_all, ai_expense: g.ai_expense_enabled, ai_material: g.ai_material_enabled,
      ai_payment: g.ai_payment_enabled, ai_selesai: g.ai_selesai_enabled, ai_quotation: g.ai_quotation_enabled,
      ai_kasbon: g.ai_kasbon_enabled,
    },
    stats: { total: rows.length, with_image: withImg, parsed_ok: rows.filter(r => r.parsed_ok).length },
    messages: rows.map(r => ({
      id: r.id,
      wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
      sender_phone: r.sender_phone, sender_name: r.sender_name,
      type: r.type, content: r.content, parsed_ok: r.parsed_ok, amount: r.amount, job_id: r.job_id,
      has_image: !!r.image_url, r2_image_url: r.r2_image_url,
      md5: r.metadata?.img_md5 || null, dup_of_log_id: r.metadata?.dup_of_log_id || null,
      forwarded: r.forwarded,
    })),
  });
}

const { data: aiRows } = await sb.from("ai_extractions")
  .select("id,group_id,sender_phone,sender_name,intent,confidence,status,extracted,notes,model,cost_usd,linked_table,linked_id,created_at")
  .gte("created_at", startWibUtcIso).lte("created_at", endWibUtcIso).order("created_at", { ascending: true });
const aiArr = (aiRows || []).map(r => ({
  id: r.id, group_id: r.group_id, sender_name: r.sender_name,
  intent: r.intent, confidence: r.confidence, status: r.status,
  extracted: r.extracted, notes: r.notes, model: r.model, cost_usd: r.cost_usd,
  linked_table: r.linked_table, linked_id: r.linked_id,
  wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
}));

const { data: expRows } = await sb.from("expenses")
  .select("id,date,subcategory,teknisi_name,amount,description,validation_status,created_by,created_at")
  .eq("date", targetDate).in("created_by", ["wa_group", "wa_group_kasbon", "wa_group_ai"])
  .order("created_at", { ascending: true });
const expArr = (expRows || []).map(r => ({
  id: r.id, subcategory: r.subcategory, teknisi_name: r.teknisi_name, amount: r.amount,
  description: r.description, validation_status: r.validation_status, created_by: r.created_by,
  wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
}));

const { data: paySuggRows } = await sb.from("payment_suggestions")
  .select("id,phone,sender_name,amount,bank,transfer_date,invoice_id,status,source,created_at")
  .gte("created_at", startWibUtcIso).lte("created_at", endWibUtcIso).order("created_at", { ascending: true });
const paySuggArr = (paySuggRows || []).map(r => ({
  id: r.id, sender_name: r.sender_name, amount: r.amount, bank: r.bank,
  invoice_id: r.invoice_id, status: r.status, source: r.source,
  wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
}));

const snapshot = {
  snapshot_date: targetDate,
  generated_at_utc: new Date().toISOString(),
  generated_at_wib: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19) + "+07:00",
  summary: {
    groups: enabledGroups.length,
    total_messages: totalMessages,
    total_with_image: totalWithImage,
    total_ai_classified: aiArr.length,
    total_expenses_inserted: expArr.length,
    total_payment_suggestions: paySuggArr.length,
  },
  groups: perGroup,
  ai_extractions: aiArr,
  expenses_from_wa: expArr,
  payment_suggestions: paySuggArr,
};

const json = JSON.stringify(snapshot, null, 2);
const buf = Buffer.from(json, "utf8");
console.log(`📄 JSON size: ${(buf.length / 1024).toFixed(1)} KB`);

const r2Key = `wa-snapshots/${targetDate}.json`;
const up = await uploadBufferToR2({ buffer: buf, key: r2Key, mimeType: "application/json" });
if (!up.ok) { console.error("R2 upload fail:", up.err); process.exit(1); }
console.log(`☁️  R2 uploaded: ${up.url}`);

const { error: upErr } = await sb.from("wa_daily_snapshots").upsert({
  snapshot_date: targetDate,
  r2_key: r2Key, r2_url: up.url,
  groups_count: enabledGroups.length,
  total_messages: totalMessages, total_with_image: totalWithImage,
  total_ai_classified: aiArr.length, total_expenses_inserted: expArr.length,
  size_bytes: buf.length, notes: "Local bootstrap script",
}, { onConflict: "snapshot_date" });
if (upErr) console.warn("manifest upsert err:", upErr.message);
else console.log(`✅ Manifest saved`);

console.log("\n📊 Summary:", JSON.stringify(snapshot.summary, null, 2));
