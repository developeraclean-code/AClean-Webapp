-- Phase 2 — Kasbon phrase parser di grup Finance
-- Tambah toggle ai_kasbon_enabled di wa_monitored_groups
-- Default false; aktifkan untuk FINANCE AClean.
-- Sekaligus tambah index untuk dedup foto via md5 hash.

ALTER TABLE wa_monitored_groups
  ADD COLUMN IF NOT EXISTS ai_kasbon_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE wa_monitored_groups
  SET ai_kasbon_enabled = TRUE
  WHERE group_name ILIKE '%finance%';

-- Index untuk dedup query foto (sender + md5 dalam ±1 jam)
-- Pakai expression index pada metadata->>'img_md5' karena column metadata jsonb.
CREATE INDEX IF NOT EXISTS idx_wa_group_logs_md5_sender
  ON wa_group_logs(sender_phone, ((metadata->>'img_md5')), created_at DESC)
  WHERE metadata->>'img_md5' IS NOT NULL;
