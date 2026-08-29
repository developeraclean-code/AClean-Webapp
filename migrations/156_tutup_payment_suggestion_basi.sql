-- Migration 156: tutup antrean payment_suggestions yang basi (DISMISSED, BUKAN dihapus)
--
-- MASALAH (audit 29 Agu 2026): 341 baris berstatus PENDING, tertua 22 April 2026.
-- Dua sebab, keduanya sudah diperbaiki di kode pada commit yang sama:
--   1. retroMatchPayment() mengisi invoice_id/matched_at tapi TIDAK PERNAH men-set `status`
--      → baris yang sudah berhasil dicocokkan tetap PENDING selamanya (retroMatch.js).
--   2. Cron pembersih menghapus status 'RESOLVED'/'REJECTED' — dua nilai yang TIDAK PERNAH
--      ADA di tabel ini (nilai nyata: CONFIRMED / PENDING / DISMISSED), jadi sejak lahir
--      cron itu menghapus 0 baris sambil melapor sukses (_tasks/cleanup.js).
-- Akibatnya antrean tinjauan jadi 96% sampah dan bukti bayar baru tenggelam di dalamnya.
--
-- KENAPA DISMISSED, BUKAN DELETE:
-- baris payment_suggestions bisa jadi satu-satunya jejak bahwa seorang customer pernah
-- mengirim bukti transfer. Menghapusnya = memusnahkan barang bukti. DISMISSED tetap bisa
-- ditelusuri, bisa dikembalikan ke PENDING, dan akan ikut terhapus sendiri oleh cron
-- setelah 30 hari kalau memang tidak dibutuhkan.
--
-- KENAPA AMAN — sudah diuji sebelum ditulis (cross-check 337 baris PENDING bernominal
-- terhadap SELURUH invoice per nomor HP):
--   0   baris cocok dengan invoice yang MASIH BELUM LUNAS  ← tidak ada uang yang terkubur
--   188 baris nominalnya cocok dgn invoice yang SUDAH PAID ← memang sisa catatan
--   74  baris: semua invoice nomor itu sudah lunas
--   73  baris: tidak ada invoice sama sekali dari nomor itu
--   2   baris perlu mata manusia — DIKECUALIKAN dari migrasi ini (lihat di bawah)
--
-- Ambang 90 hari dipilih karena retroMatchPayment() hanya menoleh 30 hari ke belakang saat
-- mencari bukti untuk invoice yang baru lunas (src/lib/retroMatch.js). Apa pun yang lebih
-- tua dari 90 hari sudah pasti tidak dipakai mesin mana pun.
--
-- TIDAK menyentuh angka keuangan: payment_suggestions tidak pernah dibaca oleh FinanceView,
-- ReportsView, maupun DashboardView — semua nilai uang berasal dari invoices.status /
-- paid_amount / paid_at. Jumlah invoice UNPAID sebelum & sesudah migrasi ini SAMA.
--
-- Idempotent: hanya menyentuh baris yang masih PENDING & lebih tua dari 90 hari.

BEGIN;

UPDATE payment_suggestions s
SET status      = 'DISMISSED',
    resolved_at = now(),
    resolved_by = 'migrasi-156 (pembersihan antrean basi)'
WHERE s.status = 'PENDING'
  AND s.created_at < now() - interval '90 days'
  -- Pengecualian: nomor HP ini masih punya invoice BELUM lunas. Nominalnya tidak cocok
  -- (jadi bukan pembayaran invoice itu), tapi selama masih ada tagihan terbuka, buktinya
  -- ditinggal di antrean supaya Owner yang memutuskan.
  AND NOT EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.phone = s.phone
      AND i.status IN ('UNPAID', 'OVERDUE', 'PARTIAL_PAID')
  );

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT status, count(*) FROM payment_suggestions GROUP BY 1;
--   PENDING harus turun drastis (±341 → ±66), CONFIRMED tetap, DISMISSED naik.
-- SELECT count(*) FROM invoices WHERE status IN ('UNPAID','OVERDUE');
--   HARUS SAMA PERSIS dengan sebelum migrasi (27) — migrasi ini tidak menyentuh invoice.

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE payment_suggestions SET status='PENDING', resolved_at=NULL, resolved_by=NULL
--  WHERE resolved_by = 'migrasi-156 (pembersihan antrean basi)';
