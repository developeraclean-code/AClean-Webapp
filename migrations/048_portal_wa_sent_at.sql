-- Migration 048: tambah kolom portal_wa_sent_at di tabel orders
-- Dipakai untuk tracking apakah WA dispatch + portal link sudah dikirim ke customer,
-- agar cron morning-dispatch tidak kirim dobel ke order yang sudah di-dispatch dari Order Masuk.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS portal_wa_sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN orders.portal_wa_sent_at IS
  'Timestamp saat WA dispatch + portal link dikirim ke customer. NULL = belum dikirim.';
