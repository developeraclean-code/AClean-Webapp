-- Phase 2 shadow logging — Gap 1/2/3 monitor only
-- Tabel utk LOG behavior parser TANPA aksi DB lainnya. Owner review manual,
-- nanti kalau confidence ≥ 95% baru flip toggle ke action mode.
--
-- NO foreign-key constraint ke source_log_id (cascade delete via wa_cleanup tidak diinginkan
-- — observation HARUS persist meski log asli sudah di-purge).

CREATE TABLE IF NOT EXISTS wa_ai_observations (
  id BIGSERIAL PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Source tag: gap1_carrier | gap2_laporan_team | gap3_bon_ext
  source TEXT NOT NULL,
  group_id TEXT,
  group_name TEXT,
  source_log_id UUID,
  sender_phone TEXT,
  sender_name TEXT,
  message_text TEXT,
  parsed_data JSONB,
  proposed_action TEXT,
  proposed_target JSONB,
  match_confidence TEXT,    -- HIGH | MEDIUM | LOW
  match_candidates JSONB,
  notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  action_decision TEXT      -- NULL | ACCEPT | REJECT | NEEDS_FIX
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_obs_observed_at ON wa_ai_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_ai_obs_source ON wa_ai_observations(source, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_ai_obs_decision ON wa_ai_observations(action_decision) WHERE action_decision IS NULL;

COMMENT ON TABLE wa_ai_observations IS 'Phase 2 shadow log — gap 1/2/3 parser observations TANPA aksi DB. Manual review oleh Owner.';
