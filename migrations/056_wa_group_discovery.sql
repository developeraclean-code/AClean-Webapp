-- Migration 056: Auto-discovery untuk grup WA yang belum whitelisted
-- Saat webhook terima pesan dari grup, kalau group_id BELUM ada di wa_monitored_groups,
-- tetap log metadata-nya (sender + sample message) di sini supaya Owner bisa lihat &
-- whitelist via 1-klik tanpa harus tanya group_id dari Fonnte.

CREATE TABLE IF NOT EXISTS wa_group_discovery (
  group_id text PRIMARY KEY,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  message_count int DEFAULT 0,
  sample_sender_name text,
  sample_sender_phone text,
  sample_message text,
  whitelisted boolean DEFAULT false,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_wgd_last_seen ON wa_group_discovery(last_seen DESC) WHERE whitelisted = false;
ALTER TABLE wa_group_discovery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wgd_anon_all" ON wa_group_discovery;
CREATE POLICY "wgd_anon_all" ON wa_group_discovery TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE wa_group_discovery IS 'Auto-discovery grup yang belum whitelisted — metadata saja, BUKAN isi pesan lengkap';
