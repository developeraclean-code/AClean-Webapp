-- Migration 124: Kolom status kirim report card di service_reports
-- Fitur "Kirim Card" di kalender Jadwal (commit fb25535) menulis dua kolom ini
-- via supabase.update(), tapi commit tsb tidak menyertakan migration sehingga
-- kolomnya tidak pernah dibuat. Akibatnya UPDATE gagal diam-diam (error tidak
-- dicek) dan status "terkirim" tidak pernah persist → badge/border tidak hijau
-- setelah reload. Kolom ditambah IF NOT EXISTS agar aman kalau sudah dibuat manual.

ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS report_card_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_card_sent_by text;

-- RLS: policy UPDATE existing (reports_update, migrasi 095) sudah mengizinkan
-- semua role authenticated, jadi tidak perlu policy baru untuk kolom ini.
