-- Migration 094: Atomic dedup guard untuk expenses (biaya) dari jalur otomatis.
--
-- Masalah: dedup lintas-channel di api/_expense-dedup.js (expenseDuplicateExists)
-- adalah SELECT-then-INSERT — tidak atomic. Dua submission yang hampir bersamaan
-- (double-tap teknisi, retry client, WA grup + dashboard nyaris bersamaan) bisa
-- lolos pengecekan keduanya sebelum salah satu INSERT selesai → 2 baris expenses
-- untuk biaya yang sama.
--
-- Solusi: kolom dedup_key (nullable) diisi HANYA oleh jalur otomatis
-- (expense-submit.js, _ai-vision.js, [route].js biaya/kasbon WA grup), dengan
-- format: lower(trim(teknisi_name)) + "|" + date + "|" + amount + "|" + lower(trim(subcategory)).
-- Input manual via ExpensesView (insertExpense) TIDAK pernah mengisi kolom ini →
-- selalu NULL → tidak pernah bentrok di unique index (NULL tidak dianggap sama
-- dengan NULL di unique index Postgres). Jadi input manual Owner/Admin sama
-- sekali tidak terdampak.
--
-- Pengecekan SELECT (expenseDuplicateExists) tetap dipertahankan di kode sebagai
-- fast-path (hindari biaya AI vision/upload R2 kalau sudah jelas duplikat).
-- Unique index ini adalah garis pertahanan terakhir yang benar-benar atomic untuk
-- menutup race condition-nya.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_dedup_key
  ON expenses (dedup_key)
  WHERE dedup_key IS NOT NULL;
