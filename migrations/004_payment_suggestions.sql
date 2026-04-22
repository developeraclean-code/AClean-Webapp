-- Migration 004: payment_suggestions table
-- Purpose: Bridge table for WA auto-payment detection.
-- Backend detects payment proof → writes suggestion → frontend reads via Realtime → admin 1-click confirm.
-- Run in Supabase SQL Editor (production + branch both use same Supabase instance).

CREATE TABLE IF NOT EXISTS payment_suggestions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         text NOT NULL,
  sender_name   text,
  raw_message   text,
  amount        numeric,
  bank          text,
  transfer_date date,
  invoice_id    text,
  status        text DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','DISMISSED')),
  source        text DEFAULT 'text' CHECK (source IN ('text','image')),
  image_url     text,
  created_at    timestamptz DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text
);

ALTER TABLE payment_suggestions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by serverless functions)
DROP POLICY IF EXISTS "service_full" ON payment_suggestions;
CREATE POLICY "service_full" ON payment_suggestions USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ps_status ON payment_suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ps_phone  ON payment_suggestions(phone);

-- Seed app_settings toggles (default: chatbot OFF, payment detect ON)
INSERT INTO app_settings (key, value) VALUES
  ('wa_chatbot_enabled', 'false'),
  ('wa_payment_detect',  'true')
ON CONFLICT (key) DO NOTHING;
