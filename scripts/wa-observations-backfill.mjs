#!/usr/bin/env node
// Backfill wa_ai_observations dari wa_group_logs (gap 1/2/3 parser).
// Tujuan: setup data review utk Owner SEBELUM cron baru jalan.
// Idempotent: dedup via (source, source_log_id) — pakai message_text+observed_date sebagai pseudo-key.
//
// Usage:
//   node scripts/wa-observations-backfill.mjs                # hari ini
//   node scripts/wa-observations-backfill.mjs 2026-06-04
//   node scripts/wa-observations-backfill.mjs 2026-06-04 2026-06-11

import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import { createClient } from "@supabase/supabase-js";
import { parseCarrierFromCaption, matchCarrierName, parseLaporanTeam, matchLaporanToOrder, parseBiayaExtended } from "../api/_shadow-parsers.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SU = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;

const fromDate = process.argv[2] || new Date(Date.now() + 7*3600_000).toISOString().slice(0,10);
const toDate = process.argv[3] || fromDate;
console.log(`👁️  Backfill observations ${fromDate} → ${toDate}`);

const startIso = new Date(Date.parse(fromDate + "T00:00:00+07:00")).toISOString();
const endIso = new Date(Date.parse(toDate + "T23:59:59.999+07:00")).toISOString();

const { data: logs } = await sb.from("wa_group_logs")
  .select("id,sender_phone,sender_name,group_id,group_name,content,image_url,created_at")
  .gte("created_at", startIso).lte("created_at", endIso)
  .order("created_at", { ascending: true }).limit(2000);

const counters = { logs_scanned: logs.length, gap1: 0, gap2: 0, gap3: 0, skipped_dup: 0 };

// Dedup: cek apakah observation utk source_log_id+source sudah ada
const existsObs = async ({ source, source_log_id }) => {
  const url = SU + "/rest/v1/wa_ai_observations?select=id&source=eq." + source + "&source_log_id=eq." + source_log_id + "&limit=1";
  const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
  if (!r.ok) return false;
  const rows = await r.json();
  return rows.length > 0;
};

const inserts = [];

for (const lg of logs) {
  const grupNameLower = String(lg.group_name || "").toLowerCase();
  const profileName = lg.sender_name || lg.sender_phone;
  const text = lg.content || "";

  // GAP 1
  if (grupNameLower.includes("aclean grup") && lg.image_url && text && text !== "(foto)") {
    const c = parseCarrierFromCaption(text);
    if (c) {
      if (!(await existsObs({ source: "gap1_carrier", source_log_id: lg.id }))) {
        const m = await matchCarrierName({ SU, SK, mainToken: c.carrier_main_token });
        inserts.push({
          source: "gap1_carrier", group_id: lg.group_id, group_name: lg.group_name, source_log_id: lg.id,
          sender_phone: lg.sender_phone, sender_name: lg.sender_name, message_text: text.slice(0, 1000),
          parsed_data: { caption: text, ...c },
          proposed_action: "link_material_to_carrier_job",
          proposed_target: m.matched ? { user_id: m.matched.id, name: m.matched.name, role: m.matched.role } : null,
          match_confidence: m.matched ? "HIGH" : "LOW",
          match_candidates: m.candidates,
          notes: m.matched ? `Carrier "${c.carrier_main_token}" → ${m.matched.name} (${m.matched.role})` : `Carrier "${c.carrier_main_token}" tidak unique`,
        });
        counters.gap1++;
      } else counters.skipped_dup++;
    }
  }

  // GAP 2
  if (grupNameLower.includes("report pekerjaan")) {
    const lap = parseLaporanTeam(text);
    if (lap) {
      if (!(await existsObs({ source: "gap2_laporan_team", source_log_id: lg.id }))) {
        const m = await matchLaporanToOrder({ SU, SK, parsed: lap });
        inserts.push({
          source: "gap2_laporan_team", group_id: lg.group_id, group_name: lg.group_name, source_log_id: lg.id,
          sender_phone: lg.sender_phone, sender_name: lg.sender_name, message_text: text.slice(0, 1000),
          parsed_data: lap,
          proposed_action: "mark_order_completed",
          proposed_target: m.matched.length === 1 ? { order_id: m.matched[0].id, customer: m.matched[0].customer, status: m.matched[0].status } : null,
          match_confidence: m.reason === "unique" ? lap.confidence : "LOW",
          match_candidates: m.matched,
          notes: m.reason === "unique" ? `Match #${m.matched[0].id} (${m.matched[0].status})` : m.reason === "multi" ? `Multi (${m.matched.length}) ambiguous` : `No order match`,
        });
        counters.gap2++;
      } else counters.skipped_dup++;
    }
  }

  // GAP 3
  if (grupNameLower.includes("aclean grup") && !lg.image_url) {
    const bx = parseBiayaExtended(text);
    if (bx) {
      if (!(await existsObs({ source: "gap3_bon_ext", source_log_id: lg.id }))) {
        inserts.push({
          source: "gap3_bon_ext", group_id: lg.group_id, group_name: lg.group_name, source_log_id: lg.id,
          sender_phone: lg.sender_phone, sender_name: lg.sender_name, message_text: text.slice(0, 1000),
          parsed_data: { text, ...bx },
          proposed_action: "create_expense_pending_ai",
          proposed_target: { subcategory: bx.subcategory, amount: bx.amount, teknisi_name: profileName },
          match_confidence: "MEDIUM",
          notes: `"${bx.keyword}" → ${bx.subcategory} Rp ${bx.amount.toLocaleString("id-ID")}`,
        });
        counters.gap3++;
      } else counters.skipped_dup++;
    }
  }
}

if (inserts.length > 0) {
  const { error } = await sb.from("wa_ai_observations").insert(inserts);
  if (error) console.error("INSERT err:", error.message);
}

console.log("✅ Done:", JSON.stringify(counters, null, 2));
