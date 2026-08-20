#!/usr/bin/env node
// Linter migrasi — jaga folder migrations/ tetap rapi & terstruktur.
// Migrasi di repo ini dijalankan MANUAL di Supabase SQL Editor (tak ada pipeline
// otomatis), jadi mudah terjadi: nomor DOBEL (mis. 122 pernah 2 file → risiko
// salah urut apply) atau GAP (nomor loncat → migrasi hilang/lupa commit).
// Script ini menyorot masalah itu sebelum jadi bug.
//
// Jalankan: node scripts/check-migrations.mjs   (exit 1 bila ada nomor dobel)
//           npm run check:migrations
import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const RESET = "\x1b[0m", RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m";

// Nomor dobel WARISAN (sudah ter-apply di prod, tak bisa di-renumber). Di-baseline
// agar CI tidak selalu merah — TAPI dobel BARU di luar daftar ini tetap gagal.
// JANGAN tambah nomor ke sini untuk "menyembunyikan" dobel baru; perbaiki filenya.
const KNOWN_DUPES = new Set([4, 5, 39, 54, 64, 65, 66, 67, 68, 69, 77, 83, 107, 122]);

// File _-prefix (mis. _rollback_*.sql) = helper, bukan migrasi berurut → diabaikan.
const files = readdirSync(DIR).filter(f => f.endsWith(".sql") && !f.startsWith("_"));
// Kelompokkan file per nomor awal (NNN_...). File tanpa nomor = malformed.
const byNum = new Map();
const malformed = [];
for (const f of files) {
  const m = f.match(/^(\d+)[_-]/);
  if (!m) { malformed.push(f); continue; }
  const n = parseInt(m[1], 10);
  if (!byNum.has(n)) byNum.set(n, []);
  byNum.get(n).push(f);
}

const nums = [...byNum.keys()].sort((a, b) => a - b);
const dupes = nums.filter(n => byNum.get(n).length > 1);
const min = nums[0] ?? 0, max = nums[nums.length - 1] ?? 0;
const gaps = [];
for (let i = min; i <= max; i++) if (!byNum.has(i)) gaps.push(i);

console.log(`\n${DIM}migrations/ — ${files.length} file, rentang ${min}–${max}${RESET}\n`);

if (malformed.length) {
  console.log(`${RED}✖ ${malformed.length} file tanpa nomor awal (NNN_):${RESET}`);
  malformed.forEach(f => console.log(`  ${f}`));
  console.log();
}

const newDupes = dupes.filter(n => !KNOWN_DUPES.has(n));
const oldDupes = dupes.filter(n => KNOWN_DUPES.has(n));

if (newDupes.length) {
  console.log(`${RED}✖ ${newDupes.length} nomor DOBEL BARU (bahaya salah urut apply — perbaiki!):${RESET}`);
  newDupes.forEach(n => console.log(`  ${RED}${String(n).padStart(3, "0")}${RESET} → ${byNum.get(n).join("  ·  ")}`));
  console.log(`  ${DIM}Migrasi baru WAJIB = nomor tertinggi + 1 (${max + 1}). Lihat skill new-migration.${RESET}`);
} else {
  console.log(`${GRN}✓ Tidak ada nomor dobel baru${RESET}`);
}
if (oldDupes.length) {
  console.log(`${DIM}  (${oldDupes.length} dobel warisan di-baseline, sudah ter-apply: ${oldDupes.map(n => String(n).padStart(3, "0")).join(", ")})${RESET}`);
}
console.log();

if (gaps.length) {
  console.log(`${YEL}⚠ ${gaps.length} nomor GAP (mungkin migrasi belum di-commit): ${gaps.map(n => String(n).padStart(3, "0")).join(", ")}${RESET}`);
} else {
  console.log(`${GRN}✓ Tidak ada gap nomor${RESET}`);
}

console.log(`\n${DIM}Nomor migrasi berikutnya: ${GRN}${max + 1}${RESET}\n`);

// Exit non-zero HANYA untuk dobel BARU / malformed (blocker CI). Dobel warisan &
// gap = info/warning (backfill historis wajar meninggalkan gap; bukan error).
process.exit(newDupes.length || malformed.length ? 1 : 0);
