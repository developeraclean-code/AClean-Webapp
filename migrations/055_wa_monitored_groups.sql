-- Migration 055: WA Group monitoring infrastructure
-- Whitelist grup WA yang akan dimonitor + extended log table

-- Whitelist tabel: grup mana yang aktif dimonitor + config per-grup
CREATE TABLE IF NOT EXISTS wa_monitored_groups (
  group_id text PRIMARY KEY,
  group_name text NOT NULL,
  description text,
  enabled boolean DEFAULT true,
  capture_all boolean DEFAULT false,
  forward_to_owner boolean DEFAULT false,
  notify_keywords text[],
  added_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wmg_enabled ON wa_monitored_groups(enabled) WHERE enabled = true;

ALTER TABLE wa_monitored_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wmg_anon_all" ON wa_monitored_groups;
CREATE POLICY "wmg_anon_all" ON wa_monitored_groups TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE wa_monitored_groups IS 'Whitelist grup WA yang dimonitor. Webhook skip semua grup yang tidak ada di sini.';
COMMENT ON COLUMN wa_monitored_groups.capture_all IS 'true: log SEMUA pesan ke wa_group_logs (heavy). false: cuma parse-able (biaya/laporan/stok).';
COMMENT ON COLUMN wa_monitored_groups.forward_to_owner IS 'true: forward setiap pesan grup ke Owner via WA (alert mode).';
COMMENT ON COLUMN wa_monitored_groups.notify_keywords IS 'Array keyword. Jika pesan match → alert Owner walau capture_all=false.';

-- Extend wa_group_logs: tambah kolom untuk fleksibilitas
ALTER TABLE wa_group_logs ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE wa_group_logs ADD COLUMN IF NOT EXISTS forwarded boolean DEFAULT false;
ALTER TABLE wa_group_logs ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE wa_group_logs ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_wgl_group_created ON wa_group_logs(group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wgl_type_parsed ON wa_group_logs(type, parsed_ok, created_at DESC);

-- Realtime publication supaya UI auto-update saat ada pesan baru
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE wa_monitored_groups;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE wa_group_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
