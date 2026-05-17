CREATE TABLE IF NOT EXISTS wa_group_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_phone text NOT NULL,
  sender_name text NOT NULL,
  group_id text,
  type text NOT NULL DEFAULT 'general',
  content text NOT NULL,
  job_id text,
  amount numeric,
  parsed_ok boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wgl_sender ON wa_group_logs(sender_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wgl_type ON wa_group_logs(type, created_at DESC);
ALTER TABLE wa_group_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_full" ON wa_group_logs;
CREATE POLICY "service_full" ON wa_group_logs USING (true) WITH CHECK (true);
