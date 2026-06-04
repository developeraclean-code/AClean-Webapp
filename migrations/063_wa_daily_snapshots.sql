-- WA daily snapshot — Phase 2 review window 2026-06-04 → 2026-06-11
-- Tujuan: dump harian seluruh percakapan 3 grup ke R2 JSON utk review pattern + tuning rule
-- Cron: 20:00 WIB (13:00 UTC) tiap hari, mulai 4 Juni 2026

CREATE TABLE IF NOT EXISTS wa_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  r2_url TEXT NOT NULL,
  groups_count INT,
  total_messages INT,
  total_with_image INT,
  total_ai_classified INT,
  total_expenses_inserted INT,
  size_bytes INT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

COMMENT ON TABLE wa_daily_snapshots IS 'Phase 2: daily dump per group + AI extractions + expenses untuk review pattern (4-11 Juni 2026)';
