-- Migration 047: Observability stack
-- Tanggal: 2026-05-27
-- Konteks: Audit monitoring revealed gaps di reliability/visibility:
--   1. 22 cron job tanpa per-job tracking (silent failures)
--   2. agent_logs free-form, susah filter by kategori/severity
--   3. AI usage tidak tracked → cost monitoring tidak mungkin
--   4. dispatch_logs hanya record "sent", tidak track delivered/failed
-- Solusi: extend existing + tambah 2 tabel baru (cron_runs, ai_usage).

-- ════════════════════════════════════════════════════════════════════════
-- 1. agent_logs: tambah struktur (severity, category, metadata)
-- ════════════════════════════════════════════════════════════════════════
-- Existing: action TEXT, detail TEXT, status TEXT (SUCCESS/WARNING/ERROR)
-- Tambah: severity (lebih granular dari status), category (filter by area),
--         metadata JSONB (typed extra data — order_id, error stack, dll)

ALTER TABLE agent_logs ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE agent_logs ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE agent_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Backfill severity dari status existing
UPDATE agent_logs SET severity = CASE
  WHEN status = 'ERROR' THEN 'error'
  WHEN status = 'WARNING' THEN 'warn'
  WHEN status = 'SUCCESS' THEN 'info'
  ELSE 'info'
END WHERE severity IS NULL;

-- Constraint check (nullable allowed for backwards-compat)
ALTER TABLE agent_logs DROP CONSTRAINT IF EXISTS agent_logs_severity_chk;
ALTER TABLE agent_logs ADD CONSTRAINT agent_logs_severity_chk
  CHECK (severity IS NULL OR severity IN ('debug','info','warn','error','critical'));

-- Indexes untuk filter cepat
CREATE INDEX IF NOT EXISTS idx_agent_logs_category_created
  ON agent_logs (category, created_at DESC) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_logs_severity_created
  ON agent_logs (severity, created_at DESC) WHERE severity IS NOT NULL;

COMMENT ON COLUMN agent_logs.severity IS 'debug|info|warn|error|critical — granular log level';
COMMENT ON COLUMN agent_logs.category IS 'wa|payment|inventory|ai|auth|cron|portal|security|customer|order|invoice';
COMMENT ON COLUMN agent_logs.metadata IS 'Typed extras: { order_id, invoice_id, customer_phone, error_stack, duration_ms, ... }';

-- ════════════════════════════════════════════════════════════════════════
-- 2. cron_runs: track setiap eksekusi cron job
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cron_runs (
  id BIGSERIAL PRIMARY KEY,
  task_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','SUCCESS','FAILED','SKIPPED','TIMEOUT')),
  error_message TEXT,
  items_processed INT DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_task_started
  ON cron_runs (task_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status_created
  ON cron_runs (status, created_at DESC);

-- RLS: hanya owner/admin (authenticated) bisa baca; service role bypass
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cron_runs_read_authenticated ON cron_runs;
CREATE POLICY cron_runs_read_authenticated ON cron_runs
  FOR SELECT USING (auth.role() = 'authenticated');

-- INSERT/UPDATE hanya service_role (backend cron-reminder.js pakai service key)
DROP POLICY IF EXISTS cron_runs_write_service ON cron_runs;
CREATE POLICY cron_runs_write_service ON cron_runs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE cron_runs IS 'Tracking eksekusi cron job (22 task di vercel.json). Backend log start/finish via /api/cron-reminder.';

-- ════════════════════════════════════════════════════════════════════════
-- 3. ai_usage: track AI API calls untuk cost monitoring
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_usage (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude','openai','gemini','groq','minimax')),
  model TEXT,
  feature TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,
  user_id UUID,
  user_name TEXT,
  duration_ms INT,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created
  ON ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_created
  ON ai_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created
  ON ai_usage (feature, created_at DESC) WHERE feature IS NOT NULL;

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_read_authenticated ON ai_usage;
CREATE POLICY ai_usage_read_authenticated ON ai_usage
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS ai_usage_write_service ON ai_usage;
CREATE POLICY ai_usage_write_service ON ai_usage
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE ai_usage IS 'Per-call AI usage log (ARA chat, Tool Bag Vision, auto-dispatch). Cost dihitung backend pakai pricing table.';
COMMENT ON COLUMN ai_usage.feature IS 'ara-chat | tool-bag-vision | auto-dispatch | payment-suggestion | other';

-- ════════════════════════════════════════════════════════════════════════
-- 4. dispatch_logs: tambah delivery tracking
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE dispatch_logs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE dispatch_logs ADD COLUMN IF NOT EXISTS failed_reason TEXT;
ALTER TABLE dispatch_logs ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dispatch_logs_sent_status
  ON dispatch_logs (sent_at DESC, status);

COMMENT ON COLUMN dispatch_logs.delivered_at IS 'Diisi via Fonnte webhook callback ketika status delivered. NULL = belum confirmed.';
COMMENT ON COLUMN dispatch_logs.failed_reason IS 'Alasan WA gagal terkirim (dari Fonnte response atau exception).';

-- ════════════════════════════════════════════════════════════════════════
-- 5. wa_delivery_metrics: materialized view untuk dashboard (refresh manual)
-- ════════════════════════════════════════════════════════════════════════
-- Pakai view biasa (bukan materialized) supaya selalu real-time tanpa refresh job.
CREATE OR REPLACE VIEW wa_delivery_summary AS
SELECT
  DATE(sent_at AT TIME ZONE 'Asia/Jakarta') AS day,
  COUNT(*) AS total_sent,
  COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
  COUNT(*) FILTER (WHERE failed_reason IS NOT NULL) AS failed,
  COUNT(*) FILTER (WHERE delivered_at IS NULL AND failed_reason IS NULL) AS pending,
  COALESCE(SUM(retry_count), 0) AS total_retries
FROM dispatch_logs
WHERE sent_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(sent_at AT TIME ZONE 'Asia/Jakarta')
ORDER BY day DESC;

COMMENT ON VIEW wa_delivery_summary IS 'Daily WA delivery aggregate untuk 30 hari terakhir. Pakai Asia/Jakarta TZ.';

-- ════════════════════════════════════════════════════════════════════════
-- 6. Cleanup job — retention 90 hari untuk agent_logs, cron_runs, ai_usage
-- ════════════════════════════════════════════════════════════════════════
-- Function untuk dipanggil dari cron job baru (lihat api/cron-reminder.js task=log-cleanup)
CREATE OR REPLACE FUNCTION cleanup_observability_logs(retention_days INT DEFAULT 90)
RETURNS TABLE(table_name TEXT, deleted_count BIGINT) AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - (retention_days || ' days')::INTERVAL;
  deleted BIGINT;
BEGIN
  DELETE FROM agent_logs WHERE created_at < cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'agent_logs'; deleted_count := deleted; RETURN NEXT;

  DELETE FROM cron_runs WHERE created_at < cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'cron_runs'; deleted_count := deleted; RETURN NEXT;

  DELETE FROM ai_usage WHERE created_at < cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'ai_usage'; deleted_count := deleted; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_observability_logs IS 'Hapus log lebih lama dari retention_days (default 90). Dipanggil cron weekly via /api/cron-reminder?task=log-cleanup.';
