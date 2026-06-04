#!/usr/bin/env node
// Lokal trigger taskWaBackfill (re-parse wa_group_logs → expenses PENDING_AI).
// Usage:
//   node scripts/wa-backfill-local.mjs                 # hari ini
//   node scripts/wa-backfill-local.mjs 2026-06-04      # tanggal spesifik
//   node scripts/wa-backfill-local.mjs 2026-06-04 2026-06-11  # range

import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import { createClient } from "@supabase/supabase-js";
import { parseKasbonText, matchKasbonName, isKasbonApprovalMessage } from "../api/_kasbon-parser.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SU = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;

const fromDate = process.argv[2] || new Date(Date.now() + 7*3600_000).toISOString().slice(0,10);
const toDate = process.argv[3] || fromDate;

const startIso = new Date(Date.parse(fromDate + "T00:00:00+07:00")).toISOString();
const endIso = new Date(Date.parse(toDate + "T23:59:59.999+07:00")).toISOString();

console.log(`🔁 Backfill ${fromDate} → ${toDate}`);

const expenseAlreadyExists = async ({ date, teknisi_name, amount, created_by }) => {
  const url = SU + "/rest/v1/expenses?select=id"
    + "&date=eq." + date
    + "&teknisi_name=eq." + encodeURIComponent(teknisi_name || "")
    + "&amount=eq." + amount
    + "&created_by=eq." + created_by + "&limit=1";
  const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
  if (!r.ok) return false;
  const rows = await r.json();
  return rows.length > 0;
};

const { data: groupsCfg } = await sb.from("wa_monitored_groups")
  .select("group_id,group_name,ai_kasbon_enabled,ai_expense_enabled");
const cfgMap = Object.fromEntries((groupsCfg || []).map(g => [g.group_id, g]));

const { data: logs } = await sb.from("wa_group_logs")
  .select("id,sender_phone,sender_name,group_id,group_name,content,parsed_ok,created_at")
  .gte("created_at", startIso).lte("created_at", endIso)
  .order("created_at", { ascending: true }).limit(2000);

const c = { logs_scanned: logs.length, kasbon_single: 0, kasbon_multi: 0, biaya: 0, acked: 0, dup: 0, no_match: 0 };

for (const lg of logs) {
  const cfg = cfgMap[lg.group_id];
  if (!cfg) continue;
  const date = new Date(new Date(lg.created_at).getTime() + 7*3600_000).toISOString().slice(0,10);
  const profileName = lg.sender_name || lg.sender_phone;
  const text = lg.content || "";

  if (cfg.ai_kasbon_enabled) {
    const k = parseKasbonText(text);
    if (k) {
      if (k.multi) {
        for (const it of k.items) {
          const mr = await matchKasbonName({ SU, SK, nameRaw: it.nameRaw });
          if (!mr.matched) { c.no_match++; continue; }
          const dup = await expenseAlreadyExists({ date, teknisi_name: mr.matched.name, amount: it.amount, created_by: "wa_group_kasbon" });
          if (dup) { c.dup++; continue; }
          await fetch(SU + "/rest/v1/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({
              date, category: "petty_cash", subcategory: "Kasbon Karyawan",
              teknisi_name: mr.matched.name, amount: it.amount,
              description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName}) [BACKFILL]`,
              created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
            }),
          });
          c.kasbon_multi++;
        }
      } else if (k.nameRaw) {
        const mr = await matchKasbonName({ SU, SK, nameRaw: k.nameRaw });
        if (!mr.matched) { c.no_match++; continue; }
        const dup = await expenseAlreadyExists({ date, teknisi_name: mr.matched.name, amount: k.amount, created_by: "wa_group_kasbon" });
        if (dup) { c.dup++; continue; }
        await fetch(SU + "/rest/v1/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
          body: JSON.stringify({
            date, category: "petty_cash", subcategory: "Kasbon Karyawan",
            teknisi_name: mr.matched.name, amount: k.amount,
            description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName}) [BACKFILL]`,
            created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
          }),
        });
        c.kasbon_single++;
      }
    }
  }
  if (cfg.ai_kasbon_enabled && isKasbonApprovalMessage(text) && ["6281398989837","6281289898937"].includes(lg.sender_phone)) {
    const qUrl = SU + "/rest/v1/expenses?select=id,description"
      + "&validation_status=eq.PENDING_AI&subcategory=eq." + encodeURIComponent("Kasbon Karyawan")
      + "&date=eq." + date + "&created_by=eq.wa_group_kasbon"
      + "&description=not.ilike." + encodeURIComponent("%[ACK by%");
    const qRes = await fetch(qUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    const pendings = qRes.ok ? await qRes.json() : [];
    if (pendings.length > 0) {
      const hh = new Date(new Date(lg.created_at).getTime() + 7*3600_000).toISOString().slice(11,16);
      const ackTag = ` [ACK by ${lg.sender_phone} at ${hh}]`;
      await Promise.all(pendings.map(p =>
        fetch(SU + "/rest/v1/expenses?id=eq." + p.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
          body: JSON.stringify({ description: (p.description || "") + ackTag }),
        })
      ));
      c.acked += pendings.length;
    }
  }
  if (cfg.ai_expense_enabled) {
    const bm = text.match(/^(bensin|makan|parkir|tol|belanja|beli|transport|bbm|solar|pertamax|consumable)[\s:]+(.+)/i);
    if (bm) {
      let nominalStr = bm[2].replace(/(\d+)\s*(jt|juta)/gi, (_, n) => String(parseInt(n)*1000000)).replace(/(\d+)\s*(rb|ribu|k)/gi, (_, n) => String(parseInt(n)*1000));
      const nm = nominalStr.match(/[\d]{4,}/);
      if (nm) {
        const amt = parseInt(nm[0]);
        const kk = bm[1].toLowerCase();
        const subcat = ["bensin","bbm","pertamax","solar"].includes(kk) ? "Bensin Motor" : kk==="parkir" ? "Parkir" : "Lain-lain";
        const dup = await expenseAlreadyExists({ date, teknisi_name: profileName, amount: amt, created_by: "wa_group" });
        if (!dup) {
          await fetch(SU + "/rest/v1/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({
              date, category: "petty_cash", subcategory: subcat,
              description: text + " (via WA grup) [BACKFILL]",
              amount: amt, teknisi_name: profileName,
              created_by: "wa_group", validation_status: "PENDING_AI",
            }),
          });
          c.biaya++;
        } else c.dup++;
      }
    }
  }
}

console.log("✅ Done:", JSON.stringify(c, null, 2));
