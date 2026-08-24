-- Migration 144: draft pemakaian material dari AI (foto + teks grup) → sesi 'pakai'
--
-- Why: teknisi/helper jarang input Material Harian di app, tapi rajin (a) foto material
-- dibawa di grup AClean, (b) lapor pemakaian per-customer di grup report. Solusi: AI Vision
-- baca foto (material dibawa) + AI text baca laporan (qty terpakai per job) → susun DRAFT
-- pemakaian yang muncul di tab "Konfirmasi Material". Owner/Admin koreksi + confirm → potong stok.
-- AI TIDAK pernah memotong sendiri; draft selalu lewat konfirmasi manual (confirm_status PENDING).
--
-- Perubahan:
--   1. session_type izinkan nilai baru 'pakai' (draft pemakaian harian; beda dari pagi/pulang).
--   2. draft_source  = asal draft ('wa_photo' | 'wa_text' | 'merged' | 'manual') untuk audit.
--   3. needs_unit_pick = true bila AI belum yakin unit (tabung/roll) mana → owner wajib pilih
--      unit di UI sebelum deduct (jaga presisi inventory_units.stock).
-- Tidak mengubah tier akses RLS mana pun — baris 'pakai' ikut policy tabel yang sudah ada.

-- 1) session_type: tambah 'pakai'
ALTER TABLE teknisi_material_checkout
  DROP CONSTRAINT IF EXISTS teknisi_material_checkout_session_type_check;
ALTER TABLE teknisi_material_checkout
  ADD CONSTRAINT teknisi_material_checkout_session_type_check
  CHECK (session_type = ANY (ARRAY['pagi'::text, 'pulang'::text, 'pakai'::text]));

-- 2) provenance & unit-pick flag
ALTER TABLE teknisi_material_checkout
  ADD COLUMN IF NOT EXISTS draft_source text;
ALTER TABLE teknisi_material_checkout
  ADD COLUMN IF NOT EXISTS needs_unit_pick boolean DEFAULT false;

-- 3) index bantu query tab Konfirmasi (sesi + status + tanggal)
CREATE INDEX IF NOT EXISTS idx_tmc_session_confirm_date
  ON teknisi_material_checkout (session_type, confirm_status, checkout_date);

-- Catatan bentuk items untuk sesi 'pakai' (draft pemakaian):
--   items = [
--     { "material_type":"pipa", "inventory_code":"PIPA-1/4", "label":"Pipa 1/4",
--       "qty": 4, "unit":"m", "unit_id":"<inventory_units.id | null>",
--       "confidence":"high|medium|low",
--       "per_job":[ { "job_id":"<orders.id>", "customer":"Bu Yuli AS-12", "qty":4 } ] }
--   ]
--   job_ids     = daftar orders.id yang terpakai (untuk selector cepat nama customer)
--   ai_detected = hasil mentah parse teks/vision (audit)
