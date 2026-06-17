#!/usr/bin/env node
// P1 — Backfill kategori billing eksplisit (`category`) ke materials_detail invoice lama.
// Menambahkan field `category` (LABOR/FEE/PART/FREON/DISCOUNT) ke tiap baris + memindah
// catatan bebas dari `keterangan` ke `note`. TIDAK mengubah subtotal/total — murni metadata.
//
// Usage:
//   node scripts/backfill-invoice-category.mjs            # DRY-RUN (default, tidak menulis)
//   node scripts/backfill-invoice-category.mjs --apply    # tulis perubahan ke DB
//
// Aman dijalankan berulang (idempotent: baris yg sudah ber-category tidak berubah).

import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import { createClient } from "@supabase/supabase-js";
import { normalizeLines } from "../src/lib/invoicing.js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const sameLines = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  console.log(`\n[backfill-invoice-category] mode: ${APPLY ? "APPLY (menulis)" : "DRY-RUN (tidak menulis)"}\n`);
  let from = 0;
  const PAGE = 1000;
  let scanned = 0, changed = 0, errors = 0;

  for (;;) {
    const { data, error } = await sb
      .from("invoices")
      .select("id,materials_detail")
      .not("materials_detail", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("fetch error:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    for (const inv of data) {
      scanned++;
      let lines = inv.materials_detail;
      if (typeof lines === "string") { try { lines = JSON.parse(lines); } catch { continue; } }
      if (!Array.isArray(lines) || lines.length === 0) continue;

      const normalized = normalizeLines(lines);
      if (sameLines(lines, normalized)) continue; // sudah ber-category, skip

      changed++;
      if (changed <= 10) {
        console.log(`  ~ ${inv.id}: ${lines.length} baris → set category ` +
          normalized.map(l => l.category).join(","));
      }
      if (APPLY) {
        const { error: upErr } = await sb
          .from("invoices")
          .update({ materials_detail: JSON.stringify(normalized) })
          .eq("id", inv.id);
        if (upErr) { errors++; console.error(`  ! gagal update ${inv.id}: ${upErr.message}`); }
      }
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }

  console.log(`\nSelesai. Dipindai: ${scanned} · perlu update: ${changed} · error: ${errors}`);
  if (!APPLY && changed > 0) console.log("Jalankan ulang dengan --apply untuk menyimpan.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
