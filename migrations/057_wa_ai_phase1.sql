-- Migration 057: WhatsApp AI Phase 1 — foundation
-- Adds:
--   1) ai_extractions      : audit trail for every AI vision/text classify call
--   2) expenses.validation_status / ai_extraction_id            : Pending AI flow
--   3) payment_suggestions.validation_status / forwarded_to_group : auto-forward marker
--   4) wa_monitored_groups.ai_* toggles                           : per-group AI feature flags
--   5) wa_group_logs.r2_image_url / r2_uploaded_at                : R2 90-day audit storage

-- 1) AI extractions (full audit trail)
CREATE TABLE IF NOT EXISTS ai_extractions (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  source            text NOT NULL,            -- 'wa_group' | 'wa_personal'
  source_ref        text,                     -- group_id atau phone
  group_id          text,
  sender_phone      text,
  sender_name       text,
  message_text      text,
  image_url         text,                     -- Fonnte URL (original)
  r2_url            text,                     -- R2 mirror (90h TTL)
  intent            text,                     -- 'expense' | 'payment' | 'material' | 'selesai' | 'penawaran' | 'unknown'
  confidence        text,                     -- 'HIGH' | 'MEDIUM' | 'LOW'
  extracted         jsonb,                    -- raw extract data
  model             text,                     -- 'claude-haiku-4-5'
  tokens_in         int,
  tokens_out        int,
  cost_usd          numeric(10,6),
  status            text DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected' | 'edited' | 'auto_forwarded'
  linked_table      text,                     -- 'expenses' | 'invoice_payments' | 'job_materials_brought'
  linked_id         text,                     -- ID of linked row after approve
  notes             text
);
CREATE INDEX IF NOT EXISTS idx_ai_extract_status ON ai_extractions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_extract_intent ON ai_extractions(intent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_extract_group  ON ai_extractions(group_id, created_at DESC);

ALTER TABLE ai_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_extract_all" ON ai_extractions;
CREATE POLICY "ai_extract_all" ON ai_extractions TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE ai_extractions IS 'Audit trail for every AI vision/text classification — source of truth for Pending AI tabs';

-- 2) expenses: validation flow
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'APPROVED',  -- 'PENDING_AI' | 'APPROVED' | 'REJECTED'
  ADD COLUMN IF NOT EXISTS ai_extraction_id  bigint REFERENCES ai_extractions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcategory       text;                     -- 'petty_cash' | 'pembelian_barang' | 'lain'
CREATE INDEX IF NOT EXISTS idx_opex_validation ON expenses(validation_status) WHERE validation_status = 'PENDING_AI';

-- 3) payment_suggestions: track reverse-forward state
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='payment_suggestions') THEN
    ALTER TABLE payment_suggestions
      ADD COLUMN IF NOT EXISTS validation_status   text DEFAULT 'PENDING',  -- 'PENDING'|'LINKED'|'REJECTED'
      ADD COLUMN IF NOT EXISTS forwarded_to_group  text,                    -- group_id tujuan auto-forward
      ADD COLUMN IF NOT EXISTS forwarded_at        timestamptz,
      ADD COLUMN IF NOT EXISTS ai_extraction_id    bigint REFERENCES ai_extractions(id) ON DELETE SET NULL;
  ELSE
    CREATE TABLE payment_suggestions (
      id                  bigserial PRIMARY KEY,
      created_at          timestamptz DEFAULT now(),
      sender_phone        text,
      sender_name         text,
      image_url           text,
      r2_url              text,
      amount              numeric(14,2),
      bank                text,
      transfer_date       date,
      confidence          text,
      match_invoice_id    text,
      match_customer_id   text,
      candidates          jsonb,
      validation_status   text DEFAULT 'PENDING',
      forwarded_to_group  text,
      forwarded_at        timestamptz,
      ai_extraction_id    bigint REFERENCES ai_extractions(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_paysugg_status ON payment_suggestions(validation_status, created_at DESC);
    ALTER TABLE payment_suggestions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "paysugg_all" ON payment_suggestions TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4) wa_monitored_groups: per-group AI feature toggles
ALTER TABLE wa_monitored_groups
  ADD COLUMN IF NOT EXISTS ai_expense_enabled    boolean DEFAULT false,  -- Grup AClean: auto-expense dari foto struk
  ADD COLUMN IF NOT EXISTS ai_material_enabled   boolean DEFAULT false,  -- Grup AClean: auto-tag material dibawa
  ADD COLUMN IF NOT EXISTS ai_selesai_enabled    boolean DEFAULT false,  -- Grup Report: parser "Selesai"
  ADD COLUMN IF NOT EXISTS ai_quotation_enabled  boolean DEFAULT false,  -- Grup Report: draft quotation
  ADD COLUMN IF NOT EXISTS ai_payment_enabled    boolean DEFAULT false,  -- Grup Finance: auto-link bukti TF
  ADD COLUMN IF NOT EXISTS ai_forward_target     boolean DEFAULT false,  -- Grup Finance: target auto-forward bukti TF dari personal
  ADD COLUMN IF NOT EXISTS ai_forward_min_conf   text    DEFAULT 'HIGH'; -- 'HIGH' | 'MEDIUM'

-- 5) wa_group_logs: R2 mirror untuk image grup (90h TTL)
ALTER TABLE wa_group_logs
  ADD COLUMN IF NOT EXISTS r2_image_url   text,
  ADD COLUMN IF NOT EXISTS r2_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS r2_purged_at   timestamptz;
CREATE INDEX IF NOT EXISTS idx_wgl_r2_uploaded ON wa_group_logs(r2_uploaded_at) WHERE r2_uploaded_at IS NOT NULL AND r2_purged_at IS NULL;

COMMENT ON COLUMN wa_group_logs.r2_image_url   IS 'R2 mirror dari image grup, di-sweep oleh cron r2-cleanup-90d setelah 90 hari';
COMMENT ON COLUMN wa_monitored_groups.ai_forward_target IS 'Kalau true, payment_suggestions confidence >= min_conf auto-forward ke grup ini dengan caption "Sent by AI"';
